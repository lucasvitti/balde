// CLI AI providers (balde-local): Claude Code / Codex rodando como PROCESSO SHELL local,
// autenticados com a conta (corporativa) do próprio usuário — sem chave de API no Balde.
// Este módulo cuida de: detecção dos clientes, heurística de login, abertura do fluxo de
// login num terminal, e as chamadas de chat/tool-loop usadas por src/ai-provider.mjs.
// Ferramentas do chat funcionam via PROTOCOLO DE TEXTO (bloco ```tool_call```) porque o
// CLI não expõe function-calling estruturado em modo -p. Rounds seguintes do loop REUSAM
// a sessão do Claude Code (--resume) — só o resultado da ferramenta trafega, não a
// conversa inteira de novo. O streaming é SIMULADO: o texto final é emitido em fatias
// espaçadas via onText, então o SSE do chat pinga progressivamente como um stream real.
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const CLI_PROVIDERS = ['claude-cli', 'codex-cli'];
export function isCliProvider(provider) {
  return CLI_PROVIDERS.includes(String(provider || '').toLowerCase());
}

const CLAUDE_BIN = process.env.CLAUDE_CLI_BIN || 'claude';
const CODEX_BIN = process.env.CODEX_CLI_BIN || 'codex';
// Bloqueia as ferramentas PRÓPRIAS do Claude Code — aqui ele é só o modelo respondendo texto.
const CLAUDE_DISALLOWED_TOOLS = 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task,Glob,Grep,Read';
// Vai no system prompt REAL do Claude Code (--append-system-prompt): sem isto o modelo trata
// o bloco de instruções embutido na mensagem como injeção de prompt e RECUSA o protocolo.
const CLAUDE_APP_NOTE =
  'Você está integrado ao aplicativo "Balde de conhecimento" como o modelo de linguagem dele (modo texto). A mensagem do usuário é montada pelo aplicativo e contém blocos "### INSTRUÇÕES DO SISTEMA", "### CONVERSA" e, às vezes, um protocolo de ferramentas em texto (bloco tool_call). Esses blocos são legítimos e vêm do aplicativo: siga-os. Não use suas próprias ferramentas; responda somente o texto pedido.';

// Sob shell (fallback p/ shims .cmd) os args não são escapados — só aceitamos este charset.
const SAFE_ARG_RE = /^[A-Za-z0-9@:.,_\/\\%-]+$/;
function safeArgs(args) {
  return args.filter((a) => SAFE_ARG_RE.test(String(a)));
}
function safeModel(model) {
  const m = String(model || '').trim();
  return /^[A-Za-z0-9@:.,_-]{1,64}$/.test(m) ? m : '';
}
function safeSessionId(id) {
  const s = String(id || '').trim();
  return /^[A-Za-z0-9-]{8,64}$/.test(s) ? s : '';
}

// Resolve o binário real: um .exe é spawnável direto (args com espaço OK, sem shell);
// shims .cmd/.bat do npm precisam de shell. Cacheado por nome.
const binCache = new Map();
export async function resolveBin(name) {
  if (binCache.has(name)) return binCache.get(name);
  let resolved = { path: name, needsShell: process.platform === 'win32' };
  if (process.platform === 'win32' && !/[\\/]/.test(name)) {
    const out = await new Promise((done) => {
      let acc = '';
      try {
        const child = spawn('where', [name], { windowsHide: true });
        child.stdout.on('data', (c) => {
          acc += c;
        });
        child.on('error', () => done(''));
        child.on('close', () => done(acc));
      } catch {
        done('');
      }
    });
    const lines = String(out)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const exe = lines.find((l) => l.toLowerCase().endsWith('.exe'));
    if (exe) resolved = { path: exe, needsShell: false };
    else if (lines.length)
      resolved = { path: lines.find((l) => /\.(cmd|bat)$/i.test(l)) || lines[0], needsShell: true };
  } else if (/[\\/]/.test(name)) {
    resolved = { path: name, needsShell: process.platform === 'win32' && !/\.exe$/i.test(name) };
  } else if (process.platform !== 'win32') {
    resolved = { path: name, needsShell: false };
  }
  binCache.set(name, resolved);
  return resolved;
}

