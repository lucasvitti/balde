# Balde — Corpus File Architecture (canonical reference)

**Status:** canonical · reflects the deployed model (2026-08-06, incl. node-as-directory commons
+ Phase 2 media). Governance depth: [`OKF-GOVERNANCE.md`](./OKF-GOVERNANCE.md). Cross-skill/commons
linking: [`DESIGN-cross-skill-linking.md`](./DESIGN-cross-skill-linking.md). This doc is the
**file layout + access** contract.

The corpus is two git-versioned neighborhoods — **`skills/`** and **`commons/`** — read live from
bind-mounts. The through-line:

> A **skill** = `SKILL.md` (spine) + concept files (context) + a governed-node ledger.
> A **commons concept** = a self-contained **folder** — `context.md` + its own governance + media
> sidecars. Both are governed by the same node model, and both are reachable by AI providers
> through the machine API / MCP tools (§8).

---

## 1. A skill — `skills/<domain>/<slug>/`

Skills are folder-based under a governed domain (like the commons): the id is `<domain>/<slug>`, the domain comes from the shared admin vocabulary (Administração › Domínios). Optional free sub-folders may sit between the domain and the slug (`<domain>/<sub>/…/<slug>`, up to 5 segments total); only the first segment (the domain) is governed — the sub-folders just organize.

```
<domain>/<slug>/
├── SKILL.md                     ← spine (OKF index.md): frontmatter + prompt. REQUIRED; the root node.
│
│   ── context files ("concepts" — sent to the model; classified by folder) ──
├── references/<name>.md          kind: contexto    definitions, glossaries, business context
├── query/<name>.sql              kind: query       SQL / scripts
├── analytics/<name>.(md|csv)     kind: catalogo    data catalogs / schema dictionaries
├── output_schema.json            kind: schema      output contract (frontmatter `resource:`)
├── eval/cases.json               kind: eval        evaluation cases
│
│   ── governed-node machinery (git-versioned; NEVER sent as raw context) ──
├── governance.json               ledger for ALL concepts (creator·cadence·lock·eval·approvals[])
├── context-index.json            AI summaries per concept (hash-keyed)
├── ACCESS.yml                    curators / access cohorts
│
│   ── sidecars & lifecycle (excluded from raw context) ──
├── img/                          images + img/descriptions.json (AI descriptions → become context)
├── canonico/                     published canonical snapshot
├── legado/<stamp>/               archived prior versions
└── logs/                         change-log.(json|md) · code-review logs
```

Skills keep **one central `governance.json`**; concepts are bare files. Excluded-from-context
(`isGovernancePath`): segments `canonico legado rascunho logs img .git`; filenames
`governance.json context-index.json ACCESS.yml metadata.json suggestions.* change-log.* index.json`.

---

## 2. A commons concept — `commons/<domain>/<concept>/` (node-as-directory)

The commons is one shared neighborhood for the whole corpus. **Each concept is a folder** — it
carries its own content, governance, and media, so it grows and travels as a unit.

```
commons/
├── README.md                     neighborhood index (not a concept)
├── governance.json               neighborhood DEFAULTS only → { version:2, defaults:{ cadence } }
│
└── <domain>/<concept>/           ← a concept; its id + link target is the folder path
    ├── context.md                the concept content (linked + sent to the model)
    ├── governance.json           THIS concept's ledger (creator·cadence·lock·eval·approvals[])
    ├── ACCESS.yml                OPTIONAL per-capsule ACL (absent = public), mirrors the skill one
    ├── README.md                 index / overview (optional)
    ├── img/
    │   ├── <name>.png            image
    │   └── descriptions.json     { entries: { "<name>": { description, hash, model, at } } }
    ├── data/                     small tables (NOT datasets)
    │   ├── <name>.csv
    │   └── descriptions.json     { entries: { "<name>": { description, markdown, hash, model, at } } }
    ├── legado/                   archived prior versions
    └── logs/                     change-log · reviews
```

- **Concept id / link target** = the folder path; `[label](/commons/<domain>/<concept>)` resolves
  to `<concept>/context.md`.
