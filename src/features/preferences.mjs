import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decryptSecret, encryptSecret } from '../../scripts/secrets.mjs';
import { usersRoot, AI_PROVIDERS } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { REPO_NAME_RE } from '../repos.mjs';
import { isCliProvider } from '../ai-cli.mjs';

export function createPreferencesFeature({}) {
  function userAiId(actor) {
    const raw = String((actor && actor.email) || '')
      .trim()
      .toLowerCase();
    const slug = raw.replace(/[^a-z0-9._@-]+/g, '_').replace(/^_+|_+$/g, '');
    return slug || null;
  }

  function userAiDir(actor) {
    const id = userAiId(actor);
    return id ? join(usersRoot, id) : null;
  }

  async function loadUserAiConfig(actor) {
    const dir = userAiDir(actor);
    if (!dir) {
      return null;
    }
    const cliDefault = (process.env.AI_MODE || '').toLowerCase() === 'cli';
    const metaPath = join(dir, 'ai.json');
    if (!(await pathExists(metaPath))) {
      // AI_MODE=cli: sem config salva, o padrão é o Claude Code local — funciona sem setup.
      return cliDefault ? { provider: 'claude-cli', model: '', baseUrl: '', apiKey: 'cli', updatedAt: null } : null;
    }
    let meta = {};
    try {
      meta = JSON.parse(await readFile(metaPath, 'utf8'));
    } catch (error) {
      meta = {};
    }
    const provider = AI_PROVIDERS.includes(meta.provider) ? meta.provider : cliDefault ? 'claude-cli' : 'openai';
    if (isCliProvider(provider)) {
      // apiKey='cli' é SENTINELA (nunca enviada a lugar nenhum): satisfaz os guards
      // `!aiConfig.apiKey` espalhados; o ai-provider desvia para o CLI antes de usá-la.
      return { provider, model: meta.model || '', baseUrl: '', apiKey: 'cli', updatedAt: meta.updatedAt || null };
    }
    let apiKey = null;
    const keyPath = join(dir, 'ai-key.enc.json');
    if (process.env.BALDE_SECRET_KEY && (await pathExists(keyPath))) {
      try {
        apiKey = await decryptSecret({ inputPath: keyPath, secretKey: process.env.BALDE_SECRET_KEY });
      } catch (error) {
        apiKey = null;
      }
    }
    return {
      provider,
      model: meta.model || '',
      baseUrl: meta.baseUrl || '',
      apiKey,
      updatedAt: meta.updatedAt || null
    };
  }

  async function userAiStatus(actor) {
    const cfg = await loadUserAiConfig(actor);
    const cliDefault = (process.env.AI_MODE || '').toLowerCase() === 'cli';
    const provider = cfg?.provider || (cliDefault ? 'claude-cli' : 'openai');
    const cli = isCliProvider(provider);
    return {
      provider,
      model: cfg?.model || '',
      baseUrl: cfg?.baseUrl || '',
      keySet: cli ? false : Boolean(cfg?.apiKey),
      cli,
      encryptionAvailable: Boolean(process.env.BALDE_SECRET_KEY),
      updatedAt: cfg?.updatedAt || null
    };
  }

  async function saveUserAiConfig(actor, { provider, model, baseUrl, apiKey, clearKey }) {
    const dir = userAiDir(actor);
    if (!dir) {
      throw new Error('Identidade do usuário não disponível.');
    }
    const chosen = AI_PROVIDERS.includes(provider) ? provider : 'openai';
    await mkdir(dir, { recursive: true });
    const meta = {
      provider: chosen,
      model: String(model || '').trim(),
      baseUrl: chosen === 'compatible' ? String(baseUrl || '').trim() : '',
      updatedAt: new Date().toISOString()
    };
    await writeFile(join(dir, 'ai.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

    const keyPath = join(dir, 'ai-key.enc.json');
    if (clearKey) {
      await rm(keyPath, { force: true });
    } else if (!isCliProvider(chosen) && apiKey && String(apiKey).trim()) {
      // provedores CLI não têm chave — qualquer valor digitado é ignorado
      if (!process.env.BALDE_SECRET_KEY) {
        throw new Error('Servidor sem BALDE_SECRET_KEY: não é possível salvar a chave com segurança.');
      }
      await encryptSecret({
        plaintext: String(apiKey).trim(),
        outputPath: keyPath,
        secretKey: process.env.BALDE_SECRET_KEY,
        label: `ai-key:${chosen}`
      });
    }
    return userAiStatus(actor);
  }
  const THEME_MODES = ['light', 'dark', 'system'];
  const BUDDY_SIZES = ['small', 'medium', 'large', 'off'];
  const DEFAULT_BUDDY_SIZE = 'medium';

  const DEFAULT_NOTIFY_PREFS = { digest: true, perItem: true, desktop: true }; // ON by default (opt-out): unticking the box is what stores false
  function normNotifyPrefs(value) {
    // Absent key (new users AND prefs.json written before this feature) → default ON;
    // only an explicit stored `false` turns a channel off.
    if (!value || typeof value !== 'object') return { ...DEFAULT_NOTIFY_PREFS };
    return { digest: value.digest !== false, perItem: value.perItem !== false, desktop: value.desktop !== false };
  }
  async function loadUserPrefs(actor) {
    const fallback = {
      theme: 'system',
      buddySize: DEFAULT_BUDDY_SIZE,
      graph: null,
      layout: null,
      repo: null,
      notify: { ...DEFAULT_NOTIFY_PREFS }
    };
    const dir = userAiDir(actor);
    if (!dir) {
      return fallback;
    }
    const prefsPath = join(dir, 'prefs.json');
    if (!(await pathExists(prefsPath))) {
      return fallback;
    }
    try {
      const meta = JSON.parse(await readFile(prefsPath, 'utf8'));
      return {
        theme: THEME_MODES.includes(meta.theme) ? meta.theme : 'system',
        buddySize: BUDDY_SIZES.includes(meta.buddySize) ? meta.buddySize : DEFAULT_BUDDY_SIZE,
        // Grafo (Mapa de conhecimento) view prefs: an opaque client-owned object (layout/color/
        // size/cluster choices + the style editor). Validated as a small plain object on save.
        graph: meta.graph && typeof meta.graph === 'object' && !Array.isArray(meta.graph) ? meta.graph : null,
        // UI layout chrome (start page, sidebar/nav collapse, rail, docs width, column widths,
        // buddy-group collapse): an opaque client-owned map of localStorage key → value, so the
        // look-&-feel follows the user across devices. Validated as a small plain object on save.
        layout: meta.layout && typeof meta.layout === 'object' && !Array.isArray(meta.layout) ? meta.layout : null,
        // R2: the user's ACTIVE repo (three-level namespace). Validated on save; requests
        // fall back to the default repo when this is stale or membership was lost.
        repo: typeof meta.repo === 'string' && REPO_NAME_RE.test(meta.repo) ? meta.repo : null,
        // E-mail notifications (Config → Notificações): daily digest + per-item events.
        notify: normNotifyPrefs(meta.notify)
      };
    } catch (error) {
      return fallback;
    }
  }

  // Merge patch onto existing prefs so saving one field never resets the others.
  async function saveUserPrefs(actor, patch = {}) {
    const dir = userAiDir(actor);
    if (!dir) {
      throw new Error('Identidade do usuário não disponível.');
    }
    const current = await loadUserPrefs(actor);
    const theme = THEME_MODES.includes(patch.theme) ? patch.theme : current.theme;
    const buddySize = BUDDY_SIZES.includes(patch.buddySize) ? patch.buddySize : current.buddySize;
    let graph = current.graph;
    if (patch.graph !== undefined) {
      const g = patch.graph;
      const valid = g === null || (g && typeof g === 'object' && !Array.isArray(g) && JSON.stringify(g).length <= 4096);
      if (!valid) throw new Error('Preferências do grafo inválidas.');
      graph = g;
    }
    let layout = current.layout;
    if (patch.layout !== undefined) {
      const l = patch.layout;
      const valid = l === null || (l && typeof l === 'object' && !Array.isArray(l) && JSON.stringify(l).length <= 8192);
      if (!valid) throw new Error('Preferências de layout inválidas.');
      layout = l;
    }
    const notify = patch.notify !== undefined ? normNotifyPrefs(patch.notify) : current.notify;
    let repo = current.repo;
    if (patch.repo !== undefined) {
      const r = patch.repo === null ? null : String(patch.repo).trim().toLowerCase();
      if (r !== null && !REPO_NAME_RE.test(r)) throw new Error('Repo inválido.');
      repo = r;
    }
    await mkdir(dir, { recursive: true });
    const meta = {
      theme,
      buddySize,
      ...(graph ? { graph } : {}),
      ...(layout ? { layout } : {}),
      ...(repo ? { repo } : {}),
      notify,
      updatedAt: new Date().toISOString()
    };
    await writeFile(join(dir, 'prefs.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    return { theme, buddySize, graph, layout, repo, notify };
  }

  return { userAiDir, loadUserAiConfig, userAiStatus, saveUserAiConfig, loadUserPrefs, saveUserPrefs };
}
