import { CAPSULE_CATEGORY_DEFAULT } from '../policy/governance-policy.mjs';
import { readFile } from 'node:fs/promises';
import { parseFrontmatter } from '../skill-format.mjs';
import { actorFromReq } from '../git-corpus.mjs';
import { callAiWithSystemPrompt } from '../ai-provider.mjs';

export function createCapsulesRoutes({
  webActor,
  sendJson,
  loadCapsuleCategories,
  readJsonBody,
  QUEUE_MAX_BODY,
  compileCapsule,
  READONLY_CORPUS,
  createCapsuleQueueItem,
  roleReq,
  normalizeDomainServer,
  loadDomains,
  loadUserAiConfig,
  loadSkillsFromDisk,
  canReadSkillActor,
  listCommonsConcepts,
  isOntologyCapsuleId,
  canReadCommonsActor,
  commonsConceptContextPath,
  domainOntologyId,
  commonsHasConcept,
  loadPromptBody
}) {
  return async function capsulesRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/capsule-categories') {
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      sendJson(res, 200, { ok: true, categories: await loadCapsuleCategories(), default: CAPSULE_CATEGORY_DEFAULT });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/capsule/compile') {
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      let manifest;
      try {
        manifest = await readJsonBody(req, QUEUE_MAX_BODY);
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          errors: [
            {
              code: 'formato-invalido',
              path: '',
              message:
                error.message === 'Payload muito grande.'
                  ? 'Manifesto grande demais.'
                  : 'O corpo da requisição não é JSON válido.'
            }
          ],
          warnings: [],
          plan: []
        });
        return true;
      }
      sendJson(res, 200, await compileCapsule(manifest, webActor(req)));
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/capsule/submit') {
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      let manifest;
      try {
        manifest = await readJsonBody(req, QUEUE_MAX_BODY);
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          submitted: false,
          errors: [
            {
              code: 'formato-invalido',
              path: '',
              message:
                error.message === 'Payload muito grande.'
                  ? 'Manifesto grande demais.'
                  : 'O corpo da requisição não é JSON válido.'
            }
          ],
          warnings: [],
          plan: []
        });
        return true;
      }
      const compiled = await compileCapsule(manifest, READONLY_CORPUS ? null : webActor(req));
      if (!compiled.ok) {
        sendJson(res, 200, {
          ok: false,
          submitted: false,
          errors: compiled.errors,
          warnings: compiled.warnings,
          plan: []
        });
        return true;
      }
      const actor = actorFromReq(req);
      const item = await createCapsuleQueueItem(manifest, compiled, {
        source: 'web',
        submittedBy: { name: actor.name, email: actor.email }
      });
      sendJson(res, 201, {
        ok: true,
        submitted: true,
        queueId: item.id,
        status: item.status,
        plan: compiled.plan,
        warnings: compiled.warnings,
        summary: compiled.summary
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/ontology/suggest') {
      // Só sugere (IA), não grava: basta o papel de curador.
      if (!(await roleReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req);
      const domain = normalizeDomainServer(body.domain);
      if (!domain || !(await loadDomains()).includes(domain)) {
        sendJson(res, 400, { ok: false, error: 'Domínio inválido ou fora do vocabulário governado.' });
        return true;
      }
      const actor = webActor(req);
      const aiConfig = await loadUserAiConfig(actorFromReq(req));
      if (!aiConfig || !aiConfig.apiKey) {
        sendJson(res, 400, { ok: false, error: 'Configure seu provedor de IA em Configurações para gerar sugestões.' });
        return true;
      }
      // Material do domínio, filtrado pelas ACLs do PRÓPRIO usuário (nada restrito vaza no prompt).
      const skills = [];
      for (const s of await loadSkillsFromDisk()) {
        if ((s.domain || String(s.id).split('/')[0]) !== domain) continue;
        if (!(await canReadSkillActor(s.id, actor))) continue;
        let text = '';
        try {
          text = parseFrontmatter(String(s.sourceText || '')).body.trim();
        } catch (error) {
          text = String(s.sourceText || '');
        }
        skills.push({ id: s.id, nome: s.nome || s.id, conteudo: text.slice(0, 3000) });
        if (skills.length >= 12) break;
      }
      const capsulas = [];
      for (const cid of await listCommonsConcepts()) {
        if (cid.split('/')[0] !== domain || isOntologyCapsuleId(cid)) continue;
        if (!(await canReadCommonsActor(cid, actor))) continue;
        let text = '';
        try {
          text = await readFile(commonsConceptContextPath(cid), 'utf8');
        } catch (error) {
          continue;
        }
        capsulas.push({ id: cid, conteudo: text.slice(0, 1500) });
        if (capsulas.length >= 30) break;
      }
      if (!skills.length && !capsulas.length) {
        sendJson(res, 400, {
          ok: false,
          error: 'O domínio ainda não tem skills ou cápsulas legíveis para basear a sugestão.'
        });
        return true;
      }
      // Existing ontology → COMPLEMENT mode: the current markdown joins the payload and the
      // prompt asks for additions only (new concepts + extra synonyms), never rewrites.
      let ontologiaAtual = '';
      const ontoId = domainOntologyId(domain);
      if (await commonsHasConcept(ontoId)) {
        if (!(await canReadCommonsActor(ontoId, actor))) {
          sendJson(res, 404, { ok: false, error: 'conceito não encontrado.' });
          return true;
        }
        try {
          ontologiaAtual = await readFile(commonsConceptContextPath(ontoId), 'utf8');
        } catch (error) {
          ontologiaAtual = '';
        }
      }
      const mode = ontologiaAtual ? 'complemento' : 'nova';
      const promptId = ontologiaAtual ? 'ontologia-complementar' : 'ontologia-sugerir';
      const system = ((await loadPromptBody(promptId)) || '').replaceAll('{{dominio}}', domain);
      if (!system.trim()) {
        sendJson(res, 500, { ok: false, error: `Prompt "${promptId}" ausente — verifique Configurações › Prompts.` });
        return true;
      }
      try {
        const payload = ontologiaAtual
          ? { dominio: domain, ontologiaAtual, skills, capsulas }
          : { dominio: domain, skills, capsulas };
        const text = await callAiWithSystemPrompt(system, payload, aiConfig, false);
        if (!text || !String(text).trim()) {
          sendJson(res, 502, { ok: false, error: 'A IA não retornou sugestão.' });
          return true;
        }
        sendJson(res, 200, {
          ok: true,
          domain,
          mode,
          markdown: String(text).trim(),
          material: { skills: skills.length, capsulas: capsulas.length }
        });
      } catch (error) {
        sendJson(res, 502, { ok: false, error: `Falha ao gerar a sugestão: ${error.message}` });
      }
      return true;
    }
    return false;
  };
}
