// MCP one-click setup (balde-local, Windows): conecta o Balde LOCAL ao Claude Desktop,
// ao Claude Code e ao Codex CLI. Estratégia: um LAUNCHER estável em %LOCALAPPDATA%\Balde\
// balde-mcp.cmd guarda o node da release atual + o mcp-server.mjs + a chave — os configs
// dos clientes apontam só para o launcher (via cmd /c), então sobrevivem a updates de
// release e nunca carregam segredo. ChatGPT Desktop NÃO roda MCP local (só conectores
// remotos) — no lado OpenAI o caminho é o Codex CLI.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { resolveBin } from './ai-cli.mjs';

// Test harness: BALDE_MCP_FAKE_HOME redireciona TODOS os alvos de escrita (configs dos
// clientes + launcher) para uma pasta descartável — nenhum config real é tocado.
function paths() {
  const fake = process.env.BALDE_MCP_FAKE_HOME || '';
  const home = fake || homedir();
  const appData = fake
    ? join(fake, 'AppData', 'Roaming')
    : process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  const localAppData = fake
    ? join(fake, 'AppData', 'Local')
    : process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return {
    fake: Boolean(fake),
    launcher: join(localAppData, 'Balde', 'balde-mcp.cmd'),
    // Launcher do comando de terminal `balde` (balde-ask.mjs) numa pasta ESTÁVEL que o instalador
    // põe no PATH UMA vez — só o conteúdo muda a cada release, o PATH nunca.
    cliLauncher: join(localAppData, 'Balde', 'cli', 'balde.cmd'),
    claudeDesktop: join(appData, 'Claude', 'claude_desktop_config.json'),
    claudeCode: join(home, '.claude.json'),
    codex: join(home, '.codex', 'config.toml')
  };
}

// A pasta ESTÁVEL do launcher `balde` — o que vai no PATH do usuário (shell + instalador). Fixa
// entre releases, então o PATH é configurado uma vez e nunca muda. Mantida em sincronia com o
// caminho fixo que o shell (Program.cs) e o BaldeSetup usam.
export function baldeCliDir() {
  return dirname(paths().cliLauncher);
}

export function mcpSupported() {
  return process.platform === 'win32';
}

// launcher: node da release atual + mcp-server + credenciais
// Caminho do launcher POR BALDE: o default (corporate) é balde-mcp.cmd; um balde específico
// ganha balde-mcp-<repo>.cmd (com BALDE_REPO fixo), para vários baldes coexistirem no cliente.
function launcherFor(repo) {
  const p = paths();
  const r = String(repo || '')
    .trim()
    .toLowerCase();
  return r && r !== 'corporate' ? join(dirname(p.launcher), `balde-mcp-${r}.cmd`) : p.launcher;
}

export async function writeMcpLauncher({ nodeExe, mcpServerPath, baseUrl, apiKey, repo = '' }) {
  const r = String(repo || '')
    .trim()
    .toLowerCase();
  const launcher = launcherFor(r);
  await mkdir(dirname(launcher), { recursive: true });
  const lines = [
    '@echo off',
    'rem Launcher do MCP do Balde — gerado pelo servidor local; regravado a cada release.',
    `set "BALDE_BASE_URL=${baseUrl}"`,
    `set "BALDE_API_KEY=${apiKey}"`
  ];
  if (r && r !== 'corporate') lines.push(`set "BALDE_REPO=${r}"`); // baldeClient manda como header x-balde-repo
  lines.push(`"${nodeExe}" "${mcpServerPath}" %*`, '');
  await writeFile(launcher, lines.join('\r\n'), 'utf8');
  return launcher;
}

// Launcher do comando de terminal `balde` (`balde ask "..."`): node da release atual + balde-ask.mjs
// + credenciais embutidas (como no balde-mcp.cmd), então funciona em qualquer terminal mesmo sem MCP
// configurado. Fica na pasta ESTÁVEL baldeCliDir() (posta no PATH pelo instalador/shell uma vez);
// regravado a cada boot/release para acompanhar o caminho da release e a chave de máquina atual.
export async function writeBaldeCliLauncher({ nodeExe, cliScriptPath, baseUrl, apiKey }) {
  const launcher = paths().cliLauncher;
  await mkdir(dirname(launcher), { recursive: true });
  const lines = [
    '@echo off',
    'rem Launcher do comando `balde` — gerado pelo servidor local; regravado a cada release.',
    `set "BALDE_BASE_URL=${baseUrl}"`,
    `set "BALDE_API_KEY=${apiKey}"`,
    `"${nodeExe}" "${cliScriptPath}" %*`,
    ''
  ];
  await writeFile(launcher, lines.join('\r\n'), 'utf8');
  return launcher;
}

