import { preserveInteraction, sizeReviewEditors } from './features/interaction.js';
import { bindUiEvents } from './features/events.js';
import { createIntegrationsFeature } from './features/integrations.js';
import { createProposalActionsFeature } from './features/proposal-actions.js';
import { createCreationFeature } from './features/creation.js';
import { createLinkReferenceFeature } from './features/link-reference.js';
import { createIngestionFeature } from './features/ingestion.js';
import { createCapsuleEditorFeature } from './features/capsule-editor.js';
import { createEvaluationAdminFeature } from './features/evaluation-admin.js';
import { createSkillViewsFeature } from './features/skill-views.js';
import { createEvaluationFeature } from './features/evaluation.js';
import { createBaldeSettingsFeature } from './features/balde-settings.js';
import { createAdministrationFeature } from './features/administration.js';
import { createAiSettingsFeature } from './features/ai-settings.js';
import { createExplorerNavigationFeature } from './features/explorer-navigation.js';
import { createKnowledgeGraphFeature } from './features/knowledge-graph.js';
import { createContextReviewFeature } from './features/context-review.js';
import { createMarkdownFeature } from './features/markdown.js';
import { createDocumentsFeature } from './features/documents.js';
import { createCommonsViewFeature } from './features/commons-view.js';
import { createExplorerViewFeature } from './features/explorer-view.js';
import { createArchiveViewFeature } from './features/archive-view.js';
import { createShareFoldersFeature } from './features/share-folders.js';
import { createNewDraftFeature } from './features/new-draft.js';
import { createMergeFeature } from './features/merge.js';
import { createQueueFeature } from './features/queue.js';
import { createConversationsFeature } from './features/conversations.js';
import { createBuddiesFeature } from './features/buddies.js';
import './session.js';
import { CorpusDataProvider } from './dataProvider.js';

const provider = new CorpusDataProvider();
const app = document.querySelector('#app');
const toastRoot = document.querySelector('#toast-root');

const state = {
  repos: [],
  activeRepo: 'corporate',
  view: 'chat',
  startView: (() => {
    try {
      const v = localStorage.getItem('balde.startView');
      return v === 'chat' || v === 'explore' || v === 'graph' ? v : 'chat';
    } catch (error) {
      return 'chat';
    }
  })(),
  tab: 'overview',
  selectedSkillId: null,
  skills: [],
  proposals: [],
  loading: null,
  evalResult: null,
  explore: null,
  buddies: null,
  ai: null,
  tokens: null,
  groups: null,
  groupEditor: null,
  access: null,
  docs: null,
  apiTab: 'exposed',
  settingsTab: 'provider',
  adminTab: 'api',
  fila: { kind: 'todos', status: 'pendente', selected: null, feedbackDraft: '' },
  queue: null,
  queuePendingCount: 0,
  chat: null,
  contribute: null,
  adminOverview: null,
  prompts: null,
  wizard: null,
  domainList: null,
  domainsAdmin: null,
  sidebarCollapsed: (() => {
    try {
      return localStorage.getItem('balde.sidebarCollapsed') === '1';
    } catch (error) {
      return false;
    }
  })(),

  navCollapsed: (() => {
    try {
      const stored = JSON.parse(localStorage.getItem('balde.navCollapsed') || '{}') || {};
      if (!('config' in stored)) {
        stored.config = true;
      }
      return stored;
    } catch (error) {
      return { config: true };
    }
  })(),

  railClosed: (() => {
    try {
      return JSON.parse(localStorage.getItem('balde.railClosed') || '{}') || {};
    } catch (error) {
      return {};
    }
  })(),

  theme: (() => {
    try {
      return localStorage.getItem('balde.theme') || 'light';
    } catch (error) {
      return 'system';
    }
  })(),

  buddySize: (() => {
    try {
      return localStorage.getItem('balde.buddySize') || 'medium';
    } catch (error) {
      return 'medium';
    }
  })(),
  confirm: null,
  adjustment: null,
  returning: null,
  users: [],
  loginAudit: [],
  auth: {
    isAuthenticated: false,
    user: null,
    mode: 'login',
    error: null,
    notice: null,
    resetEmail: ''
  },
  filters: {
    query: '',
    status: 'todos',
    owner: 'todos',
    frescor: 'todos'
  }
};

const statusLabel = {
  canonico: 'canônico',
  rascunho: 'Blueprint',
  depreciado: 'depreciado'
};

const freshnessLabel = {
  verde: 'revisado há menos de 6 meses',
  amarelo: 'revisão entre 6 e 9 meses',
  vermelho: 'revisão vencida',
  neutro: 'não aplicável'
};

const iconPaths = {
  catDado:
    '<rect x="4.5" y="12" width="4" height="7.5" rx="1"/><rect x="10" y="8" width="4" height="11.5" rx="1"/><rect x="15.5" y="4.5" width="4" height="15" rx="1"/>',
  catReuniao:
    '<circle cx="9" cy="9.5" r="3"/><path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 7.5a2.6 2.6 0 010 5"/><path d="M18.5 19.5c0-2-.8-3.6-2-4.5"/>',
  catDecisao:
    '<path d="M12 3.5v6"/><circle cx="12" cy="11.5" r="2"/><path d="M10.4 12.9L5.5 19.5"/><path d="M13.6 12.9l4.9 6.6"/><path d="M4 19.5h3.5"/><path d="M16.5 19.5H20"/>',
  catTarefas:
    '<path d="M4 7.5l2 2 3.5-4"/><path d="M4 16.5l2 2 3.5-4"/><path d="M12.5 7.5H20"/><path d="M12.5 16.5H20"/>',
  dashboard: '<path d="M3 13h8V3H3v10Zm10 8h8V3h-8v18ZM3 21h8v-6H3v6Z"/>',
  skills: '<path d="M4 19.5V4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 1 4 17.5M8 6h8M8 10h8M8 14h5"/>',
  approvals: '<path d="M20 6 9 17l-5-5"/><path d="M19 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11"/>',
  settings:
    '<path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.42 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.42H2.8a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.03 3.84l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .42-1.1V2.8a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.25.38.62.67 1 .8.33.1.7.16 1.1.16h.09a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z"/>',
  search: '<path d="m21 21-4.35-4.35"/><circle cx="11" cy="11" r="7"/>',
  play: '<path d="M5 3v18l15-9L5 3Z"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash:
    '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  alert:
    '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  rollback: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  spark: '<path d="M3 17 9 11l4 4 8-8"/><path d="M14 7h7v7"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  lock: '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15 8 3 3"/><path d="m17 6 3 3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  folder:
    '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.66-.9l-.55-.83A2 2 0 0 0 9.24 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  commit: '<circle cx="12" cy="12" r="3"/><path d="M3 12h6"/><path d="M15 12h6"/>',
  menu: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
  lightbulb:
    '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  ontology:
    '<path d="M12 7c-1.7-1.5-3.9-2.2-6.5-2.2H3v13h2.5c2.6 0 4.8.7 6.5 2.2 1.7-1.5 3.9-2.2 6.5-2.2H21v-13h-2.5C15.9 4.8 13.7 5.5 12 7z"/><path d="M12 7v13"/>',
  smiley:
    '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  inbox:
    '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  tag: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  expand:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>'
};

