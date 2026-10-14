import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { usageRoot, activeRepo } from '../config.mjs';
import { buildDigestEmail } from '../notify.mjs';

export function createUsageFeature({
  usageSkillKey,
  loadRoster,
  normEmail,
  loadUserPrefs,
  loadSkillsFromDisk,
  listQueueItems,
  canManageSkillActor,
  actorCuratesActiveRepo
}) {
  const USAGE_ROLLUP_PATH = join(usageRoot, 'rollup.json');
  function usageMonthFile(d) {
    return join(usageRoot, `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}.jsonl`);
  }
  function emptyUsageRollup() {
    return { version: 1, updatedAt: null, totals: { api: 0, skill: 0 }, byUser: {}, byApi: {}, bySkill: {} };
  }
  let usageRollupCache = null; // authoritative in-memory rollup once loaded (single process)
  let usageChain = Promise.resolve(); // serializes append + rollup RMW
  async function loadUsageRollup() {
    if (usageRollupCache) return usageRollupCache;
    try {
      const parsed = JSON.parse(await readFile(USAGE_ROLLUP_PATH, 'utf8'));
      usageRollupCache = parsed && parsed.byUser ? parsed : emptyUsageRollup();
    } catch (error) {
      usageRollupCache = emptyUsageRollup();
    }
    return usageRollupCache;
  }
  function usageActorLabel(actor) {
    if (!actor) return null;
    return actor.email || actor.username || actor.name || null;
  }
  function bumpUsageUser(r, who, family, ts) {
    if (!who) return;
    const u = (r.byUser[who] ||= { api: 0, skill: 0, lastAt: null });
    u[family] = (u[family] || 0) + 1;
    u.lastAt = ts;
  }
  function applyUsageEvent(r, ev) {
    r.updatedAt = ev.ts;
    const who = usageActorLabel(ev.actor);
    if (ev.kind === 'api') {
      r.totals.api = (r.totals.api || 0) + 1;
      const a = (r.byApi[ev.path] ||= { count: 0, byStatus: {}, users: {}, lastAt: null });
      a.count += 1;
      a.lastAt = ev.ts;
      a.byStatus[ev.status] = (a.byStatus[ev.status] || 0) + 1;
      if (who) a.users[who] = (a.users[who] || 0) + 1;
      bumpUsageUser(r, who, 'api', ev.ts);
    } else if (ev.kind === 'skill') {
      r.totals.skill = (r.totals.skill || 0) + 1;
      const s = (r.bySkill[usageSkillKey(ev.skill, ev.repo)] ||= {
        view: 0,
        consume: 0,
        chat: 0,
        contribute: 0,
        total: 0,
        bySource: { app: 0, machine: 0 },
        users: {},
        lastAt: null
      });
      if (typeof s[ev.event] !== 'number') s[ev.event] = 0;
      s[ev.event] += 1;
      s.total += 1;
      s.lastAt = ev.ts;
      s.bySource[ev.source] = (s.bySource[ev.source] || 0) + 1;
      if (who) s.users[who] = (s.users[who] || 0) + 1;
      bumpUsageUser(r, who, 'skill', ev.ts);
    }
  }
  function recordUsage(ev) {
    ev.ts = ev.ts || new Date().toISOString();
    ev.repo = ev.repo || activeRepo(); // R2: usage is repo-scoped (legacy events = corporate)
    usageChain = usageChain.then(async () => {
      try {
        await mkdir(usageRoot, { recursive: true });
        await writeFile(usageMonthFile(new Date()), `${JSON.stringify(ev)}\n`, { flag: 'a' });
        const r = await loadUsageRollup();
        applyUsageEvent(r, ev);
        await writeFile(USAGE_ROLLUP_PATH, JSON.stringify(r));
      } catch (error) {
        /* swallow — telemetry must never affect serving */
      }
    });
    return usageChain;
  }
  function recordApiCall({ method, path, status, ms, actor }) {
    return recordUsage({
      kind: 'api',
      source: 'machine',
      method,
      path,
      status,
      ms,
      actor: actor ? { email: actor.email || null, username: actor.username || null, via: actor.via || null } : null
    });
  }
  function recordSkillEvent(event, skill, source, actor) {
    const id = String(skill || '').trim();
    if (!id) return Promise.resolve();
    return recordUsage({
      kind: 'skill',
      event,
      skill: id,
      source,
      actor: actor ? { email: actor.email || null, username: actor.username || null } : null
    });
  }
  // Normalize a concrete /api/v1 path to its route template so the byApi rollup groups
  // by endpoint (and its keys match the EXPOSED_APIS catalog: `${method} ${path}`).
  function apiRouteTemplate(method, pathname) {
    let p = pathname.replace(/\/+$/, '') || pathname;
    p = p
      .replace(/^\/api\/v1\/skills\/.+?\/query-run$/, '/api/v1/skills/{id}/query-run')
      .replace(/^\/api\/v1\/skills\/.+?\/data-inspect$/, '/api/v1/skills/{id}/data-inspect')
      .replace(/^\/api\/v1\/skills\/[^/]+\/context\/.+$/, '/api/v1/skills/{id}/context/{path}')
      .replace(/^\/api\/v1\/skills\/[^/]+\/context$/, '/api/v1/skills/{id}/context')
      .replace(/^\/api\/v1\/skills\/.+\/files\/[^/]+$/, '/api/v1/skills/{id}/files/{name}')
      .replace(/^\/api\/v1\/skills\/.+\/files$/, '/api/v1/skills/{id}/files')
      .replace(/^\/api\/v1\/skills\/[^/]+$/, '/api/v1/skills/{id}')
      .replace(/^\/api\/v1\/commons\/.+\/files\/[^/]+$/, '/api/v1/commons/{path}/files/{name}')
      .replace(/^\/api\/v1\/commons\/.+\/files$/, '/api/v1/commons/{path}/files')
      .replace(/^\/api\/v1\/commons\/.+$/, '/api/v1/commons/{path}')
      .replace(/^\/api\/v1\/buddies\/[^/]+\/poses\/[^/]+$/, '/api/v1/buddies/{id}/poses/{pose}')
      .replace(/^\/api\/v1\/buddies\/[^/]+$/, '/api/v1/buddies/{id}');
    return `${method} ${p}`;
  }
  // Compact rollup for the admin panel: leaderboards + per-endpoint counts.
  async function usageSummary() {
    const r = await loadUsageRollup();
    const topUsers = Object.entries(r.byUser)
      .map(([who, v]) => ({
        who,
        api: v.api || 0,
        skill: v.skill || 0,
        total: (v.api || 0) + (v.skill || 0),
        lastAt: v.lastAt
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
    const topSkills = Object.entries(r.bySkill)
      .map(([skill, v]) => ({
        skill,
        view: v.view || 0,
        consume: v.consume || 0,
        chat: v.chat || 0,
        contribute: v.contribute || 0,
        total: v.total || 0,
        bySource: v.bySource || { app: 0, machine: 0 },
        users: Object.keys(v.users || {}).length,
        lastAt: v.lastAt
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 25);
    const byApi = Object.entries(r.byApi)
      .map(([path, v]) => ({
        path,
        count: v.count || 0,
        users: Object.keys(v.users || {}).length,
        byStatus: v.byStatus || {},
        lastAt: v.lastAt
      }))
      .sort((a, b) => b.count - a.count);
    return { updatedAt: r.updatedAt, totals: r.totals || { api: 0, skill: 0 }, topUsers, topSkills, byApi };
  }
  // Per-skill counts for the skill's own governance card ("the count on the skill side").
  async function usageForSkill(id) {
    const r = await loadUsageRollup();
    const v = r.bySkill[usageSkillKey(id)];
    if (!v)
      return {
        total: 0,
        view: 0,
        consume: 0,
        chat: 0,
        contribute: 0,
        bySource: { app: 0, machine: 0 },
        users: 0,
        lastAt: null
      };
    return {
      total: v.total || 0,
      view: v.view || 0,
      consume: v.consume || 0,
      chat: v.chat || 0,
      contribute: v.contribute || 0,
      bySource: v.bySource || { app: 0, machine: 0 },
      users: Object.keys(v.users || {}).length,
      lastAt: v.lastAt
    };
  }
  const NOTIFY_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:8098';
  // A relative "/api/..." link is useless to an MCP assistant on another host — it cannot turn it
  // into something the user can open. Prefix in-app paths with the deployment's public base so the
  // file-asset links the machine API hands back (/api/v1/files) are absolute and clickable. Same base
  // the notification emails use; leaves already-absolute or empty values untouched.
  function pubUrl(p) {
    const s = String(p || '');
    return s.startsWith('/') ? `${NOTIFY_BASE_URL}${s}` : s;
  }
  // Skill-event counts inside a trailing window, from the current + previous month JSONLs
  // (the rollup is all-time, so the digest's "last 7 days" needs the raw trail).
  async function usageWindowBySkill(days) {
    const cutoff = Date.now() - days * 86400000;
    const counts = new Map();
    const now = new Date();
    for (const d of [new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), now]) {
      let text = '';
      try {
        text = await readFile(usageMonthFile(d), 'utf8');
      } catch (error) {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch (error) {
          continue;
        }
        if (!ev || ev.kind !== 'skill' || !ev.skill) continue;
        if (Date.parse(ev.ts || 0) < cutoff) continue;
        counts.set(ev.skill, (counts.get(ev.skill) || 0) + 1);
      }
    }
    return counts;
  }
  async function buildNotifyDigestEmails() {
    const roster = await loadRoster();
    const optedIn = [];
    for (const person of roster) {
      const email = normEmail(person.email);
      if (!email) continue;
      const prefs = await loadUserPrefs({ email });
      if (prefs.notify && prefs.notify.digest) {
        // Groups come from the roster's login snapshot — lets canManageSkillActor honor
        // admin/global-curator standing without an Authentik round-trip.
        optedIn.push({ email, name: person.name || email, groups: Array.isArray(person.groups) ? person.groups : [] });
      }
    }
    if (!optedIn.length) return [];
    const skills = await loadSkillsFromDisk();
    const pending = (await listQueueItems()).filter((i) => (i.status || 'pendente') === 'pendente');
    const usage7 = await usageWindowBySkill(7);
    const emails = [];
    for (const user of optedIn) {
      const actor = { email: user.email, name: user.name, groups: user.groups };
      const manage = new Map();
      for (const s of skills) manage.set(s.id, await canManageSkillActor(s.id, actor));
      const mySkills = skills.filter((s) => manage.get(s.id));
      const owned = skills.filter((s) => normEmail(s.owner && s.owner.email) === user.email);
      // Unassigned items (no skillId) are triage work for the global curator corps.
      const globalTriage = await actorCuratesActiveRepo(actor); // unassigned items: the balde's curators
      const contribs = pending.filter((i) => (i.skillId ? manage.get(i.skillId) : globalTriage));
      const drafts = mySkills.filter((s) => s.status === 'rascunho').map((s) => ({ id: s.id, nome: s.nome }));
      const feedbacks = mySkills
        .filter((s) => (s.feedback || []).length)
        .map((s) => ({ skillId: s.id, nome: s.nome, count: s.feedback.length }));
      const feedbackTotal = feedbacks.reduce((n, f) => n + f.count, 0);
      const usageBase = owned.length ? owned : mySkills; // creators see their own; pure curators see managed
      const usageEntries = usageBase
        .map((s) => ({ skillId: s.id, count: usage7.get(s.id) || 0 }))
        .filter((x) => x.count > 0)
        .sort((a, b) => b.count - a.count);
      const usage7d = { total: usageEntries.reduce((n, x) => n + x.count, 0), top: usageEntries.slice(0, 3) };
      if (!contribs.length && !drafts.length && !feedbackTotal && !usage7d.total) continue; // skip empty digests
      const digest = {
        name: user.name,
        pendingCount: contribs.length,
        pendingContribs: contribs
          .slice(0, 5)
          .map((i) => ({ title: i.title, skillId: i.skillId || '(sem skill — triagem)' })),
        drafts,
        feedbacks,
        feedbackTotal,
        usage7d
      };
      emails.push({ to: user.email, ...buildDigestEmail(digest, NOTIFY_BASE_URL) });
    }
    return emails;
  }

  return {
    usageActorLabel,
    recordApiCall,
    recordSkillEvent,
    apiRouteTemplate,
    usageSummary,
    usageForSkill,
    NOTIFY_BASE_URL,
    pubUrl,
    buildNotifyDigestEmails
  };
}
