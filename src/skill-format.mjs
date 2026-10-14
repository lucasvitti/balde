// Pure text / format / validation helpers for skills.
// Extracted from server.js (modularization stage 1). No shared state, no I/O —
// safe to import anywhere. Everything here is a pure function of its arguments.

export function parseFrontmatter(markdown) {
  const cleanMarkdown = markdown.replace(/^﻿/, '');
  const match = cleanMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      meta: {},
      body: cleanMarkdown
    };
  }

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!item) {
      continue;
    }

    const [, key, rawValue] = item;
    let value = rawValue.trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      // Double-quoted values are JSON-encoded on write (formatFrontmatterValue → JSON.stringify),
      // so decode them symmetrically here. A plain slice would leave the escapes in place, and the
      // next write would JSON-escape them again — doubling backslashes/newlines on every round-trip.
      // Fall back to a bare unquote if the value isn't valid JSON (e.g. a hand-authored path).
      try {
        value = JSON.parse(value);
      } catch (error) {
        value = value.slice(1, -1);
      }
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (/^\d+(\.\d+)?$/.test(value) && key !== 'version' && key !== 'code') {
      value = Number(value);
    }
    meta[key] = value;
  }

  return {
    meta,
    body: cleanMarkdown.slice(match[0].length)
  };
}

// A skill id is a folder path `<domain>/<subpath?>/<slug>` of 1..MAX_SKILL_ID_DEPTH segments:
// 1 = legacy flat `<slug>`, 2 = `<domain>/<slug>`, deeper = free ungoverned sub-folders under the
// governed domain (only the FIRST segment is vocab-governed). Each segment uses the safe charset;
// no traversal, no empty/leading/trailing slash. Mirrors the commons id shape so folder-based
// skills resolve via join(skillsRoot, id) unchanged.
export const MAX_SKILL_ID_DEPTH = 5;
export function isSafeSkillId(skillId) {
  const clean = String(skillId || '')
    .trim()
    .replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || clean.endsWith('/')) {
    return false;
  }
  const parts = clean.split('/');
  if (parts.length < 1 || parts.length > MAX_SKILL_ID_DEPTH) {
    return false;
  }
  // Segmentos com "_" ou "." no início não são skills (as listagens os pulam): "_archived" guarda as
  // arquivadas, que só a restauração traz de volta, nunca um acesso pelo id.
  return parts.every((p) => p && !p.startsWith('.') && !p.startsWith('_') && /^[a-zA-Z0-9._-]+$/.test(p));
}

export function assertSafeSkillId(skillId) {
  if (!isSafeSkillId(skillId)) {
    throw new Error('skillId invalido para persistencia local');
  }
}

export function assertSafeUploadName(name) {
  const clean = String(name || '').trim();
  if (!clean || clean.includes('/') || clean.includes('\\') || clean === '.' || clean === '..') {
    throw new Error(`Nome de arquivo invalido: ${name || '(vazio)'}`);
  }
  if (clean.length > 160) {
    throw new Error(`Nome de arquivo muito longo: ${clean}`);
  }
  return clean;
}

export function assertContextTargetKind(kind) {
  if (!['analytics', 'query'].includes(kind)) {
    throw new Error('Destino invalido. Use analytics ou query.');
  }
  return kind;
}

// Like assertSafeUploadName but allows nested relative paths (folder uploads keep
// their tree, e.g. `referencias/catalog/z04.md`). Rejects traversal, absolute
// paths and empty/oversized segments so a folder import can never escape the skill dir.
export function assertSafeRelPath(relPath) {
  const clean = String(relPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!clean) {
    throw new Error('Caminho de arquivo vazio.');
  }
  if (clean.length > 400) {
    throw new Error(`Caminho muito longo: ${relPath}`);
  }
  const parts = clean.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') {
      throw new Error(`Caminho de arquivo invalido: ${relPath}`);
    }
    if (part.length > 160) {
      throw new Error(`Nome de arquivo muito longo: ${part}`);
    }
  }
  return clean;
}

// O que a governança grava na pasta de uma skill nunca vem de um anexo nem de um arquivo renomeado: a versão
// publicada (canonico), o rascunho e o histórico, as avaliações e os registros de governança. Até a 2.0.18 um
// anexo podia escrever ali e, por exemplo, forjar o veredito que libera a publicação.
const RESERVED_SKILL_DIRS = new Set(['canonico', 'rascunho', 'legado', 'logs', 'eval']);
const RESERVED_SKILL_FILES = new Set([
  'governance.json',
  'context-index.json',
  'suggestions.json',
  'publication.lock',
  'arquivamento.json'
]);
export function isReservedSkillPath(relPath) {
  const parts = String(relPath || '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .split('/')
    .filter(Boolean);
  if (!parts.length) return false;
  if (parts.some((part) => part.startsWith('.'))) return true;
  return RESERVED_SKILL_DIRS.has(parts[0]) || (parts.length === 1 && RESERVED_SKILL_FILES.has(parts[0]));
}

export function safeSlug(value = '') {
  return (
    String(value)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'item'
  );
}

export function fileStamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function nextPatchVersion(version = '0.0.0') {
  const parts = String(version)
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  const [major = 0, minor = 0, patch = 0] = parts.map((part) => (Number.isFinite(part) ? part : 0));
  return `${major}.${minor}.${patch + 1}`;
}

export function formatFrontmatterValue(value) {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }

  return JSON.stringify(String(value || ''));
}

