export function createGraphRoutes({
  webActor,
  sendJson,
  corpusLinkIndex,
  canReadSkillActor,
  corpusGraphSnapshot,
  canReadCommonsActor,
  rebuildCorpusGraphSnapshot
}) {
  return async function graphRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/corpus/graph') {
      const actor = webActor(req);
      if (!actor.email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      const link = await corpusLinkIndex();
      const nodes = [];
      for (const [skillId, concepts] of link.conceptCount.entries()) {
        if (!(await canReadSkillActor(skillId, actor))) continue;
        nodes.push({ id: skillId, kind: 'skill', concepts });
      }
      nodes.push({ id: 'commons', kind: 'commons', concepts: link.commonsCount });
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edges = [];
      for (const [key, count] of link.skillEdges.entries()) {
        const idx = key.indexOf('->');
        const from = key.slice(0, idx);
        const to = key.slice(idx + 2);
        if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
        edges.push({ from, to, count });
      }
      sendJson(res, 200, { ok: true, nodes, edges });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/corpus/graph-full') {
      const actor = webActor(req);
      if (!actor.email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      const snap = await corpusGraphSnapshot();
      if (!snap) {
        sendJson(res, 503, { ok: false, error: 'Grafo ainda não construído — tente novamente em instantes.' });
        return true;
      }
      const visible = new Set();
      for (const n of snap.nodes) {
        if (n.kind === 'skill') {
          if (await canReadSkillActor(n.id, actor)) visible.add(n.id);
          continue;
        }
        if (n.kind === 'capsule') {
          if (await canReadCommonsActor(String(n.id).replace(/^commons\//, ''), actor)) visible.add(n.id);
          continue;
        }
        visible.add(n.id);
      }
      const nodes = snap.nodes.filter((n) => visible.has(n.id));
      const edges = snap.edges.filter((e) => visible.has(e.from) && visible.has(e.to));
      sendJson(res, 200, {
        ok: true,
        generatedAt: snap.generatedAt,
        buildMs: snap.buildMs,
        stats: {
          skills: nodes.filter((n) => n.kind === 'skill').length,
          capsules: nodes.filter((n) => n.kind === 'capsule').length,
          edges: edges.length
        },
        nodes,
        edges
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/corpus/graph-rebuild') {
      const actor = webActor(req);
      if (!actor.email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      const snap = await rebuildCorpusGraphSnapshot();
      sendJson(res, 200, { ok: true, generatedAt: snap.generatedAt, buildMs: snap.buildMs, stats: snap.stats });
      return true;
    }
    return false;
  };
}
