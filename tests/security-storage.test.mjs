import {
  applyFileTransaction,
  discardFileTransaction,
  incompleteTransactions,
  readTransaction
} from '../src/governance/file-transaction.mjs';
import { withFileLock } from '../src/storage/file-lock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, symlink, mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { localIdentity, localGroups, validateLocalRequest } from '../src/security/local-session.mjs';
import { decide, gateAction } from '../src/security/permissions.mjs';
import { containedPath, atomicJson } from '../src/storage/atomic-files.mjs';
import { sealSubmission, importSubmission, importFeedbackEvent } from '../src/governance/exchange.mjs';
import { recordHistoryRequest, flushHistoryRequests } from '../src/storage/history-requests.mjs';
import { publishSnapshot, readPublication, hasWorkingChanges } from '../src/governance/publication-store.mjs';
import { CorpusDataProvider } from '../public/dataProvider.js';

const execute = promisify(execFile);
const actor = { name: 'Curator', email: 'curator@example.test' };
const gitEnvironment = (who) => ({
  ...process.env,
  GIT_AUTHOR_NAME: who.name,
  GIT_AUTHOR_EMAIL: who.email,
  GIT_COMMITTER_NAME: who.name,
  GIT_COMMITTER_EMAIL: who.email
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'balde-playground-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const request = (headers = {}, remoteAddress = '127.0.0.1') => ({
  headers: { host: '127.0.0.1:8099', ...headers },
  socket: { remoteAddress }
});

test('Local identity and groups are resolved from trusted process configuration', () => {
  const env = { DEV_FAKE_EMAIL: 'USER@EXAMPLE.TEST', DEV_FAKE_NAME: 'User', BALDE_GROUPS_FROM_CORPUS: '1' };
  assert.equal(localIdentity(env).email, 'user@example.test');
  assert.deepEqual(
    localGroups((email) => [email], env),
    ['user@example.test']
  );
  const incoming = request({ 'x-authentik-email': 'admin@example.test', 'x-authentik-groups': 'Administradores' });
  assert.equal(validateLocalRequest(incoming, 8099), null);
  assert.equal(incoming.headers['x-authentik-email'], undefined);
});

test('Browser boundary rejects LAN peers, DNS rebinding and foreign origins', () => {
  for (const incoming of [
    request({}, '192.168.1.9'),
    request({ host: 'attacker.test:8099' }),
    request({ origin: 'https://attacker.test' }),
    request({ 'sec-fetch-site': 'cross-site' }),
    request({ host: '127.0.0.1:80' })
  ]) {
    assert.ok(validateLocalRequest(incoming, 8099));
  }
  assert.equal(validateLocalRequest(request({ origin: 'http://127.0.0.1:8099' }), 8099), null);
});

test('The entire review/evaluation/publication journey shares the writable-curator capability', () => {
  for (const path of ['/api/merge/write', '/api/publish', '/api/skills/geral%2Fexample/eval/run']) {
    assert.equal(gateAction('POST', path), 'curar');
    assert.equal(decide('curar', { role: 'curador', writable: true }).ok, true);
    assert.equal(decide('curar', { role: 'curador', writable: false }).ok, false);
  }
  assert.equal(gateAction('POST', '/api/admin/buddy-theme'), 'instalacao');
});

test('File boundaries reject traversal and absolute or alternate-stream paths', async (t) => {
  const root = await fixture(t);
  for (const path of ['../outside', 'one/../../outside', 'C:/outside', '//host/share', 'one:file', 'one\\..\\outside'])
    assert.throws(() => containedPath(root, path));
  await atomicJson(join(root, 'safe.json'), { ok: true });
  assert.deepEqual(JSON.parse(await readFile(join(root, 'safe.json'))), { ok: true });
});

