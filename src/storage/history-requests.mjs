import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { atomicJson, containedPath } from './atomic-files.mjs';

const execute = promisify(execFile);
const pendingDirectory = (root) => join(dirname(root), '.balde', 'commits');
const queues = new Map();

export async function serializeHistory(root, work) {
  const previous = queues.get(root) || Promise.resolve();
  const pending = previous.catch(() => {}).then(work);
  queues.set(root, pending);
  try {
    return await pending;
  } finally {
    if (queues.get(root) === pending) queues.delete(root);
  }
}

async function contentIdentity(root, paths) {
  const files = [];
  async function visit(path) {
    const target = containedPath(root, path);
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      files.push({ path, missing: true });
      return;
    }
    if (info.isSymbolicLink()) throw new Error(`Link não permitido no histórico: ${path}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(target)).sort()) {
        if (name !== '.git' && !name.startsWith('.balde')) await visit(`${path}/${name}`);
      }
    } else {
      files.push({
        path,
        sha256: createHash('sha256')
          .update(await readFile(target))
          .digest('hex')
      });
    }
  }
  for (const path of [...paths].sort()) await visit(path);
  return files;
}

export async function recordHistoryRequest(root, message, actor, paths) {
  if (!Array.isArray(paths) || !paths.length)
    throw new Error('O histórico exige os caminhos alterados explicitamente.');
  const normalized = [...new Set(paths.map((path) => String(path).replaceAll('\\', '/')))];
  const request = {
    format: 'balde-commit/2',
    id: randomUUID(),
    root: basename(root),
    message,
    author: actor,
    paths: normalized,
    files: await contentIdentity(root, normalized),
    at: new Date().toISOString(),
    status: 'pending',
    attempts: 0
  };
  await atomicJson(join(pendingDirectory(root), `${request.id}.json`), request);
  return request;
}

// Transição da 2.0.15: o pedido balde-commit/1 não traz hashes. Como na 2.0.15, ele espera chegarem os
// arquivos que cita (o OneDrive preserva a data de modificação) e, passadas duas horas, registra o que
// chegou. Uma mudança pendente posterior ao pedido não vai para o autor dele: pede revisão.
const LEGACY_FORMAT = 'balde-commit/1';
const LEGACY_CLOCK_SKEW_MS = 2 * 60_000;
const LEGACY_GIVE_UP_MS = 2 * 3600_000;

// A data de uma pasta é a da chegada nesta máquina, não a da mudança: só os arquivos contam.
async function newestFileChange(target) {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isDirectory()) return info.mtimeMs;
  let newest = null;
  for (const name of await readdir(target)) {
    if (name === '.git' || name.startsWith('.balde')) continue;
    const changed = await newestFileChange(join(target, name));
    if (changed !== null && (newest === null || changed > newest)) newest = changed;
  }
  return newest;
}

async function checkLegacyRequest(root, request, env) {
  const at = Date.parse(request.at || '');
  if (!Number.isFinite(at)) throw new Error('Pedido legado sem data: requer revisão manual.');
  const settled = Date.now() - at >= LEGACY_GIVE_UP_MS;
  for (const path of request.paths) {
    const changed = await newestFileChange(containedPath(root, path));
    if (settled || (changed !== null && changed >= at - LEGACY_CLOCK_SKEW_MS)) continue;
    const deletion =
      changed === null &&
      (await execute('git', ['-C', root, 'ls-files', '--', path], { env, windowsHide: true })).stdout.trim();
    if (!deletion) throw new Error('Aguardando os arquivos do pedido legado chegarem pelo OneDrive.');
  }
  const { stdout } = await execute(
    'git',
    ['-C', root, 'status', '--porcelain', '-z', '--untracked-files=all', '--', ...request.paths],
    { env, windowsHide: true }
  );
  const entries = stdout.split('\0');
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.length < 4) continue;
    if (/^[RC]/.test(entry)) index++; // renomeação já no index: o caminho de origem vem a seguir
    const changed = await newestFileChange(containedPath(root, entry.slice(3)));
    if (changed !== null && changed > at + LEGACY_CLOCK_SKEW_MS)
      throw new Error(
        'Pedido legado: os arquivos mudaram depois do pedido; requer revisão de autoria antes de registrar.'
      );
  }
}

async function hasChanges(root, paths, env) {
  try {
    await execute('git', ['-C', root, 'diff', '--cached', '--quiet', '--', ...paths], { env, windowsHide: true });
    return false;
  } catch (error) {
    if (error.code === 1) return true;
    throw error;
  }
}

export async function flushHistoryRequests(root, gitEnvironment) {
  const directory = pendingDirectory(root);
  let names;
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  let completed = 0;
  for (const name of names) {
    const path = join(directory, name);
    let request;
    try {
      request = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      continue;
    }
    if (request.root !== basename(root)) continue;
    try {
      if (!Array.isArray(request.paths) || !request.paths.length)
        throw new Error('Pedido legado sem caminhos: requer revisão manual.');
      const identity = await contentIdentity(root, request.paths);
      const env = gitEnvironment(request.author);
      if (request.format === LEGACY_FORMAT) {
        await checkLegacyRequest(root, request, env);
        request.files = identity; // registra o conteúdo atribuído, como no formato 2
      } else if (request.format !== 'balde-commit/2')
        throw new Error('Pedido em formato desconhecido: requer revisão manual.');
      else if (JSON.stringify(identity) !== JSON.stringify(request.files))
        throw new Error('Aguardando o conteúdo exato do pedido; arquivos ausentes ou alterados.');
      const paths = [];
      for (const path of request.paths) {
        let exists = true;
        try {
          await lstat(containedPath(root, path));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          exists = false;
        }
        const tracked =
          exists ||
          (await execute('git', ['-C', root, 'ls-files', '--', path], { env, windowsHide: true })).stdout.trim();
        if (tracked) paths.push(path);
      }
      if (paths.length) await execute('git', ['-C', root, 'add', '-A', '--', ...paths], { env, windowsHide: true });
      if (paths.length && (await hasChanges(root, paths, env))) {
        const message = String(request.message || 'alteração feita em outra máquina');
        await execute('git', ['-C', root, 'commit', '--only', '-m', message, '--no-gpg-sign', '--', ...paths], {
          env,
          windowsHide: true
        });
        request.status = 'committed';
      } else {
        request.status = 'already-recorded';
      }
      request.completedAt = new Date().toISOString();
      await atomicJson(path, request);
      const archive = join(directory, '_completed');
      await mkdir(archive, { recursive: true });
      await rename(path, join(archive, name));
      completed++;
    } catch (error) {
      request.status = 'retry-required';
      request.attempts = Number(request.attempts || 0) + 1;
      request.lastError = String(error.message).slice(0, 2000);
      await atomicJson(path, request); // Falhas e conflitos conservam autoria e conteúdo esperado.
    }
  }
  return completed;
}