// Regrava TODOS os launchers existentes (default + por-balde) com os caminhos da release atual,
// preservando o BALDE_REPO de cada um (derivado do nome do arquivo). Chamado no boot: sem isto a
// poda de releases antigas quebraria os launchers por-balde silenciosamente. No-op quando não há
// launcher (não cria — só atualiza os que o usuário já criou via /api/mcp/setup).
export async function refreshAllLaunchers({ nodeExe, mcpServerPath, baseUrl, apiKey }) {
  const dir = dirname(paths().launcher);
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => /^balde-mcp(-[a-z0-9][a-z0-9-]*)?\.cmd$/i.test(f));
  } catch {
    files = [];
  }
  const written = [];
  for (const f of files) {
    const m = /^balde-mcp-([a-z0-9][a-z0-9-]*)\.cmd$/i.exec(f);
    written.push(await writeMcpLauncher({ nodeExe, mcpServerPath, baseUrl, apiKey, repo: m ? m[1] : '' }));
  }
  return written;
}

// status: o que já está conectado
async function readJsonSafe(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

// Desktop is configured via the EXTENSION now (auto-installed .mcpb), not the config file which the
// current Desktop build ignores. Reports configured when a balde-knowledge extension is enabled.
async function claudeDesktopExtensionEnabled() {
  const dir = join(dirname(paths().claudeDesktop), 'Claude Extensions Settings');
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return false;
  }
  for (const f of files) {
    if (!/balde-knowledge.*\.json$/i.test(f)) continue;
    const s = await readJsonSafe(join(dir, f));
    if (s && s.isEnabled) return true;
  }
  return false;
}

export async function mcpStatus() {
  const p = paths();
  const desktop = await readJsonSafe(p.claudeDesktop);
  const code = await readJsonSafe(p.claudeCode);
  let codexToml = '';
  try {
    codexToml = await readFile(p.codex, 'utf8');
  } catch {
    codexToml = '';
  }
  return {
    supported: mcpSupported(),
    launcher: { path: p.launcher, exists: existsSync(p.launcher) },
    clients: {
      'claude-desktop': {
        installed: existsSync(dirname(p.claudeDesktop)),
        configured:
          (await claudeDesktopExtensionEnabled()) || Boolean(desktop && desktop.mcpServers && desktop.mcpServers.balde),
        configPath: p.claudeDesktop
      },
      'claude-code': {
        installed: existsSync(p.claudeCode),
        configured: Boolean(code && code.mcpServers && code.mcpServers.balde),
        configPath: p.claudeCode
      },
      codex: {
        installed: existsSync(dirname(p.codex)),
        configured: /\[mcp_servers\.balde\]/.test(codexToml),
        configPath: p.codex
      }
    }
  };
}

// escritores por cliente
async function backupOnce(path) {
  try {
    if (existsSync(path) && !existsSync(`${path}.bak-balde`)) await copyFile(path, `${path}.bak-balde`);
  } catch {
    /* ignore */
  }
}