const BUDDY_POSE_VOCAB = [
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
const BUDDY_POSE_EXT_LIST = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || ''}</svg>`;
}

const THEME_STORAGE_KEY = 'balde.theme';
let themeMedia = null;
let themeMediaHandler = null;

function resolveTheme(mode) {
  if (mode === 'dark' || mode === 'light') {
    return mode;
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch (error) {
    return 'light';
  }
}

function applyTheme(mode) {
  const m = ['light', 'dark', 'system'].includes(mode) ? mode : 'system';
  state.theme = m;
  document.documentElement.setAttribute('data-theme', resolveTheme(m));
  try {
    localStorage.setItem(THEME_STORAGE_KEY, m);
  } catch (error) {
    /* private mode */
  }

  if (themeMedia && themeMediaHandler) {
    themeMedia.removeEventListener('change', themeMediaHandler);
    themeMediaHandler = null;
  }
  if (m === 'system') {
    try {
      themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
      themeMediaHandler = () => {
        if (state.theme === 'system') {
          document.documentElement.setAttribute('data-theme', resolveTheme('system'));
        }
      };
      themeMedia.addEventListener('change', themeMediaHandler);
    } catch (error) {
      /* matchMedia unsupported */
    }
  }
}

async function setTheme(mode) {
  applyTheme(mode);
  renderShell();
  try {
    await fetch('/api/me/prefs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: state.theme })
    });
  } catch (error) {
    toast('Tema aplicado, mas não foi possível salvar no perfil.', 'warning');
  }
}

const BUDDY_SIZE_STORAGE_KEY = 'balde.buddySize';
const BUDDY_SIZES = ['small', 'medium', 'large', 'off'];

function applyBuddySize(size) {
  const s = BUDDY_SIZES.includes(size) ? size : 'medium';
  state.buddySize = s;
  try {
    localStorage.setItem(BUDDY_SIZE_STORAGE_KEY, s);
  } catch (error) {
    /* private mode */
  }
}

const START_VIEWS = ['chat', 'explore', 'graph'];

function chatAvailable() {
  return state.aiMode !== 'none';
}
function startViewsAvailable() {
  return START_VIEWS.filter((v) => v !== 'chat' || chatAvailable());
}
function startViewOr(fallback) {
  const avail = startViewsAvailable();
  if (avail.includes(state.startView)) return state.startView;
  return avail.includes(fallback) ? fallback : avail[0];
}
function setStartView(view) {
  if (!startViewsAvailable().includes(view)) return;
  state.startView = view;
  try {
    localStorage.setItem('balde.startView', view);
  } catch (error) {
    /* private mode */
  }
  renderShell();
  toast('Página inicial definida.', 'success');
}

async function setBuddySize(size) {
  applyBuddySize(size);
  renderShell();
  try {
    await fetch('/api/me/prefs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ buddySize: state.buddySize })
    });
  } catch (error) {
    toast('Tamanho do buddy aplicado, mas não foi possível salvar no perfil.', 'warning');
  }
}

const LAYOUT_LS_KEYS = new Set([
  'balde.startView',
  'balde.sidebarCollapsed',
  'balde.navCollapsed',
  'balde.railClosed',
  'balde-docs-width',
  'balde-commons-cols',
  'balde.buddyCollapsedGroups',
  'balde.exploreHeaderCollapsed'
]);
let layoutTouchedThisSession = false;
const rawSetLocal = (() => {
  try {
    return localStorage.setItem.bind(localStorage);
  } catch (error) {
    return null;
  }
})();

function collectLayoutPrefs() {
  const out = {};
  for (const k of LAYOUT_LS_KEYS) {
    try {
      const v = localStorage.getItem(k);
      if (v != null) out[k] = v;
    } catch (error) {
      /* ignore */
    }
  }
  return out;
}

let layoutPrefsTimer = null;
function saveLayoutPrefsDebounced() {
  clearTimeout(layoutPrefsTimer);
  layoutPrefsTimer = setTimeout(() => {
    fetch('/api/me/prefs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layout: collectLayoutPrefs() })
    }).catch(() => {
      /* offline: localStorage still holds it; next change re-syncs */
    });
  }, 600);
}

if (rawSetLocal) {
  try {
    localStorage.setItem = function patchedSetItem(key, value) {
      rawSetLocal(key, value);
      if (LAYOUT_LS_KEYS.has(key)) {
        layoutTouchedThisSession = true;
        saveLayoutPrefsDebounced();
      }
    };
  } catch (error) {
    /* setItem not reassignable — layout stays device-local */
  }
}

function applyServerLayout(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return;
  const set =
    rawSetLocal ||
    ((k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch (error) {
        /* ignore */
      }
    });
  for (const k of LAYOUT_LS_KEYS) {
    if (typeof layout[k] === 'string') {
      try {
        set(k, layout[k]);
      } catch (error) {
        /* ignore */
      }
    }
  }
  try {
    const v = localStorage.getItem('balde.startView');
    if (START_VIEWS.includes(v)) state.startView = v;
  } catch (error) {
    /* ignore */
  }
  try {
    state.sidebarCollapsed = localStorage.getItem('balde.sidebarCollapsed') === '1';
  } catch (error) {
    /* ignore */
  }
  try {
    const nc = JSON.parse(localStorage.getItem('balde.navCollapsed') || '{}') || {};
    if (!('config' in nc)) nc.config = true;
    state.navCollapsed = nc;
  } catch (error) {
    /* ignore */
  }
  try {
    state.railClosed = JSON.parse(localStorage.getItem('balde.railClosed') || '{}') || {};
  } catch (error) {
    /* ignore */
  }
  if (state.docs) {
    try {
      const w = Number(localStorage.getItem('balde-docs-width'));
      if (w >= 180 && w <= 520) state.docs.width = w;
    } catch (error) {
      /* ignore */
    }
  }
  if (state.auth && state.auth.isAuthenticated) {
    try {
      renderShell();
    } catch (error) {
      /* shell not mounted yet */
    }
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function cssToken(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase();
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  return new Date(`${String(value).slice(0, 10)}T12:00:00-03:00`).toLocaleDateString('pt-BR');
}

function formatCompact(value) {
  return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function maturityLabel(score) {
  if (score >= 80) {
    return 'Avançada';
  }

  if (score >= 60) {
    return 'Em evolução';
  }

  if (score >= 40) {
    return 'Inicial';
  }

  return 'Fundação';
}

function initials(owner) {
  return owner.nome
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
}

function accessInitials(user) {
  const raw = String(user?.nome || user?.email || 'U').trim();

  const local = raw.includes('@') ? raw.split('@')[0] : raw;
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || local || 'U').slice(0, 2).toUpperCase();
}

function currentAccessUser() {
  return state.auth.user;
}

function isCurator() {
  const user = currentAccessUser();
  return Boolean(user?.isCurator) || user?.perfil === 'Curador';
}

function isAdmin() {
  return Boolean(currentAccessUser()?.isAdmin);
}

function isBaldeAdmin() {
  return Boolean(currentAccessUser()?.baldeAdmin);
}

function curatesActiveBalde() {
  return isCurator() || Boolean(currentAccessUser()?.curatesActiveBalde);
}

function domainsNavVisible() {
  return Boolean(state.mountsEnabled) && Boolean(state.domainCanManage);
}

function canCreateBuddy() {
  return Boolean(currentAccessUser()?.canCreateBuddy);
}

// O que a pessoa pode fazer no balde ativo, decidido pelo servidor (src/security/permissions.mjs) e entregue em
// /api/me: contribuir, curar, administrar e instalacao, cada um com { ok, reason }. A interface esconde o que o
// papel não permite e desabilita, mostrando o motivo, o que o papel permite mas a pasta do balde não.
const PERMISSION_ROLE_RANK = { nenhum: 0, membro: 1, curador: 2, admin: 3 };
const PERMISSION_ACTION_ROLE = { contribuir: 'membro', curar: 'curador', administrar: 'admin' };

function permissionsSummary() {
  return currentAccessUser()?.permissions || null;
}

// O papel permite a ação (mesmo que a pasta ainda não): o controle aparece.
function roleAllows(action) {
  const summary = permissionsSummary();
  if (!summary) return false;
  if (action === 'instalacao') return isAdmin();
  return (PERMISSION_ROLE_RANK[summary.role] || 0) >= (PERMISSION_ROLE_RANK[PERMISSION_ACTION_ROLE[action]] || 9);
}

// O servidor aceita a ação agora.
function permitted(action) {
  const decision = permissionsSummary()?.[action];
  return Boolean(decision && decision.ok);
}

function permissionReason(action) {
  return permissionsSummary()?.[action]?.reason || '';
}

// Atributos de um botão de ação: desabilitado com o motivo quando o servidor recusaria.
function permissionAttrs(action) {
  if (permitted(action)) return '';
  const reason = permissionReason(action);
  return ` disabled aria-disabled="true"${reason ? ` title="${escapeHtml(reason)}"` : ''}`;
}

// O aviso de uma tela cujas ações o papel permite e a pasta do balde não (o padrão da Fila).
function permissionNote(action) {
  if (!roleAllows(action) || permitted(action)) return '';
  return `<p class="queue-note warn" role="note">${escapeHtml(permissionReason(action))}</p>`;
}

// O aviso de uma tela que só existe para a ação (um assistente de criação): o motivo, seja o papel ou a pasta.
function refusalNote(action) {
  if (permitted(action)) return '';
  return `<p class="queue-note warn" role="note">${escapeHtml(permissionReason(action))}</p>`;
}

function omniResults() {
  const q = String(state.filters.query || '')
    .trim()
    .toLowerCase();
  if (!q) return [];
  const out = [];
  for (const s of state.skills || []) {
    const hay = `${s.nome || ''} ${s.id || ''} ${s.owner || ''} ${s.domain || ''}`.toLowerCase();
    if (hay.includes(q))
      out.push({ type: 'skill', key: s.id, label: s.nome || s.id, meta: s.owner ? `owner: ${s.owner}` : s.id });
  }

  const commons = state.commonsIndex || (state.commons && state.commons.data && state.commons.data.concepts) || [];
  for (const c of commons) {
    if (`${c.path} ${c.summary || ''} ${c.title || ''}`.toLowerCase().includes(q))
      out.push({ type: 'commons', key: c.path, label: c.path, meta: c.summary || 'cápsula' });
  }
  return out.slice(0, 8);
}
function renderOmni() {
  if (!(state.omni && state.omni.open) || !String(state.filters.query || '').trim()) return '';
  const results = omniResults();
  const active = state.omni.active || 0;
  const items = results.length
    ? results
        .map(
          (
            r,
            i
          ) => `<button class="omni-item${i === active ? ' is-active' : ''}" data-action="omniOpen" data-otype="${r.type}" data-okey="${escapeHtml(r.key)}">
        ${icon(r.type === 'commons' ? 'file' : 'lightbulb')}
        <span class="omni-item-main"><strong>${escapeHtml(r.label)}</strong><small>${escapeHtml(r.meta)}</small></span>
        <span class="omni-type">${r.type === 'commons' ? 'cápsula' : 'skill'}</span>
      </button>`
        )
        .join('')
    : '<div class="omni-empty">Nenhum resultado.</div>';
  return `<div class="omni-dropdown" data-omni>${items}</div>`;
}
function closeOmni() {
  if (state.omni && state.omni.open) {
    state.omni.open = false;
    renderShell();
  }
}
async function omniOpen(type, key) {
  state.omni = { open: false, active: 0 };
  state.filters.query = '';
  if (type === 'commons') {
    await openCommonsInExplore(key);
  } else {
    await openSkillInExplore(key);
  }
}
function refocusSearch() {
  const el = document.querySelector('.global-search input[data-filter="query"]');
  if (el && document.activeElement !== el) {
    el.focus();
    const v = el.value;
    el.value = '';
    el.value = v;
  }
}

// O balde decide quem cura (D1): o servidor manda canManage por skill, igual para todas; o owner da skill só
// diz quem responde por ela.
function canManageSkill(skill) {
  if (typeof skill.canManage === 'boolean') {
    return skill.canManage;
  }
  return roleAllows('curar');
}

function statusPill(status) {
  return `<span class="pill pill-${status}">${statusLabel[status]}</span>`;
}

function deprecationTag(skill) {
  if (!skill || !skill.deprecated) return '';
  const reasons = (skill.deprecation && skill.deprecation.reasons) || [];
  return `<span class="pill pill-deprecated" title="${escapeHtml(reasons.join(' · ') || 'conteúdo possivelmente desatualizado')}">${icon('alert')}depreciada</span>`;
}

function freshnessDot(frescor) {
  return `<span class="freshness freshness-${frescor}" title="${freshnessLabel[frescor]}"></span>`;
}

function qualitySeal(score, grade) {
  const g = grade || (score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D');
  return `<span class="quality-seal quality-${g.toLowerCase()}" title="Selo de qualidade ${score}/100">${g}<small>${score}</small></span>`;
}

function selectedSkill() {
  return state.skills.find((skill) => skill.id === state.selectedSkillId) || state.skills[0];
}

function getOwners() {
  return [...new Set(state.skills.map((skill) => skill.owner.nome))].sort((a, b) => a.localeCompare(b));
}

function filteredSkills() {
  const query = state.filters.query.trim().toLowerCase();

  return state.skills.filter((skill) => {
    const matchesQuery =
      !query || [skill.nome, skill.id, skill.owner.nome, skill.domain || ''].join(' ').toLowerCase().includes(query);
    const matchesStatus = state.filters.status === 'todos' || skill.status === state.filters.status;
    const matchesOwner = state.filters.owner === 'todos' || skill.owner.nome === state.filters.owner;
    const matchesFrescor = state.filters.frescor === 'todos' || skill.frescor === state.filters.frescor;
    return matchesQuery && matchesStatus && matchesOwner && matchesFrescor;
  });
}

function feedbackCounts(skill) {
  return skill.feedback.reduce(
    (acc, item) => {
      acc[item.veredito] = (acc[item.veredito] || 0) + 1;
      return acc;
    },
    { bom: 0, fraco: 0, errado: 0 }
  );
}

function totalMonth(metricName) {
  return state.skills.reduce((sum, skill) => sum + (skill.metricas.at(-1)?.[metricName] || 0), 0);
}

function addLoginAudit(acao, usuarioAfetado) {
  const entry = {
    id: `audit-${Date.now()}`,
    acao,
    usuarioAfetado,
    executadoPor: currentAccessUser()?.nome || 'Sistema',
    data: new Date().toISOString()
  };
  state.loginAudit = [entry, ...state.loginAudit].slice(0, 100);
  return entry;
}

function renderShell() {
  const restoreInteraction = preserveInteraction(
    app,
    JSON.stringify([state.view, state.fila?.selected, state.explore?.skillId, state.selectedSkillId])
  );
  if (!state.auth.isAuthenticated) {
    renderAuthScreen();
    return;
  }

  const prevChatScroll = (() => {
    const el = document.querySelector('[data-chat-scroll]');
    if (!el) {
      return null;
    }
    return { top: el.scrollTop, atBottom: el.scrollHeight - el.scrollTop - el.clientHeight < 40 };
  })();

  const prevBuddyScroll = (() => {
    const el = document.querySelector('[data-buddy-scroll]');
    return el ? el.scrollTop : null;
  })();

  const prevDocsScroll = (() => {
    const el = document.querySelector('[data-docs-scroll]');
    return el ? el.scrollTop : null;
  })();

  app.className = state.sidebarCollapsed ? 'sidebar-collapsed' : '';
  const accessUser = currentAccessUser();
  app.innerHTML = `
    <aside class="sidebar">
      <button class="sidebar-toggle" data-action="toggleSidebar" aria-label="Recolher ou expandir menu" aria-expanded="${!state.sidebarCollapsed}" title="${state.sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}">${icon('menu')}</button>
      <button class="brand" data-view="${startViewOr('explore')}" aria-label="Ir para a página inicial">
        <img src="/assets/balde_logo.webp" alt="Balde" class="brand-logo">
        ${state.version ? `<span class="brand-version" title="Versão do Balde">v${escapeHtml(state.version)}</span>` : ''}
      </button>
      <nav class="nav-list" aria-label="Navegação principal">
        ${navSection('explorar', 'Explorar', [
          navButton('graph', 'Grafo', 'spark'),
          state.aiMode === 'none' ? '' : navButton('chat', 'Chat', 'chat'),
          navButton('explore', 'Corpus', 'folder'),
          navButton('docs', 'Documentação', 'help')
        ])}
        ${navSection('governanca', 'Governança', [
          navButton('dashboard', 'Visão geral', 'dashboard'),
          navButton(
            'queue',
            'Fila',
            'inbox',
            (state.queuePendingCount || 0) +
              (state.proposals.filter(
                (item) => !item.history && !['aprovado', 'devolvido', 'rejeitado', 'publicado'].includes(item.status)
              ).length || 0) || null
          ),
          navButton('commons', 'Cápsulas', 'library'),
          navButton('ontologias', 'Ontologias', 'ontology'),
          domainsNavVisible() ? navButton('domains', 'Domínios', 'tag') : '',
          roleAllows('curar') ? navButton('archived', 'Arquivadas', 'history') : ''
        ])}
        ${navSection('skills', 'Skills', [navButton('create', 'Criar', 'edit')])}
        ${navCategory('config', 'Config', [
          navButton('settings', 'Configurações', 'settings'),
          navButton('buddies', 'AI Buddy', 'smiley'),
          isAdmin() || roleAllows('curar') ? navButton('admin', 'Administração', 'shield') : ''
        ])}
      </nav>
      <button class="lm-footer" data-action="openAbout" title="Sobre o Balde — uma solução lucas.mat.br" aria-label="Sobre o Balde">
        <img src="/assets/vitti-logo.png" alt="" class="lm-footer-avatar">
        <span class="lm-footer-text">lucas.mat.br</span>
      </button>
    </aside>
    <main class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">${escapeHtml(state.orgName || 'Balde de conhecimento')}</p>
          <h1>${pageTitle()}</h1>
        </div>
        <div class="global-search">
          ${icon('search')}
          <input data-filter="query" value="${escapeHtml(state.filters.query)}" placeholder="Buscar skill, owner ou tag" autocomplete="off" aria-label="Buscar">
          ${renderOmni()}
        </div>
        <div class="session-actions">
          ${
            (state.repos || []).length > 1
              ? `
          <label class="repo-switcher" title="Balde (repo) ativo">
            ${icon('library')}
            <select data-action="repoSwitch" aria-label="Trocar de balde">
              ${state.repos.map((r) => `<option value="${escapeHtml(r.name)}" ${r.name === state.activeRepo ? 'selected' : ''}>${escapeHtml(r.titulo || r.name)}</option>`).join('')}
            </select>
          </label>`
              : ''
          }
          <button class="user-chip" data-view="settings" aria-label="Abrir configurações">
            <span class="avatar">${accessInitials(accessUser)}</span>
            <span>
              <strong>${escapeHtml(accessUser.nome)}</strong>
              <small>${escapeHtml(accessUser.perfil)}</small>
            </span>
          </button>
          <button class="icon-button" data-action="logout" aria-label="Sair">${icon('logout')}</button>
        </div>
      </header>
      <section class="content ${state.readOnlyBrowse ? 'readonly-scope' : ''}">
        ${provider.loadError ? `<div class="inline-error" role="alert"><p>${escapeHtml(provider.loadError)} ${provider.loadedAt ? 'Exibindo a última leitura; os dados podem estar desatualizados.' : 'Nenhum dado foi carregado.'}</p><button type="button" class="secondary-button" data-retry-corpus>Tentar novamente</button></div>` : ''}
        ${renderContent()}
      </section>
    </main>
    ${state.confirm ? renderConfirmModal() : ''}
    ${state.aboutOpen ? renderAboutModal() : ''}
    ${state.adjustment ? renderAdjustmentModal() : ''}
    ${state.returning ? renderReturnModal() : ''}
    ${state.uploadModal ? renderUploadModal() : ''}
    ${state.contribute ? renderContributeModal() : ''}
    ${state.commons && state.commons.file ? renderCommonsFileModal() : ''}
    ${state.ontologyEditor ? renderOntologyEditorModal() : ''}
  `;

  if (prevChatScroll) {
    const el = document.querySelector('[data-chat-scroll]');
    if (el) {
      el.scrollTop = prevChatScroll.atBottom ? el.scrollHeight : prevChatScroll.top;
    }
  }
  if (prevBuddyScroll != null) {
    const el = document.querySelector('[data-buddy-scroll]');
    if (el) {
      el.scrollTop = prevBuddyScroll;
    }
  }
  if (prevDocsScroll != null) {
    const el = document.querySelector('[data-docs-scroll]');
    if (el) {
      el.scrollTop = prevDocsScroll;
    }
  }
  restoreInteraction();
  ensureSqlFormatted(); // auto-format any SQL code blocks this render produced (async, cached, graceful)

  if (state.view === 'graph') {
    setTimeout(mountCorpusGraph, 0);
  }

  if (state.view === 'explore' && state.explore && state.explore.tab === 'graph') {
    setTimeout(mountSkillGraph, 0);
  } else {
    destroySkillCy();
  }
}

function renderAuthScreen() {
  app.className = 'auth-shell';
  app.innerHTML = `<main class="auth-layout">
    <section class="auth-brand-panel"><figure class="auth-logo-frame"><img src="/assets/balde_logo.webp" alt="Balde de conhecimento"></figure></section>
    <section class="auth-card" aria-label="Sessão local">
      <h1>Balde de conhecimento</h1>
      <p>Abra o Balde pelo aplicativo local para iniciar a sessão.</p>
      <p class="muted">A identidade é configurada neste computador. As permissões vêm dos baldes aos quais você tem acesso.</p>
      ${state.auth.error ? `<div role="alert" class="form-alert form-alert-error">${escapeHtml(state.auth.error)}</div>` : ''}
      <button class="primary-button" type="button" data-action="retryLocalSession">Tentar novamente</button>
    </section>
  </main>`;
}

const NAV_ICON_IMG = {
  graph: 'graph.png',
  chat: 'chat.png',
  explore: 'corpus.png',
  commons: 'capsula.png',
  docs: 'docs.png',
  dashboard: 'dashboard.png',
  queue: 'fila.png',
  create: 'create-skill.png',
  settings: 'settings.png',
  buddies: 'ai-buddy.png',
  admin: 'admin.png'
};

function navButton(view, label, iconName, count = null, sub = false) {
  const imgFile = NAV_ICON_IMG[view];
  const iconHtml = imgFile
    ? `<img class="nav-icon-img" src="/assets/nav/${imgFile}" alt="" aria-hidden="true">`
    : icon(iconName);
  return `
    <button class="nav-item ${sub ? 'nav-item-sub' : ''} ${state.view === view ? 'active' : ''}" data-view="${view}" title="${escapeHtml(label)}">
      ${iconHtml}
      <span>${label}</span>
      ${count ? `<small>${count}</small>` : ''}
    </button>
  `;
}

function navCategory(key, label, items) {
  const html = (items || []).filter(Boolean).join('');
  if (!html) {
    return '';
  }
  const collapsed = Boolean(state.navCollapsed && state.navCollapsed[key]);
  const railClosed = Boolean(state.railClosed && state.railClosed[key]);
  return `
    <div class="nav-cat ${collapsed ? 'is-collapsed' : ''} ${railClosed ? 'rail-closed' : ''}">
      <button class="nav-cat-head" data-action="toggleNavCat" data-cat="${key}" aria-expanded="${!collapsed}" title="${escapeHtml(label)}">
        ${icon('chevron')}
        <span>${escapeHtml(label)}</span>
      </button>
      <div class="nav-cat-items">${html}</div>
    </div>`;
}

function navSection(key, label, items) {
  const html = (items || []).filter(Boolean).join('');
  if (!html) {
    return '';
  }

  const collapsed = Boolean(state.navCollapsed && state.navCollapsed[key]);
  const railClosed = Boolean(state.railClosed && state.railClosed[key]);
  return `
    <div class="nav-section ${collapsed ? 'is-collapsed' : ''} ${railClosed ? 'rail-closed' : ''}" data-section="${key}">
      <button class="nav-section-title" data-action="toggleNavCat" data-cat="${key}" aria-expanded="${!collapsed}" title="${escapeHtml(label)}">${icon('chevron')}<span>${escapeHtml(label)}</span></button>
      <div class="nav-section-items">${html}</div>
    </div>`;
}

function pageTitle() {
  if (state.view === 'skills') {
    return 'Suas skills';
  }

  if (state.view === 'graph') {
    return 'Mapa de conhecimento';
  }

  if (state.view === 'approvals') {
    return 'Aprovações';
  }

  if (state.view === 'explore') {
    return 'Explorar Corpus';
  }

  if (state.view === 'buddies') {
    return 'Buddies';
  }

  if (state.view === 'commons') {
    return 'Cápsulas';
  }

  if (state.view === 'ontologias') {
    return 'Ontologias';
  }

  if (state.view === 'domains') {
    return 'Domínios';
  }

  if (state.view === 'archived') {
    return 'Arquivadas';
  }

  if (state.view === 'docs') {
    return 'Documentação';
  }

  if (state.view === 'queue') {
    return 'Fila';
  }

  if (state.view === 'chat') {
    return 'Chat';
  }

  if (state.view === 'create') {
    return 'Criar';
  }

  if (state.view === 'createSkill') {
    return state.wizard && state.wizard.editId ? 'Editar skill' : 'Criar skill';
  }
  if (state.view === 'ingest') {
    return 'Mapear conhecimento bruto';
  }

  if (state.view === 'createCommons') {
    return state.commonsWizard && state.commonsWizard.editId ? 'Editar cápsula' : 'Criar cápsula';
  }

  if (state.view === 'importManifest') {
    return 'Importar manifesto';
  }

  if (state.view === 'groups') {
    return 'Grupos de acesso';
  }

  if (state.view === 'prompts') {
    return 'Prompts do sistema';
  }

  if (state.view === 'evalChecklist') {
    return 'Checklist de qualidade';
  }

  if (state.view === 'settings') {
    return 'Configurações';
  }

  if (state.view === 'admin') {
    return 'Administração';
  }

  if (state.view === 'api') {
    return 'API';
  }

  if (state.view === 'appearance') {
    return 'Aparência';
  }

  return 'Visão geral';
}

function insertLinkrefTrigger(field, brackets) {
  const trigger = brackets === 3 ? '[[[' : '[[';
  const ta = document.querySelector(
    field === 'cwBody'
      ? '[data-cw-field="body"]'
      : field === 'mergeBody'
        ? '[data-merge-edit]'
        : '[data-wizard-field="body"]'
  );
  if (!ta) return;
  ta.focus();
  const pos = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  const next = ta.value.slice(0, pos) + trigger + ta.value.slice(pos);
  ta.value = next;
  const caret = pos + trigger.length;
  try {
    ta.setSelectionRange(caret, caret);
  } catch (error) {
    /* ignore */
  }
  if (field === 'cwBody') {
    if (state.commonsWizard) state.commonsWizard.form.body = next;
  } else if (field === 'mergeBody') {
    const w = state.mergeWizard,
      c = w && w.changes[w.fileIdx];
    if (c) c.curatorContent = next;
  } else if (state.wizard) state.wizard.form.body = next;
  linkrefSync(field, ta);
}

function renderContent() {
  if (state.view === 'skills') {
    return renderSkills();
  }

  if (state.view === 'graph') {
    return renderGraphView();
  }

  if (state.view === 'approvals') {
    return renderApprovals();
  }

  if (state.view === 'explore') {
    return renderExplore();
  }

  if (state.view === 'buddies') {
    return renderBuddies();
  }

  if (state.view === 'commons') {
    return renderCommons();
  }

  if (state.view === 'ontologias') {
    return renderOntologiasView();
  }

  if (state.view === 'domains') {
    return renderDomainsView();
  }

  if (state.view === 'archived') {
    return renderArchived();
  }

  if (state.view === 'docs') {
    return renderDocs();
  }

  if (state.view === 'queue') {
    return renderQueue();
  }

  if (state.view === 'chat') {
    return renderChat();
  }

  if (state.view === 'create') {
    return renderCreateChooser();
  }

  if (state.view === 'ingest') {
    return renderIngest();
  }

  if (state.view === 'createSkill') {
    return renderUsersDatalist() + renderCreateSkill();
  }

  if (state.view === 'mergeReview') {
    return renderMergeWizard();
  }

  if (state.view === 'createCommons') {
    return renderUsersDatalist() + renderCreateCommons();
  }

  if (state.view === 'importManifest') {
    return renderImportManifest();
  }

  if (state.view === 'groups') {
    return renderGroups();
  }

  if (state.view === 'prompts') {
    return renderPromptsPage();
  }

  if (state.view === 'evalChecklist') {
    return renderEvalChecklistAdmin();
  }

  if (state.view === 'settings') {
    return renderSettings();
  }

  if (state.view === 'admin') {
    return renderAdmin();
  }

  if (state.view === 'api') {
    return renderApiAccess();
  }

  if (state.view === 'appearance') {
    return renderAppearance();
  }

  return renderDashboard();
}

function domainRootKey(d) {
  return String(d || '').split('-')[0];
}

function slugifyCatKey(v) {
  return String(v == null ? '' : v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 32);
}

async function openAccessTab(skillId) {
  state.access = null;
}

function renderAccessReadOnly(skill, canManage = false) {
  const balde = (state.repos || []).find((r) => r.name === state.activeRepo);
  const baldeName = balde ? balde.titulo || balde.name : state.activeRepo || '';
  const owner =
    typeof skill.owner === 'string' ? skill.owner : (skill.owner && (skill.owner.email || skill.owner.nome)) || '';
  return `
    <div class="access-tab">
      <p class="eyebrow">Acessos</p>
      <h3>Quem lê e quem cura esta skill</h3>
      <p>O acesso é do balde <strong>${escapeHtml(baldeName)}</strong>: quem lê o balde lê todas as skills e cápsulas dele, e o criador e os curadores do balde curam todas.${owner ? ` O owner (<strong>${escapeHtml(owner)}</strong>) é quem responde pela skill; isso não dá permissão de edição.` : ''}</p>
      <p class="muted">Para mudar quem lê ou quem cura, o criador do balde (os admins dele) edita em Configurações › Baldes › Acesso.</p>
    </div>`;
}

function renderAboutModal() {
  return `
    <div class="modal-backdrop" role="presentation" data-action="closeAbout">
      <section class="modal" role="dialog" aria-modal="true" aria-label="Sobre o Balde de conhecimento">
        <div style="display:flex; align-items:center; gap:16px; margin-bottom:8px">
          <img src="/assets/vitti-logo.png" alt="Vitti" style="width:72px; height:72px; border-radius:50%">
          <div>
            <h2 style="margin:0">Balde de conhecimento</h2>
            <p class="muted" style="margin:4px 0 0">uma solução <strong>lucas.mat.br</strong></p>
          </div>
        </div>
        <p>Governança de conhecimento com curadoria humana: skills, cápsulas atômicas, fila de curadoria e evidência viva (queries governadas sobre os dados) — para o conhecimento do time virar um ativo versionado, auditável e consumível por pessoas e por IA.</p>
        <p class="muted">Criado por Lucas Vitti · código aberto (Apache-2.0).</p>
        <div class="row-actions">
          <a class="ghost-button" href="https://lucas.mat.br" target="_blank" rel="noopener">${icon('spark')}lucas.mat.br</a>
          <a class="ghost-button" href="https://github.com/lucasvitti/balde" target="_blank" rel="noopener">${icon('folder')}GitHub</a>
          <a class="ghost-button" href="https://www.linkedin.com/in/lucasvitti/" target="_blank" rel="noopener">${icon('smiley')}LinkedIn</a>
          <button class="primary-button" data-action="closeAbout">${icon('check')}Fechar</button>
        </div>
      </section>
    </div>
  `;
}

function renderConfirmModal() {
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(state.confirm.title)}">
        <h2>${escapeHtml(state.confirm.title)}</h2>
        <p>${escapeHtml(state.confirm.body)}</p>
        <div class="row-actions">
          <button class="ghost-button" data-action="cancelConfirm">${icon('x')}Cancelar</button>
          <button class="primary-button danger-primary" data-action="acceptConfirm">${icon('check')}${escapeHtml(state.confirm.confirmLabel)}</button>
        </div>
      </section>
    </div>
  `;
}

