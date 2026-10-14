// Repo (balde) registry: the outer level of the three-level namespace (repo / domain / artifact).
//
// A balde is a FOLDER holding skills/ + commons/ (each its own git ledger) plus balde-repo.json, a
// self-describing manifest: name, title, governance profile and the balde's OWN access list. Each
// balde manages its access in that file, next to its content.
//
// Two sources feed the registry:
//   1. SHARED baldes: folders under <corpus>/repos/, what every install of the deployment sees. A
//      folder without a manifest yet is synthesized from the legacy central repos.json (kept as a
//      read-only fallback). Where the corpus is writable (VPS, the local admin install),
//      migrateRepoManifests() writes the missing manifests once.
//   2. LOCAL mounts (local version): folders the user added or created ANYWHERE, listed in the
//      per-user config (%APPDATA%\Balde\settings.json). Each install mounts its own set; a mount
//      whose folder is missing on this machine (a roamed profile, say) is reported, never fatal.
//
// The registry lives in memory and is published to config.mjs (repoDirs / localRepos), so every
// corpus path helper stays synchronous.
//
// ensureRepoLayout() (bottom) is the one-time R1 legacy migration: skills/ and commons/ at the
// corpus root move into repos/corporate. An ambiguous state refuses to boot.
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute, relative } from 'node:path';
import { pathExists } from './fs-utils.mjs';
import { corpusRoot, reposRoot, DEFAULT_REPO, repoDirs, localRepos, userConfigPath } from './config.mjs';
import { ensureRepo } from './git-corpus.mjs';

export const reposRegistryPath = join(corpusRoot, 'repos.json');
export const REPO_MANIFEST = 'balde-repo.json';
export const REPO_MANIFEST_FORMAT = 'balde-repo/1';
export const REPO_NAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
export const REPO_PROFILES = ['full', 'light'];

const curatorGroup = () => process.env.CURATOR_GROUP || 'Balde - Curadores';
const adminGroup = () => process.env.ADMIN_GROUP || 'Balde - Admins';
const emailList = (v) =>
  [...new Set((Array.isArray(v) ? v : []).map((m) => String(m).trim().toLowerCase()).filter(Boolean))].slice(0, 200);
const groupList = (v) =>
  [...new Set((Array.isArray(v) ? v : []).map((g) => String(g).trim()).filter(Boolean))].slice(0, 50);

// A balde's access. open: every authenticated user READS it. owners + adminGroups: ADMINISTER it
// (title, profile, access, its domains and who creates in them, its policies) and curate it.
// curators / curatorGroups: curate it (write the corpus, approve the Fila). members / groups: read
// it and contribute through its Fila. Admins are per balde: the install's Admins group has no pass
// into a balde that does not list it. A manifest written before admin groups existed lists none:
// a balde without owners (Corporativo, a team balde) is then administered by the Admins group, and
// one with owners by those owners only.
export function normalizeAccess(a = {}) {
  const owners = emailList(a.owners);
  return {
    open: a.open === true,
    owners,
    adminGroups: Array.isArray(a.adminGroups) ? groupList(a.adminGroups) : owners.length ? [] : [adminGroup()],
    curators: emailList(a.curators),
    curatorGroups: groupList(a.curatorGroups),
    members: emailList(a.members),
    groups: groupList(a.groups)
  };
}

// Legacy central registry entry -> manifest, with the exact pre-manifest semantics: a shared balde
// with no members/groups is open and curated by the curator group; a restricted one keeps its
// members/groups; a personal (light) balde's members are its owners. A shared balde is
// administered by the Admins group, a personal one by its owners.
function manifestFromLegacy(r) {
  const profile = REPO_PROFILES.includes(r.profile) ? r.profile : 'full';
  const members = emailList(r.members);
  const groups = groupList(r.groups);
  const open = profile !== 'light' && !members.length && !groups.length;
  const access =
    profile === 'light'
      ? {
          open: false,
          owners: members,
          adminGroups: members.length ? [] : [adminGroup()],
          curators: [],
          curatorGroups: [],
          members: [],
          groups
        }
      : {
          open,
          owners: [],
          adminGroups: [adminGroup()],
          curators: [],
          curatorGroups: open ? [curatorGroup()] : [],
          members,
          groups
        };
  return {
    format: REPO_MANIFEST_FORMAT,
    name: String(r.name),
    titulo: String(r.titulo || r.name),
    profile,
    createdAt: r.createdAt || null,
    access
  };
}

