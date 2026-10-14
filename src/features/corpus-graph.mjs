import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_SKILL_ID_DEPTH } from '../skill-format.mjs';
import { skillsRoot, cacheRoot, activeRepo, runWithRepo, DEFAULT_REPO } from '../config.mjs';
import { connectedComponents, louvainCommunities } from '../graph.mjs';
import { listRepos } from '../repos.mjs';

export function createCorpusGraphFeature({
  listSkillIds,
  isGovernancePath,
  listCommonsConcepts,
  govSkillShape,
  discoverSkillContextFiles,
  loadSkillsFromDisk,
  buildCommonsList,
  isOntologyCapsuleId,
  resolveContextLink
}) {
  const corpusIndexCacheByRepo = new Map(); // repo -> { set, at } (R2: caches never cross repos)
  const CORPUS_INDEX_TTL_MS = 15000;

  async function listCorpusFilesRec(dir, prefix) {
    const out = [];
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      return out;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'desktop.ini') continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out.push(...(await listCorpusFilesRec(join(dir, entry.name), rel)));
      } else {
        out.push(rel.replace(/\\/g, '/'));
      }
    }
    return out;
  }

  async function corpusNodeIndex() {
    const cached = corpusIndexCacheByRepo.get(activeRepo());
    if (cached && Date.now() - cached.at < CORPUS_INDEX_TTL_MS) {
      return cached.set;
    }
    const set = new Set();
    for (const id of await listSkillIds()) {
      for (const rel of await listCorpusFilesRec(join(skillsRoot(), id), '')) {
        if (rel.toLowerCase() !== 'skill.md' && isGovernancePath(rel)) continue; // skip machinery, keep SKILL.md as the skill's root node
        set.add(`${id}/${rel}`);
      }
    }
    // Commons: a concept is a FOLDER (node-as-directory); the link target is the folder id.
    for (const id of await listCommonsConcepts()) {
      set.add(`commons/${id}`);
    }
    corpusIndexCacheByRepo.set(activeRepo(), { set, at: Date.now() });
    return set;
  }
  // Scans every skill's SKILL.md + context files (and resolves their links corpus-wide), then
  // inverts to backlinks (who links INTO each node) + aggregates skill→skill/commons edges for
  // the corpus graph. O(corpus) reads → cached (TTL). Within-skill links are ignored here (the
  // per-skill manifest already computes those); this index is only about connections BETWEEN
  // neighborhoods.
  const corpusLinkCacheByRepo = new Map(); // repo -> { value, at }
  const CORPUS_LINK_TTL_MS = 15000;

  async function corpusLinkIndex() {
    const cached = corpusLinkCacheByRepo.get(activeRepo());
    if (cached && Date.now() - cached.at < CORPUS_LINK_TTL_MS) {
      return cached.value;
    }
    const nodeIndex = await corpusNodeIndex();
    const backlinks = new Map(); // targetCorpusPath -> [{ from, fromSkill, scope }]
    const skillEdges = new Map(); // `${fromSkill}->${toNeighborhood}` -> count
    const conceptCount = new Map(); // skillId -> # context files
    const addBacklink = (target, from, fromSkill, scope) => {
      if (!backlinks.has(target)) backlinks.set(target, []);
      backlinks.get(target).push({ from, fromSkill, scope });
    };
    for (const skillId of await listSkillIds()) {
      let shape;
      try {
        shape = await govSkillShape(skillId);
      } catch (error) {
        continue;
      }
      const { textFiles, skipped } = await discoverSkillContextFiles(shape);
      const withinSet = new Set(['SKILL.md']);
      for (const f of textFiles) withinSet.add(f.rel);
      for (const s of skipped) withinSet.add(s.rel);
      conceptCount.set(skillId, textFiles.length + skipped.length);
      const sources = [{ rel: 'SKILL.md', content: String(shape.sourceText || '') }];
      for (const f of textFiles) {
        let content = '';
        try {
          content = await readFile(f.full, 'utf8');
        } catch (error) {
          continue;
        }
        sources.push({ rel: f.rel, content });
      }
      for (const src of sources) {
        const { links } = extractContextLinks(src.content, skillId, src.rel, withinSet, nodeIndex);
        const fromCorpus = `${skillId}/${src.rel}`;
        for (const l of links) {
          if (l.scope === 'within' || l.scope === 'xrepo') continue; // between-neighborhood edges only (xrepo: other repo's index)
          addBacklink(l.path, fromCorpus, skillId, l.scope);
          const toNeighborhood = l.scope === 'commons' ? 'commons' : l.targetSkill;
          const key = `${skillId}->${toNeighborhood}`;
          skillEdges.set(key, (skillEdges.get(key) || 0) + 1);
        }
      }
    }
    let commonsCount = 0;
    try {
      commonsCount = (await listCommonsConcepts()).length;
    } catch (error) {
      commonsCount = 0;
    }
    const value = { backlinks, skillEdges, conceptCount, commonsCount };
    corpusLinkCacheByRepo.set(activeRepo(), { value, at: Date.now() });
    return value;
  }
  // The BUILDER runs server-side (a recurrent job — Vitti's design: the front-end only consumes
  // processed data); LAYOUT stays client-side so filters/arrangements re-run instantly. Every
  // skill and every capsule is a node (no aggregation); edges are per node-pair with counts.
  // Rebuilds ≤30s after any in-app write (commitCorpus/commitRepo mark dirty) and at least every
  // 5 min (catches out-of-band edits: git pushes, direct disk writes). The snapshot persists on
  // the usage volume so restarts serve instantly; the endpoint ACL-filters per viewer at serve time.
  // R2: everything here is PER-REPO — snapshot file, memory copy, dirty flag, build lock.
  // The legacy single-corpus file name is kept for the default repo so R1 deploys roll forward.
  const graphSnapshotPath = (repo) =>
    join(cacheRoot, repo === DEFAULT_REPO ? 'graph-snapshot.json' : `graph-snapshot-${repo}.json`);
  const graphSnapshotByRepo = new Map(); // repo -> snapshot
  const graphSnapshotDirtyByRepo = new Map(); // repo -> bool (missing = dirty)
  const graphSnapshotBuildingByRepo = new Map();

  function graphSnapshotDirtyFor(repo) {
    return graphSnapshotDirtyByRepo.get(repo) !== false;
  }
  function markCorpusGraphDirty() {
    graphSnapshotDirtyByRepo.set(activeRepo(), true);
  }

  async function rebuildCorpusGraphSnapshot() {
    const repo = activeRepo();
    if (graphSnapshotBuildingByRepo.get(repo)) return graphSnapshotByRepo.get(repo) || null;
    graphSnapshotBuildingByRepo.set(repo, true);
    const t0 = Date.now();
    try {
      const skills = await loadSkillsFromDisk();
      const commonsList = await buildCommonsList();
      const link = await corpusLinkIndex();
      const cindex = await corpusNodeIndex();

      const nodes = [];
      for (const s of skills) {
        const um = s.metricas || [];
        const sum = (k) => um.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);
        nodes.push({
          id: s.id,
          kind: 'skill',
          label: s.nome || s.id,
          domain: s.domain || '',
          status: s.status,
          selo: s.seloQualidade || 0,
          frescor: s.frescor || 'neutro',
          owner: (s.owner && s.owner.email) || '',
          deprecated: s.deprecated ? 1 : 0, // derived: own review overdue OR expired capsule in use
          execucoes: sum('execucoes'),
          aberturas: sum('aberturas'),
          usuarios: Math.max(0, ...um.map((r) => Number(r.usuariosDistintos) || 0))
        });
      }
      for (const c of commonsList.concepts) {
        const serie = (c.governance && c.governance.serie) || '';
        nodes.push({
          id: `commons/${c.path}`,
          kind: 'capsule',
          label: c.title || c.path,
          domain: c.path.includes('/') ? c.path.split('/')[0] : '',
          status: (c.governance && c.governance.status) || 'never',
          // Depreciação agora é DERIVADA pelos critérios de Config › Pontuação (não mero overdue).
          deprecated: c.governance && c.governance.deprecated ? 1 : 0,
          summary: c.summary || '',
          execucoes: 0,
          aberturas: 0,
          usuarios: 0,
          // Linha do tempo: series episodes get flagged so the Mapa can badge them (clock icon).
          serie,
          periodo: (c.governance && c.governance.periodo) || '',
          temporal: serie ? 1 : 0,
          categoria: (c.governance && c.governance.categoria) || 'dado',
          // Ontologia do domínio (reserved <domain>/ontologia capsule) → dedicated Mapa glyph.
          ontologia: isOntologyCapsuleId(c.path) ? 1 : 0
        });
      }
      const nodeSet = new Set(nodes.map((n) => n.id));

      // Node-level edges from the per-target backlinks (un-aggregated, unlike skillEdges):
      // the target's owning node is the capsule id for commons/…, else the owning skill.
      const pair = new Map();
      for (const [target, entries] of link.backlinks.entries()) {
        const toNode = target.startsWith('commons/') ? target : skillIdOfCorpusPath(target, cindex);
        if (!nodeSet.has(toNode)) continue;
        for (const b of entries) {
          if (!b.fromSkill || b.fromSkill === toNode || !nodeSet.has(b.fromSkill)) continue;
          const key = `${b.fromSkill}\u0000${toNode}`;
          const e = pair.get(key) || { from: b.fromSkill, to: toNode, scope: b.scope, count: 0 };
          e.count += 1;
          pair.set(key, e);
        }
      }
      const edges = [...pair.values()].sort((a, b) => `${a.from}→${a.to}`.localeCompare(`${b.from}→${b.to}`));

      const inDeg = new Map();
      const outDeg = new Map();
      for (const e of edges) {
        outDeg.set(e.from, (outDeg.get(e.from) || 0) + 1);
        inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
      }
      const ids = nodes.map((n) => n.id);
      const comp = connectedComponents(ids, edges);
      const comm = louvainCommunities(ids, edges);
      for (const n of nodes) {
        n.inDegree = inDeg.get(n.id) || 0;
        n.outDegree = outDeg.get(n.id) || 0;
        n.component = comp.has(n.id) ? comp.get(n.id) : -1;
        n.community = comm.has(n.id) ? comm.get(n.id) : -1;
      }

      const snapshot = {
        ok: true,
        generatedAt: new Date().toISOString(),
        buildMs: Date.now() - t0,
        stats: { skills: skills.length, capsules: commonsList.concepts.length, edges: edges.length },
        nodes,
        edges
      };
      graphSnapshotByRepo.set(repo, snapshot);
      graphSnapshotDirtyByRepo.set(repo, false);
      try {
        await mkdir(cacheRoot, { recursive: true });
        await writeFile(graphSnapshotPath(repo), JSON.stringify(snapshot), 'utf8');
      } catch (error) {
        /* volume ro/missing — memory copy still serves */
      }
      return snapshot;
    } finally {
      graphSnapshotBuildingByRepo.set(repo, false);
    }
  }

  // Serve-side accessor: memory copy → persisted snapshot (cold start) → live build.
  // Stale-while-revalidate: a dirty snapshot is served as-is while a rebuild runs behind it.
  async function corpusGraphSnapshot() {
    const repo = activeRepo();
    if (!graphSnapshotByRepo.has(repo)) {
      try {
        graphSnapshotByRepo.set(repo, JSON.parse(await readFile(graphSnapshotPath(repo), 'utf8')));
      } catch (error) {
        /* first boot */
      }
    }
    const cached = graphSnapshotByRepo.get(repo) || null;
    if (graphSnapshotDirtyFor(repo) || !cached) {
      if (cached) {
        rebuildCorpusGraphSnapshot().catch(() => {});
        return cached;
      }
      return rebuildCorpusGraphSnapshot();
    }
    return cached;
  }

  // Recurrent job: sweep dirty repos every 30s; force a full refresh every 5 min. Each rebuild
  // runs INSIDE its repo context so the shared corpus-scan code resolves that repo's roots.
  async function sweepGraphSnapshots(force = false) {
    let repos = [DEFAULT_REPO];
    try {
      repos = (await listRepos()).map((r) => r.name);
    } catch (error) {
      /* registry unreadable — default only */
    }
    for (const repo of repos) {
      if (force) graphSnapshotDirtyByRepo.set(repo, true);
      if (graphSnapshotDirtyFor(repo)) {
        await runWithRepo(repo, () => rebuildCorpusGraphSnapshot()).catch(() => {});
      }
    }
  }
  setInterval(() => {
    sweepGraphSnapshots(false).catch(() => {});
  }, 30_000).unref();
  setInterval(() => {
    sweepGraphSnapshots(true).catch(() => {});
  }, 5 * 60_000).unref();
  setTimeout(() => {
    sweepGraphSnapshots(false).catch(() => {});
  }, 5_000).unref();

  // Classify one markdown link: within-skill (dual-base: skill-root first) → keep the skill-rel
  // id; a `/`-rooted target that isn't within-skill but IS a corpus node → cross-skill or commons
  // (corpus-rel id); else dangling (OKF-tolerated). Relative links stay within-skill by design
  // (cross-skill/commons use `/commons/…` or `/<otherSkill>/…`, depth-independent).
  // The owning skill id of a resolved corpus node path. Skill ids are <domain>/<slug>/… (1..MAX
  // segments), so the owner is NOT just the first path segment — resolve it as the longest path
  // prefix whose SKILL.md is a known corpus node (every skill has one). Falls back to the first
  // segment only if nothing matches (dangling). Fixes cross-skill links pointing at the DOMAIN.
  function skillIdOfCorpusPath(resolved, corpusIndex) {
    const parts = String(resolved || '').split('/');
    for (let n = Math.min(parts.length - 1, MAX_SKILL_ID_DEPTH); n >= 1; n--) {
      const prefix = parts.slice(0, n).join('/');
      if (corpusIndex && corpusIndex.has(`${prefix}/SKILL.md`)) return prefix;
    }
    return parts[0];
  }
  function classifyCorpusLink(target, sourceSkillId, sourceRel, withinSet, corpusIndex) {
    let t = String(target || '').trim();
    if (!t) return null;
    t = t.split(/\s+/)[0].replace(/#.*$/, '').trim();
    if (!t || t.startsWith('#')) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('//')) return null;
    // R2: cross-repo reference — `/@<repo>/<corpus path>`. Classification is SYNTACTIC (the
    // target repo's index isn't loaded here); existence + ACL are checked at consumption,
    // where non-readers get honest stubs. The graph/backlink indexes skip this scope (per-repo).
    const xr = /^\/@([a-z0-9][a-z0-9-]{1,30})\/(.+)$/.exec(t);
    if (xr) {
      const rest = resolveContextLink(`/${xr[2]}`, sourceRel);
      if (!rest) return null;
      return { scope: 'xrepo', repo: xr[1], path: rest, targetSkill: null };
    }
    const isAbs = t.startsWith('/');
    const resolved = resolveContextLink(t, sourceRel);
    if (!resolved) return null;
    if (withinSet.has(resolved) && resolved !== sourceRel) {
      return { scope: 'within', path: resolved, targetSkill: sourceSkillId };
    }
    if (isAbs && corpusIndex && corpusIndex.has(resolved)) {
      const scope = resolved.startsWith('commons/') ? 'commons' : 'cross';
      return {
        scope,
        path: resolved,
        targetSkill: scope === 'commons' ? 'commons' : skillIdOfCorpusPath(resolved, corpusIndex)
      };
    }
    // A skill FOLDER link (`/pricing/reajuste`) is the natural hand-authored form of a skill→skill
    // reference; normalize it to the skill's root node (SKILL.md), the same target the [[[ linkref
    // utility inserts, so it lands in backlinks and the corpus graph instead of dangling.
    if (isAbs && corpusIndex && corpusIndex.has(`${resolved}/SKILL.md`)) {
      const path = `${resolved}/SKILL.md`;
      return { scope: 'cross', path, targetSkill: skillIdOfCorpusPath(path, corpusIndex) };
    }
    return { dangling: resolved };
  }

  // Capsules (ex-commons) are ATOMIC — their context.md must not reference other corpus nodes.
  // Within-capsule media stays relative (img/…, data/…), so any ABSOLUTE markdown link `](/…)` is
  // an outbound corpus reference (to a capsule or a skill) and is rejected on save. Returns the
  // offending target, or null when clean.
  function capsuleOutboundLink(content) {
    const m = /(?<!!)\[[^\]]*\]\(\s*(\/[^)\s]+)/.exec(String(content || ''));
    return m ? m[1] : null;
  }

  // Extract OKF-style intra-bundle links from a file's content: markdown links [txt](target)
  // (images ![]() excluded). Targets resolving to a known node → `links`; resolving elsewhere
  // → `dangling` (OKF: broken links are tolerated, not errors). Self-links dropped.
  function extractContextLinks(content, sourceSkillId, sourceRel, withinSet, corpusIndex) {
    const re = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;
    const links = [];
    const seen = new Set();
    const dangling = new Set();
    let m;
    while ((m = re.exec(String(content))) !== null) {
      const c = classifyCorpusLink(m[1], sourceSkillId, sourceRel, withinSet, corpusIndex);
      if (!c) continue;
      if (c.dangling) {
        dangling.add(c.dangling);
        continue;
      }
      const key = `${c.scope}:${c.repo || ''}:${c.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ path: c.path, scope: c.scope, targetSkill: c.targetSkill, ...(c.repo ? { repo: c.repo } : {}) });
    }
    links.sort((a, b) => a.path.localeCompare(b.path));
    return { links, dangling: [...dangling].sort() };
  }

  return {
    corpusIndexCacheByRepo,
    corpusNodeIndex,
    corpusLinkCacheByRepo,
    corpusLinkIndex,
    markCorpusGraphDirty,
    rebuildCorpusGraphSnapshot,
    corpusGraphSnapshot,
    skillIdOfCorpusPath,
    capsuleOutboundLink,
    extractContextLinks
  };
}
