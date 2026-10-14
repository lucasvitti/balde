import { RUN_QUERY_NOTE, CHAT_TOOL_MAX_STEPS } from '../policy/chat-policy.mjs';
import { normalizeVerdict as normVerdict, gradeCriterionResults } from '../policy/evaluation-result.mjs';
import { DEFAULT_CADENCE, CADENCE_DAYS, CAPSULE_CATEGORY_DEFAULT } from '../policy/governance-policy.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontmatter } from '../skill-format.mjs';
import { skillsRoot, commonsRoot, BUDDY_POSES } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { gitHistoryForPath } from '../git-corpus.mjs';
import { callAiWithSystemPrompt, callAiChat, callAiChatToolLoop } from '../ai-provider.mjs';

export function createEvaluationsFeature({
  commitCorpus,
  loadSkillWorkingContext,
  loadCommonsConceptGov,
  commitRepo,
  commonsConceptContextPath,
  readPrompt,
  mandatoryFor,
  loadEvalChecklist,
  commonsConceptGovPath,
  loadSkillsFromDisk,
  resolveChatContextMode,
  chatSystemPromptPaged,
  makeChatContextTools,
  chatSystemPrompt,
  withRunQueryTool,
  readCommonsConceptForContext
}) {
  function governanceIndexPath(skillId) {
    return join(skillsRoot(), skillId, 'governance.json');
  }

  async function loadGovernanceIndex(skillId) {
    try {
      const parsed = JSON.parse(await readFile(governanceIndexPath(skillId), 'utf8'));
      if (parsed && typeof parsed === 'object') {
        return {
          version: 1,
          skill: parsed.skill && typeof parsed.skill === 'object' ? parsed.skill : {},
          concepts: parsed.concepts && typeof parsed.concepts === 'object' ? parsed.concepts : {}
        };
      }
    } catch (error) {
      /* absent → defaults */
    }
    return { version: 1, skill: {}, concepts: {} };
  }

  async function saveGovernanceIndex(skillId, index, actor) {
    const out = { version: 1, skill: index.skill || {}, concepts: index.concepts || {} };
    await writeFile(governanceIndexPath(skillId), JSON.stringify(out, null, 2), 'utf8');
    await commitCorpus(
      `skill(${skillId}): governança por ${(actor && (actor.name || actor.email)) || 'curador'}`,
      actor,
      [skillId]
    );
  }

  // Cadence status from lastReviewedAt + cadence: 'never' (no review yet), 'green' (fresh),
  // 'due-soon' (within the last 15% of the window), 'overdue' (past due → audit gate).
  // An EXPLICIT stored expiry (governance.json `expiresAt`) wins over the computed one, so the
  // date the curator sees is a first-class artifact field, not a runtime derivation.
  function cadenceStatus(lastReviewedAt, cadence, explicitExpiresAt) {
    const cad = CADENCE_DAYS[cadence] ? cadence : DEFAULT_CADENCE;
    const days = CADENCE_DAYS[cad];
    const reviewed = lastReviewedAt ? new Date(lastReviewedAt).getTime() : NaN;
    const explicit = explicitExpiresAt ? new Date(explicitExpiresAt).getTime() : NaN;
    if (!Number.isFinite(reviewed) && !Number.isFinite(explicit)) return { status: 'never', dueAt: null, cadence: cad };
    const dueMs = Number.isFinite(explicit) ? explicit : reviewed + days * 86400000;
    const now = Date.now();
    const status = now >= dueMs ? 'overdue' : now >= dueMs - days * 0.15 * 86400000 ? 'due-soon' : 'green';
    return { status, dueAt: new Date(dueMs).toISOString(), cadence: cad };
  }
  // The explicit expiry an entry SHOULD carry: last review + its cadence window (null before any review).
  function computeConceptExpiresAt(entry, defaults) {
    const cadence =
      entry && CADENCE_DAYS[entry.cadence]
        ? entry.cadence
        : defaults && CADENCE_DAYS[defaults.cadence]
          ? defaults.cadence
          : DEFAULT_CADENCE;
    const reviewed = entry && entry.lastReviewedAt ? new Date(entry.lastReviewedAt).getTime() : NaN;
    return Number.isFinite(reviewed) ? new Date(reviewed + CADENCE_DAYS[cadence] * 86400000).toISOString() : null;
  }

  // Effective governance for one concept, inheriting the skill's defaults where unset.
  // Effective governance from a standalone entry object + defaults. Used by both the central
  // per-skill index (conceptGovernance) and the commons per-concept governance.json.
  function conceptGovernanceFrom(entry, defaults) {
    entry = entry || {};
    defaults = defaults || {};
    const cadence = entry.cadence || defaults.cadence || DEFAULT_CADENCE;
    // FECHADA: a validated capsule frozen as a past fact (episódio, transcrição, ponto factual).
    // Closed capsules leave the review cycle entirely — no due date, no overdue, no deprecation.
    const closed = !!entry.closedAt;
    const cs = closed
      ? { status: 'closed', dueAt: null, cadence }
      : cadenceStatus(entry.lastReviewedAt || null, cadence, entry.expiresAt || null);
    const es = entry.evalStatus || null;
    // DEPRECIAÇÃO derivada (critérios admin em Config › Pontuação — defaults.deprecationCfg):
    // cápsula ABERTA vencida há muito tempo, sem revisão há muito tempo, ou com eval reprovada.
    const dep = defaults.deprecationCfg || null;
    const depReasons = [];
    if (dep && !closed) {
      const now = Date.now();
      if (dep.capVencidaDias > 0 && cs.status === 'overdue' && cs.dueAt) {
        const dias = Math.floor((now - Date.parse(cs.dueAt)) / 86400000);
        if (dias >= dep.capVencidaDias) depReasons.push(`vencida há ${dias} dia(s)`);
      }
      if (dep.capSemRevisaoDias > 0 && entry.lastReviewedAt) {
        const idade = Math.floor((now - Date.parse(entry.lastReviewedAt)) / 86400000);
        if (idade >= dep.capSemRevisaoDias) depReasons.push(`última revisão há ${idade} dia(s)`);
      }
      if (dep.capEvalReprovada && es && es.overall === 'fail') depReasons.push('avaliação reprovada');
    }
    return {
      closed,
      closedAt: entry.closedAt || null,
      closedBy: entry.closedBy || null,
      deprecated: depReasons.length > 0,
      deprecation: depReasons.length ? { reasons: depReasons } : null,
      owner: entry.owner || defaults.owner || null,
      ownerInherited: !entry.owner,
      creator: entry.creator || null, // stamped on first touch (see stampCreator)
      categoria: entry.categoria || CAPSULE_CATEGORY_DEFAULT, // sem categoria gravada lê-se como 'dado'
      // Nome de exibição ("nome bonito"): PURAMENTE cosmético — rótulo no Mapa e no explorador.
      // A identidade continua sendo o path/slug; vazio = a UI cai no slug, como sempre foi.
      titulo: entry.titulo || '',
      curators: Array.isArray(entry.curators) && entry.curators.length ? entry.curators : defaults.curators || [],
      cadence,
      cadenceInherited: !entry.cadence,
      cadenceLocked: !!entry.cadenceLockedAt, // #4: once the creator sets it, only admins change it
      cadenceLockedBy: entry.cadenceLockedBy || null,
      lastReviewedAt: entry.lastReviewedAt || null,
      status: cs.status,
      dueAt: cs.dueAt,
      expiresAt: cs.dueAt, // explicit artifact-level expiry (mirrors governance.json `expiresAt`)
      evalCriteria: Array.isArray(entry.evalCriteria) ? entry.evalCriteria.length : 0,
      eval: es
        ? { overall: es.overall || 'pending', evaluatedAt: es.evaluatedAt || null, results: (es.results || []).length }
        : null,
      approvals: Array.isArray(entry.approvals) ? entry.approvals.slice(-30) : [], // #5: audit trail (recent)
      // Linha do tempo: capsules can be EPISODES of a temporal series. serie groups episodes
      // (scoped by domain); periodo is an ISO-8601 prefix whose FORMAT is the granularity
      // (2026 · 2026-07 · 2026-W31 · 2026-07-15) — ISO prefixes sort chronologically as strings.
      serie: typeof entry.serie === 'string' ? entry.serie : '',
      periodo: typeof entry.periodo === 'string' ? entry.periodo : ''
    };
  }

  // Série/período validation (Linha do tempo). periodo: '' = clear, null = invalid input.
  // The série slug is ALWAYS stored with the "serie-" prefix (auto-added when missing), so
  // series are self-identifying wherever the raw slug shows up (governance.json, timeline
  // headings, API listings, chat manifests). Typing "fechamento" and "serie-fechamento"
  // both store — and group as — "serie-fechamento".
  function normSerieField(v) {
    let s = String(v || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!s) return '';
    if (!s.startsWith('serie-')) s = `serie-${s}`;
    return s.slice(0, 60).replace(/-+$/, '');
  }
  function normPeriodoField(v) {
    const p = String(v || '').trim();
    if (!p) return '';
    return /^\d{4}(-W\d{2}|-\d{2}(-\d{2})?)?$/.test(p) ? p : null;
  }
  function conceptGovernance(rel, index, skillDefaults) {
    return conceptGovernanceFrom((index.concepts && index.concepts[rel]) || {}, skillDefaults);
  }

  // #4/#5 governance-node helpers (shared by commons + skills). A governed node's "approvals"
  // ledger lives in its governance.json entry (git-versioned = "on the artifact git structure").
  // stampCreator records who first touched a node (creator-on-touch, Vitti's choice).
  function stampCreator(entry, actor) {
    if (!entry.creator) {
      entry.creator = (actor && (actor.name || actor.email)) || 'desconhecido';
      entry.createdAt = new Date().toISOString();
    }
    return entry;
  }
  function pushApproval(entry, action, detail, actor) {
    const list = Array.isArray(entry.approvals) ? entry.approvals : [];
    list.push({
      at: new Date().toISOString(),
      by: (actor && (actor.name || actor.email)) || 'desconhecido',
      action,
      detail: detail || ''
    });
    entry.approvals = list.slice(-100); // cap the ledger so governance.json stays bounded
    return entry;
  }
  // Oldest git author for a path = its creator, used as a display fallback for nodes migrated
  // before creator-stamping existed (they get permanently stamped on their next touch).
  async function creatorFromGit(root, rel) {
    try {
      const history = await gitHistoryForPath(root, rel);
      if (Array.isArray(history) && history.length) {
        const oldest = history[history.length - 1];
        return oldest.author || oldest.name || null;
      }
    } catch (error) {
      /* no history */
    }
    return null;
  }

  // Minimal skill shape for skillContextManifest from disk (id + sourceText + artifactFacts).
  // Used by governance/context routes that don't already hold a full loaded skill object.
  async function govSkillShape(skillId) {
    const working = await loadSkillWorkingContext(skillId);
    return {
      id: skillId,
      sourceText: working.markdown,
      artifactFacts: {
        sourceFolder: working.sourceDir,
        draftFolder: working.hasDraft ? working.draftDir : null,
        files: working.files
      }
    };
  }
  const CONCEPT_EVAL_DRAFT_SYSTEM =
    'Você propõe critérios de CORREÇÃO para verificar se um documento de conhecimento (um conceito de uma skill de IA) está correto, consistente e completo. Proponha de 2 a 4 critérios objetivos e verificáveis. Responda somente JSON: {"criteria":[{"id":"c1","text":"..."}]}.';
  const CONCEPT_EVAL_GRADE_SYSTEM =
    'Você avalia um documento de conhecimento contra critérios de correção. Para CADA critério responda pass ou fail com uma nota de uma linha (pt-BR). Responda somente JSON: {"results":[{"id":"c1","verdict":"pass","note":"..."}],"overall":"pass"}. overall = pass somente se todos passarem.';

  async function draftConceptEvalCriteria(content, rel, aiConfig) {
    const r = await callAiWithSystemPrompt(
      CONCEPT_EVAL_DRAFT_SYSTEM,
      { path: rel, content: String(content).slice(0, 6000) },
      aiConfig,
      true
    );
    const list = Array.isArray(r && r.criteria) ? r.criteria : [];
    return list
      .map((c, i) => ({ id: String(c.id || `c${i + 1}`), text: String(c.text || '').trim() }))
      .filter((c) => c.text)
      .slice(0, 6);
  }

  async function gradeConceptEval(content, rel, criteria, aiConfig) {
    const r = await callAiWithSystemPrompt(
      CONCEPT_EVAL_GRADE_SYSTEM,
      { path: rel, criteria, content: String(content).slice(0, 8000) },
      aiConfig,
      true
    );
    const { overall, results } = gradeCriterionResults(criteria, r);
    return { overall, results, evaluatedAt: new Date().toISOString(), model: aiConfig.model || aiConfig.provider };
  }
  // eval/cases.json = user QUALITY criteria + test CASES + last verdicts, for skills AND commons.
  // The MANDATORY checklist is merged from the admin config at read/run time (not stored per node).
  // Reads lazily migrate a v1 eval/cases.json + fold legacy governance evalCriteria; persistence
  // happens on save/run (idempotent). Two stores kept (cases file + governance audit), one eval.
  function nodeEvalDir(nodeType, id) {
    return join(nodeType === 'commons' ? commonsRoot() : skillsRoot(), id);
  }
  function nodeEvalFilePath(nodeType, id) {
    return join(nodeEvalDir(nodeType, id), 'eval', 'cases.json');
  }

  async function loadNodeEvalStored(nodeType, id) {
    let raw = null;
    try {
      raw = JSON.parse(await readFile(nodeEvalFilePath(nodeType, id), 'utf8'));
    } catch (error) {
      /* absent */
    }
    // v3: the unified shape.
    if (raw && raw.version === 3 && Array.isArray(raw.items)) return normStoredEval(raw);
    // v2 → v3: fold quality[] + cases[] into one items[]; carry mandatory results (verdict → aiVerdict).
    if (raw && raw.version === 2) {
      const items = [
        ...(Array.isArray(raw.quality) ? raw.quality : []).map((q) => ({
          id: q && q.id,
          title: String((q && (q.title || q.text)) || '').trim(),
          prompt: String((q && q.prompt) || '').trim(),
          question: '',
          expected: '',
          mustRefuse: !!(q && q.mustRefuse),
          aiVerdict: q && q.lastVerdict,
          note: (q && q.note) || '',
          accepted: 'pending'
        })),
        ...(Array.isArray(raw.cases) ? raw.cases : []).map((c) => ({
          id: c && c.id,
          title: String((c && (c.title || c.question)) || '').trim(),
          prompt: String((c && c.prompt) || '').trim(),
          question: String((c && c.question) || ''),
          expected: String((c && c.expected) || ''),
          mustRefuse: !!(c && c.mustRefuse),
          aiVerdict: c && c.lastVerdict,
          note: (c && c.note) || '',
          accepted: 'pending'
        }))
      ];
      const mandatory = {};
      for (const [k, v] of Object.entries(raw.mandatory || {}))
        mandatory[String(k)] = { aiVerdict: v && v.verdict, note: (v && v.note) || '', accepted: 'pending' };
      return normStoredEval({ items, mandatory, lastRunAt: raw.lastRunAt, model: raw.model });
    }
    // v1 (bare array or {cases}) + fold legacy governance evalCriteria as quality-style items.
    const v1cases = Array.isArray(raw) ? raw : raw && Array.isArray(raw.cases) ? raw.cases : [];
    const items = v1cases.map((c) => ({
      id: c && c.id,
      title: String((c && (c.title || c.question)) || '').trim(),
      prompt: '',
      question: String((c && c.question) || ''),
      expected: String((c && c.expected) || ''),
      mustRefuse: !!(c && (c.must_refuse || c.mustRefuse)),
      aiVerdict: 'pending',
      note: String((c && (c.description || c.descricao || c.name)) || ''),
      accepted: 'pending'
    }));
    let legacy = [];
    try {
      legacy =
        nodeType === 'commons'
          ? (await loadCommonsConceptGov(id)).evalCriteria || []
          : ((await loadGovernanceIndex(id)).skill || {}).evalCriteria || [];
    } catch (error) {
      /* none */
    }
    for (const t of Array.isArray(legacy) ? legacy : []) {
      const title = String(t || '').trim();
      if (title)
        items.push({
          id: '',
          title,
          prompt: '',
          question: '',
          expected: '',
          mustRefuse: false,
          aiVerdict: 'pending',
          note: '',
          accepted: 'pending'
        });
    }
    return normStoredEval({ items, mandatory: {}, lastRunAt: null, model: null });
  }

  // Unified eval primitive (v3): ONE item shape for both quality and use-cases. `aiVerdict` = the AI
  // step, `accepted` = the human step. No `kind`/`check` — "quality" simply = the admin-mandatory
  // items (stored per-node as results keyed by id); everything in items[] is node-local.
  function normAccepted(a) {
    return a === 'accepted' ? 'accepted' : a === 'rejected' ? 'rejected' : 'pending';
  }
  // are required (`exigir`, satisfied by `modo` all/any) and which are forbidden (`proibir`). The AI
  // only CLASSIFIES (returns the applicable options + evidence); the SERVER grades deterministically.
  // `opcoes` empty → the item stays a plain pass/fail verdict item (unchanged).
  function normStrList(v, max = 24) {
    return [...new Set((Array.isArray(v) ? v : []).map((x) => String(x || '').trim()).filter(Boolean))].slice(0, max);
  }
  function normRubric(c) {
    const opcoes = normStrList(c && c.opcoes);
    const inEnum = new Set(opcoes);
    return {
      opcoes,
      modo: (c && c.modo) === 'qualquer' ? 'qualquer' : 'todas',
      exigir: normStrList(c && c.exigir).filter((x) => inEnum.has(x)),
      proibir: normStrList(c && c.proibir).filter((x) => inEnum.has(x))
    };
  }
  function isRubric(item) {
    return Array.isArray(item && item.opcoes) && item.opcoes.length > 0;
  }
  // Deterministic pass/fail from the AI's selected options + the curator's rule.
  function gradeRubric(selecionadas, rubric) {
    const picked = new Set((Array.isArray(selecionadas) ? selecionadas : []).filter((x) => rubric.opcoes.includes(x)));
    const requireOk =
      rubric.modo === 'qualquer'
        ? rubric.exigir.length === 0 || rubric.exigir.some((x) => picked.has(x))
        : rubric.exigir.every((x) => picked.has(x));
    const forbidOk = !rubric.proibir.some((x) => picked.has(x));
    return requireOk && forbidOk ? 'pass' : 'fail';
  }
  function normEvalItem(c, i) {
    return {
      id: String((c && c.id) || `i${i + 1}`),
      title: String((c && c.title) || '').trim(),
      prompt: String((c && c.prompt) || '').trim(),
      question: String((c && c.question) || '').trim(),
      expected: String((c && c.expected) || '').trim(),
      mustRefuse: Boolean(c && c.mustRefuse),
      ...normRubric(c),
      aiVerdict: normVerdict(c && c.aiVerdict),
      note: String((c && c.note) || ''),
      selecionadas: normStrList(c && c.selecionadas),
      evidencia: String((c && c.evidencia) || '').slice(0, 400),
      // Transparência: o fragmento exatamente enviado à IA para ESTE item + a resposta bruta por id.
      // Capped hard — eval/cases.json é commitado no git a cada save/run.
      aiPrompt: String((c && c.aiPrompt) || '').slice(0, 2000),
      aiAnswer: String((c && c.aiAnswer) || '').slice(0, 2000),
      // Último teste de caso de uso (resposta aterrada + veredito do juiz) — informativo,
      // nunca alimenta o gate de promoção nem o Selo.
      testAnswer: String((c && c.testAnswer) || '').slice(0, 4000),
      testVerdict: normVerdict(c && c.testVerdict),
      testNote: String((c && c.testNote) || '').slice(0, 200),
      testAt: String((c && c.testAt) || ''),
      accepted: normAccepted(c && c.accepted)
    };
  }
  // The gate: the AI must PASS and a human must ACCEPT every item; any AI-fail or human-reject = fail.
  // The promotion GATE. Only mandatory items in `gate` mode block promotion; `score`-mode items
  // (e.g. the use-case checks) and the author's own cases feed the Selo, not the gate. A gate item is
  // satisfied when the AI passed it OR a curator accepted it (force-accept); a rejection hard-blocks.
  function evalGateSatisfied(x) {
    if (x.accepted === 'rejected') return false;
    if (x.accepted === 'accepted') return true;
    return x.aiVerdict === 'pass';
  }
  function deriveEvalOverall(items) {
    const gate = (items || []).filter((x) => x.mandatory && x.mode === 'gate');
    if (!gate.length) return 'none';
    if (gate.every(evalGateSatisfied)) return 'pass';
    if (gate.some((x) => x.accepted === 'rejected' || (x.aiVerdict === 'fail' && x.accepted !== 'accepted')))
      return 'fail';
    return 'pending';
  }
  function normStoredEval(evalObj) {
    const items = (evalObj.items || [])
      .map(normEvalItem)
      .filter((c) => c.title || c.question || c.prompt)
      .slice(0, 60);
    const mandatory = {};
    for (const [k, v] of Object.entries(evalObj.mandatory || {})) {
      mandatory[String(k)] = {
        aiVerdict: normVerdict(v && v.aiVerdict),
        note: String((v && v.note) || ''),
        selecionadas: normStrList(v && v.selecionadas),
        evidencia: String((v && v.evidencia) || '').slice(0, 400),
        aiPrompt: String((v && v.aiPrompt) || '').slice(0, 2000),
        aiAnswer: String((v && v.aiAnswer) || '').slice(0, 2000),
        accepted: normAccepted(v && v.accepted)
      };
    }
    // Contexto compartilhado da última execução (o grader faz UMA chamada para todos os itens):
    // system prompt + facts; o conteúdo do artefato (slice 8000) NÃO é arquivado — seria duplicação.
    const lrm =
      evalObj.lastRunMeta && typeof evalObj.lastRunMeta === 'object'
        ? {
            at: String(evalObj.lastRunMeta.at || ''),
            model: String(evalObj.lastRunMeta.model || ''),
            system: String(evalObj.lastRunMeta.system || '').slice(0, 4000),
            facts: String(evalObj.lastRunMeta.facts || '').slice(0, 1000),
            contentChars: Number(evalObj.lastRunMeta.contentChars) || 0
          }
        : null;
    return {
      version: 3,
      items,
      mandatory,
      lastRunMeta: lrm,
      lastRunAt: evalObj.lastRunAt || null,
      model: evalObj.model || null
    };
  }
  async function writeNodeEvalFile(nodeType, id, evalObj) {
    const out = normStoredEval(evalObj);
    await mkdir(join(nodeEvalDir(nodeType, id), 'eval'), { recursive: true });
    await writeFile(nodeEvalFilePath(nodeType, id), JSON.stringify(out, null, 2), 'utf8');
    return out;
  }
  // After a merge rewrites the skill's content, its stored verdicts are stale → reset to pending so the
  // gate forces a fresh re-grade + re-accept on the merged content (definitions themselves are kept).
  async function resetNodeEvalVerdicts(nodeType, id) {
    const stored = await loadNodeEvalStored(nodeType, id);
    // O conteúdo mudou: transcripts e resultados de teste referem-se ao conteúdo antigo — limpar junto.
    const items = stored.items.map((c) => ({
      ...c,
      aiVerdict: 'pending',
      accepted: 'pending',
      aiPrompt: '',
      aiAnswer: '',
      testAnswer: '',
      testVerdict: 'pending',
      testNote: '',
      testAt: ''
    }));
    const mandatory = {};
    for (const [k, v] of Object.entries(stored.mandatory || {}))
      mandatory[k] = { aiVerdict: 'pending', note: '', accepted: 'pending' };
    await writeNodeEvalFile(nodeType, id, {
      items,
      mandatory,
      lastRunMeta: null,
      lastRunAt: null,
      model: stored.model
    });
  }
  async function commitNodeEval(nodeType, id, actor, message) {
    if (nodeType === 'commons') await commitRepo(commonsRoot(), message, actor, [id]);
    else await commitCorpus(message, actor, [id]);
  }

  // Content + deterministic facts used by rule-checked mandatory items.
  async function readNodeForEval(nodeType, id) {
    if (nodeType === 'commons') {
      const content = await readFile(commonsConceptContextPath(id), 'utf8').catch(() => '');
      const gov = await loadCommonsConceptGov(id);
      const m = content.match(/^#\s+(.+)$/m);
      return {
        content,
        title: (m && m[1].trim()) || String(id).split('/').pop(),
        facts: { hasOwner: !!gov.owner, hasFrontmatter: !!m }
      };
    }
    const md = await readFile(join(skillsRoot(), id, 'SKILL.md'), 'utf8').catch(() => '');
    const { meta, body } = parseFrontmatter(md);
    const facts = {
      hasOwner: !!meta.owner,
      hasFrontmatter: !!(meta.title || meta.name),
      // Facts for the checklist items folded in from the old hardcoded minimumRequirements:
      hasGovernanceFrontmatter: !!(meta.status && meta.objetivo && meta.escopo),
      hasOwnerVersionReview: !!(
        meta.owner &&
        meta.version &&
        (meta.last_reviewed || meta.data_updated || meta.timestamp)
      ),
      isStructured: meta.output_format === 'structured',
      hasOutputSchema: await pathExists(join(skillsRoot(), id, 'output_schema.json'))
    };
    return { content: body || md, title: meta.title || meta.name || id, facts };
  }

  const EVAL_ITEMS_GRADE_SYSTEM_BASE =
    'Você avalia um artefato de conhecimento (uma skill ou um conceito do commons) contra ITENS DE AVALIAÇÃO. Para CADA item:\n- Se o item traz "opcoes" (lista): CLASSIFIQUE — escolha TODAS as opções aplicáveis (pode ser nenhuma, uma ou várias), usando SOMENTE valores presentes em "opcoes". NÃO decida aprovação/reprovação (isso é feito fora, pela regra do curador). Retorne {"id","selecionadas":[...],"evidencia":"trecho curto do artefato que justifica"}.\n- Senão: siga o "prompt" (use "question"/"expected"/"mustRefuse" quando houver; para itens de metadados, use o objeto "facts"). Retorne {"id","verdict":"pass"|"fail","note":"uma linha","evidencia":"trecho curto"}.\nResponda em pt-BR, SOMENTE JSON: {"results":[...]}.';
  // ONE grader for the whole unified eval. Rubric items (with `opcoes`) return `selecionadas`+`evidencia`
  // (the server grades those deterministically via gradeRubric); plain items return `verdict`+`note`.
  // The editable "eval-resposta-estruturada" prompt (Prompts do sistema) is appended when present.
  async function gradeEvalItems(content, facts, items, aiConfig) {
    const extra = await readPrompt('eval-resposta-estruturada');
    const system =
      extra && extra.body ? `${EVAL_ITEMS_GRADE_SYSTEM_BASE}\n\n${extra.body}` : EVAL_ITEMS_GRADE_SYSTEM_BASE;
    // sent = o fragmento por item EXATAMENTE como vai no payload — alimenta a transparência (aiPrompt).
    const sentList = items.map((c) =>
      isRubric(c)
        ? { id: c.id, title: c.title || '', prompt: c.prompt || '', opcoes: c.opcoes }
        : {
            id: c.id,
            title: c.title || '',
            prompt: c.prompt || '',
            question: c.question || '',
            expected: c.expected || '',
            mustRefuse: !!c.mustRefuse
          }
    );
    const sent = new Map(sentList.map((x) => [String(x.id), x]));
    if (!items.length) return { byId: new Map(), sent, system, error: null };
    let r = null;
    let error = null;
    try {
      r = await callAiWithSystemPrompt(
        system,
        {
          content: String(content).slice(0, 8000),
          facts: facts || {},
          items: sentList
        },
        aiConfig,
        true
      );
      if (r === null) error = 'provedor de IA não configurado';
    } catch (e) {
      r = null;
      error = String((e && e.message) || e);
    }
    return {
      byId: new Map((Array.isArray(r && r.results) ? r.results : []).map((x) => [String(x.id), x])),
      sent,
      system,
      error
    };
  }

  // Unified read model = current config mandatory (with stored verdicts) + user quality + cases.
  // opts.transcripts:false (o embed /api/v1) devolve vereditos mas oculta prompts/respostas/testes —
  // tokens de máquina com gate de LEITURA não ganham os bytes que a web só entrega a quem gerencia.
  async function nodeEvalView(nodeType, id, opts = {}) {
    const withTranscripts = opts.transcripts !== false;
    const stored = await loadNodeEvalStored(nodeType, id);
    // Merge admin-mandatory items (defs from config + per-node results) with the node-local items into
    // ONE list. `mandatory:true` marks the read-only-def ones (edited in admin). No `kind` field.
    const mandatoryItems = mandatoryFor(await loadEvalChecklist(), nodeType).map((m) => {
      const r = stored.mandatory[m.id] || {};
      return {
        id: m.id,
        title: m.title,
        prompt: m.prompt,
        question: '',
        expected: '',
        mustRefuse: false,
        opcoes: m.opcoes || [],
        modo: m.modo || 'todas',
        exigir: m.exigir || [],
        proibir: m.proibir || [],
        aiVerdict: normVerdict(r.aiVerdict),
        note: r.note || '',
        selecionadas: normStrList(r.selecionadas),
        evidencia: String(r.evidencia || ''),
        aiPrompt: String(r.aiPrompt || ''),
        aiAnswer: String(r.aiAnswer || ''),
        accepted: normAccepted(r.accepted),
        mandatory: true,
        mode: m.mode || 'gate'
      };
    });
    const localItems = stored.items.map((c) => ({ ...c, mandatory: false, mode: 'score' }));
    let items = [...mandatoryItems, ...localItems];
    if (!withTranscripts) {
      items = items.map((c) => ({ ...c, aiPrompt: '', aiAnswer: '', testAnswer: '' }));
    }
    return {
      nodeType,
      id,
      items,
      overall: deriveEvalOverall(items),
      lastRunMeta: withTranscripts ? stored.lastRunMeta || null : null,
      lastRunAt: stored.lastRunAt,
      model: stored.model
    };
  }

  // Persist author-defined quality + cases (from the EVAL tab). Verdicts reset to pending (a re-run grades them).
  async function saveNodeEval(nodeType, id, input, actor) {
    const stored = await loadNodeEvalStored(nodeType, id);
    const prevById = new Map(stored.items.map((c) => [String(c.id), c]));
    // A changed DEFINITION invalidates its AI verdict + human acceptance (needs a re-run + re-accept);
    // an unchanged item (e.g. the user just accepted/rejected) keeps its verdict/note.
    const sig = (c) =>
      JSON.stringify([
        String(c.title || '').trim(),
        String(c.prompt || '').trim(),
        String(c.question || '').trim(),
        String(c.expected || '').trim(),
        !!c.mustRefuse,
        normRubric(c)
      ]);
    const items = (Array.isArray(input.items) ? input.items : []).map((c, i) => {
      const norm = normEvalItem(c, i);
      const prev = prevById.get(norm.id);
      const changed = !prev || sig(prev) !== sig(norm);
      // Definição alterada invalida também transcript e teste — evidência de IA sobre a definição antiga.
      return {
        ...norm,
        aiVerdict: changed ? 'pending' : normVerdict(prev.aiVerdict),
        note: changed ? '' : prev.note || '',
        selecionadas: changed ? [] : normStrList(prev.selecionadas),
        evidencia: changed ? '' : String(prev.evidencia || ''),
        aiPrompt: changed ? '' : String(prev.aiPrompt || ''),
        aiAnswer: changed ? '' : String(prev.aiAnswer || ''),
        testAnswer: changed ? '' : String(prev.testAnswer || ''),
        testVerdict: changed ? 'pending' : normVerdict(prev.testVerdict),
        testNote: changed ? '' : String(prev.testNote || ''),
        testAt: changed ? '' : String(prev.testAt || ''),
        accepted: changed ? 'pending' : normAccepted(c && c.accepted !== undefined ? c.accepted : prev.accepted)
      };
    });
    // Mandatory results: only `accepted` is user-editable here (defs live in admin; verdicts come from
    // runs). Carrega selecionadas/evidencia/aiPrompt/aiAnswer — antes um save pós-run os descartava.
    const mandatory = {};
    const inpM = (input && input.mandatory) || {};
    for (const m of mandatoryFor(await loadEvalChecklist(), nodeType)) {
      const prev = stored.mandatory[m.id] || {};
      const inp = inpM[m.id] || {};
      mandatory[m.id] = {
        aiVerdict: normVerdict(prev.aiVerdict),
        note: prev.note || '',
        selecionadas: normStrList(prev.selecionadas),
        evidencia: String(prev.evidencia || ''),
        aiPrompt: String(prev.aiPrompt || ''),
        aiAnswer: String(prev.aiAnswer || ''),
        accepted: normAccepted(inp.accepted !== undefined ? inp.accepted : prev.accepted)
      };
    }
    const out = await writeNodeEvalFile(nodeType, id, {
      items,
      mandatory,
      lastRunMeta: stored.lastRunMeta,
      lastRunAt: stored.lastRunAt,
      model: stored.model
    });
    await commitNodeEval(
      nodeType,
      id,
      actor,
      `eval(${id}): definições atualizadas por ${(actor && (actor.name || actor.email)) || 'curador'}`
    );
    return out;
  }

  // Run the full eval: ALL items (mandatory + local) graded by AI via their prompt (all-AI, no rule
  // fast-path); metadata `facts` are fed so meta-items (owner/frontmatter/refuse) stay answerable.
  // Human `accepted` decisions are PRESERVED across a run. overall = derived (AI-pass AND accepted).
  async function runNodeEval(nodeType, id, aiConfig, actor) {
    const stored = await loadNodeEvalStored(nodeType, id);
    const { content, facts } = await readNodeForEval(nodeType, id);
    facts.hasRefuseCase = stored.items.some((c) => c.mustRefuse); // metadata fact for "tem caso de recusa"
    facts.hasTestCases = stored.items.some((c) => String(c.question || '').trim() || c.mustRefuse); // "tem casos de teste (UAT)"
    const checklist = mandatoryFor(await loadEvalChecklist(), nodeType);
    const toGrade = [
      ...checklist.map((m) => ({
        id: `m:${m.id}`,
        title: m.title,
        prompt: m.prompt,
        question: '',
        expected: '',
        mustRefuse: false,
        opcoes: m.opcoes,
        modo: m.modo,
        exigir: m.exigir,
        proibir: m.proibir
      })),
      ...stored.items.map((c) => ({
        id: `i:${c.id}`,
        title: c.title,
        prompt: c.prompt,
        question: c.question,
        expected: c.expected,
        mustRefuse: c.mustRefuse,
        opcoes: c.opcoes,
        modo: c.modo,
        exigir: c.exigir,
        proibir: c.proibir
      }))
    ];
    const graded = await gradeEvalItems(content, facts, toGrade, aiConfig);
    // Rubric items (opcoes) are graded deterministically from the AI's selected options; plain items
    // take the AI's verdict. Both keep a one-line note + an evidence quote + the raw exchange
    // (aiPrompt = fragmento enviado deste item, aiAnswer = resultado bruto por id) for transparency.
    const gradeOne = (def, key, fallbackNote) => {
      const x = graded.byId.get(key) || {};
      const evidencia = String(x.evidencia || '')
        .replace(/\s+/g, ' ')
        .slice(0, 400);
      const aiPrompt = JSON.stringify(graded.sent.get(key) || null).slice(0, 2000);
      const aiAnswer = Object.keys(x).length ? JSON.stringify(x).slice(0, 2000) : '';
      if (isRubric(def)) {
        const selecionadas = normStrList(x.selecionadas).filter((s) => def.opcoes.includes(s));
        return {
          aiVerdict: Array.isArray(x.selecionadas) ? gradeRubric(selecionadas, def) : 'pending',
          selecionadas,
          evidencia,
          aiPrompt,
          aiAnswer,
          note: selecionadas.length ? `Selecionadas: ${selecionadas.join(', ')}` : 'Nenhuma opção selecionada'
        };
      }
      return {
        aiVerdict: normVerdict(x.verdict),
        selecionadas: [],
        evidencia,
        aiPrompt,
        aiAnswer,
        note: String(x.note || fallbackNote || '')
          .replace(/\s+/g, ' ')
          .slice(0, 200)
      };
    };
    const items = stored.items.map((c) => {
      const g = gradeOne(c, `i:${c.id}`, c.note);
      return {
        ...c,
        aiVerdict: g.aiVerdict,
        note: g.note,
        selecionadas: g.selecionadas,
        evidencia: g.evidencia,
        aiPrompt: g.aiPrompt,
        aiAnswer: g.aiAnswer
      };
    });
    const mandatory = {};
    for (const m of checklist) {
      const g = gradeOne(m, `m:${m.id}`);
      const prev = stored.mandatory[m.id] || {};
      mandatory[m.id] = {
        aiVerdict: g.aiVerdict,
        note: g.note,
        selecionadas: g.selecionadas,
        evidencia: g.evidencia,
        aiPrompt: g.aiPrompt,
        aiAnswer: g.aiAnswer,
        accepted: normAccepted(prev.accepted)
      };
    }
    const lastRunMeta = {
      at: new Date().toISOString(),
      model: (aiConfig && (aiConfig.model || aiConfig.provider)) || '',
      system: String(graded.system || '').slice(0, 4000),
      facts: JSON.stringify(facts || {}).slice(0, 1000),
      contentChars: Math.min(String(content).length, 8000)
    };
    await writeNodeEvalFile(nodeType, id, {
      items,
      mandatory,
      lastRunMeta,
      lastRunAt: new Date().toISOString(),
      model: (aiConfig && (aiConfig.model || aiConfig.provider)) || null
    });
    const view = await nodeEvalView(nodeType, id);
    // Falha de IA deixa de ser silêncio (tudo 'pending' sem explicação) — vira aviso no cliente.
    view.runWarning = graded.error ? `Falha na IA durante a avaliação: ${graded.error}` : null;
    // Mirror the derived overall into governance (audit) — keeps the eval badges across the app in sync.
    const evalStatusMirror = { overall: view.overall, evaluatedAt: new Date().toISOString() };
    try {
      if (nodeType === 'commons') {
        const g = await loadCommonsConceptGov(id);
        g.evalStatus = evalStatusMirror;
        pushApproval(g, 'eval', view.overall, actor);
        await writeFile(commonsConceptGovPath(id), JSON.stringify(g, null, 2), 'utf8');
      } else {
        const gi = await loadGovernanceIndex(id);
        gi.skill = gi.skill || {};
        gi.skill.evalStatus = evalStatusMirror;
        pushApproval(gi.skill, 'eval', view.overall, actor);
        await writeFile(
          governanceIndexPath(id),
          JSON.stringify({ version: 1, skill: gi.skill, concepts: gi.concepts || {} }, null, 2),
          'utf8'
        );
      }
    } catch (error) {
      /* audit best-effort */
    }
    await commitNodeEval(
      nodeType,
      id,
      actor,
      `eval(${id}): ${view.overall} por ${(actor && (actor.name || actor.email)) || 'curador'}`
    );
    return view;
  }

  // (suggestNodeEval removido: a sugestão de casos vive só nos assistentes de criação/edição,
  // via POST /api/wizard/ai com o prompt 'eval-suggest' — a aba Avaliação não sugere mais.)
  // Responde a PERGUNTA do caso aterrada exatamente como o chat faria (mesmos builders, mesmo actor),
  // julga a resposta contra expected/mustRefuse (ou classifica na rubrica do item) e persiste o
  // resultado em campos próprios do item (testAnswer/testVerdict/testNote/testAt) — informativo:
  // nunca toca aiVerdict, o gate de promoção, o espelho de governança ou o Selo.
  const EVAL_CASE_JUDGE_SYSTEM =
    'Você julga se a RESPOSTA de uma IA a um caso de teste de um artefato de conhecimento está correta. Regras: se "mustRefuse" for true, a resposta correta é uma RECUSA educada — entregar o conteúdo pedido é FALHA; caso contrário compare com "expected" quando houver (equivalência de sentido, não literal); sem "expected", julgue se a resposta responde à pergunta com base plausível. Responda em pt-BR, SOMENTE JSON: {"verdict":"pass"|"fail","note":"uma linha"}.';
  const EVAL_CASE_JUDGE_RUBRIC_SYSTEM =
    'Você CLASSIFICA a RESPOSTA de uma IA a um caso de teste usando uma lista fechada de opções. Escolha TODAS as opções aplicáveis à resposta (pode ser nenhuma, uma ou várias), usando SOMENTE valores presentes em "opcoes". NÃO decida aprovação/reprovação (isso é feito fora, pela regra do curador). Responda em pt-BR, SOMENTE JSON: {"selecionadas":["..."],"note":"uma linha"}.';

  async function testEvalCase(nodeType, id, itemId, aiConfig, actor, groundingActor) {
    const stored = await loadNodeEvalStored(nodeType, id);
    const item = stored.items.find((c) => c.id === String(itemId || ''));
    if (!item) {
      const e = new Error('Caso não encontrado.');
      e.statusCode = 400;
      throw e;
    }
    if (!String(item.question || '').trim()) {
      const e = new Error('O caso precisa de uma pergunta para ser testado.');
      e.statusCode = 400;
      throw e;
    }
    // 1) RESPOSTA aterrada — mesma pilha do chat, mesmo actor autorizado pela rota (paridade de ACL);
    //    sem contribute_to_queue (um teste autônomo jamais enfileira contribuições) e sem /api/chats
    //    (nada persiste no perfil, nenhum recordSkillEvent('chat') inflando execuções).
    let answer = '';
    if (nodeType === 'skill') {
      const ctxSkills = (await loadSkillsFromDisk()).filter((s) => s.id === id);
      const { mode } = await resolveChatContextMode(ctxSkills);
      let system;
      let toolset = { tools: [], execute: null, reads: [] };
      if (mode === 'paged') {
        ({ system } = await chatSystemPromptPaged([id], groundingActor));
        toolset = await makeChatContextTools([id], groundingActor);
      } else {
        system = await chatSystemPrompt([id], groundingActor);
      }
      toolset = await withRunQueryTool(toolset, [id], groundingActor);
      // Paridade com o chat: skills com queries governadas recebem o mesmo empurrão de sistema.
      if (toolset && toolset.tools.some((t) => t.name === 'run_query')) system += RUN_QUERY_NOTE;
      answer = await callAiChatToolLoop([{ role: 'user', content: item.question }], aiConfig, {
        system,
        tools: toolset.tools,
        execute: toolset.execute,
        maxSteps: CHAT_TOOL_MAX_STEPS
      });
    } else {
      const content = await readCommonsConceptForContext(id);
      const system = `Você responde perguntas com base EXCLUSIVAMENTE no conteúdo abaixo. Se a resposta não estiver no conteúdo, diga que não está coberto.\n\n---\n${String(content || '').slice(0, 60000)}`;
      answer = await callAiChat([{ role: 'user', content: item.question }], aiConfig, { system });
    }
    const moodRe = new RegExp('^\\s*\\[(' + BUDDY_POSES.join('|') + ')\\]\\s*', 'i');
    answer = String(answer || '').replace(moodRe, '');
    // 2) JUÍZO — transcript = pergunta+expected+resposta APENAS (nunca o slice de conteúdo: escopos de
    //    verdade diferentes). Item com rubrica: a IA só classifica; o servidor decide via gradeRubric.
    let verdict = 'pending';
    let note = '';
    let warning = null;
    try {
      if (isRubric(item)) {
        const j = await callAiWithSystemPrompt(
          EVAL_CASE_JUDGE_RUBRIC_SYSTEM,
          { question: item.question, opcoes: item.opcoes, answer: String(answer).slice(0, 6000) },
          aiConfig,
          true
        );
        const selecionadas = normStrList(j && j.selecionadas).filter((s) => item.opcoes.includes(s));
        verdict = gradeRubric(selecionadas, item);
        note = selecionadas.length ? `Selecionadas: ${selecionadas.join(', ')}` : 'Nenhuma opção selecionada';
      } else {
        const j = await callAiWithSystemPrompt(
          EVAL_CASE_JUDGE_SYSTEM,
          {
            question: item.question,
            expected: item.expected,
            mustRefuse: !!item.mustRefuse,
            answer: String(answer).slice(0, 6000)
          },
          aiConfig,
          true
        );
        verdict = normVerdict(j && j.verdict);
        note = String((j && j.note) || '')
          .replace(/\s+/g, ' ')
          .slice(0, 200);
      }
    } catch (e) {
      warning = `Resposta gerada, mas o juiz falhou: ${String((e && e.message) || e)}`;
    }
    // As duas chamadas de IA acima podem levar dezenas de segundos: RECARREGA o arquivo e grava só os
    // campos de teste DESTE item — nunca o snapshot inteiro (um run/save/aceite concorrente seria
    // silenciosamente revertido pelo estado antigo).
    const fresh = await loadNodeEvalStored(nodeType, id);
    const freshItem = fresh.items.find((c) => c.id === item.id);
    const defSig = (c) =>
      JSON.stringify([c.question, c.expected, !!c.mustRefuse, c.opcoes, c.modo, c.exigir, c.proibir]);
    if (!freshItem || defSig(freshItem) !== defSig(item)) {
      const view = await nodeEvalView(nodeType, id);
      return {
        view,
        warning: 'Resposta gerada, mas o caso foi removido ou editado durante o teste — resultado não gravado.'
      };
    }
    freshItem.testAnswer = String(answer).slice(0, 4000);
    freshItem.testVerdict = verdict;
    freshItem.testNote = note;
    freshItem.testAt = new Date().toISOString();
    await writeNodeEvalFile(nodeType, id, fresh);
    await commitNodeEval(
      nodeType,
      id,
      actor,
      `eval(${id}): caso "${freshItem.title || freshItem.id}" testado por ${(actor && (actor.name || actor.email)) || 'curador'}`
    );
    const view = await nodeEvalView(nodeType, id);
    return { view, warning };
  }

  // Sugestões de casos de uso para a aba Casos de uso: o prompt "eval-suggest" do assistente de criação
  // (editável em Prompts do sistema) sobre o mesmo conteúdo que a avaliação lê. Não grava nada: o curador
  // escolhe o que adicionar. Ficam de fora as perguntas que já são casos deste nó.
  async function suggestEvalCases(nodeType, id, aiConfig) {
    const prompt = await readPrompt('eval-suggest');
    if (!prompt || !prompt.body) {
      const e = new Error('O prompt "eval-suggest" não está em Prompts do sistema.');
      e.statusCode = 400;
      throw e;
    }
    const { content, title } = await readNodeForEval(nodeType, id);
    const r = await callAiWithSystemPrompt(
      prompt.body,
      { type: nodeType, title, content: String(content || '').slice(0, 8000) },
      aiConfig,
      true
    );
    const stored = await loadNodeEvalStored(nodeType, id);
    const known = new Set(
      stored.items
        .map((c) =>
          String(c.question || '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    );
    const cases = [];
    for (const c of Array.isArray(r && r.cases) ? r.cases : []) {
      const question = String((c && c.question) || '')
        .trim()
        .slice(0, 500);
      if (!question || known.has(question.toLowerCase())) continue;
      known.add(question.toLowerCase());
      cases.push({
        title: String((c && c.title) || '')
          .trim()
          .slice(0, 200),
        question,
        expected: String((c && c.expected) || '')
          .trim()
          .slice(0, 1000),
        mustRefuse: Boolean(c && c.mustRefuse)
      });
    }
    return cases.slice(0, 8);
  }

  return {
    governanceIndexPath,
    loadGovernanceIndex,
    saveGovernanceIndex,
    cadenceStatus,
    computeConceptExpiresAt,
    conceptGovernanceFrom,
    normSerieField,
    normPeriodoField,
    conceptGovernance,
    stampCreator,
    pushApproval,
    creatorFromGit,
    govSkillShape,
    draftConceptEvalCriteria,
    gradeConceptEval,
    loadNodeEvalStored,
    normRubric,
    normEvalItem,
    normStoredEval,
    resetNodeEvalVerdicts,
    nodeEvalView,
    saveNodeEval,
    runNodeEval,
    testEvalCase,
    suggestEvalCases
  };
}
