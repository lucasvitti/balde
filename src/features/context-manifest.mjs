import { DEFAULT_CADENCE } from '../policy/governance-policy.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFrontmatter } from '../skill-format.mjs';
import { skillsRoot } from '../config.mjs';
import { callAiWithSystemPrompt } from '../ai-provider.mjs';

export function createContextManifestFeature({
  discoverSkillContextFiles,
  corpusNodeIndex,
  loadGovernanceIndex,
  loadSkillAccess,
  extractContextLinks,
  contextKind,
  heuristicSummary,
  conceptGovernance,
  corpusLinkIndex,
  cadenceStatus,
  loadUserAiConfig,
  loadSkillWorkingContext,
  commitCorpus
}) {
  function contextNodePaths(textFiles, skipped) {
    const set = new Set(['SKILL.md']);
    for (const file of textFiles) set.add(file.rel);
    for (const item of skipped) set.add(item.rel);
    return set;
  }

  // Paging manifest: every context file with size + kind + one-line summary + its OKF link
  // graph (outbound `links`, `backlinks`, unresolved `dangling`), WITHOUT inlining full
  // content. A tool-capable caller walks the graph — read SKILL.md, follow its links, page in
  // only the subgraph it needs via /context/{path}.
  async function skillContextManifest(skill) {
    const { textFiles, skipped } = await discoverSkillContextFiles(skill);
    const skillId = skill.id;
    const nodePaths = contextNodePaths(textFiles, skipped); // within-skill node ids (draft-aware)
    const corpusIndex = await corpusNodeIndex(); // cross-skill / commons targets
    // AI summaries (A2), if generated at ingest, live in context-index.json keyed by content
    // hash. A fresh entry (hash matches) wins; otherwise fall back to the heuristic per file.
    const index = await loadContextIndex(
      skill.artifactFacts && skill.artifactFacts.sourceFolder
        ? skill.artifactFacts.sourceFolder
        : join(skillsRoot(), skill.id)
    );
    // S2/S3 governance: per-skill index + inherited defaults (owner from SKILL.md frontmatter,
    // curators from ACCESS.yml, cadence from governance.json).
    const govIndex = await loadGovernanceIndex(skillId);
    let skillFm = {};
    try {
      skillFm = parseFrontmatter(String(skill.sourceText || '')).meta || {};
    } catch (error) {
      skillFm = {};
    }
    let skillCurators = [];
    try {
      skillCurators = (await loadSkillAccess(skillId)).curators || [];
    } catch (error) {
      skillCurators = [];
    }
    const skillDefaults = {
      owner: skillFm.owner || null,
      curators: skillCurators,
      cadence: govIndex.skill.cadence || DEFAULT_CADENCE
    };
    const unreadable = [];
    const files = [];
    const backlinks = new Map(); // target path -> Set(source paths)
    // Only WITHIN-skill edges contribute to this skill's backlinks; cross-skill/commons edges
    // point OUT to other neighborhoods (their backlinks are an X2 corpus-wide concern).
    const addEdges = (source, links) => {
      for (const link of links) {
        if (link.scope !== 'within') continue;
        if (!backlinks.has(link.path)) backlinks.set(link.path, new Set());
        backlinks.get(link.path).add(source);
      }
    };
    // SKILL.md is the OKF index.md — the root node. Its links are the entry edges into the
    // graph, so parse them too (from the in-memory sourceText, no extra read) and expose them
    // as `entry`. This is where a walker starts.
    const entryGraph = extractContextLinks(String(skill.sourceText || ''), skillId, 'SKILL.md', nodePaths, corpusIndex);
    addEdges('SKILL.md', entryGraph.links);
    for (const file of textFiles) {
      let content = '';
      try {
        content = await readFile(file.full, 'utf8');
      } catch (error) {
        unreadable.push({ rel: file.rel, bytes: file.bytes, reason: 'ilegível' });
        continue;
      }
      const { links, dangling } = extractContextLinks(content, skillId, file.rel, nodePaths, corpusIndex);
      addEdges(file.rel, links);
      const idxEntry = index && index.entries && index.entries[file.rel];
      const aiSummary =
        idxEntry && idxEntry.hash === createHash('sha1').update(content).digest('hex') ? idxEntry.summary : null;
      files.push({
        path: file.rel,
        bytes: file.bytes,
        kind: contextKind(file.rel),
        summary: aiSummary || heuristicSummary(file.rel, content.slice(0, 2048)),
        summarySource: aiSummary ? 'ai' : 'heuristic',
        links,
        dangling,
        governance: conceptGovernance(file.rel, govIndex, skillDefaults)
      });
    }
    // Attach backlinks once the full edge set is known (text nodes may be linked; binary nodes
    // have no outbound links but can still be link targets). X2: also attach CROSS-skill
    // backlinks (who from OTHER skills links into this node) from the corpus link index.
    const corpusLink = await corpusLinkIndex();
    const crossBacklinksFor = (rel) =>
      (corpusLink.backlinks.get(`${skillId}/${rel}`) || []).filter((b) => b.fromSkill !== skillId);
    for (const file of files) {
      file.backlinks = [...(backlinks.get(file.path) || [])].sort();
      file.crossBacklinks = crossBacklinksFor(file.path);
    }
    const skippedOut = [...skipped, ...unreadable].map((item) => ({
      path: item.rel,
      bytes: item.bytes,
      reason: item.reason,
      backlinks: [...(backlinks.get(item.rel) || [])].sort(),
      crossBacklinks: crossBacklinksFor(item.rel)
    }));
    // Skill-level cadence (governance.json review, else the skill's own frontmatter date) + a
    // roll-up: counts by status, the audit-due list (the gate), and the worst status overall.
    const skillReviewedAt =
      govIndex.skill.lastReviewedAt || skillFm.last_reviewed || skillFm.data_updated || skillFm.timestamp || null;
    const skillCad = cadenceStatus(skillReviewedAt, skillDefaults.cadence);
    const counts = { green: 0, 'due-soon': 0, overdue: 0, never: 0 };
    const auditDue = [];
    const evalFails = [];
    for (const f of files) {
      counts[f.governance.status] = (counts[f.governance.status] || 0) + 1;
      if (f.governance.status === 'overdue' || f.governance.status === 'never') auditDue.push(f.path);
      if (f.governance.eval && f.governance.eval.overall === 'fail') evalFails.push(f.path);
    }
    const severity = ['overdue', 'never', 'due-soon', 'green'];
    const overallStatus =
      severity.find((s) => s === skillCad.status || files.some((f) => f.governance.status === s)) || 'green';
    const governanceSummary = {
      skill: {
        owner: skillDefaults.owner,
        cadence: skillDefaults.cadence,
        lastReviewedAt: skillReviewedAt,
        status: skillCad.status,
        dueAt: skillCad.dueAt
      },
      counts,
      auditDue,
      evalFails,
      overallStatus
    };
    return {
      entry: {
        path: 'SKILL.md',
        links: entryGraph.links,
        dangling: entryGraph.dangling,
        crossBacklinks: crossBacklinksFor('SKILL.md')
      },
      files,
      skipped: skippedOut,
      governance: governanceSummary
    };
  }
  // Persisted in <skill>/context-index.json (git-versioned, excluded from context itself).
  // Keyed by content sha1 so the manifest uses an AI summary only while the file is unchanged,
  // else falls back to the heuristic. Generation uses the INGESTING USER's BYO key (prod has
  // no server key); no key → no index, heuristic stands.
  const CONTEXT_INDEX_FILE = 'context-index.json';
  const CONTEXT_SUMMARY_SYSTEM =
    'Você resume arquivos de contexto de uma skill de IA para um índice de navegação. Para CADA arquivo recebido, escreva um resumo de UMA linha (máx. 160 caracteres, em português) do que ele contém e para que serve (tabelas, regras de negócio, query, esquema de saída, casos de avaliação, etc.). Não invente conteúdo. Responda somente JSON no formato {"summaries": {"<path>": "<resumo>"}} usando exatamente os paths recebidos.';

  async function loadContextIndex(sourceFolder) {
    try {
      const parsed = JSON.parse(await readFile(join(sourceFolder, CONTEXT_INDEX_FILE), 'utf8'));
      return parsed && parsed.entries && typeof parsed.entries === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  // One-line AI summary per file via the user's provider. Batched (≤40/call) so a big skill
  // costs a few calls, not one-per-file. Returns { path: summary }.
  async function summarizeContextFilesWithAI(items, aiConfig) {
    const out = {};
    const CHUNK = 40;
    for (let i = 0; i < items.length; i += CHUNK) {
      const batch = items.slice(i, i + CHUNK);
      let result = null;
      try {
        result = await callAiWithSystemPrompt(CONTEXT_SUMMARY_SYSTEM, { files: batch }, aiConfig, true);
      } catch (error) {
        continue; // one bad batch shouldn't sink the rest; those files keep the heuristic
      }
      const map = (result && (result.summaries || result)) || {};
      for (const file of batch) {
        const value = map[file.path];
        if (typeof value === 'string' && value.trim()) {
          out[file.path] = value.trim().replace(/\s+/g, ' ').slice(0, 200);
        }
      }
    }
    return out;
  }

  // Regenerate <skill>/context-index.json from the current context files using `actor`'s BYO
  // key. Best-effort: no key → {ok:false, reason}; AI failure per batch → those files omitted
  // (heuristic stands). Never throws to its ingest callers (they wrap it anyway).
  async function regenerateContextIndex(skillId, actor) {
    const aiConfig = await loadUserAiConfig(actor);
    if (!aiConfig || !aiConfig.apiKey) {
      return { ok: false, reason: 'sem-chave-ia', generated: 0 };
    }
    const working = await loadSkillWorkingContext(skillId);
    const fakeSkill = {
      id: skillId,
      artifactFacts: {
        sourceFolder: working.sourceDir,
        draftFolder: working.hasDraft ? working.draftDir : null,
        files: working.files
      }
    };
    const { textFiles } = await discoverSkillContextFiles(fakeSkill);
    if (!textFiles.length) {
      return { ok: true, generated: 0, entries: 0 };
    }
    const items = [];
    const meta = {};
    for (const file of textFiles) {
      let content = '';
      try {
        content = await readFile(file.full, 'utf8');
      } catch (error) {
        continue;
      }
      meta[file.rel] = { hash: createHash('sha1').update(content).digest('hex'), bytes: file.bytes };
      items.push({ path: file.rel, kind: contextKind(file.rel), head: content.slice(0, 800) });
    }
    const summaries = await summarizeContextFilesWithAI(items, aiConfig);
    const entries = {};
    let generated = 0;
    for (const path of Object.keys(meta)) {
      if (summaries[path]) {
        entries[path] = { summary: summaries[path], hash: meta[path].hash, bytes: meta[path].bytes };
        generated += 1;
      }
    }
    const index = {
      version: 1,
      generatedAt: new Date().toISOString(),
      model: aiConfig.model || aiConfig.provider,
      entries
    };
    await writeFile(join(working.sourceDir, CONTEXT_INDEX_FILE), JSON.stringify(index, null, 2), 'utf8');
    await commitCorpus(
      `skill(${skillId}): resumos de contexto (IA) por ${actor.name || actor.email || 'owner'}`,
      actor,
      [skillId]
    );
    return { ok: true, generated, model: index.model, total: items.length };
  }

  return {
    contextNodePaths,
    skillContextManifest,
    CONTEXT_INDEX_FILE,
    loadContextIndex,
    summarizeContextFilesWithAI,
    regenerateContextIndex
  };
}