export async function setupClaudeDesktop(launcherPath, serverName = 'balde') {
  const p = paths();
  await mkdir(dirname(p.claudeDesktop), { recursive: true });
  await backupOnce(p.claudeDesktop);
  const cfg = (await readJsonSafe(p.claudeDesktop)) || {};
  cfg.mcpServers = { ...(cfg.mcpServers || {}), [serverName]: { command: 'cmd', args: ['/c', launcherPath] } };
  await writeFile(p.claudeDesktop, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  return {
    ok: true,
    configPath: p.claudeDesktop,
    restart: `Feche e reabra o Claude Desktop — o servidor "${serverName}" aparece nas ferramentas (ícone de conectores).`
  };
}

// slug para o ID da extensão (espelha a convenção do .mcpb: local.mcpb.<autor>.<nome>).
function slugForId(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// AUTO-INSTALA a extensão do Claude Desktop (.mcpb) SEM o arrastar-e-soltar. Uma extensão do Desktop
// é só uma pasta extraída (manifest.json + server/) em "Claude Extensions/<id>/" + um arquivo de
// settings em "Claude Extensions Settings/<id>.json". Copiamos o manifest + arquivos do servidor da
// release atual e habilitamos. A CHAVE não é escrita aqui — o servidor a lê do launcher local
// (mcp-server.mjs selfSourceLocalCreds), então não há o problema da chave criptografada do Desktop.
// `sourceDir` = a pasta integrations/ai-tools da release em execução. `repo` opcional: um balde
// específico vira uma extensão distinta (id/nome sufixados) p/ vários baldes coexistirem no Desktop.
export async function setupClaudeDesktopExtension({ sourceDir, baseUrl, repo = '' }) {
  const p = paths();
  const claudeDir = dirname(p.claudeDesktop);
  const manifest = JSON.parse(await readFile(join(sourceDir, 'mcpb', 'manifest.json'), 'utf8'));
  const r = String(repo || '')
    .trim()
    .toLowerCase();
  const scoped = Boolean(r && r !== 'corporate');
  const baseId = `local.mcpb.${slugForId(manifest.author && manifest.author.name)}.${manifest.name}`;
  const id = scoped ? `${baseId}-${r}` : baseId;
  const extDir = join(claudeDir, 'Claude Extensions', id);
  const settingsPath = join(claudeDir, 'Claude Extensions Settings', `${id}.json`);
  const outManifest = { ...manifest };
  if (scoped) {
    outManifest.name = `${manifest.name}-${r}`;
    outManifest.display_name = `${manifest.display_name} — ${r}`;
  }
  await mkdir(join(extDir, 'server'), { recursive: true });
  await writeFile(join(extDir, 'manifest.json'), `${JSON.stringify(outManifest, null, 2)}\n`, 'utf8');
  for (const f of ['baldeClient.mjs', 'mcp-server.mjs', 'tools.mjs']) {
    await copyFile(join(sourceDir, f), join(extDir, 'server', f));
  }
  // settings: habilita + aponta a base URL ao servidor local. SEM chave (auto-lida do launcher);
  // balde_repo só quando escopado a um balde não-default.
  const userConfig = { balde_base_url: baseUrl };
  if (scoped) userConfig.balde_repo = r;
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify({ isEnabled: true, userConfig }, null, 2)}\n`, 'utf8');
  return {
    ok: true,
    configPath: settingsPath,
    extDir,
    restart: `Feche e reabra o Claude Desktop — a extensão "${outManifest.display_name}" foi instalada e ativada (a chave vem do app local; nada a colar).`
  };
}

export async function setupCodex(launcherPath, serverName = 'balde') {
  const p = paths();
  await mkdir(dirname(p.codex), { recursive: true });
  await backupOnce(p.codex);
  let toml = '';
  try {
    toml = await readFile(p.codex, 'utf8');
  } catch {
    toml = '';
  }
  const re = new RegExp('\\[mcp_servers\\.' + serverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]');
  if (re.test(toml)) {
    return {
      ok: true,
      configPath: p.codex,
      restart: `Já estava configurado — o Codex carrega o servidor "${serverName}" na próxima sessão.`
    };
  }
  // strings literais (aspas simples) do TOML: backslashes de caminho Windows sem escaping
  const block = `\n[mcp_servers.${serverName}]\ncommand = 'cmd'\nargs = ['/c', '${launcherPath}']\n`;
  await writeFile(p.codex, toml + block, 'utf8');
  return {
    ok: true,
    configPath: p.codex,
    restart: `Pronto — na próxima sessão do Codex as ferramentas do "${serverName}" estarão disponíveis.`
  };
}

// Claude Code: o escritor sancionado é o próprio CLI (`claude mcp add`, escopo user).
export async function setupClaudeCode(launcherPath, serverName = 'balde') {
  const p = paths();
  if (p.fake) {
    // harness: não invoca o CLI real; simula o efeito no fake home
    const cfg = (await readJsonSafe(p.claudeCode)) || {};
    cfg.mcpServers = { ...(cfg.mcpServers || {}), [serverName]: { command: 'cmd', args: ['/c', launcherPath] } };
    await mkdir(dirname(p.claudeCode), { recursive: true });
    await writeFile(p.claudeCode, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
    return { ok: true, configPath: p.claudeCode, restart: '(fake home) config gravado.' };
  }
  const bin = process.env.CLAUDE_CLI_BIN || 'claude';
  const target = await resolveBin(bin);
  const run = (args) =>
    new Promise((resolve) => {
      let out = '';
      let err = '';
      let child;
      try {
        child = target.needsShell
          ? spawn(/\s/.test(target.path) ? `"${target.path}"` : target.path, args, { shell: true, windowsHide: true })
          : spawn(target.path, args, { windowsHide: true });
      } catch (e) {
        resolve({ ok: false, out: '', err: e.message });
        return;
      }
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 30000);
      child.stdout.on('data', (c) => {
        out += c;
      });
      child.stderr.on('data', (c) => {
        err += c;
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ ok: false, out, err: e.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, out, err });
      });
    });
  await run(['mcp', 'remove', '--scope', 'user', serverName]); // idempotência: remove se existir
  const add = await run(['mcp', 'add', '--scope', 'user', serverName, '--', 'cmd', '/c', launcherPath]);
  if (!add.ok) {
    const line = String(add.err || add.out || 'falha desconhecida')
      .trim()
      .split('\n')
      .slice(-1)[0];
    return { ok: false, error: `claude mcp add falhou: ${line.slice(0, 180)}` };
  }
  return {
    ok: true,
    configPath: p.claudeCode,
    restart: `Pronto — em novas sessões do Claude Code as ferramentas do "${serverName}" aparecem (verifique com /mcp).`
  };
}
