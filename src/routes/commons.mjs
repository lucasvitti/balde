import { CADENCE_DAYS, CAPSULE_CATEGORY_DEFAULT, COMMONS_CONCEPT_FILE } from '../policy/governance-policy.mjs';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertSafeRelPath } from '../skill-format.mjs';
import { commonsRoot, activeRepo } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { actorFromReq, gitHistoryForPath } from '../git-corpus.mjs';
import { inspectDataset, datasetTableName } from '../duckdb.mjs';
import { callAiWithSystemPrompt, callAiVisionDescribe } from '../ai-provider.mjs';
import { listRelativeFiles } from '../skill-helpers.mjs';
import {
  archiveFolder,
  listArchivedFolders,
  restoreFolder,
  ArchiveError,
  CAPSULE_ARCHIVE_DIR
} from '../governance/archive.mjs';

export function createCommonsRoutes({
  readJsonBody,
  commonsHasConcept,
  sendJson,
  canReadCommonsReq,
  DATASET_EXT_RE,
  webActor,
  commonsListForActor,
  permitReq,
  roleReq,
  roleAllowsReq,
  permissionsReq,
  corpusLinkIndex,
  invalidateCorpusIndexes,
  normalizeDomainServer,
  loadDomains,
  createDomainDenial,
  capsuleOutboundLink,
  commonsConceptContextPath,
  writeWizardMediaDescriptions,
  stampCreator,
  normSerieField,
  normPeriodoField,
  capsuleCategoryKeys,
  normCapsuleCategory,
  pushApproval,
  commonsConceptGovPath,
  writeCommonsAccessDoc,
  normEmail,
  commitRepo,
  listMediaFiles,
  MEDIA_IMG_EXTS,
  MEDIA_DATA_EXTS,
  loadCommonsConceptGov,
  isCommonsMediaFile,
  loadCommonsAccess,
  normEmailList,
  nodeEvalView,
  saveNodeEval,
  loadUserAiConfig,
  runNodeEval,
  testEvalCase,
  suggestEvalCases,
  saveCommonsConceptGov,
  saveCommonsDefaults,
  draftConceptEvalCriteria,
  gradeConceptEval,
  listCommonsConcepts,
  summarizeContextFilesWithAI,
  CONTEXT_INDEX_FILE,
  processConceptMedia,
  conceptMediaEntries,
  MEDIA_IMG_MAX_BYTES,
  mediaMimeFor,
  MEDIA_IMG_SYSTEM,
  MEDIA_DATA_MAX_BYTES,
  MEDIA_DATA_SYSTEM,
  resolveCommonsFileAsset,
  serveFileBytes,
  commonsFilePage,
  corpusIndexCacheByRepo,
  corpusLinkCacheByRepo
}) {
  return async function commonsRoutes(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/commons/data-inspect') {
      const body = await readJsonBody(req);
      const cid = String(body.concept || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      const rel = String(body.file || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (!cid || cid.includes('..') || !(await commonsHasConcept(cid))) {
        sendJson(res, 404, { ok: false, error: 'Cápsula não encontrada.' });
        return true;
      }
      if (!(await canReadCommonsReq(req, cid))) {
        sendJson(res, 404, { ok: false, error: 'Cápsula não encontrada.' });
        return true;
      }
      if (!rel.startsWith('data/') || !DATASET_EXT_RE.test(rel) || rel.includes('..')) {
        sendJson(res, 400, { ok: false, error: 'Informe um arquivo data/*.csv ou data/*.parquet da cápsula.' });
        return true;
      }
      const abs = join(commonsRoot(), cid, rel);
      if (!abs.startsWith(join(commonsRoot(), cid)) || !(await pathExists(abs))) {
        sendJson(res, 404, { ok: false, error: `"${rel}" não existe nesta cápsula.` });
        return true;
      }
      const result = await inspectDataset({ table: datasetTableName(rel), path: abs });
      sendJson(res, result.ok ? 200 : 400, { ...result, path: `commons/${cid}/${rel}`, table: datasetTableName(rel) });
      return true;
    }

    // Arquivar e restaurar cápsulas (D6), como as skills: a pasta inteira vai para commons/.archived/<id>/ e
    // volta ao mesmo id; enquanto arquivada, nenhuma listagem, chat ou MCP a vê. Os links das skills para ela
    // ficam quebrados até a restauração: a resposta diz quais skills apontavam para ela.
    if (req.method === 'GET' && url.pathname === '/api/commons/archived') {
      if (!(await roleReq(req, res, 'curar'))) return true;
      sendJson(res, 200, {
        ok: true,
        archived: await listArchivedFolders({
          root: commonsRoot(),
          marker: COMMONS_CONCEPT_FILE,
          archiveDir: CAPSULE_ARCHIVE_DIR
        })
      });
      return true;
    }
    if (req.method === 'POST' && (url.pathname === '/api/commons/archive' || url.pathname === '/api/commons/restore')) {
      if (!(await permitReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req);
      const actor = actorFromReq(req);
      const who = actor.name || actor.email || 'curador';
      try {
        if (url.pathname === '/api/commons/archive') {
          const id = String(body.path || '')
            .replace(/\\/g, '/')
            .replace(/^\/+/, '');
          if (!(await commonsHasConcept(id))) {
            sendJson(res, 404, { ok: false, error: 'Cápsula não encontrada.' });
            return true;
          }
          const backlinks = (await corpusLinkIndex()).backlinks.get(`commons/${id}`) || [];
          const linkedFrom = [...new Set(backlinks.map((link) => link.fromSkill))].sort();
          const archived = await archiveFolder({
            root: commonsRoot(),
            id,
            marker: COMMONS_CONCEPT_FILE,
            archiveDir: CAPSULE_ARCHIVE_DIR,
            actor
          });
          await commitRepo(commonsRoot(), `commons: ${id} arquivada por ${who}`, actor, archived.paths);
          invalidateCorpusIndexes();
          sendJson(res, 200, { ok: true, id, archivedId: archived.archivedId, linkedFrom });
        } else {
          const restored = await restoreFolder({
            root: commonsRoot(),
            archivedId: body.archivedId,
            marker: COMMONS_CONCEPT_FILE,
            archiveDir: CAPSULE_ARCHIVE_DIR
          });
          await commitRepo(commonsRoot(), `commons: ${restored.id} restaurada por ${who}`, actor, restored.paths);
          invalidateCorpusIndexes();
          sendJson(res, 200, { ok: true, id: restored.id });
        }
      } catch (error) {
        if (!(error instanceof ArchiveError)) throw error;
        sendJson(res, error.status, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/commons') {
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      // Enriched: summary (AI/heuristic) + referencedBy (discovery) + governance (cadence/eval) + roll-up.
      const data = await commonsListForActor(webActor(req));
      sendJson(res, 200, { ok: true, ...data, canManage: await roleAllowsReq(req, 'curar') });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/commons/new') {
      if (!(await permitReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req);
      // Commons ids keep underscores (e.g. dados_vendas/dicionario_dados) — NOT slugifySkillId (kebabs).
      const slugSeg = (s) =>
        String(s || '')
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^[-]+|[-]+$/g, '')
          .slice(0, 60);
      // Domain comes from the ONE governed vocabulary shared with skills (normalizeDomainServer).
      const domain = normalizeDomainServer(body.domain);
      const concept = slugSeg(body.concept);
      if (!domain || !concept) {
        sendJson(res, 400, { ok: false, error: 'Informe domínio e conceito (formam o caminho <domínio>/<conceito>).' });
        return true;
      }
      if (!(await loadDomains()).includes(domain)) {
        sendJson(res, 400, {
          ok: false,
          error: `Domínio "${domain}" não está no vocabulário governado. Um admin pode adicioná-lo em Administração › Domínios.`
        });
        return true;
      }
      const denyCapsule = await createDomainDenial(webActor(req), domain);
      if (denyCapsule) {
        sendJson(res, 403, { ok: false, error: denyCapsule });
        return true;
      }
      const id = `${domain}/${concept}`;
      if (await commonsHasConcept(id)) {
        sendJson(res, 409, { ok: false, error: `Já existe um conceito em "${id}".` });
        return true;
      }
      const conceptDir = join(commonsRoot(), id);

      // Decode media up front (img/ + data/ only); no half-written concept.
      const decoded = [];
      try {
        for (const file of Array.isArray(body.files) ? body.files : []) {
          const rel = assertSafeRelPath(String((file && file.relPath) || ''));
          const seg = rel.split('/')[0];
          if (seg !== 'img' && seg !== 'data') throw new Error(`Mídia deve ir para img/ ou data/: ${rel}`);
          const payload = String((file && file.base64) || '');
          if (!payload) throw new Error(`Arquivo sem conteúdo: ${rel}`);
          const targetPath = join(conceptDir, rel);
          if (!targetPath.startsWith(conceptDir)) throw new Error(`Caminho inválido: ${rel}`);
          decoded.push({
            targetPath,
            rel,
            description: String((file && file.description) || ''),
            content: Buffer.from(payload, 'base64')
          });
        }
      } catch (fileError) {
        sendJson(res, 400, { ok: false, error: fileError.message || 'Anexo inválido.' });
        return true;
      }

      const actor = actorFromReq(req);
      const who = actor.name || actor.email || 'curador';
      const title = String(body.title || '').trim();
      const summary = String(body.summary || '').trim();
      // context.md: use the provided body, else a minimal template from title/summary.
      let content = String(body.body || '').trim();
      if (!content) content = `# ${title || concept}\n\n${summary || 'Descreva o conceito compartilhado aqui.'}`;
      else if (title && !/^#\s/m.test(content)) content = `# ${title}\n\n${content}`;
      const badLinkNew = capsuleOutboundLink(content);
      if (badLinkNew) {
        sendJson(res, 400, {
          ok: false,
          error: `Cápsulas são atômicas: não podem referenciar outras cápsulas ou skills (link encontrado: ${badLinkNew}).`
        });
        return true;
      }

      await mkdir(conceptDir, { recursive: true });
      await writeFile(commonsConceptContextPath(id), content.endsWith('\n') ? content : `${content}\n`, 'utf8');
      for (const f of decoded) {
        await mkdir(dirname(f.targetPath), { recursive: true });
        await writeFile(f.targetPath, f.content);
      }
      await writeWizardMediaDescriptions(conceptDir, decoded);

      // Per-concept governed-node ledger (creator + owner/curators + optional locked cadence + eval).
      const gov = {};
      stampCreator(gov, actor);
      if (String(body.owner || '').trim()) gov.owner = String(body.owner).trim();
      const curators = Array.isArray(body.curators)
        ? body.curators
            .map((c) =>
              String(c || '')
                .trim()
                .toLowerCase()
            )
            .filter((c) => c.includes('@'))
        : [];
      if (curators.length) gov.curators = curators;
      if (summary) gov.summary = summary;
      // Linha do tempo: optional temporal-series marking (serie + ISO periodo).
      const serieNew = normSerieField(body.serie);
      const periodoNew = normPeriodoField(body.periodo);
      if (periodoNew === null) {
        sendJson(res, 400, {
          ok: false,
          error: 'Período inválido — use os formatos 2026, 2026-07, 2026-W31 ou 2026-07-15.'
        });
        return true;
      }
      if (serieNew) gov.serie = serieNew;
      if (periodoNew) gov.periodo = periodoNew;
      const catKeys = await capsuleCategoryKeys();
      const catNew = normCapsuleCategory(body.categoria, catKeys);
      if (catNew === null) {
        sendJson(res, 400, { ok: false, error: `Categoria inválida — use ${catKeys.join(', ')}.` });
        return true;
      }
      gov.categoria = catNew || CAPSULE_CATEGORY_DEFAULT;
      const tituloNew = String(body.titulo || body.title || '')
        .trim()
        .slice(0, 120);
      if (tituloNew) gov.titulo = tituloNew;
      const seedCadence = CADENCE_DAYS[String(body.cadence || '')] ? String(body.cadence) : '';
      if (seedCadence) {
        gov.cadence = seedCadence;
        gov.cadenceLockedAt = new Date().toISOString();
        gov.cadenceLockedBy = who;
        pushApproval(gov, 'cadence', seedCadence, actor);
      }
      const seedCriteria = Array.isArray(body.evalCriteria)
        ? body.evalCriteria
            .map((s) => String(s || '').trim())
            .filter(Boolean)
            .slice(0, 20)
        : [];
      if (seedCriteria.length) {
        gov.evalCriteria = seedCriteria;
        pushApproval(gov, 'eval-criteria', `${seedCriteria.length} critério(s)`, actor);
      }
      pushApproval(gov, 'created', id, actor);
      await writeFile(commonsConceptGovPath(id), JSON.stringify(gov, null, 2), 'utf8');

      // Visibilidade (wizard): pública por padrão; restrita grava ACCESS.yml com o criador
      // sempre listado como curador — a cápsula nunca nasce trancada para quem a criou.
      const wizVis = body.visibility === 'restricted' ? 'restricted' : 'public';
      const wizReaders = Array.isArray(body.readers) ? body.readers : [];
      if (wizVis === 'restricted' || wizReaders.length) {
        await writeCommonsAccessDoc(id, {
          visibility: wizVis,
          curators:
            wizVis === 'restricted'
              ? [...new Set([...curators, normEmail(actor.email || '')].filter((e) => e && e.includes('@')))]
              : curators,
          readers: wizReaders
        });
      }

      await commitRepo(commonsRoot(), `commons(${id}): novo conceito por ${who}`, actor, [id]);
      const mediaCount = {
        img: (await listMediaFiles(join(conceptDir, 'img'), MEDIA_IMG_EXTS)).length,
        data: (await listMediaFiles(join(conceptDir, 'data'), MEDIA_DATA_EXTS)).length
      };
      sendJson(res, 200, { ok: true, id, path: id, link: `/commons/${id}`, visibility: wizVis, media: mediaCount });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/commons/edit') {
      const id = String(url.searchParams.get('path') || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (!id || id.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(id)) {
        sendJson(res, 400, { ok: false, error: 'caminho inválido.' });
        return true;
      }
      if (!(await commonsHasConcept(id))) {
        sendJson(res, 404, { ok: false, error: 'conceito não encontrado.' });
        return true;
      }
      if (!(await roleReq(req, res, 'curar'))) return true;
      const conceptDir = join(commonsRoot(), id);
      const content = await readFile(commonsConceptContextPath(id), 'utf8');
      const headMatch = content.match(/^#\s+(.+)$/m);
      const gov = await loadCommonsConceptGov(id);
      const media = [];
      for (const rel of (await listRelativeFiles(conceptDir)).map((r) => r.replaceAll('\\', '/'))) {
        if (!isCommonsMediaFile(rel)) continue;
        let size = 0;
        try {
          size = (await stat(join(conceptDir, rel))).size;
        } catch (e) {
          /* ignore */
        }
        media.push({ relPath: rel, size });
      }
      media.sort((a, b) => a.relPath.localeCompare(b.relPath));
      const parts = id.split('/');
      sendJson(res, 200, {
        ok: true,
        id,
        domain: parts[0] || '',
        concept: parts.slice(1).join('/'),
        title: headMatch ? headMatch[1].trim() : parts.slice(1).join('/') || id,
        summary: gov.summary || '',
        body: content,
        owner: gov.owner || '',
        curators: Array.isArray(gov.curators) ? gov.curators : [],
        cadence: gov.cadence || '',
        evalCriteria: Array.isArray(gov.evalCriteria) ? gov.evalCriteria : [],
        cadenceLocked: !!gov.cadenceLockedAt,
        cadenceLockedBy: gov.cadenceLockedBy || null,
        serie: gov.serie || '',
        categoria: gov.categoria || 'dado',
        titulo: gov.titulo || '',
        periodo: gov.periodo || '',
        access: await loadCommonsAccess(id),
        media
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/commons/update') {
      const body = await readJsonBody(req);
      const id = String(body.path || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (!id || id.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(id)) {
        sendJson(res, 400, { ok: false, error: 'caminho inválido.' });
        return true;
      }
      if (!(await commonsHasConcept(id))) {
        sendJson(res, 404, { ok: false, error: 'conceito não encontrado.' });
        return true;
      }
      if (!(await permitReq(req, res, 'curar'))) return true;
      if ((await loadCommonsConceptGov(id)).closedAt) {
        sendJson(res, 409, {
          ok: false,
          error: 'Cápsula FECHADA — o conteúdo está congelado como fato passado. Reabra na Governança para editar.'
        });
        return true;
      }
      const conceptDir = join(commonsRoot(), id);
      const actor = actorFromReq(req);
      const who = actor.name || actor.email || 'curador';

      // Decode NEW media up front (img/ + data/ only) so a bad attachment fails before any write.
      const decoded = [];
      try {
        for (const file of Array.isArray(body.files) ? body.files : []) {
          const rel = assertSafeRelPath(String((file && file.relPath) || ''));
          const seg = rel.split('/')[0];
          if (seg !== 'img' && seg !== 'data') throw new Error(`Mídia deve ir para img/ ou data/: ${rel}`);
          const payload = String((file && file.base64) || '');
          if (!payload) throw new Error(`Arquivo sem conteúdo: ${rel}`);
          const targetPath = join(conceptDir, rel);
          if (!targetPath.startsWith(conceptDir)) throw new Error(`Caminho inválido: ${rel}`);
          decoded.push({
            targetPath,
            rel,
            description: String((file && file.description) || ''),
            content: Buffer.from(payload, 'base64')
          });
        }
      } catch (fileError) {
        sendJson(res, 400, { ok: false, error: fileError.message || 'Anexo inválido.' });
        return true;
      }

      // context.md from title + body (mirrors /new: prepend the title heading only when body has none).
      const title = String(body.title || '').trim();
      const summary = String(body.summary || '').trim();
      let content = String(body.body || '').trim();
      if (!content)
        content = `# ${title || id.split('/').pop()}\n\n${summary || 'Descreva o conceito compartilhado aqui.'}`;
      else if (title && !/^#\s/m.test(content)) content = `# ${title}\n\n${content}`;
      const badLinkUpd = capsuleOutboundLink(content);
      if (badLinkUpd) {
        sendJson(res, 400, {
          ok: false,
          error: `Cápsulas são atômicas: não podem referenciar outras cápsulas ou skills (link encontrado: ${badLinkUpd}).`
        });
        return true;
      }
      await writeFile(commonsConceptContextPath(id), content.endsWith('\n') ? content : `${content}\n`, 'utf8');

      // Full media management: reconcile img/ + data/ to the desired set (guarded on existingFiles).
      if (Array.isArray(body.existingFiles)) {
        const keepMap = new Map();
        for (const ef of body.existingFiles) {
          try {
            const orig = assertSafeRelPath(String((ef && ef.origPath) || (ef && ef.relPath) || '')).replaceAll(
              '\\',
              '/'
            );
            const dest = assertSafeRelPath(String((ef && ef.relPath) || (ef && ef.origPath) || '')).replaceAll(
              '\\',
              '/'
            );
            if (orig) keepMap.set(orig, dest);
          } catch (e) {
            /* skip malformed */
          }
        }
        const onDisk = (await listRelativeFiles(conceptDir))
          .map((r) => r.replaceAll('\\', '/'))
          .filter((r) => isCommonsMediaFile(r));
        for (const rel of onDisk) {
          if (!keepMap.has(rel)) await rm(join(conceptDir, rel), { force: true }).catch(() => {});
        }
        for (const [orig, dest] of keepMap) {
          if (orig === dest) continue;
          const from = join(conceptDir, orig);
          const to = join(conceptDir, dest);
          if (!to.startsWith(conceptDir) || !(await pathExists(from))) continue;
          await mkdir(dirname(to), { recursive: true });
          try {
            await rename(from, to);
          } catch (e) {
            await cp(from, to);
            await rm(from, { force: true });
          }
        }
      }
      for (const f of decoded) {
        await mkdir(dirname(f.targetPath), { recursive: true });
        await writeFile(f.targetPath, f.content);
      }
      await writeWizardMediaDescriptions(conceptDir, decoded);

      // Governance: preserve creator + approvals; update owner/curators/summary/cadence/eval.
      const gov = await loadCommonsConceptGov(id);
      stampCreator(gov, actor);
      gov.owner = String(body.owner || '').trim() || gov.owner || '';
      gov.curators = Array.isArray(body.curators)
        ? body.curators
            .map((c) =>
              String(c || '')
                .trim()
                .toLowerCase()
            )
            .filter((c) => c.includes('@'))
        : gov.curators || [];
      if (summary) gov.summary = summary;
      else delete gov.summary;
      // Linha do tempo: serie/periodo update — empty clears, invalid periodo rejects.
      if (body.serie !== undefined) {
        const s = normSerieField(body.serie);
        if (s) gov.serie = s;
        else delete gov.serie;
      }
      if (body.periodo !== undefined) {
        const p = normPeriodoField(body.periodo);
        if (p === null) {
          sendJson(res, 400, {
            ok: false,
            error: 'Período inválido — use os formatos 2026, 2026-07, 2026-W31 ou 2026-07-15.'
          });
          return true;
        }
        if (p) gov.periodo = p;
        else delete gov.periodo;
      }
      if (body.titulo !== undefined || body.title !== undefined) {
        const tt = String((body.titulo !== undefined ? body.titulo : body.title) || '')
          .trim()
          .slice(0, 120);
        if (tt) gov.titulo = tt;
        else delete gov.titulo;
      }
      if (body.categoria !== undefined) {
        const catKeysUpd = await capsuleCategoryKeys();
        const c = normCapsuleCategory(body.categoria, catKeysUpd);
        if (c === null) {
          sendJson(res, 400, { ok: false, error: `Categoria inválida — use ${catKeysUpd.join(', ')}.` });
          return true;
        }
        if (c && c !== gov.categoria) pushApproval(gov, 'categoria', c, actor);
        if (c) gov.categoria = c;
      }
      const wantCadence = CADENCE_DAYS[String(body.cadence || '')] ? String(body.cadence) : '';
      if (wantCadence && wantCadence !== gov.cadence && (!gov.cadenceLockedAt || (await roleAllowsReq(req, 'curar')))) {
        gov.cadence = wantCadence;
        if (!gov.cadenceLockedAt) {
          gov.cadenceLockedAt = new Date().toISOString();
          gov.cadenceLockedBy = who;
        }
        pushApproval(gov, 'cadence', wantCadence, actor);
      }
      if (Array.isArray(body.evalCriteria)) {
        gov.evalCriteria = body.evalCriteria
          .map((s) => String(s || '').trim())
          .filter(Boolean)
          .slice(0, 20);
        pushApproval(gov, 'eval-criteria', `${gov.evalCriteria.length} critério(s)`, actor);
      }
      pushApproval(gov, 'edited', id, actor);
      await writeFile(commonsConceptGovPath(id), JSON.stringify(gov, null, 2), 'utf8');

      // Visibilidade (wizard): quando o formulário declara, a política é regravada. Restrita
      // mantém quem edita listado como curador (nunca se tranca); grupos existentes preservados.
      if (body.visibility === 'public' || body.visibility === 'restricted') {
        const prevAcc = await loadCommonsAccess(id);
        const nextReaders = Array.isArray(body.readers) ? body.readers : prevAcc.readers;
        const baseCurs = Array.isArray(body.curators) ? body.curators : prevAcc.curators;
        await writeCommonsAccessDoc(id, {
          visibility: body.visibility,
          curators:
            body.visibility === 'restricted'
              ? [
                  ...new Set(
                    [...normEmailList(baseCurs), normEmail(actor.email || '')].filter((e) => e && e.includes('@'))
                  )
                ]
              : baseCurs,
          curator_groups: prevAcc.curator_groups,
          readers: nextReaders,
          reader_groups: prevAcc.reader_groups
        });
      }

      await commitRepo(commonsRoot(), `commons(${id}): editado por ${who}`, actor, [id]);
      const mediaCount = {
        img: (await listMediaFiles(join(conceptDir, 'img'), MEDIA_IMG_EXTS)).length,
        data: (await listMediaFiles(join(conceptDir, 'data'), MEDIA_DATA_EXTS)).length
      };
      sendJson(res, 200, { ok: true, id, path: id, link: `/commons/${id}`, media: mediaCount });
      return true;
    }

    if (
      url.pathname === '/api/commons/eval' ||
      url.pathname === '/api/commons/eval/run' ||
      url.pathname === '/api/commons/eval/test' ||
      url.pathname === '/api/commons/eval/suggest'
    ) {
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      const isRun = url.pathname.endsWith('/run');
      const isTest = url.pathname.endsWith('/test');
      const isSuggest = url.pathname.endsWith('/suggest');
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const id = String(req.method === 'GET' ? url.searchParams.get('path') || '' : body.path || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (!id || id.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(id)) {
        sendJson(res, 400, { ok: false, error: 'caminho inválido.' });
        return true;
      }
      if (!(await commonsHasConcept(id))) {
        sendJson(res, 404, { ok: false, error: 'conceito não encontrado.' });
        return true;
      }
      if (!(await canReadCommonsReq(req, id))) {
        sendJson(res, 404, { ok: false, error: 'conceito não encontrado.' });
        return true;
      }
      // Transcripts (prompt/resposta/teste) são bytes de gestão — leitores recebem só os vereditos,
      // espelhando o gate da skill (manage) e o embed /api/v1 ({transcripts:false}).
      if (req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          eval: await nodeEvalView('commons', id, { transcripts: await roleAllowsReq(req, 'curar') })
        });
        return true;
      }
      // Pedir sugestões à IA não grava nada: basta o papel. O resto grava e pede também a pasta.
      if (req.method === 'POST' && !(await (isSuggest ? roleReq : permitReq)(req, res, 'curar'))) return true;
      if (req.method === 'POST' && !isRun && !isTest && !isSuggest) {
        await saveNodeEval('commons', id, body, actorFromReq(req));
        sendJson(res, 200, { ok: true, eval: await nodeEvalView('commons', id) });
        return true;
      }
      if (req.method === 'POST') {
        const actor = actorFromReq(req);
        const aiConfig = await loadUserAiConfig(actor);
        if (!aiConfig || !aiConfig.apiKey) {
          sendJson(res, 400, { ok: false, error: 'Configure seu provedor e chave de IA em Configurações.' });
          return true;
        }
        if (isRun) {
          sendJson(res, 200, { ok: true, eval: await runNodeEval('commons', id, aiConfig, actor) });
          return true;
        }
        try {
          if (isSuggest) {
            sendJson(res, 200, { ok: true, cases: await suggestEvalCases('commons', id, aiConfig) });
            return true;
          }
          const { view, warning } = await testEvalCase('commons', id, body.itemId, aiConfig, actor, webActor(req));
          sendJson(res, 200, { ok: true, eval: view, warning: warning || null });
        } catch (error) {
          if (error && error.statusCode) sendJson(res, error.statusCode, { ok: false, error: error.message });
          else sendJson(res, 502, { ok: false, error: `Falha na IA: ${String((error && error.message) || error)}` });
        }
        return true;
      }
    }

    {
      if (req.method === 'POST' && url.pathname === '/api/commons/govern/review') {
        if (!(await permitReq(req, res, 'curar'))) return true;
        const body = await readJsonBody(req);
        const paths = Array.isArray(body.paths) ? body.paths : body.path ? [body.path] : [];
        const now = new Date().toISOString();
        const actor = actorFromReq(req);
        const who = actor.name || actor.email || 'curador';
        for (const p of paths) {
          const id = String(p).replace(/\\/g, '/').replace(/^\/+/, '');
          if (!(await commonsHasConcept(id))) continue;
          // ACL via the request (webActor carries groups); actorFromReq drops groups, so a public
          // capsule's global-curator path always failed here and the review silently no-op'd.
          const e = await loadCommonsConceptGov(id);
          if (e.closedAt) continue; // cápsula FECHADA está fora do ciclo de revisão
          e.lastReviewedAt = now;
          stampCreator(e, actor); // creator-on-touch
          pushApproval(e, 'review', 'mantido em dia', actor); // #5 audit ledger
          await saveCommonsConceptGov(id, e, actor, `commons: ${id} revisado por ${who}`);
        }
        sendJson(res, 200, { ok: true, reviewedAt: now, ...(await commonsListForActor(webActor(req))) });
        return true;
      }
      // FECHAR / REABRIR uma cápsula: fechada = validada e congelada como fato passado (episódio,
      // transcrição, ponto factual). Sai do ciclo de revisão e fica imune à depreciação; o
      // conteúdo só volta a ser editável depois de reabrir. Gate = gerência da própria cápsula.
      if (req.method === 'POST' && url.pathname === '/api/commons/govern/close') {
        const body = await readJsonBody(req);
        const id = String(body.path || '')
          .replace(/\\/g, '/')
          .replace(/^\/+/, '');
        if (!(await commonsHasConcept(id))) {
          sendJson(res, 404, { ok: false, error: 'conceito não encontrado no commons.' });
          return true;
        }
        if (!(await permitReq(req, res, 'curar'))) return true;
        const actor = actorFromReq(req);
        const who = actor.name || actor.email || 'curador';
        const e = await loadCommonsConceptGov(id);
        const close = body.close !== false;
        if (close) {
          if (e.closedAt) {
            sendJson(res, 200, { ok: true, path: id, closed: true });
            return true;
          }
          // "A closed capsule is a VALIDATED capsule": exige ao menos uma revisão registrada.
          if (!e.lastReviewedAt) {
            sendJson(res, 400, {
              ok: false,
              error: 'Cápsula nunca revisada — valide (revise) o conteúdo antes de fechar.'
            });
            return true;
          }
          e.closedAt = new Date().toISOString();
          e.closedBy = who;
          stampCreator(e, actor);
          pushApproval(e, 'closed', 'cápsula fechada (fato passado, congelada)', actor);
          await saveCommonsConceptGov(id, e, actor, `commons: ${id} fechada por ${who}`);
        } else {
          if (!e.closedAt) {
            sendJson(res, 200, { ok: true, path: id, closed: false });
            return true;
          }
          delete e.closedAt;
          delete e.closedBy;
          pushApproval(e, 'reopened', 'cápsula reaberta para edição/revisão', actor);
          await saveCommonsConceptGov(id, e, actor, `commons: ${id} reaberta por ${who}`);
        }
        sendJson(res, 200, { ok: true, path: id, closed: close, ...(await commonsListForActor(webActor(req))) });
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/commons/govern/cadence') {
        if (!(await permitReq(req, res, 'curar'))) return true;
        const body = await readJsonBody(req);
        const cadence = String(body.cadence || '');
        if (!CADENCE_DAYS[cadence]) {
          sendJson(res, 400, { ok: false, error: 'cadência inválida (weekly|monthly|quarterly|yearly).' });
          return true;
        }
        const actor = actorFromReq(req);
        const who = actor.name || actor.email || 'curador';
        if (body.path) {
          // Per-concept cadence is edited ONLY in the create/edit wizard now — the dashboard is
          // read-only by design. 410 keeps stale cached clients from silently mutating it.
          sendJson(res, 410, {
            ok: false,
            error: 'Cadência por conceito agora é editada no assistente de criação/edição da cápsula.'
          });
          return true;
        } else {
          await saveCommonsDefaults({ cadence }, actor, `commons: cadência padrão=${cadence} por ${who}`);
        }
        sendJson(res, 200, { ok: true, cadence, ...(await commonsListForActor(webActor(req))) });
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/commons/govern/eval-run') {
        if (!(await permitReq(req, res, 'curar'))) return true;
        const body = await readJsonBody(req);
        const id = String(body.path || '')
          .replace(/\\/g, '/')
          .replace(/^\/+/, '');
        if (!(await commonsHasConcept(id))) {
          sendJson(res, 404, { ok: false, error: 'conceito não encontrado no commons.' });
          return true;
        }
        if (!(await permitReq(req, res, 'curar'))) return true;
        const aiConfig = await loadUserAiConfig(actorFromReq(req));
        if (!aiConfig || !aiConfig.apiKey) {
          sendJson(res, 400, { ok: false, error: 'Configure seu provedor e chave de IA para rodar evals.' });
          return true;
        }
        let content = '';
        try {
          content = await readFile(commonsConceptContextPath(id), 'utf8');
        } catch (error) {
          sendJson(res, 404, { ok: false, error: 'conceito ilegível.' });
          return true;
        }
        const actor = actorFromReq(req);
        const who = actor.name || actor.email || 'curador';
        const e = await loadCommonsConceptGov(id);
        try {
          const criteria =
            Array.isArray(e.evalCriteria) && e.evalCriteria.length
              ? e.evalCriteria
              : await draftConceptEvalCriteria(content, id, aiConfig);
          if (!criteria.length) {
            sendJson(res, 502, { ok: false, error: 'a IA não retornou critérios.' });
            return true;
          }
          const evalStatus = await gradeConceptEval(content, id, criteria, aiConfig);
          e.evalCriteria = criteria;
          e.evalStatus = evalStatus;
          stampCreator(e, actor);
          pushApproval(e, 'eval', evalStatus.overall, actor);
          await saveCommonsConceptGov(id, e, actor, `commons: ${id} eval=${evalStatus.overall} por ${who}`);
          sendJson(res, 200, { ok: true, path: id, criteria, evalStatus });
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `Falha ao rodar eval: ${error.message}` });
        }
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/commons/summarize') {
        if (!(await permitReq(req, res, 'curar'))) return true;
        const aiConfig = await loadUserAiConfig(actorFromReq(req));
        if (!aiConfig || !aiConfig.apiKey) {
          sendJson(res, 400, { ok: false, error: 'Configure seu provedor e chave de IA para gerar resumos.' });
          return true;
        }
        const ids = await listCommonsConcepts();
        if (!ids.length) {
          sendJson(res, 200, { ok: true, generated: 0 });
          return true;
        }
        try {
          const items = [];
          const meta = {};
          for (const id of ids) {
            let content = '';
            try {
              content = await readFile(commonsConceptContextPath(id), 'utf8');
            } catch (error) {
              continue;
            }
            meta[id] = {
              hash: createHash('sha1').update(content).digest('hex'),
              bytes: Buffer.byteLength(content, 'utf8')
            };
            items.push({ path: id, kind: 'commons', head: content.slice(0, 800) });
          }
          const summaries = await summarizeContextFilesWithAI(items, aiConfig);
          const entries = {};
          let generated = 0;
          for (const id of Object.keys(meta)) {
            if (summaries[id]) {
              entries[id] = { summary: summaries[id], hash: meta[id].hash, bytes: meta[id].bytes };
              generated += 1;
            }
          }
          await writeFile(
            join(commonsRoot(), CONTEXT_INDEX_FILE),
            JSON.stringify(
              {
                version: 1,
                generatedAt: new Date().toISOString(),
                model: aiConfig.model || aiConfig.provider,
                entries
              },
              null,
              2
            ),
            'utf8'
          );
          await commitRepo(
            commonsRoot(),
            `commons: resumos (IA) por ${actorFromReq(req).name || 'curador'}`,
            actorFromReq(req),
            ids
          );
          sendJson(res, 200, { ok: true, generated, total: items.length });
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `Falha ao gerar resumos: ${error.message}` });
        }
        return true;
      }
      // Phase 2: process a concept's img/ + data/ sidecars with the BYO AI → descriptions.json.
      if (req.method === 'POST' && url.pathname === '/api/commons/process-media') {
        const body = await readJsonBody(req);
        const id = String(body.path || '')
          .replace(/\\/g, '/')
          .replace(/^\/+/, '');
        if (!(await commonsHasConcept(id))) {
          sendJson(res, 404, { ok: false, error: 'conceito não encontrado no commons.' });
          return true;
        }
        if (!(await permitReq(req, res, 'curar'))) return true;
        const aiConfig = await loadUserAiConfig(actorFromReq(req));
        if (!aiConfig || !aiConfig.apiKey) {
          sendJson(res, 400, { ok: false, error: 'Configure seu provedor e chave de IA para processar mídia.' });
          return true;
        }
        const actor = actorFromReq(req);
        try {
          const counts = await processConceptMedia(join(commonsRoot(), id), aiConfig, id.split('/').pop());
          await commitRepo(
            commonsRoot(),
            `commons: ${id} mídia processada (IA) por ${actor.name || actor.email || 'curador'}`,
            actor,
            [id]
          );
          sendJson(res, 200, {
            ok: true,
            path: id,
            counts,
            media: await conceptMediaEntries(join(commonsRoot(), id), id)
          });
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `Falha ao processar mídia: ${error.message}` });
        }
        return true;
      }

      // Stateless: describe ONE in-memory media file (base64) with the BYO AI — used
      // by the create/insert wizard to fill a media description before the artifact
      // exists. No writes; the description travels back with the create/update payload.
      if (req.method === 'POST' && url.pathname === '/api/media/describe') {
        if (!webActor(req).email) {
          sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
          return true;
        }
        const body = await readJsonBody(req);
        const name = String(body.name || '');
        const b64 = String(body.base64 || '');
        const ext = extname(name).toLowerCase();
        if (!b64) {
          sendJson(res, 400, { ok: false, error: 'Arquivo vazio.' });
          return true;
        }
        const aiConfig = await loadUserAiConfig(actorFromReq(req));
        if (!aiConfig || !aiConfig.apiKey) {
          sendJson(res, 400, { ok: false, error: 'Configure seu provedor e chave de IA para processar mídia.' });
          return true;
        }
        try {
          let description = '';
          if (MEDIA_IMG_EXTS.has(ext)) {
            if (Buffer.from(b64, 'base64').length > MEDIA_IMG_MAX_BYTES) {
              sendJson(res, 400, { ok: false, error: 'Imagem muito grande (máx. 5 MB).' });
              return true;
            }
            const desc = await callAiVisionDescribe(b64, mediaMimeFor(name), aiConfig, {
              system: MEDIA_IMG_SYSTEM,
              prompt: 'Descreva esta imagem.'
            });
            description = (desc || '').replace(/\s+/g, ' ').trim().slice(0, 600);
          } else if (MEDIA_DATA_EXTS.has(ext)) {
            const content = Buffer.from(b64, 'base64').toString('utf8');
            if (Buffer.byteLength(content, 'utf8') > MEDIA_DATA_MAX_BYTES) {
              sendJson(res, 400, { ok: false, error: 'Arquivo muito grande (máx. 256 KB).' });
              return true;
            }
            const r = await callAiWithSystemPrompt(
              MEDIA_DATA_SYSTEM,
              { file: name, hint: '', head: content.slice(0, 4000) },
              aiConfig,
              false
            );
            description = (typeof r === 'string' ? r : '').replace(/\s+/g, ' ').trim().slice(0, 600);
          } else {
            sendJson(res, 400, { ok: false, error: 'Tipo de mídia não suportado.' });
            return true;
          }
          if (!description) {
            sendJson(res, 502, { ok: false, error: 'A IA não retornou descrição.' });
            return true;
          }
          sendJson(res, 200, { ok: true, description });
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `Falha ao descrever: ${error.message}` });
        }
        return true;
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/commons/img') {
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      const id = String(url.searchParams.get('path') || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      const name = String(url.searchParams.get('name') || '');
      if (
        !id ||
        id.includes('..') ||
        !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(id) ||
        !name ||
        name.includes('/') ||
        name.includes('..') ||
        !MEDIA_IMG_EXTS.has(extname(name).toLowerCase())
      ) {
        sendJson(res, 400, { ok: false, error: 'caminho inválido.' });
        return true;
      }
      const target = join(commonsRoot(), id, 'img', name);
      if (!(await pathExists(target))) {
        sendJson(res, 404, { ok: false, error: 'imagem não encontrada.' });
        return true;
      }
      if (!(await canReadCommonsReq(req, id))) {
        sendJson(res, 404, { ok: false, error: 'imagem não encontrada.' });
        return true;
      }
      try {
        const buf = await readFile(target);
        const etag = `"${createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`;
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304).end();
          return true;
        }
        res.writeHead(200, { 'content-type': mediaMimeFor(name), 'cache-control': 'private, max-age=300', etag });
        res.end(buf);
      } catch (error) {
        sendJson(res, 500, { ok: false, error: 'falha ao ler imagem.' });
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/commons/file-asset') {
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      const asset = resolveCommonsFileAsset(url.searchParams.get('path'), url.searchParams.get('name'));
      if (!asset) {
        sendJson(res, 400, { ok: false, error: 'caminho inválido.' });
        return true;
      }
      if (!(await pathExists(asset.full))) {
        sendJson(res, 404, { ok: false, error: 'arquivo não encontrado.' });
        return true;
      }
      if (!(await canReadCommonsReq(req, asset.id))) {
        sendJson(res, 404, { ok: false, error: 'arquivo não encontrado.' });
        return true;
      }
      await serveFileBytes(res, asset.full, asset.name, mediaMimeFor(asset.name), false);
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/commons/file/view') {
      if (!webActor(req).email) {
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Não autenticado.');
        return true;
      }
      const rel = String(url.searchParams.get('path') || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (!rel || rel.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(rel)) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('caminho inválido.');
        return true;
      }
      const target = commonsConceptContextPath(rel);
      if (!(await pathExists(target))) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('conceito não encontrado.');
        return true;
      }
      if (!(await canReadCommonsReq(req, rel))) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('conceito não encontrado.');
        return true;
      }
      const st = await stat(target);
      if (st.size > 512 * 1024) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('conceito grande demais para exibir.');
        return true;
      }
      const content = await readFile(target, 'utf8');
      // Os botões de edição da página só aparecem para quem o servidor deixaria gravar (D1, com a pasta).
      const canEdit = (await permissionsReq(req)).curar.ok;
      const media = await conceptMediaEntries(join(commonsRoot(), rel), rel); // Phase 2: img + data descriptions
      const reviewMode = url.searchParams.get('review') === '1'; // "Revisar" flow: show a Validar button
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(commonsFilePage(rel, content, canEdit, media, reviewMode));
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/commons/file') {
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      const id = String(url.searchParams.get('path') || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (!id || id.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(id)) {
        sendJson(res, 400, { ok: false, error: 'caminho inválido.' });
        return true;
      }
      const target = commonsConceptContextPath(id);
      if (!(await pathExists(target))) {
        sendJson(res, 404, { ok: false, error: 'conceito não encontrado.' });
        return true;
      }
      if (!(await canReadCommonsReq(req, id))) {
        sendJson(res, 404, { ok: false, error: 'conceito não encontrado.' });
        return true;
      }
      const st = await stat(target);
      if (st.size > 512 * 1024) {
        sendJson(res, 200, { ok: true, path: id, content: '', tooLarge: true, size: st.size, history: [] });
        return true;
      }
      const raw = await readFile(target, 'utf8');
      const history = await gitHistoryForPath(commonsRoot(), id); // history of the whole concept folder
      const media = await conceptMediaEntries(join(commonsRoot(), id), id); // Phase 2: img + data descriptions
      // Queryable datasets (DuckDB Inspecionar): data/*.csv|parquet — parquet is NOT a media
      // type (binary, never AI-described), so it's listed separately here.
      const datasets = [];
      try {
        for (const rel of (await listRelativeFiles(join(commonsRoot(), id))).map((r) => r.replaceAll('\\', '/'))) {
          if (rel.startsWith('data/') && DATASET_EXT_RE.test(rel)) {
            let size = 0;
            try {
              size = (await stat(join(commonsRoot(), id, rel))).size;
            } catch (error) {
              /* ignore */
            }
            datasets.push({ path: rel, size });
          }
        }
      } catch (error) {
        /* no data dir */
      }
      sendJson(res, 200, { ok: true, path: id, content: raw, size: st.size, history, media, datasets });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/commons/file') {
      const body = await readJsonBody(req, 2 * 1024 * 1024);
      const id = String(body.path || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (!id || id.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(id)) {
        sendJson(res, 400, { ok: false, error: 'caminho inválido.' });
        return true;
      }
      const content = String(body.content ?? '');
      if (content.length > 512 * 1024) {
        sendJson(res, 400, { ok: false, error: 'conteúdo muito grande (> 512 KB).' });
        return true;
      }
      if (!(await commonsHasConcept(id))) {
        sendJson(res, 404, { ok: false, error: 'conceito não encontrado.' });
        return true;
      }
      if (!(await permitReq(req, res, 'curar'))) return true;
      if ((await loadCommonsConceptGov(id)).closedAt) {
        sendJson(res, 409, {
          ok: false,
          error: 'Cápsula FECHADA — o conteúdo está congelado como fato passado. Reabra na Governança para editar.'
        });
        return true;
      }
      const actor = actorFromReq(req);
      try {
        await writeFile(commonsConceptContextPath(id), content, 'utf8');
        await commitRepo(commonsRoot(), `commons: ${id} editado por ${actor.name || actor.email || 'curador'}`, actor, [
          id
        ]);
        corpusIndexCacheByRepo.delete(activeRepo());
        corpusLinkCacheByRepo.delete(activeRepo()); // content/links may have changed
        const history = await gitHistoryForPath(commonsRoot(), id);
        sendJson(res, 200, { ok: true, path: id, size: Buffer.byteLength(content, 'utf8'), history });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: `Falha ao salvar: ${error.message}` });
      }
      return true;
    }
    return false;
  };
}
