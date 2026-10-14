import { CHAT_MAX_MESSAGE } from '../policy/chat-policy.mjs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { plenariasRoot, BUDDY_POSES } from '../config.mjs';
import { actorFromReq } from '../git-corpus.mjs';

export function createPlenariaRoutes({
  sendJson,
  listPlenariasFor,
  readJsonBody,
  actorEmail,
  actorLabel,
  newPlenariaId,
  sanitizeChatSkillIds,
  newPlenariaKey,
  writePlenaria,
  plenariaView,
  findPlenariaByKey,
  withPlenariaLock,
  readPlenaria,
  plenariaBroadcast,
  plenariaIsMember,
  plenariaSubscribe,
  plenariaOnline,
  QUEUE_MAX_BODY,
  storeMessageAttachments,
  plenariaFilesDir,
  plenariaShouldTriggerBuddy,
  runPlenariaBuddyReply,
  plenariaIsOwner,
  assertSafePlenariaId,
  removeConversationFiles,
  recordFeedback,
  emitNotifyFeedback,
  findAttachmentMeta,
  findMessageAttachment,
  serveFileBytes,
  isImageMime,
  conversationSkillFiles,
  serveContextSkillFile,
  serveCorpusRef
}) {
  return async function plenariaRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/plenarias') {
      sendJson(res, 200, { ok: true, plenarias: await listPlenariasFor(actorFromReq(req)) });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/plenarias') {
      const body = await readJsonBody(req);
      const actor = actorFromReq(req);
      if (!actorEmail(actor)) {
        sendJson(res, 400, { ok: false, error: 'Identidade do usuário não disponível.' });
        return true;
      }
      const now = new Date().toISOString();
      const owner = { name: actorLabel(actor), email: actorEmail(actor) };
      const plenaria = {
        id: newPlenariaId(),
        type: 'plenaria',
        title:
          String(body.title || '')
            .trim()
            .slice(0, 120) || 'Nova plenária',
        skillIds: await sanitizeChatSkillIds(body.skillIds),
        joinKey: newPlenariaKey(),
        owner,
        participants: [{ ...owner, joinedAt: now }],
        messages: [],
        createdAt: now,
        updatedAt: now
      };
      await writePlenaria(plenaria);
      sendJson(res, 201, { ok: true, plenaria: plenariaView(plenaria, actor) });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/plenarias/join') {
      const body = await readJsonBody(req);
      const actor = actorFromReq(req);
      if (!actorEmail(actor)) {
        sendJson(res, 400, { ok: false, error: 'Identidade do usuário não disponível.' });
        return true;
      }
      const found = await findPlenariaByKey(body.key);
      if (!found) {
        sendJson(res, 404, { ok: false, error: 'Chave inválida ou plenária não encontrada.' });
        return true;
      }
      const email = actorEmail(actor);
      let joined = found;
      let isNew = false;
      await withPlenariaLock(found.id, async () => {
        const fresh = await readPlenaria(found.id);
        if (!fresh) return;
        fresh.participants = fresh.participants || [];
        if (!fresh.participants.some((p) => actorEmail(p) === email)) {
          fresh.participants.push({ name: actorLabel(actor), email, joinedAt: new Date().toISOString() });
          await writePlenaria(fresh);
          isNew = true;
        }
        joined = fresh;
      });
      if (isNew) {
        plenariaBroadcast(found.id, {
          type: 'joined',
          participant: { name: actorLabel(actor), email },
          participants: (joined.participants || []).map((p) => ({ name: p.name, email: p.email, joinedAt: p.joinedAt }))
        });
      }
      sendJson(res, 200, { ok: true, plenaria: plenariaView(joined, actor) });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/plenarias/item') {
      const actor = actorFromReq(req);
      const plenaria = await readPlenaria(url.searchParams.get('id'));
      if (!plenaria) {
        sendJson(res, 404, { ok: false, error: 'Plenária não encontrada.' });
        return true;
      }
      if (!plenariaIsMember(plenaria, actor)) {
        sendJson(res, 403, { ok: false, error: 'Você não participa desta plenária. Entre com a chave.' });
        return true;
      }
      sendJson(res, 200, { ok: true, plenaria: plenariaView(plenaria, actor) });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/plenarias/stream') {
      const actor = actorFromReq(req);
      const id = url.searchParams.get('id');
      const plenaria = await readPlenaria(id);
      if (!plenaria) {
        sendJson(res, 404, { ok: false, error: 'Plenária não encontrada.' });
        return true;
      }
      if (!plenariaIsMember(plenaria, actor)) {
        sendJson(res, 403, { ok: false, error: 'Você não participa desta plenária.' });
        return true;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      });
      res.write(': open\n\n');
      res._plenariaEmail = actorEmail(actor);
      const unsubscribe = plenariaSubscribe(id, res);
      plenariaBroadcast(id, { type: 'presence', online: plenariaOnline(id) });
      const heartbeat = setInterval(() => {
        try {
          res.write(': hb\n\n');
        } catch {
          /* ignore */
        }
      }, 15000);
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        plenariaBroadcast(id, { type: 'presence', online: plenariaOnline(id) });
      };
      req.on('close', cleanup);
      req.on('aborted', cleanup);
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/plenarias/message') {
      const body = await readJsonBody(req, QUEUE_MAX_BODY);
      const actor = actorFromReq(req);
      const plenaria = await readPlenaria(body.id);
      if (!plenaria) {
        sendJson(res, 404, { ok: false, error: 'Plenária não encontrada.' });
        return true;
      }
      if (!plenariaIsMember(plenaria, actor)) {
        sendJson(res, 403, { ok: false, error: 'Você não participa desta plenária.' });
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
      let atts = [];
      try {
        atts = await storeMessageAttachments(plenariaFilesDir(body.id), body.attachments);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
        return true;
      }
      const message = {
        role: 'user',
        content,
        at: new Date().toISOString(),
        author: { name: actorLabel(actor), email: actorEmail(actor) },
        ...(atts.length ? { attachments: atts } : {})
      };
      let newTitle = null;
      await withPlenariaLock(body.id, async () => {
        const fresh = await readPlenaria(body.id);
        if (!fresh) return;
        fresh.messages = fresh.messages || [];
        fresh.messages.push(message);
        if ((!fresh.title || fresh.title === 'Nova plenária') && content) {
          fresh.title = content.slice(0, 60);
          newTitle = fresh.title;
        }
        await writePlenaria(fresh);
      });
      plenariaBroadcast(body.id, { type: 'message', message });
      if (newTitle) {
        plenariaBroadcast(body.id, { type: 'meta', title: newTitle });
      }
      const triggered = await plenariaShouldTriggerBuddy(plenaria, content, !!body.askBuddy);
      if (triggered) {
        runPlenariaBuddyReply(body.id, actor).catch(() => {});
      }
      sendJson(res, 200, { ok: true, triggered });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/plenarias/skills') {
      const body = await readJsonBody(req);
      const actor = actorFromReq(req);
      const plenaria = await readPlenaria(body.id);
      if (!plenaria) {
        sendJson(res, 404, { ok: false, error: 'Plenária não encontrada.' });
        return true;
      }
      if (!plenariaIsOwner(plenaria, actor)) {
        sendJson(res, 403, { ok: false, error: 'Apenas o organizador pode alterar o contexto.' });
        return true;
      }
      let view = plenaria;
      await withPlenariaLock(body.id, async () => {
        const fresh = await readPlenaria(body.id);
        if (!fresh) return;
        fresh.skillIds = await sanitizeChatSkillIds(body.skillIds);
        await writePlenaria(fresh);
        view = fresh;
      });
      plenariaBroadcast(body.id, { type: 'skills', skillIds: Array.isArray(view.skillIds) ? view.skillIds : [] });
      sendJson(res, 200, { ok: true, plenaria: plenariaView(view, actor) });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/plenarias/rename') {
      const body = await readJsonBody(req);
      const actor = actorFromReq(req);
      const plenaria = await readPlenaria(body.id);
      if (!plenaria) {
        sendJson(res, 404, { ok: false, error: 'Plenária não encontrada.' });
        return true;
      }
      if (!plenariaIsOwner(plenaria, actor)) {
        sendJson(res, 403, { ok: false, error: 'Apenas o organizador pode renomear a plenária.' });
        return true;
      }
      let view = plenaria;
      await withPlenariaLock(body.id, async () => {
        const fresh = await readPlenaria(body.id);
        if (!fresh) return;
        fresh.title =
          String(body.title || '')
            .trim()
            .slice(0, 120) || fresh.title;
        await writePlenaria(fresh);
        view = fresh;
      });
      plenariaBroadcast(body.id, { type: 'meta', title: view.title });
      sendJson(res, 200, { ok: true, plenaria: plenariaView(view, actor) });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/plenarias/regenerate-key') {
      const body = await readJsonBody(req);
      const actor = actorFromReq(req);
      const plenaria = await readPlenaria(body.id);
      if (!plenaria) {
        sendJson(res, 404, { ok: false, error: 'Plenária não encontrada.' });
        return true;
      }
      if (!plenariaIsOwner(plenaria, actor)) {
        sendJson(res, 403, { ok: false, error: 'Apenas o organizador pode gerar uma nova chave.' });
        return true;
      }
      let key = plenaria.joinKey;
      await withPlenariaLock(body.id, async () => {
        const fresh = await readPlenaria(body.id);
        if (!fresh) return;
        fresh.joinKey = newPlenariaKey();
        await writePlenaria(fresh);
        key = fresh.joinKey;
      });
      sendJson(res, 200, { ok: true, joinKey: key });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/plenarias/leave') {
      const body = await readJsonBody(req);
      const actor = actorFromReq(req);
      const plenaria = await readPlenaria(body.id);
      if (!plenaria) {
        sendJson(res, 200, { ok: true });
        return true;
      }
      if (plenariaIsOwner(plenaria, actor)) {
        sendJson(res, 400, { ok: false, error: 'O organizador não pode sair; exclua a plenária.' });
        return true;
      }
      const email = actorEmail(actor);
      let participants = plenaria.participants || [];
      await withPlenariaLock(body.id, async () => {
        const fresh = await readPlenaria(body.id);
        if (!fresh) return;
        fresh.participants = (fresh.participants || []).filter((p) => actorEmail(p) !== email);
        await writePlenaria(fresh);
        participants = fresh.participants;
      });
      plenariaBroadcast(body.id, {
        type: 'left',
        email,
        participants: participants.map((p) => ({ name: p.name, email: p.email, joinedAt: p.joinedAt }))
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/plenarias/delete') {
      const body = await readJsonBody(req);
      const actor = actorFromReq(req);
      const plenaria = await readPlenaria(body.id);
      if (!plenaria) {
        sendJson(res, 200, { ok: true });
        return true;
      }
      if (!plenariaIsOwner(plenaria, actor)) {
        sendJson(res, 403, { ok: false, error: 'Apenas o organizador pode excluir a plenária.' });
        return true;
      }
      try {
        assertSafePlenariaId(body.id);
        plenariaBroadcast(body.id, { type: 'deleted' });
        await rm(join(plenariasRoot, `${body.id}.json`), { force: true });
        await removeConversationFiles(plenariaFilesDir(body.id));
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/plenarias/feedback') {
      const body = await readJsonBody(req);
      const verdict = String(body.verdict || '').toLowerCase();
      if (!['bom', 'fraco', 'errado'].includes(verdict)) {
        sendJson(res, 400, { ok: false, error: 'Veredito inválido. Use bom, fraco ou errado.' });
        return true;
      }
      const actor = actorFromReq(req);
      const plenaria = await readPlenaria(body.id);
      if (!plenaria) {
        sendJson(res, 404, { ok: false, error: 'Plenária não encontrada.' });
        return true;
      }
      if (!plenariaIsMember(plenaria, actor)) {
        sendJson(res, 403, { ok: false, error: 'Você não participa desta plenária.' });
        return true;
      }
      const messages = Array.isArray(plenaria.messages) ? plenaria.messages : [];
      const index = Number(body.index);
      const target = messages[index];
      if (!target || target.role !== 'assistant') {
        sendJson(res, 400, { ok: false, error: 'Só é possível avaliar uma resposta da IA.' });
        return true;
      }
      const skillIds = Array.isArray(plenaria.skillIds) ? plenaria.skillIds : [];
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
            source: 'balde-plenaria',
            conversation
          });
          if (verdict !== 'bom') emitNotifyFeedback({ skillId, verdict, actor, question, answer });
        }
        sendJson(res, 200, { ok: true, verdict, skills: skillIds.length });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/plenarias/file') {
      const actor = actorFromReq(req);
      const plenaria = await readPlenaria(url.searchParams.get('id'));
      if (!plenaria) {
        sendJson(res, 404, { ok: false, error: 'Plenária não encontrada.' });
        return true;
      }
      if (!plenariaIsMember(plenaria, actor)) {
        sendJson(res, 403, { ok: false, error: 'Você não participa desta plenária.' });
        return true;
      }
      const fileId = url.searchParams.get('file');
      const meta = findAttachmentMeta(plenaria.messages, fileId);
      const found = meta && (await findMessageAttachment(plenariaFilesDir(plenaria.id), fileId));
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

    if (req.method === 'GET' && url.pathname === '/api/plenarias/skill-files') {
      const actor = actorFromReq(req);
      const plenaria = await readPlenaria(url.searchParams.get('id'));
      if (!plenaria) {
        sendJson(res, 404, { ok: false, error: 'Plenária não encontrada.' });
        return true;
      }
      if (!plenariaIsMember(plenaria, actor)) {
        sendJson(res, 403, { ok: false, error: 'Você não participa desta plenária.' });
        return true;
      }
      sendJson(res, 200, { ok: true, skills: await conversationSkillFiles(plenaria.skillIds, actor) });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/plenarias/skill-file') {
      const actor = actorFromReq(req);
      const plenaria = await readPlenaria(url.searchParams.get('id'));
      if (!plenaria) {
        sendJson(res, 404, { ok: false, error: 'Plenária não encontrada.' });
        return true;
      }
      if (!plenariaIsMember(plenaria, actor)) {
        sendJson(res, 403, { ok: false, error: 'Você não participa desta plenária.' });
        return true;
      }
      await serveContextSkillFile(res, url, actor, plenaria.skillIds);
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/plenarias/corpus-file') {
      const actor = actorFromReq(req);
      const plenaria = await readPlenaria(url.searchParams.get('id'));
      if (!plenaria) {
        sendJson(res, 404, { ok: false, error: 'Plenária não encontrada.' });
        return true;
      }
      if (!plenariaIsMember(plenaria, actor)) {
        sendJson(res, 403, { ok: false, error: 'Você não participa desta plenária.' });
        return true;
      }
      await serveCorpusRef(res, url, actor, plenaria.skillIds);
      return true;
    }
    return false;
  };
}
