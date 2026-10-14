import { localIdentity } from '../security/local-session.mjs';
import { AI_PROVIDERS } from '../config.mjs';
import { actorFromReq } from '../git-corpus.mjs';
import { repoByName, isRepoMember } from '../repos.mjs';
import { testAiConfig } from '../ai-provider.mjs';
import { isCliProvider } from '../ai-cli.mjs';
import { mcpSupported } from '../mcp-setup.mjs';

export function createProfileRoutes({
  reqGroups,
  upsertRoster,
  loadUserPrefs,
  sendJson,
  curatesActiveBaldeReq,
  isBaldeAdminReq,
  permissionsReq,
  readJsonBody,
  webActor,
  saveUserPrefs,
  userAiStatus,
  saveUserAiConfig,
  loadUserAiConfig,
  authentikServiceReady,
  listUserApiTokens,
  createUserApiToken,
  revokeUserApiToken,
  revealUserApiToken,
  renameUserApiToken
}) {
  return async function profileRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/me') {
      // A sessão local identifica a pessoa; o manifesto do balde define suas permissões.
      const groups = reqGroups(req);
      const buddyGroup = process.env.BUDDY_AUTHOR_GROUP || 'Balde - Buddy Authors';
      const adminGroup = process.env.ADMIN_GROUP || 'Balde - Admins';
      const identity = {
        email: localIdentity().email || null,
        username: localIdentity().username || null,
        name: localIdentity().name || null
      };
      await upsertRoster({ ...identity, groups }); // roster feeds ACL pickers + the offline notify digest (groups snapshot)
      const prefs = await loadUserPrefs(actorFromReq(req));
      sendJson(res, 200, {
        ...identity,
        groups,
        isCurator: Boolean(await curatesActiveBaldeReq(req)), // curates the ACTIVE balde (curators are per balde)
        isAdmin: groups.includes(adminGroup),
        // curates the ACTIVE balde: the corps, plus the balde's own admins and curators (its
        // manifest), who are not in the global group; the Fila loads contributions for them too
        curatesActiveBalde: Boolean(await curatesActiveBaldeReq(req)),
        // administers the ACTIVE balde (its owners and admin groups): its part of Administração
        baldeAdmin: Boolean(await isBaldeAdminReq(req)),
        // O que esta pessoa pode fazer no balde ativo, como o servidor decide (src/security/permissions.mjs):
        // a interface esconde o que o papel não permite e desabilita, com o motivo, o que falta à pasta.
        permissions: await permissionsReq(req),
        canCreateBuddy: groups.includes(buddyGroup),
        theme: prefs.theme,
        buddySize: prefs.buddySize,
        layout: prefs.layout,
        notify: prefs.notify
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/me/prefs') {
      sendJson(res, 200, { ok: true, ...(await loadUserPrefs(actorFromReq(req))) });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/me/prefs') {
      const body = await readJsonBody(req);
      try {
        const patch = {
          theme: body.theme,
          buddySize: body.buddySize,
          graph: body.graph,
          layout: body.layout,
          notify: body.notify
        };
        if (body.repo !== undefined) {
          // Switching repo: only to a repo the user is actually a member of.
          if (body.repo !== null) {
            const entry = await repoByName(String(body.repo).trim().toLowerCase());
            if (!entry || !isRepoMember(entry, reqGroups(req), webActor(req).email)) {
              sendJson(res, 404, { ok: false, error: `Repo "${body.repo}" não existe ou você não é membro.` });
              return true;
            }
          }
          patch.repo = body.repo;
        }
        const saved = await saveUserPrefs(actorFromReq(req), patch);
        sendJson(res, 200, { ok: true, ...saved });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/me/ai') {
      sendJson(res, 200, { ok: true, ...(await userAiStatus(actorFromReq(req))), providers: AI_PROVIDERS });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/me/ai') {
      const body = await readJsonBody(req);
      try {
        const status = await saveUserAiConfig(actorFromReq(req), {
          provider: body.provider,
          model: body.model,
          baseUrl: body.baseUrl,
          apiKey: body.apiKey,
          clearKey: body.clearKey === true
        });
        sendJson(res, 200, { ok: true, ...status });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message || 'Falha ao salvar configuração de IA.' });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/me/ai/test') {
      const body = await readJsonBody(req);
      let aiConfig;
      if (isCliProvider(body.provider)) {
        // teste do cliente local: dispensa chave — o CLI usa a conta logada da máquina
        aiConfig = {
          provider: String(body.provider),
          model: String(body.model || '').trim(),
          baseUrl: '',
          apiKey: 'cli'
        };
      } else if (body.apiKey && String(body.apiKey).trim()) {
        aiConfig = {
          provider: AI_PROVIDERS.includes(body.provider) ? body.provider : 'openai',
          model: String(body.model || '').trim(),
          baseUrl: String(body.baseUrl || '').trim(),
          apiKey: String(body.apiKey).trim()
        };
      } else {
        aiConfig = await loadUserAiConfig(actorFromReq(req));
      }
      if (!aiConfig || !aiConfig.apiKey) {
        sendJson(res, 400, { ok: false, error: 'Nenhuma chave para testar — salve uma chave ou digite uma no campo.' });
        return true;
      }
      const result = await testAiConfig(aiConfig);
      sendJson(res, result.ok ? 200 : 400, result);
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/me/tokens') {
      if (!authentikServiceReady()) {
        // On a local (Windows shell) install there ARE no personal tokens — the MCP connector uses the
        // machine key automatically. mcpLocal lets the UI say that instead of "ask an admin".
        sendJson(res, 200, { ok: true, serviceReady: false, mcpLocal: mcpSupported(), tokens: [] });
        return true;
      }
      try {
        const tokens = await listUserApiTokens(actorFromReq(req));
        sendJson(res, 200, { ok: true, serviceReady: true, tokens });
      } catch (error) {
        sendJson(res, 200, { ok: false, serviceReady: true, tokens: [], error: error.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/me/tokens') {
      const body = await readJsonBody(req);
      try {
        const created = await createUserApiToken(actorFromReq(req), String(body.label || '').slice(0, 60));
        sendJson(res, 201, { ok: true, identifier: created.identifier, key: created.key }); // key shown ONCE
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/me/tokens/revoke') {
      const body = await readJsonBody(req);
      try {
        await revokeUserApiToken(actorFromReq(req), body.identifier);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/me/tokens/reveal') {
      const body = await readJsonBody(req);
      try {
        const key = await revealUserApiToken(actorFromReq(req), body.identifier);
        sendJson(res, 200, { ok: true, identifier: body.identifier, key });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/me/tokens/rename') {
      const body = await readJsonBody(req);
      try {
        const description = await renameUserApiToken(
          actorFromReq(req),
          body.identifier,
          String(body.label || '').slice(0, 60)
        );
        sendJson(res, 200, { ok: true, identifier: body.identifier, description });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }
    return false;
  };
}