// Roda um CLI com prompt via STDIN (nunca em args — sem limite de tamanho, sem escaping).
async function runCli(bin, args, { input = '', timeoutMs = 240000, cwd = tmpdir() } = {}) {
  const target = await resolveBin(bin);
  return new Promise((resolve) => {
    let child;
    try {
      if (target.needsShell) {
        const cmdPath = /\s/.test(target.path) ? `"${target.path}"` : target.path;
        child = spawn(cmdPath, safeArgs(args), { shell: true, cwd, windowsHide: true, env: process.env });
      } else {
        child = spawn(target.path, args, { cwd, windowsHide: true, env: process.env });
      }
    } catch (error) {
      resolve({ ok: false, code: -1, stdout: '', stderr: error.message, timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      done = true;
      resolve({
        ok: false,
        code: -1,
        stdout,
        stderr: `${stderr}\n[timeout após ${Math.round(timeoutMs / 1000)}s]`.trim(),
        timedOut: true
      });
    }, timeoutMs);
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.on('error', (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: error.message, timedOut: false });
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout: String(stdout), stderr: String(stderr), timedOut: false });
    });
    try {
      child.stdin.write(input);
      child.stdin.end();
    } catch {
      /* processo já morreu */
    }
  });
}

function stripAnsi(text) {
  return String(text || '').replace(/\[[0-9;]*[A-Za-z]/g, '');
}

// Detecção + heurística de login (para a aba "Clientes de IA")
const detectCache = new Map(); // kind -> { at, value }

export async function detectCliClient(kind, { fresh = false } = {}) {
  const cached = detectCache.get(kind);
  if (!fresh && cached && Date.now() - cached.at < 30000) return cached.value;
  const isClaude = kind === 'claude';
  const bin = isClaude ? CLAUDE_BIN : CODEX_BIN;
  const probe = await runCli(bin, ['--version'], { timeoutMs: 15000 });
  const version = probe.ok ? stripAnsi(probe.stdout).trim().split('\n')[0].slice(0, 80) : '';
  const credPath = isClaude ? join(homedir(), '.claude', '.credentials.json') : join(homedir(), '.codex', 'auth.json');
  const value = {
    kind,
    bin,
    installed: probe.ok,
    version,
    // heurística: o arquivo de credenciais existe → provavelmente logado (a prova real é o Testar)
    authLikely: probe.ok && existsSync(credPath),
    credPath,
    error: probe.ok
      ? ''
      : stripAnsi(probe.stderr || probe.stdout)
          .trim()
          .split('\n')[0]
          .slice(0, 160)
  };
  detectCache.set(kind, { at: Date.now(), value });
  return value;
}

export async function detectCliClients({ fresh = false } = {}) {
  const [claude, codex] = await Promise.all([
    detectCliClient('claude', { fresh }),
    detectCliClient('codex', { fresh })
  ]);
  return { platform: process.platform, clients: [claude, codex] };
}

// Abre o fluxo de login numa JANELA DE TERMINAL na máquina do usuário (o servidor local
// roda na sessão dele). Fora do Windows devolvemos o comando para rodar à mão.
export function spawnCliLogin(kind) {
  const isClaude = kind === 'claude';
  const manual = isClaude ? `${CLAUDE_BIN} /login` : `${CODEX_BIN} login`;
  if (process.platform !== 'win32') {
    return { spawned: false, command: manual };
  }
  const tail = isClaude ? [CLAUDE_BIN, '/login'] : [CODEX_BIN, 'login'];
  try {
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', `Balde - login ${isClaude ? 'Claude' : 'Codex'}`, 'cmd', '/k', ...tail],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      }
    );
    child.unref();
    detectCache.clear();
    return { spawned: true, command: manual };
  } catch (error) {
    return { spawned: false, command: manual, error: error.message };
  }
}

