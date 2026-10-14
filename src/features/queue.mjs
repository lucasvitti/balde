import { recordQueueDecision, queueDecisionConflict } from '../governance/queue-decisions.mjs';
import { applyContribution } from '../governance/contribution-apply.mjs';
import { operationKey } from '../governance/operations.mjs';
import { sealSubmission } from '../governance/exchange.mjs';
import { atomicJson } from '../storage/atomic-files.mjs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { assertSafeSkillId, isSafeSkillId, assertSafeUploadName, fileStamp } from '../skill-format.mjs';
import { skillsRoot, queueRoot, activeRepo, DEFAULT_REPO } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';

import { callAiWithConfig, callAiWithSystemPrompt } from '../ai-provider.mjs';

export function createQueueFeature({
  submissionRoot,
  emitNotifyContribution,
  pushLocalNotice,
  loadSkillsFromDisk,
  commitCorpus,
  loadSkillWorkingContext,
  linkedCapsuleIds,
  commonsConceptContextPath
}) {
  const QUEUE_MAX_CONTENT = Number(process.env.QUEUE_MAX_CONTENT || 1000000);
  const QUEUE_MAX_FILES = Number(process.env.QUEUE_MAX_FILES || 10);
  const QUEUE_MAX_FILE_BYTES = Number(process.env.QUEUE_MAX_FILE_BYTES || 15 * 1024 * 1024);
  const QUEUE_MAX_TOTAL_FILE_BYTES = Number(process.env.QUEUE_MAX_TOTAL_FILE_BYTES || 40 * 1024 * 1024);
  const QUEUE_MAX_BODY = QUEUE_MAX_TOTAL_FILE_BYTES + 24 * 1024 * 1024; // base64 overhead + text
  const QUEUE_PREVIEW_CHARS = 400;
  const QUEUE_AI_WINDOW = Number(process.env.QUEUE_AI_WINDOW || 40000);

  function assertSafeQueueId(id) {
    if (!/^[a-zA-Z0-9._-]+$/.test(String(id || ''))) {
      throw new Error('id de item de fila invalido');
    }
  }

  function queueDir(id) {
    assertSafeQueueId(id);
    return join(queueRoot(), id);
  }

  function newQueueId() {
    return `q-${fileStamp()}-${randomBytes(3).toString('hex')}`;
  }

  async function skillExistsById(id) {
    return isSafeSkillId(id) && pathExists(join(skillsRoot(), id, 'SKILL.md'));
  }

  // Load one item. withContent=false → metadata only (for the list, cheap). withContent=true
  // → also read content.md + the ai-cleaned.md sidecar (for the detail). Handles both the
  // folder form and the legacy flat form (queueRoot/<id>.json, content inline).
  async function loadQueueItem(id, { withContent = false, root = queueRoot() } = {}) {
    try {
      assertSafeQueueId(id);
    } catch (error) {
      return null;
    }
    const folderMetaPath = join(root, id, 'item.json');
    if (await pathExists(folderMetaPath)) {
      let meta;
      try {
        meta = JSON.parse(await readFile(folderMetaPath, 'utf8'));
      } catch (error) {
        return null;
      }
      meta._layout = 'folder';
      if (!Array.isArray(meta.files)) {
        meta.files = [];
      }
      if (withContent) {
        try {
          meta.content = await readFile(join(root, id, 'content.md'), 'utf8');
        } catch (error) {
          meta.content = '';
        }
        if (meta.ai) {
          try {
            meta.ai.cleanedContent = await readFile(join(root, id, 'ai-cleaned.md'), 'utf8');
          } catch (error) {
            meta.ai.cleanedContent = '';
          }
        }
        // Capsule items keep the (possibly large, media-carrying) manifest in its own sidecar so
        // listQueueItems stays light; the full detail loads it here.
        if (meta.type === 'capsule') {
          try {
            meta.capsule = {
              ...(meta.capsule || {}),
              manifest: JSON.parse(await readFile(join(root, id, 'capsule.json'), 'utf8'))
            };
          } catch (error) {
            /* manifest sidecar missing */
          }
        }
      }
      return meta;
    }
    const flatPath = join(root, `${id}.json`);
    if (await pathExists(flatPath)) {
      let obj;
      try {
        obj = JSON.parse(await readFile(flatPath, 'utf8'));
      } catch (error) {
        return null;
      }
      obj._layout = 'flat';
      const text = String(obj.content || '');
      obj.contentChars = text.length;
      obj.preview = text.slice(0, QUEUE_PREVIEW_CHARS);
      obj.files = Array.isArray(obj.files) ? obj.files : [];
      if (withContent) {
        obj.content = text;
      } else {
        delete obj.content;
      }
      return obj;
    }
    return null;
  }

  async function readQueueMeta(id) {
    return loadQueueItem(id, { withContent: false });
  }

  async function readQueueItem(id) {
    return loadQueueItem(id, { withContent: true });
  }

  // Persist mutable metadata (item.json). content.md / files / ai-cleaned.md are written
  // separately. Migrates a legacy flat item to the folder form on first write (carrying its
  // inline content into content.md, then removing the flat file to avoid a shadow duplicate).
  // root: the balde's Fila, or the author's outbox for a new contribution (see submissionRoot).
  async function writeQueueMeta(item, root = queueRoot()) {
    assertSafeQueueId(item.id);
    const dir = join(root, item.id);
    await mkdir(dir, { recursive: true });
    const contentPath = join(dir, 'content.md');
    const flatPath = join(root, `${item.id}.json`);
    if (!(await pathExists(contentPath)) && (await pathExists(flatPath))) {
      try {
        const legacy = JSON.parse(await readFile(flatPath, 'utf8'));
        await writeFile(contentPath, String(legacy.content || ''), 'utf8');
      } catch (error) {
        // if the legacy file is unreadable, leave content.md absent (reads fall back to '')
      }
    }
    const { content, _layout, ...meta } = item;
    if (meta.ai && typeof meta.ai === 'object') {
      // never persist the (possibly large) cleaned text inside item.json — it lives in the sidecar
      const { cleanedContent, ...aiMeta } = meta.ai;
      meta.ai = aiMeta;
    }
    if (meta.capsule && typeof meta.capsule === 'object' && meta.capsule.manifest !== undefined) {
      // capsule.json is the authoritative manifest store — never let a load-with-content-then-save
      // path (decide/reassign/edit) persist the base64-carrying manifest into item.json
      const { manifest, ...capMeta } = meta.capsule;
      meta.capsule = capMeta;
    }
    const metadataPath = join(dir, 'item.json');
    let previous;
    try {
      previous = JSON.parse(await readFile(metadataPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (previous && Number(previous.revision || 0) !== Number(item.revision || 0))
      throw new Error('A contribuição mudou. Recarregue a Fila para revisar a nova versão.');
    if (previous && previous.status !== 'pendente' && previous.status !== meta.status)
      throw new Error('Uma decisão registrada não pode ser substituída.');
    if (await queueDecisionConflict(root, item.id))
      throw new Error('Esta contribuição tem decisões concorrentes; requer reconciliação.');
    meta.revision = Number(previous?.revision || 0) + 1;
    meta.updatedAt = new Date().toISOString();
    await recordQueueDecision(root, meta);
    await atomicJson(metadataPath, meta);
    item.revision = meta.revision;
    if (await pathExists(flatPath)) {
      await rm(flatPath, { force: true });
    }
    item.updatedAt = meta.updatedAt;
    return item;
  }

  // List metadata for every item (no full content). Enumerates both folder items
  // (<id>/item.json) and legacy flat items (<id>.json).
  async function listQueueItems(root = queueRoot()) {
    if (!(await pathExists(root))) {
      return [];
    }
    const entries = await readdir(root, { withFileTypes: true });
    const ids = new Set();
    for (const entry of entries) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue; // skip sidecar stores (e.g. _resolved-feedback.json)
      if (entry.name.endsWith('.imported.json')) continue; // import tombstone (receipt), not a queue item
      if (entry.isDirectory()) {
        ids.add(entry.name);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        ids.add(entry.name.slice(0, -5));
      }
    }
    const items = [];
    for (const id of ids) {
      const meta = await loadQueueItem(id, { root });
      // R2: the Fila is repo-scoped — legacy items without a repo belong to the default repo.
      // meta.id guard: every real item (contribution/capsule) sets it; skipping id-less metas keeps
      // void/orphaned entries (empty item.json, stray markers) out of the Fila even before the sweep.
      if (meta && meta.id && (meta.repo || DEFAULT_REPO) === activeRepo()) {
        const conflict = await queueDecisionConflict(root, id);
        if (conflict) {
          meta.status = 'conflito';
          meta.conflict = conflict;
        }
        items.push(meta);
      }
    }
    items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return items;
  }

  function queueCounts(items) {
    const counts = { pendente: 0, aprovado: 0, recusado: 0 };
    for (const item of items) {
      const status = item.status || 'pendente';
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }

  // Decode + validate one incoming attachment ({name, mime, contentBase64}) into a Buffer.
  function decodeQueueFile(file) {
    const name = assertSafeUploadName(file && file.name);
    const buf = Buffer.from(String((file && file.contentBase64) || ''), 'base64');
    if (!buf.length) {
      throw new Error(`Arquivo "${name}" está vazio ou inválido.`);
    }
    if (buf.length > QUEUE_MAX_FILE_BYTES) {
      throw new Error(`Arquivo "${name}" excede ${Math.round(QUEUE_MAX_FILE_BYTES / (1024 * 1024))} MB.`);
    }
    return { name, mime: String((file && file.mime) || 'application/octet-stream').slice(0, 120), buf };
  }

  // Sanitize + bound a submitted contribution into a fresh queue item (pendente). Accepts
  // large text (content.md) and optional file attachments (files/).
  async function createQueueItem({ skillId, title, content, tags, source, submittedBy, files, root, feedbackId }) {
    const text = String(content || '');
    const trimmed = text.trim();
    const incoming = Array.isArray(files) ? files : [];
    if (!trimmed && !incoming.length) {
      throw new Error('Envie um texto ou pelo menos um arquivo.');
    }
    if (text.length > QUEUE_MAX_CONTENT) {
      throw new Error(`Texto muito longo (máximo ${QUEUE_MAX_CONTENT.toLocaleString('pt-BR')} caracteres).`);
    }
    if (incoming.length > QUEUE_MAX_FILES) {
      throw new Error(`Máximo de ${QUEUE_MAX_FILES} arquivos por contribuição.`);
    }
    const target = String(skillId || '').trim();
    if (!(await skillExistsById(target))) {
      throw new Error(`Skill de destino desconhecida: ${target || '(vazio)'}.`);
    }
    // Decode + size-check all files before writing anything.
    const decoded = incoming.map(decodeQueueFile);
    let totalBytes = 0;
    for (const file of decoded) {
      totalBytes += file.buf.length;
    }
    if (totalBytes > QUEUE_MAX_TOTAL_FILE_BYTES) {
      throw new Error(`Anexos excedem o total de ${Math.round(QUEUE_MAX_TOTAL_FILE_BYTES / (1024 * 1024))} MB.`);
    }

    const id = feedbackId ? `feedback-${operationKey(feedbackId)}` : newQueueId();
    const where = root || (await submissionRoot());
    const dir = join(where, id);
    if (feedbackId && (await pathExists(join(dir, 'item.json')))) {
      const previous = JSON.parse(await readFile(join(dir, 'item.json'), 'utf8'));
      if (previous.originFeedbackId !== feedbackId || previous.contentHash !== operationKey(text))
        throw new Error('Esta conversão já contém outra correção. Reabra a contribuição existente.');
      await sealSubmission(dir, previous);
      return previous;
    }
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'content.md'), text, 'utf8');
    const savedFiles = [];
    if (decoded.length) {
      await mkdir(join(dir, 'files'), { recursive: true });
      for (const file of decoded) {
        await writeFile(join(dir, 'files', file.name), file.buf);
        savedFiles.push({ name: file.name, mime: file.mime, bytes: file.buf.length });
      }
    }
    const now = new Date().toISOString();
    const meta = {
      id,
      originFeedbackId: feedbackId || null,
      contentHash: operationKey(text),
      repo: activeRepo(), // the balde this item belongs to — Fila lists/decisions are repo-scoped
      skillId: target,
      originalSkillId: target,
      title:
        String(title || '')
          .trim()
          .slice(0, 160) || (trimmed ? trimmed.slice(0, 60) : savedFiles[0]?.name || 'Contribuição'),
      tags: Array.isArray(tags)
        ? tags
            .map((tag) => String(tag).trim())
            .filter(Boolean)
            .slice(0, 12)
        : [],
      source: ['api', 'web', 'chat'].includes(source) ? source : 'web',
      submittedBy: {
        name: String(submittedBy?.name || 'anônimo').slice(0, 120),
        email: String(submittedBy?.email || '').slice(0, 160)
      },
      status: 'pendente',
      contentChars: text.length,
      preview: trimmed.slice(0, QUEUE_PREVIEW_CHARS),
      files: savedFiles,
      ai: null,
      review: null,
      createdAt: now,
      updatedAt: now
    };
    await writeQueueMeta(meta, where);
    await sealSubmission(dir, meta);
    emitNotifyContribution(meta); // per-item e-mail to everyone who curates it (n8n delivers)
    pushLocalNotice(
      'Nova contribuição na Fila',
      `${(submittedBy && (submittedBy.name || submittedBy.email)) || 'alguém'}: ${meta.title || skillId}`,
      submittedBy && submittedBy.email
    );
    return meta;
  }

  // Bound a large text to a head+tail window so triage stays cheap on huge transcripts.
  function boundTextForAi(text, limit) {
    const value = String(text || '');
    if (value.length <= limit) {
      return value;
    }
    const head = value.slice(0, Math.floor(limit * 0.7));
    const tail = value.slice(-Math.floor(limit * 0.3));
    return `${head}\n\n[... ${value.length - head.length - tail.length} caracteres omitidos na triagem ...]\n\n${tail}`;
  }

  // AI preprocessing: summarize, flag misfiling, suggest destination/tags + a cleaned draft.
  // Uses the reviewing curator's own AI config (BYO key). Sends only a bounded window of the
  // text (+ file names/types) so large context doesn't blow the model window. Requires the
  // item loaded WITH content (item.content).
  async function preprocessQueueItem(item, aiConfig) {
    const skills = await loadSkillsFromDisk();
    const catalog = skills.map((skill) => ({
      id: skill.id,
      nome: skill.nome,
      objetivo: String(skill.objetivo || '').slice(0, 240)
    }));
    const current = skills.find((skill) => skill.id === item.skillId) || null;
    const fullLength = String(item.content || '').length;
    const payload = {
      contribution: {
        title: item.title,
        content: boundTextForAi(item.content, QUEUE_AI_WINDOW),
        contentTruncated: fullLength > QUEUE_AI_WINDOW,
        contentChars: fullLength,
        tags: item.tags,
        files: (item.files || []).map((file) => ({ name: file.name, mime: file.mime, bytes: file.bytes })),
        currentSkillId: item.skillId
      },
      currentSkill: current
        ? { id: current.id, nome: current.nome, objetivo: current.objetivo, descricao: current.descricao }
        : null,
      skills: catalog
    };
    const result = await callAiWithConfig(payload, 'skill_queue_triage', aiConfig);
    if (!result) {
      return null;
    }
    const suggested = String(result.suggestedSkillId || '').trim();
    const cleaned = String(result.cleanedContent || '').slice(0, 200000);
    item.ai = {
      provider: aiConfig.provider,
      generatedAt: new Date().toISOString(),
      summary: String(result.summary || '').slice(0, 4000),
      suggestedSkillId: (await skillExistsById(suggested)) ? suggested : null,
      suggestedSkillReason: String(result.suggestedSkillReason || '').slice(0, 1000),
      suggestedTags: Array.isArray(result.suggestedTags)
        ? result.suggestedTags
            .map((tag) => String(tag).trim())
            .filter(Boolean)
            .slice(0, 12)
        : [],
      quality: Number.isFinite(Number(result.quality))
        ? Math.max(0, Math.min(100, Math.round(Number(result.quality))))
        : null,
      concerns: Array.isArray(result.concerns)
        ? result.concerns
            .map((concern) => String(concern).slice(0, 300))
            .filter(Boolean)
            .slice(0, 8)
        : [],
      cleanedChars: cleaned.length
    };
    // The cleaned text lives in a sidecar (keeps item.json + the list light).
    await mkdir(queueDir(item.id), { recursive: true });
    await writeFile(join(queueDir(item.id), 'ai-cleaned.md'), cleaned, 'utf8');
    await writeQueueMeta(item);
    item.ai.cleanedContent = cleaned; // attach for the immediate response
    return item;
  }

  // Merge an approved contribution into the target skill: append a text section to SKILL.md
  // AND copy any attachments into the skill's context/ folder, then commit to the git ledger
  // (authored by the reviewing curator). Requires the item loaded WITH content/files.
  async function mergeQueueItemIntoSkill(item, content, actor) {
    assertSafeSkillId(item.skillId);
    const result = await applyContribution({
      item,
      content,
      actor,
      sourceDirectory: queueDir(item.id),
      skillDirectory: join(skillsRoot(), item.skillId)
    });
    await commitCorpus(`skill(${item.skillId}): contribuição ${item.id} aplicada ao rascunho`, actor, [
      `${item.skillId}/${result.contextPath}`
    ]);
    return result;
  }
  // proposes per-file changes (adição/atualização) as full new-content, which the curator reviews as
  // side-by-side diffs. Two stages: (A) locate/classify the target files, (B) propose each file's
  // integrated content. Never mutates anything — pure proposal. Requires the curator's BYO AI key.
  const MERGE_LOCATE_SYSTEM =
    'Você é um curador de conhecimento. Recebe uma CONTRIBUIÇÃO e o estado atual de uma SKILL (o SKILL.md + a lista de arquivos de contexto com um trecho de cada) e, opcionalmente, CONCEITOS do commons ligados. Decida ONDE o conhecimento deve entrar e SE cada alvo é "adição" (novo/expande) ou "atualização" (mexe em conteúdo existente). Prefira o arquivo mais específico: regras/comportamento vão no SKILL.md; definições, dicionários e tabelas vão em arquivos de contexto. Pode propor um arquivo NOVO (dê um caminho como references/nome.md). Responda somente JSON: {"summary":"resumo de uma linha","changes":[{"targetPath":"SKILL.md","scope":"skill","action":"update","reason":"..."}]}. No máximo 4 alvos.';
  const MERGE_PROPOSE_SYSTEM =
    'Você integra uma CONTRIBUIÇÃO no CONTEÚDO ATUAL de um arquivo e devolve o CONTEÚDO COMPLETO já integrado. Regras: adicione onde faz sentido; ATUALIZE/substitua trechos desatualizados (uma correção SUBSTITUI o valor antigo, nunca empilha os dois); não duplique; preserve a estrutura (frontmatter, headings, links, formato); não invente dados fora da contribuição/arquivo. Se o arquivo for NOVO (sem conteúdo atual), escreva-o do zero a partir da contribuição, com um heading e formato coerentes. Responda somente JSON: {"newContent":"o arquivo inteiro"}.';

  async function analyseMergeForSkill(skillId, contributionText, aiConfig) {
    const working = await loadSkillWorkingContext(skillId);
    const textFiles = (working.files || []).filter(
      (f) => /\.(md|markdown|txt|sql|csv|json)$/i.test(f) && f.toLowerCase() !== 'skill.md'
    );
    const contextFiles = [];
    for (const rel of textFiles.slice(0, 30)) {
      let content = '';
      try {
        content = await readFile(join(working.skillDir, rel), 'utf8');
      } catch (error) {
        /* skip */
      }
      contextFiles.push({ path: rel, head: content.slice(0, 500) });
    }
    // Linked capsules: /commons/<id> targets in the SKILL.md body (few heads — this is a
    // locate prompt, not grounding; keep it small regardless of how many the spine indexes).
    const commonsIds = linkedCapsuleIds(working.markdown).slice(0, 6);
    const linkedCommons = [];
    for (const cid of commonsIds) {
      try {
        const c = await readFile(commonsConceptContextPath(cid), 'utf8');
        linkedCommons.push({ id: cid, head: c.slice(0, 400) });
      } catch (error) {
        /* skip */
      }
    }
    const locate = await callAiWithSystemPrompt(
      MERGE_LOCATE_SYSTEM,
      {
        contribution: String(contributionText).slice(0, 8000),
        skillMarkdown: working.markdown.slice(0, 9000),
        contextFiles,
        linkedCommons
      },
      aiConfig,
      true
    );
    const targets = Array.isArray(locate && locate.changes) ? locate.changes.slice(0, 4) : [];
    const changes = [];
    for (const t of targets) {
      const scope = t.scope === 'commons' ? 'commons' : 'skill';
      const path = String(t.targetPath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (!path || path.includes('..')) continue;
      const action = t.action === 'create' ? 'create' : 'update';
      let oldContent = '';
      if (action === 'update') {
        try {
          oldContent =
            scope === 'commons'
              ? await readFile(commonsConceptContextPath(path.replace(/^commons\//, '')), 'utf8')
              : await readFile(join(working.skillDir, path), 'utf8');
        } catch (error) {
          oldContent = '';
        }
      }
      let proposal = null;
      try {
        proposal = await callAiWithSystemPrompt(
          MERGE_PROPOSE_SYSTEM,
          {
            contribution: String(contributionText).slice(0, 8000),
            targetPath: path,
            action,
            reason: t.reason || '',
            currentContent: oldContent.slice(0, 16000)
          },
          aiConfig,
          true
        );
      } catch (error) {
        continue;
      }
      const newContent = String((proposal && proposal.newContent) || '')
        .replace(/\r\n/g, '\n')
        .trim();
      if (!newContent || newContent === oldContent.trim()) continue;
      changes.push({ scope, path, action, reason: String(t.reason || ''), oldContent, newContent });
    }
    return { skillId, summary: String((locate && locate.summary) || ''), changes };
  }

  // Stream one attachment's bytes from an item's files/ folder (curator download).
  async function queueFilePathIfExists(id, name) {
    try {
      const safe = assertSafeUploadName(name);
      const path = join(queueDir(id), 'files', safe);
      if (await pathExists(path)) {
        return { path, name: safe };
      }
    } catch (error) {
      // invalid id/name → not found
    }
    return null;
  }

  return {
    QUEUE_MAX_FILES,
    QUEUE_MAX_TOTAL_FILE_BYTES,
    QUEUE_MAX_BODY,
    QUEUE_PREVIEW_CHARS,
    queueDir,
    newQueueId,
    skillExistsById,
    loadQueueItem,
    readQueueMeta,
    readQueueItem,
    writeQueueMeta,
    listQueueItems,
    queueCounts,
    decodeQueueFile,
    createQueueItem,
    preprocessQueueItem,
    mergeQueueItemIntoSkill,
    analyseMergeForSkill,
    queueFilePathIfExists
  };
}
