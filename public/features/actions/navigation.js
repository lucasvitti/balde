export function createNavigationActions({ state, renderShell, logout, toggleSidebar, toggleNavCat }) {
  // Cada ação reconhecida encerra o despacho para evitar efeitos duplicados.
  return async function handleAction(action, event) {
    const actionName = action.dataset.action;
    const id = action.dataset.id;
    if (actionName === 'retryLocalSession') {
      location.reload();
      return true;
    }
    if (actionName === 'logout') {
      await logout();
      return true;
    }
    if (actionName === 'toggleSidebar') {
      toggleSidebar();
      return true;
    }
    if (actionName === 'toggleNavCat') {
      toggleNavCat(action.dataset.cat);
      return true;
    }
    if (actionName === 'openAbout') {
      state.aboutOpen = true;
      renderShell();
      return true;
    }
    if (actionName === 'closeAbout') {
      // fecha no botão Fechar ou num clique fora do cartão (backdrop); cliques dentro não fecham
      if (action.tagName === 'BUTTON' || !event.target.closest('.modal')) {
        state.aboutOpen = false;
        renderShell();
      }
      return true;
    }
    if (actionName === 'confirmRollback') {
      state.confirm = {
        type: 'rollback',
        title: 'Confirmar rollback',
        body: `Republicar o conteúdo da versão ${action.dataset.version} como nova versão corrente?`,
        confirmLabel: 'Registrar rollback',
        id,
        version: action.dataset.version
      };
      renderShell();
      return true;
    }
    if (actionName === 'confirmDraftRollback') {
      state.confirm = {
        type: 'draftRollback',
        title: 'Confirmar rollback do rascunho',
        body: `Restaurar o rascunho para o snapshot anterior a "${action.dataset.summary || 'esta alteração'}"? O estado atual também será salvo em legado antes da restauração.`,
        confirmLabel: 'Restaurar rascunho',
        id,
        entryId: action.dataset.entryId
      };
      renderShell();
      return true;
    }
    if (actionName === 'cancelConfirm') {
      state.confirm = null;
      renderShell();
      return true;
    }
    return false;
  };
}
