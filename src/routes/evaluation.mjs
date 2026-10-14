import { activeRepo } from '../config.mjs';
import { actorFromReq } from '../git-corpus.mjs';

export function createEvaluationRoutes({
  permitReq,
  roleAllowsReq,
  webActor,
  sendJson,
  loadEvalChecklist,
  saveEvalChecklist,
  readJsonBody,
  loadScoringConfig,
  saveScoringConfig
}) {
  return async function evaluationRoutes(req, res, url) {
    // A checklist de qualidade e a pontuação são da curadoria do balde (D1: criador e curadores).
    if (url.pathname === '/api/eval-checklist') {
      const canManagePolicy = await roleAllowsReq(req, 'curar');
      if (req.method === 'GET') {
        if (!webActor(req).email) {
          sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
          return true;
        }
        sendJson(res, 200, {
          ok: true,
          repo: activeRepo(),
          items: await loadEvalChecklist(),
          canManage: canManagePolicy
        });
        return true;
      }
      if (req.method === 'POST') {
        if (!(await permitReq(req, res, 'curar'))) return true;
        const items = await saveEvalChecklist((await readJsonBody(req)).items, actorFromReq(req));
        sendJson(res, 200, { ok: true, repo: activeRepo(), items });
        return true;
      }
    }

    if (url.pathname === '/api/scoring-config') {
      const canManagePolicy = await roleAllowsReq(req, 'curar');
      if (req.method === 'GET') {
        if (!webActor(req).email) {
          sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
          return true;
        }
        sendJson(res, 200, {
          ok: true,
          repo: activeRepo(),
          config: await loadScoringConfig(),
          canManage: canManagePolicy
        });
        return true;
      }
      if (req.method === 'POST') {
        if (!(await permitReq(req, res, 'curar'))) return true;
        const config = await saveScoringConfig(await readJsonBody(req), actorFromReq(req));
        sendJson(res, 200, { ok: true, repo: activeRepo(), config });
        return true;
      }
    }
    return false;
  };
}
