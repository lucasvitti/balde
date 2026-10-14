import { withFileLock } from '../storage/file-lock.mjs';
import { join } from 'node:path';
import { operationKey, runOperation, serializeOperation } from './operations.mjs';

export function createPublicationRoute({
  readBody,
  sendJson,
  actorOf,
  authorize,
  loadItem,
  writeItem,
  queueRoot,
  repo,
  repoDirectory,
  evaluate,
  publish,
  commit,
  workingText
}) {
  return async function publicationRoute(req, res, url) {
    if (req.method !== 'POST' || !['/api/publish', '/api/rollback'].includes(url.pathname)) return false;
    // Publicar é ação de curadoria (D1): o criador e os curadores, com a pasta do balde gravável; quem aceitou
    // os itens obrigatórios da avaliação também publica. authorize responde o 403 com o motivo.
    if (!(await authorize(req, res))) return true;
    const body = await readBody(req);
    const actor = actorOf(req);
    const action = url.pathname === '/api/publish' ? 'publish' : 'rollback';
    try {
      // A contribuição identifica a operação mesmo se o navegador perder seu UUID.
      const operationId = body.queueItemId
        ? operationKey(`queue:${repo()}:${body.queueItemId}`)
        : body.operationId ||
          operationKey(`${actor.email}:${body.skillId}:${await workingText(body.skillId)}:${JSON.stringify(body)}`);
      const execute = () =>
        runOperation(
          join(repoDirectory(), '.balde', 'operations'),
          `publish-${operationId}`,
          { ...body, operationId, actor: actor.email, action },
          async ({ checkpoint }) => {
            let item;
            if (body.queueItemId) {
              item = await loadItem(body.queueItemId);
              if (!item || (item.repo || 'corporate') !== repo() || item.skillId !== body.skillId)
                throw new Error('A contribuição não pertence a esta skill e balde.');
              if (item.status !== 'pendente' && item.review?.publicationId !== operationId)
                throw new Error('A contribuição já recebeu outra decisão.');
            }
            const publication = await checkpoint('publication', async () => {
              if (action === 'publish') {
                const evaluation = await evaluate(body.skillId);
                if (evaluation.overall !== 'pass')
                  throw new Error('A avaliação precisa passar antes da publicação. O rascunho foi preservado.');
              }
              return publish({ ...body, action, actor, operationId, queueItemId: item?.id || null });
            });
            await checkpoint('history', () => commit(body.skillId, actor));
            if (item)
              await checkpoint('closure', async () => {
                item = await loadItem(item.id);
                if (item.status !== 'pendente' && item.review?.publicationId !== operationId)
                  throw new Error('Outra decisão foi registrada; a publicação foi preservada para reconciliação.');
                item.status = 'aprovado';
                item.review = {
                  by: actor.name,
                  email: actor.email,
                  at: publication.approvedAt,
                  decision: 'aprovado',
                  publicationId: operationId,
                  mergedInto: item.skillId,
                  viaMergeReview: true
                };
                await writeItem(item);
                return { id: item.id, status: item.status };
              });
            return { ok: true, action, operationId, publication, queueClosed: Boolean(item) };
          }
        );
      const result = body.queueItemId
        ? await serializeOperation(`${queueRoot()}:${body.queueItemId}`, () =>
            withFileLock(join(queueRoot(), '_locks', operationKey(body.queueItemId) + '.lock'), execute)
          )
        : await execute();
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 409, { ok: false, retryable: true, error: error.message });
    }
    return true;
  };
}