function entryFrom(manifest, dir, source) {
  const access = normalizeAccess(manifest.access);
  return {
    name: String(manifest.name),
    titulo:
      String(manifest.titulo || manifest.name)
        .trim()
        .slice(0, 80) || String(manifest.name),
    profile: REPO_PROFILES.includes(manifest.profile) ? manifest.profile : 'full',
    createdAt: manifest.createdAt || null,
    dir,
    source, // 'shared' (<corpus>/repos) | 'local' (a folder the user mounted or created)
    access,
    // Flattened READ view (who can see it), for the admin table and the SharePoint ACL sync.
    groups: [...new Set([...access.groups, ...access.curatorGroups, ...access.adminGroups])],
    members: [...new Set([...access.owners, ...access.curators, ...access.members])]
  };
}

async function readManifest(dir) {
  try {
    const m = JSON.parse(await readFile(join(dir, REPO_MANIFEST), 'utf8'));
    return m && REPO_NAME_RE.test(String(m.name || '')) ? m : null;
  } catch {
    return null;
  }
}

async function writeManifest(dir, m) {
  const out = {
    format: REPO_MANIFEST_FORMAT,
    name: m.name,
    titulo:
      String(m.titulo || m.name)
        .trim()
        .slice(0, 80) || m.name,
    profile: REPO_PROFILES.includes(m.profile) ? m.profile : 'full',
    createdAt: m.createdAt || new Date().toISOString(),
    access: normalizeAccess(m.access)
  };
  await writeFile(join(dir, REPO_MANIFEST), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
}

// Per-user config (%APPDATA%\Balde\settings.json)
export const mountsEnabled = () => Boolean(userConfigPath);

async function loadUserConfig() {
  let c = null;
  if (userConfigPath) {
    try {
      c = JSON.parse(await readFile(userConfigPath, 'utf8'));
    } catch {
      c = null;
    }
  }
  const base = c && typeof c === 'object' ? c : {};
  return { ...base, version: 1, mounts: Array.isArray(base.mounts) ? base.mounts.filter((m) => m && m.path) : [] };
}

async function saveUserConfig(cfg) {
  if (!userConfigPath) throw new Error('Configuração do usuário indisponível nesta instalação.');
  await mkdir(dirname(userConfigPath), { recursive: true });
  await writeFile(userConfigPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}

// Registry
let registryCache = null;
let registryAt = 0;
let mountStatus = [];
const REGISTRY_TTL_MS = 10000;

async function buildRegistry() {
  const repos = [];
  const seen = new Set();
  // 1. Shared baldes: legacy registry entries + folders under <corpus>/repos.
  let legacy = [];
  try {
    const reg = JSON.parse(await readFile(reposRegistryPath, 'utf8'));
    legacy = (Array.isArray(reg && reg.repos) ? reg.repos : []).filter(
      (r) => r && REPO_NAME_RE.test(String(r.name || ''))
    );
  } catch {
    legacy = [];
  }
  const legacyByName = new Map(legacy.map((r) => [String(r.name), r]));
  let dirNames = [];
  try {
    dirNames = (await readdir(reposRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && REPO_NAME_RE.test(e.name))
      .map((e) => e.name);
  } catch {
    dirNames = [];
  }
  for (const name of [...new Set([DEFAULT_REPO, ...legacyByName.keys(), ...dirNames])]) {
    const dir = join(reposRoot, name);
    // A shared balde whose folder is not on this machine is not listed. Once a balde is made
    // private in OneDrive, the people excluded from it cannot sync its folder, so they must not see
    // it synthesized from repos.json (where it may still look open). The default balde always stays.
    if (name !== DEFAULT_REPO && !(await pathExists(dir))) continue;
    const manifest = await readManifest(dir);
    let m = null;
    if (manifest && manifest.name === name) m = manifest;
    else if (legacyByName.has(name)) m = manifestFromLegacy(legacyByName.get(name));
    else if (name === DEFAULT_REPO)
      m = manifestFromLegacy({ name: DEFAULT_REPO, titulo: 'Corporativo', profile: 'full' });
    if (!m) continue; // a stray folder: neither a manifest nor a registry entry
    repos.push(entryFrom(m, dir, 'shared'));
    seen.add(name);
  }
  // 2. Local mounts (local version only).
  const status = [];
  if (userConfigPath) {
    for (const mt of (await loadUserConfig()).mounts) {
      const dir = resolve(String(mt.path));
      const st = { path: dir, name: null, titulo: null, ok: false, error: null };
      const exists = await pathExists(dir);
      const manifest = exists ? await readManifest(dir) : null;
      if (!exists) st.error = 'Pasta não encontrada nesta máquina.';
      else if (!manifest) st.error = `A pasta não tem ${REPO_MANIFEST}.`;
      else if (seen.has(manifest.name))
        Object.assign(st, { name: manifest.name, error: `Já existe outro balde chamado "${manifest.name}".` });
      else {
        repos.push(entryFrom(manifest, dir, 'local'));
        seen.add(manifest.name);
        Object.assign(st, { name: manifest.name, titulo: manifest.titulo || manifest.name, ok: true });
      }
      status.push(st);
    }
  }
  mountStatus = status;
  // Publish the folder map. No await between clear and fill, so it is atomic for the event loop.
  repoDirs.clear();
  localRepos.clear();
  for (const r of repos) {
    repoDirs.set(r.name, r.dir);
    if (r.source === 'local') localRepos.add(r.name);
  }
  return { version: 1, repos };
}

async function loadRegistry() {
  if (registryCache && Date.now() - registryAt < REGISTRY_TTL_MS) return registryCache;
  registryCache = await buildRegistry();
  registryAt = Date.now();
  return registryCache;
}

export function invalidateRepoRegistry() {
  registryCache = null;
  registryAt = 0;
}
export async function reloadRepoRegistry() {
  invalidateRepoRegistry();
  return loadRegistry();
}
export async function listRepos() {
  return (await loadRegistry()).repos;
}
export async function repoByName(name) {
  return (await loadRegistry()).repos.find((r) => r.name === String(name || '')) || null;
}
export async function listMountStatus() {
  await loadRegistry();
  return mountStatus;
}

// Access
const hasEmail = (list, email) => Boolean(email) && list.includes(String(email).trim().toLowerCase());
const hasGroup = (list, groups) => {
  const mine = new Set((groups || []).map((g) => String(g).trim().toLowerCase()).filter(Boolean));
  return list.some((g) => mine.has(String(g).trim().toLowerCase()));
};

// ADMINISTER (title, profile, access list, domains and who creates in them, policies, everything
// inside the balde): its owners and the members of its admin groups. No install-wide pass.
export function isRepoAdmin(repo, actorGroups = [], email = '') {
  if (!repo) return false;
  const a = repo.access || normalizeAccess();
  return hasEmail(a.owners, email) || hasGroup(a.adminGroups, actorGroups);
}

// READ: an open balde (every authenticated user); its admins; anyone listed as curator or member;
// anyone in a member or curator group.
export function isRepoMember(repo, actorGroups = [], email = '') {
  if (!repo) return false;
  const a = repo.access || normalizeAccess();
  if (a.open) return true;
  return (
    isRepoAdmin(repo, actorGroups, email) ||
    hasEmail(a.curators, email) ||
    hasEmail(a.members, email) ||
    hasGroup(a.groups, actorGroups) ||
    hasGroup(a.curatorGroups, actorGroups)
  );
}

// CURATE (write the corpus, approve the Fila): its admins, curators by e-mail or group.
export function isRepoCurator(repo, actorGroups = [], email = '') {
  if (!repo) return false;
  const a = repo.access || normalizeAccess();
  return isRepoAdmin(repo, actorGroups, email) || hasEmail(a.curators, email) || hasGroup(a.curatorGroups, actorGroups);
}

// Listed as an owner (the balde's creator, by default): only the role shown to people; what an
// owner may do is isRepoAdmin.
export function isRepoOwner(repo, email = '') {
  if (!repo) return false;
  return hasEmail((repo.access || normalizeAccess()).owners, email);
}

export async function reposForActor(actorGroups = [], email = '') {
  return (await listRepos()).filter((r) => isRepoMember(r, actorGroups, email));
}

// Create / mount / edit
// The git objects of a balde live in the MACHINE-LOCAL ledger, so a folder inside OneDrive only
// ever gets a one-line .git pointer file, never a real .git directory to sync.
const localLedgerRoot = () =>
  process.env.GIT_LEDGER_ROOT ||
  (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Balde', 'ledger') : undefined);

function validName(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase();
  if (!REPO_NAME_RE.test(slug))
    throw new Error('Nome de balde inválido: use minúsculas, dígitos e hífens (2 a 31 caracteres).');
  if (slug === 'repos') throw new Error('Nome de balde reservado.');
  return slug;
}

async function scaffold(dir, manifest) {
  await mkdir(join(dir, 'skills'), { recursive: true });
  await mkdir(join(dir, 'commons'), { recursive: true });
  const ledger = localLedgerRoot();
  await ensureRepo(join(dir, 'skills'), `corpus:${manifest.name}`, ledger);
  await ensureRepo(join(dir, 'commons'), `commons:${manifest.name}`, ledger);
  await writeManifest(dir, manifest);
}

// Shared-corpus balde (legacy admin create, "Meu Balde"): folder <corpus>/repos/<name> + manifest.
export async function createRepo({ name, titulo, groups, members, profile } = {}) {
  const slug = validName(name);
  if ((await reloadRepoRegistry()).repos.some((r) => r.name === slug)) throw new Error(`Balde "${slug}" já existe.`);
  const manifest = manifestFromLegacy({
    name: slug,
    titulo: String(titulo || slug).trim(),
    groups,
    members,
    profile,
    createdAt: new Date().toISOString()
  });
  await scaffold(join(reposRoot, slug), manifest);
  return (await reloadRepoRegistry()).repos.find((r) => r.name === slug);
}

async function absoluteFolder(p) {
  const raw = String(p || '')
    .trim()
    .replace(/^["']+|["']+$/g, '');
  if (!raw) throw new Error('Informe o caminho da pasta.');
  if (!isAbsolute(raw))
    throw new Error('Use o caminho completo da pasta (ex.: C:\\Users\\voce\\OneDrive\\Baldes\\meu-balde).');
  return resolve(raw);
}

const insideShared = (dir) => {
  const rel = relative(reposRoot, dir);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

async function addMount(dir) {
  const cfg = await loadUserConfig();
  if (!cfg.mounts.some((m) => resolve(String(m.path)) === dir))
    cfg.mounts.push({ path: dir, addedAt: new Date().toISOString() });
  await saveUserConfig(cfg);
}

// "Criar balde": turn an empty (or not yet existing) folder ANYWHERE into a balde owned by its
// creator, private until the owner opens it. Inside the shared corpus it must be
// <corpus>/repos/<name> and is then shared; anywhere else it is mounted in this user's config.
export async function createRepoAt({ folder, name, titulo, profile, owner } = {}) {
  if (!mountsEnabled()) throw new Error('Criar balde em uma pasta só existe na versão local.');
  const slug = validName(name);
  const dir = await absoluteFolder(folder);
  if ((await reloadRepoRegistry()).repos.some((r) => r.name === slug))
    throw new Error(`Já existe um balde chamado "${slug}".`);
  const shared = insideShared(dir);
  if (shared && dir !== join(reposRoot, slug))
    throw new Error(`Dentro do corpus compartilhado, o balde precisa ficar em ${join(reposRoot, slug)}.`);
  if (await pathExists(dir)) {
    let items = [];
    try {
      items = (await readdir(dir)).filter((n) => !/^(desktop\.ini|thumbs\.db|\.ds_store)$/i.test(n));
    } catch {
      items = [];
    }
    if (items.length)
      throw new Error(
        'A pasta precisa estar vazia (ou ainda não existir). Para uma pasta que já é um balde, use "Adicionar balde existente".'
      );
  }
  const me = String(owner || '')
    .trim()
    .toLowerCase();
  const manifest = {
    name: slug,
    titulo:
      String(titulo || slug)
        .trim()
        .slice(0, 80) || slug,
    profile: REPO_PROFILES.includes(profile) ? profile : 'light',
    createdAt: new Date().toISOString(),
    access: { open: false, owners: me ? [me] : [], curators: [], curatorGroups: [], members: [], groups: [] }
  };
  await mkdir(dir, { recursive: true });
  await scaffold(dir, manifest);
  if (!shared) await addMount(dir);
  return (await reloadRepoRegistry()).repos.find((r) => r.name === slug);
}

// "Adicionar balde existente": mount a folder that already is a balde (has balde-repo.json). A
// folder with the Balde structure (skills/ or commons/) but no manifest yet is adopted under the
// given name, owned by whoever adopts it.
export async function mountRepo({ folder, name, titulo, owner } = {}) {
  if (!mountsEnabled()) throw new Error('Adicionar balde por pasta só existe na versão local.');
  const dir = await absoluteFolder(folder);
  if (insideShared(dir))
    throw new Error('Esta pasta faz parte do corpus compartilhado: os baldes dela já aparecem para todos.');
  if (!(await pathExists(dir))) throw new Error('Pasta não encontrada.');
  let manifest = await readManifest(dir);
  const adopting = !manifest;
  if (adopting) {
    const looksLikeBalde = (await pathExists(join(dir, 'skills'))) || (await pathExists(join(dir, 'commons')));
    if (!looksLikeBalde)
      throw new Error(
        `A pasta não é um balde (sem ${REPO_MANIFEST}, skills/ ou commons/). Para começar do zero, use "Criar balde".`
      );
    if (!name)
      throw new Error(`A pasta tem a estrutura do Balde mas nenhum ${REPO_MANIFEST}: informe um nome para adotá-la.`);
    const me = String(owner || '')
      .trim()
      .toLowerCase();
    manifest = {
      name: validName(name),
      titulo:
        String(titulo || name)
          .trim()
          .slice(0, 80) || String(name),
      profile: 'light',
      createdAt: new Date().toISOString(),
      access: { open: false, owners: me ? [me] : [], curators: [], curatorGroups: [], members: [], groups: [] }
    };
  }
  const clash = (await reloadRepoRegistry()).repos.find((r) => r.name === manifest.name);
  if (clash && clash.dir !== dir) throw new Error(`Já existe um balde chamado "${manifest.name}" (${clash.dir}).`);
  if (adopting) await scaffold(dir, manifest);
  await addMount(dir);
  return (await reloadRepoRegistry()).repos.find((r) => r.name === manifest.name) || null;
}

// Remove a balde from THIS user's list (never deletes files): by folder path or by balde name.
export async function unmountRepo({ folder, name } = {}) {
  if (!mountsEnabled()) throw new Error('Nada a remover: esta instalação não tem baldes por pasta.');
  const cfg = await loadUserConfig();
  let target = folder
    ? resolve(
        String(folder)
          .trim()
          .replace(/^["']+|["']+$/g, '')
      )
    : null;
  if (!target && name) {
    await loadRegistry();
    const hit = mountStatus.find((s) => s.name === String(name));
    target = hit ? resolve(hit.path) : null;
  }
  if (!target) throw new Error('Balde não encontrado entre os seus.');
  const before = cfg.mounts.length;
  cfg.mounts = cfg.mounts.filter((m) => resolve(String(m.path)) !== target);
  if (cfg.mounts.length === before)
    throw new Error('Este balde não está entre os seus (os compartilhados não podem ser removidos).');
  await saveUserConfig(cfg);
  await reloadRepoRegistry();
  return { removed: target };
}

// Edit title / profile / access by writing the balde's OWN manifest (in its folder). Takes the new
// access object, or, from the legacy admin form, groups/members (both empty = open).
export async function updateRepo(name, { titulo, profile, access, groups, members } = {}) {
  const entry = (await reloadRepoRegistry()).repos.find((r) => r.name === String(name || ''));
  if (!entry) throw new Error(`Balde "${name}" não existe.`);
  const next = {
    name: entry.name,
    titulo: entry.titulo,
    profile: entry.profile,
    createdAt: entry.createdAt,
    access: { ...entry.access }
  };
  if (titulo !== undefined)
    next.titulo =
      String(titulo || entry.name)
        .trim()
        .slice(0, 80) || entry.name;
  if (profile !== undefined && REPO_PROFILES.includes(profile)) next.profile = profile;
  if (access && typeof access === 'object') {
    next.access = normalizeAccess({ ...entry.access, ...access });
  } else if (groups !== undefined || members !== undefined) {
    if (groups !== undefined) next.access.groups = groupList(groups);
    if (members !== undefined) next.access.members = emailList(members);
    if (next.profile !== 'light') next.access.open = !next.access.groups.length && !next.access.members.length;
  }
  if (entry.name === DEFAULT_REPO) next.access.open = true; // the default balde stays open to everyone
  await writeManifest(entry.dir, next);
  return (await reloadRepoRegistry()).repos.find((r) => r.name === entry.name);
}

// One-time and idempotent: give every SHARED balde its own manifest (from the legacy central
// registry), so access lives with the balde. Only where the shared corpus is writable (VPS, the
// local admin install); read-only user installs synthesize the same manifest in memory.
export async function migrateRepoManifests() {
  let wrote = 0;
  for (const r of (await reloadRepoRegistry()).repos) {
    if (r.source !== 'shared' || !(await pathExists(r.dir)) || (await pathExists(join(r.dir, REPO_MANIFEST)))) continue;
    try {
      await writeManifest(r.dir, r);
      wrote += 1;
    } catch {
      /* corpus not writable here: stays synthesized */
    }
  }
  if (wrote) {
    console.log(`Baldes: ${wrote} manifesto(s) ${REPO_MANIFEST} criado(s) a partir do repos.json.`);
    await reloadRepoRegistry();
  }
  return wrote;
}

async function seedRegistry() {
  if (await pathExists(reposRegistryPath)) return;
  const registry = {
    version: 1,
    repos: [
      // groups: [] = every authenticated user (membership semantics enforced from R2 on).
      { name: DEFAULT_REPO, titulo: 'Corporativo', groups: [], profile: 'full', createdAt: new Date().toISOString() }
    ]
  };
  await writeFile(reposRegistryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

export async function ensureRepoLayout() {
  const oldSkills = join(corpusRoot, 'skills');
  const oldCommons = join(corpusRoot, 'commons');
  const repoDir = join(reposRoot, DEFAULT_REPO);
  const hasOldSkills = await pathExists(oldSkills);
  const hasOldCommons = await pathExists(oldCommons);
  const hasNew = await pathExists(repoDir);

  if (hasNew && (hasOldSkills || hasOldCommons)) {
    const leftovers = [hasOldSkills ? oldSkills : null, hasOldCommons ? oldCommons : null].filter(Boolean).join(' e ');
    throw new Error(
      `Layout do corpus ambíguo: "${repoDir}" existe, mas ${leftovers} ainda existe(m) na raiz. ` +
        `Uma migração anterior pode ter sido interrompida. Resolva manualmente ANTES de subir o servidor: ` +
        `ou mova o(s) diretório(s) legado(s) para dentro de "${repoDir}" (mv skills/commons), ` +
        `ou remova "${join(reposRoot, '')}" para refazer a migração do zero. Nada foi alterado agora.`
    );
  }

  if (hasNew) {
    await seedRegistry();
    return { migrated: false };
  }

  await mkdir(repoDir, { recursive: true });
  if (hasOldSkills) {
    await rename(oldSkills, join(repoDir, 'skills'));
  } else {
    await mkdir(join(repoDir, 'skills'), { recursive: true });
  }
  if (hasOldCommons) {
    await rename(oldCommons, join(repoDir, 'commons'));
  } else {
    await mkdir(join(repoDir, 'commons'), { recursive: true });
  }
  await seedRegistry();
  const migrated = hasOldSkills || hasOldCommons;
  if (migrated) {
    console.log(`Corpus migrado para o layout de repos: skills/commons agora em ${repoDir}`);
  }
  return { migrated };
}
