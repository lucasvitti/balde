import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const json = async (path, value) => {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
};
async function freePort() {
  const socket = createServer();
  await new Promise((ok, no) => {
    socket.once('error', no);
    socket.listen(0, '127.0.0.1', ok);
  });
  const port = socket.address().port;
  await new Promise((ok) => socket.close(ok));
  return port;
}

export async function fixture(output, name, admin = false) {
  const dir = join(output, name),
    corpus = join(dir, 'corpus'),
    home = join(dir, 'home');
  const repo = join(corpus, 'repos', 'corporate');
  for (const p of [
    home,
    join(home, 'temp'),
    join(repo, 'skills', 'audit-skill'),
    join(repo, 'commons'),
    join(corpus, 'groups')
  ])
    await mkdir(p, { recursive: true });
  await json(join(repo, 'balde-repo.json'), {
    format: 'balde-repo/1',
    name: 'corporate',
    titulo: 'Audit corporate',
    profile: 'full',
    access: {
      open: true,
      owners: ['owner@example.test'],
      adminGroups: [],
      curators: ['curator@example.test'],
      curatorGroups: [],
      members: [],
      groups: []
    }
  });
  const privateRepo = join(corpus, 'repos', 'restricted');
  await mkdir(join(privateRepo, 'skills'), { recursive: true });
  await mkdir(join(privateRepo, 'commons'), { recursive: true });
  await json(join(privateRepo, 'balde-repo.json'), {
    format: 'balde-repo/1',
    name: 'restricted',
    titulo: 'Audit restricted',
    profile: 'light',
    access: {
      open: false,
      owners: ['owner@example.test'],
      adminGroups: [],
      curators: [],
      curatorGroups: [],
      members: [],
      groups: []
    }
  });
  await json(join(corpus, 'repos.json'), {
    version: 1,
    repos: [{ name: 'corporate', titulo: 'Audit corporate', groups: [], profile: 'full' }]
  });
  const markdown =
    '---\ntitle: Audit skill\nstatus: rascunho\nowner: owner@example.test\nversion: 1.0.0\n---\n\n# Audit skill\n\nSynthetic content for a disposable test.\n';
  await writeFile(join(repo, 'skills', 'audit-skill', 'SKILL.md'), markdown);
  const port = await freePort();
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT'])
    if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, {
    USERPROFILE: home,
    HOME: home,
    APPDATA: join(home, 'Roaming'),
    LOCALAPPDATA: join(home, 'Local'),
    TEMP: join(home, 'temp'),
    TMP: join(home, 'temp'),
    CORPUS_ROOT: corpus,
    PORT: String(port),
    DEV_FAKE_EMAIL: 'curator@example.test',
    DEV_FAKE_NAME: 'Audit curator',
    BALDE_GROUPS_FROM_CORPUS: '1',
    BALDE_SHELL_EXE: join(dir, 'not-a-real-shell.exe'),
    BALDE_USER_CONFIG: join(home, 'settings.json'),
    BALDE_MCP_FAKE_HOME: home,
    FEEDBACK_WATCH: '0',
    AI_MODE: 'none',
    AI_REVIEW_ON_SKILLS_LOAD: '0',
    BALDE_READONLY_CORPUS: admin ? '0' : '1',
    BALDE_SWEEP: admin ? '1' : '0',
    QUEUE_ROOT: admin ? join(dir, 'admin', 'queue') : join(dir, 'exchange', 'curator', 'queue'),
    EXCHANGE_ROOT: join(dir, 'exchange'),
    USERS_ROOT: join(home, 'users'),
    LOGS_ROOT: join(home, 'logs'),
    USAGE_ROOT: join(home, 'usage'),
    PLENARIAS_ROOT: join(home, 'plenarias'),
    BALDE_CACHE_ROOT: join(home, 'cache'),
    GIT_LEDGER_ROOT: join(home, 'ledger'),
    API_KEY_STORE_PATH: join(home, 'api-key.enc.json'),
    OPENAI_API_KEY_ENC_PATH: join(home, 'absent-openai-key'),
    BALDE_WEB_SESSION_KEY: randomBytes(32).toString('hex'),
    API_KEY: randomBytes(24).toString('hex'),
    BALDE_QUEUE_TICK_MS: '1000',
    BALDE_IMPORT_GRACE_MS: '240000',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(home, 'empty-gitconfig'),
    GIT_TERMINAL_PROMPT: '0'
  });
  await writeFile(env.GIT_CONFIG_GLOBAL, '');
  return { name, dir, corpus, home, repo, port, env, url: `http://127.0.0.1:${port}`, markdown };
}

export async function start(f, runtime, executable = process.execPath) {
  // Node's filesystem permission fence also protects the original release. Git
  // subprocesses operate only on roots explicitly redirected into this fixture.
  const child = spawn(
    executable,
    [
      '--permission',
      '--allow-fs-read=*',
      `--allow-fs-write=${f.dir}`,
      '--allow-child-process',
      join(runtime, 'server.js')
    ],
    { cwd: f.dir, env: f.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  f.child = child;
  f.logs = '';
  child.stdout.on('data', (x) => {
    f.logs += x;
  });
  child.stderr.on('data', (x) => {
    f.logs += x;
  });
  child.on('error', (e) => {
    f.logs += String(e);
  });
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Runtime exited ${child.exitCode}: ${f.logs}`);
    try {
      const r = await fetch(f.url + '/api/health', { signal: AbortSignal.timeout(500) });
      if (r.ok) {
        await delay(1000);
        return;
      }
    } catch {}
    await delay(150);
  }
  throw new Error('Startup timed out: ' + f.logs);
}
export async function request(f, path, { method = 'GET', headers = {}, body } = {}) {
  const r = await fetch(f.url + path, {
    method,
    headers: {
      'x-balde-session': f.env.BALDE_WEB_SESSION_KEY,
      ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 300);
  }
  return { status: r.status, headers: Object.fromEntries(r.headers), data };
}

export async function stop(f) {
  if (!f.child || f.child.exitCode !== null || f.child.signalCode !== null) return;
  f.child.kill();
  await new Promise((resolve) => f.child.once('exit', resolve));
}
