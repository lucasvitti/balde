# OKF Governance in Balde — implementation reference

> Context file for future sessions. Describes how **Balde de conhecimento** adopts Google's
> **Open Knowledge Format (OKF)** and layers a **governance superset** on top of it. Grounded
> in the actual code (`server.js`, `src/*.mjs`, `public/app.js`). Names drift by a few lines
> over time — search by symbol, not line number.

---

## 1. TL;DR mental model

- **The corpus is one OKF bundle.** Every skill is a directory of markdown + YAML‑frontmatter files, cross‑linked with plain markdown links into a single corpus‑wide knowledge graph. There is **no database** — files on disk are the source of truth, git‑versioned, one commit per write.
- **Two node kinds, one governance primitive.** A **skill** (composition) and each of its **context files** (atomic *concepts*) are both **governed nodes** with owner / curators / cadence / audit gate / evals. A concept **inherits** the skill's defaults unless it overrides them. **Commons** (shared concepts) are governed the same way.
- **Progressive disclosure is size‑aware.** Small skills are shipped **inline**; big skills are **paged** — the consumer gets `SKILL.md` + a manifest (summaries + links) and reads individual files on demand via tools/endpoints.
- **Governance is always shipped.** Every skill/concept/commons node carries a freshness state (`never/green/due‑soon/overdue`) driven by a review cadence, plus optional correctness evals. Curators keep nodes "green" with one click.

---

## 2. What OKF is, and what Balde adds

**OKF** (Open Knowledge Format): a directory of markdown files, each with YAML frontmatter, cross‑linked into a graph via ordinary markdown links. Key OKF properties Balde honors:

- Plain markdown links, **no new syntax**. A bundle‑relative `/x` or a relative `./x`.
- Links are **untyped** — the prose around a link conveys the relationship.
- **Broken links are tolerated**, not errors (they surface as `dangling`, never block).
- Reserved names: OKF has `index.md` / `log.md`. In Balde, **`SKILL.md` is the root node** (the `index.md` equivalent) and the `logs/` dir + git history play the `log.md` role.
- Non‑markdown primary artifacts are referenced via `references/` + a `resource:` frontmatter key.

**Balde's superset** = OKF (the container + graph) **plus** a governance layer: governed nodes, cadence/audit, evals, curator panels, access control, lifecycle (rascunho→canônico→depreciado), a machine API, and size‑aware consumption. OKF makes the file‑based bet legitimate; Balde is "OKF + governance."

Full design rationale lives in [`docs/DESIGN-cross-skill-linking.md`](DESIGN-cross-skill-linking.md) (§8 governance model, §10 phasing, §11 locked decisions).

---

## 3. Corpus layout on disk

```
<skillsRoot>/                     # SKILLS_ROOT env (prod: /opt/balde-corpus/skills, git-versioned bind-mount)
  <skill-id>/                     # one directory per skill = one OKF bundle root
    SKILL.md                      # ROOT NODE (frontmatter + body). The spine / index.md.
    output_schema.json            # kind: schema
    references/*.md               # kind: contexto   (reusable concepts, glossaries, dicts)
    query/*.sql                   # kind: query
    analytics/*                   # kind: catalogo
    eval/cases.json               # kind: eval
    <anything-else>               # kind: outro
    ── governance machinery (NOT context; see §5) ──
    governance.json               # per-skill governed-node index (cadence + evals per concept)
    context-index.json            # A2 AI summaries, keyed by content sha1
    ACCESS.yml                    # visibility + curators/readers (Balde-native ACL)
    logs/  canonico/  legado/     # ledger, published snapshot, version history
<commonsRoot>/                    # COMMONS_ROOT env (prod: /opt/balde-corpus/commons)
  <path>.md                       # shared concepts any skill can link as /commons/<path>.md
  governance.json  context-index.json
```

Each of `skills/`, `commons/`, `buddies/`, `docs/`, `prompts/` is its **own git repo** (auto‑init on boot via `ensureRepo`/`ensureCommons`); every mutation is a commit authored by the acting SSO user (`commitCorpus`/`commitRepo`, author from `X-Authentik-Email/-Name`). The **real** internal corpus (`governance/skills/`) is kept out of the image via `.dockerignore`.

---

## 4. Frontmatter + node identity

`SKILL.md` frontmatter is OKF fields + governance fields (parsed by `parseFrontmatter`):

