// Zero-dependency client for Balde's /api/v1 machine API (Bearer-gated).
// Config via env: BALDE_BASE_URL (optional, defaults to prod) + BALDE_API_KEY (required).
// Node 18+ (uses global fetch). No npm dependencies (only node builtins) — mirrors the server's ethos.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Re-read the CURRENT machine key from the local launcher (%LOCALAPPDATA%\Balde\balde-mcp.cmd),
// which the local app keeps up to date. Returns true if it found a key different from the one in
// the env. Used to self-heal a 401 after the app rotates its machine key: a long-lived connector
// caches the key at startup, so a rotation would otherwise strand it until a manual reconnect. Local
// only — no launcher (a remote connection) → returns false and the env key stands.
function resourceLocalKey() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return false;
  let cmd = '';
  try { cmd = readFileSync(join(localAppData, 'Balde', 'balde-mcp.cmd'), 'utf8'); } catch { return false; }
  const fresh = (cmd.match(/set "BALDE_API_KEY=([^"]*)"/) || [])[1] || '';
  if (fresh && fresh !== (process.env.BALDE_API_KEY || '').trim()) { process.env.BALDE_API_KEY = fresh; return true; }
  return false;
}

function baseUrl() {
  const url = (process.env.BALDE_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!url) {
    throw new Error('BALDE_BASE_URL is not set — point it at your Balde server (e.g. https://balde.example.com or http://localhost:8098).');
  }
  return url;
}

function apiKey() {
  const key = (process.env.BALDE_API_KEY || '').trim();
  if (!key) {
    throw new Error('BALDE_API_KEY is not set — paste your personal Balde token (the "MCP key"). Mint one in Balde → Configurações → API → Minhas chaves de API ("Criar nova chave", reveal it any time).');
  }
  return key;
}

async function baldeFetch(path, { method = 'GET', body } = {}) {
  const url = `${baseUrl()}${path}`;
  // Optional repo scoping (three-level namespace): set BALDE_REPO to work inside one repo
  // (balde). Unset = the default "corporate" repo. Non-members get an honest 404.
  const repo = (process.env.BALDE_REPO || '').trim().toLowerCase();
  // Built fresh each attempt so a re-sourced key (after a 401) is picked up.
  const build = () => ({
    method,
    headers: {
      authorization: `Bearer ${apiKey()}`,
      accept: 'application/json',
      ...(repo ? { 'x-balde-repo': repo } : {}),
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const send = async () => {
    // Connection-level failures ("fetch failed") happen when a pooled keep-alive socket is dead —
    // typically after the local Balde app auto-updated and relaunched, killing the server this
    // long-lived MCP process was talking to. The request never reached the server, so retrying is
    // safe: undici opens a fresh connection, riding out the relaunch window instead of an error the
    // user must chase with a client restart.
    let res; let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { res = await fetch(url, build()); lastErr = null; break; }
      catch (error) { lastErr = error; if (attempt < 2) await new Promise((r) => setTimeout(r, 250 * (attempt + 1))); }
    }
    if (lastErr) throw new Error(`Network error calling Balde (${method} ${path}): ${lastErr.message}`);
    return res;
  };
  let res = await send();
  // 401 self-heal: the local app may have rotated its machine key since this connector started, so
  // the cached key is stale. Re-source the current key from the launcher and retry once — a rotation
  // becomes invisible instead of stranding the connector on 401 until a manual reconnect.
  if (res.status === 401 && resourceLocalKey()) res = await send();
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Balde rejected the token (401). Check BALDE_API_KEY — it must be an active personal token (Minhas chaves de API) whose account is in the "Balde - Usuários" group. The machine API is fail-closed.');
    }
    const detail = data && (data.error || data.hint) ? `: ${data.error || data.hint}` : '';
    throw new Error(`Balde API ${res.status}${detail}`);
  }
  return data;
}

// GET /api/v1/repos — the repos (baldes) this token's owner can read.
export async function listRepos() {
  const data = await baldeFetch('/api/v1/repos');
  return data.repos || [];
}

// GET /api/v1/skills — canonical skills only (OKF summaries).
export async function listSkills() {
  const data = await baldeFetch('/api/v1/skills');
  return Array.isArray(data.skills) ? data.skills : [];
}

// GET /api/v1/skills/{id} — one canonical skill: OKF detail + evals + full SKILL.md.
export async function getSkill(skillId) {
  const id = String(skillId || '').trim();
  if (!id) throw new Error('skill_id is required.');
  return baldeFetch(`/api/v1/skills/${encodeURIComponent(id)}`);
}

