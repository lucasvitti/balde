import { feedbackDecisions, resolveFeedback } from '../governance/feedback-decisions.mjs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { isSafeSkillId, safeSlug, fileStamp, formatFrontmatterValue } from '../skill-format.mjs';
import {
  feedbackRoot,
  governanceOutputRoot,
  queueRoot,
  baldeFeedback,
  feedbackDirOf,
  outboxFeedbackRoot,
  repoSkillsRoot,
  activeRepo,
  runWithRepo,
  DEFAULT_REPO,
  localRepos
} from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { listRepos } from '../repos.mjs';
import { normalizeText } from '../governance.mjs';

export function createProposalsFeature({ stripMarkdown, localUserCurates, baldeWritable }) {
  function extractSection(body, headings) {
    for (const heading of headings) {
      const pattern = new RegExp(`(^|\\n)#{1,3}\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n#{1,3}\\s|$)`, 'i');
      const match = body.match(pattern);
      if (match) {
        return stripMarkdown(match[2]).slice(0, 520);
      }
    }

    return '';
  }

  function inferModelTier(meta) {
    const maxTokens = Number(meta.max_tokens || 2048);
    if (maxTokens <= 2048) {
      return 'economico';
    }
    if (maxTokens <= 4096) {
      return 'intermediario';
    }
    if (maxTokens <= 8192) {
      return 'capaz';
    }
    return 'topo';
  }

  function inferObjective(meta, body, skillId) {
    return (
      meta.objetivo ||
      extractSection(body, ['Objetivo', 'Tarefa', 'Como responder', 'Projeto principal']) ||
      meta.description ||
      `Executar a skill ${skillId} dentro do escopo validado pelo owner.`
    );
  }

  function inferScope(meta, body) {
    return (
      meta.escopo ||
      extractSection(body, [
        'Regras inegociáveis',
        'Regras inegociaveis',
        'Principios de resposta',
        'Princípios de resposta',
        'Como interpretar a entrada'
      ]) ||
      'Responder apenas dentro do objetivo declarado; quando faltar dado, fonte, coluna, período, granularidade ou entrada válida, declarar a limitação e pedir o insumo mínimo.'
    );
  }

  function buildFrontmatterCompletion(context) {
    const { skillId, meta, body } = context;
    const frontmatter = {
      name: meta.name || skillId,
      description: meta.description || stripMarkdown(body).slice(0, 220),
      status: meta.status || 'rascunho',
      objetivo: inferObjective(meta, body, skillId),
      escopo: inferScope(meta, body),
      owner: meta.owner || 'owner-nao-definido@exemplo.com',
      last_reviewed: meta.last_reviewed || meta.data_updated || meta.timestamp || new Date().toISOString().slice(0, 10),
      model_tier: meta.model_tier || inferModelTier(meta),
      version: meta.version || '1.0.0'
    };

    return [
      'Adicionar ou completar o frontmatter com este rascunho para revisão do owner:',
      '',
      '```yaml',
      ...Object.entries(frontmatter).map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`),
      '```'
    ].join('\n');
  }

  function buildRoleCompletion(context) {
    const objective = inferObjective(context.meta, context.body, context.skillId);
    const scope = inferScope(context.meta, context.body);

    return [
      'Adicionar no início do SKILL.md:',
      '',
      `Você é um especialista responsável por ${objective}`,
      `Responda somente dentro deste escopo: ${scope}`,
      'Se o pedido sair do escopo ou faltar insumo mínimo, recuse de forma curta e peça os dados necessários.'
    ].join('\n');
  }

  function buildRefusalCompletion(context) {
    return [
      'Adicionar bloco de segurança analítica:',
      '',
      'Não invente números, colunas, fontes, períodos, clientes, regras de negócio ou granularidades.',
      'Se a informação não estiver no arquivo, no contexto da conversa ou nas referências da skill, declare a limitação e peça o insumo mínimo.',
      `Aplique esta regra especialmente em pedidos fora do objetivo: ${inferObjective(context.meta, context.body, context.skillId)}`
    ].join('\n');
  }

  function buildEvalCompletion(context) {
    const skillSlug = safeSlug(context.skillId);
    const objective = inferObjective(context.meta, context.body, context.skillId);
    const scope = inferScope(context.meta, context.body);
    const cases = {
      cases: [
        {
          id: `${skillSlug}-resposta-valida`,
          description: 'Responde uma solicitação dentro do objetivo sem sair do escopo.',
          input: `Pedido dentro do objetivo: ${objective}`,
          assertions: [{ type: 'not_contains_fabricated_data' }, { type: 'mentions_scope_or_source' }]
        },
        {
          id: `${skillSlug}-recusa-fora-do-escopo`,
          description: 'Recusa solicitação fora do objetivo ou sem insumo mínimo.',
          input: `Pedido fora do escopo ou sem dados suficientes. Escopo esperado: ${scope}`,
          must_refuse: true,
          assertions: [{ type: 'must_refuse' }, { type: 'asks_for_missing_inputs' }]
        }
      ]
    };

    return [
      'Criar `eval/cases.json` com este rascunho inicial:',
      '',
      '```json',
      JSON.stringify(cases, null, 2),
      '```'
    ].join('\n');
  }

  function buildOutputSchemaCompletion(context) {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['resumo', 'evidencias', 'limitacoes'],
      properties: {
        resumo: { type: 'string' },
        evidencias: {
          type: 'array',
          items: { type: 'string' }
        },
        limitacoes: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    };

    return [
      'Criar `output_schema.json` e alinhar o prompt para retornar JSON puro compatível com este contrato inicial:',
      '',
      '```json',
      JSON.stringify(schema, null, 2),
      '```',
      '',
      `Ajustar os campos ao domínio da skill ${context.skillId} antes de validar.`
    ].join('\n');
  }

  function inferAiFillKind(proposal = {}) {
    const allowedKinds = new Set(['frontmatter', 'role_context', 'refusal_rule', 'eval_cases', 'output_schema']);
    if (allowedKinds.has(proposal.aiFillKind)) {
      return proposal.aiFillKind;
    }

    const blockerIds = (proposal.blockers || []).map((item) => item.id);
    const text = normalizeText(
      [
        proposal.titulo,
        proposal.title,
        proposal.category,
        proposal.antes,
        proposal.rationale,
        proposal.depois,
        proposal.proposedChange,
        proposal.evalResultado,
        proposal.acceptanceCase
      ]
        .filter(Boolean)
        .join(' ')
    );

    if (
      blockerIds.includes('frontmatter-governanca') ||
      blockerIds.includes('owner-version-review') ||
      text.includes('frontmatter')
    ) {
      return 'frontmatter';
    }
    if (blockerIds.includes('papel-contexto') || text.includes('papel') || text.includes('contexto')) {
      return 'role_context';
    }
    if (
      blockerIds.includes('nao-invento-numeros') ||
      text.includes('recusa') ||
      text.includes('saudacao') ||
      text.includes('metapergunta') ||
      text.includes('fora do objetivo') ||
      text.includes('fora de escopo') ||
      text.includes('pedido fora')
    ) {
      return 'refusal_rule';
    }
    if (blockerIds.includes('eval-cases') || blockerIds.includes('eval-recusa') || text.includes('eval')) {
      return 'eval_cases';
    }
    if (blockerIds.includes('output-schema') || text.includes('schema')) {
      return 'output_schema';
    }

    return 'generic';
  }

  function buildLocalProposalCompletion(context, proposal = {}) {
    const kind = inferAiFillKind(proposal);
    const builders = {
      frontmatter: buildFrontmatterCompletion,
      role_context: buildRoleCompletion,
      refusal_rule: buildRefusalCompletion,
      eval_cases: buildEvalCompletion,
      output_schema: buildOutputSchemaCompletion
    };
    const proposedChange = builders[kind]
      ? builders[kind](context)
      : 'Completar a lacuna apontada usando o objetivo, escopo, feedbacks Errado e requisitos mínimos da skill.';
    const acceptanceCase =
      kind === 'eval_cases'
        ? 'O arquivo eval/cases.json deve executar pelo menos um caso positivo e um caso must_refuse.'
        : 'O owner deve conseguir revisar a sugestão, aplicar no rascunho e eliminar o requisito mínimo pendente correspondente.';

    return {
      provider: 'local-fallback',
      title: proposal.titulo || 'Completar requisito mínimo da skill',
      rationale:
        proposal.antes ||
        proposal.rationale ||
        'Sugestão gerada para completar requisito mínimo pendente antes da canonização.',
      proposedChange,
      acceptanceCase,
      severity: proposal.severity || 'alta',
      aiFillKind: kind
    };
  }

  function normalizeProposalCompletion(result, fallback) {
    const source = result?.proposal || result || {};

    return {
      provider: source.provider || result?.provider || fallback.provider,
      title: source.title || source.titulo || fallback.title,
      rationale: source.rationale || source.antes || fallback.rationale,
      proposedChange: source.proposedChange || source.proposed_change || source.depois || fallback.proposedChange,
      acceptanceCase:
        source.acceptanceCase || source.acceptance_case || source.evalResultado || fallback.acceptanceCase,
      severity: source.severity || fallback.severity,
      aiFillKind: source.aiFillKind || source.ai_fill_kind || fallback.aiFillKind
    };
  }

  function latestConversationPair(conversation = []) {
    const assistantIndex = conversation.findLastIndex((item) => item.role === 'assistant');
    const answer = assistantIndex >= 0 ? conversation[assistantIndex]?.content || '' : '';
    const prior = assistantIndex >= 0 ? conversation.slice(0, assistantIndex) : conversation;
    const question = [...prior].reverse().find((item) => item.role === 'user')?.content || '';

    return {
      question,
      answer
    };
  }

  function isBusinessContextQuestion(question = '') {
    const normalized = normalizeText(question);
    return (
      /\b(o que e|oque e|qual e|qual o significado|me explique|explique|defina|definicao|significa|conceito|conceitue)\b/.test(
        normalized
      ) || /\badesao zero\b/.test(normalized)
    );
  }

  function extractBusinessContextTerm(question = '') {
    const match = String(question).match(/ades[aã]o zero/i);
    if (match) {
      return 'Adesão Zero';
    }

    return 'o termo perguntado';
  }

  function businessContextFeedbackSuggestion(question = '') {
    const term = extractBusinessContextTerm(question);
    return `Quando a pergunta for sobre "${term}", responder apenas se houver definição, fonte ou regra de negócio aprovada no contexto da skill. Sem essa referência, não explicar por inferência; declarar que a skill não tem contexto aprovado para o termo e pedir a base ou regra de negócio.`;
  }

  function localFeedbackSuggestion(item) {
    const question = normalizeText(item.question);
    const answer = normalizeText(item.answer);
    const looksLikeGreeting = /\b(oi|ola|olá|bom dia|boa tarde|boa noite|fale sobre voce|fale sobre você)\b/.test(
      question
    );
    const answeredAsGenericAssistant =
      answer.includes('sou um assistente') ||
      answer.includes('posso gerar metadados') ||
      answer.includes('estou aqui para ajudar');

    if (looksLikeGreeting && answeredAsGenericAssistant) {
      return 'Quando a pergunta for saudação ou metapergunta fora do objetivo da skill, responder curto, declarar o escopo da skill e pedir uma amostra/entrada válida em vez de se apresentar como assistente genérico.';
    }

    if (isBusinessContextQuestion(item.question)) {
      return businessContextFeedbackSuggestion(item.question);
    }

    if (question.length < 10) {
      return 'Quando a entrada for curta ou ambígua, não tentar executar a skill; pedir o contexto mínimo necessário antes de responder.';
    }

    return 'Submeter a pergunta e a resposta à análise de IA antes de virar mudança para o owner. Se a IA confirmar falta de contexto, pedir referência de negócio; se estiver fora de escopo, escrever a recusa/clarificação diretamente, sem criar UAT automaticamente.';
  }

  function normalizeFeedbackKey(value = '') {
    return normalizeText(value)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function wrongFeedbackKey(item) {
    return [
      item.skillId || '__unknown__',
      normalizeFeedbackKey(item.question),
      normalizeFeedbackKey(item.answer),
      normalizeFeedbackKey(item.suggestion)
    ].join('|');
  }

  function wrongFeedbackOccurrence(item) {
    return {
      id: item.id,
      timestamp: item.timestamp,
      user: item.user,
      machine: item.machine,
      sessionId: item.sessionId,
      sourceFile: item.sourceFile
    };
  }

  function appendWrongFeedback(grouped, skillId, item) {
    const items = grouped.get(skillId) || [];
    const dedupeKey = wrongFeedbackKey(item);
    const existing = items.find((candidate) => candidate.dedupeKey === dedupeKey);

    if (existing) {
      existing.duplicateCount = (existing.duplicateCount || 1) + 1;
      existing.occurrences = [
        ...(existing.occurrences || [wrongFeedbackOccurrence(existing)]),
        wrongFeedbackOccurrence(item)
      ];
      existing.lastTimestamp = item.timestamp || existing.lastTimestamp || existing.timestamp;
      return;
    }

    grouped.set(skillId, [
      ...items,
      {
        ...item,
        dedupeKey,
        duplicateCount: 1,
        occurrences: [wrongFeedbackOccurrence(item)],
        lastTimestamp: item.timestamp
      }
    ]);
  }
  // On the local version a balde's feedback lives in its own folder (<balde>/feedback/), next to its
  // Fila, so its curators see it from any machine (it used to stay in each user's machine-local
  // runtime folder, where no curator could read it). Whoever can write the balde appends to their own
  // monthly file there (one writer per file and machine, so OneDrive never merges two machines'
  // edits); a contributor who cannot leaves one small file per event in their outbox area, which an
  // app with edit rights moves in (importExchangeOnce). Every event carries an eventId, so an event
  // moved twice is read once. The VPS keeps its instance log (feedbackRoot).
  const feedbackWriterSlug = () =>
    `${String(process.env.DEV_FAKE_EMAIL || 'local').split('@')[0]}-${hostname()}`
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-');
  async function appendBaldeFeedback(repo, text) {
    const dir = feedbackDirOf(repo);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${new Date().toISOString().slice(0, 7)}-${feedbackWriterSlug()}.jsonl`),
      text.endsWith('\n') ? text : `${text}\n`,
      { flag: 'a' }
    );
  }
  async function recordFeedback(entry, { eventId } = {}) {
    const repo = activeRepo();
    const id = eventId || `fb-${fileStamp()}-${randomBytes(3).toString('hex')}`;
    const line = `${JSON.stringify({ eventId: id, repo, ...entry })}\n`;
    if (!baldeFeedback) {
      await mkdir(feedbackRoot, { recursive: true });
      await writeFile(join(feedbackRoot, `${entry.source || 'balde-chat'}.jsonl`), line, { flag: 'a' });
      return;
    }
    if (
      !outboxFeedbackRoot ||
      localRepos.has(repo) ||
      ((await localUserCurates(repo)) && (await baldeWritable(repo)))
    ) {
      await appendBaldeFeedback(repo, line);
      return;
    }
    await mkdir(outboxFeedbackRoot, { recursive: true });
    await writeFile(join(outboxFeedbackRoot, `${id}.jsonl`), line, 'utf8');
  }

  // Every feedback log to read for the active balde: the instance log (the VPS's, or this machine's
  // old local log until migrateLocalFeedbackLog moves it) and, on the local version, the balde's folder.
  async function feedbackLogFiles() {
    const out = [];
    const add = async (dir) => {
      let entries = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        return;
      }
      for (const e of entries)
        if (e.isFile() && e.name.endsWith('.jsonl')) out.push({ name: e.name, path: join(dir, e.name) });
    };
    await add(feedbackRoot);
    if (baldeFeedback) await add(feedbackDirOf(activeRepo()));
    return out;
  }
  // One event per eventId (moved twice = read once); a line of another balde in the instance log is
  // not this balde's feedback.
  function feedbackLineVisible(parsed, seen) {
    if (parsed.repo && parsed.repo !== activeRepo()) return false;
    if (!parsed.eventId) return true;
    if (seen.has(parsed.eventId)) return false;
    seen.add(parsed.eventId);
    return true;
  }
  // Before 1.12.20 a user install kept chat feedback in its machine-local runtime folder. Each line now
  // goes to its balde (the one holding its skill, else the default) the same way a new click does,
  // with an eventId derived from the line so a repeated run is read once; the old file is then renamed
  // *.migrated. The VPS keeps its log where it is.
  async function migrateLocalFeedbackLog() {
    if (!baldeFeedback) return;
    let entries = [];
    try {
      entries = await readdir(feedbackRoot, { withFileTypes: true });
    } catch (error) {
      return;
    }
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl'));
    if (!files.length) return;
    const repos = await listRepos().catch(() => []);
    const repoOfSkill = async (skillId) => {
      if (!isSafeSkillId(skillId)) return DEFAULT_REPO;
      for (const r of repos) if (await pathExists(join(repoSkillsRoot(r.name), skillId, 'SKILL.md'))) return r.name;
      return DEFAULT_REPO;
    };
    let moved = 0;
    for (const e of files) {
      const fp = join(feedbackRoot, e.name);
      const lines = (await readFile(fp, 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean);
      for (const ln of lines) {
        let parsed = null;
        try {
          parsed = JSON.parse(ln);
        } catch (error) {
          continue;
        }
        const { eventId, repo, ...entry } = parsed;
        const target = repo || (await repoOfSkill(String(parsed.skillId || '')));
        const id = eventId || `fb-legado-${createHash('sha1').update(ln).digest('hex').slice(0, 16)}`;
        await runWithRepo(target, () => recordFeedback(entry, { eventId: id }));
        moved += 1;
      }
      await rename(fp, `${fp}.migrated`);
    }
    if (moved) console.log(`Feedback: ${moved} registro(s) do log local movido(s) para os baldes.`);
  }

  async function loadWrongFeedbackBySkill() {
    const grouped = new Map();
    const seen = new Set();
    for (const entry of await feedbackLogFiles()) {
      const fullPath = entry.path;
      const lines = (await readFile(fullPath, 'utf8')).split(/\r?\n/).filter(Boolean);
      for (const [lineIndex, line] of lines.entries()) {
        try {
          const parsed = JSON.parse(line);
          if (String(parsed.verdict || '').toLowerCase() !== 'errado') {
            continue;
          }
          if (!feedbackLineVisible(parsed, seen)) continue;

          const { question, answer } = latestConversationPair(parsed.conversation || []);
          const item = {
            id: `${entry.name}:${lineIndex + 1}`,
            timestamp: parsed.timestamp,
            user: parsed.user,
            machine: parsed.machine,
            sessionId: parsed.sessionId,
            skillId: parsed.skillId,
            skillName: parsed.skillName,
            verdict: parsed.verdict,
            question,
            answer,
            suggestion: localFeedbackSuggestion({ question, answer }),
            sourceFile: fullPath
          };

          const key = parsed.skillId || '__unknown__';
          appendWrongFeedback(grouped, key, item);
        } catch {
          continue;
        }
      }
    }

    return grouped;
  }

  // A stable, reproducible id for a feedback entry (the feedback logs are append-only; this lets the
  // unified queue select + resolve an item across reloads): skillId + timestamp + a slice of the question.
  function feedbackEntryId(skillId, timestamp, question) {
    return `fb:${skillId}:${String(timestamp || '')}:${String(question || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60)}`;
  }
  // Curator decisions on chat feedback ("converter em contribuição" / "dispensar"). Persisted in the
  // queue volume; loadSkillsFromDisk filters resolved ids out of every skill's feedback (queue + tab).
  async function loadResolvedFeedback() {
    return new Set((await feedbackDecisions(queueRoot())).keys());
  }
  async function markFeedbackResolved(id, meta) {
    return resolveFeedback(queueRoot(), id, meta);
  }

  // All eval verdicts (bom | fraco | errado) grouped by skill — feeds the curator
  // feedback view (donut counts + list). Separate from loadWrongFeedbackBySkill
  // (errado-only, deduped) which the AI-review path still uses unchanged.
  async function loadFeedbackBySkill() {
    const grouped = new Map();
    const seen = new Set();
    for (const entry of await feedbackLogFiles()) {
      const lines = (await readFile(entry.path, 'utf8')).split(/\r?\n/).filter(Boolean);
      for (const [lineIndex, line] of lines.entries()) {
        try {
          const parsed = JSON.parse(line);
          const verdict = String(parsed.verdict || '').toLowerCase();
          if (!['bom', 'fraco', 'errado'].includes(verdict)) {
            continue;
          }
          if (!feedbackLineVisible(parsed, seen)) continue;
          const { question, answer } = latestConversationPair(parsed.conversation || []);
          const key = parsed.skillId || '__unknown__';
          const items = grouped.get(key) || [];
          items.push({
            id: `${entry.name}:${lineIndex + 1}`,
            timestamp: parsed.timestamp,
            user: parsed.user,
            verdict,
            question,
            answer
          });
          grouped.set(key, items);
        } catch {
          continue;
        }
      }
    }
    return grouped;
  }

  async function loadPersistedSuggestionsBySkill() {
    const grouped = new Map();
    if (!(await pathExists(governanceOutputRoot()))) {
      return grouped;
    }
    // Governance output dirs mirror skill ids: flat `<slug>/` or nested `<domain>/<slug>/`.
    const readOne = async (govDir, id) => {
      const suggestionPath = join(govDir, 'suggestions.json');
      if (!(await pathExists(suggestionPath))) {
        return false;
      }
      try {
        const parsed = JSON.parse(await readFile(suggestionPath, 'utf8'));
        grouped.set(parsed.skillId || id, parsed);
        return true;
      } catch {
        return false;
      }
    };
    let top = [];
    try {
      top = await readdir(governanceOutputRoot(), { withFileTypes: true });
    } catch (error) {
      top = [];
    }
    for (const entry of top) {
      if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) {
        continue;
      }
      if (await readOne(join(governanceOutputRoot(), entry.name), entry.name)) {
        continue; // flat skill govdir
      }
      let sub = [];
      try {
        sub = await readdir(join(governanceOutputRoot(), entry.name), { withFileTypes: true });
      } catch (error) {
        sub = [];
      }
      for (const s of sub) {
        if (!s.isDirectory() || s.name.startsWith('_') || s.name.startsWith('.')) {
          continue;
        }
        await readOne(join(governanceOutputRoot(), entry.name, s.name), `${entry.name}/${s.name}`); // nested <domain>/<slug>
      }
    }
    return grouped;
  }

  return {
    extractSection,
    inferModelTier,
    inferObjective,
    inferScope,
    inferAiFillKind,
    buildLocalProposalCompletion,
    normalizeProposalCompletion,
    recordFeedback,
    migrateLocalFeedbackLog,
    loadWrongFeedbackBySkill,
    feedbackEntryId,
    markFeedbackResolved,
    loadFeedbackBySkill,
    loadPersistedSuggestionsBySkill
  };
}
