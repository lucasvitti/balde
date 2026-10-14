export function createSettingsActions({
  state,
  renderShell,
  toggleStartup,
  switchRepo,
  baldesUserCreate,
  baldesUserMount,
  baldesUserUnmount,
  baldesUserSaveAccess,
  acessoStart,
  acessoCopiar,
  pollAcesso,
  toggleNotifyPref,
  baldesCreate,
  baldesSave,
  meuBaldeCreate,
  setTheme,
  setBuddySize,
  setStartView
}) {
  // Cada ação reconhecida encerra o despacho para evitar efeitos duplicados.
  return async function handleAction(action, event) {
    const actionName = action.dataset.action;
    const id = action.dataset.id;
    if (actionName === 'toggleStartup') {
      await toggleStartup();
      return true;
    }
    if (actionName === 'setSettingsTab') {
      state.settingsTab = action.dataset.settingsTab;
      if (state.settingsTab === 'balde') state.baldesUser = null; // fresh list + folder status on open
      renderShell();
      return true;
    }
    if (actionName === 'switchRepoTo') {
      await switchRepo(action.dataset.repo);
      return true;
    }
    if (actionName === 'baldesUserCreate') {
      await baldesUserCreate();
      return true;
    }
    if (actionName === 'baldesUserMount') {
      await baldesUserMount();
      return true;
    }
    if (actionName === 'baldesUserUnmount') {
      await baldesUserUnmount(action.dataset.repo, null);
      return true;
    }
    if (actionName === 'baldesUserUnmountPath') {
      await baldesUserUnmount(null, action.dataset.path);
      return true;
    }
    if (actionName === 'baldesUserEdit') {
      state.baldesUser = { ...state.baldesUser, editing: action.dataset.repo, error: null, ok: null };
      renderShell();
      return true;
    }
    if (actionName === 'baldesUserCancel') {
      state.baldesUser = { ...state.baldesUser, editing: null };
      renderShell();
      return true;
    }
    if (actionName === 'baldesUserSaveAccess') {
      await baldesUserSaveAccess();
      return true;
    }
    if (actionName === 'acessoAplicar') {
      await acessoStart(action.dataset.repo, 'p');
      return true;
    }
    if (actionName === 'acessoVerificar') {
      await acessoStart(action.dataset.repo, 'v');
      return true;
    }
    if (actionName === 'acessoCopiar') {
      await acessoCopiar();
      return true;
    }
    if (actionName === 'acessoRepoll') {
      if (state.acessoRun) {
        state.acessoRun = { ...state.acessoRun, timedOut: false, startedAt: Date.now() };
        renderShell();
        pollAcesso();
      }
      return true;
    }
    if (actionName === 'toggleNotifyPref') {
      await toggleNotifyPref(action.dataset.pref);
      return true;
    }
    if (actionName === 'baldesToggleCreate') {
      if (state.baldesAdmin) state.baldesAdmin.createOpen = !state.baldesAdmin.createOpen;
      renderShell();
      return true;
    }
    if (actionName === 'baldesCreate') {
      await baldesCreate();
      return true;
    }
    if (actionName === 'baldesSpSync') {
      const nm = action.dataset.repo;
      state.baldesAdmin.spResult = 'Sincronizando ' + nm + '… (a primeira vez pode abrir o login da Microsoft)';
      renderShell();
      try {
        const r = await (
          await fetch('/api/sp/sync-balde', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: nm })
          })
        ).json();
        state.baldesAdmin.spResult = (r.ok ? '✓ ' : '✗ ') + (r.output || r.error || '');
      } catch (error) {
        state.baldesAdmin.spResult = '✗ ' + error.message;
      }
      renderShell();
      return true;
    }
    if (actionName === 'baldesSave') {
      await baldesSave();
      return true;
    }
    if (actionName === 'baldesCancelEdit') {
      if (state.baldesAdmin) state.baldesAdmin.editing = null;
      renderShell();
      return true;
    }
    if (actionName === 'baldesEdit') {
      const r = ((state.baldesAdmin && state.baldesAdmin.repos) || []).find((x) => x.name === action.dataset.repo);
      if (r) {
        state.baldesAdmin.editing = { ...r };
        state.baldesAdmin.ok = null;
        state.baldesAdmin.error = null;
        renderShell();
      }
      return true;
    }
    if (actionName === 'meuBaldeCreate') {
      await meuBaldeCreate();
      return true;
    }
    if (actionName === 'setTheme') {
      await setTheme(action.dataset.theme);
      return true;
    }
    if (actionName === 'setBuddySize') {
      await setBuddySize(action.dataset.size);
      return true;
    }
    if (actionName === 'setStartView') {
      setStartView(action.dataset.startview);
      return true;
    }
    return false;
  };
}