| Field | Role |
|---|---|
| `type` | **required** (OKF). |
| `title`, `description` | OKF metadata. The governed **domain** (replacing free-form tags) comes from the folder path `<domain>/<slug>`, not the frontmatter. |
| `timestamp` | OKF review/update time (aliases legacy `last_reviewed` / `data_updated`). Feeds the gate + cadence. |
| `resource` | Path to a non‑markdown primary artifact (e.g. `output_schema.json`). |
| `owner` | Attribution point + governance owner (a concept inherits this). Edit it to re‑attribute a skill. |
| `status` | Lifecycle: `rascunho` \| `canonico` \| `depreciado`. |
| `version` | SemVer (starts `0.1.0`). |
| `context_mode` | **Phase D** override: `inline` \| `paged` (else auto by size). |

**A node's identity = its path.** The corpus‑relative path (`<skill-id>/references/base.md`, or `commons/<path>.md`) is simultaneously the file location, the **concept id**, and the **link target**. This is decision **D1** ("path = concept id = link target").

---

## 5. Reserved / excluded files (`isGovernancePath`)

Governance machinery is **never** treated as context (never inlined, never a graph node — except `SKILL.md`, which *is* the root node). `isGovernancePath(path)` excludes:

- **Excluded basenames:** `skill.md`* , `suggestions.json`, `suggestions.md`, `wrong-feedback.json`, `metadata.json`, `index.json`, `change-log.json`, `change-log.md`, `access.yml`, **`context-index.json`**, **`governance.json`**.
- **Excluded path segments (dirs):** `legado`, `logs`, `canonico`, `rascunho`, `.git`.

\* `skill.md` is excluded from the *context file* set because it is surfaced separately as the root node.

This matters because on prod `SKILLS_ROOT === GOVERNANCE_OUTPUT_ROOT` — the skill dir *is* the governance dir, so the two must be separated by rule, not by folder.

---

## 6. Links & the corpus graph

**Authoring rule** (plain markdown links):
- `[x](/commons/foo.md)` → a **commons** shared concept.
- `[x](/<otherSkill>/bar.md)` → a **cross‑skill** concept.
- `[x](./sibling.md)` / `[x](../q/z.sql)` → a **within‑skill** concept (relative).
- `[x](/within.md)` → tries skill‑root first (back‑compat), then corpus‑root.

**Resolution — "dual‑base" (D1):** `resolveContextLink` turns a target into a bundle‑relative path; `classifyCorpusLink` then classifies it as `within` / `cross` / `commons` / `dangling`, checking within‑skill nodes first and falling back to the **corpus node index**.

| Function (server.js) | Role |
|---|---|
| `resolveContextLink(target, sourceRel)` | Markdown target → bundle‑relative path (drops `#anchor`, external schemes). |
| `classifyCorpusLink(...)` | Path → `{scope: within\|cross\|commons, path, targetSkill}` or `{dangling}`. |
| `extractContextLinks(content, ...)` | All markdown links in a file → `{links:[{path,scope,targetSkill}], dangling:[...]}` (images excluded, self‑links dropped). |
| `corpusNodeIndex()` | The **allow‑list** of valid targets across all skills + commons (cached 15 s TTL). |
| `corpusLinkIndex()` | Inverts edges → **backlinks** map + `skillEdges` (skill→neighborhood counts) + `conceptCount` + `commonsCount` (cached 15 s). |

**Backlinks:** within‑skill backlinks are computed in the per‑skill manifest; **cross‑skill** backlinks ("referenced by N skills") come from `corpusLinkIndex`. Dangling links are reported, never fatal (OKF rule).

Known gap: `corpusNodeIndex` is TTL‑only (new files linkable within 15 s); **draft‑only** files aren't in the corpus index (within‑skill resolution still works via the skill's own draft‑aware node set).

---

## 7. The governed‑node model (the core)