async function submission(root) {
  const source = join(root, 'sender', 'submission-1');
  const destination = join(root, 'recipient');
  await mkdir(join(source, 'files'), { recursive: true });
  const meta = {
    id: 'submission-1',
    repo: 'corporate',
    skillId: 'geral/test',
    status: 'pendente',
    contentChars: 5,
    files: [{ name: 'evidence.txt', bytes: 8 }]
  };
  await atomicJson(join(source, 'item.json'), meta);
  return { source, destination, meta };
}

test('Metadata arriving first never imports or deletes a submission', async (t) => {
  const { source, destination } = await submission(await fixture(t));
  await assert.rejects(importSubmission(source, destination));
  assert.ok(await readFile(join(source, 'item.json')));
  await writeFile(join(source, 'content.md'), 'hello');
  await assert.rejects(importSubmission(source, destination));
  assert.ok(await readFile(join(source, 'content.md')));
});

test('Complete submissions import once, retain the source, and preserve destination decisions', async (t) => {
  const { source, destination, meta } = await submission(await fixture(t));
  await writeFile(join(source, 'content.md'), 'hello');
  await writeFile(join(source, 'files', 'evidence.txt'), 'evidence');
  await sealSubmission(source, meta);
  assert.equal(await importSubmission(source, destination), true);
  await atomicJson(join(destination, meta.id, 'item.json'), { ...meta, status: 'aprovado' });
  assert.equal(await importSubmission(source, destination), false);
  assert.equal(JSON.parse(await readFile(join(destination, meta.id, 'item.json'))).status, 'aprovado');
  assert.equal(JSON.parse(await readFile(join(source, 'receipt.json'))).state, 'received');
  assert.equal(await readFile(join(source, 'content.md'), 'utf8'), 'hello');
});

test('Same-size corruption fails manifest validation without losing the source', async (t) => {
  const { source, destination, meta } = await submission(await fixture(t));
  await writeFile(join(source, 'content.md'), 'hello');
  await writeFile(join(source, 'files', 'evidence.txt'), 'evidence');
  await sealSubmission(source, meta);
  await writeFile(join(source, 'files', 'evidence.txt'), 'tampered');
  await assert.rejects(importSubmission(source, destination), /incompleta|conflito/);
  assert.ok(await readFile(join(source, 'item.json')));
});

test('Feedback event import is idempotent and refuses partial JSONL', async (t) => {
  const root = await fixture(t),
    source = join(root, 'event.jsonl'),
    target = join(root, 'feedback');
  await writeFile(source, '{"id":"one"}');
  await assert.rejects(importFeedbackEvent(source, target));
  await writeFile(source, '{"id":"one"}\n');
  await importFeedbackEvent(source, target);
  await importFeedbackEvent(source, target);
  assert.equal((await readdir(target)).length, 1);
});

async function ledger(t) {
  const parent = await fixture(t),
    root = join(parent, 'skills');
  await mkdir(root);
  const git = (...args) => execute('git', ['-C', root, ...args], { env: gitEnvironment(actor), windowsHide: true });
  await git('init', '-q');
  await writeFile(join(root, 'wanted.md'), 'baseline');
  await writeFile(join(root, 'unrelated.md'), 'baseline');
  await git('add', '.');
  await git('commit', '-q', '-m', 'baseline', '--no-gpg-sign');
  return { root, git, pending: join(parent, '.balde', 'commits') };
}

test('A real Git index lock retains history and author; retry excludes unrelated changes', async (t) => {
  const { root, git, pending } = await ledger(t);
  await writeFile(join(root, 'wanted.md'), 'wanted change');
  await writeFile(join(root, 'unrelated.md'), 'other author change');
  await git('add', 'unrelated.md');
  const req = await recordHistoryRequest(root, 'wanted only', actor, ['wanted.md']);
  await writeFile(join(root, '.git', 'index.lock'), 'locked');
  assert.equal(await flushHistoryRequests(root, gitEnvironment), 0);
  assert.equal(JSON.parse(await readFile(join(pending, `${req.id}.json`))).status, 'retry-required');
  await rm(join(root, '.git', 'index.lock'));
  assert.equal(await flushHistoryRequests(root, gitEnvironment), 1);
  assert.equal((await git('show', 'HEAD:unrelated.md')).stdout, 'baseline');
  assert.equal((await git('show', 'HEAD:wanted.md')).stdout, 'wanted change');
  assert.equal((await git('log', '-1', '--format=%ae')).stdout.trim(), actor.email);
  assert.equal(await flushHistoryRequests(root, gitEnvironment), 0);
});

