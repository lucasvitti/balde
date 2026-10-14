export function createExplorerActions({
  state,
  renderShell,
  skillProcessMedia,
  saveSourceText,
  uploadContextFiles,
  loadExploreSkill,
  openSkillInExplore,
  setExploreTab,
  exploreHeaderCollapsed,
  exploreOpenRef,
  exploreBack,
  moveSkillConfirm,
  graphRefresh,
  graphOpenNode,
  graphStyleToggle,
  graphToolbarToggle,
  graphApplyPreset,
  graphDomainsToggle,
  graphFocusNode,
  graphFocusExit,
  loadExploreCommonsConcept,
  exploreExpandAllGroups,
  exploreCollapseAllGroups,
  exploreCommonsToggleEdit,
  exploreCommonsSave,
  exploreCommonsProcessMedia,
  exploreCommonsKeepGreen,
  exploreCommonsRunEval,
  selectExploreFile,
  skillQueryRun,
  skillDataInspect,
  capsuleDataInspect,
  skillGraphSelect,
  toggleCorpusGraph,
  corpusOpenSkill,
  omniOpen,
  copyCode,
  setSidebarCollapsed
}) {
  // Cada ação reconhecida encerra o despacho para evitar efeitos duplicados.
  return async function handleAction(action, event) {
    const actionName = action.dataset.action;
    const id = action.dataset.id;
    if (actionName === 'skillProcessMedia') {
      await skillProcessMedia(action.dataset.id);
      return true;
    }
    if (actionName === 'saveSourceText') {
      await saveSourceText(id);
      return true;
    }
    if (actionName === 'uploadContextFiles') {
      await uploadContextFiles(id, action.dataset.kind);
      return true;
    }
    if (actionName === 'exploreSelect') {
      if (state.explore) state.explore.navStack = []; // manual pick from the tree → fresh nav context
      await loadExploreSkill(action.dataset.id);
      return true;
    }
    if (actionName === 'openSkillInExplore') {
      await openSkillInExplore(action.dataset.id);
      return true;
    }
    if (actionName === 'exploreTab') {
      setExploreTab(action.dataset.tab);
      return true;
    }
    if (actionName === 'exploreToggleHeader') {
      try {
        localStorage.setItem('balde.exploreHeaderCollapsed', exploreHeaderCollapsed() ? '0' : '1');
      } catch (error) {
        /* private mode */
      }
      renderShell();
      return true;
    }
    if (actionName === 'exploreOpenRef') {
      await exploreOpenRef(action.dataset.href);
      return true;
    }
    if (actionName === 'exploreBack') {
      await exploreBack();
      return true;
    }
    if (actionName === 'moveSkillConfirm') {
      await moveSkillConfirm();
      return true;
    }
    if (actionName === 'graphRefresh') {
      await graphRefresh();
      return true;
    }
    if (actionName === 'graphOpenNode') {
      await graphOpenNode(action.dataset.id, action.dataset.kind);
      return true;
    }
    if (actionName === 'graphStyleToggle') {
      graphStyleToggle();
      return true;
    }
    if (actionName === 'graphToolbarToggle') {
      graphToolbarToggle();
      return true;
    }
    if (actionName === 'graphStyleReset') {
      graphApplyPreset('padrao');
      return true;
    }
    if (actionName === 'graphDomainsToggle') {
      graphDomainsToggle();
      return true;
    }
    if (actionName === 'graphFocusNode') {
      graphFocusNode(action.dataset.id, action.dataset.hops);
      return true;
    }
    if (actionName === 'graphFocusExit') {
      graphFocusExit();
      return true;
    }
    if (actionName === 'exploreSelectCommons') {
      if (state.explore) state.explore.navStack = []; // manual pick from the tree → fresh nav context
      await loadExploreCommonsConcept(action.dataset.path);
      return true;
    }
    if (actionName === 'exploreToggleDomain') {
      if (state.explore) {
        if (!(state.explore.openDomains instanceof Set)) state.explore.openDomains = new Set();
        const g = action.dataset.group;
        if (state.explore.openDomains.has(g)) state.explore.openDomains.delete(g);
        else state.explore.openDomains.add(g);
        renderShell();
      }
      return true;
    }
    if (actionName === 'exploreToggleDomainGroup') {
      if (state.explore) {
        if (!(state.explore.collapsedDomains instanceof Set)) state.explore.collapsedDomains = new Set();
        const g = action.dataset.dgroup;
        if (state.explore.collapsedDomains.has(g)) state.explore.collapsedDomains.delete(g);
        else state.explore.collapsedDomains.add(g);
        renderShell();
      }
      return true;
    }
    if (actionName === 'exploreExpandAll') {
      exploreExpandAllGroups();
      return true;
    }
    if (actionName === 'exploreCollapseAll') {
      exploreCollapseAllGroups();
      return true;
    }
    if (actionName === 'exploreCommonsEdit') {
      exploreCommonsToggleEdit();
      return true;
    }
    if (actionName === 'exploreCommonsSave') {
      await exploreCommonsSave();
      return true;
    }
    if (actionName === 'exploreCommonsProcessMedia') {
      await exploreCommonsProcessMedia();
      return true;
    }
    if (actionName === 'exploreCommonsKeepGreen') {
      await exploreCommonsKeepGreen(action.dataset.path);
      return true;
    }
    if (actionName === 'exploreCommonsRunEval') {
      await exploreCommonsRunEval(action.dataset.path);
      return true;
    }
    if (actionName === 'exploreFile') {
      await selectExploreFile(action.dataset.path);
      return true;
    }
    if (actionName === 'skillQueryRun') {
      await skillQueryRun(action.dataset.path);
      return true;
    }
    if (actionName === 'skillDataInspect') {
      await skillDataInspect(action.dataset.path);
      return true;
    }
    if (actionName === 'capsuleDataInspect') {
      await capsuleDataInspect(action.dataset.concept, action.dataset.file);
      return true;
    }
    if (actionName === 'graphSelectNode') {
      skillGraphSelect(action.dataset.path);
      return true;
    }
    if (actionName === 'graphOpenFile') {
      setExploreTab('files');
      await selectExploreFile(action.dataset.path);
      return true;
    }
    if (actionName === 'toggleCorpusGraph') {
      await toggleCorpusGraph();
      return true;
    }
    if (actionName === 'corpusOpenSkill') {
      corpusOpenSkill(action.dataset.id);
      return true;
    }
    if (actionName === 'omniOpen') {
      await omniOpen(action.dataset.otype, action.dataset.okey);
      return true;
    }
    if (actionName === 'exploreToggleFolder') {
      if (state.explore) {
        if (!(state.explore.openFolders instanceof Set)) {
          state.explore.openFolders = new Set();
        }
        const folder = action.dataset.folder;
        if (state.explore.openFolders.has(folder)) {
          state.explore.openFolders.delete(folder);
        } else {
          state.explore.openFolders.add(folder);
        }
        renderShell();
      }
      return true;
    }
    if (actionName === 'copyCode') {
      await copyCode(action);
      return true;
    }
    if (actionName === 'exploreToggleExpand') {
      if (state.explore) {
        state.explore.expanded = !state.explore.expanded;
        if (state.explore.expanded) {
          // Focus mode: remember the rail state, then collapse it for max room.
          state.explore.prevSidebarCollapsed = state.sidebarCollapsed;
          setSidebarCollapsed(true);
        } else {
          // Leaving focus mode: restore the rail to how it was.
          setSidebarCollapsed(Boolean(state.explore.prevSidebarCollapsed));
        }
      }
      renderShell();
      return true;
    }
    return false;
  };
}
