import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

export function createBrowserSession(
  configuredKey = process.env.BALDE_WEB_SESSION_KEY,
  { now = Date.now, ttlMs = 12 * 60 * 60 * 1000, maxSessions = 32 } = {}
) {
  // Sem chave configurada, quem iniciou o servidor é um app anterior à 2.0.16, que não abre sessão.
  // Nesse modo legado o limite local (loopback, Host, Origin) segue valendo e a sessão não é exigida;
  // o OneDrive entrega app e release em momentos diferentes, e o app antigo precisa continuar abrindo.
  const legacy = !configuredKey;
  const key = configuredKey || randomBytes(32).toString('hex');
  if (key.length < 32) throw new Error('A chave de sessão local precisa de pelo menos 32 caracteres.');
  const sessions = new Map();
  const cookieToken = (request) =>
    String(request.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('balde_session='))
      ?.slice('balde_session='.length);
  const equal = (value) => {
    const supplied = Buffer.from(String(value || ''));
    const expected = Buffer.from(key);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };
  return {
    key,
    legacy,
    proof: (challenge) => createHmac('sha256', key).update(String(challenge)).digest('hex'),
    accepts: equal,
    authenticated(request) {
      if (equal(request.headers['x-balde-session'])) return true;
      const token = cookieToken(request);
      const expiresAt = sessions.get(token);
      if (!expiresAt || expiresAt <= now()) {
        sessions.delete(token);
        return false;
      }
      // O prazo conta da última vez que a sessão foi usada: uma janela aberta o dia todo não expira.
      sessions.set(token, now() + ttlMs);
      return true;
    },
    issueCookie() {
      for (const [token, expiresAt] of sessions) if (expiresAt <= now()) sessions.delete(token);
      while (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value);
      // O navegador recebe um identificador revogável, nunca a chave persistente do aplicativo. É um
      // cookie de sessão (sem Max-Age): dura enquanto a janela do app existir, e o prazo é o do servidor.
      const token = randomBytes(32).toString('hex');
      sessions.set(token, now() + ttlMs);
      return `balde_session=${token}; Path=/; HttpOnly; SameSite=Strict`;
    },
    revoke(request) {
      sessions.delete(cookieToken(request));
    }
  };
}
