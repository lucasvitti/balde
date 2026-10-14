#!/usr/bin/env node
// Empacota o conector MCP do Balde como um .mcpb (formato de extensão do Claude Desktop).
// Um .mcpb é só um ZIP: manifest.json na raiz + server/<arquivos do servidor>. O Desktop lê o
// manifest, pede os user_config (chave, base URL, balde) e injeta no ambiente do processo node.
//
// Uso:
//   node make-mcpb.mjs                      # bundle GENÉRICO — o usuário escolhe o balde na config
//   node make-mcpb.mjs --repo concorrencia  # REPO-SCOPED — extensão distinta (balde-knowledge-concorrencia),
//                                            #   o balde vai BAKED como default → vários baldes coexistem no Desktop
//   node make-mcpb.mjs --version 1.8.0 --base-url http://127.0.0.1:8098 --out /caminho/saida.mcpb
//
// Espelha a lógica dos launchers por-balde (balde-mcp-<repo>.cmd → servidor balde-<repo>): no
// Desktop, como cada extensão é identificada pelo `name`, um bundle por balde (name distinto) é o
// equivalente para conectar mais de um balde ao mesmo tempo.
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url)); // integrations/ai-tools/mcpb
const aiTools = resolve(here, '..');                  // integrations/ai-tools (onde vivem os .mjs do servidor)
const SERVER_FILES = ['baldeClient.mjs', 'mcp-server.mjs', 'tools.mjs'];

const arg = (name, def = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
};

const repo = (arg('repo', '') || '').trim().toLowerCase();
if (repo && !/^[a-z0-9][a-z0-9-]*$/.test(repo)) { console.error(`repo inválido: "${repo}" (use minúsculas, dígitos e hífens)`); process.exit(1); }

const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
manifest.version = arg('version', manifest.version);
const baseUrl = arg('base-url', null);
if (baseUrl) manifest.user_config.balde_base_url.default = baseUrl;

if (repo && repo !== 'corporate') {
  // Identidade distinta (senão substituiria a extensão corporativa no Desktop) + balde baked.
  manifest.name = `balde-knowledge-${repo}`;
  manifest.display_name = `${manifest.display_name} — ${repo}`;
  manifest.user_config.balde_repo.default = repo;
  manifest.user_config.balde_repo.title = `Balde (repo) — padrão: ${repo}`;
}

const outName = repo && repo !== 'corporate'
  ? `balde-knowledge-${repo}-${manifest.version}.mcpb`
  : `balde-knowledge-${manifest.version}.mcpb`;
const out = resolve(arg('out', join(aiTools, outName)));

// Stage descartável: manifest.json na raiz + server/<arquivos>.
const stage = join(tmpdir(), `mcpb-stage-${Date.now()}`);
await mkdir(join(stage, 'server'), { recursive: true });
await writeFile(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
for (const f of SERVER_FILES) {
  const src = join(aiTools, f);
  if (!existsSync(src)) { console.error(`arquivo do servidor faltando: ${src}`); process.exit(1); }
  await copyFile(src, join(stage, 'server', f));
}

// Um .mcpb é um ZIP comum. Prefere `zip` (Unix/Git-Bash/MiKTeX); no Windows sem zip cai no
// Compress-Archive do PowerShell. `-X` descarta atributos extras (build reproduzível).
if (existsSync(out)) await rm(out);
const run = (cmd, args, opts) => { const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts }); return !r.error && r.status === 0; };
let ok = run('zip', ['-r', '-X', out, 'manifest.json', 'server'], { cwd: stage });
if (!ok && process.platform === 'win32') {
  const items = `'${join(stage, 'manifest.json')}','${join(stage, 'server')}'`;
  ok = run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path ${items} -DestinationPath '${out}' -Force`]);
}
await rm(stage, { recursive: true, force: true });
if (!ok) { console.error('falha ao empacotar — nem `zip` nem Compress-Archive disponíveis.'); process.exit(1); }

console.log(`\nBundle: ${out}`);
console.log(`  name=${manifest.name}  version=${manifest.version}  ${repo && repo !== 'corporate' ? `repo=${repo} (BAKED)` : '(genérico — repo escolhido na config do Desktop)'}`);
