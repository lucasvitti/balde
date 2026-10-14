# Balde de conhecimento

**A governed knowledge base for AI teams** — skills, atomic knowledge capsules, human curation
gates, a knowledge graph, executable queries and AI-assisted ingestion, served by a single
**zero-dependency Node.js server** over a **plain-file corpus versioned with git**.

Balde ("bucket", in Portuguese) treats knowledge as a product: every artifact has an owner,
curators, a review cadence, a freshness state and an approval ledger. AI assistants consume the
corpus through a machine API and **MCP tools** — and everything they read went through a human gate.

> The UI is Portuguese-first (pt-BR). The corpus format is plain markdown + JSON — readable
> with or without Balde.

## Concepts

| Concept | What it is |
|---|---|
| **Skill** | A governed knowledge module (OKF-style): `SKILL.md` spine + context files + eval cases + governance. |
| **Cápsula** | An **atomic** shared concept (`commons/<domain>/<concept>`) — self-contained by rule (no outbound links), the ideal retrieval unit. Skills link capsules; capsules never link out. |
| **Balde (repo)** | The namespace's outer level — `repo/domain/artifact`, Unity-Catalog style. Independent partitions (a corporate corpus, personal spaces) with their own git ledgers, membership (groups/e-mails) and governance profile. Cross-repo references are explicit (`/@repo/...`) and membership-gated: *reference ≠ grant*. |
| **Fila** | The curation queue: contributions, capsule import manifests and AI-ingested candidates land here; a curator's approval applies them to the corpus. |
| **Selo / frescor** | Quality seal (gated evaluation with human acceptance) and freshness state driven by review cadences. |

## Features

- **Corpus explorer** with per-artifact governance, evals, feedback, file graph and timeline (temporal capsule *séries*).
- **Mapa de conhecimento** — an Obsidian-style corpus graph (Cytoscape): communities, hulls, per-user styles; solid = skill→capsule, dashed = skill→skill, dotted = cross-repo.
- **Executable knowledge (DuckDB)** — versioned `.sql` files run in an ephemeral, locked-down DuckDB sandbox over the skill's governed datasets (csv/parquet), never arbitrary model SQL.
- **Raw-knowledge ingestion** — upload documents (pdf/docx/xlsx/md/csv...), an AI pass extracts **atomic capsule candidates** (with optional user guidance), duplicates are flagged, and selected candidates materialize through the Fila.
- **Duplicate detection as governance** — a zero-token lexical similarity tier on creation, promotion, curation and an admin corpus-wide scan (AI tiers can sit on top of the shortlist).
- **Chat with grounding** — BYO AI key (OpenAI / Anthropic / any OpenAI-compatible endpoint); skills ground conversations with linked capsules inlined (series-aware), a paged tool loop for large skills and a governed `run_query` tool.
- **MCP + machine API** — 13 `balde_*` tools (list/read skills and capsules, run governed queries, compile/submit capsule manifests, contribute to the queue) from one tool-definition source serving MCP, Anthropic and OpenAI shapes, plus a Bearer-gated `/api/v1` with an OpenAPI spec for GPT Actions.

## Architecture principles

1. **Corpus = files.** Markdown + JSON on disk. Remove Balde and a valid, readable knowledge
   base remains.
2. **Git = ledger.** Every write commits, authored by the acting user. Each balde carries its
   own `skills/` + `commons/` git repositories.
3. **Zero runtime npm dependencies.** One `server.js` + ES modules. Heavy lifting uses
   **system tools**: `git`, `duckdb`, `pdftotext` (poppler).
4. **Humans gate writes.** AI proposes — extraction candidates, capsule manifests, merge
   suggestions; curators approve; approvals are ledger entries.
5. **Server-side AI.** Keys are per-user, encrypted at rest (`BALDE_SECRET_KEY`); prompts are
   assembled server-side against ACL-filtered context.

## Quickstart

Needs **Node 24+** and `git` on the PATH (`duckdb` and `pdftotext` are optional: governed queries
and PDF ingestion).

