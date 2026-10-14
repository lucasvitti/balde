// Shared configuration: roots, cross-cutting constants, and the local .env load.
// Extracted from server.js (modularization stage 2). Imported by server.js and the
// domain modules. Mutable singletons (apiKeys, caches) intentionally stay in server.js
// — an imported binding can't be reassigned by the importer.
import { basename, dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { loadLocalEnv } from '../scripts/env-loader.mjs';

// This module lives in <root>/src/, so climb one level for the project root.
export const rootDir = fileURLToPath(new URL('..', import.meta.url));
await loadLocalEnv(rootDir);
export const publicDir = join(rootDir, 'public');
const portArgIndex = process.argv.indexOf('--port');
export const port = Number(portArgIndex >= 0 ? process.argv[portArgIndex + 1] : process.env.PORT || 5173);
// App version shown in the UI (tab title + under the logo). A local install runs from
// releases/<version>/, so the release dir name IS the version; on the VPS/dev there is no release
// dir, so fall back to BALDE_VERSION or package.json. Dependency-free, computed once.
export const baldeVersion = (() => {
  if (process.env.BALDE_VERSION && process.env.BALDE_VERSION.trim()) return process.env.BALDE_VERSION.trim();
  const base = rootDir
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop();
  if (/^\d+\.\d+\.\d+/.test(base)) return base;
  try {
    return JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).version || 'dev';
  } catch {
    return 'dev';
  }
})();
// Three-level namespace: repo / domain / artifact (Unity-Catalog style).
// CORPUS_ROOT is the single mount: it holds repos/<repo>/{skills,commons} (each pair its own
// git ledger) plus the GLOBAL roots (users, queue, usage, ...). Individual *_ROOT envs remain
// as explicit overrides (dev harness). R1 runs single-repo: everything resolves in DEFAULT_REPO;
// multi-repo context arrives in R2. Legacy layouts (skills/ at the corpus root) are migrated
// at boot by ensureRepoLayout() — see src/repos.mjs.
export const corpusRoot = process.env.CORPUS_ROOT || join(rootDir, 'demo-corpus');
export const reposRoot = join(corpusRoot, 'repos');
export const DEFAULT_REPO = 'corporate';
// Repo folders. A balde can live in ANY folder the user mounted or created (local version), not
// only under <corpus>/repos. src/repos.mjs fills this synchronous name -> folder map when it loads
// the registry, so the path helpers below stay synchronous for their hundreds of call sites. A repo
// absent from the map lives at the fixed shared layout <corpus>/repos/<name> (VPS, shared corpus).
export const repoDirs = new Map();
// Baldes living OUTSIDE the shared corpus (user-mounted or user-created folders). Their Fila is a
// queue/ folder inside the balde itself, shared by whoever mounts it, never the corporate exchange.
export const localRepos = new Set();
export const repoDirOf = (repo = DEFAULT_REPO) => repoDirs.get(String(repo)) || join(reposRoot, String(repo));
export const repoSkillsRoot = (repo = DEFAULT_REPO) => join(repoDirOf(repo), 'skills');
export const repoCommonsRoot = (repo = DEFAULT_REPO) => join(repoDirOf(repo), 'commons');
// Per-USER Balde config (local version): %APPDATA%\Balde\settings.json (Roaming), so user-level
// settings, starting with the list of mounted baldes, follow the user rather than the machine.
// Machine-local state (binaries, releases, runtime cache, git ledger, keys) stays in
// %LOCALAPPDATA%\Balde. Active only under the balde-local shell (or an explicit
// BALDE_USER_CONFIG for dev/tests); the VPS has no user config and no mounts.
export const userConfigPath =
  process.env.BALDE_USER_CONFIG ||
  (process.env.BALDE_SHELL_EXE && process.env.APPDATA ? join(process.env.APPDATA, 'Balde', 'settings.json') : null);
