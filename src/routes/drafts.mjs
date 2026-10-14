import { actorFromReq } from '../git-corpus.mjs';

export function createDraftsRoutes({
  readJsonBody,
  permitReq,
  sendJson,
  persistManualSkillTextEdit,
  commitCorpus,
  persistContextUpload,
  regenerateContextIndex,
  rollbackDraftChange,
  persistDraftRequirementApproval
}) {
  return async function draftsRoutes(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/skill-source/save') {
      const body = await readJsonBody(req);
      if (!(await permitReq(req, res, 'curar'))) return true;
      const draftApproval = await persistManualSkillTextEdit({
        skillId: body.skillId,
        sourceText: body.sourceText,
        editedBy: body.editedBy
      });

      await commitCorpus(`skill(${body.skillId}): edição de texto`, actorFromReq(req), [body.skillId]);

      sendJson(res, 200, {
        ok: true,
        timestamp: new Date().toISOString(),
        action: 'manual-text-edit',
        draftApproval
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/skill-source/upload-context') {
      const body = await readJsonBody(req);
      if (!(await permitReq(req, res, 'curar'))) return true;
      const draftApproval = await persistContextUpload({
        skillId: body.skillId,
        targetKind: body.targetKind,
        files: body.files || [],
        uploadedBy: body.uploadedBy
      });
      // A2: refresh AI context summaries after new context is uploaded (best-effort).
      regenerateContextIndex(body.skillId, actorFromReq(req)).catch(() => {});

      sendJson(res, 200, {
        ok: true,
        timestamp: new Date().toISOString(),
        action: 'upload-context',
        draftApproval
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/skill-source/rollback-draft') {
      const body = await readJsonBody(req);
      if (!(await permitReq(req, res, 'curar'))) return true;
      const draftApproval = await rollbackDraftChange({
        skillId: body.skillId,
        entryId: body.entryId,
        rolledBackBy: body.rolledBackBy
      });

      sendJson(res, 200, {
        ok: true,
        timestamp: new Date().toISOString(),
        action: 'rollback-draft',
        draftApproval
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/approve-requirement') {
      const body = await readJsonBody(req);
      if (!(await permitReq(req, res, 'curar'))) return true;
      const draftApproval = await persistDraftRequirementApproval({
        skillId: body.skillId,
        changeRequest: body.changeRequest
      });

      sendJson(res, 200, {
        ok: true,
        timestamp: new Date().toISOString(),
        action: 'approve-requirement',
        draftApproval
      });
      return true;
    }
    return false;
  };
}
