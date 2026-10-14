import {
  RUN_QUERY_NOTE,
  ADHOC_SQL_NOTE,
  CHAT_MAX_TURNS,
  CHAT_MAX_CONTEXT_SKILLS,
  CHAT_TOOL_MAX_STEPS
} from '../policy/chat-policy.mjs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileStamp } from '../skill-format.mjs';
import { plenariasRoot, BUDDY_POSES } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { callAiChatToolLoopStream } from '../ai-provider.mjs';
import { loadBuddy } from '../buddies.mjs';

export function createConversationsFeature({
  userAiDir,
  skillExistsById,
  loadSkillsFromDisk,
  chatSystemPrompt,
  loadUserAiConfig,
  resolveChatContextMode,
  chatSystemPromptPaged,
  makeChatContextTools,
  withRunQueryTool,
  withRunSqlTool,
  withContributeTool,
  attachAdhocSql
}) {
  const CONTEXT_EXCLUDE_SEGMENTS = new Set([
    'legado',
    'logs',
    'canonico',
    'rascunho',
    '.git',
    'img',
    'data',
    'files',
    'eval'
  ]);
  const CONTEXT_EXCLUDE_FILES = new Set([
    'skill.md',
    'suggestions.json',
    'suggestions.md',
    'wrong-feedback.json',
    'metadata.json',
    'index.json',
    'change-log.json',
    'change-log.md',
    'access.yml',
    'context-index.json',
    'governance.json'
  ]);
  function isGovernancePath(norm) {
    const parts = norm.toLowerCase().split('/');
    if (CONTEXT_EXCLUDE_FILES.has(parts[parts.length - 1])) {
      return true;
    }
    return parts.slice(0, -1).some((seg) => CONTEXT_EXCLUDE_SEGMENTS.has(seg));
  }

  // Files the EDIT wizard manages as context (references/query/analytics + img/data media + root).
  // Excludes the SKILL.md spine, output_schema.json (its own field), generated media descriptions,
  // eval cases, and all governance machinery/lifecycle dirs. The /update reconcile uses the SAME
  // predicate, so it only ever deletes files the wizard actually showed the user.
  const EDIT_EXCLUDE_DIRS = new Set(['legado', 'logs', 'canonico', 'rascunho', '.git', 'eval', 'files']);
  function isEditableContextFile(norm) {
    const parts = String(norm).toLowerCase().replace(/\\/g, '/').split('/');
    const base = parts[parts.length - 1];
    if (base === 'skill.md' || base === 'output_schema.json' || base === 'descriptions.json') return false;
    if (CONTEXT_EXCLUDE_FILES.has(base)) return false;
    return !parts.slice(0, -1).some((seg) => EDIT_EXCLUDE_DIRS.has(seg));
  }
  // A commons concept's manageable media = files under img/ or data/, minus the generated
  // descriptions.json sidecar. The commons /update reconcile deletes only these.
  function isCommonsMediaFile(norm) {
    const parts = String(norm).toLowerCase().replace(/\\/g, '/').split('/');
    if (parts[parts.length - 1] === 'descriptions.json') return false;
    return parts[0] === 'img' || parts[0] === 'data';
  }

  function userChatsDir(actor) {
    const dir = userAiDir(actor);
    return dir ? join(dir, 'chats') : null;
  }

  function assertSafeChatId(id) {
    if (!/^[a-zA-Z0-9._-]+$/.test(String(id || ''))) {
      throw new Error('id de conversa invalido');
    }
  }

  function newChatId() {
    return `c-${fileStamp()}-${randomBytes(3).toString('hex')}`;
  }

  async function readChat(actor, id) {
    try {
      const dir = userChatsDir(actor);
      if (!dir) {
        return null;
      }
      assertSafeChatId(id);
      return JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8'));
    } catch (error) {
      return null;
    }
  }

  async function writeChat(actor, chat) {
    const dir = userChatsDir(actor);
    if (!dir) {
      throw new Error('Identidade do usuário não disponível.');
    }
    await mkdir(dir, { recursive: true });
    chat.updatedAt = new Date().toISOString();
    await writeFile(join(dir, `${chat.id}.json`), `${JSON.stringify(chat, null, 2)}\n`, 'utf8');
    return chat;
  }

  async function listChats(actor) {
    const dir = userChatsDir(actor);
    if (!dir || !(await pathExists(dir))) {
      return [];
    }
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      try {
        const chat = JSON.parse(await readFile(join(dir, entry.name), 'utf8'));
        out.push({
          id: chat.id,
          title: chat.title || 'Conversa',
          skillIds: Array.isArray(chat.skillIds) ? chat.skillIds : [],
          messageCount: (chat.messages || []).length,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt
        });
      } catch (error) {
        // skip a corrupt chat
      }
    }
    out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return out;
  }

  async function sanitizeChatSkillIds(skillIds) {
    const ids = Array.isArray(skillIds) ? skillIds.map(String) : [];
    const valid = [];
    for (const id of ids.slice(0, CHAT_MAX_CONTEXT_SKILLS)) {
      if (!valid.includes(id) && (await skillExistsById(id))) {
        valid.push(id);
      }
    }
    return valid;
  }

  async function createChat(actor, { title, skillIds } = {}) {
    const now = new Date().toISOString();
    const chat = {
      id: newChatId(),
      title:
        String(title || '')
          .trim()
          .slice(0, 120) || 'Nova conversa',
      skillIds: await sanitizeChatSkillIds(skillIds),
      messages: [],
      createdAt: now,
      updatedAt: now
    };
    return writeChat(actor, chat);
  }

  // The buddy this chat should embody: the first selected skill (in order) that
  // binds a resolvable buddy via its `buddy_id` frontmatter. Presentation + tone
  // only — a stale/missing buddy is skipped, never an error, and never gates skills.
  async function resolveChatBuddy(skillIds, skills = null) {
    const ids = Array.isArray(skillIds) ? skillIds : [];
    if (!ids.length) {
      return null;
    }
    const all = skills || (await loadSkillsFromDisk());
    for (const id of ids) {
      const skill = all.find((item) => item.id === id);
      const bid = skill && skill.buddyId;
      if (bid) {
        try {
          const buddy = await loadBuddy(bid);
          if (buddy) {
            return buddy;
          }
        } catch (error) {
          // stale buddy binding → try the next context skill
        }
      }
    }
    return null;
  }
  // Plenárias — the multi-user twin of 1:1 chat. Same message / skill / buddy
  // model, but stored CENTRALLY (not per user), gated by a join key + membership,
  // and fanned out live to every connected participant through an in-memory SSE
  // hub. Single Node process → the hub, the per-room write lock, and the
  // single-flight guard are all plain in-memory maps.
  const PLENARIA_KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // drop I/L/O/0/1 (ambiguous)

  function newPlenariaId() {
    return `p-${fileStamp()}-${randomBytes(3).toString('hex')}`;
  }

  function newPlenariaKey() {
    const bytes = randomBytes(8);
    let out = '';
    for (let i = 0; i < 8; i += 1) {
      out += PLENARIA_KEY_ALPHABET[bytes[i] % PLENARIA_KEY_ALPHABET.length];
    }
    return out; // e.g. "K7Q2M9RT"
  }

  function assertSafePlenariaId(id) {
    if (!/^[a-zA-Z0-9._-]+$/.test(String(id || ''))) {
      throw new Error('id de plenária inválido');
    }
  }

  function actorEmail(actor) {
    return String((actor && actor.email) || '')
      .trim()
      .toLowerCase();
  }

  function actorLabel(actor) {
    return String((actor && (actor.name || actor.email)) || 'participante').trim() || 'participante';
  }

  async function readPlenaria(id) {
    try {
      assertSafePlenariaId(id);
      return JSON.parse(await readFile(join(plenariasRoot, `${id}.json`), 'utf8'));
    } catch (error) {
      return null;
    }
  }

  async function writePlenaria(plenaria) {
    await mkdir(plenariasRoot, { recursive: true });
    plenaria.updatedAt = new Date().toISOString();
    await writeFile(join(plenariasRoot, `${plenaria.id}.json`), `${JSON.stringify(plenaria, null, 2)}\n`, 'utf8');
    return plenaria;
  }

  function plenariaIsOwner(plenaria, actor) {
    const email = actorEmail(actor);
    return !!plenaria && email !== '' && actorEmail(plenaria.owner) === email;
  }

  function plenariaIsMember(plenaria, actor) {
    const email = actorEmail(actor);
    if (!email) return false;
    if (actorEmail(plenaria.owner) === email) return true;
    return (plenaria.participants || []).some((p) => actorEmail(p) === email);
  }

  // Per-room async mutex: serialize read-modify-write of the shared file so two
  // simultaneous posters can't clobber each other's append. Single process, but
  // the awaits between read and write would otherwise interleave.
  const plenariaLocks = new Map(); // id -> Promise (tail of the queue)
  function withPlenariaLock(id, task) {
    const prev = plenariaLocks.get(id) || Promise.resolve();
    const next = prev.then(task, task); // run regardless of the previous outcome
    plenariaLocks.set(
      id,
      next.catch(() => {})
    ); // stored tail never rejects → chain survives
    return next; // caller still sees task's real result/throw
  }

  // In-memory fan-out hub: room id -> Set of open SSE responses (the live listen
  // channels). Posting a message broadcasts to every subscriber of that room.
  const plenariaHub = new Map(); // id -> Set<res>
  function plenariaSubscribe(id, res) {
    let set = plenariaHub.get(id);
    if (!set) {
      set = new Set();
      plenariaHub.set(id, set);
    }
    set.add(res);
    return () => {
      const s = plenariaHub.get(id);
      if (s) {
        s.delete(res);
        if (!s.size) plenariaHub.delete(id);
      }
    };
  }
  function plenariaBroadcast(id, obj) {
    const set = plenariaHub.get(id);
    if (!set) return;
    const line = `data: ${JSON.stringify(obj)}\n\n`;
    for (const res of set) {
      try {
        res.write(line);
      } catch {
        /* client gone; its own close cleans up */
      }
    }
  }
  // Presence: distinct emails currently holding an open stream for this room.
  function plenariaOnline(id) {
    const set = plenariaHub.get(id);
    if (!set) return [];
    const emails = new Set();
    for (const res of set) {
      if (res._plenariaEmail) emails.add(res._plenariaEmail);
    }
    return [...emails];
  }

  // Single-flight AI generation per room: only one buddy reply in flight at a
  // time (a second trigger while generating is ignored — the buddy is already
  // answering the room).
  const plenariaGenerating = new Set(); // ids currently generating

  async function listPlenariasFor(actor) {
    if (!(await pathExists(plenariasRoot))) return [];
    const email = actorEmail(actor);
    const out = [];
    for (const entry of await readdir(plenariasRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const p = JSON.parse(await readFile(join(plenariasRoot, entry.name), 'utf8'));
        if (!plenariaIsMember(p, actor)) continue;
        out.push({
          id: p.id,
          type: 'plenaria',
          title: p.title || 'Plenária',
          skillIds: Array.isArray(p.skillIds) ? p.skillIds : [],
          participantCount: (p.participants || []).length,
          messageCount: (p.messages || []).length,
          isOwner: actorEmail(p.owner) === email,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt
        });
      } catch {
        /* skip corrupt */
      }
    }
    out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return out;
  }

  async function findPlenariaByKey(key) {
    const k = String(key || '')
      .trim()
      .toUpperCase();
    if (!k || !(await pathExists(plenariasRoot))) return null;
    for (const entry of await readdir(plenariasRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const p = JSON.parse(await readFile(join(plenariasRoot, entry.name), 'utf8'));
        if (String(p.joinKey || '').toUpperCase() === k) return p;
      } catch {
        /* skip */
      }
    }
    return null;
  }

  // A member's view. joinKey is exposed ONLY to the owner (it's the share secret);
  // participants get everything else.
  function plenariaView(plenaria, actor) {
    const owner = plenariaIsOwner(plenaria, actor);
    return {
      id: plenaria.id,
      type: 'plenaria',
      title: plenaria.title || 'Plenária',
      skillIds: Array.isArray(plenaria.skillIds) ? plenaria.skillIds : [],
      owner: { name: plenaria.owner?.name || '', email: plenaria.owner?.email || '' },
      isOwner: owner,
      joinKey: owner ? plenaria.joinKey || '' : undefined,
      participants: (plenaria.participants || []).map((p) => ({
        name: p.name || '',
        email: p.email || '',
        joinedAt: p.joinedAt
      })),
      online: plenariaOnline(plenaria.id),
      messages: plenaria.messages || [],
      createdAt: plenaria.createdAt,
      updatedAt: plenaria.updatedAt
    };
  }

  // Build the model history for a room: human turns are prefixed with the
  // speaker's name so the buddy can tell participants apart; assistant turns are
  // its own prior replies (mood marker stripped).
  function plenariaHistory(messages) {
    const moodRe = new RegExp('^\\s*\\[(' + BUDDY_POSES.join('|') + ')\\]\\s*', 'i');
    return (messages || []).slice(-CHAT_MAX_TURNS).map((m) => {
      if (m.role === 'assistant') {
        return { role: 'assistant', content: String(m.content || '').replace(moodRe, '') };
      }
      const who = (m.author && (m.author.name || m.author.email)) || 'Participante';
      return { role: 'user', content: `${who}: ${m.content}` };
    });
  }

  const PLENARIA_NOTE =
    '\n\n---\nVocê está facilitando uma PLENÁRIA: uma conversa com MÚLTIPLOS participantes humanos. Cada fala vem marcada com o nome de quem falou ("Nome: mensagem"). Fale com o grupo (não com uma pessoa só), ajude a sintetizar os pontos e, quando fizer sentido, convide à participação. Nunca prefixe suas respostas com "Nome:".';

  async function plenariaSystemPrompt(skillIds, actor = null) {
    return (await chatSystemPrompt(skillIds, actor)) + PLENARIA_NOTE;
  }

  // Decide whether the buddy should answer: explicit toggle, an @buddy tag, or a
  // whole-word mention of the room buddy's name.
  async function plenariaShouldTriggerBuddy(plenaria, content, askBuddy) {
    if (askBuddy) return true;
    if (/(^|\s)@buddy\b/i.test(String(content || ''))) return true;
    const buddy = await resolveChatBuddy(plenaria.skillIds);
    const name = String((buddy && buddy.name) || '').trim();
    if (name.length >= 3) {
      const re = new RegExp('(^|\\W)@?' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\W|$)', 'i');
      if (re.test(String(content || ''))) return true;
    }
    return false;
  }

  // Generate ONE buddy reply for a room and stream it to every subscriber, using
  // the AI config of whoever triggered it (BYO key). Single-flight: no-ops if a
  // reply is already in flight for this room. Persists under the room write lock.
  // Grounding mirrors the 1:1 chat: paged (tool) mode records the EXACT files the
  // buddy reads into the message's `sources`; inline mode records none.
  async function runPlenariaBuddyReply(id, triggerActor) {
    if (plenariaGenerating.has(id)) return;
    const aiConfig = await loadUserAiConfig(triggerActor);
    if (!aiConfig || !aiConfig.apiKey) {
      plenariaBroadcast(id, {
        type: 'notice',
        text: `${actorLabel(triggerActor)} chamou o buddy, mas não há provedor de IA configurado para responder.`
      });
      return;
    }
    const plenaria = await readPlenaria(id);
    if (!plenaria) return;
    plenariaGenerating.add(id);
    const ctxSkills = (await loadSkillsFromDisk()).filter((s) => (plenaria.skillIds || []).includes(s.id));
    const { mode } = await resolveChatContextMode(ctxSkills, aiConfig);
    let system;
    let toolset = null;
    if (mode === 'paged') {
      ({ system } = await chatSystemPromptPaged(plenaria.skillIds, triggerActor));
      toolset = await makeChatContextTools(plenaria.skillIds, triggerActor);
    } else {
      system = await chatSystemPrompt(plenaria.skillIds, triggerActor);
    }
    toolset = await withRunQueryTool(toolset, plenaria.skillIds, triggerActor); // governed .sql execution in ANY mode
    if (toolset && toolset.tools.some((t) => t.name === 'run_query')) system += RUN_QUERY_NOTE;
    toolset = await withRunSqlTool(toolset, plenaria.skillIds, triggerActor); // AI-derived SQL fallback → curator draft
    if (toolset && toolset.tools.some((t) => t.name === 'run_sql')) system += ADHOC_SQL_NOTE;
    toolset = withContributeTool(toolset, triggerActor, plenaria.skillIds); // contributions are submitted by whoever called the buddy
    system += PLENARIA_NOTE;
    const history = plenariaHistory(plenaria.messages);
    plenariaBroadcast(id, { type: 'buddy-start', at: new Date().toISOString() });
    let full = '';
    const persist = (content, partial) =>
      withPlenariaLock(id, async () => {
        const fresh = await readPlenaria(id);
        if (!fresh) return null;
        fresh.messages = fresh.messages || [];
        const message = {
          role: 'assistant',
          content,
          at: new Date().toISOString(),
          ...(partial ? { partial: true } : {})
        };
        if (toolset && toolset.reads.length) {
          message.sources = [...toolset.reads];
        }
        await attachAdhocSql(message, toolset, triggerActor);
        fresh.messages.push(message);
        await writePlenaria(fresh);
        return message;
      });
    try {
      await callAiChatToolLoopStream(history, aiConfig, {
        system,
        tools: toolset.tools,
        execute: toolset.execute,
        maxSteps: CHAT_TOOL_MAX_STEPS,
        sessionKey: `plenaria:${id}`,
        onText: (text) => {
          full += text;
          plenariaBroadcast(id, { type: 'buddy-delta', text });
        }
      });
      const message = await persist(full || '(sem resposta)', false);
      plenariaBroadcast(id, { type: 'buddy-done', message });
    } catch (error) {
      if (full) {
        await persist(full, true);
      }
      plenariaBroadcast(id, { type: 'buddy-error', error: `Falha na IA: ${error.message}` });
    } finally {
      plenariaGenerating.delete(id);
    }
  }

  return {
    isGovernancePath,
    isEditableContextFile,
    isCommonsMediaFile,
    userChatsDir,
    assertSafeChatId,
    readChat,
    writeChat,
    listChats,
    sanitizeChatSkillIds,
    createChat,
    resolveChatBuddy,
    newPlenariaId,
    newPlenariaKey,
    assertSafePlenariaId,
    actorEmail,
    actorLabel,
    readPlenaria,
    writePlenaria,
    plenariaIsOwner,
    plenariaIsMember,
    withPlenariaLock,
    plenariaSubscribe,
    plenariaBroadcast,
    plenariaOnline,
    listPlenariasFor,
    findPlenariaByKey,
    plenariaView,
    plenariaShouldTriggerBuddy,
    runPlenariaBuddyReply
  };
}
