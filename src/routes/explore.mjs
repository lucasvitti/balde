import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontmatter, isSafeSkillId, parseOkfTags } from '../skill-format.mjs';
import { skillsRoot, buddiesRoot } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { gitHistoryForSkill } from '../git-corpus.mjs';
import { listRelativeFiles } from '../skill-helpers.mjs';

export function createExploreRoutes({
  sendJson,
  roleReq,
  loadSkillWorkingContext,
  loadSkillConsumerContext,
  canReadSkillActor,
  webActor,
  loadCanonicalState,
  recordSkillEvent,
  usageForSkill,
  skillContextManifest,
  fileViewPage,
  searchCorpus
}) {
  return async function exploreRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/explore/skill') {
      const id = String(url.searchParams.get('skill') || '');
      if (!isSafeSkillId(id)) {
        sendJson(res, 400, { ok: false, error: 'skill inválido.' });
        return true;
      }
      const preview = url.searchParams.get('view') === 'working';
      if (preview && !(await roleReq(req, res, 'curar'))) return true;
      const selected = preview ? await loadSkillWorkingContext(id) : await loadSkillConsumerContext(id);
      const skillDir = selected.skillDir;
      const skillPath = selected.skillPath;
      if (!(await pathExists(skillPath))) {
        sendJson(res, 404, { ok: false, error: `Skill "${id}" não encontrada.` });
        return true;
      }
      // Same 404 as not-found: a restricted skill's existence never leaks via the explorer.
      if (!(await canReadSkillActor(id, webActor(req)))) {
        sendJson(res, 404, { ok: false, error: `Skill "${id}" não encontrada.` });
        return true;
      }
      const markdown = await readFile(skillPath, 'utf8');
      const { meta, body } = parseFrontmatter(markdown);
      // Status/version come from the canonical state (the authoritative source the catalog uses),
      // not the raw frontmatter — otherwise a promoted skill whose frontmatter still says `rascunho`
      // renders as "Blueprint" here. Falls back to the frontmatter when the skill isn't promoted.
      const canonicalState = await loadCanonicalState(id);
      const relFiles = await listRelativeFiles(skillDir);
      const files = [];
      for (const rel of relFiles) {
        let size = 0;
        try {
          size = (await stat(join(skillDir, rel))).size;
        } catch (error) {
          /* ignore */
        }
        files.push({ path: rel.replaceAll('\\', '/'), size });
      }
      files.sort((a, b) => a.path.localeCompare(b.path));
      const history = await gitHistoryForSkill(id);
      recordSkillEvent('view', id, 'app', webActor(req)); // in-app open → the skill's read signal
      sendJson(res, 200, {
        ok: true,
        id,
        nome: meta.title || meta.name || id,
        meta: {
          type: meta.type || 'skill',
          status: !preview && canonicalState ? 'canonico' : 'rascunho',
          contentState: preview ? 'draft' : selected.contentState,
          pendingWorkingChanges: selected.pendingWorkingChanges || preview,
          owner: meta.owner || null,
          version: !preview ? canonicalState?.version || meta.version || null : null,
          tags: parseOkfTags(meta.tags),
          timestamp: meta.timestamp || meta.last_reviewed || meta.data_updated || null,
          description: meta.description || null,
          resource: meta.resource || null,
          buddyId: meta.buddy_id || null,
          buddyMissing: meta.buddy_id
            ? !(/^[a-zA-Z0-9._-]+$/.test(meta.buddy_id) && (await pathExists(join(buddiesRoot, meta.buddy_id))))
            : false
        },
        files,
        body,
        markdown,
        history,
        usage: await usageForSkill(id)
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/explore/context') {
      const id = String(url.searchParams.get('skill') || '');
      if (!isSafeSkillId(id)) {
        sendJson(res, 400, { ok: false, error: 'skill inválido.' });
        return true;
      }
      if (!(await pathExists(join(skillsRoot(), id, 'SKILL.md')))) {
        sendJson(res, 404, { ok: false, error: `Skill "${id}" não encontrada.` });
        return true;
      }
      if (!(await canReadSkillActor(id, webActor(req)))) {
        sendJson(res, 404, { ok: false, error: `Skill "${id}" não encontrada.` });
        return true;
      }
      const working = await loadSkillConsumerContext(id);
      const fakeSkill = {
        id,
        sourceText: working.markdown,
        artifactFacts: {
          sourceFolder: working.sourceDir,
          draftFolder: working.hasDraft ? working.draftDir : null,
          files: working.files
        }
      };
      const manifest = await skillContextManifest(fakeSkill);
      sendJson(res, 200, { ok: true, id, ...manifest });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/explore/file') {
      const id = String(url.searchParams.get('skill') || '');
      const rel = String(url.searchParams.get('path') || '');
      if (!isSafeSkillId(id)) {
        sendJson(res, 400, { ok: false, error: 'skill inválido.' });
        return true;
      }
      if (!(await canReadSkillActor(id, webActor(req)))) {
        sendJson(res, 404, { ok: false, error: 'arquivo não encontrado.' });
        return true;
      }
      const skillDir = (await loadSkillConsumerContext(id)).skillDir;
      const target = join(skillDir, rel);
      if (target !== skillDir && !target.startsWith(skillDir + '/') && !target.startsWith(skillDir + '\\')) {
        sendJson(res, 400, { ok: false, error: 'caminho inválido.' });
        return true;
      }
      if (!(await pathExists(target))) {
        sendJson(res, 404, { ok: false, error: 'arquivo não encontrado.' });
        return true;
      }
      const st = await stat(target);
      if (st.isDirectory()) {
        sendJson(res, 400, { ok: false, error: 'caminho é um diretório.' });
        return true;
      }
      // Raw view: serve the file inline (text/plain) so a "Fontes" link can open it
      // in a new browser tab (behind the same SSO as the SPA).
      if (url.searchParams.get('raw') === '1') {
        const buf = await readFile(target);
        if (buf.slice(0, 4096).includes(0)) {
          res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-disposition': 'inline',
            'cache-control': 'no-store'
          });
          res.end(buf);
          return true;
        }
        const html = fileViewPage(rel.replaceAll('\\', '/'), buf.toString('utf8'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
        return true;
      }
      if (st.size > 512 * 1024) {
        sendJson(res, 200, { ok: true, path: rel.replaceAll('\\', '/'), content: '', tooLarge: true, size: st.size });
        return true;
      }
      const raw = await readFile(target, 'utf8');
      // eslint-disable-next-line no-control-regex -- O byte nulo identifica conteúdo binário.
      const binary = /\u0000/.test(raw);
      sendJson(res, 200, {
        ok: true,
        path: rel.replaceAll('\\', '/'),
        content: binary ? '' : raw,
        binary,
        size: st.size
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/search') {
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      const r = await searchCorpus(url.searchParams.get('q'), webActor(req), {
        limit: Number(url.searchParams.get('limit') || 20),
        kind: url.searchParams.get('kind') || ''
      });
      if (r.error) {
        sendJson(res, 400, { ok: false, error: r.error });
        return true;
      }
      sendJson(res, 200, { ok: true, ...r });
      return true;
    }
    return false;
  };
}