export function serializeFrontmatter(meta) {
  return Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`)
    .join('\n');
}

export function upsertFrontmatter(markdown, fields) {
  const { meta, body } = parseFrontmatter(markdown);
  const nextMeta = {
    ...meta,
    ...fields
  };

  return `---\n${serializeFrontmatter(nextMeta)}\n---\n\n${body.replace(/^\s+/, '').trimEnd()}\n`;
}

export function extractFencedBlock(value = '', language = '') {
  const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = language
    ? new RegExp(`\`\`\`${escaped}\\s*\\n([\\s\\S]*?)\\n\`\`\``, 'i')
    : /```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```/;
  const match = String(value).match(pattern);
  return match ? match[1].trim() : String(value).trim();
}

export function unquoteConfigValue(value = '') {
  const trimmed = String(value).trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseFrontmatterSuggestion(value = '') {
  const body = extractFencedBlock(value, 'yaml');
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    fields[match[1]] = unquoteConfigValue(match[2]);
  }
  return fields;
}

export function parseJsonSuggestion(value = '') {
  const body = extractFencedBlock(value, 'json');
  return JSON.parse(body);
}

export function slugifySkillId(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Starter scaffold for a brand-new draft skill: OKF frontmatter + the Balde
// governance superset + guided body sections the owner fills in. Born as
// `status: rascunho` so it can never reach canonical without passing the gate.
export function buildStarterSkillMarkdown(opts = {}) {
  const {
    title,
    kind = 'skill',
    description = '',
    tags = [],
    objetivo = '',
    escopo = '',
    owner = '',
    timestamp = '',
    resource = '',
    buddyId = '',
    outputShape = '',
    inputKind = 'text',
    formulaSafe = true,
    modelTier = 'economico',
    maxTokens = 4096,
    temperature = 0,
    allowedTools = [],
    dataCatalogs = [],
    reportRefs = [],
    skillKind = '',
    status = 'rascunho',
    version = '0.1.0',
    body = ''
  } = opts;
  const q = (value) => JSON.stringify(String(value == null ? '' : value));
  const inlineList = (arr) => `[${(Array.isArray(arr) ? arr : []).filter(Boolean).join(', ')}]`;
  const tagList = (Array.isArray(tags) ? tags : []).filter(Boolean);
  const desc = String(description || '').trim() || 'Descreva em uma frase o que esta skill entrega.';
  const obj = String(objetivo || '').trim() || desc;
  const esc =
    String(escopo || '').trim() ||
    'Descreva o que a skill FAZ e o que ela NÃO faz: dados que não busca, suposições que não faz, casos em que deve recusar.';
  const shape = ['scalar', 'list', 'table', 'report'].includes(outputShape) ? outputShape : '';
  const head = [
    '---',
    '# --- OKF (Open Knowledge Format) ---',
    `kind: ${['catalog', 'report'].includes(kind) ? kind : 'skill'}`,
    'type: skill',
    `title: ${q(title)}`,
    `description: ${q(desc)}`,
    `timestamp: ${q(timestamp)}`
  ];
  if (buddyId) {
    head.push(`buddy_id: ${buddyId}`);
  }
  if (resource) {
    head.push(`resource: ${q(resource)}`);
  }
  const gov = [
    '# --- Governança (superset Balde) ---',
    `status: ${['rascunho', 'canonico', 'depreciado'].includes(String(status)) ? status : 'rascunho'}`,
    `owner: ${q(owner)}`,
    `version: ${JSON.stringify(String(version || '0.1.0'))}`,
    `objetivo: ${q(obj)}`,
    `escopo: ${q(esc)}`,
    `model_tier: ${String(modelTier || 'economico')}`
  ];
  if (['knowledge', 'revenuehub'].includes(String(skillKind))) {
    gov.push(`skill_kind: ${skillKind}`);
  }
  if (shape) {
    gov.push(`output_shape: ${shape}`);
  }
  gov.push(`output_format: ${shape === 'table' ? 'structured' : 'text'}`);
  gov.push(`input_kind: ${['range', 'text', 'none'].includes(inputKind) ? inputKind : 'text'}`);
  gov.push(`formula_safe: ${formulaSafe === false ? 'false' : 'true'}`);
  gov.push(`max_tokens: ${Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : 4096}`);
  gov.push(`temperature: ${Number.isFinite(Number(temperature)) ? Number(temperature) : 0}`);
  if (Array.isArray(allowedTools) && allowedTools.length) {
    gov.push(`allowed_tools: ${inlineList(allowedTools)}`);
  }
  if (Array.isArray(dataCatalogs) && dataCatalogs.length) {
    gov.push(`data_catalogs: ${inlineList(dataCatalogs)}`);
  }
  if (Array.isArray(reportRefs) && reportRefs.length) {
    gov.push(`report_refs: ${inlineList(reportRefs)}`);
  }
  gov.push('---');
  const providedBody = String(body || '').trim();
  const defaultBody = [
    '',
    '## Papel',
    '',
    'Você é um assistente que executa esta skill em português (pt-BR), usando apenas o que estiver na entrada.',
    '',
    `**Objetivo:** ${obj}`,
    '',
    '## Como responder',
    '',
    '- Descreva, passo a passo, como a resposta deve ser produzida.',
    '- Defina o formato de saída (campos, ordem, estrutura). Havendo `output_schema.json`, responda nesse formato.',
    '- Deixe claro o que entra e o que sai.',
    '',
    '## Regras inegociáveis',
    '',
    '- **Não invente** dados, números, nomes ou prazos que não estejam na entrada.',
    '- Se faltar base para responder, **recuse** e diga o que falta — não preencha por suposição.',
    '- Não busque informação fora do contexto fornecido.',
    ''
  ].join('\n');
  const finalBody = providedBody ? `\n${providedBody}\n` : defaultBody;
  return [...head, ...gov, finalBody].join('\n');
}

// OKF (Open Knowledge Format) helpers
export function parseOkfTags(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .replace(/^\[|\]$/g, '')
    .split(/[,;]/)
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}
