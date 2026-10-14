import { RUN_QUERY_NOTE } from '../policy/chat-policy.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontmatter } from '../skill-format.mjs';
import { usageRoot, commonsRoot, activeRepo, runWithRepo } from '../config.mjs';
import { extractTextFor, INGEST_TEXT_EXTS, INGEST_DOC_EXTS, INGEST_IMG_EXTS } from '../ingest.mjs';
import { termVector, contentHash, topMatches } from '../similarity.mjs';
import { callAiWithSystemPrompt, aiErrorSummary } from '../ai-provider.mjs';

export function createDiscoveryFeature({
  webActor,
  normEmail,
  curatesActiveBaldeReq,
  loadUserAiConfig,
  loadSkillsFromDisk,
  buildCommonsList,
  canReadCommonsActor,
  canReadSkillActor,
  makeChatContextTools,
  resolveChatContextMode,
  chatSystemPromptPaged,
  chatSystemPrompt,
  withRunQueryTool
}) {
  const INGEST_ROOT = () => join(usageRoot, 'ingest');
  const INGEST_MAX_FILE_BYTES = 10 * 1024 * 1024;
  const INGEST_MAX_FILES = 40;
  const INGEST_DOC_AI_CHARS = 28000;
  const INGEST_MAX_CANDIDATES = 120;
  const INGEST_EXTS = [...INGEST_TEXT_EXTS, ...INGEST_DOC_EXTS, ...INGEST_IMG_EXTS];

  function ingestJobDir(id) {
    return join(INGEST_ROOT(), id);
  }

  async function readIngestJob(id) {
    try {
      return JSON.parse(await readFile(join(ingestJobDir(id), 'job.json'), 'utf8'));
    } catch (error) {
      return null;
    }
  }

  async function saveIngestJob(job) {
    job.updatedAt = new Date().toISOString();
    await mkdir(ingestJobDir(job.id), { recursive: true });
    await writeFile(join(ingestJobDir(job.id), 'job.json'), `${JSON.stringify(job, null, 2)}\n`, 'utf8');
  }

  async function canSeeIngestJob(job, req) {
    const me = webActor(req);
    return Boolean(
      job &&
      job.repo === activeRepo() &&
      ((job.actor && normEmail(job.actor.email) === me.email) || (await curatesActiveBaldeReq(req)))
    );
  }

  const INGEST_EXTRACT_PROMPT = `Você é o extrator de conceitos do Balde (base de conhecimento governada). Receberá UM documento bruto (nome + texto). Extraia os conceitos de conhecimento REUTILIZÁVEL que ele contém — candidatos a virarem cápsulas atômicas (cada uma se sustenta sozinha, sem depender do documento).
  
  Devolva JSON: { "candidates": [ { "title": "...", "type": "conceito|regra|procedimento|dado|episodio", "resumo": "1 frase", "body": "markdown completo e AUTOCONTIDO do conceito", "periodo": "AAAA-MM opcional, só para episodio" } ] }
  
  Regras: no máximo 8 candidatos por documento; cada body é atômico (contexto suficiente dentro dele, nenhuma referência tipo "como visto acima"); prefira menos candidatos e melhores; texto em pt-BR; "dado" = descrição de um dataset/tabela; "episodio" = narrativa de um período (relatório mensal, ata datada). Se o documento não render conceito nenhum, devolva { "candidates": [] }.`;

  async function runIngestJob(jobId) {
    const job = await readIngestJob(jobId);
    if (!job) return;
    await runWithRepo(job.repo, async () => {
      try {
        job.phase = 'extracting';
        await saveIngestJob(job);
        await mkdir(join(ingestJobDir(job.id), 'extracted'), { recursive: true });
        for (const f of job.files) {
          if (f.status === 'erro') continue;
          try {
            const fp = join(ingestJobDir(job.id), 'files', f.name);
            const buf = await readFile(fp);
            const r = await extractTextFor(f.name, fp, buf);
            if (r.image) {
              f.status = 'sem-texto';
              f.chars = 0;
              continue;
            }
            const text = String(r.text || '').trim();
            f.chars = text.length;
            if (!text) {
              f.status = 'sem-texto';
              continue;
            }
            await writeFile(join(ingestJobDir(job.id), 'extracted', `${f.name}.txt`), text, 'utf8');
            f.status = 'extraido';
          } catch (error) {
            f.status = 'erro';
            f.error = error.message;
          }
          await saveIngestJob(job);
        }
        const extracted = job.files.filter((f) => f.status === 'extraido');
        if (!extracted.length) {
          job.phase = 'error';
          job.error = 'Nenhum arquivo rendeu texto extraível.';
          await saveIngestJob(job);
          return;
        }
        job.phase = 'analyzing';
        await saveIngestJob(job);
        const aiConfig = await loadUserAiConfig(job.actor);
        if (!aiConfig || !aiConfig.apiKey) {
          job.phase = 'error';
          job.error = 'Configure seu provedor e chave de IA em Configurações para analisar os documentos.';
          await saveIngestJob(job);
          return;
        }
        job.candidates = [];
        const extractPrompt = job.guidance
          ? `${INGEST_EXTRACT_PROMPT}
  
  ORIENTAÇÃO DO USUÁRIO (siga-a ao decidir o que extrair e como estruturar os candidatos — o contrato JSON acima continua obrigatório):
  ${job.guidance}`
          : INGEST_EXTRACT_PROMPT;
        for (const f of extracted) {
          if (job.candidates.length >= INGEST_MAX_CANDIDATES) break;
          let text = '';
          try {
            text = await readFile(join(ingestJobDir(job.id), 'extracted', `${f.name}.txt`), 'utf8');
          } catch (error) {
            continue;
          }
          try {
            // wantJson=true: callAiWithSystemPrompt returns the PARSED object (or null w/o key).
            const parsed = await callAiWithSystemPrompt(
              extractPrompt,
              { documento: f.name, texto: text.slice(0, INGEST_DOC_AI_CHARS) },
              aiConfig,
              true
            );
            const cands = parsed && Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 8) : [];
            for (const c of cands) {
              if (!c || !c.title || !c.body) continue;
              job.candidates.push({
                id: `c${job.candidates.length + 1}`,
                title: String(c.title).slice(0, 120),
                type: ['conceito', 'regra', 'procedimento', 'dado', 'episodio'].includes(c.type) ? c.type : 'conceito',
                resumo: String(c.resumo || '').slice(0, 240),
                body: String(c.body).slice(0, 20000),
                periodo: /^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(c.periodo || '')) ? String(c.periodo) : '',
                sources: [f.name]
              });
            }
            f.candidates = cands.length;
          } catch (error) {
            f.aiError = aiErrorSummary ? aiErrorSummary(error) : error.message;
          }
          await saveIngestJob(job);
        }
        job.phase = 'ready';
        await saveIngestJob(job);
      } catch (error) {
        job.phase = 'error';
        job.error = error.message;
        await saveIngestJob(job).catch(() => {});
      }
    });
  }
  // Cada nó (skill + cápsula) vira um vetor de termos; consultas comparam cosseno localmente.
  // Tiers superiores (embeddings com cache por hash; juiz LLM só na shortlist) plugam por cima.
  const similarityIndexByRepo = new Map(); // repo -> { at, nodes }
  const SIMILARITY_TTL_MS = 60000;
  const DEDUP_CHECK_THRESHOLD = 0.3;
  const DEDUP_SCAN_THRESHOLD = 0.45;

  // Arquivar ou restaurar muda o que existe: a próxima busca do balde reconstrói o índice.
  function invalidateSimilarityIndex() {
    similarityIndexByRepo.delete(activeRepo());
  }

  async function similarityIndex() {
    const repo = activeRepo();
    const cached = similarityIndexByRepo.get(repo);
    if (cached && Date.now() - cached.at < SIMILARITY_TTL_MS) return cached.nodes;
    const nodes = [];
    try {
      for (const s of await loadSkillsFromDisk()) {
        // Frontmatter keys (format, kind, timestamp...) are noise for similarity — index the BODY.
        let body = String(s.sourceText || '');
        try {
          body = parseFrontmatter(body).body;
        } catch (error) {
          /* raw text stands */
        }
        nodes.push({
          id: s.id,
          kind: 'skill',
          title: s.nome || s.id,
          hash: contentHash(`${s.nome} ${body}`),
          vec: termVector(s.nome || s.id, body)
        });
      }
    } catch (error) {
      /* skills unreadable — capsules still index */
    }
    try {
      const commons = await buildCommonsList();
      for (const c of commons.concepts) {
        let body = '';
        try {
          body = await readFile(join(commonsRoot(), c.path, 'context.md'), 'utf8');
        } catch (error) {
          body = String(c.summary || '');
        }
        const serie = c.governance && c.governance.serie ? `${c.path.split('/')[0]}/${c.governance.serie}` : '';
        nodes.push({
          id: `commons/${c.path}`,
          kind: 'capsule',
          title: c.title || c.path,
          serie,
          hash: contentHash(`${c.title} ${body}`),
          vec: termVector(c.title || c.path, body)
        });
      }
    } catch (error) {
      /* commons unreadable */
    }
    similarityIndexByRepo.set(repo, { at: Date.now(), nodes });
    return nodes;
  }
  // Reuses the dedup index (skills + capsules, lexical term vectors, 60s TTL) as a search
  // index. Deliberately NOT vector/RAG: same zero-infra property as the rest of the corpus.
  //
  // The threshold is much lower than dedup's on purpose. Dedup compares two long documents,
  // where a real duplicate scores high. A query is 2–5 terms against an 80-term document
  // vector, so even a perfect topical hit lands around 0.1–0.4 — at dedup's 0.3–0.45 floor
  // almost every genuine result would be dropped. Here ranking does the work and the floor
  // only trims noise.
  const SEARCH_THRESHOLD = 0.04;

  async function searchCorpus(query, actor, { limit = 20, kind = '', threshold = SEARCH_THRESHOLD } = {}) {
    const q = String(query || '').trim();
    if (!q) return { error: 'Informe o termo de busca (q).' };
    const probe = termVector('', q); // query terms only — no title to boost
    if (!Object.keys(probe).length) {
      return { query: q, found: 0, hits: [], note: 'Nenhum termo pesquisável (palavras com 3+ letras).' };
    }
    const index = await similarityIndex();
    const wanted = kind === 'skill' || kind === 'capsule' ? kind : '';
    const pool = wanted ? index.filter((n) => n.kind === wanted) : index;
    // Rank generously, then ACL-filter — a restricted node must never even surface its title.
    const ranked = topMatches(probe, '', pool, { threshold, limit: Math.max(limit * 5, 100) });
    const hits = [];
    for (const m of ranked) {
      if (hits.length >= limit) break;
      if (m.kind === 'capsule') {
        const cid = m.id.replace(/^commons\//, '');
        if (!(await canReadCommonsActor(cid, actor))) continue;
        hits.push({
          id: cid,
          kind: 'capsule',
          title: m.title,
          score: m.score,
          terms: m.terms,
          serie: (index.find((n) => n.id === m.id) || {}).serie || '',
          url: `/api/v1/commons/${cid.split('/').map(encodeURIComponent).join('/')}`,
          webUrl: `/commons/${cid}`
        });
      } else {
        if (!(await canReadSkillActor(m.id, actor))) continue;
        hits.push({
          id: m.id,
          kind: 'skill',
          title: m.title,
          score: m.score,
          terms: m.terms,
          url: `/api/v1/skills/${encodeURIComponent(m.id)}`,
          webUrl: `/${m.id}`
        });
      }
    }
    return { query: q, found: ranked.length, hits };
  }
  // The chat's grounded tool-loop, exposed STATELESSLY for the machine API (/api/v1/ask) and the
  // `balde` CLI: one question in, one grounded answer out. No chat record, no history, no
  // recordSkillEvent — a machine ask must never inflate usage counts or persist (same discipline as
  // testEvalCase). Two grounding shapes decided by whether the caller names skills:
  //   • skills named → the EXACT chat stack over those skills (inline/paged + governed run_query).
  //   • no skills    → corpus-wide discovery: the model searches + reads the corpus on demand.

  // Corpus-wide discovery toolset: search the whole (readable) balde and read any node on demand.
  // read_context is the chat's own reader (ACL-gated, resolves any corpus path via the node index),
  // so we seed makeChatContextTools with NO skills and add search_corpus + list_skills on top — an
  // unseeded ask can then find where the answer lives and page it in.
  async function makeCorpusDiscoveryTools(actor = null) {
    const base = await makeChatContextTools([], actor); // gives read_context + a shared reads[] (provenance)
    const readContext = base.tools.find((t) => t.name === 'read_context');
    const tools = [
      {
        name: 'search_corpus',
        description:
          'Busca no corpus inteiro deste balde por texto (skills e cápsulas): ranqueia por similaridade léxica e devolve, para cada acerto, id, kind (skill|capsule), título e "readPath" (o caminho para ler com read_context). Use PRIMEIRO para descobrir onde está a resposta.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Texto livre: o assunto, um termo de negócio, um nome ou código de plano.'
            },
            kind: {
              type: 'string',
              enum: ['skill', 'capsule'],
              description: 'Restringe a skills ou a cápsulas. Omita para buscar ambos.'
            },
            limit: { type: 'number', description: 'Máximo de resultados (padrão 12).' }
          },
          required: ['query'],
          additionalProperties: false
        }
      },
      {
        name: 'list_skills',
        description:
          'Lista as skills canônicas visíveis (id, nome, objetivo). Use quando a busca não bastar para ver o que existe no balde.',
        input_schema: { type: 'object', properties: {}, additionalProperties: false }
      },
      readContext
    ].filter(Boolean);
    async function execute(name, input) {
      if (name === 'search_corpus') {
        const r = await searchCorpus(String((input && input.query) || ''), actor, {
          limit: Math.min(Number(input && input.limit) || 12, 30),
          kind: (input && input.kind) || ''
        });
        if (r.error) return `ERRO: ${r.error}`;
        const hits = (r.hits || []).map((h) => ({
          id: h.id,
          kind: h.kind,
          title: h.title,
          score: Number(h.score || 0).toFixed(3),
          readPath: h.kind === 'capsule' ? `commons/${h.id}` : `${h.id}/SKILL.md`
        }));
        return JSON.stringify({ query: r.query, found: r.found, hits });
      }
      if (name === 'list_skills') {
        const canonical = (await loadSkillsFromDisk()).filter((s) => s.status === 'canonico');
        const visible = [];
        for (const s of canonical) {
          if (await canReadSkillActor(s.id, actor))
            visible.push({ id: s.id, nome: s.nome, objetivo: s.objetivo || '' });
        }
        return JSON.stringify({ count: visible.length, skills: visible });
      }
      if (name === 'read_context') return base.execute('read_context', input);
      return `ERRO: ferramenta desconhecida "${name}".`;
    }
    return { tools, execute, reads: base.reads };
  }

  // System prompt for a corpus-wide ask (no skills named): discover, read, then answer only from what
  // was read. Mirrors the chat's persona/pt-BR contract without any skill inlined.
  function askDiscoverySystemPrompt() {
    const orgSeg = process.env.BALDE_ORG_NAME ? ` da equipe ${process.env.BALDE_ORG_NAME}` : '';
    return `Você é o assistente do Balde, a base de conhecimento de skills de IA${orgSeg}. Responda em português (pt-BR), de forma clara e objetiva. Você tem acesso ao corpus inteiro deste balde por ferramentas: search_corpus (descubra skills e cápsulas por texto), list_skills (liste as skills) e read_context (leia o conteúdo completo de UM arquivo pelo caminho no corpus, ex.: "dominio/skill/SKILL.md" ou "commons/pasta/arquivo.md"; use o "readPath" que a busca devolve). Fluxo: busque, leia o que for relevante e responda BASEANDO-SE SOMENTE no que leu, citando a(s) skill(s) ou cápsula(s) usadas. Se o corpus não cobrir a pergunta, diga isso claramente em vez de inventar.`;
  }

  // Assemble the grounded stack for ONE ask. `skillIds` empty/absent → corpus-wide discovery;
  // otherwise the exact chat grounding over those skills (inline/paged) + governed run_query. No
  // contribute and no run_sql on this surface: an ask answers, it does not enqueue or draft SQL.
  // Returns { system, toolset:{tools,execute,reads}, mode } ready for the (streaming) tool loop.
  async function buildAskGrounding(skillIds, actor, aiConfig) {
    const ids = (Array.isArray(skillIds) ? skillIds : []).filter(Boolean);
    if (!ids.length) {
      return { system: askDiscoverySystemPrompt(), toolset: await makeCorpusDiscoveryTools(actor), mode: 'discover' };
    }
    const ctxSkills = (await loadSkillsFromDisk()).filter((s) => ids.includes(s.id));
    const { mode } = await resolveChatContextMode(ctxSkills, aiConfig);
    let system;
    let toolset = { tools: [], execute: null, reads: [] };
    if (mode === 'paged') {
      ({ system } = await chatSystemPromptPaged(ids, actor));
      toolset = await makeChatContextTools(ids, actor);
    } else {
      system = await chatSystemPrompt(ids, actor);
    }
    toolset = await withRunQueryTool(toolset, ids, actor);
    if (toolset && toolset.tools.some((t) => t.name === 'run_query')) system += RUN_QUERY_NOTE;
    return { system, toolset: toolset || { tools: [], execute: null, reads: [] }, mode };
  }

  const dedupDismissPath = () => join(usageRoot, `dedup-dismissed-${activeRepo()}.json`);

  async function loadDedupDismissed() {
    try {
      return JSON.parse(await readFile(dedupDismissPath(), 'utf8'));
    } catch (error) {
      return { pairs: [] };
    }
  }

  return {
    INGEST_ROOT,
    INGEST_MAX_FILE_BYTES,
    INGEST_MAX_FILES,
    INGEST_EXTS,
    ingestJobDir,
    readIngestJob,
    saveIngestJob,
    canSeeIngestJob,
    runIngestJob,
    DEDUP_CHECK_THRESHOLD,
    DEDUP_SCAN_THRESHOLD,
    similarityIndex,
    invalidateSimilarityIndex,
    searchCorpus,
    buildAskGrounding,
    dedupDismissPath,
    loadDedupDismissed
  };
}
