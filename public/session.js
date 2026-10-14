const nativeFetch = window.fetch.bind(window);

// O fragmento não vai ao HTTP, aos logs nem ao Referer; vira cookie inacessível ao JavaScript.
function takeSessionToken() {
  const parameters = new URLSearchParams(location.hash.slice(1));
  const token = parameters.get('session');
  if (!token) return null;
  parameters.delete('session');
  history.replaceState(null, '', location.pathname + location.search + (parameters.size ? '#' + parameters : ''));
  return token;
}

const startSession = (token) =>
  nativeFetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token })
  });

const token = takeSessionToken();
if (token) {
  const response = await startSession(token);
  if (!response.ok) {
    document.querySelector('#app').textContent = 'Sessão inválida. Abra o Balde pelo aplicativo local.';
    throw new Error('Falha ao iniciar a sessão local.');
  }
}

// O app reabre o mesmo endereço com uma sessão nova (servidor reiniciado, sessão vencida). Quando só o
// fragmento muda, a página não recarrega sozinha: troca a sessão aqui e recarrega.
window.addEventListener('hashchange', async () => {
  const renewed = takeSessionToken();
  if (!renewed) return;
  const response = await startSession(renewed).catch(() => null);
  if (response?.ok) location.reload();
});

// Dentro do app, uma sessão que deixou de valer (inatividade longa, servidor reiniciado por fora) é
// pedida de novo ao app, que reabre a página com uma sessão nova. Num navegador comum fica a mensagem.
let renewalRequested = false;
window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  if (
    response.status === 401 &&
    response.headers.get('x-balde-session') === 'required' &&
    !renewalRequested &&
    window.chrome?.webview
  ) {
    renewalRequested = true;
    window.chrome.webview.postMessage({ type: 'renew-session', path: location.pathname + location.search });
  }
  return response;
};

// A sessão expira por inatividade; com a janela aberta, mesmo na bandeja, um pedido leve a mantém.
setInterval(
  () => {
    nativeFetch('/api/session/ping').catch(() => {});
  },
  20 * 60 * 1000
);