```bash
cp -r demo-corpus /tmp/balde-demo     # Balde writes into its corpus, so run it on a copy
export CORPUS_ROOT=/tmp/balde-demo
export BALDE_LOCAL_EMAIL=you@example.com BALDE_LOCAL_NAME="You"
export BALDE_WEB_SESSION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "Open http://127.0.0.1:5173/#session=$BALDE_WEB_SESSION_KEY"
node server.js
```

Open the printed address: the page trades the key in the URL for a session cookie; a plain
`http://127.0.0.1:5173` stays empty (its API calls get 401) until it has one. The server listens on 127.0.0.1
only, and the identity is whoever starts it (`BALDE_LOCAL_*`): request headers never name
anyone. Its data (git ledgers, logs, usage) stays inside `CORPUS_ROOT`.

For development, `npm ci` installs the pinned dev tools (ESLint, Prettier); then `npm test`,
`npm run check` and `npm run format:check`.

> `Dockerfile`, `docker-compose.yml` and [deploy/](deploy/) (nginx + Authentik forward-auth)
> are the setup of the earlier hosted 1.x line. The 2.x runtime listens on 127.0.0.1 only and
> drops proxy identity headers, so it does not run behind them as they are.

## Configuration (main variables)

| Variable | Purpose |
|---|---|
| `CORPUS_ROOT` | The corpus folder: `repos/<balde>/{skills,commons}` + global roots (users, prompts, docs, logs, usage...). Defaults to `./demo-corpus`. Legacy flat layouts migrate automatically at boot. |
| `BALDE_LOCAL_EMAIL` / `BALDE_LOCAL_NAME` / `BALDE_LOCAL_GROUPS` | Who runs this server. Groups grant roles (`Balde - Admins` by default for admins). The older `DEV_FAKE_*` names still work. |
| `BALDE_WEB_SESSION_KEY` | The key the page trades for its session cookie (`/#session=<key>`). Without it the server falls back to a legacy session mode kept for older desktop apps. |
| `PORT` | Port on 127.0.0.1 (default 5173). |
| `API_KEY` | Comma-separated machine keys that `/api/v1` and the MCP tools accept as Bearer tokens. |
| `BALDE_READONLY_CORPUS` | `1` makes the corpus read-only for this server; contributions go through the Fila. |
| `QUEUE_ROOT` / `EXCHANGE_ROOT` / `GIT_LEDGER_ROOT` | Where the Fila, the outboxes and the git ledger live when the corpus sits in a synced shared folder. |
| `BALDE_SECRET_KEY` | 32-byte base64 master key that encrypts per-user AI keys at rest. |
| `AI_MODE` | How the server reaches an AI model (for example `none`, or `cli` for a local Claude Code). |
| `BALDE_ORG_NAME` | Deployment identity: shown in the top bar and used in the chat persona. |
| `ADMIN_GROUP` / `CURATOR_GROUP` / `API_GROUP` | Group names gating admin, curation and machine-API access. |
| `DUCKDB_BIN` / `PDFTOTEXT_BIN` | Paths to the optional tools. |

## Connecting AI assistants

`integrations/ai-tools/` ships the MCP server (`balde-knowledge`; build a `.mcpb` for Claude
Desktop with `mcpb/make-mcpb.mjs`), an OpenAPI spec for GPT Actions and a zero-dep client. Set
`BALDE_BASE_URL` to your server and `BALDE_API_KEY` to one of the server's `API_KEY` keys; scope
calls to a balde with `BALDE_REPO`. Details in
[demo-corpus/docs/conectar-chatgpt-claude.md](demo-corpus/docs/conectar-chatgpt-claude.md).

## Status

Actively developed. Runs in production for a revenue-management team at a large payments
company (their corpus and branding live in deployment config — this repository contains only
the product and a synthetic demo corpus).

## License

[Apache-2.0](LICENSE) — © 2026 Lucas Vitti.
