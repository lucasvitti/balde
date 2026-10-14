export function createCapsulesActions({
  state,
  renderShell,
  openEditCommons,
  commonsToggleClosed,
  archiveCapsuleConfirm,
  commonsMigratePlan,
  migrateToCapsule,
  commonsMigrateToggle,
  commonsMigrateApply,
  commonsMigrateCancel,
  commonsRunEval,
  commonsSummarizeAll,
  openCommonsFile,
  closeCommonsFile,
  toggleCommonsEdit,
  saveCommonsFile,
  commonsProcessMedia,
  commonsSetPage,
  isLocalShell,
  commonsModalValidate
}) {
  // Cada ação reconhecida encerra o despacho para evitar efeitos duplicados.
  return async function handleAction(action, event) {
    const actionName = action.dataset.action;
    const id = action.dataset.id;
    if (actionName === 'editCommons') {
      await openEditCommons(action.dataset.path);
      return true;
    }
    if (actionName === 'commonsToggleClosed') {
      await commonsToggleClosed(action.dataset.path, action.dataset.close === '1');
      return true;
    }
    if (actionName === 'archiveCapsule') {
      archiveCapsuleConfirm(action.dataset.path);
      return true;
    }
    if (actionName === 'commonsMigratePlan') {
      await commonsMigratePlan(action.dataset.id);
      return true;
    }
    if (actionName === 'migrateToCapsule') {
      await migrateToCapsule(action.dataset.id, action.dataset.path);
      return true;
    }
    if (actionName === 'commonsMigrateToggle') {
      commonsMigrateToggle(action.dataset.path);
      return true;
    }
    if (actionName === 'commonsMigrateApply') {
      await commonsMigrateApply(action.dataset.id);
      return true;
    }
    if (actionName === 'commonsMigrateCancel') {
      commonsMigrateCancel();
      return true;
    }
    if (actionName === 'commonsRunEval') {
      await commonsRunEval(action.dataset.path);
      return true;
    }
    if (actionName === 'commonsSummarizeAll') {
      await commonsSummarizeAll();
      return true;
    }
    if (actionName === 'openCommonsFile') {
      await openCommonsFile(action.dataset.path);
      return true;
    }
    if (actionName === 'closeCommonsFile') {
      closeCommonsFile();
      return true;
    }
    if (actionName === 'toggleCommonsEdit') {
      toggleCommonsEdit();
      return true;
    }
    if (actionName === 'saveCommonsFile') {
      await saveCommonsFile();
      return true;
    }
    if (actionName === 'commonsProcessMedia') {
      await commonsProcessMedia(action.dataset.path);
      return true;
    }
    if (actionName === 'commonsPagePrev') {
      commonsSetPage(-1);
      return true;
    }
    if (actionName === 'commonsPageNext') {
      commonsSetPage(1);
      return true;
    }
    if (actionName === 'commonsSetMode') {
      state.commons = state.commons || {};
      state.commons.mode = action.dataset.mode;
      state.commons.page = 0;
      renderShell();
      return true;
    }
    if (actionName === 'commonsReviewOpen') {
      // Open the review tab via script so the "Validar" button there can window.close() it.
      // Flavor: navegador = página de revisão em nova aba; shell local = popup interno (o
      // _blank do WebView2 cairia no navegador do sistema).
      if (isLocalShell()) {
        await openCommonsFile(action.dataset.path || '', { review: true });
        return true;
      }
      window.open(`/api/commons/file/view?path=${encodeURIComponent(action.dataset.path || '')}&review=1`, '_blank');
      return true;
    }
    if (actionName === 'commonsFilePopup') {
      await openCommonsFile(action.dataset.path || '');
      return true;
    }
    if (actionName === 'commonsModalValidate') {
      await commonsModalValidate(action.dataset.path || '');
      return true;
    }
    return false;
  };
}
