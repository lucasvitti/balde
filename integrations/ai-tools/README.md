# Balde AI tools — make Balde a channel inside any AI assistant

Turns Balde's `/api/v1` machine API into LLM tools so an assistant (Claude tool-use, OpenAI
functions, an MCP client, or a ChatGPT GPT) can **browse the skills corpus, pull a skill's full
context, and contribute new context to the curation queue** — without opening the web app.

Zero dependencies. One shared core (`baldeClient.mjs`) drives every channel.

## The tools — pull knowledge, push contributions

**Pull (read the corpus):**

| Tool | Balde endpoint | What it does |
|---|---|---|
| `balde_list_skills` | `GET /api/v1/skills` | List the canonical skills the token can read (id, title, description, tags, version) |
| `balde_get_skill` | `GET /api/v1/skills/{id}` | One skill: objective/scope/evals + full **SKILL.md**; small skills inline `context[]`, big ones return a `contextManifest` to page |
| `balde_list_skill_context` | `GET /api/v1/skills/{id}/context` | **Manifest** (OKF graph) of a skill's context files — path, size, kind, summary, links/backlinks — no content |
| `balde_read_skill_context` | `GET /api/v1/skills/{id}/context/{path}` | Download **one** context file's full text on demand (walk the graph via its `links`) |
| `balde_list_commons` | `GET /api/v1/commons` | List shared **commons** concepts (schema dictionaries, glossaries) any skill can link |
| `balde_read_commons` | `GET /api/v1/commons/{path}` | One commons concept — `content` includes AI-described media (image descriptions + tables as markdown) |
| `balde_find_files` | `GET /api/v1/files?q=` | **Find downloadable attachments** (the `files/` sidecar: PDFs, spreadsheets, zips) on skills and capsules. These are deliberately NOT in the context index, so this is the only way to discover one without knowing its owner — each hit returns the exact path, a `url` (download with your key) and a `webUrl` (open in the browser via SSO) |

**Execute (governed queries — DuckDB sandbox):**

| Tool | Balde endpoint | What it does |
|---|---|---|
| `balde_run_query` | `GET /api/v1/skills/{id}/query-run` | **Execute** one of the skill's stored, git-versioned `.sql` files (never arbitrary SQL) in an ephemeral, locked DuckDB sandbox over its governed datasets; returns columns/rows + the tables loaded |
| `balde_inspect_dataset` | `GET /api/v1/skills/{id}/data-inspect` | Schema + row count + per-column **profile** of one skill dataset (`.csv`/`.parquet` under `analytics/` or `data/`) — no SQL required |

**Push (contribute):**

| Tool | Balde endpoint | What it does |
|---|---|---|
| `balde_contribute_context` | `POST /api/v1/queue` | Submit new context to a skill's **human-curation queue** — a curator reviews and merges it (never mutates a skill directly) |
| `balde_capsule_spec` | `GET /api/v1/capsule/spec` | The **balde-capsule/1** authoring spec (markdown) — read it BEFORE generating an import manifest |
| `balde_capsule_categories` | `GET /api/v1/capsule/categories` | The governed capsule **types** (`key`/`label`/`hint`; defaults: dado · reuniao · decisao · tarefas) — set `categoria` on every new concept, and **ask the end user when the material doesn't make the type clear** |
| `balde_compile_capsule` | `POST /api/v1/capsule/compile` | Validate a manifest against the corpus (writes nothing) — fix the machine-readable errors and repeat until `ok: true`; the report echoes the target balde |
| `balde_submit_capsule` | `POST /api/v1/capsule/submit` | Send the clean capsule to the **curation queue** — a curator's approval deploys it |

Reads respect the token owner's visibility: restricted skills/commons the owner can't see simply don't appear (or return 404).

## Make the assistant use it — say "Balde"

Tool calls are the assistant's decision, so give it a rule: **use these tools when you mention _Balde_.** Paste this into your assistant's instructions — a ChatGPT GPT's **Instructions** field, Claude's **project/system prompt**, or your API **system message**:

> You can reach **Balde**, a governed company knowledge base, through tools named `balde_*`. When the user **mentions Balde** — e.g. "ask Balde…", "check Balde for…", "what does Balde have on…", "add this to Balde" — use them: call `balde_list_skills` then `balde_get_skill` to pull the relevant skill; `balde_list_commons` / `balde_read_commons` for shared definitions; `balde_list_skill_context` / `balde_read_skill_context` to page a large skill's context graph; `balde_run_query` to EXECUTE a skill's stored `.sql` queries when the question needs real numbers (and `balde_inspect_dataset` to profile its datasets); and `balde_contribute_context` to push new knowledge or corrections to the curation queue (a human curator reviews it — it never edits a skill directly). Answer from what Balde returns and name the skill id you used. If the user does not mention Balde, answer normally.

That keeps Balde out of the way until you invoke it by name.

## Setup

- **Node 18+** (uses global `fetch`).
- **`BALDE_API_KEY`** — your **personal** Balde token (the "MCP key"). Mint one in Balde →
  **Configurações → API → Minhas chaves de API** ("Criar nova chave"; reveal it any time). It's tied
  to your account: revocable there, and it stops working the moment your account is deactivated.
- **`BALDE_BASE_URL`** — optional, defaults to `https://balde.example.com`. This picks the
  **deployment** (production vs a local/dev server) — the environment lives in the connection,
  never inside a manifest.
