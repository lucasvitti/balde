import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { fixture, start, stop, request } from './fixture.mjs';

const runtime = fileURLToPath(new URL('..', import.meta.url));
async function live(t) {
  const root = await mkdtemp(join(tmpdir(), 'balde-live-fixed-'));
  const app = await fixture(root, 'curator');
  t.after(async () => {
    await stop(app);
    await rm(root, { recursive: true, force: true });
  });
  await start(app, runtime);
  return app;
}
const post = (app, path, body) => request(app, path, { method: 'POST', body });

test('Live runtime rejects forged identity, private-repo impersonation and foreign browser requests', async (t) => {
  const app = await live(t);
  const forged = await request(app, '/api/admin/prompts', { headers: { 'x-authentik-groups': 'Balde - Admins' } });
  assert.equal(forged.status, 403);
  const privateRepo = await request(app, '/api/skills', {
    headers: { 'x-balde-repo': 'restricted', 'x-authentik-email': 'owner@example.test' }
  });
  assert.equal(privateRepo.status, 404);
  const me = await request(app, '/api/me', { headers: { 'x-authentik-email': 'forged@example.test' } });
  assert.equal(me.data.email, 'curator@example.test');
  const foreignHost = await new Promise((resolve, reject) => {
    const req = httpRequest(`${app.url}/api/health`, { headers: { host: 'attacker.test' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(foreignHost, 403);
  assert.equal((await post(app, '/api/queue/submit', {})).status, 400);
  assert.equal((await request(app, '/api/health', { headers: { origin: 'https://attacker.test' } })).status, 403);
  assert.equal((await request(app, '/api/v1/skills')).status, 401);
  assert.equal(
    (await request(app, '/api/v1/skills', { headers: { authorization: `Bearer ${app.env.API_KEY}` } })).status,
    200
  );
});

test('Live writable curator can publish and close one contribution; retries preserve one snapshot', async (t) => {
  const app = await live(t);
  const submitted = await post(app, '/api/queue/submit', {
    skillId: 'audit-skill',
    content: 'Verified contribution',
    title: 'Test contribution'
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  const itemId = submitted.data.id;
  const changed = `${app.markdown}\nMerged contribution.\n`;
  const merge = await post(app, '/api/merge/write', {
    skillId: 'audit-skill',
    changes: [{ path: 'SKILL.md', content: changed }]
  });
  assert.equal(merge.status, 200, JSON.stringify(merge.data));
  const premature = await post(app, '/api/publish', {
    skillId: 'audit-skill',
    operationId: 'attempt-before-eval',
    queueItemId: itemId
  });
  assert.equal(premature.status, 409);
  const evaluation = await request(app, '/api/skills/audit-skill/eval');
  assert.equal(evaluation.status, 200, JSON.stringify(evaluation.data));
  const items = evaluation.data.eval?.items || evaluation.data.items;
  assert.ok(Array.isArray(items), JSON.stringify(evaluation.data));
  const mandatory = Object.fromEntries(
    items.filter((item) => item.mandatory).map((item) => [item.id, { aiVerdict: 'pass', accepted: 'accepted' }])
  );
  const directory = join(app.repo, 'skills', 'audit-skill');
  await mkdir(join(directory, 'eval'), { recursive: true });
  await writeFile(join(directory, 'eval', 'cases.json'), JSON.stringify({ version: 3, items: [], mandatory }));
  const payload = { skillId: 'audit-skill', operationId: 'publish-complete-test', queueItemId: itemId };
  const published = await post(app, '/api/publish', payload);
  assert.equal(published.status, 200, JSON.stringify(published.data));
  assert.equal(published.data.queueClosed, true);
  const repeated = await post(app, '/api/publish', payload);
  assert.equal(repeated.status, 200, JSON.stringify(repeated.data));
  assert.equal(repeated.data.publication.id, published.data.publication.id);
  assert.equal((await readdir(join(directory, 'canonico', 'snapshots'))).length, 1);
  const item = await request(app, `/api/queue/item?id=${itemId}`);
  assert.equal(item.data.item.status, 'aprovado');
  assert.equal((await post(app, '/api/queue/reassign', { id: itemId, skillId: 'audit-skill' })).status, 409);
  const unpublished = `${changed}\nUNPUBLISHED SECRET MARKER\n`;
  assert.equal(
    (
      await post(app, '/api/merge/write', {
        skillId: 'audit-skill',
        changes: [{ path: 'SKILL.md', content: unpublished }]
      })
    ).status,
    200
  );
  const detail = await request(app, '/api/explore/skill?skill=audit-skill');
  assert.equal(detail.data.meta.contentState, 'published');
  assert.equal(detail.data.meta.pendingWorkingChanges, true);
  assert.ok(!detail.data.markdown.includes('UNPUBLISHED SECRET MARKER'));
  const preview = await request(app, '/api/explore/skill?skill=audit-skill&view=working');
  assert.equal(preview.data.meta.contentState, 'draft');
  assert.ok(preview.data.markdown.includes('UNPUBLISHED SECRET MARKER'));
});

test('Live approval with a missing attachment stays pending and preserves the skill', async (t) => {
  const app = await live(t);
  const response = await post(app, '/api/queue/submit', {
    skillId: 'audit-skill',
    content: 'Contribution text',
    files: [{ name: 'evidence.txt', contentBase64: Buffer.from('evidence').toString('base64') }]
  });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  await rm(join(app.repo, 'queue', response.data.id, 'files', 'evidence.txt'));
  const result = await post(app, '/api/queue/decide', { id: response.data.id, decision: 'aprovar' });
  assert.equal(result.data.ok, false);
  assert.equal(JSON.parse(await readFile(join(app.repo, 'queue', response.data.id, 'item.json'))).status, 'pendente');
  assert.equal(await readFile(join(app.repo, 'skills', 'audit-skill', 'SKILL.md'), 'utf8'), app.markdown);
});

async function allowPublication(app) {
  const response = await request(app, '/api/skills/audit-skill/eval');
  const items = response.data.eval?.items || response.data.items;
  assert.ok(Array.isArray(items), JSON.stringify(response));
  const mandatory = Object.fromEntries(
    items.filter((item) => item.mandatory).map((item) => [item.id, { aiVerdict: 'pass', accepted: 'accepted' }])
  );
  const path = join(app.repo, 'skills', 'audit-skill', 'eval');
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'cases.json'), JSON.stringify({ version: 3, items: [], mandatory }));
}

test('Browser sessions reject unauthenticated API clients and exchange bootstrap tokens for protected cookies', async (t) => {
  const app = await live(t);
  assert.equal((await fetch(app.url + '/api/me')).status, 401);
  const denied = await fetch(app.url + '/api/session', { method: 'POST', body: JSON.stringify({ token: 'wrong' }) });
  assert.equal(denied.status, 401);
  const session = await fetch(app.url + '/api/session', {
    method: 'POST',
    body: JSON.stringify({ token: app.env.BALDE_WEB_SESSION_KEY })
  });
  assert.equal(session.status, 200);
  const cookie = session.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.equal((await fetch(app.url + '/api/me', { headers: { cookie: cookie.split(';')[0] } })).status, 200);
  const ended = await fetch(app.url + '/api/session/logout', {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0] }
  });
  assert.equal(ended.status, 200);
  assert.match(ended.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await fetch(app.url + '/api/me', { headers: { cookie: cookie.split(';')[0] } })).status, 401);
  assert.equal((await fetch(app.url + '/api/me')).status, 401);
});

test('Concurrent approvals apply one contribution once and preserve an immutable decision', async (t) => {
  const app = await live(t);
  const submitted = await post(app, '/api/queue/submit', { skillId: 'audit-skill', content: 'Once only' });
  const payload = { id: submitted.data.id, decision: 'aprovar' };
  const results = await Promise.all([post(app, '/api/queue/decide', payload), post(app, '/api/queue/decide', payload)]);
  assert.equal(results.filter((result) => result.data.ok).length, 1, JSON.stringify(results));
  const directory = join(app.repo, 'skills', 'audit-skill', 'context', 'contributions');
  assert.deepEqual(await readdir(directory), [payload.id]);
  assert.equal((await readdir(join(app.repo, 'queue', '_decisions', payload.id))).length, 1);
  assert.equal((await request(app, '/api/queue/item?id=' + payload.id)).data.item.review.appliedState, 'draft');
});

test('A publication whose queue closure fails resumes without a second snapshot', async (t) => {
  const { chmod } = await import('node:fs/promises');
  const app = await live(t);
  const submitted = await post(app, '/api/queue/submit', { skillId: 'audit-skill', content: 'Closure recovery' });
  await allowPublication(app);
  const metadata = join(app.repo, 'queue', submitted.data.id, 'item.json');
  await chmod(metadata, 0o444);
  const payload = { skillId: 'audit-skill', queueItemId: submitted.data.id, operationId: 'closure-failure-test' };
  let failed;
  try {
    failed = await post(app, '/api/publish', payload);
  } finally {
    await chmod(metadata, 0o666);
  }
  assert.equal(failed.status, 409, JSON.stringify(failed.data));
  assert.equal(failed.data.retryable, true);
  assert.equal((await post(app, '/api/publish', { ...payload, operationId: 'new-browser-session-id' })).status, 200);
  assert.equal((await readdir(join(app.repo, 'skills', 'audit-skill', 'canonico', 'snapshots'))).length, 1);
  assert.equal((await request(app, '/api/queue/item?id=' + payload.queueItemId)).data.item.status, 'aprovado');
});

test('Feedback conversion is one durable operation, including concurrent retries and history', async (t) => {
  const app = await live(t);
  const path = join(app.repo, 'feedback');
  await mkdir(path, { recursive: true });
  const event = {
    eventId: 'feedback-fixture',
    repo: 'corporate',
    skillId: 'audit-skill',
    timestamp: '2026-10-05T00:00:00Z',
    user: 'curator@example.test',
    verdict: 'errado',
    conversation: [
      { role: 'user', content: 'Question fixture' },
      { role: 'assistant', content: 'Answer fixture' }
    ]
  };
  await writeFile(join(path, 'fixture.jsonl'), JSON.stringify(event) + '\n');
  const skills = await request(app, '/api/skills');
  const skill = (skills.data.skills || skills.data).find((skill) => skill.id === 'audit-skill');
  const feedback = skill.feedback.find((entry) => entry.question === 'Question fixture');
  assert.ok(feedback, JSON.stringify(skill.feedback));
  const payload = { id: feedback.id, skillId: 'audit-skill', content: 'Reviewed correction', title: 'Correction' };
  const replies = await Promise.all([
    post(app, '/api/feedback/convert', payload),
    post(app, '/api/feedback/convert', payload)
  ]);
  for (const reply of replies) assert.equal(reply.status, 200, JSON.stringify(reply.data));
  const queue = await request(app, '/api/queue');
  const converted = queue.data.items.filter((item) => item.originFeedbackId === feedback.id);
  assert.equal(converted.length, 1);
  const refreshed = await request(app, '/api/skills');
  const history = (refreshed.data.skills || refreshed.data)
    .find((skill) => skill.id === 'audit-skill')
    .feedback.find((entry) => entry.id === feedback.id);
  assert.equal(history.resolution.contributionId, converted[0].id);
});

test('Contributors can read their own outbox history but cannot read or decide someone else’s item', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'balde-sender-'));
  const app = await fixture(root, 'sender');
  app.env.DEV_FAKE_EMAIL = 'sender@example.test';
  t.after(async () => {
    await stop(app);
    await rm(root, { recursive: true, force: true });
  });
  await start(app, runtime);
  const submitted = await post(app, '/api/queue/submit', { skillId: 'audit-skill', content: 'My submission' });
  assert.equal(submitted.status, 201, JSON.stringify(submitted));
  const list = await request(app, '/api/queue');
  assert.equal(list.status, 200, JSON.stringify(list));
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].delivery, 'awaiting-sync');
  assert.equal(list.data.writable, false);
  assert.equal((await request(app, '/api/queue/item?id=' + submitted.data.id)).data.item.content, 'My submission');
  assert.equal((await post(app, '/api/queue/decide', { id: submitted.data.id, decision: 'aprovar' })).status, 403);
  const foreign = join(app.repo, 'queue', 'q-foreign-item');
  await mkdir(foreign, { recursive: true });
  await writeFile(
    join(foreign, 'item.json'),
    JSON.stringify({
      id: 'q-foreign-item',
      repo: 'corporate',
      skillId: 'audit-skill',
      status: 'pendente',
      submittedBy: { email: 'other@example.test' }
    })
  );
  assert.equal((await request(app, '/api/queue/item?id=q-foreign-item')).status, 404);
  assert.equal((await request(app, '/api/queue')).data.items.length, 1);
});

