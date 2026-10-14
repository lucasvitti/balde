import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isSafeSkillId, assertSafeRelPath } from '../skill-format.mjs';
import { skillsRoot, commonsRoot } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { actorFromReq } from '../git-corpus.mjs';

export function createMergeRoutes({
  permitReq,
  roleReq,
  sendJson,
  readJsonBody,
  QUEUE_MAX_BODY,
  loadUserAiConfig,
  analyseMergeForSkill,
  commonsConceptContextPath,
  resetNodeEvalVerdicts,
  commitCorpus,
  commitRepo,
  loadSkillWorkingContext
}) {
  return async function mergeRoutes(req, res, url) {
    // A mesclagem é um fluxo de gravação (analisar, gravar, publicar): a mesma regra em cada passo.
    if (req.method === 'POST' && url.pathname === '/api/merge/analyse') {
      if (!(await permitReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req, QUEUE_MAX_BODY);
      const skillId = String(body.skillId || '').trim();
      const content = String(body.content || '').trim();
      if (!isSafeSkillId(skillId) || !(await pathExists(join(skillsRoot(), skillId, 'SKILL.md')))) {
        sendJson(res, 400, { ok: false, error: 'Skill de destino inválida.' });
        return true;
      }
      if (!content) {
        sendJson(res, 400, { ok: false, error: 'Sem conteúdo para analisar.' });
        return true;
      }
      const actor = actorFromReq(req);
      const aiConfig = await loadUserAiConfig(actor);
      if (!aiConfig || !aiConfig.apiKey) {
        sendJson(res, 400, { ok: false, error: 'Configure seu provedor e chave de IA em Configurações.' });
        return true;
      }
      try {
        const analysis = await analyseMergeForSkill(skillId, content, aiConfig);
        sendJson(res, 200, { ok: true, analysis });
      } catch (error) {
        sendJson(res, 502, { ok: false, error: `Falha na análise: ${error.message}` });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/merge/write') {
      if (!(await permitReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req, QUEUE_MAX_BODY);
      const skillId = String(body.skillId || '').trim();
      if (!isSafeSkillId(skillId) || !(await pathExists(join(skillsRoot(), skillId, 'SKILL.md')))) {
        sendJson(res, 400, { ok: false, error: 'Skill inválida.' });
        return true;
      }
      const changes = Array.isArray(body.changes) ? body.changes : [];
      const actor = actorFromReq(req);
      try {
        const commonsTouched = [];
        const skillRoot = join(skillsRoot(), skillId);
        for (const c of changes) {
          const content = String(c.content || '');
          const rawPath = String(c.path || '')
            .replace(/\\/g, '/')
            .replace(/^\/+/, '');
          if (!rawPath || rawPath.includes('..')) continue;
          if (c.scope === 'commons') {
            const cid = rawPath.replace(/^commons\//, '');
            if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(cid) || cid.includes('..')) continue;
            const dest = commonsConceptContextPath(cid);
            await mkdir(dirname(dest), { recursive: true });
            await writeFile(dest, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
            commonsTouched.push(cid);
          } else {
            const rel = assertSafeRelPath(rawPath);
            const dest = join(skillRoot, rel);
            if (!dest.startsWith(skillRoot)) continue;
            await mkdir(dirname(dest), { recursive: true });
            await writeFile(dest, content, 'utf8');
          }
        }
        await resetNodeEvalVerdicts('skill', skillId); // merged content changed → force a fresh grade
        await commitCorpus(`skill(${skillId}): merge revisado por ${actor.name || actor.email}`, actor, [skillId]);
        if (commonsTouched.length)
          await commitRepo(commonsRoot(), `commons: merge via revisão de ${skillId}`, actor, commonsTouched);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/merge/context') {
      if (!(await roleReq(req, res, 'curar'))) return true;
      const skillId = String(url.searchParams.get('skillId') || '').trim();
      if (!isSafeSkillId(skillId) || !(await pathExists(join(skillsRoot(), skillId, 'SKILL.md')))) {
        sendJson(res, 400, { ok: false, error: 'Skill inválida.' });
        return true;
      }
      try {
        const working = await loadSkillWorkingContext(skillId);
        const files = [{ scope: 'skill', path: 'SKILL.md', content: working.markdown }];
        const textFiles = (working.files || [])
          .filter((f) => /\.(md|markdown|txt|sql|csv|json)$/i.test(f) && f.toLowerCase() !== 'skill.md')
          .slice(0, 30);
        for (const rel of textFiles) {
          let c = '';
          try {
            c = await readFile(join(working.skillDir, rel), 'utf8');
          } catch (error) {
            /* skip */
          }
          files.push({ scope: 'skill', path: rel, content: c });
        }
        sendJson(res, 200, { ok: true, files });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }
    return false;
  };
}
