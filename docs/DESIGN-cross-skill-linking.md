# Design — Cross-skill concept linking + shared commons

Status: **SPEC (for review) — not built.** Chosen model: **links + commons (both)**. Author: design pass 2026-08-05.

## 1. Goal

Let a concept in one skill link a concept in another, and let cross-cutting concepts live once in a shared **commons** that any skill references. Turns the corpus from N isolated per-skill graphs into **one OKF knowledge graph**: single source of truth, no duplicated docs, discovery of central concepts, and cross-skill progressive disclosure.

Concretely it de-bloats the monoliths: a large SQL skill (`consultas-sql`) carries 60 docs (~686k tokens), many of them reusable (data dictionaries, base-table schemas). Move those to `commons/`, link them from each skill, and every skill shrinks to *its own* knowledge + references.

## 2. Model

- The **corpus is one OKF bundle**. Skills (`<skillId>/`) are neighborhoods; `commons/` is a corpus-level neighborhood of shared concepts.
- Links stay **plain markdown links** (OKF-native). A link resolves to a **corpus-relative path** `<skillId>/<rel>` or `commons/<rel>`, then is classified: *within-skill* / *cross-skill* / *commons* / *dangling* (tolerated per OKF).
- Nothing about a skill's internal graph changes; we widen the **node set** and the **resolver** to corpus scope.

## 3. Path semantics — THE decision (see §11 D1)

Today (deployed): `/x` = skill-root; `./x`, `../x` = relative to the linking file's dir, within the skill.

**Recommended: P1 "dual-base resolve"** — keep `/` meaning skill-root (back-compat), and *also* let a `/`-path fall back to corpus-root when it doesn't hit a within-skill node:

| Link in `skillA/references/a.md` | Resolves to | Kind |
|---|---|---|
| `./b.md` | `skillA/references/b.md` | within |
| `/analytics/x.md` | `skillA/analytics/x.md` (skill-root hit) | within |
| `/commons/glossario.md` | `commons/glossario.md` (no within hit → corpus-root) | commons |
| `/scan-base-pricing/analytics/y.md` | same (corpus-root) | cross-skill |
| `/nope/z.md` | unresolved | dangling |

Author rule of thumb: **`/commons/…` for shared, `/<otherSkill>/…` for cross-skill, everything else unchanged.** No breakage, OKF-native, no new syntax.

Alternatives (rejected for now): P2 = `/` always corpus-root (cleanest but breaks every existing within-skill `/…` link → migration); P3 = a prefix like `@skill/…` (unambiguous but not plain markdown → loses OKF portability).

## 4. Corpus layout

```
<corpus>/
  <skillId>/            SKILL.md + context files      (unchanged)
  commons/
    <concept>.md        an OKF concept: frontmatter type/title/owner/version + body
    <concept>/…         (may have its own subfiles)
    ACCESS.yml          commons ACL (default: readable by all authenticated)
    .git-tracked like skills; not itself a "skill" (no promotion lifecycle in v1)
```

`commons/` is git-versioned like the skills corpus. Env `COMMONS_ROOT` (default `<corpus>/commons`), bind-mounted on prod like the others.

## 5. Resolver + index changes (server.js)

- **`corpusNodeIndex()`** — a `Set` of every valid node path across all skills (`<skillId>/<rel>`) + commons (`commons/<rel>`) + each `<skillId>/SKILL.md`. Built by listing dirs (cheap `readdir`, no file reads); **cached with a short TTL / invalidated on any corpus write**. This is the new dependency the resolver needs.
- **`resolveContextLink(target, sourceSkillId, sourceRel)`** → returns a corpus-relative path using P1 (skill-root first, corpus-root fallback). Already climbs `./`/`../`; add the skill-id base + corpus fallback.
- **`extractContextLinks(content, sourceSkillId, sourceRel, corpusIndex)`** → each link classified `{ target, kind: within|cross|commons, targetSkill }`; in-index → resolved, else dangling.
- **`skillContextManifest`** gains, per file: `links` now include cross-skill/commons targets tagged `{path, targetSkill, scope}`; nodes for external targets are included as **stub nodes** (id + home skill + kind), not full content.

## 6. API

- `/api/v1/skills/{id}/context` + `/api/explore/context` — edges gain `scope` (within/cross/commons) + `targetSkill`; response gains a `commons` + `crossSkill` node list. Backward-compatible (additive).
- **Cross-skill backlinks** ("referenced by N other skills") need a corpus-wide link scan → **Phase X2** (heavier; a `corpusLinkIndex()`), not X1.
- New commons endpoints mirroring skills: `/api/commons` (list), `/api/commons/file`, `/api/v1/commons` + `/api/v1/commons/{path}` (machine, Bearer), all ACL-checked.

## 7. Access control

- Resolving a cross-skill/commons link is metadata (path + summary) — but **content fetch respects the target's ACL**. If the user/token can't read the target skill, the edge is shown as `restricted` (node present, summary hidden, not followable). Never leaks restricted content; mirrors the existing `canReadSkillActor` gate.
- commons ACL default = readable by all authenticated; curate via `commons/ACCESS.yml`.

## 8. Governance model — govern BOTH atoms and assemblies (LOCKED)

Decision (Vitti): **full governance on both concepts (atoms) AND skills (compositions).** Top-down-only lets a bad atom silently corrupt every skill that links it; bottom-up-only drifts + over-contexts. So both. Topology: govern the **points** and the **neighborhoods**.