test('Published context downloads stay immutable and rollback restores the selected version', async (t) => {
  const app = await live(t);
  const skillRoot = join(app.repo, 'skills', 'audit-skill');
  await mkdir(join(skillRoot, 'context'), { recursive: true });
  await writeFile(join(skillRoot, 'context', 'example.md'), 'PUBLISHED CONTEXT');
  await allowPublication(app);
  const first = await post(app, '/api/publish', { skillId: 'audit-skill', operationId: 'first-snapshot-test' });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  await writeFile(join(skillRoot, 'context', 'example.md'), 'UNPUBLISHED CONTEXT');
  const context = await request(app, '/api/v1/skills/audit-skill/context/context%2Fexample.md', {
    headers: { authorization: `Bearer ${app.env.API_KEY}` }
  });
  assert.equal(context.status, 200, JSON.stringify(context.data));
  assert.equal(context.data.content, 'PUBLISHED CONTEXT');
  await allowPublication(app);
  const second = await post(app, '/api/publish', { skillId: 'audit-skill', operationId: 'second-snapshot-test' });
  assert.equal(second.status, 200, JSON.stringify(second.data));
  const restored = await post(app, '/api/rollback', {
    skillId: 'audit-skill',
    operationId: 'rollback-snapshot-test',
    targetVersion: first.data.publication.version
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  const after = await request(app, '/api/v1/skills/audit-skill/context/context%2Fexample.md', {
    headers: { authorization: `Bearer ${app.env.API_KEY}` }
  });
  assert.equal(after.data.content, 'PUBLISHED CONTEXT');
});

test('A partially applied capsule blocks consumption but leaves the recovery queue accessible', async (t) => {
  const app = await live(t);
  const directory = join(app.repo, '.balde', 'capsule-operations');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'pending-fixture.json'),
    JSON.stringify({ status: 'retry-required', error: 'Simulated process interruption', entries: [] })
  );
  assert.equal((await request(app, '/api/skills')).status, 409);
  const queue = await request(app, '/api/queue');
  assert.equal(queue.status, 200);
  assert.equal(queue.data.recovery[0].type, 'capsule');
  await rm(join(directory, 'pending-fixture.json'));
  assert.equal((await request(app, '/api/skills')).status, 200);
});

