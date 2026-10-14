import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture, start, request, stop } from '../tests/fixture.mjs';

const runtime = resolve(process.argv[2]);
const root = await mkdtemp(join(tmpdir(), 'balde-package-check-'));
const app = await fixture(root, 'curator');
try {
  await start(app, runtime, join(runtime, 'bin', 'node.exe'));
  assert.equal((await request(app, '/api/health')).status, 200);
  assert.equal((await request(app, '/api/me')).status, 200);
  const html = await fetch(app.url).then((response) => response.text());
  assert.match(html, /app\.js/);
  assert.equal((await fetch(app.url + '/features/actions/governance.js')).status, 200);
  const submitted = await request(app, '/api/queue/submit', {
    method: 'POST',
    body: { skillId: 'audit-skill', content: 'Packaged runtime synthetic contribution.' }
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  assert.equal((await request(app, '/api/queue')).status, 200);
  console.log('Packaged Node/runtime: health, authenticated profile, UI module and real contribution passed.');
} finally {
  await stop(app);
  await rm(root, { recursive: true, force: true });
}