// GET /api/v1/skills/{id}/context — manifest of the skill's context files (path/bytes/kind/summary),
// WITHOUT their content. Use for big skills to see what's available before fetching.
export async function getSkillContext(skillId) {
  const id = String(skillId || '').trim();
  if (!id) throw new Error('skill_id is required.');
  return baldeFetch(`/api/v1/skills/${encodeURIComponent(id)}/context`);
}

// GET /api/v1/skills/{id}/context/{path} — one context file's full text (page in on demand).
export async function readSkillContextFile(skillId, path) {
  const id = String(skillId || '').trim();
  if (!id) throw new Error('skill_id is required.');
  const rel = String(path || '').trim();
  if (!rel) throw new Error('path is required.');
  // Encode each segment but keep the slashes so the server path matches.
  const encoded = rel.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return baldeFetch(`/api/v1/skills/${encodeURIComponent(id)}/context/${encoded}`);
}

// GET /api/v1/files?q= — SEARCH downloadable attachments (the files/ sidecar: PDFs, planilhas,
// zips) across skills AND capsules. These files are deliberately NOT in the context index, so
// this is how you find one without knowing which skill/capsule owns it. Same engine + ACL as
// the in-app chat buddy. Each hit: { path, name, size, kind, id, url, webUrl } — `url` downloads
// with this API key, `webUrl` is the SSO link a human can open in a browser.
export async function findFiles(query, limit) {
  const q = String(query || '').trim();
  if (!q) throw new Error('query is required.');
  const lim = Number(limit) > 0 ? `&limit=${encodeURIComponent(Number(limit))}` : '';
  return baldeFetch(`/api/v1/files?q=${encodeURIComponent(q)}${lim}`);
}

// GET /api/v1/search — rank skills + capsules against a free-text query (lexical term
// vectors + cosine; no embeddings, no vector DB). Returns hits the key is allowed to read.
export async function searchCorpus(query, { limit, kind } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('query is required.');
  const lim = Number(limit) > 0 ? `&limit=${encodeURIComponent(Number(limit))}` : '';
  const k = kind === 'skill' || kind === 'capsule' ? `&kind=${kind}` : '';
  return baldeFetch(`/api/v1/search?q=${encodeURIComponent(q)}${lim}${k}`);
}

// GET /api/v1/commons — shared commons concepts (path/summary/referencedBy/media), no content.
export async function listCommons() {
  const data = await baldeFetch('/api/v1/commons');
  return Array.isArray(data.commons) ? data.commons : [];
}

