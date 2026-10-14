#!/usr/bin/env node
// `balde ask` — feed a prompt, get a grounded answer from the terminal. Zero-dependency CLI over
// Balde's machine API (POST/GET /api/v1/ask): the server runs the SAME grounded tool-loop the chat
// uses and returns the answer, so this stays a thin client (POST + print). No API key to manage on
// a local install — it self-sources the machine key + base URL from the app launcher, exactly like
// the MCP server does.
//
//   balde ask "quanto ficou o reajuste anual?"
//   balde ask --repo meu-balde --skill reuniao/resumo-reuniao "resuma a última reunião"
//   echo "minha pergunta" | balde ask            # question from stdin
//   balde ask --json "..."                        # full JSON (answer + sources + mode)
//
// Config (precedence): flags (--base/--key/--repo) > env (BALDE_BASE_URL/BALDE_API_KEY/BALDE_REPO)
// > the local launcher (%LOCALAPPDATA%\Balde\balde-mcp.cmd). Node 18+ (global fetch), no npm deps.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---- Local credentials: read the app's launcher (the local server keeps it current with the
// machine key + port), so a local install needs zero config. No-op when the env already carries
// them, or when there is no launcher (a remote connection — pass --base/--key or set the env).
function selfSourceLocalCreds() {
  if (process.env.BALDE_API_KEY && process.env.BALDE_BASE_URL) return;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return;
  const launcher = join(localAppData, 'Balde', 'balde-mcp.cmd');
  let cmd = '';
  try { cmd = readFileSync(launcher, 'utf8'); } catch { return; }
  const read = (key) => (cmd.match(new RegExp(`set "${key}=([^"]*)"`)) || [])[1] || '';
  if (!process.env.BALDE_API_KEY) { const k = read('BALDE_API_KEY'); if (k) process.env.BALDE_API_KEY = k; }
  if (!process.env.BALDE_BASE_URL) { const u = read('BALDE_BASE_URL'); if (u) process.env.BALDE_BASE_URL = u; }
}

// Re-read the CURRENT machine key from the launcher (self-heal a 401 after the app rotated its key).
function reSourceKey() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return false;
  let cmd = '';
  try { cmd = readFileSync(join(localAppData, 'Balde', 'balde-mcp.cmd'), 'utf8'); } catch { return false; }
  const fresh = (cmd.match(/set "BALDE_API_KEY=([^"]*)"/) || [])[1] || '';
  if (fresh && fresh !== (process.env.BALDE_API_KEY || '').trim()) { process.env.BALDE_API_KEY = fresh; return true; }
  return false;
}

const HELP = `balde ask — pergunta e resposta aterrada no corpus do Balde, pelo terminal.

Uso:
  balde ask "sua pergunta"
  balde ask [opções] "sua pergunta"
  echo "sua pergunta" | balde ask

Opções:
  -r, --repo <balde>    Repo (balde) a consultar. Padrão: o do env BALDE_REPO ou "corporate".
  -s, --skill <id>      Fixa uma skill como contexto (repetível). Sem isto, o modelo busca no corpus inteiro.
  -m, --max <n>         Máximo de passos de ferramenta (1–12, padrão 8).
      --json            Imprime a resposta em JSON (answer, sources, mode, model). Desliga o streaming.
      --no-stream       Espera a resposta inteira e imprime de uma vez (sem efeito de digitação).
      --stream          Força streaming (padrão quando a saída é um terminal).
      --base <url>      Base URL do servidor (senão env BALDE_BASE_URL ou o launcher local).
      --key <token>     Chave pessoal (senão env BALDE_API_KEY ou o launcher local).
  -h, --help            Esta ajuda.

Sem chave/URL explícitos, lê do launcher local (%LOCALAPPDATA%\\Balde\\balde-mcp.cmd).`;

function parseArgs(argv) {
  const out = { skills: [], stream: null, json: false, max: 0, repo: '', base: '', key: '', words: [] };
  const rest = argv.slice();
  if (rest[0] === 'ask') rest.shift(); // tolerate the `balde ask ...` subcommand form
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '-h' || a === '--help') { out.help = true; }
    else if (a === '--json') { out.json = true; }
    else if (a === '--no-stream') { out.stream = false; }
    else if (a === '--stream') { out.stream = true; }
    else if (a === '-r' || a === '--repo') { out.repo = rest[++i] || ''; }
    else if (a === '-s' || a === '--skill') { const v = rest[++i]; if (v) out.skills.push(v); }
    else if (a === '-m' || a === '--max') { out.max = Number(rest[++i]) || 0; }
    else if (a === '--base') { out.base = rest[++i] || ''; }
    else if (a === '--key') { out.key = rest[++i] || ''; }
    else if (a === '--') { out.words.push(...rest.slice(i + 1)); break; }
    else if (a.startsWith('-') && a.length > 1 && !/^-?\d/.test(a)) { die(`Opção desconhecida: ${a}\n\n${HELP}`); }
    else { out.words.push(a); }
  }
  return out;
}

