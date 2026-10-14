import { DEFAULT_CADENCE } from '../policy/governance-policy.mjs';
import { feedbackDecisions } from '../governance/feedback-decisions.mjs';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontmatter } from '../skill-format.mjs';
import {
  rootDir,
  skillsRoot,
  queueRoot,
  usageRoot,
  docsRoot,
  commonsRoot,
  activeRepo,
  DEFAULT_REPO
} from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { ensureRepo } from '../git-corpus.mjs';
import { callAiWithConfig } from '../ai-provider.mjs';
import { freshnessFromDate, governanceIssues } from '../skill-helpers.mjs';
import { computeSelo } from '../scoring.mjs';

export function createCatalogFeature({
  usageActorLabel,
  loadWrongFeedbackBySkill,
  loadFeedbackBySkill,
  loadPersistedSuggestionsBySkill,
  loadScoringConfig,
  mandatoryFor,
  loadEvalChecklist,
  buildCommonsList,
  loadSkillConsumerContext,
  loadCanonicalState,
  loadDraftEntries,
  extractSection,
  loadGovernanceIndex,
  cadenceStatus,
  loadNodeEvalStored,
  feedbackEntryId,
  stripMarkdown,
  inferModelTier,
  validateDraftWithAI,
  callOpenAiDirect,
  readPrompt
}) {
  async function listSkillIds(dir = skillsRoot(), prefix = '') {
    const out = [];
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      return out;
    }
    if (prefix && entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      out.push(prefix); // this dir IS a skill — do not descend into its sidecars
      return out;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
      out.push(...(await listSkillIds(join(dir, e.name), prefix ? `${prefix}/${e.name}` : e.name)));
    }
    return out;
  }

  // JSONL (the same source of truth the Administração › Uso panel reads). "execuções" = consume + chat
  // events, "usuários" = distinct actors, "aberturas" = view events, "reuso" = % of users who aren't
  // the owner. TOKENS ARE NOT TRACKED in telemetry, so tokens stays 0 (the chart uses aberturas).
  // Usage keys are repo-qualified for non-default repos so skill ids never collide across repos.
  function usageSkillKey(id, repo = activeRepo()) {
    const r = repo || DEFAULT_REPO;
    return r === DEFAULT_REPO ? String(id) : `${r}@${id}`;
  }
  const MONTH_ABBR_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function lastSixMonths(now = new Date()) {
    const out = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      out.push({
        key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
        label: MONTH_ABBR_PT[d.getUTCMonth()]
      });
    }
    return out;
  }
  // Read the last 6 monthly usage files ONCE and bucket skill events per skill per month.
  async function loadUsageMetricsBySkill() {
    const months = lastSixMonths();
    const bySkill = new Map(); // id -> [{ execucoes, aberturas, users:Set }, ...x6]
    for (let mi = 0; mi < months.length; mi++) {
      let text = '';
      try {
        text = await readFile(join(usageRoot, `${months[mi].key}.jsonl`), 'utf8');
      } catch (error) {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch (error) {
          continue;
        }
        if (!ev || ev.kind !== 'skill' || !ev.skill) continue;
        const key = usageSkillKey(ev.skill, ev.repo);
        let arr = bySkill.get(key);
        if (!arr) {
          arr = months.map(() => ({ execucoes: 0, aberturas: 0, users: new Set() }));
          bySkill.set(key, arr);
        }
        const cell = arr[mi];
        if (ev.event === 'consume' || ev.event === 'chat') cell.execucoes += 1;
        else if (ev.event === 'view') cell.aberturas += 1;
        const who = usageActorLabel(ev.actor);
        if (who) cell.users.add(who);
      }
    }
    return { months, bySkill };
  }
  // Shape the 6-month metrics array for one skill from the pre-built index.
  function skillUsageMetrics(um, id, owner) {
    const ownerKey = String(owner || '')
      .trim()
      .toLowerCase();
    const arr = um.bySkill.get(usageSkillKey(id));
    return um.months.map((m, i) => {
      const c = arr ? arr[i] : { execucoes: 0, aberturas: 0, users: new Set() };
      const users = [...c.users];
      const naoAutores = users.filter((u) => String(u).trim().toLowerCase() !== ownerKey).length;
      return {
        periodo: m.label,
        execucoes: c.execucoes,
        usuariosDistintos: users.length,
        aberturas: c.aberturas,
        reusoPorNaoAutores: users.length ? Math.round((100 * naoAutores) / users.length) : 0,
        tokens: 0
      };
    });
  }

  async function loadSkillsFromDisk() {
    const skillIds = await listSkillIds();
    const skills = [];
    const wrongFeedbackBySkill = await loadWrongFeedbackBySkill();
    const chatVerdictBySkill = await loadFeedbackBySkill();
    const resolvedFeedback = await feedbackDecisions(queueRoot());
    const persistedSuggestionsBySkill = await loadPersistedSuggestionsBySkill();
    const usageMetrics = await loadUsageMetricsBySkill(); // real per-skill/per-month usage for the overview charts
    // Selo scoring inputs shared by every skill: the admin weights/bands + the mandatory checklist
    // (whose gate/score modes drive the "validação" dimension). Loaded once per catalog build.
    const scoringCfg = await loadScoringConfig();
    const scoringChecklist = mandatoryFor(await loadEvalChecklist(), 'skill');
    // Derived DEPRECATION inputs: which skills use EXPIRED capsules (capsule review past its
    // explicit expiresAt). Built once per catalog from the commons list's backlinks.
    const expiredCapsulesBySkill = new Map();
    try {
      const commonsList = await buildCommonsList();
      for (const c of commonsList.concepts || []) {
        const gv = c.governance || {};
        if (gv.status !== 'overdue') continue;
        for (const sk of c.referencedBy || []) {
          if (!expiredCapsulesBySkill.has(sk)) expiredCapsulesBySkill.set(sk, []);
          expiredCapsulesBySkill.get(sk).push({ path: c.path, expiresAt: gv.expiresAt || gv.dueAt || null });
        }
      }
    } catch (error) {
      /* commons unreadable → no capsule-driven deprecation this build */
    }

    for (const id of skillIds) {
      const working = await loadSkillConsumerContext(id);
      const skillDir = working.skillDir;
      const skillPath = working.skillPath;
      const markdown = working.markdown;
      const { meta, body } = working;
      const fileStat = working.fileStat;
      const files = working.files;
      const evals = working.evals;
      const canonicalState = await loadCanonicalState(id);
      const draftEntries = await loadDraftEntries(id);
      const status = canonicalState ? 'canonico' : 'rascunho';
      const version = String(canonicalState?.version || meta.version || '0.0.0');
      const lastReviewed = String(
        canonicalState?.approvedAt?.slice(0, 10) ||
          meta.last_reviewed ||
          meta.data_updated ||
          meta.timestamp ||
          fileStat.mtime.toISOString().slice(0, 10)
      );
      const objectiveSection = extractSection(body, ['Objetivo', 'Tarefa', 'Como responder', 'Projeto principal']);
      const scopeSection = extractSection(body, [
        'Regras inegociáveis',
        'Principios de resposta',
        'Princípios de resposta',
        'Como interpretar a entrada'
      ]);
      // Governance issues shown to owners. The old hardcoded 'validação do owner pendente' entry was
      // removed: publishing a draft is a normal owner step, not a standing "issue" — the mandatory
      // eval checklist is the promotion gate.
      const issues = governanceIssues(meta, evals, files);
      // Derived deprecation: the skill's OWN review is past due (governance cadence over the last
      // review/frontmatter date) OR any capsule it links is expired. Distinct from the manual
      // lifecycle status 'depreciado' — this is a freshness verdict, recomputed every load.
      let deprecation = null;
      try {
        const gi = await loadGovernanceIndex(id);
        const giSkill = (gi && gi.skill) || {};
        const reviewedAt = giSkill.lastReviewedAt || meta.last_reviewed || meta.data_updated || meta.timestamp || null;
        const skillCad = cadenceStatus(reviewedAt, giSkill.cadence || DEFAULT_CADENCE);
        const expiredCaps = expiredCapsulesBySkill.get(id) || [];
        const reasons = [];
        if (skillCad.status === 'overdue')
          reasons.push(`revisão da skill vencida${skillCad.dueAt ? ` em ${skillCad.dueAt.slice(0, 10)}` : ''}`);
        for (const cap of expiredCaps)
          reasons.push(
            `cápsula ${cap.path} vencida${cap.expiresAt ? ` em ${String(cap.expiresAt).slice(0, 10)}` : ''}`
          );
        if (reasons.length)
          deprecation = {
            reasons,
            reviewDueAt: skillCad.status === 'overdue' ? skillCad.dueAt : null,
            expiredCapsules: expiredCaps
          };
      } catch (error) {
        /* governance unreadable → not deprecated by this signal */
      }
      // Selo = the configurable weighted score (Config → Pontuação): use-case richness, validation
      // integrity (forced accepts discount), governance frontmatter, clarity/safety, freshness.
      const storedEvalForScore = await loadNodeEvalStored('skill', id);
      const selo = computeSelo(
        {
          meta,
          body,
          files,
          storedEval: storedEvalForScore,
          checklist: scoringChecklist,
          frescor: freshnessFromDate(lastReviewed, status)
        },
        scoringCfg
      );
      const wrongFeedbacks = wrongFeedbackBySkill.get(id) || [];
      const feedback = [
        ...wrongFeedbacks.map((item) => ({
          timestamp: item.timestamp,
          usuario: item.user || 'usuário não identificado',
          skillId: id,
          version,
          veredito: 'errado',
          comentario: item.suggestion,
          question: item.question,
          answer: item.answer,
          duplicateCount: item.duplicateCount || 1,
          occurrences: item.occurrences || [],
          source: 'feedback-log',
          sourceFile: item.sourceFile
        })),
        ...(chatVerdictBySkill.get(id) || [])
          .filter((item) => item.verdict !== 'errado')
          .map((item) => ({
            timestamp: item.timestamp,
            usuario: item.user || 'usuário não identificado',
            skillId: id,
            version,
            veredito: item.verdict,
            comentario: item.verdict === 'fraco' ? 'Marcado como Fraco no chat' : 'Marcado como Bom no chat',
            question: item.question,
            answer: item.answer,
            source: 'chat-verdict'
          })),
        ...issues.slice(0, 3).map((issue, index) => ({
          timestamp: new Date(Date.now() - (index + 1) * 86400000).toISOString(),
          usuario: 'balde@governanca.local',
          skillId: id,
          version,
          veredito: 'fraco',
          comentario: issue,
          source: 'governance-check'
        }))
      ].map((f) => {
        const fid = feedbackEntryId(id, f.timestamp, f.question);
        return { ...f, id: fid, resolution: resolvedFeedback.get(fid) || null };
      });

      const skill = {
        id,
        // Domain = the first path segment for folder-based ids (<domain>/<slug>); legacy flat
        // skills fall back to the frontmatter `domain:` (set at migration) or empty.
        domain: id.includes('/') ? id.split('/')[0] : meta.domain || '',
        nome: meta.title || meta.name || id,
        tipo: meta.type || 'skill',
        resource: meta.resource || null,
        buddyId: meta.buddy_id || null,
        descricao: meta.description || stripMarkdown(body).slice(0, 220),
        sourceText: markdown,
        sourcePath: skillPath,
        sourceKind: working.hasDraft ? 'rascunho-governado' : 'revhub-original',
        owner: {
          nome: meta.owner || 'Owner não definido',
          email: meta.owner || 'owner-nao-definido@exemplo.com'
        },
        status,
        contentState: working.contentState,
        pendingWorkingChanges: working.pendingWorkingChanges,
        version,
        replacedBy: meta.replaced_by || null,
        objetivo: meta.objetivo || objectiveSection || `Inferido da descrição: ${meta.description || id}`,
        escopo: meta.escopo || scopeSection || 'Escopo ainda não declarado no frontmatter de governança.',
        modelTier: meta.model_tier || inferModelTier(meta),
        lastReviewed,
        criadoEm: meta.timestamp || null,
        frescor: freshnessFromDate(lastReviewed, status),
        deprecated: !!deprecation,
        deprecation,
        seloQualidade: selo.total,
        seloGrade: selo.grade,
        seloDetalhe: selo.detalhe,
        metricas: skillUsageMetrics(usageMetrics, id, meta.owner),
        evals,
        evalSummary: {
          total: evals.length,
          falhou: 0
        },
        feedback,
        ledger: canonicalState?.ledger || [],
        relatorio: null,
        governanceIssues: issues,
        canonical: canonicalState
          ? {
              version: canonicalState.version,
              previousVersion: canonicalState.previousVersion,
              approvedAt: canonicalState.approvedAt,
              approvedBy: canonicalState.approvedBy,
              paths: canonicalState.paths,
              entries: canonicalState.entries?.length || 0
            }
          : null,
        draftLedger: draftEntries
          .slice()
          .reverse()
          .map((item) => ({
            id: item.id,
            action: item.action,
            requirementKind: item.requirementKind,
            timestamp: item.approvedAt,
            summary: item.summary,
            approvedBy: item.approvedBy,
            paths: item.paths,
            legacySnapshot: item.legacySnapshot,
            uploadedFiles: item.uploadedFiles || []
          })),
        artifactFacts: {
          root: skillsRoot(),
          folder: skillDir,
          sourceFolder: working.sourceDir,
          draftFolder: working.hasDraft ? working.draftDir : null,
          activeSource: working.hasDraft ? 'rascunho-governado' : 'revhub-original',
          fileCount: files.length,
          hasOutputSchema: files.some((file) => file.endsWith('output_schema.json')),
          hasAnalytics: files.some((file) => file.startsWith('analytics\\') || file.startsWith('analytics/')),
          hasQuery: files.some((file) => file.startsWith('query\\') || file.startsWith('query/')),
          hasReferences: files.some((file) => file.startsWith('references\\') || file.startsWith('references/')),
          analyticsFiles: files.filter((file) => file.startsWith('analytics\\') || file.startsWith('analytics/')),
          queryFiles: files.filter((file) => file.startsWith('query\\') || file.startsWith('query/')),
          files
        }
      };

      skill.wrongFeedbacks = wrongFeedbacks;
      skill.suggestionReview = persistedSuggestionsBySkill.get(id) || null;
      skill.changeSuggestions = (skill.suggestionReview?.suggestions || []).map(
        (suggestion, sourceSuggestionIndex) => ({ ...suggestion, sourceSuggestionIndex })
      );
      skill.aiReview = await validateDraftWithAI(skill, { meta, body, files, evals, wrongFeedbacks });
      // (aiReview.score no longer overrides the Selo — the configurable weighted score is authoritative;
      // the AI review keeps its own score inside the Relatório tab.)
      skills.push(skill);
    }

    return skills.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  async function callDepartmentProxy(payload, type = 'skill_governance_analysis', aiConfig = null) {
    if (!process.env.AI_PROXY_URL) {
      if (aiConfig && aiConfig.apiKey) {
        return callAiWithConfig(payload, type, aiConfig);
      }
      return callOpenAiDirect(payload, type);
    }

    const response = await fetch(process.env.AI_PROXY_URL, {
      method: 'post',
      headers: {
        'content-type': 'application/json',
        ...(process.env.AI_PROXY_TOKEN ? { authorization: `Bearer ${process.env.AI_PROXY_TOKEN}` } : {})
      },
      body: JSON.stringify({
        type,
        payload
      })
    });

    if (!response.ok) {
      throw new Error(`AI proxy returned ${response.status}`);
    }

    return response.json();
  }

  // Documentation corpus: seed the (possibly empty, bind-mounted) docsRoot from the bundled
  // demo-corpus/docs on first boot, then ensure it's a git repo so the view shows history.
  async function ensureDocs() {
    const bundled = join(rootDir, 'demo-corpus', 'docs');
    try {
      await mkdir(docsRoot, { recursive: true });
      const hasDocs = (await readdir(docsRoot)).some((f) => f.endsWith('.md'));
      if (!hasDocs && docsRoot !== bundled && (await pathExists(bundled))) {
        // never the seed's own .git: the corpus ledger is set up by ensureRepo (machine-local on the
        // local version), and a .git copied into a synced folder would be a ledger inside OneDrive
        await cp(bundled, docsRoot, { recursive: true, filter: (src) => !src.split(/[\\/]/).includes('.git') });
      }
    } catch (error) {
      /* ignore */
    }
    await ensureRepo(docsRoot, 'docs');
  }

  // Commons corpus: a git-versioned neighborhood of SHARED concepts any skill can link
  // (cross-skill linking). Starts empty; seed a README on first boot so the area + git exist.
  async function ensureCommons() {
    try {
      await mkdir(commonsRoot(), { recursive: true });
      const hasAny = (await readdir(commonsRoot())).some((f) => f !== '.git');
      if (!hasAny) {
        await writeFile(
          join(commonsRoot(), 'README.md'),
          '# Commons\n\nConceitos compartilhados do corpus. Cada conceito é uma **pasta** (`<domínio>/<conceito>/`) com `context.md` (conteúdo) + `governance.json` (nó governado: criador, cadência, revisão, aprovações) + sidecars (`img/`, `data/`, `legado/`, `logs/`). Qualquer skill referencia um conceito por link markdown `/commons/<domínio>/<conceito>` (resolve para o `context.md`). Um `ACCESS.yml` opcional na pasta torna a cápsula **restrita** (visível só para curadores/leitores listados); sem ele a cápsula é pública para qualquer usuário autenticado.\n',
          'utf8'
        );
      }
    } catch (error) {
      /* ignore */
    }
    await ensureRepo(commonsRoot(), 'commons');
  }

  // Flat+nested list of markdown docs with a display title (first "# heading" or filename).
  async function listDocs(dir = docsRoot, prefix = '') {
    const out = [];
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out.push(...(await listDocs(join(dir, entry.name), rel)));
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      let title = entry.name.replace(/\.md$/, '');
      let size = 0;
      let section = '';
      let sectionOrder = null;
      let order = null;
      let downloadable = false;
      try {
        const raw = await readFile(join(dir, entry.name), 'utf8');
        size = Buffer.byteLength(raw, 'utf8');
        let meta = {};
        let content = raw;
        if (/^---\r?\n/.test(raw)) {
          try {
            const parsed = parseFrontmatter(raw);
            meta = parsed.meta || {};
            content = parsed.body != null ? parsed.body : raw;
          } catch {
            /* not real frontmatter */
          }
        }
        const head = content.split(/\r?\n/).find((l) => /^#\s+/.test(l));
        if (head) title = head.replace(/^#\s+/, '').trim();
        if (meta.title) title = String(meta.title).trim();
        if (meta.section) section = String(meta.section).trim();
        if (meta.section_order != null && meta.section_order !== '') {
          const n = Number(meta.section_order);
          if (Number.isFinite(n)) sectionOrder = n;
        }
        if (meta.order != null && meta.order !== '') {
          const n = Number(meta.order);
          if (Number.isFinite(n)) order = n;
        }
        if (
          meta.downloadable === true ||
          /^(true|sim|yes|1)$/i.test(String(meta.downloadable == null ? '' : meta.downloadable).trim())
        )
          downloadable = true;
      } catch {
        /* ignore */
      }
      out.push({ path: rel, title, size, section, sectionOrder, order, downloadable });
    }
    out.sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));
    return out;
  }

  // Validate a docs-relative path for read/write: forward-slashed, no traversal, must be a
  // `.md` file, must resolve inside docsRoot. Returns the normalized rel, or null if invalid.
  function safeDocRel(input) {
    const rel = String(input || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .trim();
    if (!rel || rel.includes('..') || rel.endsWith('/')) return null;
    if (!/\.md$/i.test(rel)) return null;
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(rel)) return null;
    const target = join(docsRoot, rel);
    if (target !== docsRoot && !target.startsWith(docsRoot + '/') && !target.startsWith(docsRoot + '\\')) return null;
    return rel;
  }

  // The machine API speaks OKF: title/type/tags/timestamp/resource, plus the
  // governance superset (status/owner/version/objetivo/escopo/evals).
  // The deprecation banner injected into AI-facing content (MCP detail + chat context). Editable in
  // Config → Prompts do sistema (id: aviso-depreciacao); {{motivos}} is replaced with the reasons.
  async function deprecationNotice(skill) {
    if (!skill || !skill.deprecated) return '';
    const motivos = ((skill.deprecation && skill.deprecation.reasons) || []).join('; ') || 'revisão vencida';
    let body = '';
    try {
      const p = await readPrompt('aviso-depreciacao');
      body = (p && p.body) || '';
    } catch (error) {
      /* fall back */
    }
    if (!body)
      body = 'ATENÇÃO: esta skill está DEPRECIADA (conteúdo possivelmente desatualizado). Motivos: {{motivos}}.';
    return body.replaceAll('{{motivos}}', motivos);
  }

  // Low-quality warning (selo grade D) for a NON-deprecated skill: rides the same channels as
  // the deprecation aviso — deprecation wins when both apply (it's the stronger statement).
  async function qualityNotice(skill) {
    if (!skill || skill.deprecated || skill.seloGrade !== 'D') return '';
    let body = '';
    try {
      const p = await readPrompt('aviso-qualidade');
      body = (p && p.body) || '';
    } catch (error) {
      /* fall back */
    }
    if (!body)
      body =
        'ATENÇÃO: esta skill tem selo de qualidade BAIXO (nota {{nota}}, {{selo}}/100) — trate o conteúdo com cautela e avise o usuário.';
    return body
      .replaceAll('{{nota}}', String(skill.seloGrade || 'D'))
      .replaceAll('{{selo}}', String(skill.seloQualidade ?? 0));
  }

  // Item 3 da governança: quando QUALQUER conteúdo do contexto está depreciado ou com selo baixo,
  // o sistema instrui o modelo a AVISAR PRIMEIRO — antes de qualquer resposta ao usuário.

  function toOkfSummary(skill) {
    return {
      id: skill.id,
      type: skill.tipo || 'skill',
      title: skill.nome,
      description: skill.descricao,
      owner: skill.owner?.email || skill.owner?.nome || null,
      version: skill.version,
      status: skill.status,
      domain: skill.domain || null,
      timestamp: skill.lastReviewed,
      resource: skill.resource || null,
      deprecated: !!skill.deprecated,
      deprecation: skill.deprecated ? { reasons: (skill.deprecation && skill.deprecation.reasons) || [] } : null,
      // Item 4: o selo viaja para consumidores máquina; nota D (não-depreciada) = lowQuality.
      selo: skill.seloQualidade ?? null,
      seloGrade: skill.seloGrade || null,
      lowQuality: !skill.deprecated && skill.seloGrade === 'D',
      url: `/api/v1/skills/${encodeURIComponent(skill.id)}`
    };
  }

  async function toOkfDetail(skill) {
    const aviso = (await deprecationNotice(skill)) || (await qualityNotice(skill));
    return {
      ...toOkfSummary(skill),
      objetivo: skill.objetivo,
      escopo: skill.escopo,
      modelTier: skill.modelTier,
      evals: (skill.evals || []).map((item) => ({
        id: item.id,
        descricao: item.descricao,
        mustRefuse: item.mustRefuse
      })),
      // A deprecated skill's markdown arrives with the aviso PREPENDED — MCP/GPT consumers read
      // content, so the warning must live inside the content itself to reach the model.
      markdown: aviso ? `<!-- ${aviso} -->\n\n> ⚠️ ${aviso}\n\n${skill.sourceText}` : skill.sourceText
    };
  }

  return {
    listSkillIds,
    usageSkillKey,
    loadSkillsFromDisk,
    callDepartmentProxy,
    ensureDocs,
    ensureCommons,
    listDocs,
    safeDocRel,
    deprecationNotice,
    qualityNotice,
    toOkfSummary,
    toOkfDetail
  };
}