function renderAdjustmentModal() {
  const proposal = state.adjustment;
  const draftSave = proposal.canPromote === false;
  const canApproveAdjustment = !draftSave || String(proposal.depois || '').trim();
  const primaryLabel = draftSave
    ? isBasicRequirementProposal(proposal)
      ? 'Salvar requisito'
      : 'Salvar no rascunho'
    : 'Salvar e validar';
  const disabledTitle = proposal.aiFillAvailable
    ? 'Preencha o campo Depois ou clique em Gerar com IA'
    : 'Preencha o campo Depois antes de salvar';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal wide-modal" role="dialog" aria-modal="true" aria-label="Ajuste manual da proposta">
        <h2>Ajuste manual</h2>
        <p>${draftSave ? 'Edite o texto que será salvo no rascunho governado; a canonização fica bloqueada até todos os requisitos mínimos passarem.' : 'Edite o texto que vai para a versão canônica, legado e code review.'}</p>
        <div class="manual-form">
          <label>
            Título
            <input data-adjust-field="titulo" value="${escapeHtml(proposal.titulo)}">
          </label>
          <label>
            Antes
            <textarea data-adjust-field="antes" rows="4">${escapeHtml(proposal.antes)}</textarea>
          </label>
          <label>
            Depois
            <textarea data-adjust-field="depois" rows="5">${escapeHtml(proposal.depois)}</textarea>
          </label>
          <label>
            Caso de aceite
            <textarea data-adjust-field="evalResultado" rows="3">${escapeHtml(proposal.evalResultado)}</textarea>
          </label>
        </div>
        <div class="row-actions">
          <button class="ghost-button" data-action="cancelAdjustment">${icon('x')}Cancelar</button>
          ${proposal.aiFillAvailable ? `<button class="ghost-button" data-action="generateAdjustmentWithAi" data-id="${proposal.id}" ${state.loading === `ai:${proposal.id}` ? 'disabled' : ''}>${icon('spark')}${state.loading === `ai:${proposal.id}` ? 'Gerando...' : 'Gerar com IA'}</button>` : ''}
          <button class="ghost-button" data-action="saveAdjustment">${icon('edit')}Salvar ajuste</button>
          <button class="primary-button" data-action="saveAndApproveAdjustment" ${canApproveAdjustment ? '' : `disabled title="${disabledTitle}"`}>${icon('check')}${primaryLabel}</button>
        </div>
      </section>
    </div>
  `;
}

function renderReturnModal() {
  const proposal = state.returning;
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal wide-modal" role="dialog" aria-modal="true" aria-label="Devolver proposta">
        <h2>Devolver proposta</h2>
        <p>Informe por que esta sugestão não deve seguir para canonização agora.</p>
        <div class="return-summary">
          <strong>${escapeHtml(proposal.titulo)}</strong>
          <small>${escapeHtml(proposal.skillId)} · ${escapeHtml(proposal.severity || 'média')}</small>
        </div>
        <div class="manual-form">
          <label>
            Motivo da devolução
            <textarea data-return-reason rows="5" placeholder="Ex.: mudança faz sentido, mas precisa de ajuste no escopo; não aplicar sem eval; proposta conflita com regra do owner."></textarea>
          </label>
        </div>
        <div class="row-actions">
          <button class="ghost-button" data-action="cancelReturn">${icon('x')}Cancelar</button>
          <button class="primary-button danger-primary" data-action="confirmReturn">${icon('check')}Registrar devolução</button>
        </div>
      </section>
    </div>
  `;
}

