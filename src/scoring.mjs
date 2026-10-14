// Selo de qualidade: configurable weighted scoring engine (pure — no I/O, no app state).
// The GATE (deriveEvalOverall in server.js) decides IF a skill can become canonical; the SELO
// says how GOOD it is. Five dimensions, each 0–100, combined by admin-configurable weights
// (Config → Pontuação, stored as prompts/scoring-config.json):
//   casos      — richness of the author's use cases (count vs target, per-case depth, refusal coverage)
//   validacao  — integrity of the mandatory validation (AI-passed gate items; forced accepts discount)
//   governanca — frontmatter completeness (status/objetivo/escopo/owner/version/review/output_schema)
//   clareza    — clarity & safety text heuristics (role, refusal language, pt-BR, no embedded secret)
//   frescor    — freshness of the last review
import { normalizeText } from './governance.mjs';

export const DEFAULT_SCORING_CONFIG = {
  weights: { casos: 35, validacao: 25, governanca: 20, clareza: 15, frescor: 5 },
  bands: { A: 85, B: 70, C: 55 },
  casosAlvo: 5, // use-case count with full "contagem" credit (diminishing returns anchor)
  penalidadeAceiteForcado: 25, // Selo points each forced accept (human accept over a non-passing AI verdict) costs
  // Depreciação derivada de cápsulas ABERTAS (fechadas são imunes): critérios admin-configuráveis.
  // 0 desliga o critério de dias; capEvalReprovada é 0/1.
  deprecation: {
    capVencidaDias: 30, // vencida (overdue) há mais de N dias → DEPRECIADA
    capSemRevisaoDias: 365, // última revisão há mais de N dias → DEPRECIADA (mesmo sem vencer)
    capEvalReprovada: 1 // avaliação reprovada (eval fail) → DEPRECIADA
  }
};

