import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { isSafeSkillId, assertSafeUploadName, fileStamp, slugifySkillId } from '../skill-format.mjs';
import { skillsRoot, queueRoot, usageRoot, activeRepo } from '../config.mjs';
import { actorFromReq } from '../git-corpus.mjs';
import { termVector, contentHash, topMatches, allPairs } from '../similarity.mjs';

export function createIngestionRoutes({
  webActor,
  sendJson,
  saveIngestJob,
  readJsonBody,
  readIngestJob,
  canSeeIngestJob,
  INGEST_MAX_FILES,
  INGEST_EXTS,
  INGEST_MAX_FILE_BYTES,
  ingestJobDir,
  aiModeNone,
  runIngestJob,
  INGEST_ROOT,
  similarityIndex,
  linkedCapsuleIds,
  DEDUP_CHECK_THRESHOLD,
  roleReq,
  readQueueItem,
  DEDUP_SCAN_THRESHOLD,
  loadDedupDismissed,
  dedupPairKey,
  corpusLinkIndex,
  corpusNodeIndex,
  skillIdOfCorpusPath,
  dedupDismissPath,
  normalizeDomainServer,
  capsuleSlugSeg,
  commonsHasConcept,
  normSerieField,
  CAPSULE_FORMAT,
  compileCapsule,
  createCapsuleQueueItem
}) {
  return async function ingestionRoutes(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/ingest/jobs') {
      const me = webActor(req);
      if (!me.email) {
        sendJson(res, 400, { ok: false, error: 'Identidade indisponível.' });
        return true;
      }
      const id = `ing-${fileStamp()}-${randomBytes(3).toString('hex')}`;
      const job = {
        id,
        repo: activeRepo(),
        actor: { email: me.email, name: me.name },
        createdAt: new Date().toISOString(),
        phase: 'uploading',
        files: [],
        candidates: []
      };
      await saveIngestJob(job);
      sendJson(res, 201, { ok: true, job });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/ingest/upload') {
      const body = await readJsonBody(req, 24 * 1024 * 1024);
      const job = await readIngestJob(String(body.jobId || ''));
      if (!job || !(await canSeeIngestJob(job, req))) {
        sendJson(res, 404, { ok: false, error: 'Job não encontrado.' });
        return true;
      }
      if (job.phase !== 'uploading') {
        sendJson(res, 400, { ok: false, error: 'Job já iniciado.' });
        return true;
      }
      if (job.files.length >= INGEST_MAX_FILES) {
        sendJson(res, 400, { ok: false, error: `Máximo de ${INGEST_MAX_FILES} arquivos.` });
        return true;
      }
      let name = '';
      try {
        name = assertSafeUploadName(String(body.name || ''));
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
        return true;
      }
      const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
      if (!INGEST_EXTS.includes(ext)) {
        sendJson(res, 400, { ok: false, error: `Formato não suportado: ${ext}. Aceitos: ${INGEST_EXTS.join(', ')}` });
        return true;
      }
      let buf;
      try {
        buf = Buffer.from(String(body.base64 || ''), 'base64');
      } catch (error) {
        sendJson(res, 400, { ok: false, error: 'base64 inválido.' });
        return true;
      }
      if (!buf.length || buf.length > INGEST_MAX_FILE_BYTES) {
        sendJson(res, 400, { ok: false, error: 'Arquivo vazio ou acima de 10 MB.' });
        return true;
      }
      await mkdir(join(ingestJobDir(job.id), 'files'), { recursive: true });
      await writeFile(join(ingestJobDir(job.id), 'files', name), buf);
      job.files = job.files.filter((f) => f.name !== name);
      job.files.push({ name, size: buf.length, status: 'enviado' });
      await saveIngestJob(job);
      sendJson(res, 200, { ok: true, files: job.files });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/ingest/start') {
      if (aiModeNone(res)) return true;
      const body = await readJsonBody(req);
      const job = await readIngestJob(String(body.jobId || ''));
      if (!job || !(await canSeeIngestJob(job, req))) {
        sendJson(res, 404, { ok: false, error: 'Job não encontrado.' });
        return true;
      }
      if (job.phase !== 'uploading') {
        sendJson(res, 400, { ok: false, error: 'Job já iniciado.' });
        return true;
      }
      if (!job.files.length) {
        sendJson(res, 400, { ok: false, error: 'Envie ao menos um arquivo.' });
        return true;
      }
      // Orientação do usuário para a estruturação (opcional): entra no prompt de extração,
      // dentro do contrato JSON — guia COMO estruturar, não o formato da resposta.
      job.guidance = String(body.guidance || '')
        .trim()
        .slice(0, 2000);
      job.phase = 'queued';
      await saveIngestJob(job);
      runIngestJob(job.id).catch(() => {}); // detached — progress via GET /api/ingest/job
      sendJson(res, 200, { ok: true, job: { id: job.id, phase: job.phase } });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/ingest/jobs') {
      let entries = [];
      try {
        entries = await readdir(INGEST_ROOT(), { withFileTypes: true });
      } catch (error) {
        entries = [];
      }
      const jobs = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const job = await readIngestJob(e.name);
        if (job && (await canSeeIngestJob(job, req))) {
          jobs.push({
            id: job.id,
            phase: job.phase,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            files: job.files.length,
            candidates: (job.candidates || []).length,
            error: job.error || null
          });
        }
      }
      jobs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      sendJson(res, 200, { ok: true, jobs: jobs.slice(0, 20) });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/ingest/job') {
      const job = await readIngestJob(String(url.searchParams.get('id') || ''));
      if (!job || !(await canSeeIngestJob(job, req))) {
        sendJson(res, 404, { ok: false, error: 'Job não encontrado.' });
        return true;
      }
      sendJson(res, 200, { ok: true, job });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/dedup/check') {
      const body = await readJsonBody(req);
      const items = Array.isArray(body.items) ? body.items.slice(0, 60) : [];
      if (!items.length) {
        sendJson(res, 400, { ok: false, error: 'Informe items: [{ id, title, body }].' });
        return true;
      }
      const index = await similarityIndex();
      const exclude = Array.isArray(body.exclude) ? body.exclude.map(String) : [];
      // excludeLinkedOf: numa promoção, as cápsulas que a PRÓPRIA skill referencia não são
      // duplicatas — o vínculo é a relação correta. Exclui elas (e a skill) da checagem.
      if (body.excludeLinkedOf && isSafeSkillId(String(body.excludeLinkedOf))) {
        const sid = String(body.excludeLinkedOf);
        exclude.push(sid);
        try {
          const spine = await readFile(join(skillsRoot(), sid, 'SKILL.md'), 'utf8');
          for (const cid of linkedCapsuleIds(spine)) exclude.push(`commons/${cid}`);
        } catch (error) {
          /* sem spine legível — exclui só a skill */
        }
      }
      const threshold = Number(body.threshold) > 0 ? Number(body.threshold) : DEDUP_CHECK_THRESHOLD;
      const results = items.map((it) => {
        const title = String(it.title || '');
        const bodyMd = String(it.body || '');
        const vec = termVector(title, bodyMd);
        const hash = contentHash(`${title} ${bodyMd}`);
        return { id: String(it.id || ''), matches: topMatches(vec, hash, index, { threshold, exclude }) };
      });
      sendJson(res, 200, { ok: true, results });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/dedup/queue-item') {
      if (!(await roleReq(req, res, 'curar'))) return true;
      const item = await readQueueItem(String(url.searchParams.get('id') || ''));
      if (!item || item.type !== 'capsule') {
        sendJson(res, 404, { ok: false, error: 'Item de cápsula não encontrado.' });
        return true;
      }
      let manifest = null;
      try {
        manifest = JSON.parse(await readFile(join(queueRoot(), item.id, 'capsule.json'), 'utf8'));
      } catch (error) {
        manifest = null;
      }
      const concepts = (manifest && Array.isArray(manifest.concepts) ? manifest.concepts : []).filter(
        (c) => c && c.body
      );
      if (!concepts.length) {
        sendJson(res, 200, { ok: true, results: [] });
        return true;
      }
      const index = await similarityIndex();
      const exclude = concepts.map((c) => `commons/${String(c.id || '').replace(/^commons\//, '')}`);
      const results = concepts
        .slice(0, 40)
        .map((c) => ({
          id: String(c.id || ''),
          title: String(c.title || c.id || ''),
          matches: topMatches(termVector(c.title, c.body), contentHash(`${c.title} ${c.body}`), index, {
            threshold: DEDUP_CHECK_THRESHOLD,
            exclude
          })
        }))
        .filter((r) => r.matches.length);
      sendJson(res, 200, { ok: true, results });
      return true;
    }

    // A revisão de duplicatas é da curadoria (D1); a lista do que "não é duplicata" fica nesta máquina, então
    // basta o papel, sem a pasta do balde.
    if (req.method === 'GET' && url.pathname === '/api/dedup/corpus') {
      if (!(await roleReq(req, res, 'curar'))) return true;
      const index = await similarityIndex();
      const threshold =
        Number(url.searchParams.get('threshold')) > 0
          ? Number(url.searchParams.get('threshold'))
          : DEDUP_SCAN_THRESHOLD;
      const dismissed = await loadDedupDismissed();
      const dset = new Set((dismissed.pairs || []).map((p) => dedupPairKey(p.a, p.b)));
      // Pares JÁ VINCULADOS não são duplicatas: uma skill âncora compartilha termos com as
      // cápsulas que ela mesma referencia por construção — o vínculo é a relação correta.
      const linkedSet = new Set();
      const skillParents = new Map(); // skillId -> Set<referrer skillId> (para o filtro de irmãos)
      try {
        const link = await corpusLinkIndex();
        const cindex = await corpusNodeIndex();
        for (const [target, entries] of link.backlinks.entries()) {
          const toNode = target.startsWith('commons/') ? target : skillIdOfCorpusPath(target, cindex);
          for (const b of entries) {
            if (!b.fromSkill) continue;
            linkedSet.add(dedupPairKey(b.fromSkill, toNode));
            if (!toNode.startsWith('commons/')) {
              if (!skillParents.has(toNode)) skillParents.set(toNode, new Set());
              skillParents.get(toNode).add(b.fromSkill);
            }
          }
        }
      } catch (error) {
        /* sem índice de links — varredura segue sem o filtro */
      }
      // Irmãos de catálogo: duas SKILLS referenciadas pela MESMA skill-âncora (ex.: as skills
      // por plano do portfólio) são estrutura deliberada, não duplicata acidental.
      const shareParent = (a, b) => {
        const pa = skillParents.get(a);
        const pb = skillParents.get(b);
        if (!pa || !pb) return false;
        for (const p of pa) if (pb.has(p)) return true;
        return false;
      };
      const serieOf = new Map(index.filter((n) => n.serie).map((n) => [n.id, n.serie]));
      const rawPairs = allPairs(index, { threshold, limit: 800 });
      let suppressedSeries = 0;
      let suppressedSiblings = 0;
      const pairs = rawPairs
        .filter((p) => !dset.has(dedupPairKey(p.a.id, p.b.id)) && !linkedSet.has(dedupPairKey(p.a.id, p.b.id)))
        // Episódios de séries (Linha do tempo) são parecidos por construção — dentro da MESMA
        // série (o mesmo relatório ao longo do tempo) E entre séries irmãs (um catálogo de
        // templates, ex.: propostas por plano). Duplicata acidental acontece no conhecimento
        // SEM série — é nele que a varredura foca. Pares série↔série são suprimidos.
        .filter((p) => {
          if (serieOf.get(p.a.id) && serieOf.get(p.b.id)) {
            suppressedSeries += 1;
            return false;
          }
          return true;
        })
        .filter((p) => {
          if (p.a.kind === 'skill' && p.b.kind === 'skill' && shareParent(p.a.id, p.b.id)) {
            suppressedSiblings += 1;
            return false;
          }
          return true;
        })
        .slice(0, 200);
      sendJson(res, 200, {
        ok: true,
        nodes: index.length,
        threshold,
        pairs,
        dismissed: (dismissed.pairs || []).length,
        suppressedSeries,
        suppressedSiblings
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/dedup/dismiss') {
      if (!(await roleReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req);
      const a = String(body.a || '');
      const b = String(body.b || '');
      if (!a || !b) {
        sendJson(res, 400, { ok: false, error: 'Informe a e b (ids do par).' });
        return true;
      }
      const dismissed = await loadDedupDismissed();
      const key = dedupPairKey(a, b);
      dismissed.pairs = (dismissed.pairs || []).filter((p) => dedupPairKey(p.a, p.b) !== key);
      if (!body.restore) {
        dismissed.pairs.push({ a, b, by: webActor(req).email, at: new Date().toISOString() });
      }
      await mkdir(usageRoot, { recursive: true });
      await writeFile(dedupDismissPath(), `${JSON.stringify(dismissed, null, 2)}\n`, 'utf8');
      sendJson(res, 200, { ok: true, dismissed: dismissed.pairs.length });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/ingest/materialize') {
      const body = await readJsonBody(req);
      const job = await readIngestJob(String(body.jobId || ''));
      if (!job || !(await canSeeIngestJob(job, req))) {
        sendJson(res, 404, { ok: false, error: 'Job não encontrado.' });
        return true;
      }
      if (job.phase !== 'ready') {
        sendJson(res, 400, { ok: false, error: `Job em fase "${job.phase}" — só jobs prontos materializam.` });
        return true;
      }
      const wanted = new Set(Array.isArray(body.candidateIds) ? body.candidateIds.map(String) : []);
      const chosen = (job.candidates || []).filter((c) => wanted.has(c.id));
      if (!chosen.length) {
        sendJson(res, 400, { ok: false, error: 'Selecione ao menos um candidato.' });
        return true;
      }
      const domain = normalizeDomainServer(body.domain || '');
      if (!domain) {
        sendJson(res, 400, { ok: false, error: 'Escolha um domínio para as cápsulas.' });
        return true;
      }

      // Capsule ids: normalized title slugs, unique within the manifest AND against the corpus.
      const usedIds = new Set();
      const concepts = [];
      for (const c of chosen) {
        let slug = capsuleSlugSeg(c.title) || `conceito-${c.id}`;
        let id = `${domain}/${slug}`;
        let n = 2;
        while (usedIds.has(id) || (await commonsHasConcept(id))) {
          id = `${domain}/${slug}-${n}`;
          n += 1;
        }
        usedIds.add(id);
        const fonte = (c.sources || []).join(', ');
        const bodyMd = `${String(c.body || '').trim()}\n\n---\n*Origem: ${fonte || 'documento enviado'} · ingestão ${job.id} · extração assistida por IA, revisada por ${job.actor && job.actor.name ? job.actor.name : 'usuário'}.*`;
        const concept = {
          action: 'create',
          id,
          title: String(c.title).slice(0, 120),
          summary: String(c.resumo || '').slice(0, 240),
          body: bodyMd
        };
        // Episódios viram episódios de série de verdade: série derivada do documento-fonte.
        if (c.type === 'episodio' && c.periodo) {
          const stem = String((c.sources || [])[0] || 'ingestao').replace(/\.[^.]+$/, '');
          const serie = normSerieField(stem);
          if (serie) {
            concept.serie = serie;
            concept.periodo = c.periodo;
          }
        }
        concepts.push(concept);
      }

      const manifest = {
        format: CAPSULE_FORMAT,
        title: `Ingestão: ${concepts.length} cápsula(s) — ${[...new Set(chosen.flatMap((c) => c.sources || []))].join(', ').slice(0, 100)}`,
        concepts
      };
      const anchorMode = String(body.anchorMode || 'none');
      if (anchorMode === 'update') {
        const aid = String(body.anchorId || '').trim();
        if (!aid) {
          sendJson(res, 400, { ok: false, error: 'Informe a skill âncora (anchorId).' });
          return true;
        }
        manifest.skill = { action: 'update', id: aid };
      } else if (anchorMode === 'create') {
        const title = String(body.newTitle || '').trim();
        const objetivo = String(body.newObjetivo || '').trim();
        if (!title || !objetivo) {
          sendJson(res, 400, { ok: false, error: 'Para criar a skill âncora, informe título e objetivo.' });
          return true;
        }
        manifest.skill = { action: 'create', domain, slug: slugifySkillId(title), title, objetivo };
      }

      const compiled = await compileCapsule(manifest, webActor(req));
      if (!compiled.ok) {
        sendJson(res, 200, { ok: false, errors: compiled.errors, warnings: compiled.warnings });
        return true;
      }
      const actor = actorFromReq(req);
      const item = await createCapsuleQueueItem(manifest, compiled, {
        source: 'web',
        submittedBy: { name: actor.name, email: actor.email }
      });
      job.phase = 'materialized';
      job.queueId = item.id;
      job.materializedAt = new Date().toISOString();
      job.materializedIds = [...wanted];
      await saveIngestJob(job);
      sendJson(res, 201, { ok: true, queueId: item.id, plan: compiled.plan, warnings: compiled.warnings });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/ingest/discard') {
      const body = await readJsonBody(req);
      const job = await readIngestJob(String(body.jobId || ''));
      if (!job || !(await canSeeIngestJob(job, req))) {
        sendJson(res, 404, { ok: false, error: 'Job não encontrado.' });
        return true;
      }
      await rm(ingestJobDir(job.id), { recursive: true, force: true });
      sendJson(res, 200, { ok: true });
      return true;
    }
    return false;
  };
}
