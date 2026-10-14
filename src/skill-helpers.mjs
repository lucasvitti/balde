// Pure skill helpers (modularization stage 5c): freshness, mock metrics, file
// listing, eval-case loading, governance-issue detection, quality score. No app
// state — take dirs/data as arguments. The heavy loadSkillsFromDisk loader and the
// governance/drafts machinery stay in server.js (a tangled subtree for a later pass).
import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { pathExists } from './fs-utils.mjs';

export function freshnessFromDate(date, status) {
  if (status !== 'canonico' || !date) {
    return 'neutro';
  }

  const ageInDays = (Date.now() - new Date(`${date}T00:00:00-03:00`).getTime()) / 86400000;
  if (ageInDays < 183) {
    return 'verde';
  }
  if (ageInDays < 274) {
    return 'amarelo';
  }
  return 'vermelho';
}

export function buildMetrics(seed) {
  const labels = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun'];
  return labels.map((periodo, index) => ({
    periodo,
    execucoes: Math.max(4, Math.round(seed * (0.65 + index * 0.11))),
    usuariosDistintos: Math.max(2, Math.round(seed / 5 + index)),
    tokens: Math.max(1200, Math.round(seed * 520 * (0.7 + index * 0.08))),
    reusoPorNaoAutores: Math.min(82, Math.round(22 + seed / 4 + index * 2))
  }));
}

export async function listRelativeFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === 'desktop.ini') {
      continue;
    }

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(fullPath, base)));
    } else {
      files.push(fullPath.slice(base.length + 1));
    }
  }

  return files;
}

export async function loadEvalCases(skillDir) {
  const evalPath = join(skillDir, 'eval', 'cases.json');
  if (!(await pathExists(evalPath))) {
    return [];
  }

  try {
    const parsed = JSON.parse(await readFile(evalPath, 'utf8'));
    // v3 unified eval stores `items`; v2 stored `cases`; v1 was a bare array. Read all three so
    // the promotion gate + governance checks still see the eval (a v3 file has NO `cases` key).
    const cases = Array.isArray(parsed) ? parsed : parsed.items || parsed.cases || [];
    return cases.map((item, index) => ({
      id: item.id || `eval-${index + 1}`,
      descricao: item.title || item.description || item.descricao || item.name || `Caso ${index + 1}`,
      mustRefuse: Boolean(item.must_refuse || item.mustRefuse),
      ultimoResultado: 'pendente'
    }));
  } catch {
    return [];
  }
}

export function governanceIssues(meta, evals, files) {
  return [
    !meta.status ? 'status ausente no frontmatter' : null,
    !meta.objetivo ? 'objetivo ausente no frontmatter' : null,
    !meta.escopo ? 'escopo ausente no frontmatter' : null,
    !evals.length ? 'eval/cases.json ausente' : null,
    !files.some((file) => file.endsWith('output_schema.json')) && meta.output_format === 'structured'
      ? 'output_schema.json ausente para saída estruturada'
      : null
  ].filter(Boolean);
}

export function qualityScore(meta, evals, issues, files) {
  let score = 55;
  if (meta.version) score += 8;
  if (meta.owner) score += 8;
  if (meta.data_updated) score += 8;
  if (meta.formula_safe === true || meta.formula_safe === false) score += 5;
  if (evals.length) score += 12;
  if (files.some((file) => file.endsWith('output_schema.json'))) score += 5;
  score -= issues.length * 8;
  return Math.max(25, Math.min(96, score));
}
