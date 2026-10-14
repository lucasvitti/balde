import {
  CONTEXT_BUDGET_CHARS,
  AVISO_FIRST_NOTE,
  CONTEXT_PAGING_THRESHOLD_CHARS,
  CHAT_TOOL_READ_MAX_CHARS,
  SQL_FORMATTER_URL
} from '../policy/chat-policy.mjs';
import { COMMONS_CONCEPT_FILE } from '../policy/governance-policy.mjs';
import { sealSubmission } from '../governance/exchange.mjs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFrontmatter } from '../skill-format.mjs';
import { skillsRoot, commonsRoot, activeRepo, runWithRepo } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { runGovernedQuery, datasetTableName } from '../duckdb.mjs';
import { isCliProvider } from '../ai-cli.mjs';
import { listRelativeFiles } from '../skill-helpers.mjs';

export function createChatContextFeature({
  loadSkillConsumerContext,
  linkedCapsuleIds,
  canReadCommonsActor,
  linkedXrepoCapsuleRefs,
  actorMemberOfRepo,
  readSkillTextContext,
  safeFence,
  contextFenceLang,
  resolveLinkedCapsules,
  readCommonsConceptForContext,
  domainOntologyId,
  domainOntologyFor,
  formatBytesServer,
  mediaContextBlock,
  conceptMediaEntries,
  loadSkillsFromDisk,
  deprecationNotice,
  qualityNotice,
  resolveChatBuddy,
  buddyPromptSuffix,
  discoverSkillContextFiles,
  commonsConceptContextPath,
  skillContextManifest,
  corpusNodeIndex,
  commonsConceptOfPath,
  skillIdOfCorpusPath,
  canReadSkillActor,
  capsuleAvisoText,
  createQueueItem,
  recordSkillEvent,
  listAssetFiles,
  skillFileAssetV1Url,
  skillFileAssetWebUrl,
  listCommonsConcepts,
  commonsFileAssetV1Url,
  commonsFileAssetWebUrl,
  isGovernancePath,
  skillExistsById,
  listQueueItems,
  newQueueId,
  queueDir,
  QUEUE_PREVIEW_CHARS,
  writeQueueMeta
}) {
  const DATASET_EXT_RE = /\.(csv|parquet)$/i;
  const DATASET_MAX_TOTAL_BYTES = Number(process.env.DUCKDB_MAX_DATASET_BYTES || 200 * 1024 * 1024);
  async function skillQueryDatasets(skillId, actor) {
    const working = await loadSkillConsumerContext(skillId);
    const out = [];
    const seen = new Set();
    const skippedNames = [];
    const push = (table, abs, source, bytes) => {
      let name = table;
      if (seen.has(name)) {
        const capSeg = source.startsWith('commons/') ? source.split('/')[2] || 'capsula' : 'skill';
        const alt = `${datasetTableName(capSeg)}_${table}`.slice(0, 60);
        if (seen.has(alt)) {
          skippedNames.push(source);
          return;
        }
        name = alt;
      }
      seen.add(name);
      out.push({ table: name, path: abs, source, bytes });
    };
    for (const rel0 of working.files || []) {
      const rel = rel0.replaceAll('\\', '/');
      if (!/^(analytics|data)\//.test(rel) || !DATASET_EXT_RE.test(rel)) continue;
      const draftAbs = join(working.draftDir, rel);
      const abs = (await pathExists(draftAbs)) ? draftAbs : join(working.sourceDir, rel);
      let bytes = 0;
      try {
        bytes = (await stat(abs)).size;
      } catch (error) {
        continue;
      }
      push(datasetTableName(rel), abs, `${skillId}/${rel}`, bytes);
    }
    for (const cid of linkedCapsuleIds(working.markdown)) {
      // Per-capsule ACL: a restricted capsule's datasets never load for a non-reader —
      // its tables are simply absent from the sandbox (queries touching them fail honestly).
      if (actor && !(await canReadCommonsActor(cid, actor))) continue;
      let rels = [];
      try {
        rels = (await listRelativeFiles(join(commonsRoot(), cid))).map((r) => r.replaceAll('\\', '/'));
      } catch (error) {
        continue;
      }
      for (const rel of rels) {
        if (!rel.startsWith('data/') || !DATASET_EXT_RE.test(rel)) continue;
        const abs = join(commonsRoot(), cid, rel);
        let bytes = 0;
        try {
          bytes = (await stat(abs)).size;
        } catch (error) {
          continue;
        }
        push(datasetTableName(rel), abs, `commons/${cid}/${rel}`, bytes);
      }
    }
    // Cross-repo capsule datasets: target-repo membership + capsule ACL as the reader.
    for (const ref of linkedXrepoCapsuleRefs(working.markdown)) {
      if (ref.repo === activeRepo()) continue;
      if (actor && !(await actorMemberOfRepo(ref.repo, actor))) continue;
      await runWithRepo(ref.repo, async () => {
        if (actor && !(await canReadCommonsActor(ref.cid, actor))) return;
        let rels = [];
        try {
          rels = (await listRelativeFiles(join(commonsRoot(), ref.cid))).map((r) => r.replaceAll('\\', '/'));
        } catch (error) {
          return;
        }
        for (const rel of rels) {
          if (!rel.startsWith('data/') || !DATASET_EXT_RE.test(rel)) continue;
          const abs = join(commonsRoot(), ref.cid, rel);
          let bytes = 0;
          try {
            bytes = (await stat(abs)).size;
          } catch (error) {
            continue;
          }
          push(datasetTableName(rel), abs, `@${ref.repo}/commons/${ref.cid}/${rel}`, bytes);
        }
      });
    }
    const totalBytes = out.reduce((a, d) => a + d.bytes, 0);
    return { datasets: out, skippedNames, totalBytes, overLimit: totalBytes > DATASET_MAX_TOTAL_BYTES };
  }

  async function buildSkillContextBlock(skill, budget, actor = null, opts = {}) {
    const header = `### ${skill.nome} (${skill.id}) — v${skill.version} · ${skill.status}\nObjetivo: ${skill.objetivo || '—'}\nEscopo: ${skill.escopo || '—'}`;
    let body = '';
    try {
      body = parseFrontmatter(String(skill.sourceText || '')).body.trim();
    } catch (error) {
      body = String(skill.sourceText || '').trim();
    }
    const skillMdCap = Math.max(0, budget - header.length - 200);
    let skillMd = body;
    let bodyTruncated = false;
    if (skillMd.length > skillMdCap) {
      skillMd = skillMd.slice(0, skillMdCap);
      bodyTruncated = true;
    }
    let block = `${header}\n\n#### SKILL.md\n${skillMd}${bodyTruncated ? '\n\n[...SKILL.md truncado por limite de contexto...]' : ''}`;
    let used = block.length;

    const { textFiles, skipped } = await readSkillTextContext(skill);
    const omitted = [];
    for (const file of textFiles) {
      const fence = safeFence(file.content);
      const piece = `\n\n#### Contexto — ${file.rel}\n${fence}${contextFenceLang(file.rel)}\n${file.content}\n${fence}`;
      if (used + piece.length > budget) {
        omitted.push({ rel: file.rel, bytes: file.bytes, reason: 'limite de contexto' });
        continue;
      }
      block += piece;
      used += piece.length;
    }

    // Linked capsules: inline each referenced capsule's content (context.md + its AI-described
    // media — the SAME content MCP and /api/v1 serve). Without this, a spine-style skill whose
    // knowledge lives in capsules grounds the chat on a bare link name. Capsules are atomic
    // (never link onward), so inlining is depth-1 by construction.
    // Temporal series (Linha do tempo): only the LATEST episode is inlined in full; the other
    // periods appear as a manifest so the model knows they exist without blowing the budget.
    const { plain, series, xrepo } = await resolveLinkedCapsules(skill, actor);
    const inlineCapsule = async (cid, heading) => {
      let content = '';
      try {
        content = await readCommonsConceptForContext(cid);
      } catch (error) {
        return;
      } // deleted/unreadable → skip
      const piece = `\n\n${heading}\n${content}`;
      if (used + piece.length > budget) {
        omitted.push({
          rel: `commons/${cid}`,
          bytes: Buffer.byteLength(content, 'utf8'),
          reason: 'limite de contexto'
        });
        return;
      }
      block += piece;
      used += piece.length;
    };
    // Ontologia do domínio: ALWAYS inlined as the domain's basic definitions — before the other
    // capsules so the vocabulary lands even when the budget starts degrading. Deduped when the
    // skill links it explicitly (plain covers it) or another selected skill of the same domain
    // already carried it into this prompt (opts.seenOntologyDomains).
    const ontoDomain = String(skill.domain || String(skill.id || '').split('/')[0] || '');
    const seenOnto = opts.seenOntologyDomains || null;
    if (ontoDomain && !(seenOnto && seenOnto.has(ontoDomain)) && !plain.includes(domainOntologyId(ontoDomain))) {
      const onto = await domainOntologyFor(ontoDomain, actor);
      if (onto) {
        if (seenOnto) seenOnto.add(ontoDomain);
        await inlineCapsule(
          onto.id,
          `#### Definições do domínio ${ontoDomain} — commons/${onto.id} (ontologia: vocabulário canônico e sinônimos aceitos; use estes termos nas respostas)`
        );
      }
    }
    for (const cid of plain) {
      await inlineCapsule(cid, `#### Cápsula vinculada — commons/${cid}`);
    }
    // Cross-repo capsules (already membership+ACL-filtered): read in the TARGET repo's context.
    for (const ref of xrepo || []) {
      let content = '';
      try {
        content = await runWithRepo(ref.repo, () => readCommonsConceptForContext(ref.cid));
      } catch (error) {
        continue;
      }
      const piece = `
  
  #### Cápsula vinculada — @${ref.repo}/commons/${ref.cid}
  ${content}`;
      if (used + piece.length > budget) {
        omitted.push({
          rel: `@${ref.repo}/commons/${ref.cid}`,
          bytes: Buffer.byteLength(content, 'utf8'),
          reason: 'limite de contexto'
        });
        continue;
      }
      block += piece;
      used += piece.length;
    }
    for (const s of series) {
      const latest = s.episodes[0];
      if (!latest) continue;
      await inlineCapsule(
        latest.id,
        `#### Cápsula vinculada — commons/${latest.id} (série ${s.key}${latest.periodo ? `, período ${latest.periodo} — o MAIS RECENTE` : ''})`
      );
      const others = s.episodes.slice(1);
      if (others.length) {
        const manifest = `\n\n#### Série ${s.key} — outros episódios (conteúdo NÃO incluído aqui)\n${others.map((e) => `- commons/${e.id}${e.periodo ? ` (${e.periodo})` : ''}`).join('\n')}\nSe o usuário perguntar sobre um período que não está incluído, diga que o episódio existe na série e peça para abri-lo (ou selecione-o como contexto).`;
        if (used + manifest.length <= budget) {
          block += manifest;
          used += manifest.length;
        }
      }
    }

    const notIncluded = [...skipped, ...omitted];
    if (notIncluded.length) {
      const lines = notIncluded
        .map((item) => `- ${item.rel} (${formatBytesServer(item.bytes)}) — ${item.reason}`)
        .join('\n');
      const note = `\n\n#### Arquivos de contexto NÃO incluídos\n${lines}`;
      block += note;
      used += note.length;
    }

    // Phase 3: a skill's img/ + data/ media descriptions become context too (like commons).
    const skillDir = (skill.artifactFacts && skill.artifactFacts.sourceFolder) || join(skillsRoot(), skill.id);
    const mediaBlock = mediaContextBlock(await conceptMediaEntries(skillDir), skill.id);
    if (mediaBlock && used + mediaBlock.length <= budget) {
      block += mediaBlock;
      used += mediaBlock.length;
    }
    return { text: block, used };
  }

  // Grounding system prompt built from the chat's selected skills.
  // Buddy-presents-to-user: tells the buddy it can surface corpus images/files (that
  // already exist in the context skills / commons) directly in its answer. The client
  // resolves `corpus:` refs to the gated /corpus-file endpoint — the buddy only cites paths.
  const CORPUS_PRESENT_NOTE =
    '\n\n---\nMOSTRAR ARQUIVOS AO USUÁRIO: você pode exibir imagens e oferecer arquivos que existem de fato no corpus. Para uma imagem, escreva `![legenda](corpus:CAMINHO)`; para outro arquivo (PDF, planilha, zip), `[nome](corpus:CAMINHO)`. CAMINHO deve ser copiado EXATAMENTE de uma fonte confiável: o índice de contexto (list_context), a seção Arquivos anexos de uma cápsula/skill, ou o campo path retornado por find_corpus_files. NUNCA invente um caminho e NUNCA presuma pastas.\nIMPORTANTE — os ANEXOS (o sidecar files/: PDFs, planilhas, zips) NÃO aparecem no índice de contexto. Quando o usuário pedir um documento, PDF, proposta, anexo ou pedir para ver/baixar um arquivo, chame find_corpus_files ANTES de responder. Só diga que não existe depois que a busca não retornar nada — nunca afirme que não há arquivo apenas porque ele não está no índice de contexto.';

  async function chatSystemPrompt(skillIds, actor = null) {
    const orgSeg = process.env.BALDE_ORG_NAME ? ` da equipe ${process.env.BALDE_ORG_NAME}` : '';
    const base = `Você é o assistente do Balde, a base de conhecimento de skills de IA${orgSeg}. Converse em português (pt-BR), de forma clara e objetiva. Quando o usuário trouxer conhecimento novo que deveria atualizar uma skill, ajude a redigir esse conteúdo e ofereça enviá-lo à fila de curadoria com a ferramenta contribute_to_queue — mostre o texto final, peça confirmação explícita e SÓ ENTÃO chame a ferramenta (nunca envie sem o usuário confirmar).`;
    const ids = Array.isArray(skillIds) ? skillIds : [];
    if (!ids.length) {
      return `${base}\n\nNenhuma skill foi selecionada como contexto nesta conversa. Responda de forma geral; se precisar do conteúdo específico de uma skill, peça ao usuário para selecioná-la no seletor de contexto.`;
    }
    const skills = await loadSkillsFromDisk();
    const blocks = [];
    let total = 0;
    const seenOntologyDomains = new Set(); // one ontology inline per domain across the prompt
    for (const id of ids) {
      const skill = skills.find((item) => item.id === id);
      if (!skill) {
        continue;
      }
      if (total >= CONTEXT_BUDGET_CHARS) {
        break;
      }
      const { text, used } = await buildSkillContextBlock(skill, CONTEXT_BUDGET_CHARS - total, actor, {
        seenOntologyDomains
      });
      if (!text) {
        continue;
      }
      total += used;
      // Deprecated (or low-quality, item 4) skill in context → the aviso rides INSIDE the block
      // so the model must carry the caveat into its answers (same editable prompts as MCP).
      const aviso = (await deprecationNotice(skill)) || (await qualityNotice(skill));
      blocks.push(aviso ? `[${aviso}]\n\n${text}` : text);
    }
    let prompt = `${base}\n\nO usuário selecionou estas skills como contexto. Cada bloco abaixo traz a skill (SKILL.md), TODOS os seus arquivos de contexto (Catálogo, queries, contexto adicional, schema) e as cápsulas vinculadas por link (seções "Cápsula vinculada"). Use esse conteúdo como fonte de verdade para responder e deixe claro quando algo estiver fora do que essas skills cobrem:\n\n${blocks.join('\n\n---\n\n')}`;
    // Item 3: DEPRECIADO/qualidade-baixa no contexto (skill OU cápsula inlinada) → o modelo
    // avisa o usuário PRIMEIRO. A detecção cobre os avisos de cápsula embutidos no conteúdo.
    if (/DEPRECIAD|qualidade BAIXO/i.test(prompt)) prompt += AVISO_FIRST_NOTE;
    prompt += CORPUS_PRESENT_NOTE;
    const buddy = await resolveChatBuddy(ids, skills);
    if (buddy) {
      prompt += buddyPromptSuffix(buddy);
    }
    return prompt;
  }

  // A skill's grounding mode from SKILL.md frontmatter: `context_mode: inline | paged`.
  // Anything else (or absent) → 'auto' (decided by size). See DESIGN + CONTEXT_PAGING_THRESHOLD.
  function skillContextMode(skill) {
    let meta = {};
    try {
      meta = parseFrontmatter(String(skill.sourceText || '')).meta || {};
    } catch (error) {
      meta = {};
    }
    const m = String(meta.context_mode || meta.contextMode || '')
      .toLowerCase()
      .trim();
    return m === 'inline' || m === 'paged' ? m : 'auto';
  }

  // SKILL.md body length without reading files (frontmatter-stripped).
  function skillMdChars(skill) {
    try {
      return parseFrontmatter(String(skill.sourceText || '')).body.trim().length;
    } catch (error) {
      return String(skill.sourceText || '').trim().length;
    }
  }

  // Decide inline vs paged for a chat's selected skills (Phase D). Explicit `paged` on any
  // skill → paged; all-`inline` → inline; otherwise auto by combined size. Sizing uses byte
  // stats (no content reads). Returns { mode, total, perSkill }.
  async function resolveChatContextMode(skills, aiConfig = null) {
    let anyPaged = false;
    let allInline = skills.length > 0;
    let total = 0;
    const perSkill = [];
    for (const skill of skills) {
      const mode = skillContextMode(skill);
      let bytes = 0;
      try {
        const { textFiles } = await discoverSkillContextFiles(skill);
        for (const f of textFiles) bytes += f.bytes;
      } catch (error) {
        bytes = 0;
      }
      // Linked capsules are inlined too, so they count toward the inline-vs-paged decision —
      // a small spine with heavy capsules must graduate to paged like any big skill.
      for (const cid of linkedCapsuleIds(skill.sourceText)) {
        try {
          bytes += (await stat(commonsConceptContextPath(cid))).size;
        } catch (error) {
          /* absent */
        }
      }
      const sub = bytes + skillMdChars(skill);
      total += sub;
      perSkill.push({ id: skill.id, mode, chars: sub });
      if (mode === 'paged') anyPaged = true;
      if (mode !== 'inline') allInline = false;
    }
    let mode;
    // Provedor CLI: cada round de ferramenta é um SPAWN do cliente (~5-8s) — inline vale muito
    // mais que paging. Sobe o limiar até o teto do budget inline; `context_mode: paged` explícito
    // no SKILL.md continua mandando.
    const threshold = isCliProvider(aiConfig?.provider)
      ? Number(process.env.CONTEXT_PAGING_THRESHOLD_CLI_CHARS || CONTEXT_BUDGET_CHARS)
      : CONTEXT_PAGING_THRESHOLD_CHARS;
    if (anyPaged) mode = 'paged';
    else if (allInline) mode = 'inline';
    else mode = total > threshold ? 'paged' : 'inline';
    return { mode, total, perSkill };
  }

  // Map a corpus path ("<skillId>/<rel>" or "commons/<rel>") → absolute file. The corpus node
  // index is the allow-list; this only turns an allowed path into a disk path (rejects traversal).
  async function resolveCorpusNodeFull(corpusPath) {
    const p = String(corpusPath || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!p || p.includes('..')) return null;
    if (p.startsWith('commons/')) return join(commonsRoot(), p.slice('commons/'.length), COMMONS_CONCEPT_FILE); // folder id → context.md
    const segments = p.split('/');
    for (let i = segments.length - 1; i > 0; i--) {
      const id = segments.slice(0, i).join('/');
      if (!(await pathExists(join(skillsRoot(), id, 'SKILL.md')))) continue;
      const context = await loadSkillConsumerContext(id);
      return join(context.sourceDir, ...segments.slice(i));
    }
    return null;
  }

  // Light per-skill block for PAGED mode: header + full SKILL.md (the spine) + a manifest of
  // context files (path · kind · size · summary · outbound links) WITHOUT their content. The
  // model reads what it needs via read_context. Summaries are the A2 AI overlay when present.
  async function buildSkillManifestBlock(skill, actor = null, opts = {}) {
    // Deprecated/low-quality skill: the aviso leads the paged block too (parity with inline).
    const avisoSkill = (await deprecationNotice(skill)) || (await qualityNotice(skill));
    const header = `${avisoSkill ? `[${avisoSkill}]\n\n` : ''}### ${skill.nome} (${skill.id}) — v${skill.version} · ${skill.status}\nObjetivo: ${skill.objetivo || '—'}\nEscopo: ${skill.escopo || '—'}`;
    let body = '';
    try {
      body = parseFrontmatter(String(skill.sourceText || '')).body.trim();
    } catch (error) {
      body = String(skill.sourceText || '').trim();
    }
    const spine = body.length > 24000 ? `${body.slice(0, 24000)}\n\n[...SKILL.md truncado...]` : body;
    let manifest;
    try {
      manifest = await skillContextManifest(skill);
    } catch (error) {
      manifest = { files: [], skipped: [] };
    }
    const fileLines = manifest.files.map((f) => {
      const links =
        f.links && f.links.length
          ? ` · liga: ${f.links
              .map((l) => (l.scope === 'within' ? `${skill.id}/${l.path}` : l.path))
              .slice(0, 8)
              .join(', ')}`
          : '';
      return `- ${skill.id}/${f.path} [${f.kind}, ${formatBytesServer(f.bytes)}] — ${f.summary || '(sem resumo)'}${links}`;
    });
    const skippedLines = (manifest.skipped || []).map((s) => `- ${skill.id}/${s.path} — ${s.reason}`);
    let block = `${header}\n\n#### SKILL.md\n${spine}\n\n#### Arquivos de contexto (leia sob demanda com read_context — o conteúdo NÃO está aqui)\n${fileLines.join('\n') || '(nenhum)'}`;
    if (skippedLines.length) block += `\n\n#### Não incluídos como texto\n${skippedLines.join('\n')}`;
    // Temporal series (Linha do tempo): list every episode of the linked series so the model
    // can read ANY period on demand via read_context (episodes are normal commons/ paths).
    try {
      const { series } = await resolveLinkedCapsules(skill, actor);
      for (const s of series) {
        block += `\n\n#### Série ${s.key} — episódios (leia com read_context)\n${s.episodes.map((e) => `- commons/${e.id}${e.periodo ? ` (${e.periodo})` : ''}`).join('\n')}`;
      }
    } catch (error) {
      /* series manifest is best-effort */
    }
    // Ontologia do domínio: paged mode still carries the definitions INLINE — the vocabulary is
    // the small, always-on layer answers should use (re-readable via read_context if truncated).
    try {
      const ontoDomain = String(skill.domain || String(skill.id || '').split('/')[0] || '');
      const seenOnto = (opts && opts.seenOntologyDomains) || null;
      if (ontoDomain && !(seenOnto && seenOnto.has(ontoDomain))) {
        const onto = await domainOntologyFor(ontoDomain, actor);
        if (onto) {
          let content = '';
          try {
            content = await readCommonsConceptForContext(onto.id);
          } catch (error) {
            content = '';
          }
          if (content) {
            if (seenOnto) seenOnto.add(ontoDomain);
            const capped =
              content.length > 6000
                ? `${content.slice(0, 6000)}\n\n[...ontologia truncada — leia commons/${onto.id} com read_context...]`
                : content;
            block += `\n\n#### Definições do domínio ${ontoDomain} — commons/${onto.id} (ontologia: vocabulário canônico e sinônimos aceitos; use estes termos nas respostas)\n${capped}`;
          }
        }
      }
    } catch (error) {
      /* ontology block is best-effort */
    }
    return block;
  }

  // PAGED system prompt: base intro + per-skill manifest blocks + tool instructions. Returns
  // { system, skills } (the resolved skill objects, for the tool executor). Mirrors the buddy
  // suffix from the inline prompt so persona still applies.
  async function chatSystemPromptPaged(skillIds, actor = null) {
    const orgSeg = process.env.BALDE_ORG_NAME ? ` da equipe ${process.env.BALDE_ORG_NAME}` : '';
    const base = `Você é o assistente do Balde, a base de conhecimento de skills de IA${orgSeg}. Converse em português (pt-BR), de forma clara e objetiva. Quando o usuário trouxer conhecimento novo que deveria atualizar uma skill, ajude a redigir esse conteúdo e ofereça enviá-lo à fila de curadoria com a ferramenta contribute_to_queue — mostre o texto final, peça confirmação explícita e SÓ ENTÃO chame a ferramenta (nunca envie sem o usuário confirmar).`;
    const ids = Array.isArray(skillIds) ? skillIds : [];
    const skills = await loadSkillsFromDisk();
    const selected = ids.map((id) => skills.find((s) => s.id === id)).filter(Boolean);
    const blocks = [];
    const seenOntologyDomains = new Set(); // one ontology inline per domain across the prompt
    for (const skill of selected) blocks.push(await buildSkillManifestBlock(skill, actor, { seenOntologyDomains }));
    const example = selected[0] ? `${selected[0].id}/references/base.md` : 'skill-id/references/base.md';
    let prompt = `${base}\n\nO usuário selecionou estas skills como contexto. Para cada skill abaixo você tem o SKILL.md completo e um ÍNDICE dos arquivos de contexto (com resumo) — mas NÃO o conteúdo deles. Use as ferramentas para ler o que precisar antes de responder:\n- list_context: (re)lista o índice de arquivos disponíveis, incluindo conceitos de outras skills e do commons ligados por link.\n- read_context: lê o conteúdo COMPLETO de um arquivo pelo caminho do corpus (ex.: "${example}" ou "commons/pasta/arquivo.md").\nLeia os arquivos relevantes antes de responder e baseie-se apenas no que leu; não invente conteúdo que não está nos arquivos. Se algo estiver fora do que essas skills cobrem, diga isso.\n\n${blocks.join('\n\n---\n\n')}`;
    // Item 3: aviso de depreciação/qualidade presente → o modelo avisa o usuário PRIMEIRO.
    if (/DEPRECIAD|qualidade BAIXO/i.test(prompt)) prompt += AVISO_FIRST_NOTE;
    prompt += CORPUS_PRESENT_NOTE;
    const buddy = await resolveChatBuddy(ids, skills);
    if (buddy) prompt += buddyPromptSuffix(buddy);
    return { system: prompt, skills: selected };
  }

  // Build the list_context/read_context tools + their in-process executor for a chat's skills.
  // `reads` accumulates the corpus paths actually read (provenance → the message's `sources`).
  // `actor` (the person the buddy answers for) gates cross-skill/commons reads: restricted
  // nodes answer with the same "unknown path" error, so their existence never leaks in chat.
  async function makeChatContextTools(skillIds, actor = null) {
    const ids = Array.isArray(skillIds) ? skillIds : [];
    const skills = await loadSkillsFromDisk();
    const selected = ids.map((id) => skills.find((s) => s.id === id)).filter(Boolean);
    // Draft-aware within-skill file map: both "<id>/<rel>" and bare "<rel>" resolve; SKILL.md
    // served from in-memory sourceText. First skill wins a bare-rel collision.
    const fileMap = new Map();
    for (const skill of selected) {
      let discovered = { textFiles: [] };
      try {
        discovered = await discoverSkillContextFiles(skill);
      } catch (error) {
        discovered = { textFiles: [] };
      }
      for (const f of discovered.textFiles) {
        const corpusPath = `${skill.id}/${f.rel}`;
        fileMap.set(corpusPath, { full: f.full, corpusPath });
        if (!fileMap.has(f.rel)) fileMap.set(f.rel, { full: f.full, corpusPath });
      }
      fileMap.set(`${skill.id}/SKILL.md`, {
        inline: String(skill.sourceText || ''),
        corpusPath: `${skill.id}/SKILL.md`
      });
    }
    const reads = [];
    const tools = [
      {
        name: 'list_context',
        description:
          'Lista o índice de arquivos de contexto das skills selecionadas (caminho no corpus, tipo, tamanho, resumo e links para conceitos de outras skills/commons). Use para descobrir o que existe antes de ler.',
        input_schema: { type: 'object', properties: {}, additionalProperties: false }
      },
      {
        name: 'read_context',
        description:
          'Lê o conteúdo COMPLETO de UM arquivo de contexto pelo caminho no corpus (ex.: "skill-id/references/base.md" ou "commons/pasta/arquivo.md"). Retorna o texto do arquivo.',
        input_schema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Caminho do arquivo no corpus.' } },
          required: ['path'],
          additionalProperties: false
        }
      }
    ];
    async function execList() {
      const out = [];
      for (const skill of selected) {
        let m;
        try {
          m = await skillContextManifest(skill);
        } catch (error) {
          m = { files: [], skipped: [] };
        }
        out.push({
          skill: skill.id,
          nome: skill.nome,
          files: m.files.map((f) => ({
            path: `${skill.id}/${f.path}`,
            kind: f.kind,
            bytes: f.bytes,
            summary: f.summary,
            links: (f.links || []).map((l) => (l.scope === 'within' ? `${skill.id}/${l.path}` : l.path))
          })),
          skipped: (m.skipped || []).map((x) => ({ path: `${skill.id}/${x.path}`, reason: x.reason }))
        });
      }
      return JSON.stringify({ skills: out });
    }
    async function execRead(input) {
      let p = String((input && input.path) || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .trim();
      if (!p) return 'ERRO: informe o parâmetro "path".';
      if (p.includes('..')) return 'ERRO: caminho inválido.';
      // R2: cross-repo read — "@<repo>/<corpus path>". Target-repo membership + the target
      // artifact's own ACL, both as the reader; the read runs in the target repo's context.
      const xrm = /^@([a-z0-9][a-z0-9-]{1,30})\/(.+)$/.exec(p);
      if (xrm && xrm[1] !== activeRepo()) {
        if (actor && !(await actorMemberOfRepo(xrm[1], actor))) {
          return `ERRO: "${p}" não é um arquivo de contexto conhecido. Use list_context para ver os caminhos válidos.`;
        }
        // _noInline: the fileMap belongs to the ORIGIN repo — never let a same-named path
        // in it shadow the target repo's file on the recursive read.
        return runWithRepo(xrm[1], () => execRead({ ...input, path: xrm[2], _noInline: true }));
      }
      if (xrm) p = xrm[2]; // same-repo qualified path — strip the prefix
      const hit = input && input._noInline ? undefined : fileMap.get(p);
      let full = null;
      let corpusPath = p;
      let content = null;
      if (hit) {
        corpusPath = hit.corpusPath;
        if (hit.inline != null) content = hit.inline;
        else full = hit.full;
      } else {
        const idx = await corpusNodeIndex();
        if (!idx.has(p))
          return `ERRO: "${p}" não é um arquivo de contexto conhecido. Use list_context para ver os caminhos válidos.`;
        if (actor) {
          if (p.startsWith('commons/')) {
            const concept = await commonsConceptOfPath(p.slice('commons/'.length));
            if (concept && !(await canReadCommonsActor(concept, actor)))
              return `ERRO: "${p}" não é um arquivo de contexto conhecido. Use list_context para ver os caminhos válidos.`;
          } else {
            const owner = skillIdOfCorpusPath(p, idx);
            if (owner && !(await canReadSkillActor(owner, actor)))
              return `ERRO: "${p}" não é um arquivo de contexto conhecido. Use list_context para ver os caminhos válidos.`;
          }
        }
        full = await resolveCorpusNodeFull(p);
        if (!full) return `ERRO: não foi possível resolver "${p}".`;
      }
      if (content == null) {
        try {
          content = await readFile(full, 'utf8');
        } catch (error) {
          return `ERRO: não foi possível ler "${corpusPath}".`;
        }
      }
      if (!reads.includes(corpusPath)) reads.push(corpusPath);
      let text = content;
      // Phase 2: a commons concept's AI-described media (img/ + data/) becomes context.
      if (corpusPath.startsWith('commons/')) {
        try {
          text += mediaContextBlock(
            await conceptMediaEntries(join(commonsRoot(), corpusPath.slice('commons/'.length))),
            corpusPath
          );
        } catch (error) {
          /* no media */
        }
        // Deprecated capsule → the aviso rides the read so the tool loop sees the flag too.
        try {
          const concept = await commonsConceptOfPath(corpusPath.slice('commons/'.length));
          const aviso = concept ? await capsuleAvisoText(concept) : '';
          if (aviso) text = `${aviso}\n\n${text}`;
        } catch (error) {
          /* aviso is best-effort */
        }
      }
      let truncated = false;
      if (text.length > CHAT_TOOL_READ_MAX_CHARS) {
        text = text.slice(0, CHAT_TOOL_READ_MAX_CHARS);
        truncated = true;
      }
      return `# ${corpusPath}\n\n${text}${truncated ? '\n\n[...truncado por limite de contexto; peça um trecho específico se precisar de mais...]' : ''}`;
    }
    async function execute(name, input) {
      if (name === 'list_context') return execList();
      if (name === 'read_context') return execRead(input);
      return `ERRO: ferramenta desconhecida "${name}".`;
    }
    return { tools, execute, reads };
  }

  // The chat/plenária twin of the MCP balde_contribute_context tool: the buddy can send
  // a user-CONFIRMED contribution (suggestion, correction, new info) to the curation
  // queue. Nothing changes directly — a human curator reviews (same createQueueItem path
  // as the web modal and /api/v1/queue). `actor` = the person talking (chat owner; in a
  // plenária, whoever triggered the buddy) — they are recorded as the submitter.
  function makeContributeTool(actor) {
    const tool = {
      name: 'contribute_to_queue',
      description:
        'Envia uma contribuição (sugestão, correção ou informação nova) para a FILA DE CURADORIA de uma skill existente. Nada é alterado diretamente — um curador humano revisa e faz o merge. Use SOMENTE depois de mostrar o texto final ao usuário e ele confirmar explicitamente o envio. skill_id é o id completo da skill (ex.: "dominio/skill"), normalmente uma skill do contexto desta conversa.',
      input_schema: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'Id da skill existente que recebe a contribuição.' },
          content: { type: 'string', description: 'O conteúdo da contribuição (texto ou markdown).' },
          title: { type: 'string', description: 'Título curto opcional.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags opcionais.' }
        },
        required: ['skill_id', 'content'],
        additionalProperties: false
      }
    };
    async function execute(input) {
      const skillId = String((input && input.skill_id) || '').trim();
      const content = String((input && input.content) || '').trim();
      if (!skillId || !content) {
        return 'ERRO: informe skill_id e content.';
      }
      if (!(await canReadSkillActor(skillId, actor))) {
        return `ERRO: skill "${skillId}" não encontrada.`;
      } // don't leak restricted skills
      try {
        const item = await createQueueItem({
          skillId,
          title: input.title,
          content,
          tags: input.tags,
          source: 'chat',
          submittedBy: { name: actor.name, email: actor.email }
        });
        recordSkillEvent('contribute', item.skillId, 'app', actor);
        return JSON.stringify({
          ok: true,
          id: item.id,
          status: item.status,
          skillId: item.skillId,
          message: 'Contribuição enviada para a fila de curadoria. Um curador humano vai revisar.'
        });
      } catch (error) {
        return `ERRO: ${error.message}`;
      }
    }
    return { tool, execute };
  }

  // Attach the contribute tool to a conversation's toolset. `toolset` may be null
  // (inline grounding mode has no context tools) — the result always has the
  // {tools, execute, reads} shape, so every AI call site can use the tool loop.
  // Search the corpus for DOWNLOADABLE attachments (the files/ sidecar). ONE implementation
  // shared by the chat/plenária buddy tool, the machine API (GET /api/v1/files) and therefore
  // MCP — so every surface finds exactly the same files under exactly the same ACL.
  // `skillIds` (optional) are searched first (a conversation's own context skills); commons
  // capsules are always searched. Restricted capsules/skills the actor can't read are invisible.
  // Returns { found, files: [{ path, name, size, kind, id, url, webUrl }] } — `path` is the
  // corpus path (`<skill-id>/files/<name>` or `commons/<capsule>/files/<name>`), `url` is the
  // machine (Bearer) download route and `webUrl` the SSO one a human can open in a browser.
  async function searchCorpusFileAssets(query, actor, { skillIds = [], limit = 20, allSkills = false } = {}) {
    const norm = (s) =>
      String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
    const raw = norm(query).trim();
    if (!raw) {
      return { error: 'informe "query".', found: 0, files: [] };
    }
    const tokens = raw.split(/[\s_/,-]+/).filter(Boolean);
    const hit = (hay) => tokens.every((t) => hay.includes(t));
    const found = [];
    // (a) skill attachments. A conversation passes its context skills (a link to a skill
    // outside the context couldn't be served anyway); the machine API passes allSkills so an
    // MCP agent — which has no conversation — can still find a file attached to any skill.
    let skillScope = Array.isArray(skillIds) ? skillIds : [];
    if (allSkills) {
      try {
        skillScope = (await loadSkillsFromDisk()).map((s) => s.id);
      } catch (error) {
        /* keep the given scope */
      }
    }
    for (const sid of skillScope) {
      const dir = join(skillsRoot(), sid, 'files');
      let names = [];
      try {
        names = await listAssetFiles(dir);
      } catch (error) {
        names = [];
      }
      const matches = names.filter((n) => hit(norm(`${sid} ${n}`)));
      if (!matches.length) continue;
      if (!(await canReadSkillActor(sid, actor))) continue; // restricted → invisible
      for (const n of matches) {
        found.push({
          path: `${sid}/files/${n}`,
          name: n,
          full: join(dir, n),
          kind: 'skill',
          id: sid,
          url: skillFileAssetV1Url(sid, n),
          webUrl: skillFileAssetWebUrl(sid, n, activeRepo())
        });
      }
    }
    // (b) commons capsules — match first, ACL only on matches (keeps hundreds of dirs cheap)
    let ids = [];
    try {
      ids = await listCommonsConcepts();
    } catch (error) {
      ids = [];
    }
    for (const cid of ids) {
      const dir = join(commonsRoot(), cid, 'files');
      let names = [];
      try {
        names = await listAssetFiles(dir);
      } catch (error) {
        names = [];
      }
      if (!names.length) continue;
      const matches = names.filter((n) => hit(norm(`${cid} ${n}`)));
      if (!matches.length) continue;
      if (!(await canReadCommonsActor(cid, actor))) continue; // restricted → invisible
      for (const n of matches) {
        found.push({
          path: `commons/${cid}/files/${n}`,
          name: n,
          full: join(dir, n),
          kind: 'capsule',
          id: cid,
          url: commonsFileAssetV1Url(cid, n),
          webUrl: commonsFileAssetWebUrl(cid, n, activeRepo())
        });
      }
    }
    const files = [];
    for (const f of found.slice(0, Math.max(1, Number(limit) || 20))) {
      let size = 0;
      try {
        size = (await stat(f.full)).size;
      } catch (error) {
        size = 0;
      }
      files.push({ path: f.path, name: f.name, size, kind: f.kind, id: f.id, url: f.url, webUrl: f.webUrl });
    }
    return { found: found.length, files };
  }

  // A domain can hold hundreds of capsules that each carry one PDF (255 propostas today), so
  // the attachments can NEVER all fit in the prompt and the model must not guess paths. This
  // tool searches by name/id and returns the EXACT corpus path to offer with `corpus:`.
  // ACL-aware: a restricted capsule the actor can't read is invisible (never even counted).
  function makeFindCorpusFilesTool(actor, skillIds) {
    const tool = {
      name: 'find_corpus_files',
      description:
        'Procura ARQUIVOS ANEXOS (o sidecar files/: PDFs, planilhas, zips) nas cápsulas do commons e nas skills de contexto. Use SEMPRE que o usuário pedir um documento/PDF/anexo (ex.: "a proposta de adesão do plano 40812") ANTES de dizer que não existe — o índice de contexto NÃO lista esses arquivos. Retorna o caminho exato para oferecer com [nome](corpus:CAMINHO).',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Termos de busca: código do plano, nome do documento ou parte do id da cápsula (ex.: "40812", "proposta completo").'
          }
        },
        required: ['query'],
        additionalProperties: false
      }
    };
    async function execute(input) {
      const r = await searchCorpusFileAssets(input && input.query, actor, { skillIds });
      if (r.error) {
        return `ERRO: ${r.error}`;
      }
      if (!r.found) {
        return JSON.stringify({
          found: 0,
          files: [],
          hint: 'Nenhum anexo corresponde a esses termos. Tente outro termo (código do plano, nome do arquivo) antes de afirmar que não existe.'
        });
      }
      return JSON.stringify({
        found: r.found,
        showing: r.files.length,
        files: r.files.map((f) => ({ path: f.path, name: f.name, size: f.size })),
        howToOffer: 'Ofereça ao usuário escrevendo [nome](corpus:CAMINHO), copiando exatamente o campo "path".'
      });
    }
    return { tool, execute };
  }

  // Attach the buddy's conversation-level tools — contribute_to_queue (send to the curation
  // queue) and find_corpus_files (locate an attachment) — to a conversation's toolset.
  // `toolset` may be null (inline grounding has no context tools); the result always has the
  // {tools, execute, reads} shape so every AI call site can run the tool loop.
  function withContributeTool(toolset, actor, skillIds) {
    const extras = [makeContributeTool(actor), makeFindCorpusFilesTool(actor, skillIds)];
    const dispatch = (name, input, fallback) => {
      const t = extras.find((e) => e.tool.name === name);
      return t ? t.execute(input) : fallback(name, input);
    };
    if (!toolset) {
      return {
        tools: extras.map((e) => e.tool),
        execute: (name, input) => dispatch(name, input, (n) => `ERRO: ferramenta desconhecida "${n}".`),
        reads: []
      };
    }
    return {
      ...toolset, // preserve composer extras (e.g. run_sql's adhocRuns) through the wrap
      tools: [...toolset.tools, ...extras.map((e) => e.tool)],
      execute: (name, input) => dispatch(name, input, (n, i) => toolset.execute(n, i)),
      reads: toolset.reads
    };
  }

  // Same guarantees as the web "Executar" and /api/v1 query-run: only stored, git-versioned
  // query files run (never SQL the model wrote), datasets load per the actor's ACLs, the
  // sandbox is locked (no filesystem/network), results are capped. The executed .sql path
  // goes into `reads`, so query runs show up in the message's sources like any other ground.

  // Advertised only when a selected (actor-readable) skill actually ships a .sql — returns
  // null otherwise, so chats without queries never carry a dead tool in the prompt.
  async function makeRunQueryTool(skillIds, actor = null) {
    const ids = Array.isArray(skillIds) ? skillIds : [];
    const sqlMap = new Map(); // "<id>/<rel>" and bare "<rel>" → { skillId, rel }; first skill wins a bare collision
    const known = [];
    for (const skillId of ids) {
      if (actor && !(await canReadSkillActor(skillId, actor))) continue;
      let working;
      try {
        working = await loadSkillConsumerContext(skillId);
      } catch (error) {
        continue;
      }
      for (const rel0 of working.files || []) {
        const rel = rel0.replaceAll('\\', '/');
        if (!rel.toLowerCase().endsWith('.sql') || isGovernancePath(rel)) continue;
        const corpusPath = `${skillId}/${rel}`;
        sqlMap.set(corpusPath, { skillId, rel });
        if (!sqlMap.has(rel)) sqlMap.set(rel, { skillId, rel });
        known.push(corpusPath);
      }
    }
    if (!known.length) return null;
    const advertised =
      known.length > 12 ? `${known.slice(0, 12).join(', ')} (e mais ${known.length - 12})` : known.join(', ');
    const tool = {
      name: 'run_query',
      description: `Executa uma query GOVERNADA (arquivo .sql versionado de uma skill — nunca SQL escrito por você) num sandbox DuckDB efêmero sobre os datasets da skill (analytics/ + data/) e das cápsulas vinculadas (data/). Cada dataset vira uma tabela nomeada pelo arquivo (base.parquet → tabela base); a ÚLTIMA SELECT do arquivo é o resultado. Use para responder com números REAIS em vez de estimar. Queries disponíveis: ${advertised}.`,
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho da query no corpus (ex.: "skill-id/query/analise.sql").' }
        },
        required: ['path'],
        additionalProperties: false
      }
    };
    async function execute(input, reads) {
      const p = String((input && input.path) || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .trim();
      const hit = p && !p.includes('..') ? sqlMap.get(p) : null;
      if (!hit) return `ERRO: "${p}" não é uma query conhecida. Disponíveis: ${known.join(', ')}.`;
      let working;
      try {
        working = await loadSkillConsumerContext(hit.skillId);
      } catch (error) {
        return `ERRO: skill "${hit.skillId}" indisponível.`;
      }
      const draftAbs = join(working.draftDir, hit.rel);
      const abs = (await pathExists(draftAbs)) ? draftAbs : join(working.sourceDir, hit.rel);
      let sql = '';
      try {
        sql = await readFile(abs, 'utf8');
      } catch (error) {
        return `ERRO: não foi possível ler "${p}".`;
      }
      const ds = await skillQueryDatasets(hit.skillId, actor);
      if (ds.overLimit)
        return `ERRO: os datasets da skill somam ${formatBytesServer(ds.totalBytes)} — acima do limite de execução.`;
      const result = await runGovernedQuery(ds.datasets, sql);
      const corpusPath = `${hit.skillId}/${hit.rel}`;
      if (reads && !reads.includes(corpusPath)) reads.push(corpusPath);
      recordSkillEvent('consume', hit.skillId, 'app', actor);
      if (!result.ok)
        return `ERRO na execução de ${corpusPath}: ${result.error}\nTabelas disponíveis no sandbox: ${ds.datasets.map((d) => d.table).join(', ') || '(nenhuma)'}.`;
      const payload = {
        ok: true,
        sql: corpusPath,
        columns: result.columns,
        rowCount: result.rowCount,
        truncated: result.truncated,
        elapsedMs: result.elapsedMs,
        datasets: ds.datasets.map((d) => ({ table: d.table, source: d.source })),
        rows: result.rows
      };
      let shown = payload.rows.length;
      let text = JSON.stringify(payload);
      while (text.length > CHAT_TOOL_READ_MAX_CHARS && shown > 1) {
        shown = Math.floor(shown / 2);
        text = JSON.stringify({
          ...payload,
          rows: payload.rows.slice(0, shown),
          rowsShown: shown,
          note: `Mostrando ${shown} de ${payload.rowCount} linhas (limite de contexto do chat).`
        });
      }
      return text;
    }
    return { tool, execute };
  }

  // Attach run_query to a conversation's toolset (both grounding modes — inline chats on
  // small skills are a prime case). `toolset` may be null; stays null when no query exists.
  async function withRunQueryTool(toolset, skillIds, actor) {
    const q = await makeRunQueryTool(skillIds, actor);
    if (!q) return toolset;
    const base = toolset || { tools: [], execute: (name) => `ERRO: ferramenta desconhecida "${name}".`, reads: [] };
    return {
      tools: [...base.tools, q.tool],
      execute: (name, input) => (name === q.tool.name ? q.execute(input, base.reads) : base.execute(name, input)),
      reads: base.reads
    };
  }

  // Ordering law: governed query first; only when none covers the question may the buddy
  // compose SQL. The sandbox makes this SAFE (materialized tables + external-access lock +
  // config lock + kill/caps) — what it can't make is TRUSTED, so every ad-hoc answer is
  // stamped "não governado" in the UI, and the turn's final query auto-drafts to the
  // curation queue: approval writes it as query/<slug>.sql (canon). Curators opt a skill
  // out with `adhoc_sql: false` in the SKILL.md frontmatter (trap-laden data).

  async function makeRunSqlTool(skillIds, actor = null) {
    const ids = Array.isArray(skillIds) ? skillIds : [];
    const bySkill = new Map(); // skillId → skillQueryDatasets result (composer-time snapshot)
    const lines = [];
    for (const skillId of ids) {
      if (actor && !(await canReadSkillActor(skillId, actor))) continue;
      let working;
      try {
        working = await loadSkillConsumerContext(skillId);
      } catch (error) {
        continue;
      }
      // Curator kill-switch: frontmatter `adhoc_sql: false` keeps AI-written SQL out of this skill.
      if (working.meta && String(working.meta.adhoc_sql).trim().toLowerCase() === 'false') continue;
      let ds;
      try {
        ds = await skillQueryDatasets(skillId, actor);
      } catch (error) {
        continue;
      }
      if (!ds.datasets.length || ds.overLimit) continue;
      bySkill.set(skillId, ds);
      lines.push(`${skillId}: ${ds.datasets.map((d) => `${d.table} (${d.source})`).join(', ')}`);
    }
    if (!bySkill.size) return null;
    const tool = {
      name: 'run_sql',
      description: `Executa SQL escrita POR VOCÊ (DuckDB) num sandbox efêmero sobre os datasets governados da skill — use SOMENTE quando nenhuma query governada (run_query) cobre a pergunta. O resultado é marcado como NÃO GOVERNADO e a consulta final vira rascunho para o curador aprovar. Você pode explorar antes (ex.: "describe tabela", "select * from tabela limit 5"). Tabelas disponíveis — ${lines.join(' · ')}.`,
      input_schema: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: `Skill dona dos datasets (${[...bySkill.keys()].join(', ')}).` },
          sql: { type: 'string', description: 'A SQL a executar. A última SELECT é o resultado.' },
          titulo: {
            type: 'string',
            description:
              'Título curto kebab-case para a consulta FINAL (vira o nome do rascunho, ex.: "reunioes-por-area").'
          }
        },
        required: ['sql'],
        additionalProperties: false
      }
    };
    async function execute(input, runs) {
      const asked = String((input && input.skill_id) || '').trim();
      const sid = bySkill.has(asked) ? asked : bySkill.size === 1 ? [...bySkill.keys()][0] : null;
      if (!sid) return `ERRO: informe skill_id (${[...bySkill.keys()].join(', ')}).`;
      const sql = String((input && input.sql) || '').trim();
      if (!sql) return 'ERRO: informe sql.';
      if (sql.length > 20000) return 'ERRO: SQL muito longa (máx. 20000 caracteres).';
      const ds = bySkill.get(sid);
      const result = await runGovernedQuery(ds.datasets, sql);
      recordSkillEvent('consume', sid, 'app', actor);
      if (!result.ok)
        return `ERRO na execução: ${result.error}\nTabelas disponíveis no sandbox: ${ds.datasets.map((d) => d.table).join(', ') || '(nenhuma)'}.`;
      if (runs)
        runs.push({
          skillId: sid,
          sql,
          titulo: String((input && input.titulo) || '')
            .trim()
            .slice(0, 80)
        });
      const payload = {
        ok: true,
        governed: false,
        aviso: 'Consulta GERADA POR IA (não governada) — informe isso ao usuário e declare as premissas assumidas.',
        columns: result.columns,
        rowCount: result.rowCount,
        truncated: result.truncated,
        elapsedMs: result.elapsedMs,
        datasets: ds.datasets.map((d) => ({ table: d.table, source: d.source })),
        rows: result.rows
      };
      let shown = payload.rows.length;
      let text = JSON.stringify(payload);
      while (text.length > CHAT_TOOL_READ_MAX_CHARS && shown > 1) {
        shown = Math.floor(shown / 2);
        text = JSON.stringify({
          ...payload,
          rows: payload.rows.slice(0, shown),
          rowsShown: shown,
          note: `Mostrando ${shown} de ${payload.rowCount} linhas (limite de contexto do chat).`
        });
      }
      return text;
    }
    return { tool, execute };
  }

  // Attach run_sql to a conversation's toolset. `toolset.adhocRuns` accumulates the turn's
  // successful AI-written queries — the chat handlers stamp the message and draft the last one.
  async function withRunSqlTool(toolset, skillIds, actor) {
    const q = await makeRunSqlTool(skillIds, actor);
    if (!q) return toolset;
    const base = toolset || { tools: [], execute: (name) => `ERRO: ferramenta desconhecida "${name}".`, reads: [] };
    const adhocRuns = base.adhocRuns || [];
    return {
      ...base,
      tools: [...base.tools, q.tool],
      execute: (name, input) => (name === q.tool.name ? q.execute(input, adhocRuns) : base.execute(name, input)),
      reads: base.reads,
      adhocRuns
    };
  }

  function slugifyQueryTitle(raw) {
    return String(raw || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  // One curator draft per answered question (Vitti's step 3): the FINAL successful run_sql
  // of a turn becomes a pendente queue item (type 'query'); approval writes query/<slug>.sql
  // into the skill and commits (step 4 — canon). Deduped by normalized-SQL hash against
  // pending drafts of the same skill; formatted once via identar (river style), fail-open.
  async function createQueryDraftItem({ skillId, titulo, sql, submittedBy }) {
    const text = String(sql || '').trim();
    if (!text || text.length > 20000) return null;
    if (!(await skillExistsById(skillId))) return null;
    const hash = createHash('sha1').update(text.replace(/\s+/g, ' ').toLowerCase()).digest('hex').slice(0, 12);
    try {
      const dup = (await listQueueItems()).find(
        (i) =>
          i &&
          i.type === 'query' &&
          i.skillId === skillId &&
          i.status === 'pendente' &&
          i.query &&
          i.query.hash === hash
      );
      if (dup) return dup;
    } catch (error) {
      /* listing failure never blocks the draft */
    }
    let formatted = text;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const r = await fetch(SQL_FORMATTER_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sql: text, options: { useTabs: false, keywordCase: 'lower', where11: true } }),
          signal: controller.signal
        });
        const data = r.ok ? await r.json().catch(() => null) : null;
        if (data && typeof data.formatted === 'string' && data.formatted.trim()) formatted = data.formatted;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      /* identar down → raw SQL */
    }
    const slug = slugifyQueryTitle(titulo) || `consulta-ia-${hash.slice(0, 6)}`;
    const id = newQueueId();
    const dir = queueDir(id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'content.md'), formatted.endsWith('\n') ? formatted : `${formatted}\n`, 'utf8');
    const now = new Date().toISOString();
    const meta = {
      id,
      type: 'query',
      skillId,
      originalSkillId: skillId,
      title: `Query IA: ${slug}`,
      tags: ['sql'],
      source: 'chat',
      submittedBy: {
        name: String(submittedBy?.name || 'anônimo').slice(0, 120),
        email: String(submittedBy?.email || '').slice(0, 160)
      },
      status: 'pendente',
      contentChars: formatted.length,
      preview: formatted.slice(0, QUEUE_PREVIEW_CHARS),
      files: [],
      ai: null,
      review: null,
      createdAt: now,
      updatedAt: now,
      query: { path: `query/${slug}.sql`, hash }
    };
    await writeQueueMeta(meta);
    await sealSubmission(dir, meta);
    return meta;
  }

  // Post-turn: stamp the assistant message with the AI-written SQL it used (UI badge +
  // transcript-level reproducibility) and draft the turn's FINAL query for the curator.
  // Bare exploration (describe/show/summarize/…) answers the model, not the corpus — skipped.
  // Idempotent per toolset (stream paths persist partial then final messages).
  async function attachAdhocSql(msg, toolset, actor) {
    const runs = (toolset && toolset.adhocRuns) || [];
    if (!runs.length) return;
    msg.adhocSql = runs.map((r) => ({ skill: r.skillId, titulo: r.titulo || '', sql: r.sql }));
    if (toolset._adhocDrafted) {
      if (toolset._adhocDrafted.queueId) {
        const lastEntry = msg.adhocSql[msg.adhocSql.length - 1];
        lastEntry.queueId = toolset._adhocDrafted.queueId;
        lastEntry.proposedPath = toolset._adhocDrafted.proposedPath;
      }
      return;
    }
    toolset._adhocDrafted = {};
    const last = runs[runs.length - 1];
    if (/^\s*(describe|show|summarize|pragma|explain)\b/i.test(last.sql)) return;
    try {
      const item = await createQueryDraftItem({
        skillId: last.skillId,
        titulo: last.titulo,
        sql: last.sql,
        submittedBy: { name: actor?.name, email: actor?.email }
      });
      if (item) {
        toolset._adhocDrafted = { queueId: item.id, proposedPath: item.query && item.query.path };
        const lastEntry = msg.adhocSql[msg.adhocSql.length - 1];
        lastEntry.queueId = item.id;
        lastEntry.proposedPath = item.query && item.query.path;
        recordSkillEvent('contribute', last.skillId, 'app', actor);
      }
    } catch (error) {
      /* draft is best-effort — the answer already shipped */
    }
  }

  return {
    DATASET_EXT_RE,
    skillQueryDatasets,
    chatSystemPrompt,
    resolveChatContextMode,
    resolveCorpusNodeFull,
    chatSystemPromptPaged,
    makeChatContextTools,
    searchCorpusFileAssets,
    withContributeTool,
    withRunQueryTool,
    withRunSqlTool,
    attachAdhocSql
  };
}
