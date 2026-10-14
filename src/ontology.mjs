// Ontologia de domínio — parser do markdown convencional + lint léxico (pure: no I/O, no
// app state). A cápsula reservada <domínio>/ontologia guarda o vocabulário controlado
// (## termo / definição / **Sinônimos:** a, b); aqui ela vira um índice e o lint checa
// textos de skills/cápsulas contra ele. Tudo ADVISORY — findings viram warnings/painéis
// para o curador decidir, nunca bloqueiam.

const SYN_RE = /^\*\*Sin[oô]nimos:?\*\*:?\s*(.*)$/i;

// Espelho do parser do client (app.js) — a convenção de markdown é o contrato.
export function parseOntologyMarkdown(md) {
  const text = String(md || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  let title = '';
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length && /^#\s+/.test(lines[i])) {
    title = lines[i].replace(/^#\s+/, '').trim();
    i++;
  }
  const preambleLines = [];
  while (i < lines.length && !/^##\s+/.test(lines[i])) {
    preambleLines.push(lines[i]);
    i++;
  }
  const concepts = [];
  let cur = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+/.test(line)) {
      if (cur) concepts.push(cur);
      cur = { termo: line.replace(/^##\s+/, '').trim(), definicao: '', sinonimos: [] };
      continue;
    }
    if (!cur) continue;
    const syn = line.match(SYN_RE);
    if (syn) {
      cur.sinonimos = syn[1]
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    cur.definicao += (cur.definicao ? '\n' : '') + line;
  }
  if (cur) concepts.push(cur);
  for (const c of concepts) c.definicao = c.definicao.trim();
  return { title, preamble: preambleLines.join('\n').trim(), concepts: concepts.filter((c) => c.termo) };
}

export function normalizeOntoTerm(t) {
  return String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Índice de busca: termos canônicos e sinônimos, ambos normalizados. Sinônimos muito curtos
// (< 3 chars) ou iguais ao próprio termo canônico ficam de fora (ruído).
export function buildOntologyIndex(concepts) {
  const canonical = new Map(); // norm(termo) -> { termo, definicao }
  const synonyms = new Map(); // norm(sinonimo) -> { termo, sinonimo }
  for (const c of concepts || []) {
    const nt = normalizeOntoTerm(c.termo);
    if (!nt) continue;
    canonical.set(nt, { termo: c.termo, definicao: c.definicao || '' });
    for (const s of c.sinonimos || []) {
      const ns = normalizeOntoTerm(s);
      if (!ns || ns.length < 3 || ns === nt) continue;
      if (!synonyms.has(ns)) synonyms.set(ns, { termo: c.termo, sinonimo: s });
    }
  }
  return { canonical, synonyms };
}

// Ocorrências whole-word de um termo normalizado num texto normalizado.
function countWholeWord(normText, normTerm) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(normTerm)}(?![\\p{L}\\p{N}])`, 'gu');
  const m = normText.match(re);
  return m ? m.length : 0;
}

// Lint de CONTEÚDO: sinônimos usados onde a ontologia define um termo canônico.
// Retorna no máximo `cap` findings (os mais frequentes), cada um
// { code: 'ontologia-sinonimo', usado, termo, count }.
export function lintTextAgainstOntology(text, index, cap = 5) {
  const normText = normalizeOntoTerm(text);
  if (!normText || !index || !index.synonyms || !index.synonyms.size) return [];
  const found = [];
  for (const [ns, info] of index.synonyms.entries()) {
    const count = countWholeWord(normText, ns);
    if (count > 0) found.push({ code: 'ontologia-sinonimo', usado: info.sinonimo, termo: info.termo, count });
  }
  found.sort((a, b) => b.count - a.count);
  return found.slice(0, cap);
}

// Lint de TÍTULO/identidade: o título (ou slug) coincide com um conceito já definido na
// ontologia → possível duplicação do conceito canônico. Match por igualdade normalizada
// (conservador — menos falso alarme) contra termos E sinônimos.
export function ontologyTitleMatch(title, index) {
  const nt = normalizeOntoTerm(title);
  if (!nt || !index) return null;
  if (index.canonical.has(nt))
    return { code: 'ontologia-conceito-existente', termo: index.canonical.get(nt).termo, via: 'canonico' };
  if (index.synonyms.has(nt)) {
    const s = index.synonyms.get(nt);
    return { code: 'ontologia-conceito-existente', termo: s.termo, via: 'sinonimo', usado: s.sinonimo };
  }
  return null;
}