const SECRET_RE =
  /(sk-[a-zA-Z0-9_-]{16,}|api[_-]?key\s*[:=]\s*["']?[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}|senha\s*[:=]|password\s*[:=])/i;

export function normScoringConfig(x) {
  const d = DEFAULT_SCORING_CONFIG;
  // null/undefined/'' must fall back (Number(null) === 0 would silently clamp to min instead).
  const num = (v, fb, min, max) => {
    if (v === null || v === undefined || v === '') return fb;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fb;
  };
  const w = (x && x.weights) || {};
  const b = (x && x.bands) || {};
  const bands = { A: num(b.A, d.bands.A, 1, 100), B: num(b.B, d.bands.B, 0, 100), C: num(b.C, d.bands.C, 0, 100) };
  bands.B = Math.min(bands.B, bands.A); // keep A ≥ B ≥ C so the grade mapping stays monotonic
  bands.C = Math.min(bands.C, bands.B);
  return {
    weights: {
      casos: num(w.casos, d.weights.casos, 0, 100),
      validacao: num(w.validacao, d.weights.validacao, 0, 100),
      governanca: num(w.governanca, d.weights.governanca, 0, 100),
      clareza: num(w.clareza, d.weights.clareza, 0, 100),
      frescor: num(w.frescor, d.weights.frescor, 0, 100)
    },
    bands,
    casosAlvo: num(x && x.casosAlvo, d.casosAlvo, 1, 20),
    penalidadeAceiteForcado: num(x && x.penalidadeAceiteForcado, d.penalidadeAceiteForcado, 0, 100),
    deprecation: {
      capVencidaDias: num(x && x.deprecation && x.deprecation.capVencidaDias, d.deprecation.capVencidaDias, 0, 3650),
      capSemRevisaoDias: num(
        x && x.deprecation && x.deprecation.capSemRevisaoDias,
        d.deprecation.capSemRevisaoDias,
        0,
        3650
      ),
      capEvalReprovada: num(x && x.deprecation && x.deprecation.capEvalReprovada, d.deprecation.capEvalReprovada, 0, 1)
    }
  };
}

export function gradeForScore(total, cfg) {
  const b = (cfg && cfg.bands) || DEFAULT_SCORING_CONFIG.bands;
  return total >= b.A ? 'A' : total >= b.B ? 'B' : total >= b.C ? 'C' : 'D';
}

// input: { meta, body, files, storedEval: {items, mandatory}, checklist (mandatory defs w/ mode), frescor }
export function computeSelo(input, cfgIn) {
  const cfg = normScoringConfig(cfgIn);
  const meta = input.meta || {};
  const body = String(input.body || '');
  const text = normalizeText(`${body}\n${meta.description || ''}`);
  const files = input.files || [];
  const stored = input.storedEval || { items: [], mandatory: {} };
  const items = Array.isArray(stored.items) ? stored.items : [];
  const mandatory = stored.mandatory || {};
  const checklist = Array.isArray(input.checklist) ? input.checklist : [];

  // 1) Riqueza dos casos de uso: count (40, diminishing to the target) + per-case depth (35,
  //    fraction of title/question/expected/prompt/rubric filled) + refusal coverage (25).
  const n = items.length;
  const contagem = Math.min(1, n / Math.max(1, cfg.casosAlvo)) * 40;
  const depthAvg = n
    ? items.reduce(
        (s, c) => s + [c.title, c.question, c.expected, c.prompt, (c.opcoes || []).length].filter(Boolean).length / 5,
        0
      ) / n
    : 0;
  const recusa = items.some((c) => c.mustRefuse) ? 25 : 0;
  const casos = Math.round(contagem + depthAvg * 35 + recusa);

  // 2) Integridade da validação: fraction of GATE items satisfied (AI pass, or forced accept),
  //    minus a penalty per forced accept. Never run → 0 (an unvalidated skill scores no integrity).
  const gateItems = checklist.filter((m) => (m.mode || 'gate') === 'gate');
  let satisfied = 0;
  let forcados = 0;
  for (const m of gateItems) {
    const r = mandatory[m.id] || {};
    const passed = r.aiVerdict === 'pass';
    const forced = !passed && r.accepted === 'accepted';
    if (passed || forced) satisfied += 1;
    if (forced) forcados += 1;
  }
  const validacao = gateItems.length
    ? Math.max(0, Math.round((satisfied / gateItems.length) * 100 - forcados * cfg.penalidadeAceiteForcado))
    : 0;

  // 3) Governança: frontmatter completeness.
  const govChecks = [
    !!meta.status,
    !!meta.objetivo,
    !!meta.escopo,
    !!meta.owner,
    !!meta.version,
    !!(meta.last_reviewed || meta.data_updated || meta.timestamp),
    meta.output_format !== 'structured' || files.some((f) => String(f).endsWith('output_schema.json'))
  ];
  const governanca = Math.round((govChecks.filter(Boolean).length / govChecks.length) * 100);

  // 4) Clareza & segurança: same deterministic signals as the local draft review.
  const hasRole = text.includes('voce e') || text.includes('you are');
  const hasRefusal = text.includes('nao invente') || text.includes('responda apenas') || text.includes('recuse');
  const hasPtBr = text.includes('pt-br') || text.includes('portugues') || /[ãõçáéíóú]/i.test(body);
  const hasSecret = SECRET_RE.test(`${body}\n${JSON.stringify(meta)}`);
  const clareza = Math.round(([hasRole, hasRefusal, hasPtBr, !hasSecret].filter(Boolean).length / 4) * 100);

  // 5) Frescor: verde/amarelo/vermelho from the freshness dot; neutro (drafts) sits mid-scale.
  const frescor = { verde: 100, amarelo: 60, vermelho: 20 }[input.frescor] ?? 50;

  const w = cfg.weights;
  const totalW = Math.max(1, w.casos + w.validacao + w.governanca + w.clareza + w.frescor);
  let total = Math.round(
    (casos * w.casos +
      validacao * w.validacao +
      governanca * w.governanca +
      clareza * w.clareza +
      frescor * w.frescor) /
      totalW
  );
  if (hasSecret) total = Math.min(total, 25); // hard floor: an embedded secret caps the Selo regardless of weights
  return {
    total,
    grade: gradeForScore(total, cfg),
    detalhe: { casos, validacao, governanca, clareza, frescor, aceitesForcados: forcados }
  };
}