function toast(message, variant = 'default') {
  const node = document.createElement('div');
  node.className = `toast toast-${variant}`;
  node.textContent = message;
  toastRoot.appendChild(node);
  setTimeout(() => node.remove(), 3400);
}

function roleFromIdentity(identity) {
  return identity && identity.isCurator ? 'Curador' : 'Colaborador';
}

function adoptLocalIdentity(identity, origem) {
  const email = identity && identity.email;
  if (!email) {
    return null;
  }
  const displayName =
    (identity.name && identity.name.trim()) || (identity.username && identity.username.trim()) || email.split('@')[0];
  const perfil = roleFromIdentity(identity);
  let user = state.users.find((item) => item.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    user = {
      id: `local-${email.toLowerCase()}`,
      nome: displayName,
      email,
      perfil,
      status: 'Ativo',
      origem: origem || 'Aplicativo local',
      senha: null,
      grupos: identity.groups || [],
      isCurator: Boolean(identity.isCurator),
      isAdmin: Boolean(identity.isAdmin),
      curatesActiveBalde: Boolean(identity.curatesActiveBalde),
      baldeAdmin: Boolean(identity.baldeAdmin),
      canCreateBuddy: Boolean(identity.canCreateBuddy),
      permissions: identity.permissions || null,
      ultimoAcesso: null
    };
    state.users.push(user);
  } else {
    user.perfil = perfil;
    user.grupos = identity.groups || [];
    user.isCurator = Boolean(identity.isCurator);
    user.isAdmin = Boolean(identity.isAdmin);
    user.curatesActiveBalde = Boolean(identity.curatesActiveBalde);
    user.baldeAdmin = Boolean(identity.baldeAdmin);
    user.canCreateBuddy = Boolean(identity.canCreateBuddy);
    user.permissions = identity.permissions || null;
  }
  return user;
}

async function attemptLocalLogin() {
  try {
    const res = await fetch('/api/me', { headers: { accept: 'application/json' } });
    if (!res.ok) {
      return false;
    }
    const identity = await res.json();
    if (identity && identity.theme) {
      applyTheme(identity.theme); // profile is the source of truth; reconcile the cache
    }
    if (identity && identity.buddySize) {
      applyBuddySize(identity.buddySize);
    }

    if (
      identity &&
      !layoutTouchedThisSession &&
      identity.layout &&
      typeof identity.layout === 'object' &&
      !Array.isArray(identity.layout)
    ) {
      applyServerLayout(identity.layout);
    } else if (identity && !identity.layout && !layoutTouchedThisSession) {
      saveLayoutPrefsDebounced();
    }
    const user = adoptLocalIdentity(identity, 'Aplicativo local');
    if (!user || user.status === 'Bloqueado' || user.status === 'Inativo') {
      return false;
    }
    user.ultimoAcesso = new Date().toISOString();
    state.auth = {
      isAuthenticated: true,
      user,
      mode: 'login',
      error: null,
      notice: null,
      resetEmail: ''
    };
    addLoginAudit('Sessão local iniciada', user.nome);
    state.view = 'chat';
    return true;
  } catch (error) {
    return false;
  }
}

async function logout() {
  try {
    const response = await fetch('/api/session/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Não foi possível encerrar a sessão. Tente novamente.');
    location.reload(); // Descarta também dados privados e tarefas pendentes na memória da página.
  } catch (error) {
    toast(error.message, 'warning');
  }
}

async function refresh() {
  await refreshRepos();
  if (state.mountsEnabled) await loadDomainList(); // local version: who sees the Domínios menu button
  try {
    state.skills = await provider.listSkills();
    state.proposals = await provider.listProposals();
  } catch (error) {
    state.skills = provider.skills;
    state.proposals = provider.proposals;
  }
  if (!state.selectedSkillId && state.skills.length) {
    state.selectedSkillId = state.skills[0].id;
  }
  if (curatesActiveBalde()) {
    await refreshQueueBadge();
  }
}

async function refreshRepos() {
  try {
    const res = await fetch('/api/repos', { headers: { accept: 'application/json' } });
    const data = await res.json();
    if (data && data.ok) {
      state.repos = data.repos || [];
      state.activeRepo = data.active || 'corporate';
      state.orgName = data.org || '';
      state.aiMode = data.aiMode || 'byok';
      state.readonlyCorpus = !!data.readonlyCorpus;
      state.mountsEnabled = !!data.mountsEnabled; // local version: baldes in any folder
      state.acessoApplier = !!data.acessoApplier; // local version: OneDrive access applier available
    }
  } catch (error) {
    /* switcher just stays hidden */
  }
}

async function switchRepo(name) {
  if (!name || name === state.activeRepo) return;
  try {
    const res = await fetch('/api/me/prefs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: name === 'corporate' ? null : name })
    });
    const data = await res.json();
    if (!data.ok) {
      alert(data.error || 'Não foi possível trocar de balde.');
      return;
    }
  } catch (error) {
    alert('Não foi possível trocar de balde.');
    return;
  }

  window.location.reload();
}

async function refreshQueueBadge() {
  try {
    const res = await fetch('/api/queue/count');
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    state.queuePendingCount = (data.counts && data.counts.pendente) || 0;
  } catch (error) {
    /* ignore — badge is best-effort */
  }
}

function skillNameById(id) {
  const skill = (state.skills || []).find((item) => item.id === id);
  return skill ? skill.nome : id;
}

function queueWhen(iso) {
  if (!iso) {
    return '';
  }
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch (error) {
    return iso;
  }
}

function queueStatusPill(status) {
  const map = { pendente: ['Pendente', 'warn'], aprovado: ['Aprovada', 'ok'], recusado: ['Recusada', 'muted'] };
  const [label, tone] = map[status] || map.pendente;
  return `<span class="queue-pill queue-pill-${tone}">${label}</span>`;
}

