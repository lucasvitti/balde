import { CHAT_MAX_MESSAGE, CHAT_TOOL_MAX_STEPS } from '../policy/chat-policy.mjs';
import { CAPSULE_CATEGORY_DEFAULT } from '../policy/governance-policy.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSafeSkillId } from '../skill-format.mjs';
import { skillsRoot, buddiesRoot, docsRoot, commonsRoot, activeRepo, ASSET_MAX_BYTES } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { gitHistoryForPath } from '../git-corpus.mjs';
import { runGovernedQuery, inspectDataset, datasetTableName } from '../duckdb.mjs';
import { reposForActor } from '../repos.mjs';
import { callAiChatToolLoop, callAiChatToolLoopStream } from '../ai-provider.mjs';
import { loadBuddy, listBuddies, toBuddySummary, skillsUsingBuddy, loadGlobalTheme, buddyThemes } from '../buddies.mjs';
import { listUndeliveredEvents, ackNotifyEvents, buildEventsEmail, buildDeprecationEmail } from '../notify.mjs';

export function createMachineApiRoutes({
  authorizeMachine,
  sendJson,
  readJsonBody,
  QUEUE_MAX_BODY,
  canReadSkillActor,
  createQueueItem,
  recordSkillEvent,
  canCreateBuddyReq,
  actorIsAdmin,
  AUTHENTIK_API_URL,
  buildNotifyDigestEmails,
  loadUserPrefs,
  normEmail,
  loadRoster,
  NOTIFY_BASE_URL,
  loadSkillsFromDisk,
  notifyRecipientsForSkill,
  buildCommonsList,
  searchCorpusFileAssets,
  pubUrl,
  searchCorpus,
  AI_MODE,
  loadUserAiConfig,
  buildAskGrounding,
  toOkfSummary,
  loadSkillConsumerContext,
  skillQueryDatasets,
  formatBytesServer,
  DATASET_EXT_RE,
  skillContextManifest,
  discoverSkillContextFiles,
  extractContextLinks,
  contextNodePaths,
  corpusNodeIndex,
  contextKind,
  resolveSkillFileAsset,
  skillExistsById,
  serveFileBytes,
  mediaMimeFor,
  checkPermission,
  commitCorpus,
  skillFileAssetV1Url,
  resolveCommonsFileAsset,
  commonsHasConcept,
  canReadCommonsActor,
  commitRepo,
  commonsFileAssetV1Url,
  commonsListForActor,
  readCommonsConceptForContext,
  commonsConceptContextPath,
  conceptGovernanceFrom,
  loadCommonsConceptGov,
  loadCommonsDefaults,
  loadScoringConfig,
  conceptMediaEntries,
  commonsFileAssetWebUrl,
  compileCapsule,
  loadCapsuleCategories,
  createCapsuleQueueItem,
  toOkfDetail,
  nodeEvalView,
  skillFileAssetWebUrl,
  domainOntologyFor,
  resolveChatContextMode,
  readSkillTextContext
}) {
  return async function machineApiRoutes(req, res, url) {
    if (req.method === 'POST' && /^\/api\/v1\/queue\/?$/.test(url.pathname)) {
      const machine = await authorizeMachine(req);
      if (!machine) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
        return true;
      }
      try {
        const body = await readJsonBody(req, QUEUE_MAX_BODY);
        const targetSkill = String(body.skill || body.skillId || '').trim();
        if (targetSkill && !(await canReadSkillActor(targetSkill, machine))) {
          sendJson(res, 404, { error: 'skill not found' }); // token can't enqueue into a skill it can't read
          return true;
        }
        const item = await createQueueItem({
          skillId: body.skill || body.skillId,
          title: body.title,
          content: body.content,
          tags: body.tags,
          files: body.files,
          source: 'api',
          submittedBy: {
            name: machine.name || body.author || 'integração',
            email: machine.email || body.authorEmail || ''
          }
        });
        recordSkillEvent('contribute', item.skillId, 'machine', machine); // machine contribution via /api/v1/queue
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

    if (req.method === 'GET' && /^\/api\/v1\/buddies\/?$/.test(url.pathname)) {
      if (!(await authorizeMachine(req))) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
        return true;
      }
      const buddies = await listBuddies();
      sendJson(res, 200, {
        format: 'buddies/0.1',
        generatedAt: new Date().toISOString(),
        count: buddies.length,
        buddies: buddies.map(toBuddySummary)
      });
      return true;
    }

    {
      const detailMatch = url.pathname.match(/^\/api\/(v1\/)?buddies\/([^/]+)\/?$/);
      if (req.method === 'GET' && detailMatch && decodeURIComponent(detailMatch[2]) !== 'new') {
        if (detailMatch[1] && !(await authorizeMachine(req))) {
          sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
          return true;
        }
        const id = decodeURIComponent(detailMatch[2]);
        let buddy = null;
        try {
          buddy = await loadBuddy(id);
        } catch (error) {
          buddy = null;
        }
        if (!buddy) {
          sendJson(res, 404, { ok: false, error: `Buddy "${id}" nao encontrado.` });
          return true;
        }
        const base = detailMatch[1] ? `/api/v1/buddies/${id}/poses` : `/api/buddies/${id}/poses`;
        const payload = {
          ok: true,
          id: buddy.id,
          name: buddy.name,
          description: buddy.description,
          temperament: buddy.temperament,
          group: buddy.group,
          theme: buddy.theme,
          effectiveTheme: buddy.effectiveTheme,
          default_pose: buddy.default_pose,
          poses: buddy.poses.map((pose) => ({
            code: pose.code,
            ext: pose.ext,
            bytes: pose.bytes,
            url: `${base}/${pose.code}`
          }))
        };
        if (!detailMatch[1]) {
          payload.history = await gitHistoryForPath(buddiesRoot, id);
          payload.canCreateBuddy = canCreateBuddyReq(req);
          payload.usedBy = await skillsUsingBuddy(id);
          payload.baseTemperament = buddy.baseTemperament; // for the editor (per-theme temperament)
          payload.themeTemperaments = buddy.themeTemperaments;
          payload.poseThemes = await buddyThemes(id); // themed pose-folders this buddy has
          payload.globalTheme = await loadGlobalTheme();
        }
        sendJson(res, 200, payload);
        return true;
      }
    }

    if (url.pathname.startsWith('/api/v1/notify/')) {
      const machine = await authorizeMachine(req);
      if (!machine) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
        return true;
      }
      // Admin-only: these endpoints expose other users' e-mails and pending work. In local dev
      // (no Authentik) the shared API_KEY stands in; on prod AUTHENTIK_API_URL is set, so only a
      // personal token whose user is in the Admins group passes.
      if (!(actorIsAdmin(machine) || (!AUTHENTIK_API_URL && machine.via === 'shared-key'))) {
        sendJson(res, 403, { ok: false, error: 'Apenas admins consomem o feed de notificações.' });
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/notify/digest') {
        const emails = await buildNotifyDigestEmails();
        sendJson(res, 200, { ok: true, count: emails.length, emails });
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/notify/events') {
        const undelivered = await listUndeliveredEvents();
        const prefsCache = new Map();
        const perItemOn = async (email) => {
          if (!prefsCache.has(email)) prefsCache.set(email, (await loadUserPrefs({ email })).notify.perItem);
          return prefsCache.get(email);
        };
        const byRecipient = new Map();
        const includedIds = new Set();
        const zeroRecipientIds = [];
        for (const ev of undelivered) {
          const tos = [];
          for (const t of ev.to || []) {
            const email = normEmail(t);
            if (email && (await perItemOn(email)) && !tos.includes(email)) tos.push(email);
          }
          if (!tos.length) {
            zeroRecipientIds.push(ev.id);
            continue;
          } // nobody opted in → auto-ack
          includedIds.add(ev.id);
          for (const t of tos) {
            if (!byRecipient.has(t)) byRecipient.set(t, []);
            byRecipient.get(t).push(ev);
          }
        }
        if (zeroRecipientIds.length) await ackNotifyEvents(zeroRecipientIds);
        const roster = await loadRoster();
        const nameOf = (email) => {
          const p = roster.find((u) => normEmail(u.email) === email);
          return (p && p.name) || email;
        };
        const emails = [...byRecipient.entries()].map(([to, evs]) => ({
          to,
          eventIds: evs.map((e) => e.id),
          ...buildEventsEmail(nameOf(to), evs, NOTIFY_BASE_URL)
        }));
        sendJson(res, 200, { ok: true, count: emails.length, ids: [...includedIds], emails });
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/notify/ack') {
        const body = await readJsonBody(req);
        const ids = Array.isArray(body.ids) ? body.ids : [];
        await ackNotifyEvents(ids);
        sendJson(res, 200, { ok: true, acked: ids.length });
        return true;
      }
      // MANDATORY deprecation warnings: ignores per-user notify prefs by design — stewards must
      // learn their artifact went stale. State-of-the-world summary per steward; idempotent, no ack.
      if (req.method === 'GET' && url.pathname === '/api/v1/notify/deprecation') {
        const skills = await loadSkillsFromDisk();
        const byRecipient = new Map();
        const add = (email, item) => {
          const e = normEmail(email);
          if (!e || !e.includes('@')) return;
          if (!byRecipient.has(e)) byRecipient.set(e, []);
          if (!byRecipient.get(e).some((x) => x.id === item.id)) byRecipient.get(e).push(item);
        };
        for (const s of skills.filter((x) => x.deprecated)) {
          const item = {
            kind: 'skill',
            id: s.id,
            label: s.nome,
            reasons: (s.deprecation && s.deprecation.reasons) || []
          };
          for (const to of await notifyRecipientsForSkill(s.id, null)) add(to, item);
        }
        try {
          const commonsList = await buildCommonsList();
          for (const c of commonsList.concepts || []) {
            const gv = c.governance || {};
            if (gv.status !== 'overdue') continue;
            const item = {
              kind: 'capsule',
              id: `commons/${c.path}`,
              label: c.title || c.path,
              reasons: [
                `revisão vencida${gv.expiresAt || gv.dueAt ? ` em ${String(gv.expiresAt || gv.dueAt).slice(0, 10)}` : ''}`
              ]
            };
            for (const to of [gv.creator, ...(gv.curators || [])]) add(to, item);
          }
        } catch (error) {
          /* commons unreadable → skills-only warnings */
        }
        const roster = await loadRoster();
        const nameOf = (email) => {
          const p = roster.find((u) => normEmail(u.email) === email);
          return (p && p.name) || email;
        };
        const emails = [...byRecipient.entries()].map(([to, items]) => ({
          to,
          count: items.length,
          ...buildDeprecationEmail(nameOf(to), items, NOTIFY_BASE_URL)
        }));
        sendJson(res, 200, { ok: true, count: emails.length, emails });
        return true;
      }
      sendJson(res, 404, { ok: false, error: 'rota de notificação desconhecida.' });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/repos') {
      const machine = await authorizeMachine(req);
      if (!machine) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
        return true;
      }
      const mine = await reposForActor(machine.groups || [], normEmail(machine.email || ''));
      sendJson(res, 200, {
        ok: true,
        active: activeRepo(),
        repos: mine.map((r) => ({ name: r.name, titulo: r.titulo, profile: r.profile }))
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/files') {
      const machine = await authorizeMachine(req);
      if (!machine) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
        return true;
      }
      const q = url.searchParams.get('q') || url.searchParams.get('query') || '';
      const limit = Number(url.searchParams.get('limit') || 20);
      const r = await searchCorpusFileAssets(q, machine, { limit, allSkills: true }); // no conversation → search every readable skill too
      if (r.error) {
        sendJson(res, 400, { error: 'bad_request', message: r.error });
        return true;
      }
      // Absolute links: an MCP assistant on another host needs a URL the user can actually open —
      // `webUrl` (SSO, opens in a browser) and `url` (Bearer download) are relative in the corpus.
      const files = r.files.map((f) => ({ ...f, url: pubUrl(f.url), webUrl: pubUrl(f.webUrl) }));
      sendJson(res, 200, { ok: true, query: String(q), found: r.found, showing: files.length, files });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/search') {
      const machine = await authorizeMachine(req);
      if (!machine) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
        return true;
      }
      const r = await searchCorpus(url.searchParams.get('q') || url.searchParams.get('query'), machine, {
        limit: Number(url.searchParams.get('limit') || 20),
        kind: url.searchParams.get('kind') || ''
      });
      if (r.error) {
        sendJson(res, 400, { error: 'bad_request', message: r.error });
        return true;
      }
      sendJson(res, 200, { ok: true, ...r });
      return true;
    }

    if (url.pathname === '/api/v1/ask' && (req.method === 'GET' || req.method === 'POST')) {
      const machine = await authorizeMachine(req);
      if (!machine) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
        return true;
      }
      if (AI_MODE === 'none') {
        sendJson(res, 400, {
          error: 'ai_disabled',
          message:
            'Esta instalação não chama provedores de IA diretamente (AI_MODE=none). Use o Claude/ChatGPT conectado via MCP.'
        });
        return true;
      }
      const body = req.method === 'POST' ? await readJsonBody(req, QUEUE_MAX_BODY) : {};
      const question = String(
        (req.method === 'POST'
          ? (body.question ?? body.q)
          : url.searchParams.get('q') || url.searchParams.get('question')) || ''
      ).trim();
      if (!question) {
        sendJson(res, 400, { error: 'bad_request', message: 'Informe a pergunta em "q" (GET) ou "question" (POST).' });
        return true;
      }
      if (question.length > CHAT_MAX_MESSAGE) {
        sendJson(res, 400, {
          error: 'bad_request',
          message: `Pergunta muito longa (máx. ${CHAT_MAX_MESSAGE} caracteres).`
        });
        return true;
      }
      const skills =
        req.method === 'POST'
          ? Array.isArray(body.skills)
            ? body.skills.map(String)
            : Array.isArray(body.skillIds)
              ? body.skillIds.map(String)
              : []
          : url.searchParams.getAll('skill').length
            ? url.searchParams.getAll('skill')
            : String(url.searchParams.get('skills') || '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
      const wantStream =
        req.method === 'POST'
          ? Boolean(body.stream)
          : ['1', 'true', 'yes'].includes(String(url.searchParams.get('stream') || '').toLowerCase());
      const maxSteps = Math.min(
        Math.max(
          Number(req.method === 'POST' ? body.maxSteps : url.searchParams.get('maxSteps')) || CHAT_TOOL_MAX_STEPS,
          1
        ),
        12
      );
      const aiConfig = await loadUserAiConfig(machine);
      if (!aiConfig || !aiConfig.apiKey) {
        sendJson(res, 400, {
          error: 'ai_not_configured',
          message:
            'Configure um provedor de IA (uma chave de API, ou o Claude Code/Codex local na aba Clientes de IA) para usar /ask.'
        });
        return true;
      }
      const startedAt = Date.now();
      let grounding;
      try {
        grounding = await buildAskGrounding(skills, machine, aiConfig);
      } catch (error) {
        sendJson(res, 500, { error: 'grounding_failed', message: error.message });
        return true;
      }
      const { system, toolset, mode } = grounding;
      if (!wantStream) {
        try {
          const answer = await callAiChatToolLoop([{ role: 'user', content: question }], aiConfig, {
            system,
            tools: toolset.tools,
            execute: toolset.execute,
            maxSteps
          });
          sendJson(res, 200, {
            ok: true,
            answer: String(answer || '').trim(),
            mode,
            repo: activeRepo(),
            model: aiConfig.model || aiConfig.provider,
            sources: [...toolset.reads],
            elapsedMs: Date.now() - startedAt
          });
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `Falha na IA: ${error.message}`, mode, repo: activeRepo() });
        }
        return true;
      }
      // Streaming (SSE): text deltas + tool events, then a final `done` with sources. Mirrors
      // /api/chats/stream (heartbeat + x-accel-buffering so a proxy streams it straight through).
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      });
      const sse = (obj) => {
        try {
          res.write(`data: ${JSON.stringify(obj)}\n\n`);
        } catch {
          /* client gone */
        }
      };
      res.write(': open\n\n');
      sse({ type: 'mode', mode, repo: activeRepo() });
      const heartbeat = setInterval(() => {
        try {
          res.write(': hb\n\n');
        } catch {
          /* ignore */
        }
      }, 15000);
      let full = '';
      try {
        await callAiChatToolLoopStream([{ role: 'user', content: question }], aiConfig, {
          system,
          tools: toolset.tools,
          execute: toolset.execute,
          maxSteps,
          onText: (text) => {
            full += text;
            sse({ type: 'delta', text });
          },
          onEvent: (evt) => {
            if (evt && evt.type === 'tool') sse({ type: 'tool', name: evt.name, input: evt.input });
          }
        });
        sse({
          type: 'done',
          answer: full.trim(),
          sources: [...toolset.reads],
          model: aiConfig.model || aiConfig.provider,
          elapsedMs: Date.now() - startedAt
        });
      } catch (error) {
        sse({ type: 'error', error: `Falha na IA: ${error.message}` });
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/skills') {
      const machine = await authorizeMachine(req);
      if (!machine) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
        return true;
      }
      const canonical = (await loadSkillsFromDisk()).filter((item) => item.status === 'canonico');
      const visible = [];
      for (const item of canonical) {
        if (await canReadSkillActor(item.id, machine)) visible.push(item); // token inherits its user's read scope
      }
      sendJson(res, 200, {
        format: 'okf/0.1',
        generatedAt: new Date().toISOString(),
        count: visible.length,
        skills: visible.map(toOkfSummary)
      });
      return true;
    }

    {
      const qMatch = url.pathname.match(/^\/api\/v1\/skills\/(.+?)\/(query-run|data-inspect)$/);
      if (req.method === 'GET' && qMatch) {
        const machine = await authorizeMachine(req);
        if (!machine) {
          sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
          return true;
        }
        const id = decodeURIComponent(qMatch[1]);
        const op = qMatch[2];
        if (
          !isSafeSkillId(id) ||
          !(await pathExists(join(skillsRoot(), id, 'SKILL.md'))) ||
          !(await canReadSkillActor(id, machine))
        ) {
          sendJson(res, 404, { error: 'skill not found' });
          return true;
        }
        const rel = String(url.searchParams.get('path') || '')
          .replace(/\\/g, '/')
          .replace(/^\/+/, '');
        const working = await loadSkillConsumerContext(id);
        const files = (working.files || []).map((r) => r.replaceAll('\\', '/'));
        if (!rel || rel.includes('..') || !files.includes(rel)) {
          sendJson(res, 404, { error: 'file not found in this skill' });
          return true;
        }
        const draftAbs = join(working.draftDir, rel);
        const abs = (await pathExists(draftAbs)) ? draftAbs : join(working.sourceDir, rel);
        if (op === 'query-run') {
          if (!rel.endsWith('.sql')) {
            sendJson(res, 400, { error: 'path must be a .sql file' });
            return true;
          }
          let sql = '';
          try {
            sql = await readFile(abs, 'utf8');
          } catch (error) {
            sendJson(res, 404, { error: 'file unreadable' });
            return true;
          }
          const ds = await skillQueryDatasets(id, machine);
          if (ds.overLimit) {
            sendJson(res, 400, {
              error: `datasets exceed the execution size limit (${formatBytesServer(ds.totalBytes)})`
            });
            return true;
          }
          const result = await runGovernedQuery(ds.datasets, sql);
          recordSkillEvent('consume', id, 'machine', machine);
          sendJson(res, result.ok ? 200 : 400, {
            skill: id,
            sql: rel,
            ...result,
            datasets: ds.datasets.map((d) => ({ table: d.table, source: d.source, bytes: d.bytes }))
          });
          return true;
        }
        if (!DATASET_EXT_RE.test(rel)) {
          sendJson(res, 400, { error: 'path must be a .csv or .parquet file' });
          return true;
        }
        const result = await inspectDataset({ table: datasetTableName(rel), path: abs });
        sendJson(res, result.ok ? 200 : 400, { skill: id, path: rel, table: datasetTableName(rel), ...result });
        return true;
      }
    }

    {
      // id is captured non-greedily so multi-level ids (<domain>/<slug>) match up to `/context`;
      // the handler validates the id against real skills, so an over-short match just 404s.
      const ctxMatch = url.pathname.match(/^\/api\/v1\/skills\/(.+?)\/context(?:\/(.+))?$/);
      if (req.method === 'GET' && ctxMatch) {
        const machine = await authorizeMachine(req);
        if (!machine) {
          sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
          return true;
        }
        const id = decodeURIComponent(ctxMatch[1]);
        const skill = (await loadSkillsFromDisk()).find((item) => item.id === id && item.status === 'canonico');
        // 404 (not 403) when unreadable too, so a restricted skill's existence never leaks.
        if (!skill || !(await canReadSkillActor(id, machine))) {
          sendJson(res, 404, { error: 'skill not found or not canonical' });
          return true;
        }
        if (!ctxMatch[2]) {
          // Manifest: what context files exist (kind + size + one-line summary), NOT their content.
          const manifest = await skillContextManifest(skill);
          sendJson(res, 200, { skill: id, ...manifest });
          return true;
        }
        // Single file: fetch one context file's full text. It must be one the discovery layer
        // allows (not governance, is text, within size); matching a discovered rel exactly makes
        // path traversal impossible.
        const rel = decodeURIComponent(ctxMatch[2]).replace(/\/+$/, '');
        const { textFiles, skipped } = await discoverSkillContextFiles(skill);
        const entry = textFiles.find((file) => file.rel === rel);
        if (!entry) {
          sendJson(res, 404, { error: 'context file not found or not a readable text file' });
          return true;
        }
        let content = '';
        try {
          content = await readFile(entry.full, 'utf8');
        } catch (error) {
          sendJson(res, 404, { error: 'context file unreadable' });
          return true;
        }
        // Outbound OKF links (within + cross-skill + commons) so a paging caller can walk the
        // graph from here; backlinks come from the manifest, which sees every node's edges.
        const { links, dangling } = extractContextLinks(
          content,
          id,
          entry.rel,
          contextNodePaths(textFiles, skipped),
          await corpusNodeIndex()
        );
        sendJson(res, 200, {
          skill: id,
          path: entry.rel,
          bytes: entry.bytes,
          kind: contextKind(entry.rel),
          content,
          links,
          dangling
        });
        return true;
      }
    }

    {
      const fMatch = url.pathname.match(/^\/api\/v1\/skills\/(.+)\/files\/([^/]+)$/);
      if (req.method === 'GET' && fMatch) {
        const machine = await authorizeMachine(req);
        if (!machine) {
          sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
          return true;
        }
        const asset = await resolveSkillFileAsset(decodeURIComponent(fMatch[1]), decodeURIComponent(fMatch[2]));
        if (!asset) {
          sendJson(res, 400, { error: 'invalid path' });
          return true;
        }
        if (!(await skillExistsById(asset.id))) {
          sendJson(res, 404, { error: 'skill not found' });
          return true;
        }
        if (!(await canReadSkillActor(asset.id, machine))) {
          sendJson(res, 404, { error: 'skill not found' });
          return true;
        }
        if (!(await pathExists(asset.full))) {
          sendJson(res, 404, { error: 'file not found' });
          return true;
        }
        await serveFileBytes(res, asset.full, asset.name, mediaMimeFor(asset.name), false);
        return true;
      }
    }

    {
      const upMatch = url.pathname.match(/^\/api\/v1\/skills\/(.+)\/files$/);
      if (req.method === 'POST' && upMatch) {
        const machine = await authorizeMachine(req);
        if (!machine) {
          sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
          return true;
        }
        const id = decodeURIComponent(upMatch[1]).replace(/\/+$/, '');
        if (!(await skillExistsById(id))) {
          sendJson(res, 404, { error: 'skill not found' });
          return true;
        }
        // A mesma regra da tela (D1): criador ou curador do balde, com a pasta gravável.
        const allowed = await checkPermission(machine, 'curar');
        if (!allowed.ok) {
          sendJson(res, 403, { error: 'forbidden', hint: allowed.reason });
          return true;
        }
        let body;
        try {
          body = await readJsonBody(req, ASSET_MAX_BYTES * 2);
        } catch (error) {
          sendJson(res, 400, {
            error: error.message === 'Payload muito grande.' ? 'file too large' : 'invalid JSON body'
          });
          return true;
        }
        const asset = await resolveSkillFileAsset(id, body && body.name, true);
        if (!asset) {
          sendJson(res, 400, { error: 'invalid name' });
          return true;
        }
        const payload = String((body && body.base64) || '');
        if (!payload) {
          sendJson(res, 400, { error: 'missing base64 content' });
          return true;
        }
        const buf = Buffer.from(payload, 'base64');
        if (!buf.length) {
          sendJson(res, 400, { error: 'empty or invalid base64 content' });
          return true;
        }
        if (buf.length > ASSET_MAX_BYTES) {
          sendJson(res, 400, { error: `file too large (max ${Math.round(ASSET_MAX_BYTES / (1024 * 1024))} MB)` });
          return true;
        }
        await mkdir(asset.dir, { recursive: true });
        await writeFile(asset.full, buf);
        const who = (machine && (machine.name || machine.email)) || 'integração';
        await commitCorpus(`skill(${id}): file-asset ${asset.name} por ${who}`, machine, [id]);
        sendJson(res, 200, { ok: true, name: asset.name, size: buf.length, url: skillFileAssetV1Url(id, asset.name) });
        return true;
      }
    }

    {
      const fMatch = url.pathname.match(/^\/api\/v1\/commons\/(.+)\/files\/([^/]+)$/);
      if (req.method === 'GET' && fMatch) {
        const machine = await authorizeMachine(req);
        if (!machine) {
          sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
          return true;
        }
        const asset = resolveCommonsFileAsset(decodeURIComponent(fMatch[1]), decodeURIComponent(fMatch[2]));
        if (!asset) {
          sendJson(res, 400, { error: 'invalid path' });
          return true;
        }
        if (!(await commonsHasConcept(asset.id))) {
          sendJson(res, 404, { error: 'commons concept not found' });
          return true;
        }
        if (!(await canReadCommonsActor(asset.id, machine))) {
          sendJson(res, 404, { error: 'commons concept not found' });
          return true;
        }
        if (!(await pathExists(asset.full))) {
          sendJson(res, 404, { error: 'file not found' });
          return true;
        }
        await serveFileBytes(res, asset.full, asset.name, mediaMimeFor(asset.name), false);
        return true;
      }
    }

    {
      const upMatch = url.pathname.match(/^\/api\/v1\/commons\/(.+)\/files$/);
      if (req.method === 'POST' && upMatch) {
        const machine = await authorizeMachine(req);
        if (!machine) {
          sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
          return true;
        }
        const id = decodeURIComponent(upMatch[1]).replace(/\/+$/, '');
        if (!(await commonsHasConcept(id))) {
          sendJson(res, 404, { error: 'commons concept not found' });
          return true;
        }
        const allowed = await checkPermission(machine, 'curar');
        if (!allowed.ok) {
          sendJson(res, 403, { error: 'forbidden', hint: allowed.reason });
          return true;
        }
        // Mesma regra da tela: cápsula fechada está congelada.
        if ((await loadCommonsConceptGov(id)).closedAt) {
          sendJson(res, 409, { error: 'capsule closed', hint: 'Reabra a cápsula na Governança para editar.' });
          return true;
        }
        let body;
        try {
          body = await readJsonBody(req, ASSET_MAX_BYTES * 2);
        } catch (error) {
          sendJson(res, 400, {
            error: error.message === 'Payload muito grande.' ? 'file too large' : 'invalid JSON body'
          });
          return true;
        }
        const asset = resolveCommonsFileAsset(id, body && body.name);
        if (!asset) {
          sendJson(res, 400, { error: 'invalid name' });
          return true;
        }
        const payload = String((body && body.base64) || '');
        if (!payload) {
          sendJson(res, 400, { error: 'missing base64 content' });
          return true;
        }
        const buf = Buffer.from(payload, 'base64');
        if (!buf.length) {
          sendJson(res, 400, { error: 'empty or invalid base64 content' });
          return true;
        }
        if (buf.length > ASSET_MAX_BYTES) {
          sendJson(res, 400, { error: `file too large (max ${Math.round(ASSET_MAX_BYTES / (1024 * 1024))} MB)` });
          return true;
        }
        await mkdir(asset.dir, { recursive: true });
        await writeFile(asset.full, buf);
        const who = (machine && (machine.name || machine.email)) || 'integração';
        await commitRepo(commonsRoot(), `commons(${id}): file-asset ${asset.name} por ${who}`, machine, [id]);
        sendJson(res, 200, {
          ok: true,
          name: asset.name,
          size: buf.length,
          url: commonsFileAssetV1Url(id, asset.name)
        });
        return true;
      }
    }

    {
      const cMatch = url.pathname.match(/^\/api\/v1\/commons(?:\/(.+))?$/);
      if (req.method === 'GET' && cMatch) {
        const machine = await authorizeMachine(req);
        if (!machine) {
          sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
          return true;
        }
        if (!cMatch[1]) {
          // Filtered per token owner: restricted capsules only appear for listed readers.
          const list = await commonsListForActor(machine);
          sendJson(res, 200, {
            commons: (list.concepts || []).map((c) => ({
              path: c.path,
              summary: c.summary,
              referencedBy: c.referencedBy,
              media: c.media,
              serie: (c.governance && c.governance.serie) || '',
              periodo: (c.governance && c.governance.periodo) || ''
            }))
          });
          return true;
        }
        const id = decodeURIComponent(cMatch[1]).replace(/\/+$/, '');
        if (!(await commonsHasConcept(id))) {
          sendJson(res, 404, { error: 'commons concept not found' });
          return true;
        }
        // 404 (not 403) when unreadable too, so a restricted capsule's existence never leaks.
        if (!(await canReadCommonsActor(id, machine))) {
          sendJson(res, 404, { error: 'commons concept not found' });
          return true;
        }
        const content = await readCommonsConceptForContext(id); // aviso de depreciação já vem PREPENDADO quando aplicável
        const raw = await readFile(commonsConceptContextPath(id), 'utf8');
        const { links, dangling } = extractContextLinks(raw, 'commons', id, new Set(), await corpusNodeIndex());
        // Governança resumida para consumidores máquina: fechada/depreciada são sinais de uso.
        const gvV1 = conceptGovernanceFrom(await loadCommonsConceptGov(id), {
          cadence: (await loadCommonsDefaults()).cadence,
          deprecationCfg: (await loadScoringConfig()).deprecation
        });
        const cMedia = await conceptMediaEntries(join(commonsRoot(), id), id);
        // Absolute links so an MCP assistant can offer a real download: `webUrl` (SSO, browser) + `url` (Bearer).
        cMedia.files = (cMedia.files || []).map((f) => ({
          ...f,
          url: pubUrl(f.url),
          webUrl: pubUrl(commonsFileAssetWebUrl(id, f.name, activeRepo()))
        }));
        sendJson(res, 200, {
          path: id,
          content,
          links,
          dangling,
          media: cMedia,
          governance: {
            status: gvV1.status,
            closed: gvV1.closed,
            deprecated: gvV1.deprecated,
            deprecation: gvV1.deprecation
          }
        });
        return true;
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/capsule/compile') {
      const machine = await authorizeMachine(req);
      if (!machine) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
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
      sendJson(res, 200, await compileCapsule(manifest, machine));
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/capsule/spec') {
      const machine = await authorizeMachine(req);
      if (!machine) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
        return true;
      }
      try {
        const spec = await readFile(join(docsRoot, 'capsula-spec.md'), 'utf8');
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' });
        res.end(spec);
      } catch (error) {
        sendJson(res, 404, { error: 'spec not found' });
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/capsule/categories') {
      const machine = await authorizeMachine(req);
      if (!machine) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
        return true;
      }
      const categories = (await loadCapsuleCategories()).map(({ key, label, hint }) => ({ key, label, hint }));
      sendJson(res, 200, { ok: true, categories, default: CAPSULE_CATEGORY_DEFAULT });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/capsule/submit') {
      const machine = await authorizeMachine(req);
      if (!machine) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
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
      const compiled = await compileCapsule(manifest, machine);
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
      const anchor = compiled.summary && compiled.summary.anchorId;
      if (anchor && !(await canReadSkillActor(anchor, machine))) {
        sendJson(res, 404, { error: 'skill not found' });
        return true;
      }
      const item = await createCapsuleQueueItem(manifest, compiled, {
        source: 'api',
        submittedBy: { name: machine.name || 'integração', email: machine.email || '' }
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

    if (req.method === 'GET' && url.pathname.startsWith('/api/v1/skills/')) {
      const machine = await authorizeMachine(req);
      if (!machine) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
        return true;
      }
      const id = decodeURIComponent(url.pathname.slice('/api/v1/skills/'.length)).replace(/\/+$/, '');
      const skill = (await loadSkillsFromDisk()).find((item) => item.id === id && item.status === 'canonico');
      // 404 (not 403) when unreadable too, so a restricted skill's existence never leaks.
      if (!skill || !(await canReadSkillActor(id, machine))) {
        sendJson(res, 404, { error: 'skill not found or not canonical' });
        return true;
      }
      const detail = await toOkfDetail(skill);
      detail.eval = await nodeEvalView('skill', id, { transcripts: false }); // Phase 4: the unified eval — vereditos sim, transcripts não (token de máquina tem gate de leitura, não de gestão)
      detail.media = await conceptMediaEntries(join(skillsRoot(), id), id, skillFileAssetV1Url); // img/data descriptions + file-assets (media.files[] w/ v1 download URLs) — parity with /api/v1/commons/{path}
      // Absolute links so an MCP assistant can offer a real download: `webUrl` (SSO, browser) + `url` (Bearer).
      detail.media.files = (detail.media.files || []).map((f) => ({
        ...f,
        url: pubUrl(f.url),
        webUrl: pubUrl(skillFileAssetWebUrl(id, f.name, activeRepo()))
      }));
      // Ontologia do domínio: the reserved <domain>/ontologia capsule always rides along as the
      // domain's basic definitions (canonical vocabulary + synonyms) — same ACL rule as any capsule.
      const ontoV1 = await domainOntologyFor(skill.domain || id.split('/')[0], machine);
      if (ontoV1) {
        let ontoMd = '';
        try {
          ontoMd = await readCommonsConceptForContext(ontoV1.id);
        } catch (error) {
          ontoMd = '';
        }
        if (ontoMd)
          detail.domainOntology = {
            path: `commons/${ontoV1.id}`,
            markdown: ontoMd,
            hint: 'Vocabulário canônico do domínio — use estes termos e definições ao responder sobre esta skill.'
          };
      }
      // Phase D: size-aware detail. Small skills inline every text context file (the one-GET
      // convenience); big skills return a manifest (path/kind/size/summary/links) + a paging hint
      // instead of a huge context[] — the caller pages via /context/{path} or the paging tools.
      const { mode } = await resolveChatContextMode([skill]);
      detail.contextMode = mode;
      if (mode === 'paged') {
        const manifest = await skillContextManifest(skill);
        detail.context = [];
        detail.contextManifest = manifest.files.map((file) => ({
          path: file.path,
          bytes: file.bytes,
          kind: file.kind,
          summary: file.summary,
          links: file.links
        }));
        detail.contextSkipped = (manifest.skipped || []).map((item) => ({
          path: item.path,
          bytes: item.bytes,
          reason: item.reason
        }));
        detail.contextHint = `Skill grande (modo paginado): context[] omitido. Leia cada arquivo em GET /api/v1/skills/${encodeURIComponent(id)}/context/{path} (ou use as ferramentas balde_list_skill_context / balde_read_skill_context).`;
      } else {
        // Bundle the WHOLE skill: SKILL.md (markdown) + every text context file inline, so a
        // caller gets the complete skill in one GET (binaries are listed in contextSkipped).
        const { textFiles, skipped } = await readSkillTextContext(skill);
        detail.context = textFiles.map((file) => ({ path: file.rel, bytes: file.bytes, content: file.content }));
        detail.contextSkipped = skipped.map((item) => ({ path: item.rel, bytes: item.bytes, reason: item.reason }));
      }
      recordSkillEvent('consume', id, 'machine', machine); // external agent read the skill via /api/v1
      sendJson(res, 200, detail);
      return true;
    }
    return false;
  };
}