function die(msg, code = 1) { process.stderr.write(`${msg}\n`); process.exit(code); }

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

function buildHeaders(key, repo, extra = {}) {
  return {
    authorization: `Bearer ${key}`,
    accept: extra.accept || 'application/json',
    'content-type': 'application/json',
    ...(repo ? { 'x-balde-repo': repo } : {})
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(`${HELP}\n`); return; }

  if (args.base) process.env.BALDE_BASE_URL = args.base;
  if (args.key) process.env.BALDE_API_KEY = args.key;
  selfSourceLocalCreds();

  const base = (process.env.BALDE_BASE_URL || '').trim().replace(/\/+$/, '');
  const key = (process.env.BALDE_API_KEY || '').trim();
  const repo = (args.repo || process.env.BALDE_REPO || '').trim().toLowerCase();
  if (!base) die('Sem servidor: passe --base ou defina BALDE_BASE_URL (ex.: http://127.0.0.1:8098). Num computador com o Balde instalado, isso vem do launcher local automaticamente.');
  if (!key) die('Sem chave: passe --key ou defina BALDE_API_KEY. Num computador com o Balde instalado, isso vem do launcher local automaticamente.');

  let question = args.words.join(' ').trim();
  if (!question) question = await readStdin();
  if (!question) die(`Nenhuma pergunta. Passe a pergunta como argumento ou por stdin.\n\n${HELP}`);

  const stream = args.json ? false : (args.stream === null ? Boolean(process.stdout.isTTY) : args.stream);
  const payload = { question, ...(args.skills.length ? { skills: args.skills } : {}), ...(args.max ? { maxSteps: args.max } : {}), ...(stream ? { stream: true } : {}) };

  const post = (accept) => fetch(`${base}/api/v1/ask`, { method: 'POST', headers: buildHeaders((process.env.BALDE_API_KEY || '').trim(), repo, { accept }), body: JSON.stringify(payload) });

  let res;
  try { res = await post(stream ? 'text/event-stream' : 'application/json'); }
  catch (error) { die(`Erro de rede chamando o Balde (${base}): ${error.message}`); }
  // 401 self-heal: the app may have rotated its machine key since the launcher was last read.
  if (res.status === 401 && reSourceKey()) {
    try { res = await post(stream ? 'text/event-stream' : 'application/json'); } catch (error) { die(`Erro de rede: ${error.message}`); }
  }
  if (res.status === 401) die('Chave recusada (401). Verifique BALDE_API_KEY — precisa ser uma chave pessoal ativa (Configurações → API). Num computador com o Balde instalado, rode o BaldeSetup para renovar o launcher.');

  if (stream) { await consumeStream(res); return; }

  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok || data.ok === false) {
    const msg = data.message || data.error || `HTTP ${res.status}`;
    die(`Balde: ${msg}`);
  }
  if (args.json) { process.stdout.write(`${JSON.stringify(data, null, 2)}\n`); return; }
  process.stdout.write(`${String(data.answer || '').trim()}\n`);
  printSources(data.sources);
}

// Consume the SSE stream: text deltas → stdout live; tool/mode → dim status on stderr; done → sources.
async function consumeStream(res) {
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    let msg = `HTTP ${res.status}`;
    try { const j = JSON.parse(detail); msg = j.message || j.error || msg; } catch { /* keep */ }
    die(`Balde: ${msg}`);
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let printedAny = false;
  let sources = [];
  let errored = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue; // skip `: open` / `: hb` comments and blanks
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let evt; try { evt = JSON.parse(payload); } catch { continue; }
      if (evt.type === 'delta' && typeof evt.text === 'string') { process.stdout.write(evt.text); printedAny = true; }
      else if (evt.type === 'tool') { process.stderr.write(dim(`· ${toolLabel(evt.name)}\n`)); }
      else if (evt.type === 'done') { sources = evt.sources || []; }
      else if (evt.type === 'error') { errored = evt.error || 'erro no stream'; }
    }
  }
  if (printedAny) process.stdout.write('\n');
  if (errored) die(`Balde: ${errored}`, printedAny ? 0 : 1);
  printSources(sources);
}

function toolLabel(name) {
  const map = { search_corpus: 'buscando no corpus…', list_skills: 'listando skills…', read_context: 'lendo o corpus…', list_context: 'lendo o índice…', run_query: 'executando query governada…' };
  return map[name] || `${name}…`;
}
function dim(s) { return process.stderr.isTTY ? `\x1b[2m${s}\x1b[0m` : s; }
function printSources(sources) {
  if (Array.isArray(sources) && sources.length) process.stderr.write(dim(`\nfontes: ${sources.join(', ')}\n`));
}

main().catch((error) => die(`Erro: ${error && error.message ? error.message : error}`));
