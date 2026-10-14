import {
  RUN_QUERY_NOTE,
  ADHOC_SQL_NOTE,
  CHAT_MAX_MESSAGE,
  CHAT_MAX_TURNS,
  CHAT_TOOL_MAX_STEPS
} from '../policy/chat-policy.mjs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BUDDY_POSES } from '../config.mjs';
import { actorFromReq } from '../git-corpus.mjs';
import { callAiChatToolLoop, callAiChatToolLoopStream } from '../ai-provider.mjs';

export function createChatRoutes({
  sendJson,
  listChats,
  readJsonBody,
  createChat,
  readChat,
  aiModeNone,
  QUEUE_MAX_BODY,
  loadUserAiConfig,
  storeMessageAttachments,
  chatFilesDir,
  loadSkillsFromDisk,
  resolveChatContextMode,
  chatSystemPromptPaged,
  makeChatContextTools,
  chatSystemPrompt,
  withRunQueryTool,
  withRunSqlTool,
  withContributeTool,
  attachAdhocSql,
  writeChat,
  recordSkillEvent,
  sanitizeChatSkillIds,
  recordFeedback,
  emitNotifyFeedback,
  userChatsDir,
  assertSafeChatId,
  removeConversationFiles,
  findAttachmentMeta,
  findMessageAttachment,
  serveFileBytes,
  isImageMime,
  conversationSkillFiles,
  serveContextSkillFile,
  serveCorpusRef
}) {
  return async function chatRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/chats') {
      sendJson(res, 200, { ok: true, chats: await listChats(actorFromReq(req)) });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/chats') {
      const body = await readJsonBody(req);
      try {
        const chat = await createChat(actorFromReq(req), { title: body.title, skillIds: body.skillIds });
        sendJson(res, 201, { ok: true, chat });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/chats/item') {
      const chat = await readChat(actorFromReq(req), url.searchParams.get('id'));
      if (!chat) {
        sendJson(res, 404, { ok: false, error: 'Conversa não encontrada.' });
        return true;
      }
      sendJson(res, 200, { ok: true, chat });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/chats/message') {
      if (aiModeNone(res)) return true;
      const body = await readJsonBody(req, QUEUE_MAX_BODY);
      const actor = actorFromReq(req);
      const chat = await readChat(actor, body.id);
      if (!chat) {
        sendJson(res, 404, { ok: false, error: 'Conversa não encontrada.' });
        return true;
      }
      const content = String(body.content || '').trim();
      const hasAttachments = Array.isArray(body.attachments) && body.attachments.length > 0;
      if (!content && !hasAttachments) {
        sendJson(res, 400, { ok: false, error: 'Mensagem vazia.' });
        return true;
      }
      if (content.length > CHAT_MAX_MESSAGE) {
        sendJson(res, 400, { ok: false, error: `Mensagem muito longa (máx. ${CHAT_MAX_MESSAGE} caracteres).` });
        return true;
      }
      const aiConfig = await loadUserAiConfig(actor);
      if (!aiConfig || !aiConfig.apiKey) {
        sendJson(res, 400, {
          ok: false,
          error:
            'Configure seu provedor de IA em Configurações para conversar — uma chave de API ou um cliente local (Claude Code/Codex) na aba Clientes de IA (CLI).'
        });
        return true;
      }
      let atts = [];
      try {
        atts = await storeMessageAttachments(chatFilesDir(actor, chat.id), body.attachments);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
        return true;
      }
      chat.messages.push({
        role: 'user',
        content,
        at: new Date().toISOString(),
        ...(atts.length ? { attachments: atts } : {})
      });
      if (!chat.title || chat.title === 'Nova conversa') {
        chat.title = content.slice(0, 60);
      }
      const history = chat.messages
        .slice(-CHAT_MAX_TURNS)
        .map((message) => ({ role: message.role, content: message.content }));
      // Phase D: inline small skills; page big ones (model reads context on demand via tools).
      const ctxSkills = (await loadSkillsFromDisk()).filter((s) => (chat.skillIds || []).includes(s.id));
      const { mode } = await resolveChatContextMode(ctxSkills, aiConfig);
      try {
        let reply;
        let sources = [];
        let system;
        let toolset = null;
        if (mode === 'paged') {
          ({ system } = await chatSystemPromptPaged(chat.skillIds, actor));
          toolset = await makeChatContextTools(chat.skillIds, actor);
        } else {
          system = await chatSystemPrompt(chat.skillIds, actor);
        }
        toolset = await withRunQueryTool(toolset, chat.skillIds, actor); // governed .sql execution in ANY mode
        if (toolset && toolset.tools.some((t) => t.name === 'run_query')) system += RUN_QUERY_NOTE;
        toolset = await withRunSqlTool(toolset, chat.skillIds, actor); // AI-derived SQL fallback → curator draft
        if (toolset && toolset.tools.some((t) => t.name === 'run_sql')) system += ADHOC_SQL_NOTE;
        toolset = withContributeTool(toolset, actor, chat.skillIds); // conversation tools (contribute + find files) in ANY mode
        reply = await callAiChatToolLoop(history, aiConfig, {
          system,
          tools: toolset.tools,
          execute: toolset.execute,
          maxSteps: CHAT_TOOL_MAX_STEPS,
          sessionKey: `chat:${chat.id}`
        });
        sources = [...toolset.reads];
        const msg = { role: 'assistant', content: reply || '(sem resposta)', at: new Date().toISOString() };
        if (sources.length) msg.sources = sources;
        await attachAdhocSql(msg, toolset, actor);
        chat.messages.push(msg);
        await writeChat(actor, chat);
        for (const sid of chat.skillIds || []) recordSkillEvent('chat', sid, 'app', actor); // grounded turn → used-to-answer signal
        sendJson(res, 200, { ok: true, chat, mode });
      } catch (error) {
        // persist the user's message even if the AI call failed, so it isn't lost
        await writeChat(actor, chat);
        sendJson(res, 502, { ok: false, error: `Falha na IA: ${error.message}`, chat });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/chats/stream') {
      const body = await readJsonBody(req, QUEUE_MAX_BODY);
      const actor = actorFromReq(req);
      const chat = await readChat(actor, body.id);
      if (!chat) {
        sendJson(res, 404, { ok: false, error: 'Conversa não encontrada.' });
        return true;
      }
      const content = String(body.content || '').trim();
      const hasAttachments = Array.isArray(body.attachments) && body.attachments.length > 0;
      if (!content && !hasAttachments) {
        sendJson(res, 400, { ok: false, error: 'Mensagem vazia.' });
        return true;
      }
      if (content.length > CHAT_MAX_MESSAGE) {
        sendJson(res, 400, { ok: false, error: `Mensagem muito longa (máx. ${CHAT_MAX_MESSAGE} caracteres).` });
        return true;
      }
      const aiConfig = await loadUserAiConfig(actor);
      if (!aiConfig || !aiConfig.apiKey) {
        sendJson(res, 400, {
          ok: false,
          error:
            'Configure seu provedor de IA em Configurações para conversar — uma chave de API ou um cliente local (Claude Code/Codex) na aba Clientes de IA (CLI).'
        });
        return true;
      }
      let atts = [];
      try {
        atts = await storeMessageAttachments(chatFilesDir(actor, chat.id), body.attachments);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
        return true;
      }

      chat.messages.push({
        role: 'user',
        content,
        at: new Date().toISOString(),
        ...(atts.length ? { attachments: atts } : {})
      });
      if (!chat.title || chat.title === 'Nova conversa') {
        chat.title = content.slice(0, 60);
      }
      const history = chat.messages
        .slice(-CHAT_MAX_TURNS)
        .map((message) => ({ role: message.role, content: message.content }));
      // Phase D: pick grounding mode and build the prompt (+ tools when paged) BEFORE switching
      // to SSE, so any build error still returns a normal JSON status instead of a broken stream.
      const ctxSkills = (await loadSkillsFromDisk()).filter((s) => (chat.skillIds || []).includes(s.id));
      const { mode } = await resolveChatContextMode(ctxSkills, aiConfig);
      let system;
      let toolset = null;
      if (mode === 'paged') {
        ({ system } = await chatSystemPromptPaged(chat.skillIds, actor));
        toolset = await makeChatContextTools(chat.skillIds, actor);
      } else {
        system = await chatSystemPrompt(chat.skillIds, actor);
      }
      toolset = await withRunQueryTool(toolset, chat.skillIds, actor); // governed .sql execution in ANY mode
      if (toolset && toolset.tools.some((t) => t.name === 'run_query')) system += RUN_QUERY_NOTE;
      toolset = await withRunSqlTool(toolset, chat.skillIds, actor); // AI-derived SQL fallback → curator draft
      if (toolset && toolset.tools.some((t) => t.name === 'run_sql')) system += ADHOC_SQL_NOTE;
      toolset = withContributeTool(toolset, actor, chat.skillIds); // conversation tools (contribute + find files) in ANY mode

      // X-Accel-Buffering:no makes nginx stream this response straight through (no
      // proxy_buffering config change needed); the heartbeat keeps the connection
      // under proxy_read_timeout even before the model's first token.
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      });
      const sse = (obj) => {
        try {
          res.write(`data: ${JSON.stringify(obj)}\n\n`);
        } catch {
          /* client gone */
        }
      };
      res.write(': open\n\n');
      sse({ type: 'mode', mode });
      const heartbeat = setInterval(() => {
        try {
          res.write(': hb\n\n');
        } catch {
          /* ignore */
        }
      }, 15000);
      let full = '';
      try {
        await callAiChatToolLoopStream(history, aiConfig, {
          system,
          tools: toolset.tools,
          execute: toolset.execute,
          maxSteps: CHAT_TOOL_MAX_STEPS,
          sessionKey: `chat:${chat.id}`,
          onText: (text) => {
            full += text;
            sse({ type: 'delta', text });
          },
          onEvent: (evt) => {
            if (evt && evt.type === 'tool') sse({ type: 'tool', name: evt.name, input: evt.input });
          }
        });
        const msg = { role: 'assistant', content: full || '(sem resposta)', at: new Date().toISOString() };
        if (toolset && toolset.reads.length) msg.sources = [...toolset.reads];
        await attachAdhocSql(msg, toolset, actor);
        chat.messages.push(msg);
        await writeChat(actor, chat);
        for (const sid of chat.skillIds || []) recordSkillEvent('chat', sid, 'app', actor); // grounded turn → used-to-answer signal
        sse({ type: 'done', chat });
      } catch (error) {
        // keep any partial text that already streamed, plus the user's message
        if (full) {
          const msg = { role: 'assistant', content: full, at: new Date().toISOString(), partial: true };
          if (toolset && toolset.reads.length) msg.sources = [...toolset.reads];
          await attachAdhocSql(msg, toolset, actor);
          chat.messages.push(msg);
        }
        await writeChat(actor, chat);
        sse({ type: 'error', error: `Falha na IA: ${error.message}`, chat });
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/chats/skills') {
      const body = await readJsonBody(req);
      const actor = actorFromReq(req);
      const chat = await readChat(actor, body.id);
      if (!chat) {
        sendJson(res, 404, { ok: false, error: 'Conversa não encontrada.' });
        return true;
      }
      chat.skillIds = await sanitizeChatSkillIds(body.skillIds);
      await writeChat(actor, chat);
      sendJson(res, 200, { ok: true, chat });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/chats/rename') {
      const body = await readJsonBody(req);
      const actor = actorFromReq(req);
      const chat = await readChat(actor, body.id);
      if (!chat) {
        sendJson(res, 404, { ok: false, error: 'Conversa não encontrada.' });
        return true;
      }
      chat.title =
        String(body.title || '')
          .trim()
          .slice(0, 120) || chat.title;
      await writeChat(actor, chat);
      sendJson(res, 200, { ok: true, chat });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/chats/feedback') {
      const body = await readJsonBody(req);
      const verdict = String(body.verdict || '').toLowerCase();
      if (!['bom', 'fraco', 'errado'].includes(verdict)) {
        sendJson(res, 400, { ok: false, error: 'Veredito inválido. Use bom, fraco ou errado.' });
        return true;
      }
      const actor = actorFromReq(req);
      const chat = await readChat(actor, body.id);
      if (!chat) {
        sendJson(res, 404, { ok: false, error: 'Conversa não encontrada.' });
        return true;
      }
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      const index = Number(body.index);
      const target = messages[index];
      if (!target || target.role !== 'assistant') {
        sendJson(res, 400, { ok: false, error: 'Só é possível avaliar uma resposta da IA.' });
        return true;
      }
      const skillIds = Array.isArray(chat.skillIds) ? chat.skillIds : [];
      if (!skillIds.length) {
        sendJson(res, 400, { ok: false, error: 'Adicione uma skill como contexto para avaliar a resposta.' });
        return true;
      }
      let question = '';
      for (let i = index - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'user') {
          question = messages[i].content || '';
          break;
        }
      }
      const moodRe = new RegExp('^\\s*\\[(' + BUDDY_POSES.join('|') + ')\\]\\s*', 'i');
      const answer = String(target.content || '').replace(moodRe, '');
      const conversation = [
        { role: 'user', content: question },
        { role: 'assistant', content: answer }
      ];
      const user = actor.email || actor.name || 'usuário não identificado';
      try {
        for (const skillId of skillIds) {
          await recordFeedback({
            timestamp: new Date().toISOString(),
            user,
            skillId,
            verdict,
            source: 'balde-chat',
            conversation
          });
          // Actionable verdicts notify the skill's stewards (Bom stays quiet — it isn't a work item).
          if (verdict !== 'bom') emitNotifyFeedback({ skillId, verdict, actor, question, answer });
        }
        sendJson(res, 200, { ok: true, verdict, skills: skillIds.length });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/chats/delete') {
      const body = await readJsonBody(req);
      const actor = actorFromReq(req);
      try {
        const dir = userChatsDir(actor);
        if (dir) {
          assertSafeChatId(body.id);
          await rm(join(dir, `${body.id}.json`), { force: true });
          await removeConversationFiles(chatFilesDir(actor, body.id));
        }
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/chats/file') {
      const actor = actorFromReq(req);
      const chat = await readChat(actor, url.searchParams.get('id'));
      if (!chat) {
        sendJson(res, 404, { ok: false, error: 'Conversa não encontrada.' });
        return true;
      }
      const fileId = url.searchParams.get('file');
      const meta = findAttachmentMeta(chat.messages, fileId);
      const found = meta && (await findMessageAttachment(chatFilesDir(actor, chat.id), fileId));
      if (!meta || !found) {
        sendJson(res, 404, { ok: false, error: 'Anexo não encontrado.' });
        return true;
      }
      await serveFileBytes(
        res,
        found.full,
        meta.name,
        meta.mime,
        url.searchParams.get('inline') === '1' && isImageMime(meta.mime)
      );
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/chats/skill-files') {
      const actor = actorFromReq(req);
      const chat = await readChat(actor, url.searchParams.get('id'));
      if (!chat) {
        sendJson(res, 404, { ok: false, error: 'Conversa não encontrada.' });
        return true;
      }
      sendJson(res, 200, { ok: true, skills: await conversationSkillFiles(chat.skillIds, actor) });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/chats/skill-file') {
      const actor = actorFromReq(req);
      const chat = await readChat(actor, url.searchParams.get('id'));
      if (!chat) {
        sendJson(res, 404, { ok: false, error: 'Conversa não encontrada.' });
        return true;
      }
      await serveContextSkillFile(res, url, actor, chat.skillIds);
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/chats/corpus-file') {
      const actor = actorFromReq(req);
      const chat = await readChat(actor, url.searchParams.get('id'));
      if (!chat) {
        sendJson(res, 404, { ok: false, error: 'Conversa não encontrada.' });
        return true;
      }
      await serveCorpusRef(res, url, actor, chat.skillIds);
      return true;
    }
    return false;
  };
}
