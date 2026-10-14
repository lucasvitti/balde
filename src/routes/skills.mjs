import { CADENCE_DAYS } from '../policy/governance-policy.mjs';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  parseFrontmatter,
  isSafeSkillId,
  MAX_SKILL_ID_DEPTH,
  assertSafeUploadName,
  assertSafeRelPath,
  isReservedSkillPath,
  upsertFrontmatter,
  slugifySkillId,
  buildStarterSkillMarkdown,
  parseOkfTags
} from '../skill-format.mjs';
import { skillsRoot } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { actorFromReq } from '../git-corpus.mjs';
import { runGovernedQuery, inspectDataset, datasetTableName } from '../duckdb.mjs';
import { callAiWithSystemPrompt } from '../ai-provider.mjs';
import { listRelativeFiles } from '../skill-helpers.mjs';
import { computeSelo } from '../scoring.mjs';
import { archiveFolder, listArchivedFolders, restoreFolder, ArchiveError } from '../governance/archive.mjs';

export function createSkillsRoutes({
  canReadSkillActor,
  webActor,
  sendJson,
  readJsonBody,
  loadSkillConsumerContext,
  skillQueryDatasets,
  formatBytesServer,
  recordSkillEvent,
  DATASET_EXT_RE,
  loadSkillsFromDisk,
  loadSkillAccess,
  permitReq,
  roleReq,
  roleAllowsReq,
  invalidateCorpusIndexes,
  nodeEvalView,
  saveNodeEval,
  loadUserAiConfig,
  runNodeEval,
  testEvalCase,
  suggestEvalCases,
  loadSkillWorkingContext,
  loadScoringConfig,
  loadNodeEvalStored,
  mandatoryFor,
  loadEvalChecklist,
  normalizeDomainServer,
  composeSkillId,
  loadDomains,
  allowedDomainsForActor,
  saveDomains,
  aiModeNone,
  QUEUE_MAX_BODY,
  readPrompt,
  createDomainDenial,
  loadGovernanceIndex,
  stampCreator,
  curatesActiveBaldeReq,
  pushApproval,
  governanceIndexPath,
  commitCorpus,
  regenerateContextIndex,
  saveSkillAccess,
  relativeProjectPath,
  isEditableContextFile,
  saveGovernanceIndex,
  skillContextManifest,
  govSkillShape,
  conceptMediaEntries,
  skillFileAssetV1Url,
  processConceptMedia,
  MEDIA_IMG_EXTS,
  mediaMimeFor,
  resolveSkillFileAsset,
  canReadSkillReq,
  serveFileBytes,
  discoverSkillContextFiles,
  draftConceptEvalCriteria,
  gradeConceptEval,
  planCommonsMigration,
  applyCommonsMigration
}) {
  return async function skillsRoutes(req, res, url) {
    if (req.method === 'POST' && url.pathname.startsWith('/api/skills/') && url.pathname.endsWith('/query-run')) {
      const skillId = decodeURIComponent(
        url.pathname.slice('/api/skills/'.length, url.pathname.length - '/query-run'.length)
      );
      if (
        !isSafeSkillId(skillId) ||
        !(await pathExists(join(skillsRoot(), skillId, 'SKILL.md'))) ||
        !(await canReadSkillActor(skillId, webActor(req)))
      ) {
        sendJson(res, 404, { ok: false, error: 'Skill não encontrada.' });
        return true;
      }
      const body = await readJsonBody(req);
      const rel = String(body.path || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (!rel.endsWith('.sql') || rel.includes('..')) {
        sendJson(res, 400, { ok: false, error: 'Informe um arquivo .sql da skill.' });
        return true;
      }
      const working = await loadSkillConsumerContext(skillId);
      if (!(working.files || []).map((r) => r.replaceAll('\\', '/')).includes(rel)) {
        sendJson(res, 404, { ok: false, error: `"${rel}" não existe nesta skill.` });
        return true;
      }
      const draftAbs = join(working.draftDir, rel);
      const sqlAbs = (await pathExists(draftAbs)) ? draftAbs : join(working.sourceDir, rel);
      let sql = '';
      try {
        sql = await readFile(sqlAbs, 'utf8');
      } catch (error) {
        sendJson(res, 404, { ok: false, error: 'Não foi possível ler o arquivo.' });
        return true;
      }
      const ds = await skillQueryDatasets(skillId, webActor(req));
      if (ds.overLimit) {
        sendJson(res, 400, {
          ok: false,
          error: `Datasets somam ${formatBytesServer(ds.totalBytes)} — acima do limite de execução.`
        });
        return true;
      }
      const result = await runGovernedQuery(ds.datasets, sql);
      recordSkillEvent('consume', skillId, 'app', webActor(req));
      sendJson(res, result.ok ? 200 : 400, {
        ...result,
        sql: rel,
        datasets: ds.datasets.map((d) => ({ table: d.table, source: d.source, bytes: d.bytes })),
        skippedDatasets: ds.skippedNames
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/skills/') && url.pathname.endsWith('/data-inspect')) {
      const skillId = decodeURIComponent(
        url.pathname.slice('/api/skills/'.length, url.pathname.length - '/data-inspect'.length)
      );
      if (
        !isSafeSkillId(skillId) ||
        !(await pathExists(join(skillsRoot(), skillId, 'SKILL.md'))) ||
        !(await canReadSkillActor(skillId, webActor(req)))
      ) {
        sendJson(res, 404, { ok: false, error: 'Skill não encontrada.' });
        return true;
      }
      const body = await readJsonBody(req);
      const rel = String(body.path || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (!DATASET_EXT_RE.test(rel) || rel.includes('..')) {
        sendJson(res, 400, { ok: false, error: 'Informe um arquivo .csv ou .parquet da skill.' });
        return true;
      }
      const working = await loadSkillConsumerContext(skillId);
      if (!(working.files || []).map((r) => r.replaceAll('\\', '/')).includes(rel)) {
        sendJson(res, 404, { ok: false, error: `"${rel}" não existe nesta skill.` });
        return true;
      }
      const draftAbs = join(working.draftDir, rel);
      const abs = (await pathExists(draftAbs)) ? draftAbs : join(working.sourceDir, rel);
      const result = await inspectDataset({ table: datasetTableName(rel), path: abs });
      sendJson(res, result.ok ? 200 : 400, { ...result, path: rel, table: datasetTableName(rel) });
      return true;
    }

    if (url.pathname.startsWith('/api/skills/') && url.pathname.endsWith('/access')) {
      sendJson(res, 410, {
        ok: false,
        error:
          'O acesso por skill não existe mais: quem lê e quem cura é definido pelo balde (Configurações › Baldes › Acesso).'
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/skills') {
      const actor = webActor(req);
      const all = await loadSkillsFromDisk();
      // Feedback do chat traz quem perguntou, a pergunta e a resposta: só curadores e o criador do balde
      // veem o de todos (Vitti, 2026-10-06); os demais veem só o que eles mesmos marcaram.
      const curator = await curatesActiveBaldeReq(req);
      // D1: o balde decide quem cura, não o owner da skill; canManage diz se o papel permite (a pasta pode
      // ainda faltar, e a interface mostra o motivo).
      const canManage = await roleAllowsReq(req, 'curar');
      const ownIds = new Set([actor.email, actor.name].filter(Boolean).map((value) => String(value).toLowerCase()));
      const skills = [];
      for (const skill of all) {
        if (!(await canReadSkillActor(skill.id, actor))) continue; // hide restricted skills from non-readers
        const access = await loadSkillAccess(skill.id);
        const own = (who) => ownIds.has(String(who || '').toLowerCase());
        const feedbackView = curator
          ? {}
          : {
              feedback: (skill.feedback || []).filter((item) => own(item.usuario)),
              wrongFeedbacks: (skill.wrongFeedbacks || []).filter((item) => own(item.user)),
              // a revisão local cita cada pergunta marcada como Errado
              aiReview: skill.aiReview && {
                ...skill.aiReview,
                findings: (skill.aiReview.findings || []).filter((item) => item.category !== 'feedback errado')
              }
            };
        // Everyone who can read sees the visibility flag; only stewards see the full ACL lists.
        skills.push(
          canManage
            ? { ...skill, ...feedbackView, visibility: access.visibility, access, canManage: true }
            : { ...skill, ...feedbackView, visibility: access.visibility, canManage: false }
        );
      }
      sendJson(res, 200, {
        root: skillsRoot(),
        skills
      });
      return true;
    }

    {
      const em = url.pathname.match(/^\/api\/skills\/([^/]+)\/eval(\/run|\/test|\/suggest)?$/);
      if (em) {
        const id = decodeURIComponent(em[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        const sub = em[2] || '';
        // Ler a avaliação e pedir sugestões à IA não gravam nada: basta o papel. O resto grava e pede também a pasta.
        if (!(await (req.method === 'GET' || sub === '/suggest' ? roleReq : permitReq)(req, res, 'curar'))) return true;
        if (!(await pathExists(join(skillsRoot(), id, 'SKILL.md')))) {
          sendJson(res, 404, { ok: false, error: 'Skill não encontrada.' });
          return true;
        }
        if (req.method === 'GET' && !sub) {
          sendJson(res, 200, { ok: true, eval: await nodeEvalView('skill', id) });
          return true;
        }
        if (req.method === 'POST' && !sub) {
          await saveNodeEval('skill', id, await readJsonBody(req), actorFromReq(req));
          sendJson(res, 200, { ok: true, eval: await nodeEvalView('skill', id) });
          return true;
        }
        if (req.method === 'POST' && sub) {
          const actor = actorFromReq(req);
          const aiConfig = await loadUserAiConfig(actor);
          if (!aiConfig || !aiConfig.apiKey) {
            sendJson(res, 400, { ok: false, error: 'Configure seu provedor e chave de IA em Configurações.' });
            return true;
          }
          if (sub === '/run') {
            sendJson(res, 200, { ok: true, eval: await runNodeEval('skill', id, aiConfig, actor) });
            return true;
          }
          const body = await readJsonBody(req);
          try {
            if (sub === '/suggest') {
              sendJson(res, 200, { ok: true, cases: await suggestEvalCases('skill', id, aiConfig) });
              return true;
            }
            const { view, warning } = await testEvalCase('skill', id, body.itemId, aiConfig, actor, webActor(req));
            sendJson(res, 200, { ok: true, eval: view, warning: warning || null });
          } catch (error) {
            if (error && error.statusCode) sendJson(res, error.statusCode, { ok: false, error: error.message });
            else sendJson(res, 502, { ok: false, error: `Falha na IA: ${String((error && error.message) || error)}` });
          }
          return true;
        }
      }
    }

    {
      const sm = url.pathname.match(/^\/api\/skills\/([^/]+)\/selo-preview$/);
      if (req.method === 'GET' && sm) {
        const id = decodeURIComponent(sm[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        if (!(await roleReq(req, res, 'curar'))) return true;
        if (!(await pathExists(join(skillsRoot(), id, 'SKILL.md')))) {
          sendJson(res, 404, { ok: false, error: 'Skill não encontrada.' });
          return true;
        }
        const working = await loadSkillWorkingContext(id);
        const cfg = await loadScoringConfig();
        const base = {
          meta: working.meta,
          body: working.body,
          files: working.files,
          storedEval: await loadNodeEvalStored('skill', id),
          checklist: mandatoryFor(await loadEvalChecklist(), 'skill')
        };
        const projetado = computeSelo({ ...base, frescor: 'verde' }, cfg);
        const evalView = await nodeEvalView('skill', id);
        sendJson(res, 200, {
          ok: true,
          selo: projetado,
          weights: cfg.weights,
          bands: cfg.bands,
          casosAlvo: cfg.casosAlvo,
          casos: (base.storedEval.items || []).length,
          gateOverall: evalView.overall
        });
        return true;
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/skills/check-slug') {
      const slug = slugifySkillId(url.searchParams.get('id') || '');
      const domain = normalizeDomainServer(url.searchParams.get('domain') || '');
      const subpath = url.searchParams.get('subpath') || ''; // Option 1: free sub-folders under the domain
      const id = domain ? composeSkillId(domain, subpath, slug) : slug; // domain-aware; no-domain form kept for back-compat
      const available = Boolean(slug) && isSafeSkillId(id) && !(await pathExists(join(skillsRoot(), id, 'SKILL.md')));
      sendJson(res, 200, { ok: true, id, slug, domain, subpath, available });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/domains') {
      // `domains` = the full governed vocabulary (display, admin views); `mine` = where THIS
      // user may CREATE (admins: everything; others: their whitelist — possibly empty).
      const domains = await loadDomains();
      const allowed = await allowedDomainsForActor(webActor(req));
      const canManage = await roleAllowsReq(req, 'curar');
      sendJson(res, 200, {
        ok: true,
        domains,
        mine: allowed === null ? domains : allowed,
        restrictedCreation: allowed !== null,
        canManage
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/domains/add') {
      if (!(await permitReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req);
      const domain = normalizeDomainServer(body.domain || '');
      if (!domain) {
        sendJson(res, 400, { ok: false, error: 'Informe um nome de domínio válido (minúsculas, sem espaços).' });
        return true;
      }
      const current = await loadDomains();
      if (!current.includes(domain)) {
        await saveDomains([...current, domain].sort(), actorFromReq(req));
      }
      sendJson(res, 200, { ok: true, domain, domains: await loadDomains() });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/wizard/ai') {
      if (aiModeNone(res)) return true;
      const body = await readJsonBody(req, QUEUE_MAX_BODY);
      const prompt = await readPrompt(String(body.promptId || ''));
      if (!prompt) {
        sendJson(res, 400, { ok: false, error: 'Prompt desconhecido.' });
        return true;
      }
      const aiConfig = await loadUserAiConfig(actorFromReq(req));
      if (!aiConfig || !aiConfig.apiKey) {
        sendJson(res, 400, {
          ok: false,
          error: 'Configure seu provedor e chave de IA em Configurações para usar a IA.'
        });
        return true;
      }
      try {
        const wantJson = prompt.output === 'json';
        const result = await callAiWithSystemPrompt(prompt.body, body.payload || {}, aiConfig, wantJson);
        sendJson(res, 200, { ok: true, output: prompt.output, result });
      } catch (error) {
        sendJson(res, 502, { ok: false, error: `Falha na IA: ${error.message}` });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/new') {
      // Criar é ação de curadoria (D1); até a 2.0.18 só o portão da instalação somente-leitura pedia curador.
      if (!(await permitReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req);
      const title = String(body.title || '').trim();
      if (!title) {
        sendJson(res, 400, { ok: false, error: 'Informe um título para a skill.' });
        return true;
      }
      const objetivo = String(body.objetivo || '').trim();
      if (!objetivo) {
        sendJson(res, 400, {
          ok: false,
          error: 'Informe o objetivo da skill (é a definição principal, vai para a seção Papel).'
        });
        return true;
      }
      const slug = slugifySkillId(body.id || title);
      if (!slug) {
        sendJson(res, 400, { ok: false, error: 'Não foi possível derivar um id/slug a partir do título.' });
        return true;
      }
      // New skills are folder-based: id = <domain>/<slug>, with domain from the governed vocabulary.
      const domain = normalizeDomainServer(body.domain || '');
      if (!domain) {
        sendJson(res, 400, { ok: false, error: 'Escolha um domínio para a skill.' });
        return true;
      }
      if (!(await loadDomains()).includes(domain)) {
        sendJson(res, 400, {
          ok: false,
          error: `Domínio "${domain}" não está no vocabulário governado. Um curador pode adicioná-lo em Administração › Domínios.`
        });
        return true;
      }
      const denyNew = await createDomainDenial(webActor(req), domain);
      if (denyNew) {
        sendJson(res, 403, { ok: false, error: denyNew });
        return true;
      }
      // Option 1: optional free sub-folders under the governed domain → id = <domain>/<subpath?>/<slug>.
      const id = composeSkillId(domain, body.subpath, slug);
      if (!isSafeSkillId(id)) {
        sendJson(res, 400, {
          ok: false,
          error: `Caminho de skill inválido ou profundo demais (máx. ${MAX_SKILL_ID_DEPTH} níveis): "${id}".`
        });
        return true;
      }
      const skillDir = join(skillsRoot(), id);
      if (await pathExists(join(skillDir, 'SKILL.md'))) {
        sendJson(res, 409, { ok: false, error: `Já existe uma skill com id "${id}".` });
        return true;
      }

      // Validate + decode any starter files BEFORE writing anything (no half-written skills).
      const decoded = [];
      try {
        for (const file of Array.isArray(body.files) ? body.files : []) {
          // A file carries EITHER a nested relPath (folder upload — tree preserved)
          // OR a flat name + optional dir bucket (wizard AI-step artifacts).
          let relPath;
          if (file && file.relPath) {
            relPath = assertSafeRelPath(file.relPath);
          } else {
            const filename = assertSafeUploadName(file && file.name);
            const dir = ['analytics', 'summaries', 'query', 'report', 'context'].includes(String(file && file.dir))
              ? String(file.dir)
              : '';
            relPath = dir ? `${dir}/${filename}` : filename;
          }
          if (relPath.toLowerCase() === 'skill.md') {
            throw new Error('O SKILL.md é gerado pelo modelo — renomeie o anexo.');
          }
          if (isReservedSkillPath(relPath)) throw new Error(`Caminho reservado à governança: ${relPath}`);
          const payload = String((file && file.base64) || '');
          if (!payload) {
            throw new Error(`Arquivo sem conteúdo: ${relPath}`);
          }
          const targetPath = join(skillDir, relPath);
          if (!targetPath.startsWith(skillDir)) {
            throw new Error(`Caminho de arquivo inválido: ${relPath}`);
          }
          decoded.push({ filename: relPath, targetPath, content: Buffer.from(payload, 'base64') });
        }
      } catch (fileError) {
        sendJson(res, 400, { ok: false, error: fileError.message || 'Anexo inválido.' });
        return true;
      }

      const actor = actorFromReq(req);
      // Output schema written by the wizard (step 2) as output_schema.json.
      const outputSchemaText = String(body.outputSchema || '').trim();
      if (outputSchemaText && !decoded.some((f) => f.filename.toLowerCase() === 'output_schema.json')) {
        decoded.push({
          filename: 'output_schema.json',
          targetPath: join(skillDir, 'output_schema.json'),
          content: Buffer.from(outputSchemaText, 'utf8')
        });
      }
      const hasSchema = decoded.some((f) => f.filename.toLowerCase() === 'output_schema.json');
      const toIdList = (value) =>
        (Array.isArray(value) ? value : parseOkfTags(value)).map((item) => slugifySkillId(item)).filter(Boolean);
      const markdown = buildStarterSkillMarkdown({
        title,
        kind: body.kind,
        description: body.description,
        tags: parseOkfTags(body.tags),
        objetivo,
        escopo: body.escopo,
        // O owner diz quem responde pela skill e não dá permissão (D1): quem cria pode indicá-lo.
        owner: String(body.owner || '').trim() || actor.email,
        timestamp: new Date().toISOString().slice(0, 10),
        resource: hasSchema ? 'output_schema.json' : '',
        buddyId: /^[a-zA-Z0-9._-]+$/.test(String(body.buddyId || '')) ? String(body.buddyId) : '',
        outputShape: body.outputShape,
        inputKind: body.inputKind,
        formulaSafe: body.formulaSafe !== false,
        modelTier: body.modelTier,
        maxTokens: body.maxTokens,
        temperature: body.temperature,
        allowedTools: Array.isArray(body.allowedTools)
          ? body.allowedTools.map((t) => String(t).trim()).filter(Boolean)
          : [],
        dataCatalogs: toIdList(body.dataCatalogs),
        reportRefs: toIdList(body.reportRefs),
        skillKind: body.skillKind,
        body: body.body
      });

      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), markdown, 'utf8');
      const written = [];
      for (const file of decoded) {
        await mkdir(dirname(file.targetPath), { recursive: true });
        await writeFile(file.targetPath, file.content);
        written.push(file.filename);
      }

      // #4: seed the governed-node ledger at creation — the creator sets cadence (locked; only
      // admins change it after) and optional eval criteria. Written before the commit so it lands
      // in the same "novo rascunho" commit. Absent/invalid → the node inherits the neighborhood default.
      const seedCadence = CADENCE_DAYS[String(body.cadence || '')] ? String(body.cadence) : '';
      const seedCriteria = Array.isArray(body.evalCriteria)
        ? body.evalCriteria
            .map((s) => String(s || '').trim())
            .filter(Boolean)
            .slice(0, 20)
        : [];
      if (seedCadence || seedCriteria.length) {
        const gi = await loadGovernanceIndex(id);
        stampCreator(gi.skill, actor);
        if (seedCadence) {
          gi.skill.cadence = seedCadence;
          gi.skill.cadenceLockedAt = new Date().toISOString();
          gi.skill.cadenceLockedBy = actor.name || actor.email || 'criador';
          pushApproval(gi.skill, 'cadence', seedCadence, actor);
        }
        if (seedCriteria.length) {
          gi.skill.evalCriteria = seedCriteria;
          pushApproval(gi.skill, 'eval-criteria', `${seedCriteria.length} critério(s)`, actor);
        }
        await writeFile(
          governanceIndexPath(id),
          JSON.stringify({ version: 1, skill: gi.skill, concepts: gi.concepts || {} }, null, 2),
          'utf8'
        );
      }

      await commitCorpus(`skill(${id}): novo rascunho por ${actor.name}`, actor, [id]);

      // A2: generate AI summaries for the new context files (best-effort, uses the creator's
      // BYO key; no key → the heuristic stands). Fire-and-forget so create stays snappy.
      regenerateContextIndex(id, actor).catch(() => {});

      // Optional access policy captured at creation (owner is already in the frontmatter).
      // Only write ACCESS.yml when the author set something beyond the public default.
      const access = body.access && typeof body.access === 'object' ? body.access : null;
      const wantsAccess =
        access &&
        (access.visibility === 'restricted' ||
          (Array.isArray(access.curators) && access.curators.length) ||
          (Array.isArray(access.readers) && access.readers.length) ||
          (Array.isArray(access.curator_groups) && access.curator_groups.length) ||
          (Array.isArray(access.reader_groups) && access.reader_groups.length));
      if (wantsAccess) {
        try {
          await saveSkillAccess(id, access, actor);
        } catch (accessError) {
          // The skill is already created; surface the ACL problem without failing the create.
          sendJson(res, 200, {
            ok: true,
            id,
            title,
            files: written,
            path: relativeProjectPath(join(skillDir, 'SKILL.md')),
            accessWarning: accessError.message
          });
          return true;
        }
      }

      sendJson(res, 200, {
        ok: true,
        id,
        title,
        files: written,
        path: relativeProjectPath(join(skillDir, 'SKILL.md'))
      });
      return true;
    }

    // Arquivar e restaurar (D6): nada se apaga. A skill vai inteira para skills/_archived/<id>/ (snapshots
    // publicados, rascunho, avaliações) e volta ao mesmo id; enquanto arquivada, nenhuma listagem, chat ou MCP
    // a vê. Até a 2.0.18 arquivar era só dos admins do balde e falhava para ids <domínio>/<slug>.
    if (req.method === 'GET' && url.pathname === '/api/skills/archived') {
      if (!(await roleReq(req, res, 'curar'))) return true;
      sendJson(res, 200, { ok: true, archived: await listArchivedFolders({ root: skillsRoot(), marker: 'SKILL.md' }) });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/skills/restore') {
      if (!(await permitReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req);
      const actor = actorFromReq(req);
      try {
        const restored = await restoreFolder({ root: skillsRoot(), archivedId: body.archivedId, marker: 'SKILL.md' });
        await commitCorpus(`skill(${restored.id}): restaurada por ${actor.name || actor.email}`, actor, restored.paths);
        invalidateCorpusIndexes();
        sendJson(res, 200, { ok: true, id: restored.id });
      } catch (error) {
        if (!(error instanceof ArchiveError)) throw error;
        sendJson(res, error.status, { ok: false, error: error.message });
      }
      return true;
    }
    {
      const delMatch = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
      if (req.method === 'DELETE' && delMatch) {
        const id = decodeURIComponent(delMatch[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        if (!(await permitReq(req, res, 'curar'))) return true;
        const actor = actorFromReq(req);
        try {
          const archived = await archiveFolder({ root: skillsRoot(), id, marker: 'SKILL.md', actor });
          await commitCorpus(`skill(${id}): arquivada por ${actor.name || actor.email}`, actor, archived.paths);
          invalidateCorpusIndexes();
          sendJson(res, 200, { ok: true, id, archivedId: archived.archivedId });
        } catch (error) {
          if (!(error instanceof ArchiveError)) throw error;
          sendJson(res, error.status, { ok: false, error: error.message });
        }
        return true;
      }
    }

    {
      const editLoadMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/edit$/);
      if (req.method === 'GET' && editLoadMatch) {
        const id = decodeURIComponent(editLoadMatch[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        if (!(await roleReq(req, res, 'curar'))) return true;
        const sourceSkillPath = join(skillsRoot(), id, 'SKILL.md');
        if (!(await pathExists(sourceSkillPath))) {
          sendJson(res, 404, { ok: false, error: `Skill "${id}" não encontrada.` });
          return true;
        }
        const { meta, body } = parseFrontmatter(await readFile(sourceSkillPath, 'utf8'));
        const access = await loadSkillAccess(id);
        const truthy = (v) => v !== false && v !== 'false' && v !== 0 && v !== '0';
        // Full-management edit: the existing context files (path + size) so the wizard can prefill,
        // re-bucket, rename and remove them; the output_schema; and the governance the wizard collects.
        const skillDirEdit = join(skillsRoot(), id);
        const editFiles = [];
        for (const rel of (await listRelativeFiles(skillDirEdit)).map((r) => r.replaceAll('\\', '/'))) {
          if (!isEditableContextFile(rel)) continue;
          let size = 0;
          try {
            size = (await stat(join(skillDirEdit, rel))).size;
          } catch (e) {
            /* ignore */
          }
          editFiles.push({ relPath: rel, size });
        }
        editFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
        let outputSchema = '';
        try {
          if (await pathExists(join(skillDirEdit, 'output_schema.json')))
            outputSchema = await readFile(join(skillDirEdit, 'output_schema.json'), 'utf8');
        } catch (e) {
          /* ignore */
        }
        const giEdit = (await loadGovernanceIndex(id)).skill || {};
        sendJson(res, 200, {
          ok: true,
          id,
          files: editFiles,
          outputSchema,
          cadence: giEdit.cadence || '',
          evalCriteria: Array.isArray(giEdit.evalCriteria) ? giEdit.evalCriteria : [],
          cadenceLocked: !!giEdit.cadenceLockedAt,
          cadenceLockedBy: giEdit.cadenceLockedBy || null,
          skillKind: meta.skill_kind === 'revenuehub' ? 'revenuehub' : 'knowledge',
          title: meta.title || meta.name || id,
          description: meta.description || '',
          objetivo: meta.objetivo || '',
          escopo: meta.escopo || '',
          tags: parseOkfTags(meta.tags),
          buddyId: meta.buddy_id || '',
          outputShape: meta.output_shape || 'scalar',
          inputKind: meta.input_kind || 'text',
          formulaSafe: meta.formula_safe === undefined ? true : truthy(meta.formula_safe),
          modelTier: meta.model_tier || 'economico',
          maxTokens: Number(meta.max_tokens) || 4096,
          temperature: Number(meta.temperature) || 0,
          body: body || '',
          owner: meta.owner || '',
          status: meta.status || 'rascunho',
          version: meta.version || '0.1.0',
          visibility: access.visibility,
          curators: access.curators || [],
          curator_groups: access.curator_groups || [],
          readers: access.readers || [],
          reader_groups: access.reader_groups || []
        });
        return true;
      }
    }

    {
      const updMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/update$/);
      if (req.method === 'POST' && updMatch) {
        const id = decodeURIComponent(updMatch[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        if (!(await permitReq(req, res, 'curar'))) return true;
        const skillDir = join(skillsRoot(), id);
        const sourceSkillPath = join(skillDir, 'SKILL.md');
        if (!(await pathExists(sourceSkillPath))) {
          sendJson(res, 404, { ok: false, error: `Skill "${id}" não encontrada.` });
          return true;
        }
        const body = await readJsonBody(req);
        const title = String(body.title || '').trim();
        if (!title) {
          sendJson(res, 400, { ok: false, error: 'Informe um título.' });
          return true;
        }
        const objetivo = String(body.objetivo || '').trim();
        if (!objetivo) {
          sendJson(res, 400, { ok: false, error: 'Informe o objetivo.' });
          return true;
        }
        const { meta: existingMeta } = parseFrontmatter(await readFile(sourceSkillPath, 'utf8'));
        const actor = actorFromReq(req);
        const toIdList = (value) =>
          (Array.isArray(value) ? value : parseOkfTags(value)).map((item) => slugifySkillId(item)).filter(Boolean);

        // Validate + decode any NEW files before writing (existing files/artifacts are preserved).
        const decoded = [];
        try {
          for (const file of Array.isArray(body.files) ? body.files : []) {
            let relPath;
            if (file && file.relPath) {
              relPath = assertSafeRelPath(file.relPath);
            } else {
              const filename = assertSafeUploadName(file && file.name);
              const dir = ['analytics', 'summaries', 'query', 'report', 'context'].includes(String(file && file.dir))
                ? String(file.dir)
                : '';
              relPath = dir ? `${dir}/${filename}` : filename;
            }
            if (relPath.toLowerCase() === 'skill.md') {
              throw new Error('O SKILL.md é gerado a partir dos campos — renomeie o anexo.');
            }
            if (isReservedSkillPath(relPath)) throw new Error(`Caminho reservado à governança: ${relPath}`);
            const payload = String((file && file.base64) || '');
            if (!payload) {
              throw new Error(`Arquivo sem conteúdo: ${relPath}`);
            }
            const targetPath = join(skillDir, relPath);
            if (!targetPath.startsWith(skillDir)) {
              throw new Error(`Caminho inválido: ${relPath}`);
            }
            decoded.push({ targetPath, content: Buffer.from(payload, 'base64'), filename: relPath });
          }
        } catch (fileError) {
          sendJson(res, 400, { ok: false, error: fileError.message || 'Anexo inválido.' });
          return true;
        }

        const markdown = buildStarterSkillMarkdown({
          title,
          kind: existingMeta.kind || 'skill',
          description: body.description,
          tags: parseOkfTags(body.tags),
          objetivo,
          escopo: body.escopo,
          owner: String(body.owner || '').trim() || existingMeta.owner || actor.email,
          timestamp: existingMeta.timestamp || new Date().toISOString().slice(0, 10),
          resource: existingMeta.resource || '',
          buddyId: /^[a-zA-Z0-9._-]+$/.test(String(body.buddyId || '')) ? String(body.buddyId) : '',
          outputShape: body.outputShape,
          inputKind: body.inputKind,
          formulaSafe: body.formulaSafe !== false,
          modelTier: body.modelTier,
          maxTokens: body.maxTokens,
          temperature: body.temperature,
          dataCatalogs: toIdList(
            Array.isArray(body.dataCatalogs) && body.dataCatalogs.length
              ? body.dataCatalogs
              : existingMeta.data_catalogs
          ),
          reportRefs: toIdList(existingMeta.report_refs),
          skillKind: body.skillKind,
          status: existingMeta.status || 'rascunho',
          version: existingMeta.version || '0.1.0',
          body: body.body
        });
        await writeFile(sourceSkillPath, markdown, 'utf8');

        // Full file management: reconcile the managed context files to the wizard's desired set.
        // body.existingFiles = [{ relPath (desired), origPath (on disk) }] to keep/rename. Managed
        // files on disk not listed are deleted; renamed ones are moved; new uploads are written.
        // Guarded on Array.isArray so an old (add-only) client never triggers a wipe.
        if (Array.isArray(body.existingFiles)) {
          const keepMap = new Map(); // origPath -> desiredPath
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
              // Renomear para um caminho da governança não vale (o arquivo fica onde está).
              if (orig) keepMap.set(orig, isReservedSkillPath(dest) ? orig : dest);
            } catch (e) {
              /* skip a malformed entry rather than wipe */
            }
          }
          const managedOnDisk = (await listRelativeFiles(skillDir))
            .map((r) => r.replaceAll('\\', '/'))
            .filter((r) => isEditableContextFile(r));
          for (const rel of managedOnDisk) {
            if (!keepMap.has(rel)) {
              await rm(join(skillDir, rel), { force: true }).catch(() => {});
            }
          }
          for (const [orig, dest] of keepMap) {
            if (orig === dest) continue;
            const from = join(skillDir, orig);
            const to = join(skillDir, dest);
            if (!to.startsWith(skillDir) || !(await pathExists(from))) continue;
            await mkdir(dirname(to), { recursive: true });
            try {
              await rename(from, to);
            } catch (e) {
              await cp(from, to);
              await rm(from, { force: true });
            }
          }
        }

        const written = [];
        for (const file of decoded) {
          await mkdir(dirname(file.targetPath), { recursive: true });
          await writeFile(file.targetPath, file.content);
          written.push(file.filename);
        }

        // output_schema.json follows the output shape (table ⇒ write the provided schema).
        if (String(body.outputShape) === 'table' && String(body.outputSchema || '').trim()) {
          await writeFile(join(skillDir, 'output_schema.json'), String(body.outputSchema), 'utf8');
        }

        // Governance: update the skill-level cadence (respecting the creator-lock — only admins change
        // it once locked) + eval criteria. The audit trail lives in governance.json approvals[].
        const wantCadence = CADENCE_DAYS[String(body.cadence || '')] ? String(body.cadence) : '';
        if (wantCadence || Array.isArray(body.evalCriteria)) {
          const gi = await loadGovernanceIndex(id);
          gi.skill = gi.skill || {};
          stampCreator(gi.skill, actor);
          if (
            wantCadence &&
            wantCadence !== gi.skill.cadence &&
            (!gi.skill.cadenceLockedAt || (await roleAllowsReq(req, 'curar')))
          ) {
            gi.skill.cadence = wantCadence;
            if (!gi.skill.cadenceLockedAt) {
              gi.skill.cadenceLockedAt = new Date().toISOString();
              gi.skill.cadenceLockedBy = actor.name || actor.email || 'curador';
            }
            pushApproval(gi.skill, 'cadence', wantCadence, actor);
          }
          if (Array.isArray(body.evalCriteria)) {
            const crit = body.evalCriteria
              .map((c) => String(c || '').trim())
              .filter(Boolean)
              .slice(0, 20);
            gi.skill.evalCriteria = crit;
            pushApproval(gi.skill, 'eval-criteria', `${crit.length} critério(s)`, actor);
          }
          await writeFile(
            governanceIndexPath(id),
            JSON.stringify({ version: 1, skill: gi.skill, concepts: gi.concepts || {} }, null, 2),
            'utf8'
          );
        }

        await commitCorpus(`skill(${id}): editada por ${actor.name}`, actor, [id]);
        // A2: refresh AI context summaries after an edit (best-effort, creator's BYO key).
        regenerateContextIndex(id, actor).catch(() => {});

        const access = body.access && typeof body.access === 'object' ? body.access : null;
        if (access) {
          try {
            await saveSkillAccess(id, access, actor);
          } catch (accessError) {
            /* ACL is non-fatal on edit */
          }
        }
        sendJson(res, 200, { ok: true, id, title, files: written });
        return true;
      }
    }

    {
      const rebuildMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/context-index\/rebuild$/);
      if (req.method === 'POST' && rebuildMatch) {
        const id = decodeURIComponent(rebuildMatch[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        if (!(await permitReq(req, res, 'curar'))) return true;
        if (!(await pathExists(join(skillsRoot(), id, 'SKILL.md')))) {
          sendJson(res, 404, { ok: false, error: `Skill "${id}" não encontrada.` });
          return true;
        }
        try {
          const result = await regenerateContextIndex(id, actorFromReq(req));
          if (!result.ok && result.reason === 'sem-chave-ia') {
            sendJson(res, 400, {
              ok: false,
              error: 'Configure seu provedor e chave de IA em Configurações para gerar resumos com IA.'
            });
            return true;
          }
          sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `Falha ao gerar resumos: ${error.message}` });
        }
        return true;
      }
    }

    {
      const reviewMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/govern\/review$/);
      if (req.method === 'POST' && reviewMatch) {
        const id = decodeURIComponent(reviewMatch[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        if (!(await permitReq(req, res, 'curar'))) return true;
        if (!(await pathExists(join(skillsRoot(), id, 'SKILL.md')))) {
          sendJson(res, 404, { ok: false, error: `Skill "${id}" não encontrada.` });
          return true;
        }
        const body = await readJsonBody(req);
        const paths = Array.isArray(body.paths) ? body.paths : body.path ? [body.path] : [];
        const now = new Date().toISOString();
        const index = await loadGovernanceIndex(id);
        if (!paths.length) {
          index.skill = index.skill || {};
          index.skill.lastReviewedAt = now; // no path → affirm the skill itself
        } else {
          index.concepts = index.concepts || {};
          for (const p of paths) {
            const rel = String(p).replace(/\\/g, '/');
            index.concepts[rel] = { ...(index.concepts[rel] || {}), lastReviewedAt: now };
          }
        }
        await saveGovernanceIndex(id, index, actorFromReq(req));
        const manifest = await skillContextManifest(await govSkillShape(id));
        sendJson(res, 200, {
          ok: true,
          reviewedAt: now,
          governance: manifest.governance,
          files: manifest.files.map((f) => ({ path: f.path, governance: f.governance }))
        });
        return true;
      }
      // (buildSkillContextBlock appends them). Read = authed; process = canManageSkill + BYO key.
      const mediaMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/media$/);
      if (req.method === 'GET' && mediaMatch) {
        const id = decodeURIComponent(mediaMatch[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        if (!(await pathExists(join(skillsRoot(), id, 'SKILL.md')))) {
          sendJson(res, 404, { ok: false, error: `Skill "${id}" não encontrada.` });
          return true;
        }
        sendJson(res, 200, {
          ok: true,
          id,
          media: await conceptMediaEntries(join(skillsRoot(), id), id, skillFileAssetV1Url),
          canManage: await roleAllowsReq(req, 'curar')
        });
        return true;
      }

      const procMediaMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/process-media$/);
      if (req.method === 'POST' && procMediaMatch) {
        const id = decodeURIComponent(procMediaMatch[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        if (!(await permitReq(req, res, 'curar'))) return true;
        if (!(await pathExists(join(skillsRoot(), id, 'SKILL.md')))) {
          sendJson(res, 404, { ok: false, error: `Skill "${id}" não encontrada.` });
          return true;
        }
        const aiConfig = await loadUserAiConfig(actorFromReq(req));
        if (!aiConfig || !aiConfig.apiKey) {
          sendJson(res, 400, { ok: false, error: 'Configure seu provedor e chave de IA para processar mídia.' });
          return true;
        }
        const actor = actorFromReq(req);
        try {
          const counts = await processConceptMedia(join(skillsRoot(), id), aiConfig, id);
          await commitCorpus(
            `skill(${id}): mídia processada (IA) por ${actor.name || actor.email || 'curador'}`,
            actor,
            [id]
          );
          regenerateContextIndex(id, actor).catch(() => {}); // refresh summaries now that descriptions exist
          sendJson(res, 200, {
            ok: true,
            id,
            counts,
            media: await conceptMediaEntries(join(skillsRoot(), id), id, skillFileAssetV1Url)
          });
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `Falha ao processar mídia: ${error.message}` });
        }
        return true;
      }

      const skillImgMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/img$/);
      if (req.method === 'GET' && skillImgMatch) {
        const id = decodeURIComponent(skillImgMatch[1]);
        const name = String(url.searchParams.get('name') || '');
        if (
          !isSafeSkillId(id) ||
          !name ||
          name.includes('/') ||
          name.includes('..') ||
          !MEDIA_IMG_EXTS.has(extname(name).toLowerCase())
        ) {
          sendJson(res, 400, { ok: false, error: 'caminho inválido.' });
          return true;
        }
        const target = join(skillsRoot(), id, 'img', name);
        if (!(await pathExists(target))) {
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

      // Download ONE file-asset attached to a skill (SSO). Twin of /api/commons/file-asset, in the
      // skill img handler's path style ({id} in the path + ?name=). webActor required, read-ACL
      // gated (404 on unreadable — no existence leak), strict path guards via resolveSkillFileAsset.
      // Always an attachment (never inline) via serveFileBytes + the file's mime.
      const skillFileMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/file$/);
      if (req.method === 'GET' && skillFileMatch) {
        if (!webActor(req).email) {
          sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
          return true;
        }
        const asset = await resolveSkillFileAsset(decodeURIComponent(skillFileMatch[1]), url.searchParams.get('name'));
        if (!asset) {
          sendJson(res, 400, { ok: false, error: 'caminho inválido.' });
          return true;
        }
        if (!(await pathExists(asset.full))) {
          sendJson(res, 404, { ok: false, error: 'arquivo não encontrado.' });
          return true;
        }
        if (!(await canReadSkillReq(req, asset.id))) {
          sendJson(res, 404, { ok: false, error: 'arquivo não encontrado.' });
          return true;
        }
        await serveFileBytes(res, asset.full, asset.name, mediaMimeFor(asset.name), false);
        return true;
      }

      const cadenceMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/govern\/cadence$/);
      if (req.method === 'POST' && cadenceMatch) {
        const id = decodeURIComponent(cadenceMatch[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        if (!(await permitReq(req, res, 'curar'))) return true;
        if (!(await pathExists(join(skillsRoot(), id, 'SKILL.md')))) {
          sendJson(res, 404, { ok: false, error: `Skill "${id}" não encontrada.` });
          return true;
        }
        const body = await readJsonBody(req);
        const cadence = String(body.cadence || '');
        if (!CADENCE_DAYS[cadence]) {
          sendJson(res, 400, { ok: false, error: 'cadência inválida (weekly|monthly|quarterly|yearly).' });
          return true;
        }
        const index = await loadGovernanceIndex(id);
        if (body.path) {
          const rel = String(body.path).replace(/\\/g, '/');
          index.concepts = index.concepts || {};
          index.concepts[rel] = { ...(index.concepts[rel] || {}), cadence };
        } else {
          index.skill = index.skill || {};
          index.skill.cadence = cadence;
        }
        await saveGovernanceIndex(id, index, actorFromReq(req));
        const manifest = await skillContextManifest(await govSkillShape(id));
        sendJson(res, 200, {
          ok: true,
          cadence,
          governance: manifest.governance,
          files: manifest.files.map((f) => ({ path: f.path, governance: f.governance }))
        });
        return true;
      }

      // S4: set/edit a concept's eval criteria (manage-gated).
      const criteriaMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/govern\/eval-criteria$/);
      if (req.method === 'POST' && criteriaMatch) {
        const id = decodeURIComponent(criteriaMatch[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        if (!(await permitReq(req, res, 'curar'))) return true;
        const body = await readJsonBody(req);
        const rel = String(body.path || '').replace(/\\/g, '/');
        if (!rel) {
          sendJson(res, 400, { ok: false, error: 'informe o path do conceito.' });
          return true;
        }
        const criteria = (Array.isArray(body.criteria) ? body.criteria : [])
          .map((c, i) => ({ id: String((c && c.id) || `c${i + 1}`), text: String((c && c.text) || '').trim() }))
          .filter((c) => c.text)
          .slice(0, 8);
        const index = await loadGovernanceIndex(id);
        index.concepts = index.concepts || {};
        index.concepts[rel] = { ...(index.concepts[rel] || {}), evalCriteria: criteria };
        await saveGovernanceIndex(id, index, actorFromReq(req));
        sendJson(res, 200, { ok: true, path: rel, criteria });
        return true;
      }

      // S4: run an AI eval on a concept (BYO key). Auto-drafts criteria if none exist, then grades.
      const evalRunMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/govern\/eval-run$/);
      if (req.method === 'POST' && evalRunMatch) {
        const id = decodeURIComponent(evalRunMatch[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        if (!(await permitReq(req, res, 'curar'))) return true;
        const body = await readJsonBody(req);
        const rel = String(body.path || '').replace(/\\/g, '/');
        if (!rel) {
          sendJson(res, 400, { ok: false, error: 'informe o path do conceito.' });
          return true;
        }
        const aiConfig = await loadUserAiConfig(actorFromReq(req));
        if (!aiConfig || !aiConfig.apiKey) {
          sendJson(res, 400, {
            ok: false,
            error: 'Configure seu provedor e chave de IA em Configurações para rodar evals.'
          });
          return true;
        }
        const shape = await govSkillShape(id);
        const { textFiles } = await discoverSkillContextFiles(shape);
        const file = textFiles.find((f) => f.rel === rel);
        if (!file) {
          sendJson(res, 404, { ok: false, error: 'conceito não encontrado (ou não é um arquivo de texto).' });
          return true;
        }
        let content = '';
        try {
          content = await readFile(file.full, 'utf8');
        } catch (error) {
          sendJson(res, 404, { ok: false, error: 'conceito ilegível.' });
          return true;
        }
        const index = await loadGovernanceIndex(id);
        index.concepts = index.concepts || {};
        const entry = index.concepts[rel] || {};
        try {
          let criteria =
            Array.isArray(entry.evalCriteria) && entry.evalCriteria.length
              ? entry.evalCriteria
              : await draftConceptEvalCriteria(content, rel, aiConfig);
          if (!criteria.length) {
            sendJson(res, 502, { ok: false, error: 'a IA não retornou critérios; defina critérios manualmente.' });
            return true;
          }
          const evalStatus = await gradeConceptEval(content, rel, criteria, aiConfig);
          index.concepts[rel] = { ...entry, evalCriteria: criteria, evalStatus };
          await saveGovernanceIndex(id, index, actorFromReq(req));
          sendJson(res, 200, { ok: true, path: rel, criteria, evalStatus });
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `Falha ao rodar eval: ${error.message}` });
        }
        return true;
      }

      // D4 phase 1 — PLAN a commons migration (AI classifies reusable context; no writes). BYO key.
      const planMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/commons\/plan$/);
      if (req.method === 'POST' && planMatch) {
        const id = decodeURIComponent(planMatch[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        if (!(await permitReq(req, res, 'curar'))) return true;
        if (!(await pathExists(join(skillsRoot(), id, 'SKILL.md')))) {
          sendJson(res, 404, { ok: false, error: `Skill "${id}" não encontrada.` });
          return true;
        }
        const aiConfig = await loadUserAiConfig(actorFromReq(req));
        if (!aiConfig || !aiConfig.apiKey) {
          sendJson(res, 400, {
            ok: false,
            error: 'Configure seu provedor e chave de IA em Configurações para planejar a migração.'
          });
          return true;
        }
        try {
          const plan = await planCommonsMigration(id, aiConfig);
          sendJson(res, 200, { ok: true, ...plan });
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `Falha ao planejar migração: ${error.message}` });
        }
        return true;
      }

      // D4 phase 2 — APPLY approved moves (skill→commons + link back + commit). Manage-gated.
      const applyMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/commons\/apply$/);
      if (req.method === 'POST' && applyMatch) {
        const id = decodeURIComponent(applyMatch[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'skill id inválido.' });
          return true;
        }
        if (!(await permitReq(req, res, 'curar'))) return true;
        if (!(await pathExists(join(skillsRoot(), id, 'SKILL.md')))) {
          sendJson(res, 404, { ok: false, error: `Skill "${id}" não encontrada.` });
          return true;
        }
        const body = await readJsonBody(req);
        const moves = Array.isArray(body.moves) ? body.moves : [];
        if (!moves.length) {
          sendJson(res, 400, { ok: false, error: 'nenhum movimento informado.' });
          return true;
        }
        try {
          const result = await applyCommonsMigration(id, moves, actorFromReq(req));
          sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `Falha ao aplicar migração: ${error.message}` });
        }
        return true;
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/upload') {
      if (!(await permitReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req);
      const markdown = String(body.markdown || body.sourceText || '').trim();
      if (!markdown.startsWith('---')) {
        sendJson(res, 400, {
          ok: false,
          error: 'Envie o conteúdo do SKILL.md com frontmatter OKF (começando por ---).'
        });
        return true;
      }
      const { meta } = parseFrontmatter(markdown);
      const title = meta.title || meta.name;
      if (!title) {
        sendJson(res, 400, { ok: false, error: 'O frontmatter precisa de um title (OKF) ou name.' });
        return true;
      }
      const slug = slugifySkillId(body.id || meta.code || title);
      if (!slug) {
        sendJson(res, 400, { ok: false, error: 'Não foi possível derivar um id/slug do título.' });
        return true;
      }
      // Imported skills are folder-based too: id = <domain>/<slug>, domain from the governed vocab.
      const domain = normalizeDomainServer(body.domain || '');
      if (!domain) {
        sendJson(res, 400, { ok: false, error: 'Escolha um domínio para a skill importada.' });
        return true;
      }
      if (!(await loadDomains()).includes(domain)) {
        sendJson(res, 400, {
          ok: false,
          error: `Domínio "${domain}" não está no vocabulário governado. Um curador pode adicioná-lo em Administração › Domínios.`
        });
        return true;
      }
      const denyUpload = await createDomainDenial(webActor(req), domain);
      if (denyUpload) {
        sendJson(res, 403, { ok: false, error: denyUpload });
        return true;
      }
      // Option 1: optional free sub-folders under the governed domain → id = <domain>/<subpath?>/<slug>.
      const id = composeSkillId(domain, body.subpath, slug);
      if (!isSafeSkillId(id)) {
        sendJson(res, 400, {
          ok: false,
          error: `Caminho de skill inválido ou profundo demais (máx. ${MAX_SKILL_ID_DEPTH} níveis): "${id}".`
        });
        return true;
      }
      const skillDir = join(skillsRoot(), id);
      if (await pathExists(join(skillDir, 'SKILL.md'))) {
        sendJson(res, 409, { ok: false, error: `Já existe uma skill com id "${id}".` });
        return true;
      }
      const actor = actorFromReq(req);
      const stamp = {};
      if (!meta.type) stamp.type = 'skill';
      if (!meta.owner) stamp.owner = actor.email;
      if (!meta.status) stamp.status = 'rascunho';
      if (!meta.timestamp && !meta.last_reviewed && !meta.data_updated) {
        stamp.timestamp = new Date().toISOString().slice(0, 10);
      }
      const doc = Object.keys(stamp).length ? upsertFrontmatter(markdown, stamp) : markdown;
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), doc, 'utf8');
      await commitCorpus(`skill(${id}): upload por ${actor.name}`, actor, [id]);
      sendJson(res, 200, { ok: true, id, title, path: relativeProjectPath(join(skillDir, 'SKILL.md')) });
      return true;
    }
    return false;
  };
}