test('History waits for exact content and never attributes a later edit to the earlier actor', async (t) => {
  const { root, pending } = await ledger(t);
  await writeFile(join(root, 'wanted.md'), 'requested');
  const req = await recordHistoryRequest(root, 'requested', actor, ['wanted.md']);
  await writeFile(join(root, 'wanted.md'), 'later change');
  assert.equal(await flushHistoryRequests(root, gitEnvironment), 0);
  assert.ok(await readFile(join(pending, `${req.id}.json`)));
  await writeFile(join(root, 'wanted.md'), 'requested');
  assert.equal(await flushHistoryRequests(root, gitEnvironment), 1);
});

// Pedido da 2.0.15 (balde-commit/1, sem hashes), escrito como a 2.0.15 escreve.
async function legacyHistoryRequest(pending, root, minutesAgo, paths, author) {
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const id = `${at.replace(/[-:.]/g, '')}-abc123`;
  const request = { format: 'balde-commit/1', root: basename(root), message: 'aprovação legada', author, paths, at };
  await mkdir(pending, { recursive: true });
  await writeFile(join(pending, `${id}.json`), `${JSON.stringify(request, null, 2)}\n`);
  return { id, at: Date.parse(at) };
}
const modifiedAt = (path, ms) => utimes(path, new Date(ms), new Date(ms));

test('A 2.0.15 history request is recorded once its files arrive, never for a later edit', async (t) => {
  const { root, git, pending } = await ledger(t);
  const legacy = { name: 'Legacy Curator', email: 'legacy@example.test' };
  const pendingRequest = async (id) => JSON.parse(await readFile(join(pending, `${id}.json`), 'utf8'));
  // Chegou: o arquivo traz a data do pedido (o OneDrive a preserva) e entra no histórico sob o autor.
  await writeFile(join(root, 'wanted.md'), 'approved on 2.0.15');
  const arrived = await legacyHistoryRequest(pending, root, 10, ['wanted.md'], legacy);
  await modifiedAt(join(root, 'wanted.md'), arrived.at - 30_000);
  // Ainda não chegou: o arquivo é anterior ao pedido.
  const waiting = await legacyHistoryRequest(pending, root, 5, ['unrelated.md'], legacy);
  await modifiedAt(join(root, 'unrelated.md'), waiting.at - 3600_000);
  assert.equal(await flushHistoryRequests(root, gitEnvironment), 1);
  assert.equal((await git('log', '-1', '--format=%ae %s')).stdout.trim(), 'legacy@example.test aprovação legada');
  assert.equal((await git('show', 'HEAD:wanted.md')).stdout, 'approved on 2.0.15');
  const done = JSON.parse(await readFile(join(pending, '_completed', `${arrived.id}.json`), 'utf8'));
  assert.equal(done.status, 'committed');
  assert.deepEqual(
    done.files.map((file) => file.path),
    ['wanted.md']
  );
  assert.match((await pendingRequest(waiting.id)).lastError, /Aguardando/);
  // Mudou depois do pedido: nada é atribuído ao autor do pedido.
  await writeFile(join(root, 'unrelated.md'), 'edited much later');
  await modifiedAt(join(root, 'unrelated.md'), waiting.at + 3600_000);
  assert.equal(await flushHistoryRequests(root, gitEnvironment), 0);
  assert.match((await pendingRequest(waiting.id)).lastError, /revisão de autoria/);
  assert.equal((await git('show', 'HEAD:unrelated.md')).stdout, 'baseline');
  // Passadas duas horas, um pedido cuja mudança já está no histórico fecha como registrado.
  const old = await legacyHistoryRequest(pending, root, 180, ['wanted.md'], legacy);
  assert.equal(await flushHistoryRequests(root, gitEnvironment), 1);
  const closed = JSON.parse(await readFile(join(pending, '_completed', `${old.id}.json`), 'utf8'));
  assert.equal(closed.status, 'already-recorded');
});