**One primitive — a "governed node" — with the full path (a+b+c):**

| | Concept (atom) | Skill (composition) |
|---|---|---|
| **a. meta** | owner + curators + version + change-signal + git ledger | same |
| **b. cadence** | review policy `weekly\|monthly\|quarterly\|yearly` + **mandatory curator audit after stale (blocking)** | same |
| **c. evals** | **correctness** criteria (doc is true/consistent) → AI pass/fail | **behavioral** criteria (input → right/refuse) → AI pass/fail |
| **d. queue** | new context → review queue → curator decides | same |
| **e. chat feedback** | → curator decides | same |

Same shape, two eval *flavors* (correctness vs behavioral) — both "define criteria → AI verdict."

**Maintainability = inheritance + a simple curator eval panel (LOCKED):**
- **Inheritance/defaults:** a concept inherits its skill's owner, curators, and cadence unless it overrides them. `commons/` concepts (higher blast radius) more often declare their own owner + stricter cadence. So you set the *neighborhood's* defaults and override only the points that matter — no hand-authoring 60 policies.
- **AI-drafted eval criteria at ingest** (sibling of the A2 summary pass); curators approve.
- **Simple curator eval panel:** most atoms are static (e.g. queries) — a one-click **"keep green / OK"** satisfies the gate. Governance stays real without eval theater. Bulk-approve supported.

**Change / stale / delete ripple:**
- Referrers see **latest** + a **change-signal** (deprecation-style warning) when a linked concept changes or moves → the referring skill/concept is flagged "linked concept changed — re-review" in its governance view.
- **Stale (past cadence):** blocking "audit due" state — a curator must re-affirm (via the panel) to keep it green/servable.
- **Delete/rename:** referrers' links go dangling (OKF-tolerated) + a warning listing referrers (same pattern as buddy-delete `staleSkills`). Rename = move = a change-signal ripple.
- Version **pinning** deferred (non-OKF syntax; revisit if drift bites).

## 9. UI

- **Grafo:** cross-skill nodes badged with their home skill (distinct ring + `skillId/` label prefix); commons nodes get their own kind color; clicking a cross-skill node offers "abrir na skill X". A corpus-wide graph view = X2.
- **Explorer/nav:** a **"Commons"** section (like Documentação) to browse/edit shared concepts.
- **Wizard/editor:** a "linkar concept" affordance (pick a commons or another skill's file → inserts the markdown link); shows resolved vs dangling as you type.

## 10. Phasing — governance ships WITH commons (LOCKED)

Principle (Vitti): **always ship governance** — do NOT deploy the commons/linking without its governance. So Deploy Unit 1 below ships as one governance-complete increment (built + verified in slices, deployed together).

**Deploy Unit 1 — "commons + governance" (build now, deploy together):**
- **S1 foundation:** `corpusNodeIndex` (cached) + dual-base resolver + `commons/` area + commons endpoints; cross-skill/commons links resolve (no false danglings); manifest tags edges by scope; ACL on fetch; Grafo badges cross-skill/commons nodes; **user-defined context paths** in wizard/editor (path = concept id = link target).
- **S2 concept units:** context files become **governed nodes** — level-**a** meta (owner/curators/version/change-signal), **inheriting** the skill's defaults unless overridden.
- **S3 cadence (G1):** per-unit review policy (wk/mo/qtr/yr) + **mandatory audit gate** after stale, uniform across concepts + skills (generalizes today's fixed freshness).
- **S4 concept evals (G2):** correctness criteria + AI pass/fail; AI-drafts criteria at ingest, curator approves.
- **S5 curator eval panel:** one-click "keep green / OK" + bulk-approve; surfaces change-signal + audit-due.

**Later (separate deploys):**
- **X2 — corpus-wide graph + backlinks:** `corpusLinkIndex` → "referenced by N skills", a corpus-level Grafo.
- **X4 — cross-skill paging in chat:** the Phase-C chat tool loop follows cross-skill/commons links.
- **D4 migration:** AI-assisted extraction of `consultas-sql`'s reusable docs into `commons/` (originals reuploadable → safe to be bold).

## 11. Decisions — LOCKED (Vitti, 2026-08-05)

- **D1 — path semantics: P1 dual-base** (keep `/`=skill-root, fall back to corpus-root) **+ user-defined context paths** — users name/shelve their own paths ("shelf" = skill, "books" = context files); the path is the concept id + link target. Rename/move → change-signal ripple (D2).
- **D2 — change model: latest + change-signal** (deprecation-style warning to referrers on change/move). No version pinning (deferred).
- **D3 — full governance on BOTH concepts and skills** (supersedes the plain-dir/meta-skill choice — it's "both fully governed, made maintainable"): unified governed-node model in §8, with **inheritance** (concept inherits skill defaults) + a **simple curator eval panel** (one-click keep-green for static atoms). Governance always ships with commons (§10).
- **D4 — AI-assisted migration** of `consultas-sql`'s reusable docs into `commons/`; originals reuploadable (safe to be bold). Scheduled as a later deploy, after Unit 1.

## 12. Risks

- Corpus-wide resolution needs the node index kept fresh (invalidate on write; TTL fallback).
- Backlink scan is O(corpus) — keep it to X2 + cache.
- Governance drift if change-signal is ignored — the flag must be visible in the owner's governance view.
- Graph can get large — corpus-level Grafo needs clustering/filtering (X2).
