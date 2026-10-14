import {
  DEFAULT_CADENCE,
  CADENCE_DAYS,
  MAX_LINKED_CAPSULES,
  COMMONS_CONCEPT_FILE
} from '../policy/governance-policy.mjs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import { isSafeSkillId, assertSafeUploadName, assertSafeRelPath } from '../skill-format.mjs';
import { parseOntologyMarkdown as parseOntologyMd, buildOntologyIndex } from '../ontology.mjs';
import { skillsRoot, commonsRoot, activeRepo, runWithRepo, mimeTypes } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { repoByName, isRepoMember } from '../repos.mjs';
import { callAiWithSystemPrompt, callAiVisionDescribe } from '../ai-provider.mjs';

export function createCommonsFeature({
  loadSkillConsumerContext,
  govSkillShape,
  discoverSkillContextFiles,
  loadContextIndex,
  contextKind,
  commitCorpus,
  stampCreator,
  pushApproval,
  corpusIndexCacheByRepo,
  corpusLinkCacheByRepo,
  computeConceptExpiresAt,
  commitRepo,
  formatBytesServer,
  loadScoringConfig,
  conceptGovernanceFrom,
  canReadCommonsActor,
  corpusLinkIndex,
  creatorFromGit,
  heuristicSummary,
  loadCommonsAccess,
  normEmail
}) {
  const COMMONS_MIGRATE_SYSTEM =
    'Você decide quais arquivos de contexto de uma skill são CONCEITOS COMPARTILHÁVEIS (reutilizáveis por várias skills — dicionários de dados, esquemas de tabelas base, glossários, definições de negócio) e devem ir para um "commons" corpus-wide; versus ESPECÍFICOS da skill (ficam nela). Para cada compartilhável proponha um caminho em commons (ex.: "commons/financeiro/definicoes.md"). Seja conservador: só mova o que é claramente reutilizável. Responda somente JSON: {"moves":[{"path":"<original>","to":"commons/<novo>","rationale":"..."}],"keep":["<path>"]}.';

  function normalizeCommonsTo(to) {
    let t = String(to || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .trim();
    t = t.replace(/^commons\//, '');
    t = t.replace(/\/context\.md$/i, '').replace(/\.md$/i, ''); // → concept folder id (node-as-directory)
    return t ? `commons/${t}` : '';
  }

  // Phase 1 — PLAN: AI classifies the skill's context files → proposed commons moves (no writes).
  async function planCommonsMigration(skillId, aiConfig) {
    const shape = await govSkillShape(skillId);
    const { textFiles } = await discoverSkillContextFiles(shape);
    const index = await loadContextIndex(shape.artifactFacts.sourceFolder);
    const items = textFiles.map((f) => ({
      path: f.rel,
      kind: contextKind(f.rel),
      summary: (index && index.entries && index.entries[f.rel] && index.entries[f.rel].summary) || ''
    }));
    if (!items.length) return { moves: [], keep: [] };
    const r = await callAiWithSystemPrompt(COMMONS_MIGRATE_SYSTEM, { skill: skillId, files: items }, aiConfig, true);
    const known = new Set(items.map((i) => i.path));
    const moves = (Array.isArray(r && r.moves) ? r.moves : [])
      .map((m) => ({
        path: String((m && m.path) || '').replace(/\\/g, '/'),
        to: normalizeCommonsTo(m && m.to),
        rationale: String((m && m.rationale) || '')
          .replace(/\s+/g, ' ')
          .slice(0, 220)
      }))
      .filter((m) => m.path && m.to && known.has(m.path));
    const keep = items.map((i) => i.path).filter((p) => !moves.some((m) => m.path === p));
    return { moves, keep };
  }

  // Phase 2 — APPLY: move approved files skill→commons, link them back from SKILL.md, commit both.
  async function applyCommonsMigration(skillId, moves, actor) {
    const shape = await govSkillShape(skillId);
    const { textFiles } = await discoverSkillContextFiles(shape);
    const byRel = new Map(textFiles.map((f) => [f.rel, f]));
    const skillDir = join(skillsRoot(), skillId);
    const moved = [];
    const skipped = [];
    for (const m of Array.isArray(moves) ? moves : []) {
      const from = String((m && (m.from || m.path)) || '').replace(/\\/g, '/');
      const to = normalizeCommonsTo(m && m.to); // commons/<domain>/<concept> (folder id)
      const src = byRel.get(from);
      if (!src || !to) {
        skipped.push({ from, reason: 'origem inválida' });
        continue;
      }
      const conceptId = to.slice('commons/'.length);
      let safeRel;
      try {
        safeRel = assertSafeRelPath(conceptId);
      } catch (error) {
        skipped.push({ from, reason: 'destino inválido' });
        continue;
      }
      if (await pathExists(commonsConceptContextPath(safeRel))) {
        skipped.push({ from, reason: 'destino já existe' });
        continue;
      }
      try {
        await mkdir(join(commonsRoot(), safeRel), { recursive: true });
        await cp(src.full, commonsConceptContextPath(safeRel)); // content → <concept>/context.md
        await rm(join(skillDir, from), { force: true });
        moved.push({ from, to, id: safeRel });
      } catch (error) {
        skipped.push({ from, reason: error.message });
      }
    }
    // Link the moved concepts back from SKILL.md (keeps the skill→commons edge + progressive
    // disclosure). Link target = the concept FOLDER (/commons/<id>), which resolves to context.md.
    if (moved.length) {
      const skillMdPath = join(skillDir, 'SKILL.md');
      let md = '';
      try {
        md = await readFile(skillMdPath, 'utf8');
      } catch (error) {
        md = '';
      }
      const marker = '## Conceitos compartilhados (commons)';
      const bullets = moved.map((mv) => `- [${mv.id.split('/').pop()}](/${mv.to})`).join('\n');
      md = md.includes(marker)
        ? `${md.replace(/\s*$/, '')}\n${bullets}\n`
        : `${md.replace(/\s*$/, '')}\n\n${marker}\n\n${bullets}\n`;
      await writeFile(skillMdPath, md, 'utf8');
      await commitCorpus(
        `skill(${skillId}): ${moved.length} conceito(s) movido(s) para commons por ${(actor && (actor.name || actor.email)) || 'curador'}`,
        actor,
        [skillId]
      );
      // Per-concept governance: stamp creator-on-touch + an audit entry in each concept's own governance.json.
      for (const mv of moved) {
        const e = await loadCommonsConceptGov(mv.id);
        stampCreator(e, actor);
        pushApproval(e, 'migrated', `de ${skillId}`, actor);
        await saveCommonsConceptGov(
          mv.id,
          e,
          actor,
          `commons: ${mv.id} importado de ${skillId} por ${(actor && (actor.name || actor.email)) || 'curador'}`
        );
      }
      corpusIndexCacheByRepo.delete(activeRepo()); // new commons folders + links must resolve immediately
      corpusLinkCacheByRepo.delete(activeRepo());
    }
    return { moved, skipped };
  }

  // governance model (cadence/audit + evals) + AI summaries, keyed by commons/governance.json +
  // commons/context-index.json. Manage = admin OR global-curator (commons is corpus-wide).
  function commonsGovIndexPath() {
    return join(commonsRoot(), 'governance.json');
  }

  // is the folder path relative to commons root; the link target /commons/<id> resolves to
  // <id>/context.md. Governance is per-concept (<id>/governance.json). Reserved sidecar dirs
  // (img/data/legado/logs) live inside a concept folder and are never separate concepts.

  const COMMONS_SIDECAR_DIRS = new Set(['img', 'data', 'files', 'legado', 'logs']);
  function commonsConceptContextPath(id) {
    return join(commonsRoot(), id, COMMONS_CONCEPT_FILE);
  }
  function commonsConceptGovPath(id) {
    return join(commonsRoot(), id, 'governance.json');
  }

  async function listCommonsConcepts(dir = commonsRoot(), prefix = '') {
    const out = [];
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      return out;
    }
    if (prefix && entries.some((e) => e.isFile() && e.name === COMMONS_CONCEPT_FILE)) {
      out.push(prefix); // this dir IS a concept — do not descend into its sidecars
      return out;
    }
    for (const e of entries) {
      // "." e "_" marcam o que não é conteúdo ativo, como as cápsulas arquivadas (.archived), igual às skills.
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_') || COMMONS_SIDECAR_DIRS.has(e.name))
        continue;
      out.push(...(await listCommonsConcepts(join(dir, e.name), prefix ? `${prefix}/${e.name}` : e.name)));
    }
    return out;
  }
  async function loadCommonsConceptGov(id) {
    try {
      const p = JSON.parse(await readFile(commonsConceptGovPath(id), 'utf8'));
      return p && typeof p === 'object' ? p : {};
    } catch (error) {
      return {};
    }
  }
  async function saveCommonsConceptGov(id, entry, actor, message) {
    await mkdir(join(commonsRoot(), id), { recursive: true });
    // Single choke point for concept-governance writes: keep the EXPLICIT expiry stamped in the
    // artifact (governance.json) in sync with lastReviewedAt + cadence, whatever the write path
    // (keep-green review, cadence change, create seed, wizard edit).
    if (entry) entry.expiresAt = computeConceptExpiresAt(entry);
    await writeFile(commonsConceptGovPath(id), JSON.stringify(entry || {}, null, 2), 'utf8');
    await commitRepo(
      commonsRoot(),
      message || `commons: ${id} governança por ${(actor && (actor.name || actor.email)) || 'curador'}`,
      actor,
      [id]
    );
  }
  // Neighborhood-level defaults (top-level commons/governance.json): default cadence for new concepts.
  async function loadCommonsDefaults() {
    try {
      const p = JSON.parse(await readFile(commonsGovIndexPath(), 'utf8'));
      const d = p.defaults || p.skill || {};
      return { cadence: CADENCE_DAYS[d.cadence] ? d.cadence : DEFAULT_CADENCE };
    } catch (error) {
      return { cadence: DEFAULT_CADENCE };
    }
  }
  async function saveCommonsDefaults(defaults, actor, message) {
    await writeFile(
      commonsGovIndexPath(),
      JSON.stringify(
        {
          version: 2,
          defaults: { cadence: defaults && CADENCE_DAYS[defaults.cadence] ? defaults.cadence : DEFAULT_CADENCE }
        },
        null,
        2
      ),
      'utf8'
    );
    await commitRepo(
      commonsRoot(),
      message || `commons: padrões por ${(actor && (actor.name || actor.email)) || 'curador'}`,
      actor,
      ['governance.json']
    );
  }
  async function commonsHasConcept(id) {
    const norm = String(id || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!norm || norm.includes('..')) return false;
    // Uma cápsula arquivada (commons/.archived/...) não é cápsula do corpus: só a restauração a traz de volta.
    if (norm.split('/').some((segment) => segment.startsWith('_') || segment.startsWith('.'))) return false;
    return pathExists(commonsConceptContextPath(norm));
  }

  // small tables; AI turns them into text descriptions that BECOME context. Descriptions live in
  // <sidecar>/descriptions.json (git-versioned, hash-gated), and the sidecar dirs stay excluded
  // from raw context (isGovernancePath / the folder walk).
  const MEDIA_IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
  const MEDIA_DATA_EXTS = new Set(['.csv', '.tsv', '.md', '.txt', '.json', '.yaml', '.yml']);
  const MEDIA_DESC_FILE = 'descriptions.json';
  const MEDIA_IMG_MAX_BYTES = 5 * 1024 * 1024;
  const MEDIA_DATA_MAX_BYTES = 256 * 1024;
  const MEDIA_IMG_SYSTEM =
    'Você descreve uma imagem para servir como CONTEXTO de conhecimento (não como legenda decorativa). Em 1–3 frases (pt-BR), diga o que a imagem mostra e os dados/insights úteis (tipo de gráfico, eixos, tendências, números visíveis, estrutura de tabela/diagrama). Não invente valores que não estejam visíveis.';
  const MEDIA_DATA_SYSTEM =
    'Você resume um arquivo tabular/pequeno para servir como CONTEXTO. Em 1–3 frases (pt-BR), diga o que ele contém: colunas/campos, período, granularidade e números-chave. Não invente dados.';

  function mediaMimeFor(name) {
    return mimeTypes[extname(name).toLowerCase()] || 'application/octet-stream';
  }
  async function loadMediaDescriptions(dirAbs) {
    try {
      const p = JSON.parse(await readFile(join(dirAbs, MEDIA_DESC_FILE), 'utf8'));
      return p && p.entries && typeof p.entries === 'object' ? p.entries : {};
    } catch (error) {
      return {};
    }
  }
  async function listMediaFiles(dirAbs, exts) {
    let entries = [];
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch (error) {
      return [];
    }
    return entries
      .filter(
        (e) =>
          e.isFile() && e.name !== MEDIA_DESC_FILE && !e.name.startsWith('.') && exts.has(extname(e.name).toLowerCase())
      )
      .map((e) => e.name)
      .sort();
  }

  // capsule. NON-context — excluded from AI context / corpus graph / indexing exactly like img/data
  // (see COMMONS_SIDECAR_DIRS + CONTEXT_EXCLUDE_SEGMENTS). Any extension; the 20 MB cap
  // (ASSET_MAX_BYTES) is enforced on upload. Files are git-tracked inside the concept dir.
  async function listAssetFiles(dirAbs) {
    let entries = [];
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch (error) {
      return [];
    }
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith('.') && e.name !== MEDIA_DESC_FILE)
      .map((e) => e.name)
      .sort();
  }
  // The machine (v1) download URL for one commons file-asset. Per-segment encoded so a concept id
  // with slashes (dados_vendas/dicionario_dados) survives; the name is a single safe segment.
  function commonsFileAssetV1Url(conceptId, name) {
    const encPath = String(conceptId || '')
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    return `/api/v1/commons/${encPath}/files/${encodeURIComponent(name)}`;
  }
  // The SSO (human) download URLs — open in a browser, no Bearer needed (the session cookie auths).
  // Query-param form, so the whole id is one encoded value. Twins of the v1 (Bearer) URLs; used to
  // offer a clickable download link in media.files[] of the machine read endpoints.
  // `repo` is carried as ?repo= so the link is self-contained: a browser opening it (no
  // x-balde-repo header, no session in the caller's active balde) still resolves the right balde
  // instead of falling back to the viewer's saved-preference balde (which 404s cross-balde).
  function commonsFileAssetWebUrl(conceptId, name, repo = '') {
    const r = String(repo || '')
      .trim()
      .toLowerCase();
    return `/api/commons/file-asset?path=${encodeURIComponent(conceptId)}&name=${encodeURIComponent(name)}${r ? `&repo=${encodeURIComponent(r)}` : ''}`;
  }
  function skillFileAssetWebUrl(skillId, name, repo = '') {
    const r = String(repo || '')
      .trim()
      .toLowerCase();
    return `/api/skills/${encodeURIComponent(skillId)}/file?name=${encodeURIComponent(name)}${r ? `&repo=${encodeURIComponent(r)}` : ''}`;
  }
  // Resolve commonsRoot()/<id>/files/<name> with the SAME guard style as the img handler: id regex
  // (no `..`, no backslash, no leading slash), a safe single-segment name (assertSafeUploadName +
  // no `/`,`\`,`..`), and a normalized-prefix assertion that the resolved path stays inside the
  // concept's files/ dir. Pure/path-only — concept existence + ACL are checked by each handler.
  function resolveCommonsFileAsset(rawId, rawName) {
    const id = String(rawId || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!id || id.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(id)) return null;
    let name;
    try {
      name = assertSafeUploadName(rawName);
    } catch (error) {
      return null;
    }
    if (name.includes('/') || name.includes('\\') || name.includes('..')) return null; // belt & suspenders (mirror img handler)
    const dir = join(commonsRoot(), id, 'files');
    const full = join(dir, name);
    if (!normalize(full).startsWith(normalize(dir))) return null;
    return { id, name, dir, full };
  }
  // Skill twins of the two commons file-asset helpers above (skillsRoot()/<id>/files/<name>). The
  // machine (v1) download URL for one skill file-asset; per-segment encoded so a multi-level skill
  // id (<domain>/<slug>) survives, and the name is a single safe segment.
  function skillFileAssetV1Url(skillId, name) {
    const encPath = String(skillId || '')
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    return `/api/v1/skills/${encPath}/files/${encodeURIComponent(name)}`;
  }
  // Resolve skillsRoot()/<id>/files/<name> with the SAME guard style as resolveCommonsFileAsset, but
  // the id is validated by isSafeSkillId (the skill id shape — rejects `..`, absolute, backslash)
  // instead of the commons regex. SAME name guards (assertSafeUploadName + no `/`,`\`,`..`) and the
  // SAME normalized-prefix assertion that the resolved path stays inside the skill's files/ dir.
  // Pure/path-only — skill existence + ACL are checked by each handler.
  async function resolveSkillFileAsset(rawId, rawName, working = false) {
    const id = String(rawId || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!isSafeSkillId(id)) return null;
    let name;
    try {
      name = assertSafeUploadName(rawName);
    } catch (error) {
      return null;
    }
    if (name.includes('/') || name.includes('\\') || name.includes('..')) return null; // belt & suspenders (mirror img handler)
    const dir = join(working ? join(skillsRoot(), id) : (await loadSkillConsumerContext(id)).sourceDir, 'files');
    const full = join(dir, name);
    if (!normalize(full).startsWith(normalize(dir))) return null;
    return { id, name, dir, full };
  }

  // Best-effort table → GFM markdown (deterministic; quotes-aware; row/col-capped). Delimiter is
  // auto-detected (,/;/tab) unless given. Used so data/ tables render as markdown, not raw CSV.
  function detectDelimiter(sample) {
    const line =
      String(sample)
        .split(/\r?\n/)
        .find((l) => l.trim()) || '';
    const counts = {
      ',': (line.match(/,/g) || []).length,
      ';': (line.match(/;/g) || []).length,
      '\t': (line.match(/\t/g) || []).length
    };
    return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [','])[0] || ',';
  }
  function csvToMarkdown(text, delim = null, maxRows = 40, maxCols = 12) {
    const d = delim || detectDelimiter(text);
    const rows = String(text)
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((l) => l.trim() !== '');
    if (!rows.length) return '';
    const parse = (line) => {
      const out = [];
      let cur = '';
      let q = false;
      for (let i = 0; i < line.length; i += 1) {
        const c = line[i];
        if (q) {
          if (c === '"') {
            if (line[i + 1] === '"') {
              cur += '"';
              i += 1;
            } else q = false;
          } else cur += c;
        } else if (c === '"') q = true;
        else if (c === d) {
          out.push(cur);
          cur = '';
        } else cur += c;
      }
      out.push(cur);
      return out.map((s) => s.trim());
    };
    const cells = rows.slice(0, maxRows + 1).map(parse);
    const cols = Math.min(maxCols, Math.max(1, ...cells.map((r) => r.length)));
    const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|');
    const pad = (r) => {
      const a = r.slice(0, cols);
      while (a.length < cols) a.push('');
      return a;
    };
    const line = (r) => `| ${pad(r).map(esc).join(' | ')} |`;
    const body = cells.slice(1);
    const note =
      rows.length > maxRows + 1
        ? `\n\n_(${rows.length - 1} linhas no total; ${Math.min(body.length, maxRows)} mostradas)_`
        : '';
    return (
      [line(cells[0]), `| ${Array(cols).fill('---').join(' | ')} |`, ...body.slice(0, maxRows).map(line)].join('\n') +
      note
    );
  }

  // Process a concept folder's img/ + data/ with the BYO AI → descriptions.json. Hash-gated:
  // unchanged files keep their description; new/changed ones are (re)described. Returns counts.
  async function processConceptMedia(conceptDirAbs, aiConfig, hint = '') {
    const out = { img: { total: 0, described: 0, skipped: 0 }, data: { total: 0, described: 0, skipped: 0 } };
    const imgDir = join(conceptDirAbs, 'img');
    const imgFiles = await listMediaFiles(imgDir, MEDIA_IMG_EXTS);
    out.img.total = imgFiles.length;
    if (imgFiles.length) {
      const prev = await loadMediaDescriptions(imgDir);
      const entries = {};
      for (const name of imgFiles) {
        let buf;
        try {
          buf = await readFile(join(imgDir, name));
        } catch (error) {
          continue;
        }
        if (buf.length > MEDIA_IMG_MAX_BYTES) {
          entries[name] = prev[name] || { description: '', skipped: 'muito grande' };
          out.img.skipped += 1;
          continue;
        }
        const hash = createHash('sha1').update(buf).digest('hex');
        if (prev[name] && prev[name].hash === hash && prev[name].description) {
          entries[name] = prev[name];
          out.img.skipped += 1;
          continue;
        }
        const desc = await callAiVisionDescribe(buf.toString('base64'), mediaMimeFor(name), aiConfig, {
          system: MEDIA_IMG_SYSTEM,
          prompt: `Descreva esta imagem${hint ? ` (contexto: ${hint})` : ''}.`
        });
        if (desc) {
          entries[name] = {
            description: desc.replace(/\s+/g, ' ').slice(0, 600),
            hash,
            model: aiConfig.model || aiConfig.provider,
            at: new Date().toISOString()
          };
          out.img.described += 1;
        } else {
          entries[name] = prev[name] || { description: '', hash, error: 'sem visão' };
          out.img.skipped += 1;
        }
      }
      await writeFile(
        join(imgDir, MEDIA_DESC_FILE),
        JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), entries }, null, 2),
        'utf8'
      );
    }
    const dataDir = join(conceptDirAbs, 'data');
    const dataFiles = await listMediaFiles(dataDir, MEDIA_DATA_EXTS);
    out.data.total = dataFiles.length;
    if (dataFiles.length) {
      const prev = await loadMediaDescriptions(dataDir);
      const entries = {};
      for (const name of dataFiles) {
        let content = '';
        try {
          const st = await stat(join(dataDir, name));
          if (st.size > MEDIA_DATA_MAX_BYTES) {
            entries[name] = prev[name] || { description: '', skipped: 'muito grande' };
            out.data.skipped += 1;
            continue;
          }
          content = await readFile(join(dataDir, name), 'utf8');
        } catch (error) {
          continue;
        }
        const hash = createHash('sha1').update(content).digest('hex');
        if (prev[name] && prev[name].hash === hash && prev[name].description) {
          entries[name] = prev[name];
          out.data.skipped += 1;
          continue;
        }
        const ext = extname(name).toLowerCase();
        const markdown = ext === '.csv' || ext === '.tsv' ? csvToMarkdown(content, ext === '.tsv' ? '\t' : null) : '';
        let r = null;
        try {
          r = await callAiWithSystemPrompt(
            MEDIA_DATA_SYSTEM,
            { file: name, hint, head: content.slice(0, 4000) },
            aiConfig,
            false
          );
        } catch (error) {
          r = null;
        }
        const desc = (typeof r === 'string' ? r : '').replace(/\s+/g, ' ').trim();
        if (desc || markdown) {
          entries[name] = {
            description: desc.slice(0, 600),
            markdown,
            hash,
            model: aiConfig.model || aiConfig.provider,
            at: new Date().toISOString()
          };
          out.data.described += 1;
        } else {
          entries[name] = prev[name] || { description: '', hash };
          out.data.skipped += 1;
        }
      }
      await writeFile(
        join(dataDir, MEDIA_DESC_FILE),
        JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), entries }, null, 2),
        'utf8'
      );
    }
    return out;
  }

  // Persist user/AI-provided media descriptions (from the create/edit wizard) into
  // the img/ + data/ descriptions.json sidecars. `files` = [{ rel, description,
  // content(Buffer) }]. Merges over any existing entries; only writes non-empty
  // descriptions. Hash matches processConceptMedia so a later re-process skips.
  async function writeWizardMediaDescriptions(conceptDirAbs, files) {
    for (const sub of ['img', 'data']) {
      const items = (files || []).filter(
        (f) => String(f.rel || '').split('/')[0] === sub && String(f.description || '').trim()
      );
      if (!items.length) continue;
      const dir = join(conceptDirAbs, sub);
      const entries = { ...(await loadMediaDescriptions(dir)) };
      for (const it of items) {
        const name = String(it.rel).split('/').pop();
        const hash =
          sub === 'data'
            ? createHash('sha1').update(it.content.toString('utf8')).digest('hex')
            : createHash('sha1').update(it.content).digest('hex');
        entries[name] = {
          description: String(it.description).replace(/\s+/g, ' ').trim().slice(0, 600),
          hash,
          at: new Date().toISOString(),
          source: 'wizard'
        };
      }
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, MEDIA_DESC_FILE),
        JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), entries }, null, 2),
        'utf8'
      );
    }
  }

  // conceptId (optional) is the concept/skill path; when given, each files[] entry carries its
  // machine (v1) download URL built by `fileUrl` (defaults to the commons URL builder — skill
  // callers pass skillFileAssetV1Url). img/data behavior is unchanged. The files[] bucket is
  // NON-context (mediaContextBlock ignores it) — it only surfaces downloadable assets to the app + machine API.
  async function conceptMediaEntries(conceptDirAbs, conceptId = '', fileUrl = commonsFileAssetV1Url) {
    const imgDir = join(conceptDirAbs, 'img');
    const dataDir = join(conceptDirAbs, 'data');
    const filesDir = join(conceptDirAbs, 'files');
    const [imgDesc, dataDesc, imgFiles, dataFiles, assetFiles] = await Promise.all([
      loadMediaDescriptions(imgDir),
      loadMediaDescriptions(dataDir),
      listMediaFiles(imgDir, MEDIA_IMG_EXTS),
      listMediaFiles(dataDir, MEDIA_DATA_EXTS),
      listAssetFiles(filesDir)
    ]);
    const files = [];
    for (const name of assetFiles) {
      let size = 0;
      try {
        size = (await stat(join(filesDir, name))).size;
      } catch (error) {
        size = 0;
      }
      files.push({ name, size, url: conceptId ? fileUrl(conceptId, name) : '' });
    }
    return {
      images: imgFiles.map((name) => ({ name, description: (imgDesc[name] && imgDesc[name].description) || '' })),
      data: dataFiles.map((name) => ({
        name,
        description: (dataDesc[name] && dataDesc[name].description) || '',
        markdown: (dataDesc[name] && dataDesc[name].markdown) || ''
      })),
      files
    };
  }
  // Markdown block of media descriptions (+ the table-as-markdown), appended to a concept's context
  // when consumed (Phase 2: descriptions "become context"). Empty when there's no described media.
  function mediaContextBlock(media, basePath) {
    const imgs = (media.images || []).filter((m) => m.description);
    const dats = (media.data || []).filter((m) => m.description || m.markdown);
    const fls = media.files || []; // files/ sidecar: PDFs, planilhas, zips — offerable to the user
    if (!imgs.length && !dats.length && !fls.length) return '';
    // When the corpus base path is known, print the EXACT citable path per file so the
    // model can copy it verbatim into `corpus:` refs (it must never construct paths).
    const at = (kind, name) => (basePath ? ` (caminho no corpus: ${basePath}/${kind}/${name})` : '');
    let out = '';
    if (imgs.length)
      out += `\n\n## Imagens (descritas por IA)\n${imgs.map((m) => `- **${m.name}**${at('img', m.name)}: ${m.description}`).join('\n')}`;
    if (dats.length)
      out += `\n\n## Dados\n${dats.map((m) => `### ${m.name}${at('data', m.name)}\n${m.description || ''}${m.markdown ? `\n\n${m.markdown}` : ''}`).join('\n\n')}`;
    // Attached files are NOT context (their bytes are never in the prompt) — they exist so the
    // buddy can OFFER them: cite the path and the user views/downloads it in the chat.
    if (fls.length)
      out += `\n\n## Arquivos anexos (não são contexto — ofereça ao usuário para visualizar/baixar)\n${fls.map((m) => `- **${m.name}**${at('files', m.name)}${m.size ? ` — ${formatBytesServer(m.size)}` : ''}`).join('\n')}`;
    return out;
  }
  // Governance-derived warning line for a capsule (or '' when healthy). DEPRECATED capsules
  // carry the aviso INSIDE their content on every AI surface — chat inlining, read_context,
  // /api/v1/commons — so the model can't consume stale knowledge without seeing the flag.
  async function capsuleAvisoText(id) {
    try {
      const defaults = {
        cadence: (await loadCommonsDefaults()).cadence,
        deprecationCfg: (await loadScoringConfig()).deprecation
      };
      const g = conceptGovernanceFrom(await loadCommonsConceptGov(id), defaults);
      if (!g.deprecated) return '';
      const motivos = ((g.deprecation && g.deprecation.reasons) || []).join('; ') || 'critérios de depreciação';
      return `[⚠️ ATENÇÃO: a cápsula commons/${id} está DEPRECIADA (conteúdo possivelmente desatualizado). Motivos: ${motivos}. Avise o usuário disso ANTES de usar este conteúdo na resposta.]`;
    } catch (error) {
      return '';
    }
  }

  // Índice de lint da ontologia de um domínio (ou null quando não há/ilegível): lido do
  // context.md CRU da cápsula reservada, respeitando a ACL do ator. `cache` (Map por chamada)
  // evita reler o mesmo domínio dentro de um compile/render.
  async function domainOntologyLintIndex(domain, actor = null, cache = null) {
    const d = String(domain || '').trim();
    if (!d) return null;
    if (cache && cache.has(d)) return cache.get(d);
    let index = null;
    try {
      const id = domainOntologyId(d);
      if ((await commonsHasConcept(id)) && (!actor || (await canReadCommonsActor(id, actor)))) {
        const md = await readFile(commonsConceptContextPath(id), 'utf8');
        const { concepts } = parseOntologyMd(md);
        if (concepts.length) index = buildOntologyIndex(concepts);
      }
    } catch (error) {
      index = null;
    }
    if (cache) cache.set(d, index);
    return index;
  }

  // The canonical "commons concept content, as context": context.md + its AI-described media
  // (Phase 2 — descriptions become context). Used by every read path (chat read_context, the
  // machine API /api/v1/commons/{path}, and the MCP read tool) so consumption is uniform.
  // A deprecated capsule's content arrives with the aviso PREPENDED (see capsuleAvisoText).
  async function readCommonsConceptForContext(id) {
    const content = await readFile(commonsConceptContextPath(id), 'utf8');
    const aviso = await capsuleAvisoText(id);
    return (
      (aviso ? `${aviso}\n\n` : '') +
      content +
      mediaContextBlock(await conceptMediaEntries(join(commonsRoot(), id), id), `commons/${id}`)
    );
  }

  // Enriched commons listing: each concept (folder) + summary (AI if generated, else heuristic) +
  // referencedBy + per-concept governance (creator/cadence/lock/eval/approvals), plus a roll-up.
  async function buildCommonsList() {
    const defaults = {
      owner: null,
      curators: [],
      cadence: (await loadCommonsDefaults()).cadence,
      deprecationCfg: (await loadScoringConfig()).deprecation
    };
    const index = await loadContextIndex(commonsRoot()); // A2 summaries, keyed by concept id
    const link = await corpusLinkIndex();
    const ids = (await listCommonsConcepts()).sort();
    const concepts = [];
    const counts = { green: 0, 'due-soon': 0, overdue: 0, never: 0, closed: 0 };
    const auditDue = [];
    for (const id of ids) {
      let content = '';
      try {
        content = await readFile(commonsConceptContextPath(id), 'utf8');
      } catch (error) {
        content = '';
      }
      const g = conceptGovernanceFrom(await loadCommonsConceptGov(id), defaults);
      if (!g.creator) g.creator = await creatorFromGit(commonsRoot(), id); // git author of the concept folder
      const idxEntry = index && index.entries && index.entries[id];
      const aiSummary =
        idxEntry && idxEntry.hash === createHash('sha1').update(content).digest('hex') ? idxEntry.summary : null;
      counts[g.status] = (counts[g.status] || 0) + 1;
      if (g.status === 'overdue' || g.status === 'never') auditDue.push(id);
      concepts.push({
        path: id,
        title: g.titulo || id.split('/').pop(),
        size: Buffer.byteLength(content, 'utf8'),
        summary: aiSummary || heuristicSummary(`${id}/context.md`, content.slice(0, 2048)),
        summarySource: aiSummary ? 'ai' : 'heuristic',
        referencedBy: [...new Set((link.backlinks.get(`commons/${id}`) || []).map((b) => b.fromSkill))].sort(),
        media: {
          img: (await listMediaFiles(join(commonsRoot(), id, 'img'), MEDIA_IMG_EXTS)).length,
          data: (await listMediaFiles(join(commonsRoot(), id, 'data'), MEDIA_DATA_EXTS)).length,
          files: (await listAssetFiles(join(commonsRoot(), id, 'files'))).length
        },
        visibility: (await loadCommonsAccess(id)).visibility,
        governance: g
      });
    }
    const severity = ['overdue', 'never', 'due-soon', 'green'];
    const overallStatus = severity.find((s) => concepts.some((c) => c.governance.status === s)) || 'green';
    return { concepts, governance: { cadence: defaults.cadence, counts, auditDue, overallStatus } };
  }

  // Roll-up (counts/auditDue/overall) recomputed over a VIEWER-FILTERED concept list, so a
  // restricted capsule never leaks its id via auditDue nor bumps the counters of someone
  // who can't see it.
  function commonsRollup(concepts, cadence) {
    const counts = { green: 0, 'due-soon': 0, overdue: 0, never: 0, closed: 0 };
    const auditDue = [];
    for (const c of concepts) {
      const s = (c.governance && c.governance.status) || 'never';
      counts[s] = (counts[s] || 0) + 1;
      if (s === 'overdue' || s === 'never') auditDue.push(c.path);
    }
    const severity = ['overdue', 'never', 'due-soon', 'green'];
    const overallStatus =
      severity.find((s) => concepts.some((c) => (c.governance && c.governance.status) === s)) || 'green';
    return { cadence, counts, auditDue, overallStatus };
  }

  // The commons list a given actor may SEE: buildCommonsList minus restricted capsules the
  // actor can't read, with the roll-up recomputed over the visible subset. Every list-serving
  // surface (web /api/commons, machine /api/v1/commons, govern responses) goes through here.
  async function commonsListForActor(actor) {
    const full = await buildCommonsList();
    const concepts = [];
    for (const c of full.concepts || []) {
      if (c.visibility === 'restricted' && !(await canReadCommonsActor(c.path, actor))) continue;
      concepts.push(c);
    }
    return { concepts, governance: commonsRollup(concepts, full.governance && full.governance.cadence) };
  }

  // Owning concept of a commons-relative path (e.g. "<domínio>/<conceito>/img/x.png" →
  // "<domínio>/<conceito>"): the NEAREST ancestor folder holding a context.md. Concepts can
  // nest deeper than 2 segments in legacy corpora, so this walks the longest prefix down.
  async function commonsConceptOfPath(relPath) {
    const segs = String(relPath || '')
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean);
    for (let n = segs.length; n >= 1; n--) {
      const cand = segs.slice(0, n).join('/');
      if (await commonsHasConcept(cand)) return cand;
    }
    return null;
  }

  // Build one skill's full inline context block (SKILL.md + text context files) within a
  // char budget. SKILL.md is the spine — always included (truncated only if it alone
  // overflows); context files fill the remaining budget in priority order; anything that
  // doesn't fit joins the "não incluídos" manifest so the model knows what's missing.
  // The /commons/<id> capsule links in a SKILL.md body (deduped) — the skill-as-spine pattern:
  // a skill's knowledge often lives in the capsules it references, not in its own files. The cap
  // is generous because a spine can legitimately index a whole process (one capsule per phase);
  // the real limiter is the char budget in buildSkillContextBlock, which degrades gracefully by
  // listing overflow under "não incluídos" instead of silently dropping it.

  function linkedCapsuleIds(markdown) {
    return [
      ...new Set(
        (String(markdown || '').match(/(?<![@\w])\/commons\/[A-Za-z0-9._/-]+/g) || []).map((m) =>
          m.replace('/commons/', '').replace(/[).,]+$/, '')
        )
      )
    ].slice(0, MAX_LINKED_CAPSULES);
  }

  // R2: cross-repo capsule references — `/@<repo>/commons/<cid>` links in a skill's text.
  // Consumption is membership+ACL-gated against the TARGET repo with the READER's identity
  // (reference ≠ grant); série expansion stays within-repo (an xrepo episode inlines alone).
  function linkedXrepoCapsuleRefs(markdown) {
    const out = [];
    const seen = new Set();
    for (const m of String(markdown || '').match(/\/@[a-z0-9][a-z0-9-]{1,30}\/commons\/[A-Za-z0-9._/-]+/g) || []) {
      const mm = /^\/@([a-z0-9][a-z0-9-]{1,30})\/commons\/(.+)$/.exec(m.replace(/[).,]+$/, ''));
      if (!mm) continue;
      const key = `${mm[1]}/${mm[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ repo: mm[1], cid: mm[2] });
    }
    return out.slice(0, MAX_LINKED_CAPSULES);
  }

  async function actorMemberOfRepo(repoName, actor) {
    if (String(repoName) === activeRepo()) return true;
    const entry = await repoByName(repoName);
    return Boolean(
      entry && isRepoMember(entry, (actor && actor.groups) || [], normEmail((actor && actor.email) || ''))
    );
  }

  // controlled vocabulary (canonical concepts + accepted synonyms). It is an ordinary governed
  // capsule (owner, selo, cadence, ACL, git) — the reservation is only the path convention —
  // and its content is ALWAYS fed to chat and machine consumers as the domain's basic
  // definitions. A restricted ontology simply doesn't exist for non-readers (same ACL rule
  // as every capsule).
  const ONTOLOGY_CONCEPT_SLUG = 'ontologia';
  function isOntologyCapsuleId(id) {
    const parts = String(id || '').split('/');
    return parts.length === 2 && parts[1] === ONTOLOGY_CONCEPT_SLUG;
  }
  function domainOntologyId(domain) {
    const d = String(domain || '').trim();
    return d ? `${d}/${ONTOLOGY_CONCEPT_SLUG}` : '';
  }
  // Existence + per-capsule ACL as the given actor → { id } or null. Content is read by the
  // caller (readCommonsConceptForContext) so grounding and API reuse the one capsule reader.
  async function domainOntologyFor(domain, actor = null) {
    const id = domainOntologyId(domain);
    if (!id || !(await commonsHasConcept(id))) return null;
    if (actor && !(await canReadCommonsActor(id, actor))) return null;
    return { id };
  }

  // Resolve a skill's linked capsules into plain capsules vs temporal SERIES (Linha do tempo).
  // Linking ANY episode links the whole series: episodes are gathered CORPUS-WIDE by the
  // (domain, serie) key and sorted newest-first (ISO periodo prefixes sort as strings).
  // Used by the chat's inline grounding (latest-1 + manifest) and the paged manifest block.
  // When `actor` is given, RESTRICTED capsules the actor can't read are dropped (id included),
  // so a viewer's grounding never mentions a capsule they have no access to.
  async function resolveLinkedCapsules(skill, actor = null) {
    const plain = [];
    const seriesKeys = new Set();
    for (const cid of linkedCapsuleIds(skill.sourceText)) {
      if (actor && !(await canReadCommonsActor(cid, actor))) continue;
      let gov = null;
      try {
        gov = await loadCommonsConceptGov(cid);
      } catch (error) {
        gov = null;
      }
      const serie = gov && typeof gov.serie === 'string' ? gov.serie : '';
      if (serie) seriesKeys.add(`${cid.split('/')[0]}/${serie}`);
      else plain.push(cid);
    }
    // Cross-repo capsules: target-repo membership + capsule ACL, both as the reader.
    const xrepo = [];
    for (const ref of linkedXrepoCapsuleRefs(skill.sourceText)) {
      if (ref.repo === activeRepo()) continue; // same-repo qualified link — the plain form covers it
      if (actor && !(await actorMemberOfRepo(ref.repo, actor))) continue;
      const readable = await runWithRepo(ref.repo, async () => {
        if (actor && !(await canReadCommonsActor(ref.cid, actor))) return false;
        return true;
      });
      if (readable) xrepo.push(ref);
    }
    const series = [];
    if (seriesKeys.size) {
      const byKey = new Map();
      for (const id of await listCommonsConcepts()) {
        let g = null;
        try {
          g = await loadCommonsConceptGov(id);
        } catch (error) {
          continue;
        }
        if (!g || typeof g.serie !== 'string' || !g.serie) continue;
        const key = `${id.split('/')[0]}/${g.serie}`;
        if (!seriesKeys.has(key)) continue;
        if (actor && !(await canReadCommonsActor(id, actor))) continue; // restricted episode → invisible
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push({ id, periodo: String(g.periodo || '') });
      }
      for (const [key, episodes] of byKey.entries()) {
        episodes.sort((a, b) => b.periodo.localeCompare(a.periodo));
        series.push({ key, episodes });
      }
      series.sort((a, b) => a.key.localeCompare(b.key));
    }
    return { plain, series, xrepo };
  }

  return {
    planCommonsMigration,
    applyCommonsMigration,
    commonsConceptContextPath,
    commonsConceptGovPath,
    listCommonsConcepts,
    loadCommonsConceptGov,
    saveCommonsConceptGov,
    loadCommonsDefaults,
    saveCommonsDefaults,
    commonsHasConcept,
    MEDIA_IMG_EXTS,
    MEDIA_DATA_EXTS,
    MEDIA_IMG_MAX_BYTES,
    MEDIA_DATA_MAX_BYTES,
    MEDIA_IMG_SYSTEM,
    MEDIA_DATA_SYSTEM,
    mediaMimeFor,
    listMediaFiles,
    listAssetFiles,
    commonsFileAssetV1Url,
    commonsFileAssetWebUrl,
    skillFileAssetWebUrl,
    resolveCommonsFileAsset,
    skillFileAssetV1Url,
    resolveSkillFileAsset,
    processConceptMedia,
    writeWizardMediaDescriptions,
    conceptMediaEntries,
    mediaContextBlock,
    capsuleAvisoText,
    domainOntologyLintIndex,
    readCommonsConceptForContext,
    buildCommonsList,
    commonsListForActor,
    commonsConceptOfPath,
    linkedCapsuleIds,
    linkedXrepoCapsuleRefs,
    actorMemberOfRepo,
    isOntologyCapsuleId,
    domainOntologyId,
    domainOntologyFor,
    resolveLinkedCapsules
  };
}
