// Single source of truth for the three Balde tools, exported in every provider
// shape (Anthropic tool-use, OpenAI functions, MCP) plus a provider-agnostic executor.
// The JSON Schemas double as OpenAI `parameters`, Anthropic `input_schema`, and MCP `inputSchema`.

import { listRepos, listSkills, getSkill, getSkillContext, readSkillContextFile, listCommons, readCommonsConcept, findFiles, searchCorpus, runSkillQuery, inspectSkillDataset, contributeContext, capsuleSpec, listCapsuleCategories, compileCapsule, submitCapsule } from './baldeClient.mjs';

// Descriptions are prescriptive about WHEN to call — this measurably improves tool selection.
const TOOL_DEFS = [
  {
    name: 'balde_list_repos',
    description:
      'List the repos ("baldes") this token can read — independent knowledge partitions (e.g. the corporate corpus vs a personal space), each with its own skills, capsules and governance profile. Every other tool operates inside ONE repo: the one set by the BALDE_REPO environment variable, or the default "corporate" when unset. Call this when the user asks which repos/spaces exist, or when a skill you expected is missing (it may live in another repo — tell the user to point the integration at it via BALDE_REPO).',
    schema: { type: 'object', properties: {}, additionalProperties: false, required: [] },
    run: async () => {
      const repos = await listRepos();
      return { count: repos.length, activeRepo: (process.env.BALDE_REPO || 'corporate'), repos };
    }
  },
  {
    name: 'balde_list_skills',
    description:
      'List the canonical skills (governed OKF knowledge modules) published in Balde. Call this first — whenever the user asks what skills or knowledge exist, or before fetching a specific skill — to discover skill ids, titles, descriptions and tags. Returns only approved/canonical skills; drafts are never exposed.',
    schema: { type: 'object', properties: {}, additionalProperties: false, required: [] },
    run: async () => {
      const skills = await listSkills();
      return { count: skills.length, skills };
    }
  },
  {
    name: 'balde_get_skill',
    description:
      "Download one skill's full context from Balde by its id — objective, scope, evaluation cases, and the complete SKILL.md instructions (markdown). Call this after balde_list_skills, once you have chosen a relevant skill id, to load its guidance into context and answer using it. `media.files[]` lists downloadable file-attachments as { name, size, url } (PDFs, zips, .docx/.xlsx); fetch a file by GET-ing its `url` (e.g. /api/v1/skills/<id>/files/<name>) with your Bearer token. Returns an error if the id is unknown or the skill is not canonical.",
    schema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'The skill id from balde_list_skills (e.g. "resumo-reuniao").' }
      },
      additionalProperties: false,
      required: ['skill_id']
    },
    run: async (input) => getSkill(input.skill_id)
  },
  {
    name: 'balde_list_skill_context',
    description:
      "List a skill's context files as an OKF knowledge graph — each node has path, size, kind, a one-line summary, and its links / backlinks (cross-references to other context files) — WITHOUT downloading content. Call this after balde_get_skill on a LARGE skill (its SKILL.md references files it doesn't inline) to see what context exists and how it connects, then WALK the graph with balde_read_skill_context, following each file's links to pull only the subgraph you need. Small skills already ship their context inline in balde_get_skill, so this is mainly for big ones.",
    schema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'The skill id (e.g. "reuniao/resumo-reuniao").' }
      },
      additionalProperties: false,
      required: ['skill_id']
    },
    run: async (input) => getSkillContext(input.skill_id)
  },
  {
    name: 'balde_read_skill_context',
    description:
      "Download ONE context file's full text from a skill by its path (from balde_list_skill_context). Returns { path, bytes, kind, content, links, dangling } — the `links` are cross-references to other context files, so you can keep walking the graph and fetch only what you need instead of loading the whole skill. Errors if the path isn't a readable context file of that skill.",
    schema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'The skill id the file belongs to.' },
        path: { type: 'string', description: 'The context file path from balde_list_skill_context (e.g. "referencias/fontes-de-dados.md").' }
      },
      additionalProperties: false,
      required: ['skill_id', 'path']
    },
    run: async (input) => readSkillContextFile(input.skill_id, input.path)
  },
  {
    name: 'balde_list_commons',
    description:
      'List the shared "commons" concepts — reusable knowledge (schema dictionaries, glossaries, business definitions) that any skill can link. Each returns a path, one-line summary, and which skills reference it. Call this to discover shared concepts, or when a skill context file links to a "/commons/..." target.',
    schema: { type: 'object', properties: {}, additionalProperties: false, required: [] },
    run: async () => { const commons = await listCommons(); return { count: commons.length, commons }; }
  },
  {
    name: 'balde_read_commons',
    description:
      'Download ONE shared commons concept by its path (from balde_list_commons, or a skill context link like "/commons/dados_vendas/dicionario_dados"). Returns { path, content, links, media } — `content` INCLUDES AI-described media (image descriptions + tables rendered as markdown), so you get the whole concept as text. `media.files[]` lists downloadable file-attachments as { name, size, url } (PDFs, zips, .docx/.xlsx); fetch a file by GET-ing its `url` (e.g. /api/v1/commons/<path>/files/<name>) with your Bearer token. Follow a skill\'s "/commons/..." links here to page in shared knowledge on demand.',
    schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'The commons concept path, e.g. "dados_vendas/dicionario_dados" or "/commons/dados_vendas/dicionario_dados".' } },
      additionalProperties: false,
      required: ['path']
    },
    run: async (input) => readCommonsConcept(input.path)
  },
  {
    name: 'balde_search_corpus',
    description:
      "Search the corpus BY MEANING OF THE WORDS: ranks skills and capsules against a free-text query and returns the best matches. Call this FIRST whenever you do not already know which skill or capsule holds the answer — it is the discovery entry point, cheaper and broader than listing every skill and reading each one. Lexical ranking (weighted term vectors + cosine, pt-BR aware), so it matches wording, not concepts: prefer the domain's own vocabulary over synonyms, and try a second phrasing if the first returns little. Returns id, kind (skill|capsule), title, score, `terms` (the words that actually matched — use them to judge a hit) and the URLs to read it. Follow a hit with balde_get_skill or balde_read_commons to get the content. Only returns what your key may read. For DOWNLOADABLE ATTACHMENTS use balde_find_files instead — files are not in this index.",
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text: the subject, a term of art, a plan name or code (e.g. "pedagio fora da cobertura", "reajuste anual", "40812").' },
        limit: { type: 'number', description: 'Max results (default 20).' },
        kind: { type: 'string', enum: ['skill', 'capsule'], description: 'Restrict to skills or to capsules. Omit to search both.' }
      },
      additionalProperties: false,
      required: ['query']
    },
    run: async (input) => searchCorpus(input.query, { limit: input.limit, kind: input.kind })
  },
  {
    name: 'balde_find_files',
    description:
      "Search Balde for DOWNLOADABLE ATTACHMENTS (the files/ sidecar: PDFs, spreadsheets, zips) attached to skills and commons capsules. Call this WHENEVER the user asks for a document, PDF, proposal, report or attachment — these files are deliberately NOT part of the context index, so balde_list_skill_context / balde_read_commons will NOT reveal them and you must not conclude a file is missing without searching here first. Returns each hit's exact path plus a download url (use your API key) and a webUrl a human can open in the browser.",
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms: a plan/document code, file name, or part of the owning capsule id (e.g. "40812", "proposta completo").' },
        limit: { type: 'number', description: 'Max results to return (default 20).' }
      },
      additionalProperties: false,
      required: ['query']
    },
    run: async (input) => findFiles(input.query, input.limit)
  },
  {
    name: 'balde_run_query',
    description:
      "EXECUTE one of a skill's governed queries — a stored, git-versioned .sql file of the skill (you never send SQL) — in an ephemeral, locked DuckDB sandbox over the skill's governed datasets: its analytics/ + data/ .csv/.parquet files plus linked capsules' data/ files, each pre-loaded as a table named by the file stem (base.parquet → table `base`). The LAST SELECT in the file is the result. Call this when the user's question needs actual numbers a skill's query computes (the .sql files appear in balde_list_skill_context / balde_get_skill context) — answer with the returned rows instead of estimating. Returns { columns, rows (capped), rowCount, truncated, elapsedMs, datasets: [{table, source, bytes}] } — `datasets[].source` paths are inspectable with balde_inspect_dataset.",
    schema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'The skill id that owns the query (e.g. "reuniao/resumo-reuniao").' },
        path: { type: 'string', description: 'The .sql file path inside the skill (e.g. "query/reunioes-vs-decisoes.sql"), from the skill context listing.' }
      },
      additionalProperties: false,
      required: ['skill_id', 'path']
    },
    run: async (input) => runSkillQuery(input.skill_id, input.path)
  },
  {
    name: 'balde_inspect_dataset',
    description:
      "Profile ONE governed dataset of a skill — a .csv/.parquet under its analytics/ or data/ — without writing SQL: returns { schema (column names + types), rowCount, profile (per-column nulls, distincts, min/max) }. Call this before interpreting balde_run_query results, or when the user asks what data a skill has. Dataset paths come from a query run's datasets[].source (strip the leading \"<skill-id>/\") or from analytics/ entries in balde_list_skill_context. Skill datasets only — a linked capsule's data/ files are not inspectable through this tool.",
    schema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'The skill id that owns the dataset.' },
        path: { type: 'string', description: 'The dataset path inside the skill (e.g. "analytics/reunioes.csv" or "data/base.parquet").' }
      },
      additionalProperties: false,
      required: ['skill_id', 'path']
    },
    run: async (input) => inspectSkillDataset(input.skill_id, input.path)
  },
  {
    name: 'balde_contribute_context',
    description:
      "Submit new context (notes, examples, corrections, source material) to Balde's human-curation queue for an EXISTING skill. Call this when the user wants to contribute, improve, or feed knowledge into a skill. This does NOT modify the skill directly — a human curator reviews and merges it. The target skill_id must already exist (see balde_list_skills). HARD GATE ON THE DESTINATION BALDE: you MUST pass `repo` = the balde this goes to, and it must match the connection's active balde (the `activeRepo` on every tool result / balde_list_repos) — otherwise the write is REFUSED and nothing is saved. The target is a hidden connector setting (BALDE_REPO) and there is no dry-run here, so BEFORE calling, tell the user which balde this will land in (e.g. \"this will go to your personal balde 'Meu Balde'\"), get their explicit confirmation, and pass that balde as `repo`. WRITING STANDARD: write the contribution as self-contained knowledge an independent person who never saw the source can read and understand — define terms and carry the context; not terse notes that assume the original material.",
    schema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'The existing skill id to attach the context to.' },
        content: { type: 'string', description: 'The new context/knowledge to contribute (plain text or markdown).' },
        repo: { type: 'string', description: 'REQUIRED confirmation of the destination balde (repo) — must equal the connection\'s active balde (activeRepo / balde_list_repos). Mismatch or absence refuses the write. Confirm it with the user first.' },
        title: { type: 'string', description: 'Optional short title for the contribution.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for the contribution.' }
      },
      additionalProperties: false,
      required: ['skill_id', 'content', 'repo']
    },
    run: async (input) => {
      assertTargetBalde(input.repo);
      return contributeContext({ skillId: input.skill_id, content: input.content, title: input.title, tags: input.tags });
    }
  },
  {
    name: 'balde_capsule_spec',
    description:
      'Fetch the balde-capsule/1 authoring SPEC (raw markdown) — the contract for import capsules: a single JSON manifest that packages ready-to-deploy knowledge (an anchor skill create/update + shared "capsule" concepts with governance, timeline série/período, media + links). ALWAYS call this BEFORE generating a capsule manifest, then follow the spec exactly. WRITING STANDARD — applies to every capsule concept AND the anchor skill you author: write self-contained knowledge for an INDEPENDENT human reader who never saw the source study. Each artifact must stand on its own — open with what it is and why it matters, define its terms in plain language, and carry enough context to be understood cold. Do NOT write it like model/API documentation or terse notes that only make sense with the original material in hand. The ingestion loop is: read spec → balde_capsule_categories (pick each new capsule\'s TYPE — ask the end user when the material leaves it unclear) → generate manifest from the raw material → balde_compile_capsule → fix reported errors → repeat until ok:true → balde_submit_capsule.',
    schema: { type: 'object', properties: {}, additionalProperties: false, required: [] },
    run: async () => capsuleSpec()
  },
  {
    name: 'balde_capsule_categories',
    description:
      'List the governed capsule CATEGORIES (types) of the active balde — [{ key, label, hint }] plus the default key. Every capsule is one of these types (defaults: dado = closed data point, reuniao = meeting summary, decisao = decision record, tarefas = task list; admins can extend the vocabulary, so ALWAYS read the live list instead of assuming). Call this BEFORE authoring a manifest and set "categoria" on every NEW concept with one of the keys. When the raw material does not clearly match one type, ASK the end user which type fits — do not guess and do not silently fall back to the default (a create without "categoria" compiles with the warning categoria-ausente and lands as the default type).',
    schema: { type: 'object', properties: {}, additionalProperties: false, required: [] },
    run: async () => listCapsuleCategories()
  },
  {
    name: 'balde_compile_capsule',
    description:
      "Validate a balde-capsule/1 manifest against Balde's corpus WITHOUT writing anything. Returns { ok, repo, errors, warnings, plan }: `repo` and the first plan line (`balde: <name>`) echo the TARGET balde (repo) this compile ran against — it comes from this server's BALDE_REPO env (unset = the default balde), so SHOW it to the user and make sure it's where the knowledge should land. The manifest may optionally pin `\"repo\": \"<name>\"` as an assertion: compile fails with repo-divergente when it doesn't match the active balde. `errors` are machine-readable {code, path, message} — fix them in the manifest and compile again until ok:true; `warnings` don't block but read them (série normalization, duplicate período, unknown users, categoria-ausente = a new capsule missing its TYPE — set \"categoria\" from balde_capsule_categories, asking the end user when unclear); `plan` is the exact deployment preview (episode lines include the série's current latest período, so you can verify timeline continuity). Iterate freely — compiling is free and stateless. Requires the spec from balde_capsule_spec.",
    schema: {
      type: 'object',
      properties: {
        manifest: { type: 'object', description: 'The complete balde-capsule/1 manifest object (format, skill?, concepts?, references?).' }
      },
      additionalProperties: false,
      required: ['manifest']
    },
    run: async (input) => compileCapsule(input.manifest)
  },
  {
    name: 'balde_submit_capsule',
    description:
      "Submit a CLEAN capsule manifest (balde_compile_capsule returned ok:true) to Balde's human-curation queue as ONE reviewable item. Nothing is applied directly — a curator of the anchor skill reviews the deployment plan and their approval deploys it (concepts + governance + SKILL.md links, git-versioned). HARD GATE ON THE DESTINATION BALDE: you MUST pass `repo` = the balde this lands in, and it must match the balde the compile report echoed (the connection's active balde) — otherwise the submit is REFUSED and nothing is queued. Call ONLY after showing the user the compile plan, confirming the target balde, and getting their explicit go — then pass that balde as `repo`. Returns { queueId, plan }. If the manifest no longer compiles, you get the compile report back instead (submitted: false).",
    schema: {
      type: 'object',
      properties: {
        manifest: { type: 'object', description: 'The same manifest that compiled clean.' },
        repo: { type: 'string', description: 'REQUIRED confirmation of the destination balde (repo) — must equal the balde the compile report echoed (the connection\'s active balde). Mismatch or absence refuses the submit. Confirm it with the user first.' }
      },
      additionalProperties: false,
      required: ['manifest', 'repo']
    },
    run: async (input) => {
      assertTargetBalde(input.repo);
      return submitCapsule(input.manifest);
    }
  }
];