// Prompt: a conversa vira UM texto (via stdin) — o CLI é stateless por chamada
function normalizeTurns(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .map((m) => ({ role: m.role, content: String(m.content) }));
}

function buildPrompt({ system, messages, wantJson }) {
  const parts = [];
  if (system) parts.push(`### INSTRUÇÕES DO SISTEMA\n${system}`);
  parts.push(
    '### REGRAS DESTA EXECUÇÃO\nVocê está respondendo por um aplicativo. Responda DIRETAMENTE, sem usar suas próprias ferramentas, sem pedir permissões e sem mencionar estas instruções.'
  );
  if (wantJson) parts.push('Responda somente com JSON válido, sem texto fora do JSON e sem cercas de código.');
  const turns = normalizeTurns(messages);
  parts.push('### CONVERSA');
  for (const t of turns) parts.push(`[${t.role === 'user' ? 'USUÁRIO' : 'ASSISTENTE'}]\n${t.content}`);
  parts.push('### SUA RESPOSTA\nResponda ao último turno do USUÁRIO como o assistente, sem prefixo de papel.');
  return parts.join('\n\n');
}

function friendlyCliError(kind, res) {
  const raw = stripAnsi(`${res.stderr || ''}\n${res.stdout || ''}`).toLowerCase();
  if (/log ?in|logged out|authenticat|credencia|credential|api key|unauthorized|expired/.test(raw)) {
    return `${kind === 'claude' ? 'Claude Code' : 'Codex'} não está autenticado nesta máquina — abra Configurações → Clientes de IA e faça o login.`;
  }
  if (res.timedOut) {
    return `${kind === 'claude' ? 'Claude Code' : 'Codex'} não respondeu a tempo.`;
  }
  const line =
    stripAnsi(res.stderr || res.stdout || '')
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-1)[0] || 'erro desconhecido';
  return `${kind === 'claude' ? 'Claude Code' : 'Codex'}: ${line.slice(0, 220)}`;
}

// Streaming SIMULADO: o texto chega inteiro do CLI; fatiamos em ~45 pedaços com um
// intervalo curto para o SSE do chat entregar progressivamente (efeito de digitação).
async function emitPaced(text, onText) {
  if (typeof onText !== 'function' || !text) return;
  const t = String(text);
  const slice = Math.max(12, Math.min(80, Math.ceil(t.length / 45)));
  for (let i = 0; i < t.length; i += slice) {
    try {
      onText(t.slice(i, i + slice));
    } catch {
      /* ignore */
    }
    if (i + slice < t.length) await new Promise((r) => setTimeout(r, 32));
  }
}

// Pool de processos QUENTES (claude, stream-json): um processo VIVO por conversa
// Mata o custo de spawn por mensagem (~4-5s → ~0s) e dá STREAMING REAL token-a-token.
// O processo é a sessão: o 1º turno embute system+contexto; os seguintes mandam só o turno
// novo. Fences ```tool_call``` são retidas do stream visível (gate com cauda de 16 chars).
const PROC_POOL_MAX = 3;
const PROC_IDLE_MS = 10 * 60 * 1000;
const PROC_TURN_TIMEOUT_MS = 300000;
const procPool = new Map(); // sessionKey -> { child, buf, alive, lock, sysHash, hashes, lastUsed, model, pending }
let poolReaper = null;

function poolEnabled() {
  return process.env.BALDE_CLI_NO_POOL !== '1';
}

