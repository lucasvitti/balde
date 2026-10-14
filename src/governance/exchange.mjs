import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, containedPath } from '../storage/atomic-files.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestName = 'submission.json';

async function readRegularFile(root, path) {
  const target = containedPath(root, path);
  let part = root;
  for (const segment of path.split('/')) {
    part = join(part, segment);
    if ((await lstat(part)).isSymbolicLink()) throw new Error('Links não são permitidos em contribuições.');
  }
  if (!(await lstat(target)).isFile()) throw new Error(`Arquivo obrigatório ausente: ${path}`);
  return readFile(target);
}

async function describeSubmission(directory, meta) {
  if (!meta.id || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(meta.id))
    throw new Error('Identidade de contribuição inválida.');
  const text = await readRegularFile(directory, 'content.md');
  if (Number(meta.contentChars) > text.toString('utf8').length) throw new Error('Texto ainda incompleto.');
  const paths = ['content.md'];
  if (meta.type === 'capsule') {
    const capsule = JSON.parse((await readRegularFile(directory, 'capsule.json')).toString('utf8'));
    if (!capsule || typeof capsule !== 'object' || Array.isArray(capsule)) throw new Error('Cápsula inválida.');
    paths.push('capsule.json');
  }
  for (const file of meta.files || []) {
    if (!file.name || /[\\/:]/.test(file.name) || file.name.startsWith('.')) throw new Error('Nome de anexo inválido.');
    const path = `files/${file.name}`;
    const bytes = await readRegularFile(directory, path);
    if (!bytes.length || (file.bytes != null && bytes.length !== file.bytes))
      throw new Error(`Anexo incompleto: ${file.name}`);
    paths.push(path);
  }
  if (!text.toString('utf8').trim() && paths.length === 1) throw new Error('Contribuição sem conteúdo.');
  const files = [];
  for (const path of paths.sort()) {
    const bytes = await readRegularFile(directory, path);
    files.push({ path, bytes: bytes.length, sha256: digest(bytes) });
  }
  return {
    format: 'balde-submission/1',
    id: meta.id,
    repo: meta.repo || 'corporate',
    skillId: meta.skillId || '',
    files
  };
}

export async function sealSubmission(directory, meta) {
  const manifest = await describeSubmission(directory, meta);
  await atomicJson(join(directory, manifestName), manifest); // O manifesto chega por último, mas cada hash ainda é verificado no destino.
  return manifest;
}

export async function verifySubmission(directory, meta) {
  const actual = await describeSubmission(directory, meta);
  let expected;
  try {
    expected = JSON.parse(await readFile(join(directory, manifestName), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (expected && JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('Contribuição incompleta ou em conflito de sincronização.');
  return actual;
}

export async function importSubmission(source, destinationRoot) {
  const meta = JSON.parse((await readRegularFile(source, 'item.json')).toString('utf8'));
  const manifest = await verifySubmission(source, meta);
  const destination = containedPath(destinationRoot, meta.id);
  let existing;
  try {
    existing = JSON.parse(await readFile(join(destination, 'item.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing) {
    const installed = await verifySubmission(destination, existing);
    if (JSON.stringify(installed) !== JSON.stringify(manifest))
      throw new Error('Destino em conflito: o envio original foi preservado.');
  } else {
    await mkdir(destinationRoot, { recursive: true });
    const stage = join(destinationRoot, `.import-${randomUUID()}`);
    try {
      await mkdir(stage);
      for (const file of manifest.files) {
        const bytes = await readRegularFile(source, file.path);
        if (digest(bytes) !== file.sha256) throw new Error('O envio mudou durante a cópia.');
        const target = containedPath(stage, file.path);
        if (file.path.startsWith('files/')) await mkdir(join(stage, 'files'), { recursive: true });
        await writeFile(target, bytes, { flag: 'wx' });
      }
      await atomicJson(join(stage, 'item.json'), meta);
      await atomicJson(join(stage, manifestName), manifest);
      await verifySubmission(stage, meta);
      await rename(stage, destination);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  let previous;
  try {
    previous = JSON.parse(await readFile(join(source, 'receipt.json'), 'utf8'));
  } catch {
    previous = null;
  }
  if (previous?.submissionHash === digest(JSON.stringify(manifest))) return false;
  await atomicJson(join(source, 'receipt.json'), {
    id: meta.id,
    repo: manifest.repo,
    state: 'received',
    receivedAt: new Date().toISOString(),
    submissionHash: digest(JSON.stringify(manifest))
  });
  return true; // O comprovante substitui a exclusão: o remetente conserva uma cópia recuperável.
}

export async function importFeedbackEvent(source, destinationRoot) {
  const text = await readFile(source, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  if (!text.endsWith('\n') || lines.length !== 1) throw new Error('Evento de feedback incompleto.');
  JSON.parse(lines[0]);
  await mkdir(destinationRoot, { recursive: true });
  const target = join(destinationRoot, `exchange-${digest(text)}.jsonl`);
  try {
    await writeFile(target, text, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  if ((await readFile(target, 'utf8')) !== text) throw new Error('Conflito no feedback importado.');
}