const BY_NAME = new Map(TOOL_DEFS.map((t) => [t.name, t]));

// Anthropic Messages API: tools: [{ name, description, input_schema }]
export function anthropicTools() {
  return TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
}

// OpenAI Chat Completions / Responses: tools: [{ type:'function', function:{ name, description, parameters } }]
export function openaiTools() {
  return TOOL_DEFS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.schema }
  }));
}

// MCP tools/list: [{ name, description, inputSchema }]
export function mcpTools() {
  return TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema }));
}

export function toolNames() {
  return TOOL_DEFS.map((t) => t.name);
}

// The balde (repo) this connection targets — from BALDE_REPO (the connector setting), or the
// default "corporate" when unset. It is otherwise invisible (buried in the integration's config),
// so a wrong setting silently sends reads/writes to the wrong balde.
export function activeBalde() {
  return (process.env.BALDE_REPO || '').trim().toLowerCase() || 'corporate';
}

// HARD GATE for writes: the caller must pass the balde it INTENDS to write to, and it must match
// the balde this connection targets. Refuses (writes nothing) on absence or mismatch, so a wrong
// BALDE_REPO setting can never silently land data in the wrong balde — the assistant has to name
// the destination and the user gets to catch it. The error names the active balde so the assistant
// can confirm and retry.
export function assertTargetBalde(repo) {
  const want = String(repo || '').trim().toLowerCase();
  const active = activeBalde();
  if (!want) {
    throw new Error(`Destination balde not confirmed — nothing was written. Pass "repo" with the balde this must be written to. This connection targets "${active}" (BALDE_REPO setting). Ask the user which balde, then retry with repo:"${active}" if that is correct.`);
  }
  if (want !== active) {
    throw new Error(`Balde mismatch — nothing was written. You asked to write to "${want}", but this connection targets "${active}" (BALDE_REPO setting). If "${want}" is correct, point the connector at it (change BALDE_REPO) or use the connection for that balde; if "${active}" is correct, confirm with the user and retry with repo:"${active}".`);
  }
}

// Provider-agnostic executor. Returns a JS value; throws on error. Callers serialize
// the result into their provider's tool_result / tool message shape.
export async function executeTool(name, input = {}) {
  const tool = BY_NAME.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  const result = await tool.run(input || {});
  // ALWAYS surface the active balde so the user can confirm WHERE every operation happened — the
  // target is a hidden connector setting (BALDE_REPO), easy to get wrong. Prepended to every
  // object result (unless it already reports it) so the assistant sees it on every single call
  // and can name/confirm the balde — especially before ingesting.
  if (result && typeof result === 'object' && !Array.isArray(result) && result.activeRepo === undefined && result.repo === undefined) {
    return { activeRepo: activeBalde(), ...result };
  }
  return result;
}
