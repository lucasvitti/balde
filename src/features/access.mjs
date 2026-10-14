import { localIdentity, localGroups } from '../security/local-session.mjs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFrontmatter, isSafeSkillId, safeSlug } from '../skill-format.mjs';
import { skillsRoot, usersRoot, groupsRoot, rosterPath, activeRepo } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { repoByName, isRepoCurator } from '../repos.mjs';
import { notifyEventId, appendNotifyEvent } from '../notify.mjs';

export function createAccessFeature({ commitRepo, authentikServiceReady, authentikAdmin }) {
  let corpusGroupsIndex = null; // [{ name, members:Set<email> }] — cache atualizado a cada 30s
  async function refreshCorpusGroupsIndex() {
    try {
      const groups = await listGroups();
      corpusGroupsIndex = groups.map((g) => ({
        name: g.name,
        members: new Set((g.members || []).map((m) => String(m).trim().toLowerCase()).filter(Boolean))
      }));
    } catch (error) {
      corpusGroupsIndex = corpusGroupsIndex || [];
    }
  }
  function corpusGroupsForEmail(email) {
    const e = String(email || '')
      .trim()
      .toLowerCase();
    if (!e || !Array.isArray(corpusGroupsIndex)) return [];
    return corpusGroupsIndex.filter((g) => g.members.has(e)).map((g) => g.name);
  }

  function reqGroups(req) {
    return localGroups(corpusGroupsForEmail);
  }

  // Buddy authoring is gated by a dedicated Authentik group (server-enforced).
  function canCreateBuddyReq(req) {
    const buddyGroup = process.env.BUDDY_AUTHOR_GROUP || 'Balde - Buddy Authors';
    return reqGroups(req).includes(buddyGroup);
  }

  async function skillOwnerName(skillId) {
    try {
      if (!skillId || !isSafeSkillId(skillId)) {
        return null;
      }
      const skillPath = join(skillsRoot(), skillId, 'SKILL.md');
      if (!(await pathExists(skillPath))) {
        return null;
      }
      const { meta } = parseFrontmatter(await readFile(skillPath, 'utf8'));
      return meta.owner ? String(meta.owner).trim() : null;
    } catch (error) {
      return null;
    }
  }

  async function canManageSkillReq(req, skillId) {
    return canManageSkillActor(skillId, webActor(req));
  }

  async function canReadSkillReq(req, skillId) {
    return canReadSkillActor(skillId, webActor(req));
  }
  // Access control: Balde-native groups + user roster + per-skill ACCESS.yml.
  // Authentik stays the identity/login authority and supplies the coarse role
  // groups (Admins / Curadores); every skill-scoped decision below resolves from
  // the corpus alone — no Authentik API calls, so it works even if the IdP is down.

  // -- Minimal YAML for our controlled shapes (scalars + block string lists).
  // -- Not a general parser: it round-trips exactly what dumpSimpleYaml writes.
  function stripYamlScalar(v) {
    const s = String(v == null ? '' : v).trim();
    if (s.startsWith('"') && s.endsWith('"')) {
      try {
        return JSON.parse(s);
      } catch {
        return s.slice(1, -1);
      }
    }
    if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
    return s;
  }

  function parseSimpleYaml(text) {
    const out = {};
    let listKey = null;
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.replace(/\s+$/, '');
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const item = line.match(/^\s*-\s+(.*)$/);
      if (item && listKey) {
        out[listKey].push(stripYamlScalar(item[1]));
        continue;
      }
      const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      const rest = kv[2].trim();
      if (rest === '') {
        out[key] = [];
        listKey = key;
        continue;
      } // block list follows (or stays empty)
      listKey = null;
      if (rest === '[]') {
        out[key] = [];
        continue;
      }
      if (rest.startsWith('[') && rest.endsWith(']')) {
        out[key] = rest
          .slice(1, -1)
          .split(',')
          .map((v) => stripYamlScalar(v.trim()))
          .filter(Boolean);
        continue;
      }
      let val = stripYamlScalar(rest);
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      out[key] = val;
    }
    return out;
  }

  function yamlScalar(v) {
    const s = String(v == null ? '' : v);
    if (s === '') return '""';
    return /^[A-Za-z0-9._@/-]+$/.test(s) ? s : JSON.stringify(s);
  }

  function dumpSimpleYaml(obj) {
    const lines = [];
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        if (!value.length) {
          lines.push(`${key}: []`);
          continue;
        }
        lines.push(`${key}:`);
        for (const v of value) lines.push(`  - ${yamlScalar(v)}`);
      } else if (value === undefined || value === null) {
        continue;
      } else if (typeof value === 'boolean') {
        lines.push(`${key}: ${value ? 'true' : 'false'}`);
      } else {
        lines.push(`${key}: ${yamlScalar(value)}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  // Normalizers
  function normEmail(v) {
    return String(v || '')
      .trim()
      .toLowerCase();
  }
  function normEmailList(v) {
    const arr = Array.isArray(v) ? v : v == null ? [] : [v];
    return [...new Set(arr.map(normEmail).filter((e) => e.includes('@')))];
  }
  function normSlugList(v) {
    const arr = Array.isArray(v) ? v : v == null ? [] : [v];
    return [...new Set(arr.map((s) => slugifyGroupName(s)).filter(Boolean))];
  }

  // Groups (Balde-native cohorts)
  function slugifyGroupName(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  function assertSafeGroupSlug(slug) {
    if (!/^[a-z0-9-]+$/.test(String(slug || ''))) throw new Error('slug de grupo inválido');
  }
  function groupFilePath(slug) {
    assertSafeGroupSlug(slug);
    return join(groupsRoot, `${slug}.yml`);
  }

  async function loadGroup(slug) {
    try {
      assertSafeGroupSlug(slug);
      const p = groupFilePath(slug);
      if (!(await pathExists(p))) return null;
      const y = parseSimpleYaml(await readFile(p, 'utf8'));
      return {
        slug,
        name: String(y.name || slug),
        description: String(y.description || ''),
        members: normEmailList(y.members),
        created_by: String(y.created_by || ''),
        created_at: String(y.created_at || ''),
        updated_at: String(y.updated_at || '')
      };
    } catch {
      return null;
    }
  }

  async function listGroups() {
    let entries = [];
    try {
      entries = await readdir(groupsRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const groups = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.yml')) continue;
      const g = await loadGroup(e.name.slice(0, -4));
      if (g) groups.push(g);
    }
    groups.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return groups;
  }

  async function saveGroup({ slug, name, description = '', members = [], actor = {} }) {
    assertSafeGroupSlug(slug);
    await mkdir(groupsRoot, { recursive: true });
    const existing = await loadGroup(slug);
    const now = new Date().toISOString();
    const doc = {
      name: String(name || slug).trim(),
      description: String(description || '').trim(),
      members: normEmailList(members),
      created_by: existing?.created_by || normEmail(actor.email) || 'sistema',
      created_at: existing?.created_at || now,
      updated_at: now
    };
    await writeFile(groupFilePath(slug), dumpSimpleYaml(doc), 'utf8');
    await commitRepo(groupsRoot, `group(${slug}): ${existing ? 'atualizado' : 'criado'}`, actor, [`${slug}.yml`]);
    return { slug, ...doc };
  }

  async function deleteGroup(slug, actor = {}) {
    assertSafeGroupSlug(slug);
    const p = groupFilePath(slug);
    if (await pathExists(p)) {
      await rm(p, { force: true });
      await commitRepo(groupsRoot, `group(${slug}): removido`, actor, [`${slug}.yml`]);
    }
    return true;
  }

  // User roster (local mirror of who has logged in; feeds the pickers)
  async function loadRoster() {
    try {
      if (!(await pathExists(rosterPath))) return [];
      const arr = JSON.parse(await readFile(rosterPath, 'utf8'));
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  // Full org roster from Authentik (active, non-service users) when the service token is
  // configured — so admins can pick ANY user for a group, not just those already seen in Balde.
  async function loadAuthentikUsers() {
    if (!authentikServiceReady()) return [];
    try {
      const data = await authentikAdmin('/api/v3/core/users/?is_active=true&page_size=500&ordering=name');
      return (data.results || [])
        .filter((u) => u && u.type !== 'service_account')
        .map((u) => ({
          email: normEmail(u.email || ''),
          name: String(u.name || u.username || '').trim(),
          username: String(u.username || '').trim()
        }))
        .filter((u) => u.email && u.email.includes('@'));
    } catch (error) {
      return [];
    }
  }

  async function upsertRoster(identity) {
    const email = normEmail(identity && identity.email);
    if (!email || !email.includes('@') || email === 'balde@bot.local') return;
    try {
      const roster = await loadRoster();
      const today = new Date().toISOString().slice(0, 10);
      const name = String((identity && identity.name) || '').trim();
      const username = String((identity && identity.username) || '').trim();
      // Snapshot the SSO groups at login: offline jobs (the notification digest) rebuild each
      // user's admin/curator standing from this — refreshed on every new-day visit.
      const groups = Array.isArray(identity && identity.groups)
        ? identity.groups
            .map((g) => String(g))
            .filter(Boolean)
            .slice(0, 40)
        : null;
      const idx = roster.findIndex((u) => normEmail(u.email) === email);
      if (idx >= 0) {
        const u = roster[idx];
        // Day-granular writes: skip disk churn when nothing meaningful changed today.
        if (
          (u.lastSeen || '').slice(0, 10) === today &&
          (!name || u.name === name) &&
          (!username || u.username === username) &&
          (!groups || JSON.stringify(u.groups || []) === JSON.stringify(groups))
        )
          return;
        u.lastSeen = new Date().toISOString();
        if (name) u.name = name;
        if (username) u.username = username;
        if (groups) u.groups = groups;
      } else {
        const nowIso = new Date().toISOString();
        roster.push({
          email,
          name: name || email,
          username,
          ...(groups ? { groups } : {}),
          firstSeen: nowIso,
          lastSeen: nowIso
        });
      }
      roster.sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email), 'pt-BR'));
      await mkdir(usersRoot, { recursive: true });
      await writeFile(rosterPath, JSON.stringify(roster, null, 2) + '\n', 'utf8');
    } catch {
      /* roster is best-effort — never breaks a request */
    }
  }

  // Per-skill and per-capsule access levels were dropped (2026-10): the BALDE decides who reads and who
  // curates. Whoever reads a balde reads every skill and capsule in it; its admins and curators curate
  // all of them (a skill's author keeps editing their own skill). Old ACCESS.yml files stay on disk,
  // unread; the constant public shape keeps every caller working, and saving one is a no-op.
  const publicAccess = () => ({
    visibility: 'public',
    curators: [],
    curator_groups: [],
    readers: [],
    reader_groups: []
  });
  async function loadSkillAccess(skillId) {
    return publicAccess();
  }

  async function saveSkillAccess(skillId, input, actor = {}) {
    return publicAccess();
  }

  // Per-capsule access was dropped with per-skill access (see loadSkillAccess): the balde decides.
  async function loadCommonsAccess(conceptId) {
    return publicAccess();
  }
  async function writeCommonsAccessDoc(conceptId, input) {
    return publicAccess();
  }

  // Whoever reads the balde (checked when the request is scoped to it) reads every capsule in it.
  async function canReadCommonsActor(conceptId, actor) {
    return true;
  }

  // The balde's admins and curators manage every capsule in it.
  async function canManageCommonsActor(conceptId, actor) {
    return actorCuratesActiveRepo(actor);
  }
  function canReadCommonsReq(req, conceptId) {
    return canReadCommonsActor(conceptId, webActor(req));
  }
  function canManageCommonsReq(req, conceptId) {
    return canManageCommonsActor(conceptId, webActor(req));
  }

  // -- Unified actor + resolvers (one code path for web headers and API tokens) -
  function webActor(req) {
    return { ...localIdentity(), groups: reqGroups(req) };
  }

  // Slug do balde pessoal de um usuário — determinístico a partir do e-mail. safeSlug preserva
  // pontos (é slug de ARQUIVO); nomes de repo não aceitam ponto → nome.sobrenome@… vira
  // pessoal-nome-sobrenome. Fallback com hash para local-parts exóticos. Usado pelo self-service
  // (/api/repos/personal) e pela sugestão do MCP quando o usuário não tem acesso ao balde pedido.
  function personalRepoSlug(email) {
    let userSeg = safeSlug(String(email || '').split('@')[0])
      .replace(/[._]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 22)
      .replace(/-+$/g, '');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(userSeg))
      userSeg = `u${createHash('sha256')
        .update(String(email || ''))
        .digest('hex')
        .slice(0, 8)}`;
    return `pessoal-${userSeg}`;
  }

  function actorIsAdmin(actor) {
    const adminGroup = process.env.ADMIN_GROUP || 'Balde - Admins';
    return Array.isArray(actor && actor.groups) && actor.groups.includes(adminGroup);
  }

  // email ∈ any of the named groups' members (pure corpus lookup).
  async function actorInGroups(actor, slugs) {
    const email = normEmail(actor && actor.email);
    if (!email || !Array.isArray(slugs) || !slugs.length) return false;
    for (const slug of slugs) {
      const g = await loadGroup(slug);
      if (g && g.members.includes(email)) return true;
    }
    return false;
  }

  // Whoever reads the balde (checked when the request is scoped to it) reads every skill in it.
  async function canReadSkillActor(skillId, actor) {
    return true;
  }

  // The balde's creator and curators manage every skill in it (D1, Vitti 2026-10-06). The `owner` in a
  // skill's frontmatter says who answers for it and grants nothing: until 2.0.18 it let its author edit,
  // evaluate and publish on the admin install and through the MCP key. Writes also need the balde's folder
  // (src/security/permissions.mjs); this is the role alone.
  async function canManageSkillActor(skillId, actor) {
    return actorCuratesActiveRepo(actor);
  }

  // Curator of the ACTIVE balde: its admins, curators and curator groups (balde-repo.json). Curators
  // are per balde like admins: a global group curates only the baldes that list it.
  async function actorCuratesActiveRepo(actor) {
    let entry = null;
    try {
      entry = await repoByName(activeRepo());
    } catch {
      entry = null;
    }
    return isRepoCurator(entry, (actor && actor.groups) || [], normEmail((actor && actor.email) || ''));
  }
  // Recipients = the skill's stewards (owner + explicit curators + curator-group members), captured
  // at EMIT time; the delivery endpoint re-filters by each recipient's CURRENT per-item opt-in.
  async function notifyRecipientsForSkill(skillId, excludeEmail) {
    const out = new Set();
    try {
      const access = await loadSkillAccess(skillId);
      for (const c of access.curators) out.add(normEmail(c));
      for (const slug of access.curator_groups) {
        const g = await loadGroup(slug);
        if (g && Array.isArray(g.members)) for (const m of g.members) out.add(normEmail(m));
      }
      const owner = normEmail(await skillOwnerName(skillId));
      if (owner) out.add(owner);
    } catch (error) {
      /* best-effort */
    }
    const skip = normEmail(excludeEmail);
    return [...out].filter((e) => e && e.includes('@') && e !== skip);
  }
  // Recipients of a NEW work item (contribution, capsule, chat feedback): everyone who may curate it,
  // the same people canManageSkillActor lets decide. The skill's stewards and owner, and, unless the
  // skill is restricted, the curators of the balde it lives in (its manifest) plus the global curator
  // corps. An item not tied to a skill yet (an unanchored capsule) goes to the balde's curators and the
  // corps, its triage team. A group's members come from the corpus group files and from each person's
  // last login snapshot (the Authentik groups on the VPS).
  // Who belongs to a group (by display name or slug): the corpus group files plus each person's last
  // login snapshot (the Authentik groups on the VPS). Loads both once; returns a lookup function.
  async function groupMembersLookup() {
    const roster = await loadRoster().catch(() => []);
    const groups = await listGroups().catch(() => []);
    return (name) => {
      const key = String(name || '')
        .trim()
        .toLowerCase();
      if (!key) return [];
      const fromFiles = groups
        .filter((g) => g.name.trim().toLowerCase() === key || g.slug === key)
        .flatMap((g) => g.members || []);
      const fromLogins = roster
        .filter((p) => Array.isArray(p.groups) && p.groups.some((x) => String(x).trim().toLowerCase() === key))
        .map((p) => p.email);
      return [...fromFiles, ...fromLogins];
    };
  }

  async function curationRecipients(skillId, excludeEmail, repo = activeRepo()) {
    const out = new Set(skillId ? await notifyRecipientsForSkill(skillId, null) : []);
    let restricted = false;
    if (skillId) {
      try {
        restricted = (await loadSkillAccess(skillId)).visibility === 'restricted';
      } catch (error) {
        restricted = false;
      }
    }
    if (!restricted) {
      const membersOf = await groupMembersLookup();
      let entry = null;
      try {
        entry = await repoByName(repo);
      } catch (error) {
        entry = null;
      }
      const a = (entry && entry.access) || {};
      for (const e of [...(a.owners || []), ...(a.curators || [])]) out.add(normEmail(e));
      for (const g of [...(a.adminGroups || []), ...(a.curatorGroups || [])])
        for (const m of membersOf(g)) out.add(normEmail(m));
    }
    const skip = normEmail(excludeEmail);
    return [...out].filter((e) => e && e.includes('@') && e !== skip);
  }

  // The people of a balde with their role in it (admin > curador > membro), by e-mail or through a
  // group, for Domínios por usuário: on the local version the login roster only knows whoever uses
  // this machine, so the balde's own access list is where its people are.
  async function baldePeople(repo) {
    let entry = null;
    try {
      entry = await repoByName(repo);
    } catch (error) {
      entry = null;
    }
    const a = (entry && entry.access) || {};
    const membersOf = await groupMembersLookup();
    const roster = await loadRoster().catch(() => []);
    const rank = { admin: 3, curador: 2, membro: 1 };
    const out = new Map();
    const add = (email, role) => {
      const e = normEmail(email);
      if (!e || !e.includes('@')) return;
      if (!out.has(e) || rank[role] > rank[out.get(e)]) out.set(e, role);
    };
    for (const e of a.owners || []) add(e, 'admin');
    for (const g of a.adminGroups || []) for (const m of membersOf(g)) add(m, 'admin');
    for (const e of a.curators || []) add(e, 'curador');
    for (const g of a.curatorGroups || []) for (const m of membersOf(g)) add(m, 'curador');
    for (const e of a.members || []) add(e, 'membro');
    for (const g of a.groups || []) for (const m of membersOf(g)) add(m, 'membro');
    return {
      open: a.open === true,
      people: [...out.entries()].map(([email, role]) => ({
        email,
        role,
        name: (roster.find((p) => normEmail(p.email) === email) || {}).name || ''
      }))
    };
  }
  async function skillTitleForNotify(skillId) {
    try {
      const { meta } = parseFrontmatter(await readFile(join(skillsRoot(), skillId, 'SKILL.md'), 'utf8'));
      return String(meta.title || meta.name || '').trim() || skillId;
    } catch (error) {
      return skillId;
    }
  }
  // Both emitters are fire-and-forget: notifications must never fail or slow the user's request.
  function emitNotifyFeedback({ skillId, verdict, actor, question, answer }) {
    (async () => {
      const to = await curationRecipients(skillId, actor && actor.email);
      if (!to.length) return;
      await appendNotifyEvent({
        id: notifyEventId(),
        ts: new Date().toISOString(),
        type: 'feedback',
        skillId,
        skillName: await skillTitleForNotify(skillId),
        verdict,
        actorEmail: normEmail(actor && actor.email) || null,
        actorName: String((actor && actor.name) || '').trim() || null,
        question: String(question || '').slice(0, 300),
        answer: String(answer || '').slice(0, 300),
        to,
        delivered: false
      });
    })().catch(() => {});
  }
  function emitNotifyContribution(item) {
    (async () => {
      const repo = item.repo || activeRepo();
      const to = await curationRecipients(item.skillId, item.submittedBy && item.submittedBy.email, repo);
      if (!to.length) return;
      let skillName = '';
      if (item.skillId) skillName = await skillTitleForNotify(item.skillId);
      else {
        let entry = null;
        try {
          entry = await repoByName(repo);
        } catch (error) {
          entry = null;
        }
        skillName = `Triagem (${(entry && entry.titulo) || repo})`;
      }
      await appendNotifyEvent({
        id: notifyEventId(),
        ts: new Date().toISOString(),
        type: 'contribution',
        skillId: item.skillId,
        skillName,
        title: item.title || '',
        source: item.source || 'web',
        actorEmail: normEmail(item.submittedBy && item.submittedBy.email) || null,
        actorName: String((item.submittedBy && item.submittedBy.name) || '').trim() || null,
        to,
        delivered: false
      });
    })().catch(() => {});
  }

  return {
    refreshCorpusGroupsIndex,
    corpusGroupsForEmail,
    reqGroups,
    canCreateBuddyReq,
    canManageSkillReq,
    canReadSkillReq,
    normEmail,
    normEmailList,
    slugifyGroupName,
    loadGroup,
    listGroups,
    saveGroup,
    deleteGroup,
    loadRoster,
    loadAuthentikUsers,
    upsertRoster,
    loadSkillAccess,
    saveSkillAccess,
    loadCommonsAccess,
    writeCommonsAccessDoc,
    canReadCommonsActor,
    canManageCommonsActor,
    canReadCommonsReq,
    canManageCommonsReq,
    webActor,
    personalRepoSlug,
    actorIsAdmin,
    canReadSkillActor,
    canManageSkillActor,
    actorCuratesActiveRepo,
    notifyRecipientsForSkill,
    baldePeople,
    emitNotifyFeedback,
    emitNotifyContribution
  };
}
