export function createGovernanceActions({
  state,
  renderShell,
  openQueueItem,
  queuePreprocess,
  queueReassign,
  queueDecide,
  filaStep,
  queueCapsuleEditStart,
  queueCapsuleEditCancel,
  saveCapsuleEdit,
  queueCapsuleAclAdd,
  queueCapsuleAclRemove,
  queueCapsuleSeedBody,
  toast,
  insertLinkrefTrigger,
  runAnalysis,
  runEvals,
  publishSuggestion,
  approveProposal,
  generateProposalWithAi,
  openReturnProposal,
  confirmReturnProposal,
  openManualAdjustment,
  saveManualAdjustment,
  generateAdjustmentWithAi,
  navigate,
  openFilaItem,
  mergeStart,
  mergePromote,
  mergeClose,
  mergeAnalyse,
  mergeToggleEdit,
  mergeCloseEditor,
  mergeSkipFile,
  mergeGoto,
  mergeWriteAndEval,
  mergePublish,
  feedbackToContribution,
  feedbackDismiss,
  restoreArchived
}) {
  // Cada ação reconhecida encerra o despacho para evitar efeitos duplicados.
  return async function handleAction(action, event) {
    const actionName = action.dataset.action;
    const id = action.dataset.id;
    if (actionName === 'restoreArchived') {
      await restoreArchived(action.dataset.kind, action.dataset.id);
      return true;
    }
    if (actionName === 'retryHistory') {
      const response = await fetch('/api/queue/history/retry', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        toast(data.error || 'Falha ao registrar histórico.', 'warning');
        return true;
      }
      await navigate('queue');
      return true;
    }
    if (actionName === 'capsuleDiscard') {
      if (
        !window.confirm(
          'Desfazer a aplicação incompleta desta cápsula? O conteúdo volta ao que era antes e a contribuição continua pendente na Fila.'
        )
      )
        return true;
      const response = await fetch('/api/queue/capsule/discard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await response.json();
      if (!response.ok) {
        toast(data.error || 'Falha ao desfazer a aplicação.', 'warning');
        return true;
      }
      toast(
        data.changedByOthers?.length
          ? `Aplicação desfeita. Arquivos alterados depois por outra pessoa ficaram como estão: ${data.changedByOthers.join(', ')}`
          : 'Aplicação desfeita. O balde voltou a funcionar.'
      );
      await navigate('queue');
      return true;
    }
    if (actionName === 'openQueueItem') {
      await openQueueItem(id);
      return true;
    }
    if (actionName === 'queuePreprocess') {
      await queuePreprocess(id);
      return true;
    }
    if (actionName === 'queueApplyAiSkill') {
      await queueReassign(id, action.dataset.skill);
      return true;
    }
    if (actionName === 'queueApprove') {
      await queueDecide(id, 'aprovar');
      return true;
    }
    if (actionName === 'queueReject') {
      await queueDecide(id, 'recusar');
      return true;
    }
    if (actionName === 'filaStep') {
      filaStep(Number(action.dataset.dir) || 0);
      return true;
    }
    if (actionName === 'queueCapsuleEditStart') {
      queueCapsuleEditStart(action.dataset.id);
      return true;
    }
    if (actionName === 'queueCapsuleEditCancel') {
      queueCapsuleEditCancel();
      return true;
    }
    if (actionName === 'queueCapsuleEditSave') {
      await saveCapsuleEdit();
      return true;
    }
    if (actionName === 'queueCapsuleAclAdd') {
      queueCapsuleAclAdd(action.dataset.axis);
      return true;
    }
    if (actionName === 'queueCapsuleAclRemove') {
      queueCapsuleAclRemove(action.dataset.axis, action.dataset.email);
      return true;
    }
    if (actionName === 'queueCapsuleSeedBody') {
      await queueCapsuleSeedBody();
      return true;
    }
    if (actionName === 'runAnalysis') {
      await runAnalysis(id);
      return true;
    }
    if (actionName === 'runEvals') {
      await runEvals(id);
      return true;
    }
    if (actionName === 'publishSuggestion') {
      await publishSuggestion(id, action.dataset.summary);
      return true;
    }
    if (actionName === 'approveProposal') {
      await approveProposal(id);
      return true;
    }
    if (actionName === 'generateProposalWithAi') {
      await generateProposalWithAi(id);
      return true;
    }
    if (actionName === 'discardProposal') {
      await openReturnProposal(id);
      return true;
    }
    if (actionName === 'cancelReturn') {
      state.returning = null;
      renderShell();
      return true;
    }
    if (actionName === 'confirmReturn') {
      await confirmReturnProposal();
      return true;
    }
    if (actionName === 'adjustSuggestion') {
      if (!id) {
        toast('Ajuste manual disponível na fila de aprovações.');
        return true;
      }
      await openManualAdjustment(id);
      return true;
    }
    if (actionName === 'cancelAdjustment') {
      state.adjustment = null;
      renderShell();
      return true;
    }
    if (actionName === 'saveAdjustment') {
      await saveManualAdjustment(false);
      return true;
    }
    if (actionName === 'generateAdjustmentWithAi') {
      await generateAdjustmentWithAi(id);
      return true;
    }
    if (actionName === 'saveAndApproveAdjustment') {
      await saveManualAdjustment(true);
      return true;
    }
    if (actionName === 'discardSuggestion') {
      toast('Sugestão descartada.');
      return true;
    }
    if (actionName === 'mergeToggleFolder') {
      const w = state.mergeWizard;
      if (w) {
        if (!(w.openFolders instanceof Set)) w.openFolders = new Set();
        const folder = action.dataset.folder;
        if (w.openFolders.has(folder)) w.openFolders.delete(folder);
        else w.openFolders.add(folder);
        renderShell();
      }
      return true;
    }
    if (actionName === 'openFilaItem') {
      openFilaItem(action.dataset.kind, action.dataset.id);
      return true;
    }
    if (actionName === 'mergeStart') {
      mergeStart(action.dataset.id);
      return true;
    }
    if (actionName === 'mergePromote') {
      mergePromote(action.dataset.id);
      return true;
    }
    if (actionName === 'mergeClose') {
      mergeClose();
      return true;
    }
    if (actionName === 'mergeAnalyse') {
      await mergeAnalyse();
      return true;
    }
    if (actionName === 'mergeToggleEdit') {
      mergeToggleEdit();
      return true;
    }
    if (actionName === 'mergeCloseEditor') {
      mergeCloseEditor();
      return true;
    }
    if (actionName === 'mergeVincularCommons') {
      insertLinkrefTrigger('mergeBody', 2);
      return true;
    }
    if (actionName === 'mergeVincularSkill') {
      insertLinkrefTrigger('mergeBody', 3);
      return true;
    }
    if (actionName === 'mergeSkipFile') {
      mergeSkipFile();
      return true;
    }
    if (actionName === 'mergeGoto') {
      await mergeGoto(action.dataset.stage);
      return true;
    }
    if (actionName === 'mergeWriteAndEval') {
      await mergeWriteAndEval();
      return true;
    }
    if (actionName === 'mergePublish') {
      await mergePublish();
      return true;
    }
    if (actionName === 'feedbackToContribution') {
      await feedbackToContribution(action.dataset.id);
      return true;
    }
    if (actionName === 'feedbackDismiss') {
      await feedbackDismiss(action.dataset.id);
      return true;
    }
    if (actionName === 'openFilaApprovals') {
      if (!state.fila) state.fila = { kind: 'todos', status: 'pendente', selected: null, feedbackDraft: '' };
      state.fila.kind = 'aprovacao';
      await navigate('queue');
      return true;
    }
    if (actionName === 'generateGovernanceSuggestions') {
      toast('Gerando diretório de sugestões...');
      const response = await fetch('/api/governance/generate-suggestions', { method: 'post' });
      const payload = await response.json();
      const suggestionCount = payload.skills?.reduce((sum, item) => sum + (item.suggestionCount || 0), 0) || 0;
      toast(`Sugestões geradas: ${suggestionCount} em ${payload.outputRoot}.`, 'success');
      return true;
    }
    return false;
  };
}
