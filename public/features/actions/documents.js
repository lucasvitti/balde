export function createDocumentsActions({
  state,
  renderShell,
  setSidebarCollapsed,
  openDocFile,
  focusDocEditor,
  saveDoc,
  createDoc,
  downloadDocTxt,
  docsAllSectionNames,
  publishDocsSkill,
  openEditSkill,
  deleteSkillConfirm
}) {
  // Cada ação reconhecida encerra o despacho para evitar efeitos duplicados.
  return async function handleAction(action, event) {
    const actionName = action.dataset.action;
    const id = action.dataset.id;
    if (actionName === 'docSelect') {
      await openDocFile(action.dataset.path);
      return true;
    }
    if (actionName === 'docSection') {
      if (state.docs) {
        if (!(state.docs.openSections instanceof Set)) state.docs.openSections = new Set();
        const s = action.dataset.section;
        if (state.docs.openSections.has(s)) state.docs.openSections.delete(s);
        else state.docs.openSections.add(s);
        renderShell();
      }
      return true;
    }
    if (actionName === 'docView') {
      if (state.docs) {
        state.docs.rawView = action.dataset.view === 'code';
        renderShell();
      }
      return true;
    }
    if (actionName === 'docEdit') {
      if (state.docs) {
        state.docs.editing = true;
        state.docs.draft = state.docs.content || '';
        state.docs.editError = null;
        renderShell();
        focusDocEditor();
      }
      return true;
    }
    if (actionName === 'docCancelEdit') {
      if (state.docs) {
        state.docs.editing = false;
        state.docs.draft = '';
        state.docs.editError = null;
        renderShell();
      }
      return true;
    }
    if (actionName === 'saveDoc') {
      await saveDoc();
      return true;
    }
    if (actionName === 'docNew') {
      if (state.docs) {
        state.docs.creating = true;
        state.docs.newPath = '';
        state.docs.newTitle = '';
        state.docs.createError = null;
        renderShell();
      }
      return true;
    }
    if (actionName === 'docCancelNew') {
      if (state.docs) {
        state.docs.creating = false;
        state.docs.createError = null;
        renderShell();
      }
      return true;
    }
    if (actionName === 'createDoc') {
      await createDoc();
      return true;
    }
    if (actionName === 'docInsertImage') {
      const ta = document.querySelector('[data-doc-editor]');
      if (ta && state.docs && typeof ta.selectionStart === 'number')
        state.docs.imgCaret = { start: ta.selectionStart, end: ta.selectionEnd };
      const inp = document.querySelector('[data-doc-image-input]');
      if (inp) inp.click();
      return true;
    }
    if (actionName === 'docDownload') {
      downloadDocTxt();
      return true;
    }
    if (actionName === 'docsToggleExpand') {
      if (state.docs) {
        state.docs.expanded = !state.docs.expanded;
        if (state.docs.expanded) {
          state.docs.prevSidebarCollapsed = state.sidebarCollapsed;
          setSidebarCollapsed(true);
        } else {
          setSidebarCollapsed(Boolean(state.docs.prevSidebarCollapsed));
        }
      }
      renderShell();
      return true;
    }
    if (actionName === 'docsToggleHistory') {
      if (state.docs) {
        state.docs.historyOpen = !state.docs.historyOpen;
        renderShell();
      }
      return true;
    }
    if (actionName === 'docsExpandAll') {
      if (state.docs) {
        state.docs.openSections = docsAllSectionNames();
        renderShell();
      }
      return true;
    }
    if (actionName === 'docsPublishSkill') {
      await publishDocsSkill();
      return true;
    }
    if (actionName === 'docsCollapseAll') {
      if (state.docs) {
        state.docs.openSections = new Set();
        renderShell();
      }
      return true;
    }
    if (actionName === 'editSkill') {
      await openEditSkill(action.dataset.id);
      return true;
    }
    if (actionName === 'deleteSkill') {
      deleteSkillConfirm(action.dataset.id);
      return true;
    }
    return false;
  };
}