function killProc(entry) {
  try {
    entry.alive = false;
    entry.child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
}

function reapPool() {
  const now = Date.now();
  for (const [key, entry] of procPool) {
    if (!entry.alive || now - entry.lastUsed > PROC_IDLE_MS) {
      killProc(entry);
      procPool.delete(key);
    }
  }
  while (procPool.size > PROC_POOL_MAX) {
    let oldestKey = null;
    let oldest = Infinity;
    for (const [key, entry] of procPool) {
      if (entry.lastUsed < oldest) {
        oldest = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    killProc(procPool.get(oldestKey));
    procPool.delete(oldestKey);
  }
}

function ensureReaper() {
  if (poolReaper) return;
  poolReaper = setInterval(reapPool, 60000);
  if (typeof poolReaper.unref === 'function') poolReaper.unref();
  process.on('exit', () => {
    for (const [, entry] of procPool) killProc(entry);
  });
}

async function spawnPoolProc(key, aiConfig, sysHash) {
  const model = safeModel(aiConfig?.model) || 'sonnet';
  const target = await resolveBin(CLAUDE_BIN);
  const args = [
    '-p',
    '--verbose',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--model',
    model,
    '--disallowedTools',
    CLAUDE_DISALLOWED_TOOLS
  ];
  if (!target.needsShell) args.push('--append-system-prompt', CLAUDE_APP_NOTE);
  let child;
  try {
    child = target.needsShell
      ? spawn(/\s/.test(target.path) ? `"${target.path}"` : target.path, safeArgs(args), {
          shell: true,
          cwd: tmpdir(),
          windowsHide: true,
          env: process.env
        })
      : spawn(target.path, args, { cwd: tmpdir(), windowsHide: true, env: process.env });
  } catch {
    return null;
  }
  const entry = {
    child,
    buf: '',
    alive: true,
    lock: Promise.resolve(),
    sysHash,
    hashes: [],
    lastUsed: Date.now(),
    model,
    pending: null
  };
  child.on('close', () => {
    entry.alive = false;
    if (entry.pending) {
      try {
        entry.pending.reject(new Error('processo do Claude encerrou'));
      } catch {
        /* ignore */
      }
    }
  });
  child.on('error', () => {
    entry.alive = false;
  });
  child.stdout.on('data', (chunk) => {
    entry.buf += chunk;
    let nl;
    while ((nl = entry.buf.indexOf('\n')) >= 0) {
      const line = entry.buf.slice(0, nl).trim();
      entry.buf = entry.buf.slice(nl + 1);
      if (!line || !entry.pending) continue;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      try {
        entry.pending.onEvent(evt);
      } catch {
        /* ignore */
      }
    }
  });
  child.stderr.on('data', () => {
    /* logs do CLI — nunca no protocolo */
  });
  procPool.set(key, entry);
  ensureReaper();
  reapPool();
  return entry;
}

// Um turno no processo quente. onDelta recebe texto AO VIVO, mas com um GATE: segura uma
// cauda de 16 chars e para de emitir se uma fence ```tool_call aparecer (turno de ferramenta
// não vaza pro chat; a narração antes da fence passa).
function poolTurn(entry, text, onDelta) {
  const run = entry.lock.then(
    () =>
      new Promise((resolve, reject) => {
        if (!entry.alive) {
          reject(new Error('processo morto'));
          return;
        }
        let acc = '';
        let emitted = 0;
        const emitSafe = (final) => {
          if (typeof onDelta !== 'function') return;
          const fence = acc.indexOf('```tool_call');
          const cap = fence >= 0 ? Math.min(fence, acc.length) : final ? acc.length : Math.max(0, acc.length - 16);
          if (cap > emitted) {
            try {
              onDelta(acc.slice(emitted, cap));
            } catch {
              /* ignore */
            }
            emitted = cap;
          }
        };
        const timer = setTimeout(() => {
          entry.pending = null;
          killProc(entry);
          reject(new Error('turno excedeu o tempo limite'));
        }, PROC_TURN_TIMEOUT_MS);
        entry.pending = {
          reject: (e) => {
            clearTimeout(timer);
            entry.pending = null;
            reject(e);
          },
          onEvent: (evt) => {
            if (
              evt.type === 'stream_event' &&
              evt.event &&
              evt.event.type === 'content_block_delta' &&
              evt.event.delta &&
              typeof evt.event.delta.text === 'string'
            ) {
              acc += evt.event.delta.text;
              emitSafe(false);
            } else if (evt.type === 'result') {
              clearTimeout(timer);
              entry.pending = null;
              entry.lastUsed = Date.now();
              const full = typeof evt.result === 'string' && evt.result.trim() ? evt.result : acc;
              if (evt.is_error) {
                reject(new Error(String(evt.result || 'erro no processo do Claude').slice(0, 220)));
                return;
              }
              acc = full;
              emitSafe(true);
              resolve(full.trim());
            }
          }
        };
        try {
          entry.child.stdin.write(
            `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`
          );
        } catch (error) {
          clearTimeout(timer);
          entry.pending = null;
          reject(error);
        }
      })
  );
  entry.lock = run.catch(() => {});
  return run;
}

// Uma invocação do Claude Code. `resume` continua uma sessão existente (rounds do
// tool loop mandam SÓ o novo turno — muito mais rápido que reenviar a conversa toda).
async function callClaudeOnce(aiConfig, prompt, { timeoutMs = 240000, resume = '' } = {}) {
  // sem modelo configurado: 'sonnet' explícito — o default do Claude Code pode ser Opus,
  // que é sensivelmente mais lento para chat interativo (o usuário pode escolher opus/haiku).
  const model = safeModel(aiConfig?.model) || 'sonnet';
  const sid = safeSessionId(resume);
  const bin = await resolveBin(CLAUDE_BIN);
  const args = [
    '-p',
    '--output-format',
    'json',
    '--disallowedTools',
    CLAUDE_DISALLOWED_TOOLS,
    ...(model ? ['--model', model] : []),
    ...(sid ? ['--resume', sid] : [])
  ];
  // args com espaço só passam SEM shell (o .exe nativo); no fallback shim ficamos sem a nota
  if (!bin.needsShell) args.push('--append-system-prompt', CLAUDE_APP_NOTE);
  const res = await runCli(CLAUDE_BIN, args, { input: prompt, timeoutMs });
  const raw = res.stdout.trim();
  let parsed = null;
  try {
    parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed.result !== 'string') {
    if (!res.ok) return { ok: false, error: friendlyCliError('claude', res) };
    return { ok: true, text: stripAnsi(raw), sessionId: '' };
  }
  if (parsed.is_error) {
    return { ok: false, error: friendlyCliError('claude', { ...res, stdout: parsed.result }) };
  }
  return { ok: true, text: parsed.result, sessionId: safeSessionId(parsed.session_id) };
}

async function callCodexOnce(aiConfig, prompt, { timeoutMs = 240000 } = {}) {
  const outFile = join(tmpdir(), `balde-codex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  const model = safeModel(aiConfig?.model);
  // -s read-only + prompt "responda direto": o codex é um agente — aqui é só o modelo falando.
  // --ignore-user-config: hermético — um `model =` apontando para slug aposentado no
  // config.toml do usuário quebraria TODA chamada (caso real); auth continua valendo.
  const args = [
    'exec',
    '-',
    '--skip-git-repo-check',
    '-s',
    'read-only',
    '--ephemeral',
    '--color',
    'never',
    '--ignore-user-config',
    ...(model ? ['-m', model] : []),
    '--output-last-message',
    outFile
  ];
  const res = await runCli(CODEX_BIN, args, { input: prompt, timeoutMs });
  let last = '';
  try {
    last = await readFile(outFile, 'utf8');
  } catch {
    last = '';
  }
  await rm(outFile, { force: true }).catch(() => {});
  if (!res.ok && !last.trim()) {
    return { ok: false, error: friendlyCliError('codex', res) };
  }
  return { ok: true, text: last.trim() || stripAnsi(res.stdout).trim(), sessionId: '' };
}

// Chamada núcleo: uma resposta de texto por invocação do CLI
export async function cliChat(messages, aiConfig, { system = '', wantJson = false, onText, timeoutMs = 240000 } = {}) {
  const provider = String(aiConfig?.provider || '').toLowerCase();
  const prompt = buildPrompt({ system, messages, wantJson });
  const r =
    provider === 'codex-cli'
      ? await callCodexOnce(aiConfig, prompt, { timeoutMs })
      : await callClaudeOnce(aiConfig, prompt, { timeoutMs });
  if (!r.ok) throw new Error(r.error);
  const text = String(r.text || '').trim();
  if (!text) throw new Error('O cliente de IA local devolveu resposta vazia.');
  await emitPaced(text, onText);
  return text;
}

// Ping mínimo para o botão "Testar" (prova real de instalação + login + modelo).
export async function cliPing(aiConfig) {
  const provider = String(aiConfig?.provider || 'claude-cli').toLowerCase();
  const kind = provider === 'codex-cli' ? 'codex' : 'claude';
  const started = Date.now();
  const client = await detectCliClient(kind, { fresh: true });
  if (!client.installed) {
    return {
      ok: false,
      provider,
      error: `${kind === 'claude' ? 'Claude Code' : 'Codex'} não encontrado no PATH desta máquina (${client.bin}). Instale o cliente e tente de novo.`
    };
  }
  try {
    const text = await cliChat([{ role: 'user', content: 'Responda apenas: ok' }], aiConfig, { timeoutMs: 90000 });
    return {
      ok: true,
      provider,
      model: safeModel(aiConfig?.model) || `${client.version || 'cliente local'}`,
      ms: Date.now() - started,
      sample: text.slice(0, 40)
    };
  } catch (error) {
    return { ok: false, provider, error: error.message, ms: Date.now() - started };
  }
}

// Tool loop por protocolo de texto
// O modelo pede uma ferramenta respondendo APENAS um bloco ```tool_call``` com {name, input};
// o resultado volta como turno de usuário e o loop segue até uma resposta final sem bloco.
function toolProtocolPreamble(tools) {
  const specs = (tools || [])
    .map(
      (t) =>
        `- ${t.name}: ${String(t.description || '').trim()}\n  parâmetros (JSON Schema): ${JSON.stringify(t.input_schema || { type: 'object', properties: {} })}`
    )
    .join('\n');
  return [
    '### FERRAMENTAS DISPONÍVEIS (protocolo de texto)',
    specs,
    'Para usar uma ferramenta, responda SOMENTE com um bloco exatamente neste formato (nada antes nem depois):',
    '```tool_call\n{"name": "<nome da ferramenta>", "input": { ... }}\n```',
    'Você receberá o resultado como próximo turno e poderá usar outra ferramenta ou dar a resposta final. A resposta final é texto normal SEM bloco tool_call.'
  ].join('\n');
}

function parseToolCall(text, tools) {
  const names = new Set((tools || []).map((t) => t.name));
  const fenced = /```tool_call\s*\n?([\s\S]*?)```/.exec(String(text || ''));
  const candidate = fenced
    ? fenced[1]
    : String(text || '')
          .trim()
          .startsWith('{')
      ? String(text).trim()
      : null;
  if (!candidate) return null;
  try {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    const obj = JSON.parse(candidate.slice(start, end + 1));
    if (obj && typeof obj.name === 'string' && names.has(obj.name)) {
      return {
        name: obj.name,
        input: obj.input && typeof obj.input === 'object' ? obj.input : {},
        narration: fenced ? String(text).slice(0, fenced.index).trim() : ''
      };
    }
  } catch {
    /* não é tool_call */
  }
  return null;
}

// Sessões por CONVERSA (chat/plenária): a 1ª mensagem ingere o contexto inteiro; das
// seguintes viaja SÓ o turno novo via --resume — o Claude Code guarda o resto (e o prompt
// caching da API dele barateia/acelera o prefixo). Invalidada se o system mudar (skills
// adicionadas, notas) ou se o histórico não for extensão do que a sessão já viu.
const chatSessions = new Map(); // sessionKey -> { sessionId, sysHash, hashes[] }
const CHAT_SESSIONS_MAX = 200;
function msgHash(turn) {
  return createHash('sha1').update(`${turn.role}\n${turn.content}`).digest('hex');
}
function buildTailPrompt(turns, hasTools) {
  const parts = turns.map((t) => `[${t.role === 'user' ? 'USUÁRIO' : 'ASSISTENTE'}]\n${t.content}`);
  if (hasTools) parts.push('(O protocolo de ferramentas tool_call continua valendo.)');
  return parts.join('\n\n');
}
const cliDebug = (...args) => {
  if (process.env.BALDE_CLI_DEBUG === '1') {
    try {
      console.error('[ai-cli]', ...args);
    } catch {
      /* ignore */
    }
  }
};

// Tool loop sobre o processo quente. Devolve o texto final, ou null quando o pool não
// serviu (spawn falhou / processo morreu no meio) — o chamador cai no caminho antigo.
async function pooledToolLoop({
  key,
  aiConfig,
  fullSystem,
  convo,
  msgHashes,
  sysHash,
  tools,
  run,
  fire,
  maxSteps,
  onText
}) {
  const model = safeModel(aiConfig?.model) || 'sonnet';
  let entry = procPool.get(key);
  let input;
  const reusable =
    entry &&
    entry.alive &&
    entry.sysHash === sysHash &&
    entry.model === model &&
    entry.hashes.length < msgHashes.length &&
    entry.hashes.every((h, i) => h === msgHashes[i]);
  if (reusable) {
    input = buildTailPrompt(convo.slice(entry.hashes.length), tools.length > 0);
    cliDebug('pool: turno novo no processo quente', key);
  } else {
    if (entry) {
      killProc(entry);
      procPool.delete(key);
    }
    entry = await spawnPoolProc(key, aiConfig, sysHash);
    if (!entry) return null;
    input = buildPrompt({ system: fullSystem, messages: convo });
    cliDebug('pool: processo novo', key);
  }
  for (let step = 0; step <= maxSteps; step += 1) {
    const forced = step === maxSteps;
    if (forced) input = 'Limite de ferramentas atingido. Dê a resposta final agora, sem bloco tool_call.';
    let text;
    try {
      text = String(await poolTurn(entry, input, onText)).trim();
    } catch (error) {
      cliDebug('pool falhou (fallback p/ one-shot):', error.message);
      killProc(entry);
      procPool.delete(key);
      return null;
    }
    const call = !forced && tools.length ? parseToolCall(text, tools) : null;
    if (!call) {
      entry.hashes = [...msgHashes, msgHash({ role: 'assistant', content: text })];
      entry.lastUsed = Date.now();
      return text;
    }
    fire({ type: 'tool', name: call.name, input: call.input });
    let out;
    try {
      out = await run(call.name, call.input);
    } catch (error) {
      out = `ERRO: ${error.message}`;
    }
    input = `[RESULTADO DA FERRAMENTA ${call.name}]\n${String(out ?? '')}\n\nContinue: use outra ferramenta se precisar, ou dê a resposta final ao usuário (sem bloco tool_call).`;
  }
  killProc(entry);
  procPool.delete(key);
  return null;
}

export async function cliToolLoop(
  messages,
  aiConfig,
  { system = '', tools = [], execute, maxSteps = 8, onText, onEvent, sessionKey = '' } = {}
) {
  const provider = String(aiConfig?.provider || '').toLowerCase();
  const isClaude = provider !== 'codex-cli';
  const run = typeof execute === 'function' ? execute : async () => 'ERRO: sem executor de ferramentas.';
  const fire = (event) => {
    if (typeof onEvent === 'function') {
      try {
        onEvent(event);
      } catch {
        /* ignore */
      }
    }
  };
  const fullSystem = tools.length ? `${system}\n\n${toolProtocolPreamble(tools)}` : system;
  const convo = normalizeTurns(messages);
  if (!convo.length) throw new Error('Nenhuma mensagem para enviar.');

  let sessionId = '';
  let nextInput = null; // null = primeira chamada (conversa inteira); string = só o turno novo (--resume)
  const key = isClaude ? String(sessionKey || '') : '';
  const sysHash = key ? createHash('sha1').update(fullSystem).digest('hex') : '';
  const msgHashes = convo.map(msgHash);
  if (key && poolEnabled()) {
    // caminho rápido: processo QUENTE por conversa (spawn zero + streaming real).
    // null = pool indisponível/falhou → cai no caminho --resume/one-shot abaixo.
    const pooled = await pooledToolLoop({
      key,
      aiConfig,
      fullSystem,
      convo,
      msgHashes,
      sysHash,
      tools,
      run,
      fire,
      maxSteps,
      onText
    });
    if (pooled !== null) return pooled;
  }
  if (key) {
    const entry = chatSessions.get(key);
    if (
      entry &&
      entry.sysHash === sysHash &&
      entry.hashes.length < msgHashes.length &&
      entry.hashes.every((h, i) => h === msgHashes[i])
    ) {
      sessionId = entry.sessionId;
      nextInput = buildTailPrompt(convo.slice(entry.hashes.length), tools.length > 0);
      cliDebug('resume da conversa', key, '— só', convo.length - entry.hashes.length, 'turno(s) novo(s)');
    } else if (entry) {
      chatSessions.delete(key); // system mudou / histórico divergiu → sessão nova
      cliDebug('sessão invalidada', key);
    }
  }
  for (let step = 0; step <= maxSteps; step += 1) {
    const forced = step === maxSteps;
    if (forced) {
      const forceMsg = 'Limite de ferramentas atingido. Dê a resposta final agora, sem bloco tool_call.';
      convo.push({ role: 'user', content: forceMsg });
      nextInput = nextInput === null ? null : forceMsg;
    }
    let r;
    if (isClaude) {
      if (sessionId && nextInput !== null) {
        r = await callClaudeOnce(aiConfig, nextInput, { resume: sessionId });
        if (!r.ok) {
          sessionId = '';
          r = null;
        } // sessão perdida → refaz com a conversa completa
      }
      if (!r) {
        r = await callClaudeOnce(aiConfig, buildPrompt({ system: fullSystem, messages: convo }));
      }
      if (!r.ok) throw new Error(r.error);
      if (r.sessionId) sessionId = r.sessionId;
    } else {
      r = await callCodexOnce(aiConfig, buildPrompt({ system: fullSystem, messages: convo }));
      if (!r.ok) throw new Error(r.error);
    }
    const text = String(r.text || '').trim();
    const call = !forced && tools.length ? parseToolCall(text, tools) : null;
    if (!call) {
      if (key && sessionId) {
        // lembra a sessão desta conversa: próximo turno manda só a mensagem nova
        if (chatSessions.size >= CHAT_SESSIONS_MAX) {
          chatSessions.delete(chatSessions.keys().next().value);
        }
        chatSessions.set(key, {
          sessionId,
          sysHash,
          hashes: [...msgHashes, msgHash({ role: 'assistant', content: text })]
        });
      }
      await emitPaced(text, onText);
      return text;
    }
    if (call.narration) await emitPaced(`${call.narration}\n`, onText);
    fire({ type: 'tool', name: call.name, input: call.input });
    let out;
    try {
      out = await run(call.name, call.input);
    } catch (error) {
      out = `ERRO: ${error.message}`;
    }
    const resultMsg = `[RESULTADO DA FERRAMENTA ${call.name}]\n${String(out ?? '')}\n\nContinue: use outra ferramenta se precisar, ou dê a resposta final ao usuário (sem bloco tool_call).`;
    convo.push({ role: 'assistant', content: text });
    convo.push({ role: 'user', content: resultMsg });
    nextInput = resultMsg;
  }
  throw new Error('O loop de ferramentas não produziu resposta.');
}