test('A skill published before 2.0.16 has pending changes only when its text or fields changed', async (t) => {
  const skill = await fixture(t);
  const working =
    '---\nname: Preços\nowner: dono@example.test\nstatus: canonico\n---\n\n# Preços\n\nComo precificar.\n';
  // Como o Publicar antigo gravava: aspas, CRLF, status/versão/revisão e o bloco de aprovação no fim.
  const legacyPublished =
    '---\r\nname: "Preços"\r\nowner: "dono@example.test"\r\nstatus: "canonico"\r\nversion: "0.1.1"\r\nlast_reviewed: "2026-08-15"\r\n---\r\n\r\n# Preços\r\n\r\nComo precificar.\r\n\r\n## Alteracoes canonizadas pelo owner\r\n\r\n### 2026-08-15 - Alteracao aprovada pelo owner\r\n\r\n- versao canonica: 0.1.1\r\n';
  await writeFile(join(skill, 'SKILL.md'), working);
  await mkdir(join(skill, 'canonico'));
  await writeFile(join(skill, 'canonico', 'SKILL.md'), legacyPublished);
  await writeFile(join(skill, 'canonico', 'metadata.json'), JSON.stringify({ id: 'precos-v-0.1.1', version: '0.1.1' }));
  const published = await readPublication(skill);
  assert.equal(await hasWorkingChanges(published, skill, null), false);
  await writeFile(join(skill, 'SKILL.md'), working.replace('Como precificar.', 'Como precificar em 2027.'));
  assert.equal(await hasWorkingChanges(published, skill, null), true);
  await writeFile(join(skill, 'SKILL.md'), working.replace('dono@example.test', 'outro@example.test'));
  assert.equal(await hasWorkingChanges(published, skill, null), true);
});

test('Publishing where the governance folder is the skill folder leaves no pending changes', async (t) => {
  const skill = await fixture(t);
  await writeFile(join(skill, 'SKILL.md'), '---\nname: Preços\n---\n\n# Preços\n');
  const metadata = await publishSnapshot({
    governanceDirectory: skill,
    sourceDirectory: skill,
    draftDirectory: null,
    operationId: 'op-00000001',
    buildPublication: async () => ({ id: 'pub-00000001', version: '0.0.1' }),
    renderMarkdown: (markdown) => markdown
  });
  assert.ok(![...metadata.workingFiles, ...metadata.files].some((file) => file.path === 'publication.lock'));
  const published = await readPublication(skill);
  assert.equal(await hasWorkingChanges(published, skill, null), false);
  // Publicações da 2.0.16 registraram o lock entre os arquivos de trabalho.
  published.metadata.workingFiles.push({ path: 'publication.lock', sha256: 'lock' });
  assert.equal(await hasWorkingChanges(published, skill, null), false);
  // Rodar a avaliação, aceitar um item, revisar ou mudar a cadência grava registro, não conteúdo.
  await mkdir(join(skill, 'eval'));
  await writeFile(join(skill, 'eval', 'cases.json'), '{"version":3,"items":[]}');
  await writeFile(join(skill, 'governance.json'), '{"skill":{"lastReviewedAt":"2026-10-06"}}');
  await writeFile(join(skill, 'context-index.json'), '{}');
  assert.equal(await hasWorkingChanges(published, skill, null), false);
  await writeFile(join(skill, 'SKILL.md'), '---\nname: Preços\n---\n\n# Preços\n\nNovo texto.\n');
  assert.equal(await hasWorkingChanges(published, skill, null), true);
});

