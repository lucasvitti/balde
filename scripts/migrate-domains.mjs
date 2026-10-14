// One-time migration: flat skill ids (skills/<slug>/) → folder-based governed domains
// (skills/<domain>/<slug>/, so a skill id becomes <domain>/<slug>). Pairs with the dual-mode
// loader shipped in Phases A–D. Idempotent-ish: skips skills already nested; safe to re-run.
//
//   Domain for each flat skill = normalized first `tags:` entry (else `geral`); every target
//   domain is added to the governed vocab (_domains.json). Then it:
//     1. moves skills/<slug>/         → skills/<domain>/<slug>/
//     2. moves governance/skills/<slug>/ → governance/skills/<domain>/<slug>/ (if present)
//     3. strips the `tags:` line from each moved SKILL.md (tags are gone)
//     4. remaps every stored old-id reference: chats.skillIds, plenárias.skillIds,
//        feedback `skillId`, usage `skill` (+ deletes rollup.json to force rebuild),
//        and `/<oldid>/…` content links inside every SKILL.md + context/*.md corpus-wide.
//
// Modes:  --dry-run (default) reports the mapping + reference counts, writes NOTHING.
//         --apply performs the migration. --map <file> writes/reads an explicit mapping JSON.
//
// Roots come from src/config.mjs (same env resolution as the server), so run it with the same
// env as the container (in prod: `docker exec -e ... balde node scripts/migrate-domains.mjs`).

import { readdir, readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { skillsRoot, governanceOutputRoot, usersRoot, plenariasRoot, usageRoot, logsRoot, commonsRoot } from '../src/config.mjs';

const APPLY = process.argv.includes('--apply');
const mapArgIdx = process.argv.indexOf('--map');
const mapFile = mapArgIdx >= 0 ? process.argv[mapArgIdx + 1] : null;
const log = (...a) => console.log(...a);

function normalizeDomain(value) {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^[-]+|[-]+$/g, '')
    .slice(0, 60);
}

