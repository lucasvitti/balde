import { pendingRecovery } from '../governance/recovery.mjs';
import { discardFileTransaction } from '../governance/file-transaction.mjs';
import { flushPendingCommits } from '../git-corpus.mjs';
import { queueDecisionConflict } from '../governance/queue-decisions.mjs';
import { feedbackDecisions } from '../governance/feedback-decisions.mjs';
import { operationKey, runOperation } from '../governance/operations.mjs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { assertSafeUploadName } from '../skill-format.mjs';
import { lintTextAgainstOntology } from '../ontology.mjs';
import {
  skillsRoot,
  commonsRoot,
  queueRoot,
  outboxRoot,
  repoDirOf,
  activeRepo,
  DEFAULT_REPO,
  mimeTypes
} from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { actorFromReq } from '../git-corpus.mjs';

export function createQueueRoutes({
  readJsonBody,
  QUEUE_MAX_BODY,
  canReadSkillActor,
  webActor,
  sendJson,
  createQueueItem,
  recordSkillEvent,
  curatesActiveBaldeReq,
  loadFeedbackBySkill,
  feedbackEntryId,
  markFeedbackResolved,
  readQueueItem,
  canManageSkillActor,
  listQueueItems,
  queueCounts,
  outboxCountFor,
  queueFilePathIfExists,
  readQueueMeta,
  loadQueueItem,
  domainOntologyLintIndex,
  loadUserAiConfig,
  preprocessQueueItem,
  skillExistsById,
  writeQueueMeta,
  compileCapsule,
  createDomainDenial,
  queueDir,
  applyCapsuleManifest,
  permitReq,
  permissionsReq,
  commitCorpus,
  regenerateContextIndex,
  mergeQueueItemIntoSkill
}) {
  return async function queueRoutes(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/queue/submit') {
      try {
        const body = await readJsonBody(req, QUEUE_MAX_BODY);
        const actor = actorFromReq(req);
        const targetSkill = String(body.skillId || '').trim();
        if (targetSkill && !(await canReadSkillActor(targetSkill, webActor(req)))) {
          sendJson(res, 404, { ok: false, error: 'Skill não encontrada.' }); // don't leak restricted skills
          return true;
        }
        const item = await createQueueItem({
          skillId: body.skillId,
          title: body.title,
          content: body.content,
          tags: body.tags,
          files: body.files,
          source: body.source === 'chat' ? 'chat' : 'web',
          submittedBy: { name: actor.name, email: actor.email }
        });
        recordSkillEvent('contribute', item.skillId, 'app', actor); // in-app contribution to the curation queue
        sendJson(res, 201, {
          ok: true,
          id: item.id,
          status: item.status,
          skillId: item.skillId,
          files: item.files.length
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/feedback/convert') {
      if (!(await permitReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req);
      const actor = webActor(req);
      try {
        const result = await runOperation(
          join(repoDirOf(activeRepo()), '.balde', 'operations'),
          `feedback-${operationKey(body.id)}`,
          { id: body.id, content: body.content, skillId: body.skillId },
          async ({ checkpoint }) => {
            const feedback = (await loadFeedbackBySkill()).get(body.skillId) || [];
            if (!feedback.some((item) => feedbackEntryId(body.skillId, item.timestamp, item.question) === body.id))
              throw new Error('Feedback não encontrado neste balde.');
            const previous = (await feedbackDecisions(queueRoot())).get(body.id);
            if (previous && previous.action !== 'converted') throw new Error('Este feedback já recebeu outra decisão.');
            const item = await checkpoint('contribution', () =>
              createQueueItem({
                skillId: body.skillId,
                title: body.title,
                content: body.content,
                source: 'chat',
                submittedBy: actor,
                feedbackId: body.id
              })
            );
            await checkpoint('resolution', () =>
              markFeedbackResolved(body.id, {
                action: 'converted',
                contributionId: item.id,
                by: actor.name,
                email: actor.email
              })
            );
            return { ok: true, id: item.id, status: item.status };
          }
        );
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 409, { ok: false, retryable: true, error: error.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/feedback/resolve') {
      // A decisão fica na Fila do balde: curadoria e a pasta gravável.
      if (!(await permitReq(req, res, 'curar'))) return true;
      const body = await readJsonBody(req);
      const fid = String(body.id || '').trim();
      if (!fid) {
        sendJson(res, 400, { ok: false, error: 'id do feedback ausente.' });
        return true;
      }
      const actor = actorFromReq(req);
      if (body.action === 'converted') {
        const contribution = await readQueueItem(body.contributionId);
        if (!contribution || contribution.originFeedbackId !== fid) {
          sendJson(res, 409, { ok: false, error: 'Não há contribuição vinculada a este feedback.' });
          return true;
        }
      }
      await markFeedbackResolved(fid, {
        action: body.action === 'converted' ? 'converted' : 'dismissed',
        note: String(body.note || '').slice(0, 500),
        contributionId: body.contributionId || null,
        by: actor.name || actor.email
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (url.pathname === '/api/queue' || url.pathname.startsWith('/api/queue/')) {
      const curator = await curatesActiveBaldeReq(req);
      // The Fila lives in the balde's folder: changing it (and approving, which writes the balde) needs
      // curation and edit rights on that folder from this machine, the same rule as every curation write.
      if (req.method !== 'GET' && !(await permitReq(req, res, 'curar'))) return true;
      // Federated visibility: a curator only sees/acts on queue items whose skill they can read/manage.
      // Unassigned items (no skillId) stay visible to every curator for triage.
      const queueActor = webActor(req);
      const mayReadSkill = async (sid) => (sid ? canReadSkillActor(sid, queueActor) : true);
      const mayManageSkill = async (sid) => (sid ? canManageSkillActor(sid, queueActor) : true);
      // R2: per-item routes only touch items of the ACTIVE repo (legacy items = default repo),
      // so an item id from balde X can't be read/decided/applied while working in balde Y.
      const inActiveRepo = (item) =>
        Boolean(item) &&
        (item.repo || DEFAULT_REPO) === activeRepo() &&
        (curator || String(item.submittedBy?.email || '').toLowerCase() === queueActor.email.toLowerCase());
      const filterReadable = async (items) => {
        const out = [];
        for (const item of items) {
          if (inActiveRepo(item) && (await mayReadSkill(item.skillId))) out.push(item);
        }
        return out;
      };

      const visibleItems = async () => {
        const central = await listQueueItems();
        const own = outboxRoot
          ? (await listQueueItems(outboxRoot)).filter(
              (item) => String(item.submittedBy?.email || '').toLowerCase() === queueActor.email.toLowerCase()
            )
          : [];
        const all = new Map(own.map((item) => [item.id, { ...item, delivery: 'awaiting-sync' }]));
        for (const item of central)
          all.set(item.id, {
            ...item,
            delivery: item.review?.publicationId
              ? 'published'
              : item.review?.appliedState === 'draft'
                ? 'draft'
                : 'received'
          });
        return filterReadable([...all.values()]);
      };
      if (req.method === 'GET' && url.pathname === '/api/queue') {
        const readable = await visibleItems();
        const statusFilter = url.searchParams.get('status');
        const filtered = statusFilter
          ? readable.filter((item) => (item.status || 'pendente') === statusFilter)
          : readable;
        // writable: may this machine change the Fila; incoming: contributions to this balde still in
        // someone's outbox, waiting for an app with edit rights to move them in.
        sendJson(res, 200, {
          ok: true,
          items: filtered,
          counts: queueCounts(readable),
          writable: (await permissionsReq(req)).curar.ok,
          incoming: curator ? await outboxCountFor(activeRepo()) : 0,
          recovery: curator ? await pendingRecovery(repoDirOf(activeRepo())) : []
        });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/queue/history/retry') {
        await flushPendingCommits(skillsRoot());
        await flushPendingCommits(commonsRoot());
        sendJson(res, 200, { ok: true, recovery: await pendingRecovery(repoDirOf(activeRepo())) });
        return true;
      }

      // Uma aplicação de cápsula pela metade bloqueia o balde inteiro; o curador a desfaz aqui (o conteúdo volta
      // ao anterior e a contribuição segue pendente) em vez de apagar o registro à mão.
      if (req.method === 'POST' && url.pathname === '/api/queue/capsule/discard') {
        const body = await readJsonBody(req, QUEUE_MAX_BODY);
        const id = String(body.id || '');
        if (!/^[\w.-]{1,160}$/.test(id)) {
          sendJson(res, 400, { ok: false, error: 'Operação inválida.' });
          return true;
        }
        const actor = webActor(req);
        try {
          const outcome = await discardFileTransaction({
            journalPath: join(repoDirOf(activeRepo()), '.balde', 'capsule-operations', `${id}.json`),
            root: repoDirOf(activeRepo()),
            actor: actor.email || actor.name || ''
          });
          sendJson(res, 200, { ok: true, ...outcome, recovery: await pendingRecovery(repoDirOf(activeRepo())) });
        } catch (error) {
          sendJson(res, 409, { ok: false, error: error.message });
        }
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/queue/count') {
        sendJson(res, 200, { ok: true, counts: queueCounts(await visibleItems()) });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/queue/file') {
        const id = url.searchParams.get('id');
        let found = await queueFilePathIfExists(id, url.searchParams.get('name'));
        const meta = (await readQueueMeta(id)) || (outboxRoot ? await loadQueueItem(id, { root: outboxRoot }) : null);
        if (!found && outboxRoot && meta?.files?.some((file) => file.name === url.searchParams.get('name'))) {
          const name = assertSafeUploadName(url.searchParams.get('name'));
          const path = join(outboxRoot, id, 'files', name);
          if (await pathExists(path)) found = { name, path };
        }
        if (!found) {
          sendJson(res, 404, { ok: false, error: 'Arquivo não encontrado.' });
          return true;
        }
        if (!inActiveRepo(meta) || !(await mayReadSkill(meta?.skillId))) {
          sendJson(res, 404, { ok: false, error: 'Arquivo não encontrado.' });
          return true;
        }
        const fileMeta = (meta?.files || []).find((file) => file.name === found.name);
        const buf = await readFile(found.path);
        res.writeHead(200, {
          'content-type':
            (fileMeta && fileMeta.mime) || mimeTypes[extname(found.name).toLowerCase()] || 'application/octet-stream',
          'content-disposition': `attachment; filename="${found.name.replace(/[^\w.\- ]+/g, '_')}"`,
          'content-length': buf.length,
          'cache-control': 'no-store'
        });
        res.end(buf);
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/queue/item') {
        const id = url.searchParams.get('id');
        const item =
          (await readQueueItem(id)) ||
          (outboxRoot ? await loadQueueItem(id, { root: outboxRoot, withContent: true }) : null);
        if (!inActiveRepo(item) || !(await mayReadSkill(item.skillId))) {
          sendJson(res, 404, { ok: false, error: 'Item da fila não encontrado.' });
          return true;
        }
        // Fila lint (advisory, computado na hora — nada persiste): contribuição de texto checada
        // contra a ONTOLOGIA do domínio da skill de destino. Itens de cápsula já chegam com os
        // warnings do compile (ontologia-* incluídos) dentro de item.capsule.warnings.
        if (item.type !== 'capsule' && item.skillId && String(item.content || '').trim()) {
          try {
            const domain = String(item.skillId).split('/')[0];
            const ontoIdx = await domainOntologyLintIndex(domain, webActor(req));
            if (ontoIdx) {
              const findings = lintTextAgainstOntology(item.content, ontoIdx, 5);
              if (findings.length) item.ontologyLint = { domain, findings };
            }
          } catch (error) {
            /* lint é best-effort */
          }
        }
        sendJson(res, 200, { ok: true, item });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/queue/preprocess') {
        const body = await readJsonBody(req);
        const item = await readQueueItem(body.id);
        if (!inActiveRepo(item) || !(await mayReadSkill(item.skillId))) {
          sendJson(res, 404, { ok: false, error: 'Item da fila não encontrado.' });
          return true;
        }
        const aiConfig = await loadUserAiConfig(actorFromReq(req));
        if (!aiConfig || !aiConfig.apiKey) {
          sendJson(res, 400, {
            ok: false,
            error: 'Configure seu provedor e chave de IA em Configurações para preprocessar.'
          });
          return true;
        }
        try {
          const updated = await preprocessQueueItem(item, aiConfig);
          if (!updated) {
            sendJson(res, 502, { ok: false, error: 'O provedor de IA não retornou resultado.' });
            return true;
          }
          sendJson(res, 200, { ok: true, item: updated });
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `Falha na IA: ${error.message}` });
        }
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/queue/reassign') {
        const body = await readJsonBody(req);
        const item = await readQueueItem(body.id);
        if (!inActiveRepo(item) || !(await mayReadSkill(item.skillId))) {
          sendJson(res, 404, { ok: false, error: 'Item da fila não encontrado.' });
          return true;
        }
        const target = String(body.skillId || '').trim();
        if (!(await skillExistsById(target))) {
          sendJson(res, 400, { ok: false, error: 'Skill de destino desconhecida.' });
          return true;
        }
        if (!(await mayManageSkill(target))) {
          sendJson(res, 403, { ok: false, error: 'Sem permissão para mover a contribuição para essa skill.' });
          return true;
        }
        if (item.status !== 'pendente') {
          sendJson(res, 409, {
            ok: false,
            error:
              'Uma contribuição decidida não pode ser reaberta ou movida. Crie uma nova contribuição vinculada ao histórico.'
          });
          return true;
        }
        item.skillId = target;
        await writeQueueMeta(item);
        sendJson(res, 200, { ok: true, item });
        return true;
      }

      // Edição de cápsula pendente: reescreve o capsule.json AUTORITATIVO (aprovação recompila a partir
      // dele) e re-deriva tudo que o item.json congela no submit (title/plan/warnings/summary/preview).
      // Nada é gravado quando o manifesto não compila — mesmo shape de falha do /api/capsule/submit.
      if (req.method === 'POST' && url.pathname === '/api/queue/edit-capsule') {
        const body = await readJsonBody(req);
        const item = await loadQueueItem(String(body.id || ''), { withContent: true });
        if (!inActiveRepo(item) || !(await mayReadSkill(item.skillId))) {
          sendJson(res, 404, { ok: false, error: 'Item da fila não encontrado.' });
          return true;
        }
        if (item.type !== 'capsule') {
          sendJson(res, 400, { ok: false, error: 'Apenas itens de cápsula podem ser editados aqui.' });
          return true;
        }
        if (item.status !== 'pendente') {
          sendJson(res, 409, { ok: false, error: 'Este item já recebeu uma decisão. Recarregue a Fila.' });
          return true;
        }
        if (!(await mayManageSkill(item.skillId))) {
          sendJson(res, 403, { ok: false, error: 'Sem permissão para decidir sobre esta skill.' });
          return true;
        }
        const manifest = body.manifest;
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
          sendJson(res, 400, { ok: false, error: 'Envie o manifesto editado em "manifest".' });
          return true;
        }
        // actor=null: mesmo modelo de confiança da recompilação de aprovação — o curador não precisa
        // da whitelist de domínios do SUBMITTER para editar o que já foi submetido. Mas domínios de
        // criação NOVOS (introduzidos pela edição, ausentes do manifesto armazenado) são autoria do
        // EDITOR e passam pela whitelist dele — senão a edição contorna a compartimentação por domínio.
        const compiled = await compileCapsule(manifest, null);
        if (!compiled.ok) {
          sendJson(res, 200, { ok: false, errors: compiled.errors, warnings: compiled.warnings, plan: [] });
          return true;
        }
        const createDomainsOf = (m) => {
          const out = new Set();
          const sk = m && m.skill && typeof m.skill === 'object' ? m.skill : null;
          if (sk && sk.action !== 'update') {
            const dom = String(sk.id || '').includes('/')
              ? String(sk.id).split('/')[0]
              : String(sk.domain || '').trim();
            if (dom) out.add(dom);
          }
          for (const c of Array.isArray(m && m.concepts) ? m.concepts : []) {
            if (c && c.action !== 'update' && String(c.id || '').includes('/')) out.add(String(c.id).split('/')[0]);
          }
          return out;
        };
        const priorDomains = createDomainsOf(item.capsule && item.capsule.manifest);
        for (const dom of createDomainsOf(manifest)) {
          if (priorDomains.has(dom)) continue;
          const denial = await createDomainDenial(webActor(req), dom);
          if (denial) {
            sendJson(res, 403, { ok: false, error: denial });
            return true;
          }
        }
        const newAnchor = (compiled.summary && compiled.summary.anchorId) || '';
        if (newAnchor && newAnchor !== item.skillId && !(await mayManageSkill(newAnchor))) {
          sendJson(res, 403, { ok: false, error: 'Sem permissão para mover a cápsula para essa skill.' });
          return true;
        }
        const dir = queueDir(item.id);
        // Proveniência: queueRoot não é repo git — guarda o manifesto original UMA vez + trilha de edições.
        const origPath = join(dir, 'capsule.orig.json');
        if (!(await pathExists(origPath))) {
          try {
            await cp(join(dir, 'capsule.json'), origPath);
          } catch (error) {
            /* best-effort */
          }
        }
        await writeFile(join(dir, 'capsule.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        const editActor = actorFromReq(req);
        const firstConcept = Array.isArray(manifest.concepts) && manifest.concepts.length ? manifest.concepts[0] : null;
        item.title =
          String(manifest.title || '')
            .trim()
            .slice(0, 160) || `Cápsula: ${firstConcept ? firstConcept.id : newAnchor || 'importação'}`;
        item.skillId = newAnchor;
        item.capsule = {
          plan: compiled.plan,
          warnings: compiled.warnings,
          summary: compiled.summary,
          compiledAt: new Date().toISOString()
        };
        item.preview = compiled.plan.join(' · ').slice(0, 400);
        item.edits = [
          ...(Array.isArray(item.edits) ? item.edits : []),
          { by: editActor.name, email: editActor.email, at: new Date().toISOString() }
        ].slice(-20);
        await writeQueueMeta(item);
        sendJson(res, 200, { ok: true, item: await readQueueItem(item.id), warnings: compiled.warnings });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/queue/decide') {
        const body = await readJsonBody(req);
        const item = await readQueueItem(body.id);
        if (!inActiveRepo(item) || !(await mayReadSkill(item.skillId))) {
          sendJson(res, 404, { ok: false, error: 'Item da fila não encontrado.' });
          return true;
        }
        if (!(await mayManageSkill(item.skillId))) {
          sendJson(res, 403, { ok: false, error: 'Sem permissão para decidir sobre esta skill.' });
          return true;
        }
        if (item.status !== 'pendente') {
          sendJson(res, 409, { ok: false, error: 'Este item já recebeu uma decisão. Recarregue a Fila.' });
          return true;
        }
        if (body.revision != null && Number(body.revision) !== Number(item.revision || 0)) {
          sendJson(res, 409, {
            ok: false,
            error: 'A contribuição mudou desde sua leitura. Recarregue antes de decidir.'
          });
          return true;
        }
        if (await queueDecisionConflict(queueRoot(), item.id)) {
          sendJson(res, 409, { ok: false, error: 'Decisões concorrentes requerem reconciliação.' });
          return true;
        }
        const decision = ['aprovar', 'recusar', 'mesclado'].includes(body.decision) ? body.decision : null;
        if (!decision) {
          sendJson(res, 400, { ok: false, error: 'Decisão inválida (use aprovar, recusar ou mesclado).' });
          return true;
        }
        // Aprovar uma contribuição ou consulta grava na pasta da skill; com a skill arquivada isso recriaria
        // uma pasta sem SKILL.md. A cápsula recompila contra o corpus atual e já recusa uma âncora ausente.
        if (
          decision === 'aprovar' &&
          item.type !== 'capsule' &&
          item.skillId &&
          !(await pathExists(join(skillsRoot(), item.skillId, 'SKILL.md')))
        ) {
          sendJson(res, 409, {
            ok: false,
            error: `A skill "${item.skillId}" não está no corpus ativo (foi arquivada?). Restaure-a em Governança › Arquivadas ou escolha outra skill de destino.`
          });
          return true;
        }
        // Quem chega aqui já cura este balde com a pasta gravável (permitReq acima) e o item é dele
        // (inActiveRepo). Até a 2.0.18 uma segunda checagem pelo repo carimbado no item recusava os itens sem
        // carimbo, como as consultas do chat, numa instalação somente-leitura.
        const actor = actorFromReq(req);
        try {
          if (decision === 'recusar') {
            item.status = 'recusado';
            item.review = {
              by: actor.name,
              email: actor.email,
              at: new Date().toISOString(),
              decision: 'recusado',
              note: String(body.note || '').slice(0, 1000)
            };
            await writeQueueMeta(item);
            sendJson(res, 200, { ok: true, item });
            return true;
          }
          // Capsule items: approval IS the deploy. Re-compile against the CURRENT corpus first —
          // stale capsules (the corpus moved since submit) fail cleanly and stay pendente.
          if (item.type === 'capsule') {
            if (decision !== 'aprovar') {
              sendJson(res, 400, { ok: false, error: 'Itens de cápsula aceitam apenas aprovar ou recusar.' });
              return true;
            }
            const manifest = item.capsule && item.capsule.manifest;
            if (!manifest) {
              sendJson(res, 400, { ok: false, error: 'Manifesto da cápsula não encontrado no item.' });
              return true;
            }
            const result = await applyCapsuleManifest(manifest, actor, {
              // Curadores fazem toda ação de conteúdo (D1), inclusive mudar uma cadência travada.
              isAdmin: true,
              queueId: item.id
            });
            if (!result.ok) {
              sendJson(res, 409, {
                ok: false,
                error: 'A cápsula não compila mais contra o corpus atual — nada foi aplicado.',
                errors: result.errors || [],
                warnings: result.warnings || []
              });
              return true;
            }
            item.status = 'aprovado';
            item.review = {
              by: actor.name,
              email: actor.email,
              at: new Date().toISOString(),
              decision: 'aprovado',
              note: String(body.note || '').slice(0, 1000),
              applied: result.applied
            };
            await writeQueueMeta(item);
            sendJson(res, 200, { ok: true, item });
            return true;
          }
          // Query drafts (AI-written SQL from chat run_sql): approval IS canonization — the
          // SQL is written as query/<slug>.sql in the skill and committed; from then on the
          // buddy reaches it via run_query (governed), no longer as ad-hoc SQL.
          if (item.type === 'query') {
            if (decision !== 'aprovar') {
              sendJson(res, 400, { ok: false, error: 'Rascunhos de query aceitam apenas aprovar ou recusar.' });
              return true;
            }
            if (!(await skillExistsById(item.skillId))) {
              sendJson(res, 400, { ok: false, error: `Skill "${item.skillId}" não existe mais.` });
              return true;
            }
            let sqlText = '';
            try {
              sqlText = await readFile(join(queueDir(item.id), 'content.md'), 'utf8');
            } catch (error) {
              sqlText = '';
            }
            if (!sqlText.trim()) {
              sendJson(res, 400, { ok: false, error: 'SQL do rascunho não encontrada no item.' });
              return true;
            }
            let rel = String((item.query && item.query.path) || '')
              .replace(/\\/g, '/')
              .replace(/^\/+/, '');
            if (!/^query\/[a-z0-9][a-z0-9-]{0,60}\.sql$/.test(rel))
              rel = `query/consulta-ia-${String((item.query && item.query.hash) || item.id).slice(0, 6)}.sql`;
            const skillDir = join(skillsRoot(), item.skillId);
            const finalRel = `query/contribution-${item.id}.sql`;
            const sqlPath = join(skillDir, finalRel);
            const value = sqlText.endsWith('\n') ? sqlText : `${sqlText}\n`;
            if (await pathExists(sqlPath)) {
              if ((await readFile(sqlPath, 'utf8')) !== value)
                throw new Error('A consulta já existe com outro conteúdo.');
            } else {
              await mkdir(dirname(sqlPath), { recursive: true });
              await writeFile(sqlPath, value, { encoding: 'utf8', flag: 'wx' });
            }
            await commitCorpus(
              `skill(${item.skillId}): query governada ${finalRel} aprovada da fila ${item.id} por ${actor.name || actor.email || 'curador'}`,
              actor,
              [item.skillId]
            );
            regenerateContextIndex(item.skillId, actor).catch(() => {});
            item.status = 'aprovado';
            item.review = {
              by: actor.name,
              email: actor.email,
              at: new Date().toISOString(),
              decision: 'aprovado',
              note: String(body.note || '').slice(0, 1000),
              appliedState: 'draft',
              appliedPath: finalRel
            };
            item.query = { ...(item.query || {}), appliedState: 'draft', appliedPath: finalRel };
            await writeQueueMeta(item);
            sendJson(res, 200, { ok: true, item });
            return true;
          }
          if (decision === 'mesclado') {
            sendJson(res, 409, {
              ok: false,
              error: 'Use Publicar com a contribuição vinculada; o fechamento exige um comprovante de publicação.'
            });
            return true;
          }
          const content = String(body.content != null ? body.content : item.ai?.cleanedContent || item.content);
          const merged = await mergeQueueItemIntoSkill(item, content, actor);
          item.status = 'aprovado';
          item.review = {
            by: actor.name,
            email: actor.email,
            at: new Date().toISOString(),
            decision: 'aprovado',
            note: String(body.note || '').slice(0, 1000),
            mergedInto: item.skillId,
            appliedState: 'draft',
            section: merged.section,
            mergedFiles: merged.files,
            mergedContent: content.slice(0, 20000)
          };
          await writeQueueMeta(item);
          sendJson(res, 200, { ok: true, item });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
        return true;
      }

      sendJson(res, 404, { ok: false, error: 'Rota de fila desconhecida.' });
      return true;
    }
    return false;
  };
}
