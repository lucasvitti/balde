// Buddies (avatar) domain (modularization stage 5): load/list/serve buddy poses,
// plus the skills-using-a-buddy scan. Reads the git-versioned buddies corpus.
import { join, extname } from 'node:path';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buddiesRoot, skillsRoot, BUDDY_POSES, BUDDY_POSE_EXTS, mimeTypes } from './config.mjs';
import { pathExists } from './fs-utils.mjs';
import { commitRepo } from './git-corpus.mjs';
import { parseFrontmatter } from './skill-format.mjs';

export function assertSafeBuddyId(id) {
  if (!/^[a-zA-Z0-9._-]+$/.test(String(id || ''))) {
    throw new Error('buddy id invalido');
  }
}

export async function commitBuddies(message, actor = {}, paths) {
  return commitRepo(buddiesRoot, message, actor, paths);
}

// Themes: named pose+temperament variants (regular / christmas / carnival / …)
// A theme = a `poses.<name>/` folder and/or a per-theme temperament in buddy.json.themes.
// "regular" is the base (`poses/` + buddy.json.temperament). The ACTIVE theme is chosen
// globally (buddies/_theme.json) and can be overridden per-buddy (buddy.json.theme).
// Resolution everywhere: per-buddy override -> global -> regular, with per-code / base fallback.
export function safeTheme(t) {
  const s = String(t || '')
    .trim()
    .toLowerCase();
  if (!s || s === 'regular') {
    return '';
  } // '' == regular/default
  return /^[a-z0-9-]+$/.test(s) ? s : '';
}
// Per-buddy override sanitizer: '' = follow global, 'regular' = PIN to regular
// (distinct from following global), '<theme>' = pin to that theme.
export function safeThemeOverride(t) {
  const s = String(t || '')
    .trim()
    .toLowerCase();
  if (!s) {
    return '';
  }
  if (s === 'regular') {
    return 'regular';
  }
  return /^[a-z0-9-]+$/.test(s) ? s : '';
}
function posesDirName(theme) {
  const t = safeTheme(theme);
  return t ? 'poses.' + t : 'poses';
}
let _globalThemeCache = { value: null, at: 0 };
export async function loadGlobalTheme() {
  const now = Date.now();
  if (_globalThemeCache.value !== null && now - _globalThemeCache.at < 3000) {
    return _globalThemeCache.value;
  }
  let value = 'regular';
  const p = join(buddiesRoot, '_theme.json');
  if (await pathExists(p)) {
    try {
      value = safeTheme(JSON.parse(await readFile(p, 'utf8')).active) || 'regular';
    } catch (error) {
      value = 'regular';
    }
  }
  _globalThemeCache = { value, at: now };
  return value;
}
export async function saveGlobalTheme(theme, actor = {}) {
  const active = safeTheme(theme) || 'regular';
  await writeFile(join(buddiesRoot, '_theme.json'), JSON.stringify({ active }, null, 2) + '\n', 'utf8');
  _globalThemeCache = { value: active, at: Date.now() };
  await commitRepo(buddiesRoot, `buddies: tema global -> ${active}`, actor, ['_theme.json']);
  return active;
}
// Effective theme for a buddy manifest: per-buddy override (incl. 'regular' pin),
// else the global active theme.
async function effectiveTheme(manifest) {
  const ov = safeThemeOverride(manifest && (manifest.theme || manifest.Theme));
  if (ov === 'regular') {
    return 'regular';
  }
  return ov || (await loadGlobalTheme());
}
// Themed pose-set folders present for one buddy, e.g. ['carnival','christmas'].
export async function buddyThemes(id) {
  const dir = join(buddiesRoot, id);
  const out = [];
  if (!(await pathExists(dir))) {
    return out;
  }
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('poses.')) {
      const t = entry.name.slice('poses.'.length);
      if (safeTheme(t)) {
        out.push(t);
      }
    }
  }
  return out.sort();
}
// Every theme name in use across the corpus (folders OR temperaments) — for the admin picker.
export async function listAllThemes() {
  const set = new Set();
  if (await pathExists(buddiesRoot)) {
    for (const entry of await readdir(buddiesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.git') {
        continue;
      }
      for (const t of await buddyThemes(entry.name)) {
        set.add(t);
      }
      try {
        const m = JSON.parse(await readFile(join(buddiesRoot, entry.name, 'buddy.json'), 'utf8'));
        if (m.themes && typeof m.themes === 'object') {
          for (const k of Object.keys(m.themes)) {
            if (safeTheme(k)) {
              set.add(k);
            }
          }
        }
      } catch (error) {
        /* ignore */
      }
    }
  }
  return [...set].sort();
}