// First `tags:` entry from SKILL.md frontmatter (accepts `[a, b]` or `"[a, b]"` or `a, b`).
function firstTag(md) {
  const m = String(md).match(/^tags:\s*(.+)$/m);
  if (!m) return '';
  const raw = m[1].trim().replace(/^["']|["']$/g, '').replace(/^\[|\]$/g, '');
  const first = raw.split(/[,;]/)[0].trim().replace(/^["']|["']$/g, '');
  return first;
}

async function pathExists(p) { try { return existsSync(p); } catch { return false; } }

// Flat skills = dirs directly under skillsRoot() with SKILL.md (depth 1), excluding reserved/hidden.
async function listFlatSkills() {
  let entries = [];
  try { entries = await readdir(skillsRoot(), { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
    if (await pathExists(join(skillsRoot(), e.name, 'SKILL.md'))) out.push(e.name); // depth-1 SKILL.md = flat
  }
  return out;
}

// Recursively list every SKILL.md + context/*.md file path (for content-link rewriting), post-move.
async function listCorpusTextFiles(dir) {
  const out = [];
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.git') continue;
      out.push(...await listCorpusTextFiles(full));
    } else if (/\.md$/i.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

async function readJson(p, fallback) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } }

async function main() {
  log(`# migrate-domains ${APPLY ? '(APPLY)' : '(dry-run)'}`);
  log(`skillsRoot     = ${skillsRoot()}`);
  log(`governanceRoot = ${governanceOutputRoot()}`);
  log('');

  // 1) Build the mapping oldFlatId -> { domain, newId }.
  const flat = await listFlatSkills();
  let mapping = {};
  if (mapFile && await pathExists(mapFile)) {
    mapping = await readJson(mapFile, {});
    log(`Loaded mapping from ${mapFile} (${Object.keys(mapping).length} entries).`);
  } else {
    for (const id of flat) {
      const md = await readFile(join(skillsRoot(), id, 'SKILL.md'), 'utf8').catch(() => '');
      const domain = normalizeDomain(firstTag(md)) || 'geral';
      mapping[id] = { domain, newId: `${domain}/${id}` };
    }
    if (mapFile) { await writeFile(mapFile, JSON.stringify(mapping, null, 2), 'utf8'); log(`Wrote proposed mapping → ${mapFile} (edit + re-run with --map to override).`); }
  }

  log(`\n## Proposed mapping (${Object.keys(mapping).length} flat skills → domains)`);
  for (const [oldId, m] of Object.entries(mapping)) log(`  ${oldId}  →  ${m.newId}`);
  if (!Object.keys(mapping).length) { log('\n(no flat skills to migrate — nothing to do)'); return; }

  // 2) Ensure every target domain is in the governed vocabulary.
  const domainsPath = join(skillsRoot(), '_domains.json');
  const vocab = new Set((await readJson(domainsPath, [])).map(normalizeDomain).filter(Boolean));
  const targetDomains = new Set(Object.values(mapping).map((m) => m.domain));
  const added = [...targetDomains].filter((d) => !vocab.has(d));
  log(`\n## Vocabulary: ${added.length ? `will ADD ${added.join(', ')}` : 'all target domains already present'}`);

  // 3) Count references that will be remapped (dry-run insight).
  const oldToNew = new Map(Object.entries(mapping).map(([o, m]) => [o, m.newId]));
  const remapArr = (arr) => (Array.isArray(arr) ? arr.map((x) => oldToNew.get(String(x)) || x) : arr);
  const countRefs = async () => {
    let chats = 0, plens = 0, usageLines = 0, fb = 0, links = 0;
    // chats
    try { for (const u of await readdir(usersRoot, { withFileTypes: true })) {
      if (!u.isDirectory()) continue; const cdir = join(usersRoot, u.name, 'chats');
      for (const c of (await readdir(cdir, { withFileTypes: true }).catch(() => []))) {
        if (!c.isFile() || !c.name.endsWith('.json')) continue;
        const j = await readJson(join(cdir, c.name), null);
        if (j && Array.isArray(j.skillIds) && j.skillIds.some((x) => oldToNew.has(String(x)))) chats += 1;
      }
    } } catch {}
    // plenárias
    try { for (const p of await readdir(plenariasRoot, { withFileTypes: true }).catch(() => [])) {
      if (!p.isFile() || !p.name.endsWith('.json')) continue;
      const j = await readJson(join(plenariasRoot, p.name), null);
      if (j && Array.isArray(j.skillIds) && j.skillIds.some((x) => oldToNew.has(String(x)))) plens += 1;
    } } catch {}
    // content links
    for (const f of await listCorpusTextFiles(skillsRoot())) {
      const t = await readFile(f, 'utf8').catch(() => '');
      if ([...oldToNew.keys()].some((o) => t.includes(`/${o}/`) || t.includes(`(${o}/`))) links += 1;
    }
    return { chats, plens, usageLines, fb, links };
  };
  const refs = await countRefs();
  log(`\n## References to remap: chats=${refs.chats} · plenárias=${refs.plens} · content-link files=${refs.links}`);

  if (!APPLY) { log('\n(dry-run — no changes written. Re-run with --apply to migrate.)'); return; }

  // ---- APPLY ----
  log('\n## APPLYING…');
  // 2b) write vocab
  if (added.length) { await writeFile(domainsPath, `${JSON.stringify([...new Set([...vocab, ...targetDomains])].sort(), null, 2)}\n`, 'utf8'); log(`  vocab: added ${added.join(', ')}`); }

  // 1) move skill folders + strip tags from the moved SKILL.md
  for (const [oldId, m] of Object.entries(mapping)) {
    const from = join(skillsRoot(), oldId), to = join(skillsRoot(), m.newId);
    if (await pathExists(to)) { log(`  SKIP ${oldId} (target exists)`); continue; }
    await mkdir(join(skillsRoot(), m.domain), { recursive: true });
    await rename(from, to);
    const smd = join(to, 'SKILL.md');
    const md = await readFile(smd, 'utf8').catch(() => '');
    if (md) await writeFile(smd, md.replace(/^tags:.*\r?\n/m, ''), 'utf8'); // drop the tags: line
    // governance folder
    const gfrom = join(governanceOutputRoot(), oldId), gto = join(governanceOutputRoot(), m.newId);
    if (await pathExists(gfrom) && !(await pathExists(gto))) { await mkdir(join(governanceOutputRoot(), m.domain), { recursive: true }); await rename(gfrom, gto); }
    log(`  moved ${oldId} → ${m.newId}`);
  }

  // 4) remap chats.skillIds
  try { for (const u of await readdir(usersRoot, { withFileTypes: true })) {
    if (!u.isDirectory()) continue; const cdir = join(usersRoot, u.name, 'chats');
    for (const c of (await readdir(cdir, { withFileTypes: true }).catch(() => []))) {
      if (!c.isFile() || !c.name.endsWith('.json')) continue;
      const fp = join(cdir, c.name); const j = await readJson(fp, null);
      if (j && Array.isArray(j.skillIds) && j.skillIds.some((x) => oldToNew.has(String(x)))) { j.skillIds = remapArr(j.skillIds); await writeFile(fp, JSON.stringify(j, null, 2), 'utf8'); }
    }
  } } catch {}
  // remap plenárias.skillIds
  try { for (const p of await readdir(plenariasRoot, { withFileTypes: true }).catch(() => [])) {
    if (!p.isFile() || !p.name.endsWith('.json')) continue;
    const fp = join(plenariasRoot, p.name); const j = await readJson(fp, null);
    if (j && Array.isArray(j.skillIds) && j.skillIds.some((x) => oldToNew.has(String(x)))) { j.skillIds = remapArr(j.skillIds); await writeFile(fp, JSON.stringify(j, null, 2), 'utf8'); }
  } } catch {}
  // remap usage jsonl `skill` field + drop rollup.json (rebuilds on next read)
  try { for (const uf of await readdir(usageRoot, { withFileTypes: true }).catch(() => [])) {
    if (!uf.isFile() || !uf.name.endsWith('.jsonl')) continue;
    const fp = join(usageRoot, uf.name); const lines = (await readFile(fp, 'utf8').catch(() => '')).split('\n');
    let changed = false;
    const out = lines.map((ln) => { if (!ln.trim()) return ln; try { const o = JSON.parse(ln); if (o && oldToNew.has(String(o.skill))) { o.skill = oldToNew.get(String(o.skill)); changed = true; return JSON.stringify(o); } } catch {} return ln; });
    if (changed) await writeFile(fp, out.join('\n'), 'utf8');
  } } catch {}
  try { const rp = join(usageRoot, 'rollup.json'); if (await pathExists(rp)) await rm(rp); } catch {}
  // remap feedback jsonl `skillId` field
  try { const fdir = join(logsRoot, 'feedback'); for (const ff of await readdir(fdir, { withFileTypes: true }).catch(() => [])) {
    if (!ff.isFile() || !ff.name.endsWith('.jsonl')) continue;
    const fp = join(fdir, ff.name); const lines = (await readFile(fp, 'utf8').catch(() => '')).split('\n');
    let changed = false;
    const out = lines.map((ln) => { if (!ln.trim()) return ln; try { const o = JSON.parse(ln); if (o && oldToNew.has(String(o.skillId))) { o.skillId = oldToNew.get(String(o.skillId)); changed = true; return JSON.stringify(o); } } catch {} return ln; });
    if (changed) await writeFile(fp, out.join('\n'), 'utf8');
  } } catch {}

  // 4b) rewrite content links `/<oldid>/…` and `](oldid/…)` in every corpus .md
  let linkFiles = 0;
  for (const f of await listCorpusTextFiles(skillsRoot())) {
    let t = await readFile(f, 'utf8').catch(() => ''); if (!t) continue; let changed = false;
    for (const [oldId, newId] of oldToNew) {
      if (t.includes(`/${oldId}/`)) { t = t.split(`/${oldId}/`).join(`/${newId}/`); changed = true; }
    }
    if (changed) { await writeFile(f, t, 'utf8'); linkFiles += 1; }
  }
  log(`  content links rewritten in ${linkFiles} file(s)`);
  log('\n## DONE. Verify the catalog + a sample skill, then commit the corpus + governance repos.');
}

main().catch((e) => { console.error('MIGRATION FAILED:', e); process.exit(1); });
