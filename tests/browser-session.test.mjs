import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSession } from '../src/security/browser-session.mjs';

test('Browser sessions expire, revoke and evict independently of the native bootstrap capability', () => {
  let time = 1000;
  const key = 'a'.repeat(64);
  const sessions = createBrowserSession(key, { now: () => time, ttlMs: 2000, maxSessions: 2 });
  const client = () => ({ headers: { cookie: sessions.issueCookie().split(';')[0] } });
  const first = client(),
    second = client();
  assert.equal(sessions.authenticated(first), true);
  const third = client();
  assert.equal(sessions.authenticated(first), false);
  sessions.revoke(second);
  assert.equal(sessions.authenticated(second), false);
  assert.equal(sessions.authenticated(third), true);
  time += 2001;
  assert.equal(sessions.authenticated(third), false);
  assert.equal(sessions.authenticated({ headers: { cookie: `balde_session=${key}` } }), false);
  assert.equal(sessions.authenticated({ headers: { 'x-balde-session': key } }), true);
});