test('Missing or forked published snapshots fail closed instead of leaking the working draft', async (t) => {
  const { cp } = await import('node:fs/promises');
  const app = await live(t);
  await allowPublication(app);
  const published = await post(app, '/api/publish', { skillId: 'audit-skill', operationId: 'fork-source-fixture' });
  assert.equal(published.status, 200);
  const snapshots = join(app.repo, 'skills', 'audit-skill', 'canonico', 'snapshots');
  const first = join(snapshots, 'fork-source-fixture');
  const second = join(snapshots, 'fork-other-fixture');
  await cp(first, second, { recursive: true });
  const meta = JSON.parse(await readFile(join(second, 'metadata.json'), 'utf8'));
  meta.id = 'fork-other-fixture';
  meta.operationId = 'fork-other-fixture';
  await writeFile(join(second, 'metadata.json'), JSON.stringify(meta));
  const forked = await request(app, '/api/explore/skill?skill=audit-skill');
  assert.equal(forked.status, 500);
  assert.match(forked.data.error, /concorrentes/);
  await rm(second, { recursive: true });
  await writeFile(join(first, 'SKILL.md'), 'tampered snapshot');
  const corrupt = await request(app, '/api/explore/skill?skill=audit-skill');
  assert.equal(corrupt.status, 500);
  assert.match(corrupt.data.error, /incompleta|alterada/);
});

test('Feature routes stay wired after modularization', async (t) => {
  const app = await live(t);
  for (const path of [
    '/api/me',
    '/api/repos',
    '/api/users',
    '/api/groups',
    '/api/skills',
    '/api/commons',
    '/api/queue',
    '/api/explore/skill?skill=audit-skill',
    '/api/docs',
    '/api/buddies',
    '/api/admin/prompts'
  ]) {
    const response = await request(app, path);
    assert.ok([200, 403].includes(response.status), `${path}: ${JSON.stringify(response)}`);
  }
});
