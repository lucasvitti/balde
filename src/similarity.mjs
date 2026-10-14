// Duplicate detection — tier 0: LEXICAL similarity, zero tokens, pure JS.
// Every node (skill / capsule) becomes a weighted term vector (pt-BR aware:
// accents stripped, stopwords dropped, title terms boosted); similarity is the
// cosine between vectors, with an exact-content short-circuit via hash.
// Tier 1 (embeddings, cached by content hash) and tier 2 (LLM judge on the
// shortlist only) plug in ABOVE this — this tier always runs first and free.
import { createHash } from 'node:crypto';

const STOPWORDS_PT = new Set([
  'a',
  'o',
  'as',
  'os',
  'um',
  'uma',
  'uns',
  'umas',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'por',
  'para',
  'com',
  'sem',
  'sob',
  'sobre',
  'entre',
  'ate',
  'apos',
  'que',
  'se',
  'e',
  'ou',
  'mas',
  'como',
  'quando',
  'onde',
  'qual',
  'quais',
  'quem',
  'cujo',
  'cuja',
  'este',
  'esta',
  'esse',
  'essa',
  'aquele',
  'aquela',
  'isto',
  'isso',
  'aquilo',
  'seu',
  'sua',
  'seus',
  'suas',
  'meu',
  'minha',
  'nos',
  'nao',
  'sim',
  'ja',
  'mais',
  'menos',
  'muito',
  'pouco',
  'todo',
  'toda',
  'todos',
  'todas',
  'cada',
  'ser',
  'estar',
  'ter',
  'haver',
  'foi',
  'sao',
  'era',
  'tem',
  'ha',
  'pelo',
  'pela',
  'pelos',
  'pelas',
  'ao',
  'aos',
  'the',
  'of',
  'and',
  'to',
  'in',
  'is'
]);

export function normalizeTerms(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS_PT.has(w));
}

export function contentHash(text) {
  return createHash('sha256').update(normalizeTerms(text).join(' ')).digest('hex').slice(0, 16);
}

// Weighted term vector: log-scaled term frequency; title terms count triple (a
// shared title is the strongest duplicate signal). Capped to the heaviest terms
// so the index stays small and comparisons stay O(terms).
export function termVector(title, body, cap = 80) {
  const tf = new Map();
  for (const w of normalizeTerms(body)) tf.set(w, (tf.get(w) || 0) + 1);
  for (const w of normalizeTerms(title)) tf.set(w, (tf.get(w) || 0) + 3);
  const entries = [...tf.entries()]
    .map(([w, n]) => [w, 1 + Math.log(n)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap);
  let norm = 0;
  for (const [, v] of entries) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  const vec = {};
  for (const [w, v] of entries) vec[w] = Number((v / norm).toFixed(5));
  return vec;
}

export function cosine(vecA, vecB) {
  let dot = 0;
  const [small, big] = Object.keys(vecA).length <= Object.keys(vecB).length ? [vecA, vecB] : [vecB, vecA];
  for (const [w, v] of Object.entries(small)) {
    const u = big[w];
    if (u) dot += v * u;
  }
  return Number(dot.toFixed(4));
}

export function sharedTerms(vecA, vecB, top = 6) {
  return Object.entries(vecA)
    .filter(([w]) => vecB[w])
    .sort((a, b) => b[1] * (vecB[b[0]] || 0) - a[1] * (vecB[a[0]] || 0))
    .slice(0, top)
    .map(([w]) => w);
}

// Rank index entries against ONE probe vector. exclude = ids to skip (self, same manifest).
export function topMatches(probeVec, probeHash, index, { threshold = 0.35, limit = 5, exclude = [] } = {}) {
  const skip = new Set(exclude);
  const out = [];
  for (const node of index) {
    if (skip.has(node.id)) continue;
    const exact = probeHash && node.hash === probeHash;
    const score = exact ? 1 : cosine(probeVec, node.vec);
    if (score >= threshold) {
      out.push({
        id: node.id,
        kind: node.kind,
        title: node.title,
        score,
        exact,
        terms: exact ? [] : sharedTerms(probeVec, node.vec)
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// All suspicious pairs within the index (admin corpus scan). O(n²) on tiny vectors —
// fine for thousands of nodes; MinHash banding is the upgrade path beyond that.
export function allPairs(index, { threshold = 0.5, limit = 200 } = {}) {
  const out = [];
  for (let i = 0; i < index.length; i++) {
    for (let j = i + 1; j < index.length; j++) {
      const a = index[i];
      const b = index[j];
      const exact = a.hash && a.hash === b.hash;
      const score = exact ? 1 : cosine(a.vec, b.vec);
      if (score >= threshold) {
        out.push({
          a: { id: a.id, kind: a.kind, title: a.title },
          b: { id: b.id, kind: b.kind, title: b.title },
          score,
          exact,
          terms: exact ? [] : sharedTerms(a.vec, b.vec)
        });
      }
    }
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit);
}