- Commons keeps **governance per concept folder** + the minimal top-level defaults file.
- Reserved sidecar dirs (`img data legado logs`) inside a concept are never separate concepts.
- **Visibility**: capsules are public by default; an `ACCESS.yml` in the concept folder
  (`visibility: restricted` + `curators`/`readers` lists, same shape as the skill ACL) hides the
  capsule from EVERY surface — lists, explorer, graph, chat grounding, `/api/v1/commons`, MCP —
  for anyone not listed (admins and the concept's own governance stewards always retain access).
  Import-capsule manifests declare ONE `visibility` for the whole manifest; the anchor skill and
  every concept inherit it (`capsula-spec.md` § Visibilidade única).

---

## 3. Media sidecars (`img/` + `data/`) — commons AND skills

Dropped-in images and small tables are turned by the BYO AI into text (hash-gated, git-versioned):

- **`img/`** — images → a vision **description** (`img/descriptions.json`).
- **`data/`** — CSV/TSV (small tables, *not* datasets) → a **summary + `markdown`** (the table
  rendered as a markdown table) in `data/descriptions.json`.

**Descriptions become context.** For a **commons** concept, on any read — in-app chat `read_context`,
the new-tab concept page, the machine API `GET /api/v1/commons/{path}`, and the `balde_read_commons`
tool — `context.md` is returned with `## Imagens` + `## Dados` appended. For a **skill**, the same
`## Imagens`/`## Dados` block is appended to the skill's assembled context (`buildSkillContextBlock`,
the in-app chat grounding); `img/` + `data/` are excluded from raw context files so they act purely as
media sidecars. Images are served raw for rendering via `GET /api/commons/img?path=<id>&name=<file>`
(commons) or `GET /api/skills/{id}/img?name=<file>` (skills). Curators trigger processing with
"Processar mídia (IA)" — `POST /api/commons/process-media` or `POST /api/skills/{id}/process-media`
(BYO key); the skill overview lists its media via `GET /api/skills/{id}/media`.

---

## 4. SKILL.md frontmatter contract

Flat `key: value` + inline-list (`[a, b]`) YAML — the shared subset of both parsers. Anything
structured (catalog columns, report bindings) lives in a JSON payload, never in frontmatter.

```yaml
---
# OKF (Open Knowledge Format)
kind: skill | catalog | report      # the discriminator (ArtifactType)
type: skill
title: "..."
description: "..."
timestamp: "2026-..."
buddy_id: <id>                       # optional — avatar/persona
resource: output_schema.json         # optional — when output is structured
# Governança (superset Balde)
status: rascunho | canonico | depreciado
owner: "owner@exemplo.com"
version: "0.1.0"
objetivo: "..."                      # primary definition — what it is FOR
escopo: "..."                        # what it does and does NOT do / when to refuse
model_tier: economico | ...
skill_kind: knowledge | revenuehub   # optional
output_shape: scalar | list | table | report   # `table` ⇒ output_schema.json required
output_format: text | structured
input_kind: range | text | none
formula_safe: true | false           # gates =Hub_Skill usage
max_tokens: 4096
temperature: 0
context_mode: inline | paged         # optional (default: auto by size)
allowed_tools: [ ... ]               # optional — curator-reviewed capability grant
data_catalogs: [ ... ]               # optional (dependency → catalog:<id>)
report_refs: [ ... ]                 # optional (dependency → report:<id>)
---
## Papel …
## Como responder …
## Regras inegociáveis …
```

### Payloads by `kind`
- **`kind: skill`** — body = system prompt; `output_schema.json` = JSON-Schema output contract
  (required for `output_shape: table`); `analytics/` + `query/` = context files.
- **`kind: catalog`** — adds `source`, `refresh_cadence`, `data_file`, `format`, `delimiter`,
  `decimal_separator`, `skill_compatible`; **`catalog.json`** carries the column schema
  (`columns[] { name, display_name, type∈text|number|date|boolean|percent|currency, format, … }`).
- **`kind: report`** — adds `template`, `output_mode`, `catalog_refs`; **`report.json`** carries
  `datasets[]` + `data_bindings[]` (the `columns` order is the contract with the template formulas);
  plus `template.xlsx`.

---

## 5. The governed-node ledger (`governance.json`, both neighborhoods)

```
creator (stamped on first touch; git-history fallback) · owner · curators
cadence: weekly|monthly|quarterly|yearly → status green|due-soon|overdue|never (+ dueAt)
cadenceLockedAt / cadenceLockedBy   → once the creator sets it, only admins change it
evalCriteria / evalStatus           → AI correctness eval (pass/fail)
approvals[] { at, by, action(review|cadence|eval|migrated), detail }   → the audit trail
```