- **`BALDE_REPO`** — optional, the **balde (repo)** this connection works in; unset = the default
  balde (`corporate`). Every call is scoped to it (non-members get 404; list yours with
  `balde_list_repos`), and the capsule compile report echoes it (`repo` + the `balde: <name>`
  plan line) so imports land where you meant. A manifest may also pin `"repo": "<name>"` as an
  assertion — compile fails with `repo-divergente` on mismatch.

Quick check (read-only):

```bash
BALDE_API_KEY=<key> node examples/smoke.mjs
```

---

## Channel 1 — Claude (MCP server)

The MCP server appears natively in **Claude Desktop**, **Claude Code**, and **Claude.ai connectors**.

**Claude Desktop (recommended) — install the `.mcpb` bundle.** Current Desktop builds load
connectors as `.mcpb` extensions (not from `claude_desktop_config.json`). Double-click
`balde-knowledge-<version>.mcpb` (or drag it into Settings → Extensions); Desktop prompts for the
**Balde MCP key**, an optional **base URL**, and an optional **Balde (repo)**. The key is stored in
the OS secret vault — never in plain text.

Build a bundle with `mcpb/make-mcpb.mjs` (a `.mcpb` is just a ZIP: `manifest.json` + `server/`):

```bash
node integrations/ai-tools/mcpb/make-mcpb.mjs                     # generic — pick the balde in the config UI
node integrations/ai-tools/mcpb/make-mcpb.mjs --repo concorrencia # repo-scoped: a DISTINCT extension
                                                                  # (balde-knowledge-concorrencia) with the
                                                                  # balde baked as default → several coexist
```

Leaving **Balde (repo)** empty targets the default balde (`corporate`). Setting it (or baking it via
`--repo`) makes this connector work inside that balde — `balde_list_repos` shows what your token can
reach, and the capsule-compile report echoes the active balde. Because Desktop keys an extension by
its `name`, a repo-baked bundle installs alongside the corporate one, so you can connect several
baldes at once — the Desktop equivalent of the per-balde launchers the local app writes.

**Claude Desktop (alternative) — `claude_desktop_config.json`** (older builds / manual setups):

```json
{
  "mcpServers": {
    "balde-knowledge": {
      "command": "node",
      "args": ["/abs/path/to/balde/Hackaton/integrations/ai-tools/mcp-server.mjs"],
      "env": {
        "BALDE_BASE_URL": "https://balde.example.com",
        "BALDE_API_KEY": "<your personal token>",
        "BALDE_REPO": "<optional balde/repo; empty = corporate>"
      }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add balde-knowledge --env BALDE_API_KEY=<key> -- node /abs/path/to/integrations/ai-tools/mcp-server.mjs
```

The key lives in the MCP client's config/env — the assistant never sees it.

---

## Channel 2 — OpenAI (function calling)

```js
import OpenAI from 'openai';
import { openaiTools, executeTool } from './tools.mjs';

const openai = new OpenAI();
const messages = [{ role: 'user', content: 'What skills exist in Balde? Summarize the meeting-summary one.' }];

while (true) {
  const res = await openai.chat.completions.create({ model: 'gpt-4.1', messages, tools: openaiTools() });
  const msg = res.choices[0].message;
  messages.push(msg);
  if (!msg.tool_calls?.length) { console.log(msg.content); break; }
  for (const call of msg.tool_calls) {
    let out;
    try { out = await executeTool(call.function.name, JSON.parse(call.function.arguments || '{}')); }
    catch (e) { out = { error: e.message }; }
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out) });
  }
}
```

---

## Channel 3 — Anthropic Messages API (tool use)

```js
import Anthropic from '@anthropic-ai/sdk';
import { anthropicTools, executeTool } from './tools.mjs';

const client = new Anthropic();
let messages = [{ role: 'user', content: 'List Balde skills and load the meeting-summary skill.' }];

while (true) {
  const res = await client.messages.create({ model: 'claude-opus-5', max_tokens: 1024, tools: anthropicTools(), messages });
  messages.push({ role: 'assistant', content: res.content });
  if (res.stop_reason !== 'tool_use') {
    console.log(res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
    break;
  }
  const results = [];
  for (const block of res.content) {
    if (block.type !== 'tool_use') continue;
    let out, isError = false;
    try { out = await executeTool(block.name, block.input); }
    catch (e) { out = { error: e.message }; isError = true; }
    results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out), is_error: isError });
  }
  messages.push({ role: 'user', content: results });
}
```

---

## Channel 4 — ChatGPT (GPT Action)

In the GPT builder → **Actions**: paste [`openapi.json`](openapi.json), set **Authentication →
API Key → Bearer**, and enter the machine key. The GPT then calls Balde's `/api/v1` directly
(no code from this package runs — the OpenAPI *is* the integration).

---

## Security

All channels use **your personal Balde token**, held in the client's config/env — never sent to the
model. It's scoped by design: it can **read canonical skills** and **enqueue contributions**, but it
**cannot mutate a skill** — every contribution waits for a human curator to review and merge. It only
works while your account is **active** and a member of the **`Balde - Usuários`** group, and you can
revoke it any time in **Configurações → Minhas chaves de API**.

> The same personal token works for any consumer — MCP, a GPT Action, or the Excel/VSTO add-in
> (paste it in the add-in's settings). The old shared machine key has been **retired**: the API
> accepts personal Authentik tokens only.
