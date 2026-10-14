export function createPeopleRoutes({
  webActor,
  sendJson,
  loadRoster,
  loadAuthentikUsers,
  normEmail,
  listGroups,
  isAdminReq,
  loadGroup,
  readJsonBody,
  slugifyGroupName,
  saveGroup,
  refreshCorpusGroupsIndex,
  deleteGroup
}) {
  return async function peopleRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/users') {
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      const [roster, authentik] = await Promise.all([loadRoster(), loadAuthentikUsers()]);
      const byEmail = new Map();
      for (const u of authentik) {
        byEmail.set(u.email, { email: u.email, name: u.name || u.email, username: u.username || '', lastSeen: null });
      }
      for (const u of roster) {
        const email = normEmail(u.email);
        if (!email) continue;
        const existing = byEmail.get(email);
        if (existing) {
          existing.lastSeen = u.lastSeen || existing.lastSeen;
          if ((!existing.name || existing.name === existing.email) && u.name) existing.name = u.name;
          if (!existing.username && u.username) existing.username = u.username;
        } else {
          byEmail.set(email, {
            email,
            name: u.name || email,
            username: u.username || '',
            lastSeen: u.lastSeen || null
          });
        }
      }
      // Annotate each user with their Balde-native group memberships (drives "suggestions based on groups").
      const groups = await listGroups();
      const memberGroups = new Map();
      for (const g of groups) {
        for (const em of g.members || []) {
          const k = normEmail(em);
          if (!k) continue;
          if (!memberGroups.has(k)) memberGroups.set(k, []);
          memberGroups.get(k).push(g.name);
        }
      }
      const users = [...byEmail.values()]
        .map((u) => ({ ...u, groups: memberGroups.get(normEmail(u.email)) || [] }))
        .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email), 'pt-BR'));
      sendJson(res, 200, {
        ok: true,
        users,
        groups: groups.map((g) => ({ slug: g.slug, name: g.name, count: (g.members || []).length })),
        source: authentik.length ? 'authentik+roster' : 'roster'
      });
      return true;
    }

    if (url.pathname === '/api/groups' || url.pathname.startsWith('/api/groups/')) {
      const isAdmin = isAdminReq(req);
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/groups') {
        sendJson(res, 200, { ok: true, groups: await listGroups(), canManage: isAdmin });
        return true;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/groups/')) {
        const slug = decodeURIComponent(url.pathname.slice('/api/groups/'.length)).replace(/\/+$/, '');
        const group = await loadGroup(slug);
        if (!group) {
          sendJson(res, 404, { ok: false, error: 'Grupo não encontrado.' });
          return true;
        }
        sendJson(res, 200, { ok: true, group, canManage: isAdmin });
        return true;
      }
      if (!isAdmin) {
        sendJson(res, 403, { ok: false, error: 'Apenas administradores podem criar ou editar grupos.' });
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/groups') {
        const body = await readJsonBody(req);
        const name = String(body.name || '').trim();
        if (!name) {
          sendJson(res, 400, { ok: false, error: 'Nome do grupo é obrigatório.' });
          return true;
        }
        const slug = slugifyGroupName(body.slug || name);
        if (!slug) {
          sendJson(res, 400, { ok: false, error: 'Nome do grupo inválido.' });
          return true;
        }
        if (await loadGroup(slug)) {
          sendJson(res, 409, { ok: false, error: 'Já existe um grupo com esse identificador.' });
          return true;
        }
        try {
          const group = await saveGroup({
            slug,
            name,
            description: body.description,
            members: body.members,
            actor: webActor(req)
          });
          refreshCorpusGroupsIndex(); // papéis derivados do corpus valem já, sem esperar o timer
          sendJson(res, 200, { ok: true, group });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
        return true;
      }
      if ((req.method === 'PUT' || req.method === 'PATCH') && url.pathname.startsWith('/api/groups/')) {
        const slug = decodeURIComponent(url.pathname.slice('/api/groups/'.length)).replace(/\/+$/, '');
        const existing = await loadGroup(slug);
        if (!existing) {
          sendJson(res, 404, { ok: false, error: 'Grupo não encontrado.' });
          return true;
        }
        const body = await readJsonBody(req);
        try {
          const group = await saveGroup({
            slug,
            name: body.name != null ? body.name : existing.name,
            description: body.description != null ? body.description : existing.description,
            members: body.members != null ? body.members : existing.members,
            actor: webActor(req)
          });
          refreshCorpusGroupsIndex();
          sendJson(res, 200, { ok: true, group });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
        return true;
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/groups/')) {
        const slug = decodeURIComponent(url.pathname.slice('/api/groups/'.length)).replace(/\/+$/, '');
        if (!(await loadGroup(slug))) {
          sendJson(res, 404, { ok: false, error: 'Grupo não encontrado.' });
          return true;
        }
        await deleteGroup(slug, webActor(req));
        refreshCorpusGroupsIndex();
        sendJson(res, 200, { ok: true });
        return true;
      }
      sendJson(res, 405, { ok: false, error: 'Método não suportado.' });
      return true;
    }

    if (url.pathname === '/api/users/persist') {
      sendJson(res, 410, {
        ok: false,
        error: 'A identidade é configurada pelo aplicativo local; esta operação foi descontinuada.'
      });
      return true;
    }
    return false;
  };
}
