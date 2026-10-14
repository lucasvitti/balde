export function createBuddiesActions({
  state,
  renderShell,
  loadBuddyDetail,
  toggleBuddyGroup,
  applyGlobalBuddyTheme,
  expandAllBuddyGroups,
  collapseAllBuddyGroups,
  pickBuddyGroup,
  openPoseView,
  closePoseView,
  removePoseView,
  openBuddyUpload,
  closeBuddyUpload,
  submitBuddyUpload,
  openBuddyEdit,
  closeBuddyEdit,
  submitBuddyEdit,
  markRemovePose,
  undoRemovePose,
  pluralize
}) {
  // Cada ação reconhecida encerra o despacho para evitar efeitos duplicados.
  return async function handleAction(action, event) {
    const actionName = action.dataset.action;
    const id = action.dataset.id;
    if (actionName === 'buddySelect') {
      await loadBuddyDetail(action.dataset.id);
      return true;
    }
    if (actionName === 'toggleBuddyGroup') {
      toggleBuddyGroup(action.dataset.group);
      return true;
    }
    if (actionName === 'applyGlobalBuddyTheme') {
      await applyGlobalBuddyTheme();
      return true;
    }
    if (actionName === 'expandAllBuddyGroups') {
      expandAllBuddyGroups();
      return true;
    }
    if (actionName === 'collapseAllBuddyGroups') {
      collapseAllBuddyGroups();
      return true;
    }
    if (actionName === 'pickBuddyGroup') {
      pickBuddyGroup(action.dataset.group);
      return true;
    }
    if (actionName === 'openPoseView') {
      openPoseView(action.dataset.code);
      return true;
    }
    if (actionName === 'closePoseView') {
      closePoseView();
      return true;
    }
    if (actionName === 'removePoseView') {
      await removePoseView();
      return true;
    }
    if (actionName === 'openBuddyUpload') {
      openBuddyUpload();
      return true;
    }
    if (actionName === 'closeBuddyUpload') {
      closeBuddyUpload();
      return true;
    }
    if (actionName === 'submitBuddyUpload') {
      await submitBuddyUpload();
      return true;
    }
    if (actionName === 'openBuddyEdit') {
      openBuddyEdit(action.dataset.id);
      return true;
    }
    if (actionName === 'closeBuddyEdit') {
      closeBuddyEdit();
      return true;
    }
    if (actionName === 'submitBuddyEdit') {
      await submitBuddyEdit();
      return true;
    }
    if (actionName === 'removePose') {
      markRemovePose(action.dataset.code);
      return true;
    }
    if (actionName === 'undoPose') {
      undoRemovePose(action.dataset.code);
      return true;
    }
    if (actionName === 'confirmDeleteBuddy') {
      const detail = state.buddies && state.buddies.detail;
      const usedBy = (detail && detail.usedBy) || [];
      state.confirm = {
        type: 'deleteBuddy',
        title: 'Excluir buddy',
        body: `Excluir "${(detail && detail.name) || action.dataset.id}"? ${usedBy.length ? `${pluralize(usedBy.length, 'skill')} que usa esse buddy ficará stale (o avatar some; a skill continua funcionando).` : 'Nenhuma skill usa esse buddy.'}`,
        confirmLabel: 'Excluir buddy',
        id: action.dataset.id
      };
      renderShell();
      return true;
    }
    return false;
  };
}