test('Corpus outages show no fabricated skills and remain retryable', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const provider = new CorpusDataProvider();
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  await assert.rejects(provider.listSkills(), /503/);
  assert.deepEqual(provider.skills, []);
  assert.equal(provider.loadedFromDisk, false);
  globalThis.fetch = async () => Response.json({ skills: [{ id: 'real', status: 'canonico' }] });
  assert.equal((await provider.listSkills())[0].id, 'real');
  assert.equal(provider.loadError, null);
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  await assert.rejects(provider.reload(), /503/);
  assert.equal(provider.skills[0].id, 'real');
  assert.ok(provider.loadedAt);
  assert.ok(provider.loadError);
});

test('File boundaries reject junctions and Windows alternate names', async (t) => {
  const root = await fixture(t),
    external = await fixture(t);
  for (const path of ['file. ', 'NUL', 'one/CON.txt', 'one//two']) assert.throws(() => containedPath(root, path));
  await symlink(external, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => containedPath(root, 'linked/private.txt'), /Links/);
});

test('An active or remote filesystem lock is never removed merely because it is old', async (t) => {
  const root = await fixture(t),
    path = join(root, 'operation.lock');
  await withFileLock(path, async () => {
    await assert.rejects(
      withFileLock(path, async () => assert.fail('Ran concurrently')),
      /andamento/
    );
  });
  await atomicJson(path, { host: 'another-host', pid: 123, createdAt: '2000-01-01' });
  await assert.rejects(
    withFileLock(path, async () => assert.fail('Remote owner bypassed')),
    /andamento/
  );
  assert.ok(await readFile(path));
});

test('A multi-file application rolls back a failed write and resumes from its durable plan', async (t) => {
  const root = await fixture(t),
    first = join(root, 'first.txt'),
    second = join(root, 'second.txt');
  const journalPath = join(root, 'operation.json');
  await writeFile(first, 'original-first');
  await writeFile(second, 'original-second');
  const args = {
    root,
    journalPath,
    inputHash: 'same-input',
    files: new Map([
      [first, 'new-first'],
      [second, 'new-second']
    ]),
    result: { applied: 2 }
  };
  await chmod(second, 0o444);
  try {
    await assert.rejects(applyFileTransaction(args), /incompleta/);
  } finally {
    await chmod(second, 0o666);
  }
  assert.equal(await readFile(first, 'utf8'), 'original-first');
  assert.equal(await readFile(second, 'utf8'), 'original-second');
  assert.equal((await readTransaction(journalPath)).status, 'retry-required');
  assert.deepEqual(await applyFileTransaction(args), { applied: 2 });
  assert.equal(await readFile(first, 'utf8'), 'new-first');
  assert.equal(await readFile(second, 'utf8'), 'new-second');
  assert.deepEqual(await applyFileTransaction(args), { applied: 2 });
});

test('An undone application unblocks the balde and lets edited content apply', async (t) => {
  const root = await fixture(t),
    target = join(root, 'context.md');
  const journalPath = join(root, '.balde', 'capsule-operations', 'q-1.json');
  await writeFile(target, 'antes');
  await chmod(target, 0o444);
  try {
    await assert.rejects(
      applyFileTransaction({
        root,
        journalPath,
        inputHash: 'primeira',
        files: new Map([[target, 'metade']]),
        result: {}
      }),
      /incompleta/
    );
  } finally {
    await chmod(target, 0o666);
  }
  assert.deepEqual(
    (await incompleteTransactions(root)).map((item) => item.id),
    ['q-1']
  );
  assert.equal((await discardFileTransaction({ journalPath, root, actor: 'cur@example.test' })).status, 'abandoned');
  assert.equal(await readFile(target, 'utf8'), 'antes');
  assert.deepEqual(await incompleteTransactions(root), []);
  // A contribuição editada depois de desfeita aplica do zero, sem esbarrar no plano antigo.
  await applyFileTransaction({
    root,
    journalPath,
    inputHash: 'editada',
    files: new Map([[target, 'nova']]),
    result: {}
  });
  assert.equal(await readFile(target, 'utf8'), 'nova');
  assert.equal((await readTransaction(journalPath)).status, 'completed');
});
