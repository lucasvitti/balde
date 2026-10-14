import { generateGovernanceSuggestions } from '../../scripts/generate-governance-suggestions.mjs';
import { governanceOutputRoot } from '../config.mjs';
import { actorFromReq } from '../git-corpus.mjs';

export function createProposalsRoutes({
  runNodeEval,
  sendJson,
  loadPersistedSuggestionsBySkill,
  readJsonBody,
  loadUserAiConfig,
  generateProposalCompletion,
  callDepartmentProxy,
  fallbackReport,
  permitReq,
  roleReq,
  persistProposalReturn
}) {
  return async function proposalsRoutes(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/governance/generate-suggestions') {
      if (!(await permitReq(req, res, 'curar'))) return true;
      const index = await generateGovernanceSuggestions();
      sendJson(res, 200, index);
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/governance/suggestions') {
      const suggestions = await loadPersistedSuggestionsBySkill();
      sendJson(res, 200, {
        outputRoot: governanceOutputRoot(),
        skills: [...suggestions.values()]
      });
      return true;
    }

    // Ferramentas de IA da curadoria: leem o rascunho e não gravam nada, então bastam o papel (sem a pasta).
    if (req.method === 'POST' && url.pathname === '/api/proposals/generate-ai') {
      if (!(await roleReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req);
      const aiConfig = await loadUserAiConfig(actorFromReq(req));
      const result = await generateProposalCompletion(body, aiConfig);
      sendJson(res, 200, result);
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      if (!(await roleReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req);
      const aiConfig = await loadUserAiConfig(actorFromReq(req));
      const proxyReport = await callDepartmentProxy(body, 'skill_governance_analysis', aiConfig).catch((error) => ({
        provider: 'proxy-error',
        error: error.message,
        ...fallbackReport(body.skill, body.feedback)
      }));

      sendJson(res, 200, proxyReport || fallbackReport(body.skill, body.feedback));
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/run-evals') {
      const body = await readJsonBody(req);
      if (!(await permitReq(req, res, 'curar'))) return true;
      const result = await runNodeEval(
        'skill',
        body.skillId,
        await loadUserAiConfig(actorFromReq(req)),
        actorFromReq(req)
      );
      sendJson(res, 200, {
        ...result,
        ok: true,
        geradoEm: new Date().toISOString(),
        modelo: 'avaliação registrada',
        total: result.items?.length || 0,
        passou: result.items?.filter((item) => item.verdict === 'pass').length || 0,
        divergencias: []
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/return-proposal') {
      const body = await readJsonBody(req);
      if (!(await permitReq(req, res, 'curar'))) return true;
      const returned = await persistProposalReturn({
        skillId: body.skillId,
        changeRequest: body.changeRequest,
        reason: body.reason
      });

      sendJson(res, 200, {
        ok: true,
        timestamp: new Date().toISOString(),
        action: 'return',
        returned
      });
      return true;
    }
    return false;
  };
}