// R2: the ACTIVE repo is request-scoped (AsyncLocalStorage). Every request handler runs
// inside runWithRepo(<resolved repo>, ...); background jobs iterate repos explicitly.
// Outside any context (boot, legacy paths) the default repo applies — R1 behavior.
const repoAls = new AsyncLocalStorage();
export function activeRepo() {
  return repoAls.getStore() || DEFAULT_REPO;
}
export function runWithRepo(repo, fn) {
  return repoAls.run(String(repo || DEFAULT_REPO), fn);
}
// skills/commons are PER-REPO roots — functions of the active repo (env overrides pin them
// for dev harnesses). Call sites use skillsRoot()/commonsRoot(); never cache across requests.
export const skillsRoot = () => process.env.SKILLS_ROOT || repoSkillsRoot(activeRepo());
// Deployment LOCAL (papel usuário): o corpus mora num share do SharePoint SOMENTE-LEITURA
// (BALDE_READONLY_CORPUS=1). Artefatos de RUNTIME que o servidor GRAVA — logs/feedback,
// telemetria de uso, plenárias — não podem cair no corpus (EPERM). Sem override explícito de
// *_ROOT, caem numa base LOCAL gravável (%LOCALAPPDATA%\Balde\runtime). No VPS (corpus
// gravável) localRuntimeBase é null e tudo continua em corpusRoot — nada muda.
const localRuntimeBase =
  process.env.BALDE_READONLY_CORPUS === '1'
    ? join(process.env.LOCALAPPDATA || process.env.TMPDIR || rootDir, 'Balde', 'runtime')
    : null;
const runtimeRoot = (name, corpusDefault) => (localRuntimeBase ? join(localRuntimeBase, name) : corpusDefault);
export const logsRoot = process.env.LOGS_ROOT || runtimeRoot('logs', join(corpusRoot, 'logs'));
export const feedbackRoot = join(logsRoot, 'feedback');
export const encryptedOpenAiKeyPath =
  process.env.OPENAI_API_KEY_ENC_PATH || join(rootDir, 'secrets', 'openai_api_key.enc.json');
export const governanceOutputRoot = () => process.env.GOVERNANCE_OUTPUT_ROOT || skillsRoot();
// Buddies (avatars): a git-versioned corpus parallel to skills. GLOBAL (not per-repo).
export const buddiesRoot = process.env.BUDDIES_ROOT || join(corpusRoot, 'buddies');
// Per-user profiles (BYO AI provider + key). NOT git-tracked — holds secrets
// encrypted at rest via BALDE_SECRET_KEY. Each user keyed by SSO identity.
export const usersRoot = process.env.USERS_ROOT || join(corpusRoot, 'users');
// Plenárias: SHARED (not per-user) multi-participant conversations. One <id>.json
// per room, gated by a join key + membership. Live conversation data — NOT
// git-tracked; on prod it's a host volume so redeploys don't wipe it.
export const plenariasRoot = process.env.PLENARIAS_ROOT || runtimeRoot('plenarias', join(corpusRoot, 'plenarias'));
// Skill contribution queue: new context lands here to be AI-preprocessed and
// curated by a human before being merged into a skill.
// PER-REPO desde 2026-09: cada balde tem a sua fila (repos/<repo>/queue) — com muitos baldes
// pessoais, uma pasta única stampada vira bagunça. O caminho legado (corpus/queue) é migrado
// no boot (server.js migrateLegacyQueueAndPolicy) usando o stamp `repo` de cada item.
// Since 2026-10 the Fila lives in the balde's own folder (<balde>/queue) on every deployment, the
// local version included, so a balde's curators read it from any machine. QUEUE_ROOT keeps two
// balde-local meanings: on a read-only user install it is the user's OUTBOX (exchange/<user>/queue),
// where a contribution to a shared balde waits until an app with edit rights on the balde moves it
// into the balde's Fila; on the admin install it names the old central Fila (admin/queue), whose
// items move into their baldes at boot. Anywhere else (dev harness) it is still the Fila itself.
export const outboxRoot =
  process.env.BALDE_READONLY_CORPUS === '1' && process.env.QUEUE_ROOT ? process.env.QUEUE_ROOT : null;
export const legacyCentralQueueRoot =
  !outboxRoot && process.env.EXCHANGE_ROOT && process.env.QUEUE_ROOT ? process.env.QUEUE_ROOT : null;
export const queueRoot = () => {
  const repo = activeRepo();
  if (localRepos.has(repo) || outboxRoot || legacyCentralQueueRoot) return join(repoDirOf(repo), 'queue');
  return process.env.QUEUE_ROOT || join(repoDirOf(repo), 'queue');
};
// Every user's outbox (exchange/<user>/queue): the admin install names it; a user install derives it
// from its own outbox.
export const exchangeRoot =
  process.env.EXCHANGE_ROOT || (outboxRoot && basename(outboxRoot) === 'queue' ? dirname(dirname(outboxRoot)) : '');
