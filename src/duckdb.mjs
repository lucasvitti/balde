// DuckDB as an EPHEMERAL execution engine over the file corpus (never a database):
// one throwaway `duckdb` CLI subprocess per execution — the same pattern as git, an
// image-level tool the bucket knows how to use. Zero runtime npm deps stays true.
//
// Sandbox model (defense in depth, in this order):
//   1. only the resolved GOVERNED datasets are loaded, as named in-memory TABLES
//      (tables, not views — views are lazy and would re-read files after the lock);
//   2. `SET enable_external_access = false` — from here the SQL physically cannot
//      touch the filesystem, network or extensions;
//   3. `SET lock_configuration = true` — no further SET of anything;
//   4. the process itself: wall-clock kill + stdout byte cap + memory_limit/threads.
// The executed SQL is CURATED corpus content (query/*.sql, git-versioned), not user
// input — the sandbox is belt-and-suspenders, not the only line of defense.
import { spawn } from 'node:child_process';

const DUCKDB_BIN = process.env.DUCKDB_BIN || 'duckdb';
const TIMEOUT_MS = Number(process.env.DUCKDB_TIMEOUT_MS || 15000);
const MAX_STDOUT_BYTES = Number(process.env.DUCKDB_MAX_STDOUT || 8 * 1024 * 1024);
const MAX_ROWS = Number(process.env.DUCKDB_MAX_ROWS || 2000);
const MEMORY_LIMIT = process.env.DUCKDB_MEMORY_LIMIT || '512MB';

function sqlPath(p) {
  return `'${String(p).replace(/'/g, "''")}'`;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

// A dataset file's table name: the file stem as a safe identifier (base.parquet → base).
export function datasetTableName(fileName) {
  let stem = String(fileName)
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!stem) stem = 'dados';
  if (/^\d/.test(stem)) stem = `t_${stem}`;
  return stem.slice(0, 60);
}

function readerFor(path) {
  return /\.parquet$/i.test(path) ? 'read_parquet' : 'read_csv_auto';
}

// datasets: [{ table, path }] (absolute paths, pre-validated by the caller's ACL layer).
function buildScript(datasets, sql) {
  const lines = [`SET memory_limit = '${MEMORY_LIMIT}';`, 'SET threads = 2;'];
  for (const d of datasets) {
    lines.push(`CREATE TABLE ${quoteIdent(d.table)} AS SELECT * FROM ${readerFor(d.path)}(${sqlPath(d.path)});`);
  }
  lines.push('SET enable_external_access = false;');
  lines.push('SET lock_configuration = true;');
  lines.push(String(sql));
  return `${lines.join('\n')}\n`;
}

// stdout of `duckdb -json` is a sequence of JSON arrays that SPAN LINES — extract them
// with a bracket-depth scan that respects string literals (never line-based parsing).
export function extractJsonArrays(text) {
  const out = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '[' || ch === '{') {
      if (depth === 0 && ch === '[') start = i;
      depth++;
    } else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0 && start >= 0 && ch === ']') {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch (error) {
          /* partial/garbled — skip */
        }
        start = -1;
      }
    }
  }
  return out;
}

function runScript(script) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let stdout = '';
    let stderr = '';
    let killed = false;
    let overflow = false;
    const proc = spawn(DUCKDB_BIN, ['-json', '-batch', ':memory:'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      killed = true;
      try {
        proc.kill('SIGKILL');
      } catch (error) {
        /* gone */
      }
    }, TIMEOUT_MS);
    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_STDOUT_BYTES) {
        overflow = true;
        try {
          proc.kill('SIGKILL');
        } catch (error) {
          /* gone */
        }
      }
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 65536) stderr = stderr.slice(-65536);
    });
    proc.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `duckdb indisponível: ${error.message}`, elapsedMs: Date.now() - t0 });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - t0;
      if (killed && !overflow) {
        resolve({
          ok: false,
          error: `Tempo limite de execução excedido (${Math.round(TIMEOUT_MS / 1000)}s).`,
          elapsedMs
        });
        return;
      }
      if (overflow) {
        resolve({ ok: false, error: 'Resultado grande demais — adicione um LIMIT ou agregue os dados.', elapsedMs });
        return;
      }
      if (
        code !== 0 ||
        /(^|\n)(Parser |Binder |Catalog |Conversion |Permission |Invalid |IO |Out of Memory )?Error/i.test(stderr)
      ) {
        const tail = stderr.trim().split('\n').slice(-6).join('\n');
        resolve({ ok: false, error: tail || `duckdb saiu com código ${code}.`, elapsedMs });
        return;
      }
      resolve({ ok: true, stdout, elapsedMs });
    });
    proc.stdin.write(script);
    proc.stdin.end();
  });
}

// Execute a governed query over pre-resolved datasets. The LAST result set (the final
// SELECT of the script) is the answer — earlier SELECTs are treated as intermediate.
export async function runGovernedQuery(datasets, sql) {
  const r = await runScript(buildScript(datasets, sql));
  if (!r.ok) return { ok: false, error: r.error, elapsedMs: r.elapsedMs };
  const arrays = extractJsonArrays(r.stdout);
  const result = arrays.length ? arrays[arrays.length - 1] : [];
  const rows = Array.isArray(result) ? result : [];
  const truncated = rows.length > MAX_ROWS;
  const kept = truncated ? rows.slice(0, MAX_ROWS) : rows;
  const columns = kept.length ? Object.keys(kept[0]) : [];
  return { ok: true, columns, rows: kept, rowCount: rows.length, truncated, elapsedMs: r.elapsedMs };
}

// Schema + profile of ONE dataset (Inspecionar): DESCRIBE, COUNT(*), SUMMARIZE.
export async function inspectDataset(dataset) {
  const t = quoteIdent(dataset.table);
  const sql = `DESCRIBE ${t};\nSELECT COUNT(*) AS linhas FROM ${t};\nSUMMARIZE ${t};`;
  const r = await runScript(buildScript([dataset], sql));
  if (!r.ok) return { ok: false, error: r.error, elapsedMs: r.elapsedMs };
  const arrays = extractJsonArrays(r.stdout);
  if (arrays.length < 3) return { ok: false, error: 'Não foi possível perfilar o arquivo.', elapsedMs: r.elapsedMs };
  const schema = arrays[0];
  const rowCount = (arrays[1][0] && Number(arrays[1][0].linhas)) || 0;
  const profile = arrays[2];
  return { ok: true, schema, rowCount, profile, elapsedMs: r.elapsedMs };
}