function computeQueueCountsLocal(items) {
  const counts = { pendente: 0, aprovado: 0, recusado: 0 };
  for (const item of items) {
    const status = item.status || 'pendente';
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function resolveBaldeDeepLink(raw) {
  const first = String(raw || '')
    .replace(/^\/+/, '')
    .split(/[/?#]/)[0]
    .toLowerCase();
  if (!first || first === 'open' || first === 'home' || first === 'inicio' || first === 'início') return null;
  const alias = {
    chat: 'chat',
    conversa: 'chat',
    fila: 'queue',
    queue: 'queue',
    curadoria: 'queue',
    capsulas: 'commons',
    cápsulas: 'commons',
    capsules: 'commons',
    commons: 'commons',
    corpus: 'explore',
    explorar: 'explore',
    explore: 'explore',
    skills: 'explore',
    grafo: 'graph',
    graph: 'graph',
    docs: 'docs',
    documentacao: 'docs',
    documentação: 'docs',
    dashboard: 'dashboard',
    'visao-geral': 'dashboard',
    'visão-geral': 'dashboard',
    governanca: 'dashboard',
    governança: 'dashboard',
    config: 'settings',
    configuracoes: 'settings',
    configurações: 'settings',
    settings: 'settings',
    admin: 'admin',
    administracao: 'admin',
    administração: 'admin',
    buddies: 'buddies'
  };
  return alias[first] || null;
}

async function navigate(view) {
  if (view === 'chat' && !chatAvailable()) {
    view = 'explore';
  }

  if (view !== 'chat') {
    plenariaDisconnect();
  }
  if (view !== 'graph') {
    destroyCorpusCy();
  } // the canvas island doesn't survive re-renders elsewhere
  state.view = view;
  state.readOnlyBrowse = false;

  if (view === 'createSkill' && state.wizard && state.wizard.editId) {
    state.wizard = null;
  }
  if (view !== 'explore') {
    state.evalResult = null;
  }
  renderShell();
  if (view === 'graph') {
    await openGraphView();
  }
  if (view === 'explore') {
    await openExplore();
  }
  if (view === 'buddies') {
    await openBuddies();
  }
  if (view === 'createSkill') {
    await loadWizardBuddies();
  }
  if (view === 'ingest') {
    await ingestLoadJobs();
    renderShell();
  }
  if (view === 'create' || view === 'createSkill' || view === 'createCommons') {
    loadUserList(); // Phase 4: user autocomplete
    loadCommonsConcepts(); // Phase 4: [[ commons link autocomplete
    loadEvalChecklistCached(); // Phase 2b: mandatory checklist preview on the eval step
  }
  if (view === 'docs') {
    await openDocs();
  }
  if (view === 'commons') {
    await openCommons();
  }
  if (view === 'ontologias') {
    await openOntologias();
  }
  if (view === 'domains') {
    await openDomainsAdmin();
  }
  if (view === 'archived') {
    await openArchived();
  }
  if (view === 'queue') {
    await openFila();
  }
  if (view === 'chat') {
    await openChat();
  }
  if (view === 'settings') {
    await openSettings();
  }
  if (view === 'admin') {
    await openAdmin();
  }
  if (view === 'api') {
    await openApiAccess();
  }
  if (view === 'prompts') {
    await openSettingsPrompts();
  }
  if (view === 'evalChecklist') {
    await openEvalChecklistAdmin();
  }
  if (view === 'groups') {
    await openSettingsGroups();
  }
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  try {
    localStorage.setItem('balde.sidebarCollapsed', state.sidebarCollapsed ? '1' : '0');
  } catch (error) {
    /* storage unavailable */
  }
  app.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  const button = document.querySelector('.sidebar-toggle');
  if (button) {
    button.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
    button.setAttribute('title', state.sidebarCollapsed ? 'Expandir menu' : 'Recolher menu');
  }
}

function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = Boolean(collapsed);
  try {
    localStorage.setItem('balde.sidebarCollapsed', state.sidebarCollapsed ? '1' : '0');
  } catch (error) {
    /* storage unavailable */
  }
}

function toggleNavCat(key) {
  if (!key) {
    return;
  }

  if (state.sidebarCollapsed) {
    if (!state.railClosed || typeof state.railClosed !== 'object') {
      state.railClosed = {};
    }
    state.railClosed[key] = !state.railClosed[key];
    try {
      localStorage.setItem('balde.railClosed', JSON.stringify(state.railClosed));
    } catch (error) {
      /* storage unavailable */
    }
    renderShell();
    return;
  }
  if (!state.navCollapsed || typeof state.navCollapsed !== 'object') {
    state.navCollapsed = {};
  }
  state.navCollapsed[key] = !state.navCollapsed[key];
  try {
    localStorage.setItem('balde.navCollapsed', JSON.stringify(state.navCollapsed));
  } catch (error) {
    /* storage unavailable */
  }
  renderShell();
}

const {
  slugifyClient,
  composeSkillIdClient,
  loadWizardBuddies,
  activeWizardForm,
  loadEvalChecklistCached,
  renderEvalWizardStep,
  wizardEvalTab,
  wizardEvalOptAdd,
  wizardEvalOptDel,
  wizardEvalOptReq,
  wizardEvalOptForbid,
  wizardEvalAddItem,
  wizardEvalRemoveItem,
  wizardEvalSuggest,
  persistWizardEval,
  loadWizardEval,
  renderCreateSkill,
  stripFrontmatter,
  CONTEXT_MAX_FILE,
  IMG_EXTS,
  fileExt,
  wizardSetContextBucket,
  wizardClassifyFiles,
  handleWizardContextFiles,
  handleWizardContextFolder,
  wizardRemoveContextFile,
  wizardToggleToCommons,
  wizardEditContextPath,
  wizardAddCurator,
  wizardRemoveCurator,
  wizardAddReader,
  wizardRemoveReader,
  syncWizardAcl,
  wizardAclAddEmail,
  loadDomainList,
  loadUserList,
  loadCommonsConcepts,
  renderUsersDatalist,
  domainAddNew,
  checkWizardSlug,
  wizardNext,
  wizardBack,
  wizardGoto,
  wizardCancel,
  openEditSkill,
  deleteSkillConfirm,
  deleteSkill,
  wizardPrefillBody,
  handleWizardMdFile,
  wizardAddEval,
  wizardRemoveEval,
  submitCreateSkill
} = createCreationFeature({
  state,
  currentAccessUser: (...args) => currentAccessUser(...args),
  renderShell: (...args) => renderShell(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  icon: (...args) => icon(...args),
  toast: (...args) => toast(...args),
  fileToBase64: (...args) => fileToBase64(...args),
  isBaldeAdmin: (...args) => isBaldeAdmin(...args),
  roleAllows: (...args) => roleAllows(...args),
  permissionAttrs: (...args) => permissionAttrs(...args),
  refusalNote: (...args) => refusalNote(...args),
  isCurator: (...args) => isCurator(...args),
  formatBytes: (...args) => formatBytes(...args),
  rosterChecklistHtml: (...args) => rosterChecklistHtml(...args),
  capsuleCategoryDef: (...args) => capsuleCategoryDef(...args),
  navigate: (...args) => navigate(...args),
  provider,
  refresh: (...args) => refresh(...args),
  slugCommonsSegClient: (...args) => slugCommonsSegClient(...args),
  base64ToUtf8: (...args) => base64ToUtf8(...args),
  openSkillInExplore: (...args) => openSkillInExplore(...args),
  loadSkillMedia: (...args) => loadSkillMedia(...args)
});

const { linkrefSync, linkrefClose, linkrefAccept, linkrefMenuOpen, handleLinkrefKey } = createLinkReferenceFeature({
  state,
  icon: (...args) => icon(...args),
  escapeHtml: (...args) => escapeHtml(...args)
});

const {
  ingestState,
  renderIngest,
  dupMatchList,
  ingestCheckDupes,
  ingestLoadDomains,
  ingestMaterialize,
  ingestEnsurePoll,
  ingestLoadJobs,
  ingestSend,
  renderCreateChooser,
  capsuleImportPick,
  manifestImportPick,
  manifestImportCompile,
  manifestImportSubmit,
  manifestImportReset,
  renderImportManifest
} = createIngestionFeature({
  state,
  escapeHtml: (...args) => escapeHtml(...args),
  icon: (...args) => icon(...args),
  renderShell: (...args) => renderShell(...args),
  curatesActiveBalde: (...args) => curatesActiveBalde(...args),
  refreshQueueBadge: (...args) => refreshQueueBadge(...args),
  isBaldeAdmin: (...args) => isBaldeAdmin(...args),
  isCurator: (...args) => isCurator(...args),
  roleAllows: (...args) => roleAllows(...args),
  toast: (...args) => toast(...args),
  stripFrontmatter: (...args) => stripFrontmatter(...args),
  initCommonsWizard: (...args) => initCommonsWizard(...args),
  slugCommonsSegClient: (...args) => slugCommonsSegClient(...args),
  navigate: (...args) => navigate(...args),
  readJsonResponse: (...args) => readJsonResponse(...args)
});

const {
  slugCommonsSegClient,
  initCommonsWizard,
  migrateToCapsule,
  openEditCommons,
  renderCreateCommons,
  cwGoto,
  cwBack,
  cwNext,
  cwCancel,
  cwPrefillBody,
  handleCommonsMdFile,
  handleCommonsMediaFiles,
  cwEditMediaPath,
  cwRemoveMedia,
  cwEditMediaDesc,
  cwDescribeMedia,
  cwDescribeAllMedia,
  cwAddCurator,
  cwRemoveCurator,
  cwAddReader,
  cwRemoveReader,
  cwAddEval,
  cwRemoveEval,
  submitCreateCommons
} = createCapsuleEditorFeature({
  state,
  currentAccessUser: (...args) => currentAccessUser(...args),
  loadDomainList: (...args) => loadDomainList(...args),
  isBaldeAdmin: (...args) => isBaldeAdmin(...args),
  isCurator: (...args) => isCurator(...args),
  roleAllows: (...args) => roleAllows(...args),
  permissionAttrs: (...args) => permissionAttrs(...args),
  refusalNote: (...args) => refusalNote(...args),
  toast: (...args) => toast(...args),
  renderShell: (...args) => renderShell(...args),
  loadUserList: (...args) => loadUserList(...args),
  loadCommonsConcepts: (...args) => loadCommonsConcepts(...args),
  loadEvalChecklistCached: (...args) => loadEvalChecklistCached(...args),
  loadWizardEval: (...args) => loadWizardEval(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  icon: (...args) => icon(...args),
  renderEvalWizardStep: (...args) => renderEvalWizardStep(...args),
  capsuleCategoryDef: (...args) => capsuleCategoryDef(...args),
  capsuleCategories: (...args) => capsuleCategories(...args),
  capsuleCategoryKey: (...args) => capsuleCategoryKey(...args),
  formatBytes: (...args) => formatBytes(...args),
  navigate: (...args) => navigate(...args),
  stripFrontmatter: (...args) => stripFrontmatter(...args),
  fileExt: (...args) => fileExt(...args),
  IMG_EXTS,
  CONTEXT_MAX_FILE,
  fileToBase64: (...args) => fileToBase64(...args),
  persistWizardEval: (...args) => persistWizardEval(...args),
  provider,
  refresh: (...args) => refresh(...args)
});

const {
  openEvalChecklistAdmin,
  renderEvalChecklistBody,
  renderEvalChecklistAdmin,
  eclAdd,
  eclRemove,
  eclEdit,
  eclOptAdd,
  eclOptDel,
  eclOptReq,
  eclOptForbid,
  eclSave,
  openScoringAdmin,
  scoringEdit,
  scoringSave,
  renderScoringBody
} = createEvaluationAdminFeature({
  state,
  roleAllows: (...args) => roleAllows(...args),
  permissionAttrs: (...args) => permissionAttrs(...args),
  permissionNote: (...args) => permissionNote(...args),
  renderShell: (...args) => renderShell(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  icon: (...args) => icon(...args),
  toast: (...args) => toast(...args)
});

const {
  renderDashboard,
  renderSkills,
  option,
  renderOverview,
  renderSkillInfoStrip,
  loadSkillMedia,
  wizardProcessMedia,
  skillProcessMedia,
  metricChart,
  renderReport
} = createSkillViewsFeature({
  state,
  feedbackCounts: (...args) => feedbackCounts(...args),
  maturityLabel: (...args) => maturityLabel(...args),
  pluralize: (...args) => pluralize(...args),
  icon: (...args) => icon(...args),
  formatCompact: (...args) => formatCompact(...args),
  totalMonth: (...args) => totalMonth(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  formatDate: (...args) => formatDate(...args),
  freshnessDot: (...args) => freshnessDot(...args),
  statusPill: (...args) => statusPill(...args),
  cssToken: (...args) => cssToken(...args),
  getOwners: (...args) => getOwners(...args),
  filteredSkills: (...args) => filteredSkills(...args),
  canManageSkill: (...args) => canManageSkill(...args),
  initials: (...args) => initials(...args),
  deprecationTag: (...args) => deprecationTag(...args),
  qualitySeal: (...args) => qualitySeal(...args),
  renderMarkdownSafe: (...args) => renderMarkdownSafe(...args),
  accessInitials: (...args) => accessInitials(...args),
  renderShell: (...args) => renderShell(...args),
  toast: (...args) => toast(...args)
});

const {
  renderFeedback,
  renderEvals,
  loadNodeEval,
  renderNodeEval,
  mergeLoadSelo,
  evalTab,
  evalAddItem,
  evalRemoveItem,
  evalAccept,
  evalReject,
  evalSave,
  evalRun,
  evalTestCase,
  evalSuggestCases,
  evalSuggestionAdd,
  evalSuggestionDismiss,
  evalPromote,
  renderProposalText,
  renderAiGenerateButton,
  isBasicRequirementProposal,
  renderApprovals
} = createEvaluationFeature({
  feedbackCounts: (...args) => feedbackCounts(...args),
  formatDate: (...args) => formatDate(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  canManageSkill: (...args) => canManageSkill(...args),
  permitted: (...args) => permitted(...args),
  permissionNote: (...args) => permissionNote(...args),
  state,
  renderShell: (...args) => renderShell(...args),
  icon: (...args) => icon(...args),
  toast: (...args) => toast(...args),
  provider,
  refresh: (...args) => refresh(...args),
  loadExploreSkill: (...args) => loadExploreSkill(...args)
});

const {
  renderSettings,
  toggleNotifyPref,
  baldesUserCreate,
  baldesUserMount,
  baldesUserUnmount,
  baldesUserSaveAccess,
  pollAcesso,
  acessoStart,
  acessoCopiar,
  meuBaldeCreate
} = createBaldeSettingsFeature({
  state,
  renderTokensCard: (...args) => renderTokensCard(...args),
  renderAiCliCard: (...args) => renderAiCliCard(...args),
  renderAppearanceCards: (...args) => renderAppearanceCards(...args),
  renderAiProviderCard: (...args) => renderAiProviderCard(...args),
  renderConnDiagCard: (...args) => renderConnDiagCard(...args),
  renderShell: (...args) => renderShell(...args),
  toast: (...args) => toast(...args),
  refreshRepos: (...args) => refreshRepos(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  icon: (...args) => icon(...args),
  switchRepo: (...args) => switchRepo(...args),
  parseCsvList: (...args) => parseCsvList(...args)
});

const {
  openCategoriasAdmin,
  saveCategoriasAdmin,
  renderCategoriasBody,
  renderDomainsView,
  renderDomainsBody,
  renderMoveSkillBody,
  renderUserDomainsPanel,
  loadUserDomainsAdmin,
  udEdit,
  udCancel,
  udToggle,
  udSave,
  moveSkillConfirm,
  openDomainsAdmin,
  addDomainAdmin,
  removeDomainAdmin,
  saveDomainsAdmin,
  domainRenameStart,
  domainRenameCancel,
  domainRenameConfirm,
  domainsSetSearch,
  domainsSetPage,
  toggleDomainGroup,
  renderSystemPromptsCard,
  openSettingsPrompts,
  savePrompt,
  resetPrompt,
  renderTokensCard,
  renderGroupsBody,
  renderGroups,
  rosterChecklistHtml,
  openSettingsGroups,
  newGroup,
  editGroup,
  cancelGroupEditor,
  addFreeEmail,
  saveGroup,
  deleteGroup
} = createAdministrationFeature({
  isBaldeAdmin: (...args) => isBaldeAdmin(...args),
  roleAllows: (...args) => roleAllows(...args),
  permissionAttrs: (...args) => permissionAttrs(...args),
  permissionNote: (...args) => permissionNote(...args),
  state,
  renderShell: (...args) => renderShell(...args),
  loadCapsuleCategories: (...args) => loadCapsuleCategories(...args),
  toast: (...args) => toast(...args),
  defaultCapsuleCategory: (...args) => defaultCapsuleCategory(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  icon: (...args) => icon(...args),
  domainsNavVisible: (...args) => domainsNavVisible(...args),
  domainRootKey: (...args) => domainRootKey(...args),
  loadUserList: (...args) => loadUserList(...args),
  loadDomainList: (...args) => loadDomainList(...args),
  provider,
  refresh: (...args) => refresh(...args),
  readJsonResponse: (...args) => readJsonResponse(...args),
  commonsDomainKey: (...args) => commonsDomainKey(...args),
  normalizeDomain: (...args) => normalizeDomain(...args),
  isAdmin: (...args) => isAdmin(...args),
  isCurator: (...args) => isCurator(...args)
});

const {
  aiModelPlaceholder,
  openSettings,
  openApiAccess,
  openAdmin,
  loadAdminTab,
  renderAdminApisCard,
  renderAdminUsageCard,
  selectApiExampleKey,
  copyApiCurl,
  saveAiConfig,
  clearAiKey,
  testAiKey,
  createApiToken,
  toggleRevealToken,
  copyToken,
  revokeApiToken,
  renameApiToken,
  cancelRenameToken,
  saveRenameToken,
  dismissNewToken,
  copyNewToken
} = createAiSettingsFeature({
  state,
  renderShell: (...args) => renderShell(...args),
  isAdmin: (...args) => isAdmin(...args),
  adminTabsAvailable: (...args) => adminTabsAvailable(...args),
  openSettingsPrompts: (...args) => openSettingsPrompts(...args),
  openDomainsAdmin: (...args) => openDomainsAdmin(...args),
  openCategoriasAdmin: (...args) => openCategoriasAdmin(...args),
  loadUserDomainsAdmin: (...args) => loadUserDomainsAdmin(...args),
  loadUsersAdmin: (...args) => loadUsersAdmin(...args),
  openSettingsGroups: (...args) => openSettingsGroups(...args),
  openEvalChecklistAdmin: (...args) => openEvalChecklistAdmin(...args),
  openScoringAdmin: (...args) => openScoringAdmin(...args),
  loadBaldesAdmin: (...args) => loadBaldesAdmin(...args),
  loadShareFolders: (...args) => loadShareFolders(...args),
  loadDedupAdmin: (...args) => loadDedupAdmin(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  fmtDateTime: (...args) => fmtDateTime(...args),
  icon: (...args) => icon(...args),
  toast: (...args) => toast(...args)
});

const {
  openExplore,
  openSkillInExplore,
  openCommonsInExplore,
  loadExploreCommonsConcept,
  exploreOpenRef,
  exploreBack,
  exploreCommonsToggleEdit,
  exploreCommonsSave,
  exploreCommonsProcessMedia,
  exploreCommonsKeepGreen,
  exploreCommonsRunEval,
  commonsToggleClosed,
  archiveCapsuleConfirm,
  archiveCapsule,
  exploreExpandAllGroups,
  exploreCollapseAllGroups,
  loadExploreSkill,
  setExploreTab,
  loadExploreGraph,
  toggleCorpusGraph,
  corpusOpenSkill,
  renderCorpusGraph
} = createExplorerNavigationFeature({
  state,
  skillDomainOf: (...args) => skillDomainOf(...args),
  commonsDomainKey: (...args) => commonsDomainKey(...args),
  renderShell: (...args) => renderShell(...args),
  navigate: (...args) => navigate(...args),
  readJsonResponse: (...args) => readJsonResponse(...args),
  skillGroupKey: (...args) => skillGroupKey(...args),
  toast: (...args) => toast(...args),
  commonsAction: (...args) => commonsAction(...args),
  canManageSkill: (...args) => canManageSkill(...args),
  openAccessTab: (...args) => openAccessTab(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  computeGraphLayout: (...args) => computeGraphLayout(...args)
});

const {
  capsuleCategoryDef,
  capsuleCategoryKey,
  loadCapsuleCategories,
  capsuleCategoryChip,
  capsuleCategoryGlyph,
  isOntologyPath,
  parseOntologyMarkdown,
  ontologyChip,
  openOntologias,
  renderOntologiasView,
  openOntologyEditor,
  openOntologyEditorNew,
  ontologySuggestAdditionsAi,
  ontologyCreateAi,
  renderOntologyEditorModal,
  closeOntologyEditor,
  ontologyAddConcept,
  ontologyRemoveConcept,
  saveOntology,
  openOntologyInExplorer,
  destroyCorpusCy,
  openGraphView,
  graphRefresh,
  renderGraphView,
  graphSetStyle,
  graphStyleToggle,
  graphToolbarToggle,
  graphDomainsToggle,
  graphDomainSet,
  graphDomainsClear,
  graphApplyPreset,
  graphFocusNode,
  graphFocusExit,
  graphForceLayoutName,
  graphThemeColors,
  mountCorpusGraph,
  graphSetOption,
  graphSearchInput,
  graphOpenNode,
  capsuleCategories,
  defaultCapsuleCategory
} = createKnowledgeGraphFeature({
  icon: (...args) => icon(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  permissionAttrs: (...args) => permissionAttrs(...args),
  state,
  renderShell: (...args) => renderShell(...args),
  govStatusBadge: (...args) => govStatusBadge(...args),
  toast: (...args) => toast(...args),
  refreshCommonsSilent: (...args) => refreshCommonsSilent(...args),
  navigate: (...args) => navigate(...args),
  loadExploreCommonsConcept: (...args) => loadExploreCommonsConcept(...args),
  openSkillInExplore: (...args) => openSkillInExplore(...args)
});

const {
  curatorKeepGreen,
  curatorKeepAllGreen,
  curatorRunEval,
  commonsMigratePlan,
  commonsMigrateToggle,
  commonsMigrateEditTo,
  commonsMigrateCancel,
  commonsMigrateApply,
  govStatusBadge,
  govDeprecatedChip,
  govEvalBadge,
  renderCuratorPanel,
  selectExploreFile,
  formatBytes
} = createContextReviewFeature({
  readJsonResponse: (...args) => readJsonResponse(...args),
  toast: (...args) => toast(...args),
  loadExploreGraph: (...args) => loadExploreGraph(...args),
  state,
  renderShell: (...args) => renderShell(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  icon: (...args) => icon(...args),
  isBaldeAdmin: (...args) => isBaldeAdmin(...args),
  roleAllows: (...args) => roleAllows(...args),
  permissionAttrs: (...args) => permissionAttrs(...args),
  isCurator: (...args) => isCurator(...args)
});

const { ensureSqlFormatted, openImageLightbox, renderMarkdownSafe } = createMarkdownFeature({
  escapeHtml: (...args) => escapeHtml(...args),
  icon: (...args) => icon(...args),
  skillPickerState: (...args) => skillPickerState(...args),
  renderShell: (...args) => renderShell(...args)
});

const {
  stripDocFrontmatter,
  openDocs,
  openDocFile,
  focusDocEditor,
  saveDoc,
  uploadDocImage,
  downloadDocTxt,
  publishDocsSkill,
  docsAllSectionNames,
  startDocsResize,
  createDoc
} = createDocumentsFeature({
  state,
  renderShell: (...args) => renderShell(...args),
  toast: (...args) => toast(...args)
});

const {
  openCommons,
  refreshCommonsSilent,
  commonsAction,
  commonsRunEval,
  commonsSetCadence,
  commonsSummarizeAll,
  CADENCE_LABEL_PT,
  commonsFreshCell,
  commonsPeopleCell,
  startCommonsColResize,
  renderCommons,
  commonsSetPage,
  commonsSetFilter,
  fmtDateTime,
  isLocalShell,
  openCommonsFile,
  commonsModalValidate,
  commonsProcessMedia,
  closeCommonsFile,
  toggleCommonsEdit,
  saveCommonsFile,
  renderCommonsFileModal,
  renderDocs
} = createCommonsViewFeature({
  state,
  renderShell: (...args) => renderShell(...args),
  readJsonResponse: (...args) => readJsonResponse(...args),
  toast: (...args) => toast(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  icon: (...args) => icon(...args),
  formatDate: (...args) => formatDate(...args),
  govStatusBadge: (...args) => govStatusBadge(...args),
  isOntologyPath: (...args) => isOntologyPath(...args),
  ontologyChip: (...args) => ontologyChip(...args),
  capsuleCategoryChip: (...args) => capsuleCategoryChip(...args),
  govDeprecatedChip: (...args) => govDeprecatedChip(...args),
  govEvalBadge: (...args) => govEvalBadge(...args),
  renderMarkdownSafe: (...args) => renderMarkdownSafe(...args),
  isAdmin: (...args) => isAdmin(...args),
  permissionAttrs: (...args) => permissionAttrs(...args),
  permissionNote: (...args) => permissionNote(...args),
  stripDocFrontmatter: (...args) => stripDocFrontmatter(...args),
  renderRepoHistory: (...args) => renderRepoHistory(...args)
});

const {
  commonsDomainKey,
  skillGroupKey,
  skillDomainOf,
  renderExplore,
  exploreHeaderCollapsed,
  renderRepoHistory,
  computeGraphLayout,
  destroySkillCy,
  mountSkillGraph,
  skillGraphSelect,
  buildFileTree,
  fileTreeCount,
  skillQueryRun,
  skillDataInspect,
  capsuleDataInspect
} = createExplorerViewFeature({
  escapeHtml: (...args) => escapeHtml(...args),
  domainRootKey: (...args) => domainRootKey(...args),
  isCurator: (...args) => isCurator(...args),
  isBaldeAdmin: (...args) => isBaldeAdmin(...args),
  roleAllows: (...args) => roleAllows(...args),
  permitted: (...args) => permitted(...args),
  permissionAttrs: (...args) => permissionAttrs(...args),
  permissionNote: (...args) => permissionNote(...args),
  currentAccessUser: (...args) => currentAccessUser(...args),
  state,
  canManageSkill: (...args) => canManageSkill(...args),
  cssToken: (...args) => cssToken(...args),
  isOntologyPath: (...args) => isOntologyPath(...args),
  icon: (...args) => icon(...args),
  capsuleCategoryDef: (...args) => capsuleCategoryDef(...args),
  capsuleCategoryGlyph: (...args) => capsuleCategoryGlyph(...args),
  renderCorpusGraph: (...args) => renderCorpusGraph(...args),
  CADENCE_LABEL_PT,
  renderMarkdownSafe: (...args) => renderMarkdownSafe(...args),
  parseOntologyMarkdown: (...args) => parseOntologyMarkdown(...args),
  fmtDateTime: (...args) => fmtDateTime(...args),
  commonsFreshCell: (...args) => commonsFreshCell(...args),
  govEvalBadge: (...args) => govEvalBadge(...args),
  commonsPeopleCell: (...args) => commonsPeopleCell(...args),
  govStatusBadge: (...args) => govStatusBadge(...args),
  govDeprecatedChip: (...args) => govDeprecatedChip(...args),
  ontologyChip: (...args) => ontologyChip(...args),
  capsuleCategoryChip: (...args) => capsuleCategoryChip(...args),
  isLocalShell: (...args) => isLocalShell(...args),
  renderNodeEval: (...args) => renderNodeEval(...args),
  statusPill: (...args) => statusPill(...args),
  deprecationTag: (...args) => deprecationTag(...args),
  renderCuratorPanel: (...args) => renderCuratorPanel(...args),
  renderReport: (...args) => renderReport(...args),
  renderFeedback: (...args) => renderFeedback(...args),
  renderEvals: (...args) => renderEvals(...args),
  renderAccessReadOnly: (...args) => renderAccessReadOnly(...args),
  renderOverview: (...args) => renderOverview(...args),
  renderSkillInfoStrip: (...args) => renderSkillInfoStrip(...args),
  qualitySeal: (...args) => qualitySeal(...args),
  freshnessDot: (...args) => freshnessDot(...args),
  statusLabel,
  formatDate: (...args) => formatDate(...args),
  metricChart: (...args) => metricChart(...args),
  graphThemeColors: (...args) => graphThemeColors(...args),
  graphForceLayoutName: (...args) => graphForceLayoutName(...args),
  formatBytes: (...args) => formatBytes(...args),
  renderShell: (...args) => renderShell(...args)
});

const {
  renderUploadModal,
  openUpload,
  closeUpload,
  submitUpload,
  base64ToUtf8,
  addDraftPastedFile,
  removeDraftFile,
  normalizeDomain,
  addDraftTag,
  removeDraftTag,
  readFileAsBase64,
  optimizePoseImage,
  handleDraftFiles
} = createNewDraftFeature({
  state,
  escapeHtml: (...args) => escapeHtml(...args),
  composeSkillIdClient: (...args) => composeSkillIdClient(...args),
  icon: (...args) => icon(...args),
  loadDomainList: (...args) => loadDomainList(...args),
  renderShell: (...args) => renderShell(...args),
  provider,
  refresh: (...args) => refresh(...args),
  toast: (...args) => toast(...args),
  openSkillInExplore: (...args) => openSkillInExplore(...args),
  loadSkillMedia: (...args) => loadSkillMedia(...args),
  pluralize: (...args) => pluralize(...args)
});

const {
  mergeStart,
  mergePromote,
  mergeClose,
  mergeWriteAndEval,
  mergePublish,
  mergeAnalyse,
  mergeSelectFile,
  mergeToggleEdit,
  mergeCloseEditor,
  mergeSkipFile,
  mergeGoto,
  renderMergeWizard
} = createMergeFeature({
  escapeHtml: (...args) => escapeHtml(...args),
  state,
  toast: (...args) => toast(...args),
  computeMergeSeed: (...args) => computeMergeSeed(...args),
  renderShell: (...args) => renderShell(...args),
  icon: (...args) => icon(...args),
  dupMatchList: (...args) => dupMatchList(...args),
  provider,
  refresh: (...args) => refresh(...args),
  loadNodeEval: (...args) => loadNodeEval(...args),
  mergeLoadSelo: (...args) => mergeLoadSelo(...args),
  openFila: (...args) => openFila(...args),
  loadCommonsConcepts: (...args) => loadCommonsConcepts(...args),
  linkrefClose: (...args) => linkrefClose(...args),
  skillNameById: (...args) => skillNameById(...args),
  fileTreeCount: (...args) => fileTreeCount(...args),
  buildFileTree: (...args) => buildFileTree(...args),
  renderNodeEval: (...args) => renderNodeEval(...args),
  cssToken: (...args) => cssToken(...args)
});

const {
  computeMergeSeed,
  openFila,
  openQueueItem,
  queuePreprocess,
  queueReassign,
  queueDecide,
  filaStep,
  renderQueue,
  openFilaItem,
  setFilaKind,
  setFilaStatus,
  feedbackToContribution,
  feedbackDismiss,
  queueCapsuleEditStart,
  queueCapsuleEditCancel,
  queueCapsuleAclAdd,
  queueCapsuleAclRemove,
  saveCapsuleEdit,
  queueCapsuleSeedBody
} = createQueueFeature({
  state,
  computeQueueCountsLocal: (...args) => computeQueueCountsLocal(...args),
  provider,
  renderShell: (...args) => renderShell(...args),
  toast: (...args) => toast(...args),
  curatesActiveBalde: (...args) => curatesActiveBalde(...args),
  roleAllows: (...args) => roleAllows(...args),
  permissionAttrs: (...args) => permissionAttrs(...args),
  permissionNote: (...args) => permissionNote(...args),
  skillNameById: (...args) => skillNameById(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  currentAccessUser: (...args) => currentAccessUser(...args),
  queueStatusPill: (...args) => queueStatusPill(...args),
  icon: (...args) => icon(...args),
  queueWhen: (...args) => queueWhen(...args),
  formatDate: (...args) => formatDate(...args),
  renderProposalText: (...args) => renderProposalText(...args),
  renderAiGenerateButton: (...args) => renderAiGenerateButton(...args),
  isBasicRequirementProposal: (...args) => isBasicRequirementProposal(...args),
  refresh: (...args) => refresh(...args),
  cssToken: (...args) => cssToken(...args),
  dupMatchList: (...args) => dupMatchList(...args),
  formatBytes: (...args) => formatBytes(...args)
});

const {
  ensureChatState,
  scrollChatToBottom,
  chatToggleExpand,
  exportChatYaml,
  exportPlenariaYaml,
  mentionSync,
  mentionClose,
  mentionAccept,
  mentionMenuOpen,
  handleMentionKey,
  readJsonResponse,
  openChat,
  openChatItem,
  newChat,
  sendChatMessage,
  addChatSkill,
  removeChatSkill,
  deleteChat,
  renderChat,
  skillPickerState,
  renderSkillPickerOptions,
  rateChatMessage,
  saveChatRename,
  copyCode,
  ensurePlenariaState,
  plenariaDisconnect,
  newPlenaria,
  toggleJoinPlenaria,
  joinPlenaria,
  openPlenariaItem,
  sendPlenariaMessage,
  togglePlenariaAskBuddy,
  ratePlenariaMessage,
  addPlenariaSkill,
  removePlenariaSkill,
  copyPlenariaKey,
  regeneratePlenariaKey,
  leavePlenaria,
  deletePlenaria,
  savePlenariaRename,
  addPendingFiles,
  removePendingAttachment,
  toggleSkillFiles,
  openContribute,
  closeContribute,
  handleContributeFiles,
  submitContribute,
  renderContributeModal
} = createConversationsFeature({
  state,
  setSidebarCollapsed: (...args) => setSidebarCollapsed(...args),
  renderShell: (...args) => renderShell(...args),
  toast: (...args) => toast(...args),
  slugifyClient: (...args) => slugifyClient(...args),
  icon: (...args) => icon(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  BUDDY_POSE_VOCAB,
  BUDDY_SIZES,
  skillDomainOf: (...args) => skillDomainOf(...args),
  renderMarkdownSafe: (...args) => renderMarkdownSafe(...args),
  currentAccessUser: (...args) => currentAccessUser(...args),
  queueWhen: (...args) => queueWhen(...args),
  pluralize: (...args) => pluralize(...args),
  formatBytes: (...args) => formatBytes(...args),
  selectedSkill: (...args) => selectedSkill(...args),
  fileToBase64: (...args) => fileToBase64(...args),
  curatesActiveBalde: (...args) => curatesActiveBalde(...args),
  refreshQueueBadge: (...args) => refreshQueueBadge(...args)
});

const {
  openBuddies,
  loadBuddyDetail,
  toggleBuddyGroup,
  expandAllBuddyGroups,
  collapseAllBuddyGroups,
  pickBuddyGroup,
  applyGlobalBuddyTheme,
  renderBuddies,
  openBuddyUpload,
  closeBuddyUpload,
  handleBuddyFiles,
  submitBuddyUpload,
  openBuddyEdit,
  closeBuddyEdit,
  handleEditPoseFile,
  markRemovePose,
  undoRemovePose,
  submitBuddyEdit,
  deleteBuddy,
  openPoseView,
  closePoseView,
  handlePoseViewFile,
  removePoseView
} = createBuddiesFeature({
  state,
  renderShell: (...args) => renderShell(...args),
  escapeHtml: (...args) => escapeHtml(...args),
  pluralize: (...args) => pluralize(...args),
  icon: (...args) => icon(...args),
  toast: (...args) => toast(...args),
  BUDDY_POSE_VOCAB,
  option: (...args) => option(...args),
  optimizePoseImage: (...args) => optimizePoseImage(...args),
  BUDDY_POSE_EXT_LIST,
  readFileAsBase64: (...args) => readFileAsBase64(...args)
});

const {
  renderAiProviderCard,
  loadAiCliStatus,
  aiMcpSetup,
  aiCliLogin,
  aiCliTest,
  aiCliUse,
  renderAiCliCard,
  runConnDiag,
  copyConnDiag,
  renderConnDiagCard,
  adminTabsAvailable,
  renderAdmin,
  loadUsersAdmin,
  toggleRoleGroup,
  usersAdminAdd,
  loadDedupAdmin,
  loadBaldesAdmin,
  parseCsvList,
  baldesCreate,
  baldesSave,
  renderApiAccess,
  renderAppearanceCards,
  toggleStartup,
  renderAppearance,
  renderPromptsPage
} = createIntegrationsFeature({
  state,
  escapeHtml: (...args) => escapeHtml(...args),
  icon: (...args) => icon(...args),
  aiModelPlaceholder,
  renderShell: (...args) => renderShell(...args),
  toast: (...args) => toast(...args),
  isAdmin: (...args) => isAdmin(...args),
  isBaldeAdmin: (...args) => isBaldeAdmin(...args),
  roleAllows: (...args) => roleAllows(...args),
  renderShareFoldersBody: (...args) => renderShareFoldersBody(...args),
  renderDomainsBody,
  renderCategoriasBody,
  renderMoveSkillBody,
  renderUserDomainsPanel,
  renderGroupsBody,
  renderEvalChecklistBody,
  renderScoringBody,
  refreshRepos: (...args) => refreshRepos(...args),
  renderAdminUsageCard,
  renderAdminApisCard,
  startViewOr: (...args) => startViewOr(...args),
  chatAvailable: (...args) => chatAvailable(...args),
  renderSystemPromptsCard
});

const {
  runAnalysis,
  runEvals,
  publishSuggestion,
  approveProposal,
  generateProposalWithAi,
  generateAdjustmentWithAi,
  syncAdjustmentApprovalButton,
  openManualAdjustment,
  saveManualAdjustment,
  openReturnProposal,
  confirmReturnProposal,
  rollback,
  saveSourceText,
  fileToBase64,
  uploadContextFiles,
  rollbackDraft
} = createProposalActionsFeature({
  state,
  openSkillInExplore,
  renderShell: (...args) => renderShell(...args),
  provider,
  refresh: (...args) => refresh(...args),
  toast: (...args) => toast(...args),
  isBasicRequirementProposal
});

const { loadShareFolders, renderShareFoldersBody, shareFoldersStart, shareFoldersCopy, shareFoldersRepoll } =
  createShareFoldersFeature({
    state,
    renderShell: (...args) => renderShell(...args),
    toast: (...args) => toast(...args),
    escapeHtml: (...args) => escapeHtml(...args),
    icon: (...args) => icon(...args),
    fmtDateTime: (...args) => fmtDateTime(...args)
  });

const { openArchived, renderArchived, restoreArchived } = createArchiveViewFeature({
  state,
  escapeHtml: (...args) => escapeHtml(...args),
  icon: (...args) => icon(...args),
  toast: (...args) => toast(...args),
  renderShell: (...args) => renderShell(...args),
  readJsonResponse: (...args) => readJsonResponse(...args),
  fmtDateTime: (...args) => fmtDateTime(...args),
  permissionAttrs: (...args) => permissionAttrs(...args),
  permissionNote: (...args) => permissionNote(...args),
  reloadSkills: async () => {
    await provider.reload();
    await refresh();
  }
});

bindUiEvents({
  state,
  startDocsResize,
  startCommonsColResize,
  linkrefAccept,
  mentionAccept,
  mentionMenuOpen,
  mentionClose,
  linkrefMenuOpen,
  linkrefClose,
  renderShell,
  setFilaKind,
  setFilaStatus,
  mergeSelectFile,
  logout,
  toggleSidebar,
  toggleNavCat,
  openUpload,
  closeUpload,
  submitUpload,
  openQueueItem,
  queuePreprocess,
  queueReassign,
  queueDecide,
  filaStep,
  queueCapsuleEditStart,
  queueCapsuleEditCancel,
  saveCapsuleEdit,
  queueCapsuleAclAdd,
  queueCapsuleAclRemove,
  queueCapsuleSeedBody,
  openContribute,
  closeContribute,
  submitContribute,
  savePrompt,
  resetPrompt,
  addDomainAdmin,
  domainRenameStart,
  domainRenameCancel,
  domainRenameConfirm,
  removeDomainAdmin,
  udEdit,
  toast,
  udCancel,
  udToggle,
  udSave,
  saveDomainsAdmin,
  toggleDomainGroup,
  domainsSetPage,
  wizardNext,
  wizardBack,
  wizardGoto,
  wizardCancel,
  wizardPrefillBody,
  submitCreateSkill,
  wizardClassifyFiles,
  wizardProcessMedia,
  wizardRemoveContextFile,
  wizardToggleToCommons,
  wizardRemoveCurator,
  wizardRemoveReader,
  wizardRemoveEval,
  cwGoto,
  cwBack,
  cwNext,
  cwCancel,
  cwPrefillBody,
  cwRemoveMedia,
  cwDescribeMedia,
  cwDescribeAllMedia,
  cwRemoveCurator,
  cwRemoveReader,
  cwRemoveEval,
  capsuleImportPick,
  manifestImportPick,
  manifestImportCompile,
  manifestImportSubmit,
  manifestImportReset,
  submitCreateCommons,
  skillProcessMedia,
  insertLinkrefTrigger,
  newChat,
  chatToggleExpand,
  scrollChatToBottom,
  exportChatYaml,
  exportPlenariaYaml,
  openChatItem,
  sendChatMessage,
  deleteChat,
  removeChatSkill,
  rateChatMessage,
  ensureChatState,
  saveChatRename,
  newPlenaria,
  toggleJoinPlenaria,
  joinPlenaria,
  openPlenariaItem,
  sendPlenariaMessage,
  ratePlenariaMessage,
  removePlenariaSkill,
  copyPlenariaKey,
  regeneratePlenariaKey,
  leavePlenaria,
  deletePlenaria,
  ensurePlenariaState,
  savePlenariaRename,
  removePendingAttachment,
  skillPickerState,
  addPlenariaSkill,
  addChatSkill,
  toggleSkillFiles,
  openImageLightbox,
  runAnalysis,
  runEvals,
  publishSuggestion,
  approveProposal,
  generateProposalWithAi,
  openReturnProposal,
  confirmReturnProposal,
  openManualAdjustment,
  saveManualAdjustment,
  generateAdjustmentWithAi,
  saveSourceText,
  uploadContextFiles,
  addDraftPastedFile,
  removeDraftFile,
  addDraftTag,
  removeDraftTag,
  loadExploreSkill,
  openSkillInExplore,
  setExploreTab,
  exploreHeaderCollapsed,
  exploreOpenRef,
  exploreBack,
  moveSkillConfirm,
  graphRefresh,
  graphOpenNode,
  graphStyleToggle,
  graphToolbarToggle,
  graphApplyPreset,
  graphDomainsToggle,
  graphFocusNode,
  graphFocusExit,
  loadExploreCommonsConcept,
  openOntologyInExplorer,
  openOntologyEditor,
  openOntologyEditorNew,
  ontologyCreateAi,
  ontologySuggestAdditionsAi,
  closeOntologyEditor,
  ontologyAddConcept,
  ontologyRemoveConcept,
  saveOntology,
  exploreExpandAllGroups,
  exploreCollapseAllGroups,
  openEditCommons,
  evalAddItem,
  evalRemoveItem,
  evalAccept,
  evalReject,
  evalTab,
  evalSave,
  evalRun,
  evalTestCase,
  evalSuggestCases,
  evalSuggestionAdd,
  evalSuggestionDismiss,
  evalPromote,
  wizardEvalAddItem,
  wizardEvalRemoveItem,
  wizardEvalSuggest,
  wizardEvalTab,
  wizardEvalOptAdd,
  wizardEvalOptReq,
  wizardEvalOptForbid,
  wizardEvalOptDel,
  eclAdd,
  eclRemove,
  eclOptAdd,
  eclOptReq,
  eclOptForbid,
  eclOptDel,
  eclSave,
  scoringSave,
  exploreCommonsToggleEdit,
  exploreCommonsSave,
  exploreCommonsProcessMedia,
  exploreCommonsKeepGreen,
  commonsToggleClosed,
  exploreCommonsRunEval,
  selectExploreFile,
  skillQueryRun,
  skillDataInspect,
  capsuleDataInspect,
  skillGraphSelect,
  curatorKeepGreen,
  curatorKeepAllGreen,
  curatorRunEval,
  commonsMigratePlan,
  migrateToCapsule,
  commonsMigrateToggle,
  commonsMigrateApply,
  commonsMigrateCancel,
  toggleCorpusGraph,
  corpusOpenSkill,
  commonsRunEval,
  commonsSummarizeAll,
  openCommonsFile,
  closeCommonsFile,
  toggleCommonsEdit,
  saveCommonsFile,
  commonsProcessMedia,
  commonsSetPage,
  isLocalShell,
  commonsModalValidate,
  omniOpen,
  copyCode,
  setSidebarCollapsed,
  saveAiConfig,
  loadAiCliStatus,
  aiCliLogin,
  aiCliTest,
  aiCliUse,
  aiMcpSetup,
  toggleStartup,
  toggleRoleGroup,
  usersAdminAdd,
  testAiKey,
  clearAiKey,
  runConnDiag,
  copyConnDiag,
  createApiToken,
  revokeApiToken,
  renameApiToken,
  cancelRenameToken,
  saveRenameToken,
  toggleRevealToken,
  copyToken,
  copyApiCurl,
  switchRepo,
  baldesUserCreate,
  baldesUserMount,
  baldesUserUnmount,
  baldesUserSaveAccess,
  acessoStart,
  acessoCopiar,
  pollAcesso,
  toggleNotifyPref,
  saveCategoriasAdmin,
  loadAdminTab,
  baldesCreate,
  baldesSave,
  meuBaldeCreate,
  loadDedupAdmin,
  domainAddNew,
  ingestSend,
  ingestMaterialize,
  ingestState,
  ingestLoadJobs,
  ingestLoadDomains,
  ingestCheckDupes,
  ingestEnsurePoll,
  navigate,
  openFilaItem,
  mergeStart,
  mergePromote,
  mergeClose,
  mergeAnalyse,
  mergeToggleEdit,
  mergeCloseEditor,
  mergeSkipFile,
  mergeGoto,
  mergeWriteAndEval,
  mergePublish,
  feedbackToContribution,
  feedbackDismiss,
  restoreArchived,
  setTheme,
  setBuddySize,
  setStartView,
  dismissNewToken,
  copyNewToken,
  newGroup,
  editGroup,
  cancelGroupEditor,
  addFreeEmail,
  saveGroup,
  deleteGroup,
  shareFoldersStart,
  shareFoldersCopy,
  shareFoldersRepoll,
  wizardAclAddEmail,
  openDocFile,
  focusDocEditor,
  saveDoc,
  createDoc,
  downloadDocTxt,
  docsAllSectionNames,
  publishDocsSkill,
  openEditSkill,
  deleteSkillConfirm,
  loadBuddyDetail,
  toggleBuddyGroup,
  applyGlobalBuddyTheme,
  expandAllBuddyGroups,
  collapseAllBuddyGroups,
  pickBuddyGroup,
  openPoseView,
  closePoseView,
  removePoseView,
  openBuddyUpload,
  closeBuddyUpload,
  submitBuddyUpload,
  openBuddyEdit,
  closeBuddyEdit,
  submitBuddyEdit,
  markRemovePose,
  undoRemovePose,
  pluralize,
  rollback,
  rollbackDraft,
  deleteBuddy,
  deleteSkill,
  archiveCapsuleConfirm,
  archiveCapsule,
  graphSearchInput,
  graphSetStyle,
  cwEditMediaDesc,
  linkrefSync,
  activeWizardForm,
  eclEdit,
  selectApiExampleKey,
  slugifyClient,
  domainsSetSearch,
  wizardAddCurator,
  wizardAddReader,
  slugifyCatKey,
  cwAddCurator,
  cwAddReader,
  mentionSync,
  renderSkillPickerOptions,
  syncAdjustmentApprovalButton,
  commonsSetFilter,
  loadCommonsConcepts,
  refocusSearch,
  graphSetOption,
  graphDomainsClear,
  graphDomainSet,
  syncWizardAcl,
  uploadDocImage,
  commonsSetCadence,
  scoringEdit,
  wizardEditContextPath,
  wizardSetContextBucket,
  handleCommonsMediaFiles,
  handleCommonsMdFile,
  cwEditMediaPath,
  commonsMigrateEditTo,
  checkWizardSlug,
  handleWizardMdFile,
  handleWizardContextFiles,
  handleWizardContextFolder,
  togglePlenariaAskBuddy,
  addPendingFiles,
  handleContributeFiles,
  handleDraftFiles,
  handleBuddyFiles,
  handleEditPoseFile,
  handlePoseViewFile,
  handleLinkrefKey,
  omniResults,
  closeOmni,
  handleMentionKey,
  wizardAddEval,
  cwAddEval,
  isBaldeAdmin
});

applyTheme(state.theme);
if (!state.auth.isAuthenticated) {
  await attemptLocalLogin();
}

try {
  const vr = await fetch('/api/version').then((r) => r.json());
  if (vr && vr.ok && vr.version) {
    state.version = vr.version;
    document.title = `Balde ${vr.version} · Governança de Skills`;
  }
} catch (error) {
  /* keep the static <title> */
}
await refresh();

if (state.auth.isAuthenticated) {
  const sv = startViewOr('explore');
  if (sv === 'explore') {
    await navigate('explore');
  } else if (sv === 'graph') {
    await navigate('graph');
  } else if (state.view === 'chat' && chatAvailable()) {
    await openChat();
  } else if (!chatAvailable()) {
    await navigate('explore');
  }
}

if (state.auth.isAuthenticated) {
  try {
    const raw = new URLSearchParams(location.search).get('balde');
    const target = resolveBaldeDeepLink(raw);
    if (target && target !== state.view) {
      await navigate(target);
    }
    if (raw) {
      const url = new URL(location.href);
      url.searchParams.delete('balde');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  } catch (error) {
    /* malformed link — ignore, stay on the start page */
  }
}
renderShell();

if (state.auth.isAuthenticated) {
  loadCapsuleCategories().then(() => renderShell());
}

scrollChatToBottom();

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-retry-corpus]');
  if (!button) return;
  button.disabled = true;
  provider.loadedFromDisk = false;
  await refresh();
  renderShell();
});

document.addEventListener('click', (event) => {
  const page = event.target.closest('[data-fila-page]');
  if (page) {
    state.fila.page = Number(page.dataset.filaPage);
    renderShell();
  }
  if (event.target.closest('[data-fila-back]')) {
    state.fila.selected = null;
    renderShell();
  }
});

app.addEventListener('input', () => sizeReviewEditors(app));
window.addEventListener('resize', () => sizeReviewEditors(app));
