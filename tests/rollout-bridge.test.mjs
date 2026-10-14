import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, start, stop, request } from './fixture.mjs';
import { createBrowserSession } from '../src/security/browser-session.mjs';

// O OneDrive entrega app e release em momentos diferentes: um app anterior à 2.0.16 (sem chave de sessão)
// precisa continuar abrindo o servidor novo, e uma janela aberta o dia todo não pode perder a sessão.
const runtime = fileURLToPath(new URL('..', import.meta.url));
async function live(t, { legacy = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'balde-bridge-'));
  const app = await fixture(root, 'curator');
  if (legacy) delete app.env.BALDE_WEB_SESSION_KEY;
  t.after(async () => {
    await stop(app);
    await rm(root, { recursive: true, force: true });
  });
  await start(app, runtime);
  return app;
}
const bare = (app, path, init = {}) => fetch(app.url + path, { ...init, signal: AbortSignal.timeout(12000) });

test('Sessions expire by inactivity, live as long as the app window, and need a key to be required', () => {
  let time = 1000;
  const sessions = createBrowserSession('b'.repeat(64), { now: () => time, ttlMs: 2000 });
  const cookie = sessions.issueCookie();
  assert.doesNotMatch(cookie, /Max-Age/i);
  const client = { headers: { cookie: cookie.split(';')[0] } };
  for (let step = 0; step < 5; step++) {
    time += 1500;
    assert.equal(sessions.authenticated(client), true, 'a session in use must not expire');
  }
  time += 2001;
  assert.equal(sessions.authenticated(client), false, 'an idle session must expire');
  assert.equal(sessions.legacy, false);
  assert.equal(createBrowserSession(undefined).legacy, true);
});

test('A server started by an app older than 2.0.16 serves the page without a session, inside the local boundary', async (t) => {
  const app = await live(t, { legacy: true });
  assert.match(app.logs, /modo legado/);
  const me = await bare(app, '/api/me');
  assert.equal(me.status, 200);
  assert.equal((await me.json()).email, 'curator@example.test');
  const foreign = await bare(app, '/api/me/prefs', {
    method: 'POST',
    headers: { origin: 'http://attacker.test', 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(foreign.status, 403);
});

test('A current server marks the missing session and keeps a used one alive through the ping', async (t) => {
  const app = await live(t);
  assert.doesNotMatch(app.logs, /modo legado/);
  const anonymous = await bare(app, '/api/me');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get('x-balde-session'), 'required');
  assert.equal((await bare(app, '/api/session/ping')).status, 401);
  assert.equal((await request(app, '/api/session/ping')).status, 200);
  const bootstrap = await bare(app, '/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: app.env.BALDE_WEB_SESSION_KEY })
  });
  const cookie = bootstrap.headers.get('set-cookie');
  assert.equal(bootstrap.status, 200);
  assert.doesNotMatch(cookie, /Max-Age/i);
  const ping = await bare(app, '/api/session/ping', { headers: { cookie: cookie.split(';')[0] } });
  assert.equal(ping.status, 200);
});
