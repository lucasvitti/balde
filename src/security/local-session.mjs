import { AsyncLocalStorage } from 'node:async_hooks';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Só para as suítes que simulam várias pessoas num servidor (BALDE_TEST_IDENTITY_HEADERS=1, que o app
// nunca define): a identidade do pedido vem dos cabeçalhos x-test-*, num contexto por pedido. Os
// cabeçalhos de proxy (x-authentik-*) continuam sem valor de credencial.
const testIdentity = new AsyncLocalStorage();
export function runWithTestIdentity(request, action) {
  const email = String(request.headers['x-test-email'] || '')
    .trim()
    .toLowerCase();
  if (process.env.BALDE_TEST_IDENTITY_HEADERS !== '1' || !email) return action();
  const header = request.headers['x-test-groups'];
  const groups =
    header === undefined
      ? null
      : String(header)
          .split(/[|,]/)
          .map((value) => value.trim())
          .filter(Boolean);
  return testIdentity.run({ email, name: String(request.headers['x-test-name'] || email), groups }, action);
}

export function localIdentity(environment = process.env) {
  const test = testIdentity.getStore();
  if (test) return { email: test.email, name: test.name, username: test.email };
  const email = String(environment.BALDE_LOCAL_EMAIL || environment.DEV_FAKE_EMAIL || '')
    .trim()
    .toLowerCase();
  return {
    email,
    name: String(environment.BALDE_LOCAL_NAME || environment.DEV_FAKE_NAME || email).trim(),
    username: email
  };
}

export function localGroups(lookup, environment = process.env) {
  const test = testIdentity.getStore();
  if (test) return test.groups ?? lookup(test.email);
  if (environment.BALDE_GROUPS_FROM_CORPUS === '1') return lookup(localIdentity(environment).email);
  return String(environment.BALDE_LOCAL_GROUPS || environment.DEV_FAKE_GROUPS || '')
    .split(/[|,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

// O processo local é a autoridade de identidade; cabeçalhos de proxy não são credenciais.
export function validateLocalRequest(request, port) {
  if (!LOOPBACK_ADDRESSES.has(request.socket.remoteAddress)) return 'Acesso disponível apenas neste computador.';
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  const host = String(request.headers.host || '').toLowerCase();
  if (!hosts.has(host)) return 'Host local inválido.';
  const origin = request.headers.origin;
  if (origin && origin !== `http://${host}`) return 'Origem da solicitação inválida.';
  if (request.headers['sec-fetch-site'] === 'cross-site') return 'Solicitação de outro site bloqueada.';
  for (const header of Object.keys(request.headers)) {
    if (header.startsWith('x-authentik-') || header.startsWith('x-forwarded-')) delete request.headers[header];
  }
  return null;
}