Skills index all concepts in one file; commons keeps one per concept folder. The ledger lives in
git, so review history is auditable.

---

## 6. Linking (OKF, plain markdown)

`/x` = skill root · `./x` `../x` = relative · `/commons/<domain>/<concept>` (→ its `context.md`) ·
`/<other-skill>/x` or `/<other-skill>` (folder form, resolves to its SKILL.md) = cross-skill ·
`/@<repo>/commons/<id>` = cross-REPO (three-level namespace `repo/domain/artifact`; scope `xrepo`).
Cross-repo reads are membership-gated as the READER (reference ≠ grant) and never enter the
per-repo graph/backlink indexes. `SKILL.md` is the graph root (the OKF `index.md`). Broken links
are tolerated, not errors.

**Authoring (Criar wizard):** typing `[[` in the SKILL.md editor autocompletes commons concepts
(capsules) and inserts a plain `[label](/commons/<id>)` link; typing `[[[` autocompletes skills and
inserts a `[label](/<id>/SKILL.md)` link — the corpus stays plain markdown, no wiki-link syntax on
disk. The "+ cápsula" and "+ skill" buttons open the same pickers; per-file "↗ tornar commons"
(curators) extracts a context file into the commons and links it back in the SKILL.md. User fields
(owner/curators/readers) autocomplete from known users (`/api/users`), annotated with group memberships.

---

## 7. Consumption modes (inline vs paged)

Per skill, by size (or `context_mode` override): **inline** ships every context file in
`GET /api/v1/skills/{id}` (`context[]`); **paged** returns a manifest + the caller walks it. See §8.

---

## 8. Machine API + MCP tools — access & exploration by AI providers

External AI providers read the corpus over `/api/v1` (Bearer **personal token**, minted per user
from Authentik; fail-closed if no valid token; nginx `/api/v1/` carve-out bypasses forward-auth).
Everything is **canonical-only** — drafts are never exposed.

### REST endpoints
| Endpoint | Returns |
|---|---|
| `GET /api/v1/skills` | canonical skills (id, title, description, domain) |
| `GET /api/v1/skills/{id}` | one skill: OKF detail + evals + `contextMode`; `context[]` inline (small) **or** `contextManifest` + hint (big) |
| `GET /api/v1/skills/{id}/context` | the skill's OKF context graph — path·bytes·kind·summary·links·backlinks, no content |
| `GET /api/v1/skills/{id}/context/{path}` | one context file's full text + its outbound links |
| `GET /api/v1/commons` | shared commons concepts — path·summary·referencedBy·media counts |
| `GET /api/v1/commons/{path}` | one commons concept: `content` **incl. AI media descriptions** (become-context) + links |
| `GET /api/commons/img?path=&name=` | raw image bytes (rendering) — SSO or same session |

### MCP tools (`integrations/ai-tools`, all provider shapes from one `TOOL_DEFS`)
`balde_list_skills` · `balde_get_skill` · `balde_list_skill_context` · `balde_read_skill_context` ·
`balde_list_commons` · `balde_read_commons` · `balde_contribute_context` ·
`balde_capsule_spec` · `balde_compile_capsule` · `balde_submit_capsule` (import capsules: fetch the
`balde-capsule/1` spec → generate a manifest → compile until clean → submit; a curator's approval
applies it — see `demo-corpus/docs/capsula-spec.md`. REST twins: `GET /api/v1/capsule/spec`,
`POST /api/v1/capsule/compile`, `POST /api/v1/capsule/submit`).

### The exploration walk (progressive disclosure)
1. `balde_list_skills` → discover skills.
2. `balde_get_skill(id)` → load it (small = full inline; big = a manifest pointer).
3. `balde_list_skill_context(id)` → the OKF graph of a big skill.
4. `balde_read_skill_context(id, path)` → page in one file; **follow its `links`** to pull only the
   subgraph you need.
5. A `/commons/...` link → `balde_read_commons(path)` (or `GET /api/v1/commons/{path}`) → the shared
   concept, **media included as text**.
6. `balde_contribute_context(skill_id, …)` → feed new knowledge to the human-curation queue.

The in-app chat uses the same read model (its own tool loop), so a concept reads identically whether
consumed by the app or an external agent.
