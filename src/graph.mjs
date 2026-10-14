// Pure corpus-graph algorithms (Grafo view): connected components + Louvain
// community detection. No I/O, no app state — nodes/edges in, Maps out.
// Edges are [{ from, to, count }] and are treated as an UNDIRECTED weighted
// graph by both algorithms (direction matters for display, not for clustering).

function buildAdjacency(nodeIds, edges) {
  const adj = new Map(nodeIds.map((id) => [id, new Map()]));
  for (const e of edges || []) {
    if (!adj.has(e.from) || !adj.has(e.to) || e.from === e.to) continue;
    const w = Number(e.count) || 1;
    adj.get(e.from).set(e.to, (adj.get(e.from).get(e.to) || 0) + w);
    adj.get(e.to).set(e.from, (adj.get(e.to).get(e.from) || 0) + w);
  }
  return adj;
}

export function connectedComponents(nodeIds, edges) {
  const adj = buildAdjacency(nodeIds, edges);
  const comp = new Map();
  let c = 0;
  for (const id of nodeIds) {
    if (comp.has(id)) continue;
    const queue = [id];
    comp.set(id, c);
    while (queue.length) {
      const cur = queue.pop();
      for (const nb of adj.get(cur).keys()) {
        if (!comp.has(nb)) {
          comp.set(nb, c);
          queue.push(nb);
        }
      }
    }
    c++;
  }
  return comp;
}

// Louvain: greedy modularity optimization (local moves + aggregation, repeated).
// Deterministic — nodes are visited in the given order and ties keep the current
// community, so the same corpus always yields the same communities. Aggregated
// self-loops count toward degree (they scale the expected-edges term) but are
// excluded from the adjacency used for the argmax, which keeps the move gains
// correct without tracking internal weights separately.
export function louvainCommunities(nodeIds, edges) {
  const idSet = new Set(nodeIds);
  let members = nodeIds.map((id) => [id]); // current-graph node -> original ids
  let links = [];
  {
    const index = new Map(nodeIds.map((id, i) => [id, i]));
    const pair = new Map();
    for (const e of edges || []) {
      if (e.from === e.to || !idSet.has(e.from) || !idSet.has(e.to)) continue;
      const a = index.get(e.from);
      const b = index.get(e.to);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      pair.set(key, (pair.get(key) || 0) + (Number(e.count) || 1));
    }
    links = [...pair.entries()].map(([k, w]) => {
      const [a, b] = k.split('|').map(Number);
      return { a, b, w };
    });
  }

  for (let pass = 0; pass < 10; pass++) {
    const n = members.length;
    const adj = Array.from({ length: n }, () => new Map());
    const deg = new Array(n).fill(0);
    let m2 = 0; // 2m — total degree
    for (const { a, b, w } of links) {
      if (a === b) {
        deg[a] += 2 * w;
        m2 += 2 * w;
        continue;
      }
      adj[a].set(b, (adj[a].get(b) || 0) + w);
      adj[b].set(a, (adj[b].get(a) || 0) + w);
      deg[a] += w;
      deg[b] += w;
      m2 += 2 * w;
    }
    if (!m2) break; // no edges — every node is its own community

    const comm = Array.from({ length: n }, (_, i) => i);
    const commTot = [...deg]; // sum of degrees per community
    let improvedAny = false;
    let moved = true;
    let guard = 0;
    while (moved && guard++ < 50) {
      moved = false;
      for (let i = 0; i < n; i++) {
        const ci = comm[i];
        const toComm = new Map();
        for (const [j, w] of adj[i]) toComm.set(comm[j], (toComm.get(comm[j]) || 0) + w);
        commTot[ci] -= deg[i]; // take i out of its community
        let best = ci;
        let bestGain = (toComm.get(ci) || 0) - (commTot[ci] * deg[i]) / m2;
        for (const [c, w] of toComm) {
          if (c === ci) continue;
          const gain = w - (commTot[c] * deg[i]) / m2;
          if (gain > bestGain + 1e-9) {
            bestGain = gain;
            best = c;
          }
        }
        commTot[best] += deg[i];
        if (best !== ci) {
          comm[i] = best;
          moved = true;
          improvedAny = true;
        }
      }
    }
    if (!improvedAny) break;

    // Aggregate: each community becomes one node of the next-pass graph.
    const remap = new Map();
    for (let i = 0; i < n; i++) if (!remap.has(comm[i])) remap.set(comm[i], remap.size);
    const newMembers = Array.from({ length: remap.size }, () => []);
    for (let i = 0; i < n; i++) newMembers[remap.get(comm[i])].push(...members[i]);
    const pair = new Map();
    const selfW = new Map();
    for (const { a, b, w } of links) {
      const na = remap.get(comm[a]);
      const nb = remap.get(comm[b]);
      if (na === nb) {
        selfW.set(na, (selfW.get(na) || 0) + w);
        continue;
      }
      const key = na < nb ? `${na}|${nb}` : `${nb}|${na}`;
      pair.set(key, (pair.get(key) || 0) + w);
    }
    links = [...pair.entries()].map(([k, w]) => {
      const [a, b] = k.split('|').map(Number);
      return { a, b, w };
    });
    for (const [c, w] of selfW.entries()) links.push({ a: c, b: c, w });
    members = newMembers;
  }

  // Map original id -> community, renumbered by first appearance in nodeIds
  // order so output indices are stable across runs.
  const byId = new Map();
  members.forEach((mem, ci) => {
    for (const id of mem) byId.set(id, ci);
  });
  const renum = new Map();
  const out = new Map();
  for (const id of nodeIds) {
    const c = byId.has(id) ? byId.get(id) : -1;
    if (!renum.has(c)) renum.set(c, renum.size);
    out.set(id, renum.get(c));
  }
  return out;
}