// Chat feedback (bom/fraco/errado) is curation material. On the local version it lives in the
// balde's folder (<balde>/feedback/), next to its Fila, where the balde's curators read it from any
// machine; a contributor who cannot write the balde leaves each event in their outbox area
// (exchange/<user>/feedback/). The VPS keeps the instance log (feedbackRoot).
export const baldeFeedback = Boolean(process.env.BALDE_SHELL_EXE || outboxRoot || legacyCentralQueueRoot);
export const feedbackDirOf = (repo = DEFAULT_REPO) => join(repoDirOf(repo), 'feedback');
export const outboxFeedbackRoot = outboxRoot ? join(dirname(outboxRoot), 'feedback') : null;
export const legacyQueueRoot = join(corpusRoot, 'queue');
// Usage telemetry: append-only JSONL event stream (usage/YYYY-MM.jsonl) + a small
// rollup.json cache. Runtime data (who called which API + per-skill events), NOT
// git-tracked; a host volume on prod so redeploys don't wipe the history.
export const usageRoot = process.env.USAGE_ROOT || runtimeRoot('usage', join(corpusRoot, 'usage'));
// Graph snapshot = cache RECONSTRUÍVEL (derivado do corpus). NUNCA pode cair no corpus sincronizado
// (OneDrive): ele é reescrito a cada mudança do corpus e o OneDrive gera uma CÓPIA DE CONFLITO por
// reescrita (centenas de arquivos mortos + erro "somente leitura"). Sob o shell balde-local
// (BALDE_SHELL_EXE, setado nos DOIS papéis — admin não usa BALDE_READONLY_CORPUS pois ele BLOQUEIA
// escrita no corpus) o cache vai LOCAL; no VPS/dev (sem shell, corpus único não-sincronizado) fica
// em corpus/usage como antes.
const cacheLocalBase =
  process.env.BALDE_SHELL_EXE || process.env.BALDE_READONLY_CORPUS === '1'
    ? join(process.env.LOCALAPPDATA || process.env.TMPDIR || rootDir, 'Balde', 'runtime', 'cache')
    : null;
export const cacheRoot = process.env.BALDE_CACHE_ROOT || cacheLocalBase || join(corpusRoot, 'usage');
// Access-control cohorts. Balde-native (NOT Authentik): git-versioned, one <slug>.yml per group.
export const groupsRoot = process.env.GROUPS_ROOT || join(corpusRoot, 'groups');
// System prompts used by the "Criar skill" wizard. Git-versioned; seeded once from DEFAULT_PROMPTS.
export const promptsRoot = process.env.PROMPTS_ROOT || join(corpusRoot, 'prompts');
// Roster of everyone who has authenticated (populated from the SSO identity on /api/me).
export const rosterPath = join(usersRoot, '_roster.json');
// Platform documentation: a git-versioned corpus of markdown (SEPARATE from skills).
export const docsRoot = process.env.DOCS_ROOT || join(corpusRoot, 'docs');
// Commons: a corpus-level neighborhood of SHARED concepts any skill can link (cross-skill
// linking, DESIGN-cross-skill-linking.md). Git-versioned like skills; each concept is a
// governed node. Sits beside the skills so cross-skill/commons links resolve corpus-wide.
export const commonsRoot = () => process.env.COMMONS_ROOT || repoCommonsRoot(activeRepo());
// claude-cli / codex-cli = clientes locais (Claude Code / Codex) como provedor — sem chave
// de API; o processo shell roda com a conta do próprio usuário (balde-local, AI_MODE=cli).
export const AI_PROVIDERS = ['openai', 'anthropic', 'compatible', 'claude-cli', 'codex-cli'];
// Canonical pose vocabulary — frozen, mirrors BuddyPoses.All in the add-in.
export const BUDDY_POSES = [
  'idle',
  'wave',
  'thinking',
  'writing',
  'happy',
  'sad',
  'question',
  'eureka',
  'pointing',
  'celebrating'
];
export const BUDDY_POSE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
// Poses are optimized client-side before upload; 128 KB leaves headroom while rejecting unoptimized blobs.
export const BUDDY_POSE_MAX_BYTES = 128 * 1024;
// Downloadable file-assets attached to a commons capsule (the `files/` sidecar: PDFs, zips,
// office docs). Non-context (never fed to AI/graph/index); upload enforces this 20 MB cap.
export const ASSET_MAX_BYTES = 20 * 1024 * 1024;
export const feedbackPollMs = Number(process.env.FEEDBACK_POLL_MS || 15000);

export const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
