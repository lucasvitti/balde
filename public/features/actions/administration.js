export function createAdministrationActions({
  state,
  renderShell,
  savePrompt,
  resetPrompt,
  addDomainAdmin,
  domainRenameStart,
  domainRenameCancel,
  domainRenameConfirm,
  removeDomainAdmin,
  udEdit,
  toast,
  udCancel,
  udToggle,
  udSave,
  saveDomainsAdmin,
  toggleDomainGroup,
  domainsSetPage,
  toggleRoleGroup,
  usersAdminAdd,
  saveCategoriasAdmin,
  loadAdminTab,
  newGroup,
  editGroup,
  cancelGroupEditor,
  addFreeEmail,
  saveGroup,
  deleteGroup,
  shareFoldersStart,
  shareFoldersCopy,
  shareFoldersRepoll
}) {
  // Cada ação reconhecida encerra o despacho para evitar efeitos duplicados.
  return async function handleAction(action, event) {
    const actionName = action.dataset.action;
    const id = action.dataset.id;
    if (actionName === 'shareFoldersVerify' || actionName === 'shareFoldersApply') {
      await shareFoldersStart(actionName === 'shareFoldersApply' ? 'p' : 'v');
      return true;
    }
    if (actionName === 'shareFoldersCopy') {
      await shareFoldersCopy();
      return true;
    }
    if (actionName === 'shareFoldersRepoll') {
      shareFoldersRepoll();
      return true;
    }
    if (actionName === 'savePrompt') {
      await savePrompt(id);
      return true;
    }
    if (actionName === 'resetPrompt') {
      resetPrompt(id);
      return true;
    }
    if (actionName === 'addDomainAdmin') {
      const el = document.querySelector('[data-domains-admin-input]');
      addDomainAdmin(el ? el.value : state.domainsAdmin && state.domainsAdmin.draft);
      return true;
    }
    if (actionName === 'domainRenameStart') {
      domainRenameStart(action.dataset.domain);
      return true;
    }
    if (actionName === 'domainRenameCancel') {
      domainRenameCancel();
      return true;
    }
    if (actionName === 'domainRenameConfirm') {
      await domainRenameConfirm();
      return true;
    }
    if (actionName === 'removeDomainAdmin') {
      removeDomainAdmin(action.dataset.domain);
      return true;
    }
    if (actionName === 'udEdit') {
      udEdit(action.dataset.email);
      return true;
    }
    if (actionName === 'udAddEmail') {
      const el = document.querySelector('[data-ud-add-email]');
      const em = String((el && el.value) || '')
        .trim()
        .toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        toast('Informe um e-mail válido.', 'warning');
        return true;
      }
      udEdit(em);
      return true;
    }
    if (actionName === 'udCancel') {
      udCancel();
      return true;
    }
    if (actionName === 'udToggle') {
      udToggle(action.dataset.domain);
      return true;
    }
    if (actionName === 'udSave') {
      udSave();
      return true;
    }
    if (actionName === 'saveDomainsAdmin') {
      await saveDomainsAdmin();
      return true;
    }
    if (actionName === 'toggleDomainGroup') {
      toggleDomainGroup(action.dataset.group);
      return true;
    }
    if (actionName === 'domainsPagePrev') {
      domainsSetPage(-1);
      return true;
    }
    if (actionName === 'domainsPageNext') {
      domainsSetPage(1);
      return true;
    }
    if (actionName === 'toggleRoleGroup') {
      await toggleRoleGroup(action.dataset.email, action.dataset.role);
      return true;
    }
    if (actionName === 'usersAdminAdd') {
      await usersAdminAdd();
      return true;
    }
    if (action.dataset.action === 'catAdd') {
      const t = state.categoriasAdmin;
      if (t) {
        t.list.push({ key: '', label: '', color: '#3b6fd4', hint: '', icon: '' });
        renderShell();
      }
      return true;
    }
    if (action.dataset.action === 'catRemove') {
      const t = state.categoriasAdmin;
      if (t) {
        t.list.splice(Number(action.dataset.i), 1);
        renderShell();
      }
      return true;
    }
    if (action.dataset.action === 'catSave') {
      await saveCategoriasAdmin(false);
      return true;
    }
    if (action.dataset.action === 'catSaveForce') {
      await saveCategoriasAdmin(true);
      return true;
    }
    if (actionName === 'setAdminTab') {
      state.adminTab = action.dataset.adminTab;
      renderShell();
      await loadAdminTab(state.adminTab);
      return true;
    }
    if (actionName === 'newGroup') {
      newGroup();
      return true;
    }
    if (actionName === 'editGroup') {
      editGroup(action.dataset.slug);
      return true;
    }
    if (actionName === 'cancelGroupEditor') {
      cancelGroupEditor();
      return true;
    }
    if (actionName === 'addFreeEmail') {
      addFreeEmail();
      return true;
    }
    if (actionName === 'saveGroup') {
      await saveGroup();
      return true;
    }
    if (actionName === 'deleteGroup') {
      await deleteGroup(action.dataset.slug, action.dataset.name);
      return true;
    }
    return false;
  };
}