One primitive governs **skills**, **concepts** (a skill's context files), and **commons concepts**.

**Fields per node** (owner, curators, version, change‑signal, cadence, `lastReviewedAt`, `evalCriteria`, `evalStatus`).

**Inheritance** (`conceptGovernance(rel, index, skillDefaults)`): a concept inherits
- **owner** ← `SKILL.md` frontmatter `owner`,
- **curators** ← `ACCESS.yml` `curators`,
- **cadence** ← the skill's default cadence (`governance.json` → `skill.cadence`),

unless the concept overrides them in `governance.json → concepts[<rel>]`. Response flags `ownerInherited` / `cadenceInherited` so the UI shows what's inherited vs local.

**Cadence → freshness state** (`cadenceStatus(lastReviewedAt, cadence)`):

| Cadence | Days (`CADENCE_DAYS`) |
|---|---|
| `weekly` | 7 |
| `monthly` | 30 |
| `quarterly` | 91 (**default**, `DEFAULT_CADENCE`) |
| `yearly` | 365 |

| State | Meaning |
|---|---|
| `never` | No review yet → **audit‑due** (the gate). |
| `green` | Fresh. |
| `due-soon` | Within the last 15 % of the window. |
| `overdue` | Past due → **audit‑due** (the gate). |

**The audit gate** = any node in `never`/`overdue` is "audit‑due." The per‑skill manifest returns a governance roll‑up: `counts{green,due-soon,overdue,never}`, `auditDue[]`, `evalFails[]`, and an `overallStatus` (worst of the skill's own cadence + all its concepts). **"Keep green"** = a curator sets `lastReviewedAt = now` (an affirmation); bulk "keep all green" affirms every audit‑due node at once.

---

## 8. Evals

Two eval flavors, matching decision **D3** ("correctness for concepts, behavioral for skills"):

- **Concept correctness evals** (`draftConceptEvalCriteria` + `gradeConceptEval`, BYO key): 2–4 objective, verifiable criteria (AI‑drafted or curator‑authored), then an AI pass/fail grade per criterion. Stored as `evalCriteria` + `evalStatus{overall,results,evaluatedAt}` in `governance.json`. Surfaces per concept as an eval badge (`pass/fail/pending/none`).
- **Skill behavioral governance** = the pre‑existing **minimum‑requirements promotion gate** (`localDraftReview` → `evaluateMinimumRequirements` → `minimumRequirements.canPromote`) + AI governance review. `/api/publish` returns **409** unless `canPromote`, plus feedback‑driven review (bom/fraco/errado ratings feed the curator view).

For **static** concepts (e.g. 60 stored SQL queries), evals are optional; the cheap "keep green" affirmation is enough to keep governance sound.

---

## 9. Where governance state lives on disk

| File | Written by | Holds |
|---|---|---|
| `<skill>/governance.json` | `saveGovernanceIndex` | `{version, skill:{cadence, lastReviewedAt}, concepts:{<rel>:{owner?, curators?, cadence?, lastReviewedAt?, evalCriteria?, evalStatus?}}}` |
| `<skill>/context-index.json` | `regenerateContextIndex` | A2 AI summaries per file: `{entries:{<rel>:{summary, hash(sha1), bytes}}}`. A summary is used **only while the file's hash matches**, else the heuristic summary is used. |
| `<skill>/ACCESS.yml` | `saveSkillAccess` | `{visibility: public\|restricted, curators[], curator_groups[], readers[], reader_groups[]}` (Balde‑native ACL, git‑versioned). |
| `commons/governance.json` | `saveCommonsGov` | Same shape as a skill's `governance.json`, for commons concepts. |
| `commons/context-index.json` | `/api/commons/summarize` | A2 summaries for commons concepts (restores the ones dropped on a D4 move). |

All are excluded from context by `isGovernancePath` (§5).

---

## 10. Consumption: inline vs paged (Phase C/D)

A skill is `SKILL.md` + its context files. How it reaches an AI depends on size:

- **Inline** (small): the whole thing goes in the system prompt.
- **Paged** (big): only `SKILL.md` + a **manifest** (path · kind · size · AI summary · links) go in the prompt; the consumer reads individual files on demand.

**Mode decision** (`resolveChatContextMode`): any skill with `context_mode: paged` → paged; all `inline` → inline; otherwise **auto** by combined size vs `CONTEXT_PAGING_THRESHOLD_CHARS` (default 48 000). `context_mode` frontmatter overrides per skill.

**Paging requires a tool loop.** The in‑app chat (`callAiChatToolLoop` / `callAiChatToolLoopStream`, both OpenAI + Anthropic) gives the model two tools:

| Tool | Does |
|---|---|
| `list_context` | Returns the manifest across the selected skills (path/kind/size/summary/links, incl. cross‑skill/commons targets). |
| `read_context` | Reads one file by corpus path (`<skill>/references/x.md` or `commons/y.md`), draft‑aware, capped at `CHAT_TOOL_READ_MAX_CHARS`. |

Answers carry a **`sources[]`** provenance list (the files actually read → "Fontes" chips in the UI). **Prompt caching:** Anthropic calls mark the (large, stable) system + tools prefix with `cache_control:{ephemeral}`; OpenAI caches the prefix automatically.

The **manifest** is the engine here (`skillContextManifest`) — it returns, per context file: `path, kind, bytes, summary (+summarySource ai|heuristic), links, dangling, backlinks, crossBacklinks, governance`, plus the roll‑up from §7.

---

## 11. Machine API + MCP (external agents)

Bearer‑authenticated (`authorizeMachine` — personal Authentik tokens on prod; optional shared `API_KEY`, fail‑closed if unset):

| Endpoint | Returns |
|---|---|
| `GET /api/v1/skills` | Canonical‑only OKF list. |
| `GET /api/v1/skills/{id}` | OKF detail + markdown + evals. **Size‑aware (Phase D):** small → `contextMode:"inline"` + full `context[]`; big → `contextMode:"paged"` + `contextManifest[]` + `contextHint` (read via `/context/{path}`). |
| `GET /api/v1/skills/{id}/context/{path}` | One context file + its outbound links (progressive disclosure). |

MCP tools mirror this for tool‑capable agents: `balde_list_skill_context`, `balde_read_skill_context` (+ list/read skill). See `integrations/ai-tools/`.

---

## 12. UI surfaces (curator‑facing)

| View (app.js) | Governs |
|---|---|
| **Curadoria** tab (per skill, in Explorar/Corpus) | Concept governance table: freshness badge, cadence select, eval badge, "Manter em dia" / "Rodar eval"; header roll‑up + "Manter tudo em dia" bulk keep‑green. |
| **Commons** nav view | Same table for commons concepts, plus "usado por" (referencedBy chips) + "Resumir tudo (IA)". |
| **Grafo** tab (per skill) | SVG node‑link graph of a skill's context (nodes by kind + SKILL.md root; within/cross/commons edges; dangling; click → node detail). |
| **Mapa do corpus** toggle | Corpus‑wide skill+commons graph (node size = concept count, weighted edges); drill into a skill. |

---

## 13. Commons + D4 migration

**Commons** = a corpus‑level neighborhood of shared concepts (`/commons/…`), so reusable docs (schema dicts, glossaries, base‑table definitions) live once and are linked by many skills — de‑bloating monoliths.

**D4 = AI‑assisted migration** skill→commons, two‑phase:
- `POST /api/skills/:id/commons/plan` (BYO key) → AI classifies context files reusable‑vs‑specific → `{moves:[{path,to,rationale}], keep:[]}` (no writes).
- `POST /api/skills/:id/commons/apply` (`{moves:[{from,to}]}`) → moves files skill→commons, links them back from `SKILL.md` under "## Conceitos compartilhados (commons)", commits both repos, invalidates corpus caches.

Applied on `consultas-sql`: 5 reusable dicts moved → the corpus graph lit up (`consultas-sql → commons ×5`, each commons concept `referencedBy:[consultas-sql]`). A migrated file loses its A2 summary until `/api/commons/summarize` regenerates the commons index. **Note:** currently endpoint‑driven; a curator UI for plan→approve→apply is the open follow‑up.

---

## 14. Governance endpoint reference

| Endpoint | Purpose |
|---|---|
| `GET /api/explore/context?skill=<id>` | Full per‑skill manifest (SSO; feeds Grafo + Curadoria). |
| `GET /api/corpus/graph` | Corpus‑wide `{nodes, edges}` (skills + commons). |
| `POST /api/skills/:id/govern/review` | Keep‑green: set `lastReviewedAt=now` (`{path?}` concept, `{paths?}` bulk, none = affirm skill). |
| `POST /api/skills/:id/govern/cadence` | Set cadence (`{path?, cadence}`). |
| `POST /api/skills/:id/govern/eval-criteria` | Set/edit concept eval criteria. |
| `POST /api/skills/:id/govern/eval-run` | Auto‑draft (if none) + grade concept evals (BYO key). |
| `GET /api/commons` | Enriched commons list (+ referencedBy, governance, `canManage`). |
| `POST /api/commons/govern/{review,cadence,eval-run}` | Commons twins of the skill govern routes (admin or global curator). |
| `POST /api/commons/summarize` | (Re)generate commons A2 summaries (BYO key). |
| `POST /api/skills/:id/commons/{plan,apply}` | D4 migration (§13). |

All mutating governance routes are **manage‑gated** (`canManageSkillReq` = admin OR curator OR the skill's owner); commons governance requires admin OR global curator. Eval/summarize routes are additionally **BYO‑key‑gated**.

---

## 15. Lifecycle & promotion gate

`rascunho` → `canonico` → `depreciado`, with an append‑only ledger + rollback.

- Promotion is **blocked** unless `minimumRequirements.canPromote` (`/api/publish` → 409 with the blocker list otherwise). Canonical skills are what `/api/v1/skills` exposes.
- Every create / edit / upload / publish / rollback is one authored git commit (the ledger *is* git history; `logs/` mirrors change‑logs).
- New knowledge arrives via the **contribution queue** (`queueRoot`), AI‑preprocessed, human‑curated before merge.

---

## 16. Locked decisions (D1–D4) and code map

**Decisions (Vitti, 2026‑08‑05):**
- **D1** — dual‑base path semantics + **user‑defined context paths** (path = concept id = link target).
- **D2** — latest + **change‑signal** (deprecation‑style), not multi‑version concepts.
- **D3** — **full governance on BOTH concepts and skills**; one governed‑node primitive; inheritance keeps it maintainable; a simple curator eval panel (one‑click keep‑green for static atoms).
- **D4** — **AI‑assisted** migration of reusable docs → commons.

**Code map (server.js unless noted):**

| Area | Symbols |
|---|---|
| Exclusions | `isGovernancePath`, `CONTEXT_EXCLUDE_FILES`, `CONTEXT_EXCLUDE_SEGMENTS` |
| Links / graph | `resolveContextLink`, `classifyCorpusLink`, `extractContextLinks`, `corpusNodeIndex`, `corpusLinkIndex` |
| Manifest | `skillContextManifest`, `discoverSkillContextFiles`, `readSkillTextContext`, `contextKind`, `heuristicSummary` |
| Governed node | `loadGovernanceIndex`/`saveGovernanceIndex`, `cadenceStatus`, `conceptGovernance`, `CADENCE_DAYS`, `DEFAULT_CADENCE`, `govSkillShape` |
| A2 summaries | `loadContextIndex`, `summarizeContextFilesWithAI`, `regenerateContextIndex`, `CONTEXT_INDEX_FILE` |
| Concept evals | `draftConceptEvalCriteria`, `gradeConceptEval`, `CONCEPT_EVAL_DRAFT_SYSTEM`, `CONCEPT_EVAL_GRADE_SYSTEM` |
| Commons | `ensureCommons`, `loadCommonsGov`/`saveCommonsGov`, `buildCommonsList`, `commonsRoot` (src/config.mjs) |
| D4 migration | `planCommonsMigration`, `applyCommonsMigration`, `normalizeCommonsTo`, `COMMONS_MIGRATE_SYSTEM` |
| Access | `loadSkillAccess`/`saveSkillAccess`, `canManageSkillReq`, `isCuratorReq`, `isAdminReq` |
| Consumption (C/D) | `resolveChatContextMode`, `skillContextMode`, `buildSkillManifestBlock`, `chatSystemPromptPaged`, `makeChatContextTools`, `buildSkillContextBlock`, `chatSystemPrompt` |
| Tool loop | `callAiChatToolLoop`, `callAiChatToolLoopStream` (src/ai-provider.mjs) |
| Lifecycle | `localDraftReview`, `evaluateMinimumRequirements`, `/api/publish`, `commitCorpus`/`commitRepo` |
| UI | `renderCuratorPanel`, `renderCommons`, `renderContextGraph`, `renderCorpusGraph` (public/app.js) |

---

## 17. Invariants to preserve

1. **Governance machinery is never context** — anything caught by `isGovernancePath` must never be inlined, graphed (except `SKILL.md`), or migrated.
2. **Broken links are tolerated** — never let a dangling link throw or block; report it.
3. **Prod === local, byte‑for‑byte** — Docker `COPY . .`, no bundler. Deploys are file‑copy (tar‑over‑SSH), git‑independent.
4. **Secrets/real data stay out of git/images** — `demo-corpus/users/` (encrypted BYO keys) and `governance/skills/` (real internal data) must never be pushed to the public mirror or baked into the image (`.dockerignore`).
5. **Always ship governance** — a new node without a freshness state is a regression; default cadence is `quarterly`, default state `never` (audit‑due until first affirmed).
6. **BYO key, server‑side only** — AI runs with the acting user's provider key (encrypted at rest via `BALDE_SECRET_KEY`); the browser never sees a key. `BALDE_SECRET_KEY` is **stable** — rotating it makes every saved key undecryptable.
