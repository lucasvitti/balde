export function createConversationsActions({
  state,
  renderShell,
  toast,
  newChat,
  chatToggleExpand,
  scrollChatToBottom,
  exportChatYaml,
  exportPlenariaYaml,
  openChatItem,
  sendChatMessage,
  deleteChat,
  removeChatSkill,
  rateChatMessage,
  ensureChatState,
  saveChatRename,
  newPlenaria,
  toggleJoinPlenaria,
  joinPlenaria,
  openPlenariaItem,
  sendPlenariaMessage,
  ratePlenariaMessage,
  removePlenariaSkill,
  copyPlenariaKey,
  regeneratePlenariaKey,
  leavePlenaria,
  deletePlenaria,
  ensurePlenariaState,
  savePlenariaRename,
  removePendingAttachment,
  skillPickerState,
  addPlenariaSkill,
  addChatSkill,
  toggleSkillFiles,
  openImageLightbox
}) {
  // Cada ação reconhecida encerra o despacho para evitar efeitos duplicados.
  return async function handleAction(action, event) {
    const actionName = action.dataset.action;
    const id = action.dataset.id;
    if (actionName === 'newChat') {
      await newChat();
      return true;
    }
    if (actionName === 'chatToggleExpand') {
      chatToggleExpand();
      return true;
    }
    if (actionName === 'chatScrollBottom') {
      scrollChatToBottom();
      return true;
    }
    if (actionName === 'exportChat') {
      exportChatYaml();
      return true;
    }
    if (actionName === 'exportPlenaria') {
      exportPlenariaYaml();
      return true;
    }
    if (actionName === 'openChatItem') {
      openChatItem(id);
      return true;
    }
    if (actionName === 'sendChat') {
      await sendChatMessage();
      return true;
    }
    if (actionName === 'deleteChat') {
      await deleteChat(id);
      return true;
    }
    if (actionName === 'removeChatSkill') {
      removeChatSkill(id);
      return true;
    }
    if (actionName === 'rateChat') {
      await rateChatMessage(Number(action.dataset.index), action.dataset.verdict);
      return true;
    }
    if (actionName === 'renameChat') {
      const chat = ensureChatState();
      chat.renamingId = id;
      renderShell();
      const input = document.querySelector('[data-chat-rename-input]');
      if (input) {
        input.focus();
        input.select();
      }
      return true;
    }
    if (actionName === 'saveChatRename') {
      await saveChatRename(id);
      return true;
    }
    if (actionName === 'cancelChatRename') {
      ensureChatState().renamingId = null;
      renderShell();
      return true;
    }
    if (actionName === 'newPlenaria') {
      await newPlenaria();
      return true;
    }
    if (actionName === 'toggleJoinPlenaria') {
      toggleJoinPlenaria();
      return true;
    }
    if (actionName === 'joinPlenaria') {
      await joinPlenaria();
      return true;
    }
    if (actionName === 'openPlenariaItem') {
      await openPlenariaItem(id);
      return true;
    }
    if (actionName === 'sendPlenaria') {
      await sendPlenariaMessage();
      return true;
    }
    if (actionName === 'ratePlenaria') {
      await ratePlenariaMessage(Number(action.dataset.index), action.dataset.verdict);
      return true;
    }
    if (actionName === 'removePlenariaSkill') {
      removePlenariaSkill(id);
      return true;
    }
    if (actionName === 'copyPlenariaKey') {
      await copyPlenariaKey();
      return true;
    }
    if (actionName === 'regeneratePlenariaKey') {
      await regeneratePlenariaKey(id);
      return true;
    }
    if (actionName === 'leavePlenaria') {
      await leavePlenaria(id);
      return true;
    }
    if (actionName === 'deletePlenaria') {
      await deletePlenaria(id);
      return true;
    }
    if (actionName === 'renamePlenaria') {
      const pl = ensurePlenariaState();
      pl.renamingId = id;
      renderShell();
      const input = document.querySelector('[data-plenaria-rename-input]');
      if (input) {
        input.focus();
        input.select();
      }
      return true;
    }
    if (actionName === 'savePlenariaRename') {
      await savePlenariaRename(id);
      return true;
    }
    if (actionName === 'cancelPlenariaRename') {
      ensurePlenariaState().renamingId = null;
      renderShell();
      return true;
    }
    if (actionName === 'attachFile') {
      const input = document.querySelector(`[data-file-input="${action.dataset.kind}"]`);
      if (input) {
        input.click();
      }
      return true;
    }
    if (actionName === 'removePending') {
      removePendingAttachment(action.dataset.kind, Number(action.dataset.idx));
      return true;
    }
    if (actionName === 'toggleSkillPicker') {
      const sp = skillPickerState();
      const kind = action.dataset.kind;
      const opening = sp.kind !== kind;
      sp.kind = opening ? kind : null;
      if (opening) {
        sp.query = '';
      } // fresh search; the domain filter persists
      renderShell();
      const q = document.querySelector(`[data-skill-picker-query="${kind}"]`);
      if (q) {
        q.focus();
      }
      return true;
    }
    if (actionName === 'closeSkillPicker') {
      skillPickerState().kind = null;
      renderShell();
      return true;
    }
    if (actionName === 'pickSkill') {
      const kind = action.dataset.kind;
      const id = action.dataset.id;
      const sk = (state.skills || []).find((x) => x.id === id);
      if (sk && sk.deprecated) {
        toast(
          `Atenção: "${sk.nome}" está depreciada — ${((sk.deprecation || {}).reasons || []).join('; ') || 'conteúdo possivelmente desatualizado'}. A IA será instruída a ressalvar as respostas.`,
          'warning'
        );
      }
      const sp = skillPickerState();
      sp.kind = null;
      sp.query = '';
      if (kind === 'plenarias') {
        addPlenariaSkill(id);
      } else {
        addChatSkill(id);
      }
      return true;
    }
    if (actionName === 'toggleSkillFiles') {
      await toggleSkillFiles(action.dataset.kind);
      return true;
    }
    if (actionName === 'viewImage') {
      openImageLightbox({ src: action.dataset.full, download: action.dataset.download, name: action.dataset.name });
      return true;
    }
    return false;
  };
}
