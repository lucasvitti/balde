import { execFile as spExecFile } from 'node:child_process';

import { join, normalize } from 'node:path';
import { rootDir, activeRepo } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { repoByName, isRepoCurator } from '../repos.mjs';

export function createOnedriveFeature({ reqGroups, webActor, listGroups, sendJson }) {
  const SP_CONFIGURED = Boolean(
    process.env.SP_SITE_URL && process.env.SP_CLIENT_ID && process.env.SP_LIBRARY && process.env.SP_ROOT_PATH
  );
  const SP_SCRIPT = process.env.SP_SCRIPT || join(rootDir, 'scripts', 'sharepoint', 'balde-sp.ps1');

  function runSharePointScript(args, timeoutMs = 180000) {
    return new Promise((resolve) => {
      const child = spExecFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SP_SCRIPT, ...args],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve({
            ok: !error,
            output: `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim(),
            error: error ? error.message : null
          });
        }
      );
      child.on('error', (e) => resolve({ ok: false, output: '', error: e.message }));
    });
  }
  // AI_MODE=none: this deployment makes NO LLM calls — AI flows through MCP clients (Claude/GPT)
  // against the machine tools; AI endpoints answer with guidance instead of calling providers.
  // BALDE_READONLY_CORPUS=1: user-role local install over a READ-ONLY OneDrive corpus share. Each
  // corpus write needs what src/security/permissions.mjs decides (curators with edit rights on the
  // balde's folder); contributions flow through the Fila or the user's outbox (exchange/<user>/queue).
  const AI_MODE = (process.env.AI_MODE || 'byok').toLowerCase();
  const READONLY_CORPUS = process.env.BALDE_READONLY_CORPUS === '1';

  // Who may APPLY to a balde's corpus from a read-only install: its curators as declared in the
  // balde's own manifest (balde-repo.json: owners, curators, curatorGroups) plus admins. A shared
  // balde migrated from the legacy registry is curated by the curator group; a personal balde or one
  // the user created is curated by its owner. Everyone else's contribution still reaches the
  // curator through the Fila. repoName is the queue item's stamped repo.
  async function canCurateRepo(req, repoName) {
    let entry = null;
    try {
      entry = await repoByName(
        String(repoName || '')
          .trim()
          .toLowerCase()
      );
    } catch {
      entry = null;
    }
    return isRepoCurator(entry, reqGroups(req), webActor(req).email);
  }

  // Curator of the ACTIVE balde: the global Curadores corps, plus the balde's own admins and curators
  // per its manifest, so whoever creates or owns a balde curates it without any global role. Admins
  // are per balde: the install's Admins group curates only the baldes that list it. Gates the
  // curation stations (Fila, feedback triage, merge review). For the corporate balde this is
  // unchanged: its manifest's curator group IS the global Curadores group.
  async function curatesActiveBaldeReq(req) {
    return canCurateRepo(req, activeRepo());
  }
  // Balde never talks to Microsoft. A balde's OWNER applies its access to the OneDrive/SharePoint
  // folder by running scripts/sharepoint/balde-acesso.ps1 in their own window, under their own
  // Microsoft login (Graph PowerShell, approved tenant-wide), so Balde can never grant more than the
  // owner could in SharePoint. The page writes a PLAN (balde-acesso-plano/1) that the script applies,
  // and reads back the RECEIPT the script writes. Plans and receipts live in the machine-local
  // runtime folder, never in the corpus. The script belongs to the OneDrive folder-management work;
  // this side owns the plan, the command shown to the owner and the receipt.
  const ACESSO_SCRIPT = join(rootDir, 'scripts', 'sharepoint', 'balde-acesso.ps1');
  const ACESSO_ID_RE = /^[pv]-\d{8}T\d{6}Z-[a-f0-9]{6}$/;
  const acessoRuntimeDir = (balde) =>
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Balde', 'runtime', 'acesso', balde) : null;
  const acessoStamp = () =>
    new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z');
  const acessoCommand = (args) => `pwsh -NoProfile -ExecutionPolicy Bypass -File "${ACESSO_SCRIPT}" ${args}`;

  async function acessoApplierAvailable() {
    return Boolean(process.env.LOCALAPPDATA) && (await pathExists(ACESSO_SCRIPT));
  }

  // OneDrive sync mounts on this machine, read from the OneDrive sync engine (the same source the
  // applier script resolves folders with): MountPoint + UrlNamespace per library. SharePoint
  // libraries synced or added via "Add shortcut to My files" register as their OWN mount, nested
  // inside the business OneDrive root, so a folder resolves by the LONGEST matching mount. Cached
  // for 5 minutes. BALDE_ONEDRIVE_MOUNTS ("mount|url;mount|url") overrides it for tests;
  // OneDriveCommercial is the fallback when the registry has nothing.
  let oneDriveMountsCache = null;
  let oneDriveMountsAt = 0;
  async function oneDriveMounts() {
    if (oneDriveMountsCache && Date.now() - oneDriveMountsAt < 300000) return oneDriveMountsCache;
    let found = [];
    if (process.env.BALDE_ONEDRIVE_MOUNTS) {
      found = process.env.BALDE_ONEDRIVE_MOUNTS.split(';').map((pair) => {
        const [mount, url] = pair.split('|');
        return { mount, url };
      });
    } else if (process.platform === 'win32') {
      const stdout = await new Promise((done) => {
        spExecFile(
          'reg',
          ['query', 'HKCU\\Software\\SyncEngines\\Providers\\OneDrive', '/s'],
          { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 },
          (error, out) => done(error ? '' : String(out || ''))
        );
      });
      let cur = null;
      for (const line of stdout.split(/\r?\n/)) {
        if (/^HKEY_/i.test(line)) {
          cur = {};
          found.push(cur);
          continue;
        }
        const m = line.match(/^\s+(MountPoint|UrlNamespace)\s+REG_\w+\s+(.+?)\s*$/);
        if (m && cur) cur[m[1] === 'MountPoint' ? 'mount' : 'url'] = m[2];
      }
    }
    let mounts = found
      .filter((x) => x && x.mount && /^https:\/\//i.test(x.url || ''))
      .map((x) => ({ mount: normalize(x.mount), url: x.url }));
    if (!mounts.length && process.env.OneDriveCommercial)
      mounts = [{ mount: normalize(process.env.OneDriveCommercial), url: 'https://' }];
    oneDriveMountsCache = mounts;
    oneDriveMountsAt = Date.now();
    return mounts;
  }

  // True when the folder sits in a BUSINESS OneDrive/SharePoint library the applier can act on. A
  // personal Microsoft account (d.docs.live.net) is outside the tenant: the script rejects it.
  async function isOnOneDrive(dir) {
    if (!dir) return false;
    const d = normalize(dir)
      .toLowerCase()
      .replace(/[\\/]+$/, '');
    let best = null;
    for (const m of await oneDriveMounts()) {
      const r = m.mount.toLowerCase().replace(/[\\/]+$/, '');
      const inside = d === r || d.startsWith(`${r}\\`) || d.startsWith(`${r}/`);
      if (inside && (!best || r.length > best.len)) best = { len: r.length, url: m.url };
    }
    return Boolean(best) && !/d\.docs\.live\.net/i.test(best.url);
  }

  // A balde's access expanded into the plan's e-mail lists. Balde groups come from
  // corpus/groups/*.yml (matched by display name or slug); a group with no known members is reported
  // in unresolvedGroups instead of silently granting nobody.
  async function acessoPlanLists(access) {
    const groups = await listGroups().catch(() => []);
    const unresolved = new Set();
    const expand = (names) => {
      const out = [];
      for (const n of names || []) {
        const key = String(n).trim().toLowerCase();
        const g = groups.find((x) => x.name.trim().toLowerCase() === key || x.slug === key);
        if (g && g.members.length) out.push(...g.members);
        else unresolved.add(String(n));
      }
      return out;
    };
    const norm = (list) => [...new Set(list.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
    const write = norm([
      ...(access.owners || []),
      ...expand(access.adminGroups),
      ...(access.curators || []),
      ...expand(access.curatorGroups)
    ]);
    const read = norm([...(access.members || []), ...expand(access.groups)]).filter((e) => !write.includes(e));
    return { write, read, owners: norm(access.owners || []), unresolvedGroups: [...unresolved] };
  }

  function aiModeNone(res) {
    if (AI_MODE !== 'none') return false;
    sendJson(res, 400, {
      ok: false,
      error:
        'Esta instalação não chama provedores de IA diretamente (AI_MODE=none). Use o Claude/ChatGPT conectado via MCP — as ferramentas balde_* leem o corpus e enviam contribuições para a Fila.'
    });
    return true;
  }

  return {
    SP_CONFIGURED,
    runSharePointScript,
    AI_MODE,
    READONLY_CORPUS,
    canCurateRepo,
    curatesActiveBaldeReq,
    ACESSO_ID_RE,
    acessoRuntimeDir,
    acessoStamp,
    acessoCommand,
    acessoApplierAvailable,
    isOnOneDrive,
    acessoPlanLists,
    aiModeNone
  };
}
