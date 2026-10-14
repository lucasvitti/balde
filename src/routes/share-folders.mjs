// Administração › Pastas do compartilhamento: o acesso de cada pasta do compartilhamento no OneDrive. Só os
// admins da instalação (o grupo Balde - Admins); as rotas só gravam planos nesta máquina, e o SharePoint
// confere os direitos de verdade quando o admin roda o comando com o próprio login.
export function createShareFoldersRoutes({ sendJson, isAdminReq, webActor, shareFolders, ACESSO_ID_RE }) {
  return async function shareFoldersRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/compartilhamento/')) return false;
    if (!isAdminReq(req)) {
      sendJson(res, 403, {
        ok: false,
        error: 'Só os admins da instalação cuidam do acesso às pastas do compartilhamento.'
      });
      return true;
    }
    const route = url.pathname.slice('/api/compartilhamento/'.length);
    if (req.method === 'GET' && route === 'pastas') {
      sendJson(res, 200, { ok: true, ...(await shareFolders.view()) });
      return true;
    }
    if (req.method === 'GET' && route === 'resultado') {
      const id = String(url.searchParams.get('id') || '');
      if (!ACESSO_ID_RE.test(id)) {
        sendJson(res, 400, { ok: false, error: 'id inválido.' });
        return true;
      }
      const result = await shareFolders.result(id);
      sendJson(res, 200, { ok: true, pending: !result, result });
      return true;
    }
    if (req.method === 'POST' && (route === 'verificar' || route === 'plano')) {
      const out =
        route === 'verificar'
          ? await shareFolders.newVerification()
          : await shareFolders.newPlan(
              String(webActor(req).email || '')
                .trim()
                .toLowerCase()
            );
      sendJson(res, out.ok ? 200 : 400, out);
      return true;
    }
    return false;
  };
}