// Pose files present for one buddy: [{code, ext, bytes}] in canonical order.
export async function loadBuddyPoses(id) {
  const posesDir = join(buddiesRoot, id, 'poses');
  const poses = [];
  if (!(await pathExists(posesDir))) {
    return poses;
  }
  for (const entry of await readdir(posesDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const ext = extname(entry.name).toLowerCase();
    const code = entry.name.slice(0, entry.name.length - ext.length).toLowerCase();
    if (BUDDY_POSES.includes(code) && BUDDY_POSE_EXTS.includes(ext)) {
      let bytes = 0;
      try {
        bytes = (await stat(join(posesDir, entry.name))).size;
      } catch (error) {
        /* ignore */
      }
      poses.push({ code, ext, bytes });
    }
  }
  poses.sort((a, b) => BUDDY_POSES.indexOf(a.code) - BUDDY_POSES.indexOf(b.code));
  return poses;
}

export async function loadBuddy(id) {
  assertSafeBuddyId(id);
  const dir = join(buddiesRoot, id);
  if (!(await pathExists(dir))) {
    return null;
  }
  let manifest = {};
  const manifestPath = join(dir, 'buddy.json');
  if (await pathExists(manifestPath)) {
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
      manifest = {};
    }
  }
  const poses = await loadBuddyPoses(id);
  const buddyId = manifest.Id || manifest.id || id;
  const defaultPose =
    manifest.default_pose && BUDDY_POSES.includes(manifest.default_pose) ? manifest.default_pose : 'idle';
  const baseTemperament = manifest.temperament || manifest.Temperament || '';
  const themesMap = manifest.themes && typeof manifest.themes === 'object' ? manifest.themes : {};
  const themeTemperaments = {};
  for (const [k, v] of Object.entries(themesMap)) {
    const t = safeTheme(k);
    if (t && v && v.temperament) {
      themeTemperaments[t] = String(v.temperament);
    }
  }
  const override = safeThemeOverride(manifest.theme || manifest.Theme);
  const eff = override === 'regular' ? 'regular' : override || (await loadGlobalTheme());
  const effectiveTemperament = safeTheme(eff) && themeTemperaments[eff] ? themeTemperaments[eff] : baseTemperament;
  return {
    id: buddyId,
    name: manifest.Name || manifest.name || buddyId,
    description: manifest.Description || manifest.description || '',
    temperament: effectiveTemperament, // EFFECTIVE (chat/API consume this; follows the active theme)
    baseTemperament, // regular temperament (for the editor)
    themeTemperaments, // { theme: temperament } (for the editor)
    group: String(manifest.group || manifest.Group || '').trim() || 'Geral',
    theme: override, // per-buddy override ('' = follow global)
    effectiveTheme: eff, // 'regular' or a theme name
    default_pose: defaultPose,
    poses
  };
}

export async function listBuddies() {
  if (!(await pathExists(buddiesRoot))) {
    return [];
  }
  const out = [];
  for (const entry of await readdir(buddiesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.git') {
      continue;
    }
    const buddy = await loadBuddy(entry.name);
    if (buddy) {
      out.push(buddy);
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function toBuddySummary(buddy) {
  return {
    id: buddy.id,
    name: buddy.name,
    description: buddy.description,
    temperament: buddy.temperament,
    group: buddy.group,
    theme: buddy.theme,
    effectiveTheme: buddy.effectiveTheme,
    default_pose: buddy.default_pose,
    poses: buddy.poses.map((pose) => pose.code)
  };
}

// Skills whose SKILL.md frontmatter binds this buddy (buddy_id). Used to warn on
// delete and to flag skills as stale when their buddy disappears (presentation
// only — a dangling buddy never breaks skill execution).
export async function skillsUsingBuddy(buddyId) {
  const out = [];
  if (!buddyId || !(await pathExists(skillsRoot()))) {
    return out;
  }
  // Dual-mode: a skill is any dir with SKILL.md at depth 1 (flat) or 2 (<domain>/<slug>).
  // Stop at SKILL.md (don't descend into sidecars); don't filter by sidecar NAME — a domain
  // may be named like a sidecar (analytics/query/context).
  const scan = async (dir, id) => {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      return;
    }
    if (id && entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      try {
        const { meta } = parseFrontmatter(await readFile(join(dir, 'SKILL.md'), 'utf8'));
        if (meta.buddy_id === buddyId) {
          out.push({ id, nome: meta.title || meta.name || id });
        }
      } catch (error) {
        /* ignore unreadable skill */
      }
      return; // skill dir — do not descend into sidecars
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
      await scan(join(dir, e.name), id ? `${id}/${e.name}` : e.name);
    }
  };
  await scan(skillsRoot(), '');
  return out;
}

export async function resolvePoseFile(id, code) {
  assertSafeBuddyId(id);
  if (!BUDDY_POSES.includes(code)) {
    return null;
  }
  // Resolve the active theme (per-buddy override -> global), then look in the themed
  // folder first and fall back per-code to the regular `poses/` set.
  let manifest = {};
  try {
    manifest = JSON.parse(await readFile(join(buddiesRoot, id, 'buddy.json'), 'utf8'));
  } catch (error) {
    manifest = {};
  }
  const eff = await effectiveTheme(manifest);
  const dirs = [];
  if (safeTheme(eff)) {
    dirs.push(join(buddiesRoot, id, posesDirName(eff)));
  }
  dirs.push(join(buddiesRoot, id, 'poses'));
  for (const d of dirs) {
    for (const ext of BUDDY_POSE_EXTS) {
      const candidate = join(d, code + ext);
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

// Serve a pose image (shared by the keyed /api/v1 route and the SSO <img> route).
export async function servePoseImage(req, res, id, rawCode) {
  const code = String(rawCode || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '');
  let file = null;
  try {
    file = await resolvePoseFile(id, code);
  } catch (error) {
    file = null;
  }
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('pose not found');
    return;
  }
  const buffer = await readFile(file);
  const etag = '"' + createHash('sha1').update(buffer).digest('hex') + '"';
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }
  res.writeHead(200, {
    'content-type': mimeTypes[extname(file)] || 'application/octet-stream',
    'cache-control': 'public, max-age=300, must-revalidate',
    etag: etag
  });
  res.end(buffer);
}