// GET /api/v1/commons/{path} — one commons concept. `content` INCLUDES its AI-described media
// (image descriptions + tables as markdown); `media.files[]` lists downloadable attachments as
// { name, size, url }. Accepts "x/y" or a "/commons/x/y" link target.
export async function readCommonsConcept(path) {
  const rel = String(path || '').trim().replace(/^\/?commons\//, '');
  if (!rel) throw new Error('path is required.');
  const encoded = rel.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return baldeFetch(`/api/v1/commons/${encoded}`);
}

// POST /api/v1/commons/{path}/files — attach ONE file-asset (PDF, zip, .docx/.xlsx, …) to a
// commons capsule. Requires MANAGE (curator/admin) on the capsule. `base64` is the file's raw
// bytes base64-encoded; max 20 MB. Returns { ok, name, size, url } (url = the v1 download route).
export async function uploadCommonsFileAsset({ path, name, base64 } = {}) {
  const rel = String(path || '').trim().replace(/^\/?commons\//, '');
  if (!rel) throw new Error('path is required.');
  const fileName = String(name || '').trim();
  if (!fileName) throw new Error('name is required.');
  if (!base64) throw new Error('base64 content is required.');
  const encoded = rel.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return baldeFetch(`/api/v1/commons/${encoded}/files`, { method: 'POST', body: { name: fileName, base64: String(base64) } });
}

// POST /api/v1/skills/{id}/files — attach ONE file-asset (PDF, zip, .docx/.xlsx, …) to a skill's
// files/ sidecar. Twin of uploadCommonsFileAsset. Requires MANAGE (curator/admin) on the skill.
// `base64` is the file's raw bytes base64-encoded; max 20 MB. Returns { ok, name, size, url }
// (url = the v1 download route). A multi-level skill id (<domain>/<slug>) is encoded per segment.
export async function uploadSkillFileAsset({ id, name, base64 } = {}) {
  const skillId = String(id || '').trim().replace(/^\/+|\/+$/g, '');
  if (!skillId) throw new Error('id is required.');
  const fileName = String(name || '').trim();
  if (!fileName) throw new Error('name is required.');
  if (!base64) throw new Error('base64 content is required.');
  const encoded = skillId.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return baldeFetch(`/api/v1/skills/${encoded}/files`, { method: 'POST', body: { name: fileName, base64: String(base64) } });
}

// GET /api/v1/skills/{id}/query-run?path= — execute ONE stored, git-versioned .sql file of the
// skill in an ephemeral, locked DuckDB sandbox over its governed datasets (analytics/ + data/
// + linked capsules' data/, each loaded as a table named by the file stem). Never arbitrary SQL:
// only query files that live in the skill run. The last SELECT in the file is the result.
export async function runSkillQuery(skillId, path) {
  const id = String(skillId || '').trim().replace(/^\/+|\/+$/g, '');
  if (!id) throw new Error('skill_id is required.');
  const rel = String(path || '').trim();
  if (!rel) throw new Error('path is required.');
  const encoded = id.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return baldeFetch(`/api/v1/skills/${encoded}/query-run?path=${encodeURIComponent(rel)}`);
}

// GET /api/v1/skills/{id}/data-inspect?path= — schema, row count and a per-column profile
// (nulls, distincts, min/max) of ONE governed dataset (.csv/.parquet) of the skill, without
// writing any SQL. Same DuckDB sandbox guarantees as runSkillQuery.
export async function inspectSkillDataset(skillId, path) {
  const id = String(skillId || '').trim().replace(/^\/+|\/+$/g, '');
  if (!id) throw new Error('skill_id is required.');
  const rel = String(path || '').trim();
  if (!rel) throw new Error('path is required.');
  const encoded = id.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return baldeFetch(`/api/v1/skills/${encoded}/data-inspect?path=${encodeURIComponent(rel)}`);
}

// POST /api/v1/queue — submit new context to the human-curation queue for an existing skill.
export async function contributeContext({ skillId, content, title, tags } = {}) {
  const id = String(skillId || '').trim();
  if (!id) throw new Error('skill_id is required.');
  const bodyText = String(content || '').trim();
  if (!bodyText) throw new Error('content is required.');
  const payload = { skill: id, content: bodyText };
  if (title) payload.title = String(title);
  if (Array.isArray(tags) && tags.length) {
    payload.tags = tags.map(String);
  } else if (typeof tags === 'string' && tags.trim()) {
    payload.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
  }
  return baldeFetch('/api/v1/queue', { method: 'POST', body: payload });
}

// GET /api/v1/capsule/spec — the balde-capsule/1 authoring spec as raw markdown. Feed it to the
// model BEFORE generating a manifest (the server returns text; baldeFetch wraps it as { raw }).
export async function capsuleSpec() {
  const data = await baldeFetch('/api/v1/capsule/spec');
  return { spec: typeof data === 'string' ? data : (data.raw || JSON.stringify(data)) };
}

// GET /api/v1/capsule/categories — the governed capsule-category vocabulary (types) of the
// active balde: [{ key, label, hint }] + the default key. Pick each new concept's "categoria"
// from here BEFORE compiling; when the material doesn't clearly match one, ask the end user.
export async function listCapsuleCategories() {
  return baldeFetch('/api/v1/capsule/categories');
}

// POST /api/v1/capsule/compile — stateless validation of a capsule manifest. NEVER writes.
// Returns { ok, repo, errors[], warnings[], plan[] } — `repo` + the first plan line echo the
// target balde (BALDE_REPO env; unset = default). Feed errors back to the model and retry.
export async function compileCapsule(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest (object) is required.');
  return baldeFetch('/api/v1/capsule/compile', { method: 'POST', body: manifest });
}

// POST /api/v1/capsule/submit — compile + enqueue ONE curation item; a human curator's approval
// applies it to the corpus. Returns { ok, submitted, queueId, plan, warnings } (or the compile
// report with ok:false when the manifest doesn't compile).
export async function submitCapsule(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest (object) is required.');
  return baldeFetch('/api/v1/capsule/submit', { method: 'POST', body: manifest });
}

export function baldeBaseUrl() { return baseUrl(); }
