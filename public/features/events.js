import { createGovernanceActions } from './actions/governance.js';
import { createNavigationActions } from './actions/navigation.js';
import { createCreationActions } from './actions/creation.js';
import { createAdministrationActions } from './actions/administration.js';
import { createExplorerActions } from './actions/explorer.js';
import { createConversationsActions } from './actions/conversations.js';
import { createDiscoveryActions } from './actions/discovery.js';
import { createCapsulesActions } from './actions/capsules.js';
import { createEvaluationsActions } from './actions/evaluations.js';
import { createConnectionsActions } from './actions/connections.js';
import { createSettingsActions } from './actions/settings.js';
import { createDocumentsActions } from './actions/documents.js';
import { createBuddiesActions } from './actions/buddies.js';
export function bindUiEvents({
  state,
  startDocsResize,
  startCommonsColResize,
  linkrefAccept,
  mentionAccept,
  mentionMenuOpen,
  mentionClose,
  linkrefMenuOpen,
  linkrefClose,
  renderShell,
  setFilaKind,
  setFilaStatus,
  mergeSelectFile,
  logout,
  toggleSidebar,
  toggleNavCat,
  openUpload,
  closeUpload,
  submitUpload,
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
  openContribute,
  closeContribute,
  submitContribute,
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
  wizardNext,
  wizardBack,
  wizardGoto,
  wizardCancel,
  wizardPrefillBody,
  submitCreateSkill,
  wizardClassifyFiles,
  wizardProcessMedia,
  wizardRemoveContextFile,
  wizardToggleToCommons,
  wizardRemoveCurator,
  wizardRemoveReader,
  wizardRemoveEval,
  cwGoto,
  cwBack,
  cwNext,
  cwCancel,
  cwPrefillBody,
  cwRemoveMedia,
  cwDescribeMedia,
  cwDescribeAllMedia,
  cwRemoveCurator,
  cwRemoveReader,
  cwRemoveEval,
  capsuleImportPick,
  manifestImportPick,
  manifestImportCompile,
  manifestImportSubmit,
  manifestImportReset,
  submitCreateCommons,
  skillProcessMedia,
  insertLinkrefTrigger,
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
  openImageLightbox,
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
  saveSourceText,
  uploadContextFiles,
  addDraftPastedFile,
  removeDraftFile,
  addDraftTag,
  removeDraftTag,
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
  openOntologyInExplorer,
  openOntologyEditor,
  openOntologyEditorNew,
  ontologyCreateAi,
  ontologySuggestAdditionsAi,
  closeOntologyEditor,
  ontologyAddConcept,
  ontologyRemoveConcept,
  saveOntology,
  exploreExpandAllGroups,
  exploreCollapseAllGroups,
  openEditCommons,
  evalAddItem,
  evalRemoveItem,
  evalAccept,
  evalReject,
  evalTab,
  evalSave,
  evalRun,
  evalTestCase,
  evalSuggestCases,
  evalSuggestionAdd,
  evalSuggestionDismiss,
  evalPromote,
  wizardEvalAddItem,
  wizardEvalRemoveItem,
  wizardEvalSuggest,
  wizardEvalTab,
  wizardEvalOptAdd,
  wizardEvalOptReq,
  wizardEvalOptForbid,
  wizardEvalOptDel,
  eclAdd,
  eclRemove,
  eclOptAdd,
  eclOptReq,
  eclOptForbid,
  eclOptDel,
  eclSave,
  scoringSave,
  exploreCommonsToggleEdit,
  exploreCommonsSave,
  exploreCommonsProcessMedia,
  exploreCommonsKeepGreen,
  commonsToggleClosed,
  exploreCommonsRunEval,
  selectExploreFile,
  skillQueryRun,
  skillDataInspect,
  capsuleDataInspect,
  skillGraphSelect,
  curatorKeepGreen,
  curatorKeepAllGreen,
  curatorRunEval,
  commonsMigratePlan,
  migrateToCapsule,
  commonsMigrateToggle,
  commonsMigrateApply,
  commonsMigrateCancel,
  toggleCorpusGraph,
  corpusOpenSkill,
  commonsRunEval,
  commonsSummarizeAll,
  openCommonsFile,
  closeCommonsFile,
  toggleCommonsEdit,
  saveCommonsFile,
  commonsProcessMedia,
  commonsSetPage,
  isLocalShell,
  commonsModalValidate,
  omniOpen,
  copyCode,
  setSidebarCollapsed,
  saveAiConfig,
  loadAiCliStatus,
  aiCliLogin,
  aiCliTest,
  aiCliUse,
  aiMcpSetup,
  toggleStartup,
  toggleRoleGroup,
  usersAdminAdd,
  testAiKey,
  clearAiKey,
  runConnDiag,
  copyConnDiag,
  createApiToken,
  revokeApiToken,
  renameApiToken,
  cancelRenameToken,
  saveRenameToken,
  toggleRevealToken,
  copyToken,
  copyApiCurl,
  switchRepo,
  baldesUserCreate,
  baldesUserMount,
  baldesUserUnmount,
  baldesUserSaveAccess,
  acessoStart,
  acessoCopiar,
  pollAcesso,
  toggleNotifyPref,
  saveCategoriasAdmin,
  loadAdminTab,
  baldesCreate,
  baldesSave,
  meuBaldeCreate,
  loadDedupAdmin,
  domainAddNew,
  ingestSend,
  ingestMaterialize,
  ingestState,
  ingestLoadJobs,
  ingestLoadDomains,
  ingestCheckDupes,
  ingestEnsurePoll,
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
  restoreArchived,
  setTheme,
  setBuddySize,
  setStartView,
  dismissNewToken,
  copyNewToken,
  newGroup,
  editGroup,
  cancelGroupEditor,
  addFreeEmail,
  saveGroup,
  deleteGroup,
  shareFoldersStart,
  shareFoldersCopy,
  shareFoldersRepoll,
  wizardAclAddEmail,
  openDocFile,
  focusDocEditor,
  saveDoc,
  createDoc,
  downloadDocTxt,
  docsAllSectionNames,
  publishDocsSkill,
  openEditSkill,
  deleteSkillConfirm,
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
  pluralize,
  rollback,
  rollbackDraft,
  deleteBuddy,
  deleteSkill,
  archiveCapsuleConfirm,
  archiveCapsule,
  graphSearchInput,
  graphSetStyle,
  cwEditMediaDesc,
  linkrefSync,
  activeWizardForm,
  eclEdit,
  selectApiExampleKey,
  slugifyClient,
  domainsSetSearch,
  wizardAddCurator,
  wizardAddReader,
  slugifyCatKey,
  cwAddCurator,
  cwAddReader,
  mentionSync,
  renderSkillPickerOptions,
  syncAdjustmentApprovalButton,
  commonsSetFilter,
  loadCommonsConcepts,
  refocusSearch,
  graphSetOption,
  graphDomainsClear,
  graphDomainSet,
  syncWizardAcl,
  uploadDocImage,
  commonsSetCadence,
  scoringEdit,
  wizardEditContextPath,
  wizardSetContextBucket,
  handleCommonsMediaFiles,
  handleCommonsMdFile,
  cwEditMediaPath,
  commonsMigrateEditTo,
  checkWizardSlug,
  handleWizardMdFile,
  handleWizardContextFiles,
  handleWizardContextFolder,
  togglePlenariaAskBuddy,
  addPendingFiles,
  handleContributeFiles,
  handleDraftFiles,
  handleBuddyFiles,
  handleEditPoseFile,
  handlePoseViewFile,
  handleLinkrefKey,
  omniResults,
  closeOmni,
  handleMentionKey,
  wizardAddEval,
  cwAddEval,
  isBaldeAdmin
}) {
  const governanceActions = createGovernanceActions({
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
  });
  const navigationActions = createNavigationActions({ state, renderShell, logout, toggleSidebar, toggleNavCat });
  const creationActions = createCreationActions({
    openUpload,
    closeUpload,
    submitUpload,
    openContribute,
    closeContribute,
    submitContribute,
    wizardNext,
    wizardBack,
    wizardGoto,
    wizardCancel,
    wizardPrefillBody,
    submitCreateSkill,
    wizardClassifyFiles,
    wizardProcessMedia,
    wizardRemoveContextFile,
    wizardToggleToCommons,
    wizardRemoveCurator,
    wizardRemoveReader,
    wizardRemoveEval,
    cwGoto,
    cwBack,
    cwNext,
    cwCancel,
    cwPrefillBody,
    cwRemoveMedia,
    cwDescribeMedia,
    cwDescribeAllMedia,
    cwRemoveCurator,
    cwRemoveReader,
    cwRemoveEval,
    capsuleImportPick,
    manifestImportPick,
    manifestImportCompile,
    manifestImportSubmit,
    manifestImportReset,
    submitCreateCommons,
    insertLinkrefTrigger,
    addDraftPastedFile,
    removeDraftFile,
    addDraftTag,
    removeDraftTag,
    wizardEvalAddItem,
    wizardEvalRemoveItem,
    wizardEvalSuggest,
    wizardEvalTab,
    wizardEvalOptAdd,
    wizardEvalOptReq,
    wizardEvalOptForbid,
    wizardEvalOptDel,
    wizardAclAddEmail
  });
  const administrationActions = createAdministrationActions({
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
  });
  const explorerActions = createExplorerActions({
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
  });
  const conversationsActions = createConversationsActions({
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
  });
  const discoveryActions = createDiscoveryActions({
    state,
    renderShell,
    loadExploreSkill,
    loadExploreCommonsConcept,
    openOntologyInExplorer,
    openOntologyEditor,
    openOntologyEditorNew,
    ontologyCreateAi,
    ontologySuggestAdditionsAi,
    closeOntologyEditor,
    ontologyAddConcept,
    ontologyRemoveConcept,
    saveOntology,
    loadDedupAdmin,
    domainAddNew,
    ingestSend,
    ingestMaterialize,
    ingestState,
    ingestLoadJobs,
    ingestLoadDomains,
    ingestCheckDupes,
    ingestEnsurePoll,
    navigate
  });
  const capsulesActions = createCapsulesActions({
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
  });
  const evaluationsActions = createEvaluationsActions({
    evalAddItem,
    evalRemoveItem,
    evalAccept,
    evalReject,
    evalTab,
    evalSave,
    evalRun,
    evalTestCase,
    evalSuggestCases,
    evalSuggestionAdd,
    evalSuggestionDismiss,
    evalPromote,
    eclAdd,
    eclRemove,
    eclOptAdd,
    eclOptReq,
    eclOptForbid,
    eclOptDel,
    eclSave,
    scoringSave,
    curatorKeepGreen,
    curatorKeepAllGreen,
    curatorRunEval
  });
  const connectionsActions = createConnectionsActions({
    state,
    renderShell,
    saveAiConfig,
    loadAiCliStatus,
    aiCliLogin,
    aiCliTest,
    aiCliUse,
    aiMcpSetup,
    testAiKey,
    clearAiKey,
    runConnDiag,
    copyConnDiag,
    createApiToken,
    revokeApiToken,
    renameApiToken,
    cancelRenameToken,
    saveRenameToken,
    toggleRevealToken,
    copyToken,
    copyApiCurl,
    dismissNewToken,
    copyNewToken
  });
  const settingsActions = createSettingsActions({
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
  });
  const documentsActions = createDocumentsActions({
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
  });
  const buddiesActions = createBuddiesActions({
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
  });

  const NAV_TIP_SELECTOR = '.nav-item, .sidebar-toggle, .brand';
  let navTipEl = null;
  let navTipTarget = null;

  function showNavTip(target) {
    const label = target.getAttribute('title') || target.getAttribute('aria-label');
    if (!label) {
      return;
    }
    if (!navTipEl) {
      navTipEl = document.createElement('div');
      navTipEl.className = 'nav-tip';
      document.body.appendChild(navTipEl);
    }
    navTipEl.textContent = label;
    const rect = target.getBoundingClientRect();
    // Anchor to the rail's right edge (not the item's, which sits inside the rail)
    // so the hint always clears the sidebar and its scrollbar.
    const rail = target.closest('.sidebar');
    const railRight = rail ? rail.getBoundingClientRect().right : rect.right;
    navTipEl.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
    navTipEl.style.left = `${Math.round(railRight + 10)}px`;
    if (target.hasAttribute('title')) {
      target.dataset.savedTitle = target.getAttribute('title');
      target.removeAttribute('title');
    }
    navTipEl.classList.add('is-visible');
  }

  function hideNavTip() {
    if (navTipEl) {
      navTipEl.classList.remove('is-visible');
    }
    if (navTipTarget && navTipTarget.dataset && navTipTarget.dataset.savedTitle != null) {
      navTipTarget.setAttribute('title', navTipTarget.dataset.savedTitle);
      delete navTipTarget.dataset.savedTitle;
    }
    navTipTarget = null;
  }

  document.addEventListener('mouseover', (event) => {
    if (!state.sidebarCollapsed) {
      return;
    }
    const target = event.target.closest(NAV_TIP_SELECTOR);
    if (!target || !target.closest('.sidebar') || target === navTipTarget) {
      return;
    }
    if (navTipTarget) {
      hideNavTip();
    }
    navTipTarget = target;
    showNavTip(target);
  });

  document.addEventListener('mouseout', (event) => {
    if (!navTipTarget) {
      return;
    }
    const to = event.relatedTarget;
    if (to && navTipTarget.contains(to)) {
      return;
    }
    hideNavTip();
  });

  document.addEventListener('mousedown', (event) => {
    if (event.target.closest('[data-docs-resize]')) {
      startDocsResize(event);
      return;
    }
    const colH = event.target.closest('[data-col-resize]');
    if (colH) {
      startCommonsColResize(event, Number(colH.dataset.colResize));
      return;
    }
  });

  document.addEventListener('click', async (event) => {
    hideNavTip();
    const linkrefItem = event.target.closest('[data-linkref-index]');
    if (linkrefItem) {
      event.preventDefault();
      linkrefAccept(Number(linkrefItem.dataset.linkrefIndex));
      return;
    }
    const mentionItem = event.target.closest('[data-mention-index]');
    if (mentionItem) {
      event.preventDefault();
      mentionAccept(Number(mentionItem.dataset.mentionIndex));
      return;
    }
    if (mentionMenuOpen() && !event.target.closest('.chat-composer')) {
      mentionClose();
    }
    if (
      linkrefMenuOpen() &&
      !event.target.closest('.linkref-menu') &&
      !event.target.closest('[data-wizard-field="body"]') &&
      !event.target.closest('[data-cw-field="body"]')
    ) {
      linkrefClose();
    }
    // #6: click outside the search closes the live-results dropdown.
    if (state.omni && state.omni.open && !event.target.closest('.global-search')) {
      state.omni.open = false;
      if (!event.target.closest('[data-action],[data-view],[data-skill],[data-tab]')) {
        renderShell();
        return;
      }
    }
    // Close the graph domain popover on any outside click (side effect — never returns).
    const graphDomselPop = document.querySelector('[data-graph-domsel-pop]');
    if (graphDomselPop && !graphDomselPop.hidden && !event.target.closest('.graph-domsel'))
      graphDomselPop.hidden = true;
    const nav = event.target.closest('[data-view]');
    const skill = event.target.closest('[data-skill]');
    const action = event.target.closest('[data-action]');

    const queueFilter = event.target.closest('[data-queue-filter]');
    if (queueFilter && state.queue) {
      state.queue.filter = queueFilter.dataset.queueFilter;
      renderShell();
      return;
    }

    // Editor de cápsula: espelha o abre/fecha nativo dos <details> de conceito no estado, para que
    // um re-render (clique em outra ação) não recolha o que o curador abriu. Sem renderShell aqui.
    const capConceptSummary = event.target.closest('details[data-capedit-concept-details] > summary');
    if (capConceptSummary && state.queue && state.queue.capsuleEdit) {
      const det = capConceptSummary.parentElement;
      const idx = Number(det.dataset.capeditConceptDetails);
      const ce = state.queue.capsuleEdit;
      if (!(ce.openConcepts instanceof Set)) ce.openConcepts = new Set();
      if (det.open) ce.openConcepts.delete(idx);
      else ce.openConcepts.add(idx);
      // no return: the native toggle proceeds; nothing else handles this click
    }

    // Itens de governança (Avaliação): mesmo espelhamento — mas só quando o clique NÃO é num
    // controle (aceitar/rejeitar dentro do summary chama preventDefault e não deve virar toggle).
    const evalItemSummary = event.target.closest('details[data-eval-details] > summary');
    if (evalItemSummary && state.nodeEval && !event.target.closest('[data-action]')) {
      const det = evalItemSummary.parentElement;
      const key = det.dataset.evalDetails;
      const ne = state.nodeEval;
      if (!(ne.openItems instanceof Set)) ne.openItems = new Set();
      if (det.open) ne.openItems.delete(key);
      else ne.openItems.add(key);
    }

    const filaKind = event.target.closest('[data-fila-kind]');
    if (filaKind) {
      setFilaKind(filaKind.dataset.filaKind);
      return;
    }
    const filaStatus = event.target.closest('[data-fila-status]');
    if (filaStatus) {
      setFilaStatus(filaStatus.dataset.filaStatus);
      return;
    }
    const mergeFile = event.target.closest('[data-merge-file]');
    if (mergeFile) {
      mergeSelectFile(mergeFile.dataset.mergeFile);
      return;
    }

    if (action) {
      const actionName = action.dataset.action;
      const id = action.dataset.id;

      if (await governanceActions(action, event)) return;
      if (await navigationActions(action, event)) return;
      if (await creationActions(action, event)) return;
      if (await administrationActions(action, event)) return;
      if (await explorerActions(action, event)) return;
      if (await conversationsActions(action, event)) return;
      if (await discoveryActions(action, event)) return;
      if (await capsulesActions(action, event)) return;
      if (await evaluationsActions(action, event)) return;
      if (await connectionsActions(action, event)) return;
      if (await settingsActions(action, event)) return;
      if (await documentsActions(action, event)) return;
      if (await buddiesActions(action, event)) return;

      // Plenárias

      // Conversation files (attachments + skill files)

      // preventDefault: os controles vivem dentro de <summary> — sem isso o clique também abre/fecha o item.

      if (actionName === 'acceptConfirm' && state.confirm?.type === 'rollback') {
        await rollback(state.confirm.id, state.confirm.version);
        return;
      }

      if (actionName === 'acceptConfirm' && state.confirm?.type === 'draftRollback') {
        await rollbackDraft(state.confirm.id, state.confirm.entryId);
        return;
      }

      if (actionName === 'acceptConfirm' && state.confirm?.type === 'deleteBuddy') {
        await deleteBuddy(state.confirm.id);
        return;
      }
      if (actionName === 'acceptConfirm' && state.confirm?.type === 'deleteSkill') {
        await deleteSkill(state.confirm.id);
        return;
      }
      if (actionName === 'acceptConfirm' && state.confirm?.type === 'archiveCapsule') {
        await archiveCapsule(state.confirm.id);
        return;
      }
    }

    if (skill) {
      await openSkillInExplore(skill.dataset.skill);
      return;
    }

    if (nav) {
      await navigate(nav.dataset.view);
    }
  });

  // Clicking outside the skill picker closes it (the toggle/pick actions handle their own clicks).
  document.addEventListener('click', (event) => {
    const sp = state.skillPicker;
    if (!sp || !sp.kind) {
      return;
    }
    if (event.target.closest('.skill-picker') || event.target.closest('[data-action="toggleSkillPicker"]')) {
      return;
    }
    sp.kind = null;
    renderShell();
  });

  document.addEventListener('input', (event) => {
    // Grafo node search — debounced, applied via the cy API (no re-render, keeps focus).
    const graphSearch = event.target.closest('[data-graph-search]');
    if (graphSearch) {
      graphSearchInput(graphSearch.value);
      return;
    }
    // Grafo style sliders — live while dragging (function mappers → style().update()).
    const graphStyleRange = event.target.closest('input[type="range"][data-graph-style]');
    if (graphStyleRange) {
      graphSetStyle(graphStyleRange.dataset.graphStyle, graphStyleRange.value);
      return;
    }
    // Live-capture a wizard media description into state as the user types (no
    // re-render, so the textarea keeps focus/caret). Survives step re-renders.
    const cwMediaDesc = event.target.closest('[data-cw-media-desc]');
    if (cwMediaDesc) {
      cwEditMediaDesc(cwMediaDesc.dataset.cwMediaDesc, cwMediaDesc.value);
      return;
    }
    // Live-filter a roster checklist by name/email — scoped to its own picker, no re-render
    // (so checkbox selections and other pickers are untouched).
    const search = event.target.closest('[data-roster-search]');
    if (search) {
      const picker = search.closest('.member-picker');
      const term = (search.value || '').trim().toLowerCase();
      (picker ? picker.querySelectorAll('[data-member-row]') : []).forEach((row) => {
        row.style.display = !term || (row.dataset.haystack || '').includes(term) ? '' : 'none';
      });
      return;
    }

    // Phase 4: SKILL.md / context.md body — keep state in sync AND run the `[[` commons autocomplete.
    const wBody = event.target.closest('[data-wizard-field="body"]');
    if (wBody && state.wizard) {
      state.wizard.form.body = wBody.value;
      const cc = document.querySelector('[data-wizard-charcount]');
      if (cc) cc.textContent = String(wBody.value.length);
      linkrefSync('wizardBody', wBody);
      return;
    }
    const cwBodyEl = event.target.closest('[data-cw-field="body"]');
    if (cwBodyEl && state.commonsWizard) {
      state.commonsWizard.form.body = cwBodyEl.value;
      return;
    } // capsules are atomic — no [[ link autocomplete

    // Live-filter the Explorar skill list — no re-render (keeps input focus); term persisted
    // in state so a select-driven re-render re-applies the same filter.
    const exploreSearch = event.target.closest('[data-explore-search]');
    if (exploreSearch) {
      const term = (exploreSearch.value || '').trim().toLowerCase();
      if (state.explore) {
        state.explore.filter = exploreSearch.value;
      }
      const list = exploreSearch.closest('.explore-list');
      let visible = 0;
      (list ? list.querySelectorAll('.explore-row') : []).forEach((row) => {
        const show = !term || (row.dataset.haystack || '').includes(term);
        row.style.display = show ? '' : 'none';
        if (show) {
          visible += 1;
        }
      });
      // While searching, open groups that still have a visible row and hide empty ones; when the
      // term is cleared, restore each group to its saved collapsed state (mirrors the docs list).
      const openSet = state.explore && state.explore.openDomains instanceof Set ? state.explore.openDomains : null;
      (list ? list.querySelectorAll('.explore-group') : []).forEach((sec) => {
        const anyVisible = [...sec.querySelectorAll('.explore-row')].some((r) => r.style.display !== 'none');
        sec.hidden = !!term && !anyVisible;
        const body = sec.querySelector('.explore-group-body');
        if (!body) return;
        if (term) body.classList.remove('is-collapsed');
        else body.classList.toggle('is-collapsed', !(openSet ? openSet.has(sec.dataset.group) : true));
      });
      // Domain sub-groups: hide those whose rows all filter out; while searching,
      // expand the rest; when cleared, restore each to its saved collapsed state.
      const collapsedSet =
        state.explore && state.explore.collapsedDomains instanceof Set ? state.explore.collapsedDomains : null;
      (list ? list.querySelectorAll('.explore-dgroup') : []).forEach((dg) => {
        const anyVisible = [...dg.querySelectorAll('.explore-row')].some((r) => r.style.display !== 'none');
        dg.hidden = !!term && !anyVisible;
        const body = dg.querySelector('.explore-dgroup-body');
        if (!body) return;
        if (term) body.classList.remove('is-collapsed');
        else body.classList.toggle('is-collapsed', collapsedSet ? collapsedSet.has(dg.dataset.dgroup) : false);
      });
      const empty = list && list.querySelector('.explore-no-results');
      if (empty) {
        empty.hidden = visible !== 0;
      }
      return;
    }

    const exploreCommonsEditor = event.target.closest('[data-explore-commons-editor]');
    if (exploreCommonsEditor) {
      if (state.explore && state.explore.commonsFile) state.explore.commonsFile.draft = exploreCommonsEditor.value;
      return;
    }

    // Unified eval tab drafts (kept in state so the add-buttons pick them up without a re-render).
    // Ontology editor rows: keystroke-level state sync (survives any re-render mid-edit).
    if (state.ontologyEditor) {
      const ontoField = event.target.closest('[data-onto-field]');
      if (ontoField) {
        const ed = state.ontologyEditor;
        const field = ontoField.dataset.ontoField;
        if (field === 'preamble') ed.preamble = ontoField.value;
        else if (ed.concepts[Number(ontoField.dataset.i)])
          ed.concepts[Number(ontoField.dataset.i)][field] = ontoField.value;
        return;
      }
    }
    const evalIt = event.target.closest('[data-eval-ititle]');
    if (evalIt) {
      if (state.nodeEval) state.nodeEval.iDraft.title = evalIt.value;
      return;
    }
    const evalIp = event.target.closest('[data-eval-iprompt]');
    if (evalIp) {
      if (state.nodeEval) state.nodeEval.iDraft.prompt = evalIp.value;
      return;
    }
    const evalIq = event.target.closest('[data-eval-iq]');
    if (evalIq) {
      if (state.nodeEval) state.nodeEval.iDraft.question = evalIq.value;
      return;
    }
    const evalIe = event.target.closest('[data-eval-ie]');
    if (evalIe) {
      if (state.nodeEval) state.nodeEval.iDraft.expected = evalIe.value;
      return;
    }
    // Wizard eval-step drafts (skill + commons create/edit).
    const wEvalIt = event.target.closest('[data-wizard-eval-ititle]');
    if (wEvalIt) {
      const f = activeWizardForm();
      if (f) f.evalIDraft.title = wEvalIt.value;
      return;
    }
    const wEvalIp = event.target.closest('[data-wizard-eval-iprompt]');
    if (wEvalIp) {
      const f = activeWizardForm();
      if (f) f.evalIDraft.prompt = wEvalIp.value;
      return;
    }
    const wEvalIq = event.target.closest('[data-wizard-eval-iq]');
    if (wEvalIq) {
      const f = activeWizardForm();
      if (f) f.evalIDraft.question = wEvalIq.value;
      return;
    }
    const wEvalIe = event.target.closest('[data-wizard-eval-ie]');
    if (wEvalIe) {
      const f = activeWizardForm();
      if (f) f.evalIDraft.expected = wEvalIe.value;
      return;
    }
    const eclText = event.target.closest('[data-ecl-field="title"], [data-ecl-field="prompt"]');
    if (eclText) {
      eclEdit(eclText.dataset.idx, eclText.getAttribute('data-ecl-field'), eclText.value);
      return;
    }

    // Live-filter the documentation list — same pattern, no re-render (keeps input focus).
    const docsSearch = event.target.closest('[data-docs-search]');
    if (docsSearch) {
      const term = (docsSearch.value || '').trim().toLowerCase();
      if (state.docs) state.docs.filter = docsSearch.value;
      const list = docsSearch.closest('.docs-list');
      let visible = 0;
      (list ? list.querySelectorAll('.doc-row') : []).forEach((row) => {
        const show = !term || (row.dataset.haystack || '').includes(term);
        row.style.display = show ? '' : 'none';
        if (show) visible += 1;
      });
      // While searching, reveal sections that still have a visible row and hide empty ones;
      // when the term is cleared, restore each section to its saved collapsed state.
      const openSet = state.docs && state.docs.openSections instanceof Set ? state.docs.openSections : null;
      (list ? list.querySelectorAll('.doc-section') : []).forEach((sec) => {
        const anyVisible = [...sec.querySelectorAll('.doc-row')].some((r) => r.style.display !== 'none');
        sec.hidden = !!term && !anyVisible;
        const secBody = sec.querySelector('.doc-section-body');
        if (!secBody) return;
        if (term) secBody.classList.remove('is-collapsed');
        else secBody.classList.toggle('is-collapsed', !(openSet ? openSet.has(sec.dataset.section) : true));
      });
      const empty = list && list.querySelector('.explore-no-results');
      if (empty) empty.hidden = visible !== 0;
      return;
    }

    // Documentation editor — keep the draft in state without re-rendering (preserves caret).
    const docEditor = event.target.closest('[data-doc-editor]');
    if (docEditor) {
      if (state.docs) state.docs.draft = docEditor.value;
      return;
    }

    // Importar manifesto: keep the pasted JSON in state without re-rendering (preserves caret).
    const manifestRaw = event.target.closest('[data-manifest-raw]');
    if (manifestRaw) {
      if (state.manifestImport) {
        state.manifestImport.raw = manifestRaw.value;
        state.manifestImport.fileName = '';
      }
      return;
    }
    const docNewTitle = event.target.closest('[data-doc-new-title]');
    if (docNewTitle) {
      if (state.docs) state.docs.newTitle = docNewTitle.value;
      return;
    }
    const docNewPath = event.target.closest('[data-doc-new-path]');
    if (docNewPath) {
      if (state.docs) state.docs.newPath = docNewPath.value;
      return;
    }

    const apiKeySel = event.target.closest('[data-api-key-select]');
    if (apiKeySel) {
      selectApiExampleKey(apiKeySel.value);
      return;
    }

    const uploadField = event.target.closest('[data-upload-field]');
    if (uploadField && state.uploadModal) {
      state.uploadModal[uploadField.dataset.uploadField] = uploadField.value;
      return;
    }

    const queueField = event.target.closest('[data-queue-field]');
    if (queueField && state.queue) {
      state.queue[queueField.dataset.queueField] = queueField.value;
      return;
    }

    // Editor de cápsula (fila): grava no rascunho SEM re-render (preserva o caret).
    const capEditField = event.target.closest('[data-capedit]');
    if (capEditField && state.queue && state.queue.capsuleEdit) {
      const ce = state.queue.capsuleEdit;
      const path = capEditField.dataset.capedit;
      if (path === 'title') ce.draft.title = capEditField.value;
      else if (path.startsWith('skill.') && ce.draft.skill && typeof ce.draft.skill === 'object')
        ce.draft.skill[path.slice(6)] = capEditField.value;
      return;
    }
    const capEditConcept = event.target.closest('[data-capedit-concept]');
    if (capEditConcept && state.queue && state.queue.capsuleEdit) {
      const ce = state.queue.capsuleEdit;
      const idx = Number(capEditConcept.dataset.idx);
      const c = Array.isArray(ce.draft.concepts) ? ce.draft.concepts[idx] : null;
      if (c) c[capEditConcept.dataset.capeditConcept] = capEditConcept.value;
      return;
    }
    const capEditEmail = event.target.closest('[data-capedit-email-axis]');
    if (capEditEmail && state.queue && state.queue.capsuleEdit) {
      state.queue.capsuleEdit.emailDraft[capEditEmail.dataset.capeditEmailAxis] = capEditEmail.value;
      return;
    }

    const filaFbDraft = event.target.closest('[data-fila-feedback-draft]');
    if (filaFbDraft) {
      if (state.fila) state.fila.feedbackDraft = filaFbDraft.value;
      return;
    }

    const mergeField = event.target.closest('[data-merge-field]');
    if (mergeField) {
      if (state.mergeWizard) state.mergeWizard[mergeField.dataset.mergeField] = mergeField.value;
      return;
    }
    const mergeEdit = event.target.closest('[data-merge-edit]');
    if (mergeEdit) {
      const w = state.mergeWizard,
        c = w && w.changes[w.fileIdx];
      if (c) c.curatorContent = mergeEdit.value;
      const cc = document.querySelector('[data-merge-charcount]');
      if (cc) cc.textContent = String(mergeEdit.value.length);
      if (c && /\.md$/i.test(c.path)) linkrefSync('mergeBody', mergeEdit);
      return;
    }

    const wizardField = event.target.closest('[data-wizard-field]');
    if (wizardField && state.wizard) {
      const key = wizardField.dataset.wizardField;
      state.wizard.form[key] = wizardField.value;
      if (key === 'title' && !state.wizard.form.slugTouched) {
        state.wizard.form.slug = slugifyClient(wizardField.value);
        const slugInput = document.querySelector('[data-wizard-field="slug"]');
        if (slugInput) {
          slugInput.value = state.wizard.form.slug;
        }
      }
      if (key === 'slug') {
        state.wizard.form.slugTouched = true;
      }
      if (key === 'slug' || key === 'title' || key === 'subpath' || key === 'domain') {
        state.wizard.form.slugStatus = null; // re-check on blur / Next (id = domain/subpath/slug)
      }
      return;
    }

    const domainsAdminInput = event.target.closest('[data-domains-admin-input]');
    if (domainsAdminInput && state.domainsAdmin) {
      state.domainsAdmin.draft = domainsAdminInput.value;
      return;
    }

    const domainsSearch = event.target.closest('[data-domains-search]');
    if (domainsSearch && state.domainsAdmin) {
      domainsSetSearch(domainsSearch.value);
      return;
    }

    const domainRenameInput = event.target.closest('[data-domain-rename-input]');
    if (domainRenameInput && state.domainsAdmin) {
      state.domainsAdmin.renameTo = domainRenameInput.value;
      return;
    }

    if (state.wizard) {
      const curatorInput = event.target.closest('[data-wizard-curator-input]');
      if (curatorInput) {
        if (event.inputType === 'insertReplacementText' && curatorInput.value.includes('@')) {
          wizardAddCurator(curatorInput.value);
          return;
        }
        state.wizard.form.curatorDraft = curatorInput.value;
        return;
      }
      const readerInput = event.target.closest('[data-wizard-reader-input]');
      if (readerInput) {
        if (event.inputType === 'insertReplacementText' && readerInput.value.includes('@')) {
          wizardAddReader(readerInput.value);
          return;
        }
        state.wizard.form.readerDraft = readerInput.value;
        return;
      }
      const evalInput = event.target.closest('[data-wizard-eval-input]');
      if (evalInput) {
        state.wizard.form.evalDraft = evalInput.value;
        return;
      }
    }

    // Administracao > Categorias. Vive FORA de qualquer assistente: o admin edita o vocabulario
    // sem nenhum wizard aberto. Este bloco ja esteve aninhado em `if (state.commonsWizard)`, que e
    // sempre nulo nessa tela — nada do que se digitava chegava ao estado, e o Salvar reenviava a
    // lista original sem alteracao nenhuma.
    if (state.categoriasAdmin) {
      const catField = event.target.closest('[data-cat-field]');
      if (catField) {
        const row = state.categoriasAdmin.list[Number(catField.dataset.catI)];
        if (row) {
          // A chave e o que fica gravado na capsula: normaliza enquanto digita para o admin ver
          // exatamente o slug que sera guardado. Hifen no fim sobrevive (senao briga com quem digita).
          row[catField.dataset.catField] =
            catField.dataset.catField === 'key' ? slugifyCatKey(catField.value) : catField.value;
          state.categoriasAdmin.dirty = true;
        }
        return;
      }
    }

    if (state.commonsWizard) {
      const cwField = event.target.closest('[data-cw-field]');
      if (cwField) {
        state.commonsWizard.form[cwField.dataset.cwField] = cwField.value;
        return;
      }
      const cwCur = event.target.closest('[data-cw-curator-input]');
      if (cwCur) {
        if (event.inputType === 'insertReplacementText' && cwCur.value.includes('@')) {
          cwAddCurator(cwCur.value);
          return;
        }
        state.commonsWizard.form.curatorDraft = cwCur.value;
        return;
      }
      const cwRd = event.target.closest('[data-cw-reader-input]');
      if (cwRd) {
        if (event.inputType === 'insertReplacementText' && cwRd.value.includes('@')) {
          cwAddReader(cwRd.value);
          return;
        }
        state.commonsWizard.form.readerDraft = cwRd.value;
        return;
      }
      const cwEv = event.target.closest('[data-cw-eval-input]');
      if (cwEv) {
        state.commonsWizard.form.evalDraft = cwEv.value;
        return;
      }
    }

    const promptField = event.target.closest('[data-prompt-id]');
    if (promptField && state.prompts) {
      const item = state.prompts.items.find((entry) => entry.id === promptField.dataset.promptId);
      if (item) {
        item.draft = promptField.value;
      }
      return;
    }

    const contributeField = event.target.closest('[data-contribute-field]');
    if (contributeField && state.contribute) {
      state.contribute[contributeField.dataset.contributeField] = contributeField.value;
      return;
    }

    const chatInputEl = event.target.closest('[data-chat-input]');
    if (chatInputEl && state.chat) {
      state.chat.input = chatInputEl.value;
      mentionSync('chat', chatInputEl);
      return;
    }

    const plenariaInputEl = event.target.closest('[data-plenaria-input]');
    if (plenariaInputEl && state.plenaria) {
      state.plenaria.input = plenariaInputEl.value;
      mentionSync('plenaria', plenariaInputEl);
      return;
    }

    // Skill picker: typing re-filters the suggestion list IN PLACE (never a full re-render,
    // so the field keeps focus + caret). Both fields are optional; empty domain = all domains.
    const pickerDomain = event.target.closest('[data-skill-picker-domain]');
    const pickerQuery = event.target.closest('[data-skill-picker-query]');
    if (pickerDomain || pickerQuery) {
      const el = pickerDomain || pickerQuery;
      const kind = el.getAttribute(pickerDomain ? 'data-skill-picker-domain' : 'data-skill-picker-query');
      const sp = skillPickerState();
      if (pickerDomain) {
        sp.domain = el.value;
      } else {
        sp.query = el.value;
      }
      const list = document.querySelector(`[data-skill-picker-list="${kind}"]`);
      if (list) {
        list.innerHTML = renderSkillPickerOptions(kind);
      }
      return;
    }

    const plenariaJoinEl = event.target.closest('[data-plenaria-join-input]');
    if (plenariaJoinEl && state.plenaria) {
      state.plenaria.joinKey = plenariaJoinEl.value;
      return;
    }

    const draftField = event.target.closest('[data-draft-field]');
    if (draftField && state.draftModal) {
      state.draftModal[draftField.dataset.draftField] = draftField.value;
      return;
    }

    const tagInput = event.target.closest('[data-draft-tag-input]');
    if (tagInput && state.draftModal) {
      state.draftModal.tagDraft = tagInput.value;
      return;
    }

    const aiField = event.target.closest('[data-ai-field]');
    if (aiField && state.ai) {
      state.ai[aiField.dataset.aiField] = aiField.value;
      return;
    }

    const buddyField = event.target.closest('[data-buddy-field]');
    if (buddyField && state.buddies && state.buddies.uploadModal) {
      state.buddies.uploadModal[buddyField.dataset.buddyField] = buddyField.value;
      return;
    }

    const editField = event.target.closest('[data-edit-field]');
    if (editField && state.buddies && state.buddies.editModal) {
      state.buddies.editModal[editField.dataset.editField] = editField.value;
      return;
    }

    const themeTempField = event.target.closest('[data-theme-temp]');
    if (themeTempField && state.buddies && state.buddies.editModal) {
      const map = (state.buddies.editModal.themeTemperaments = state.buddies.editModal.themeTemperaments || {});
      map[themeTempField.dataset.themeTemp] = themeTempField.value;
      return;
    }

    const adjustmentField = event.target.closest('[data-adjust-field]');
    if (adjustmentField && state.adjustment) {
      state.adjustment[adjustmentField.dataset.adjustField] = adjustmentField.value;
      syncAdjustmentApprovalButton();
      return;
    }

    const commonsFilter = event.target.closest('[data-commons-filter]');
    if (commonsFilter) {
      commonsSetFilter(commonsFilter.value);
      return;
    }

    const filter = event.target.closest('[data-filter]');
    if (!filter) {
      return;
    }

    state.filters[filter.dataset.filter] = filter.value;
    if (filter.dataset.filter === 'query') {
      // #6: global live search — show a results dropdown; don't yank the user to the skills list.
      state.omni = state.omni || { active: 0 };
      state.omni.open = filter.value.trim().length > 0;
      state.omni.active = 0;
      // Capsules come from the cached commons index — load it on demand so the search finds
      // cápsulas even before the Cápsulas page has been opened this session.
      if (state.omni.open && !state.commonsIndex) {
        loadCommonsConcepts().then(() => {
          if (state.omni && state.omni.open) renderShell();
        });
      }
      renderShell();
      requestAnimationFrame(refocusSearch);
      return;
    }
    if (state.view !== 'skills') {
      state.view = 'skills';
    }
    renderShell();
  });

  document.addEventListener('change', (event) => {
    const repoSel = event.target.closest('[data-action="repoSwitch"]');
    if (repoSel) {
      switchRepo(repoSel.value);
      return;
    }
    const ingestSel = event.target.closest('[data-ingest-sel]');
    if (ingestSel) {
      const ig = ingestState();
      if (!ig.sel) ig.sel = {};
      ig.sel[ingestSel.dataset.ingestSel] = ingestSel.checked;
      renderShell();
      return;
    }
    const ingestMat = event.target.closest('[data-ingest-mat]');
    if (ingestMat) {
      const ig = ingestState();
      if (!ig.mat)
        ig.mat = {
          domain: '',
          anchorMode: 'none',
          anchorId: '',
          newTitle: '',
          newObjetivo: '',
          busy: false,
          errors: null
        };
      ig.mat[ingestMat.dataset.ingestMat] = ingestMat.value;
      if (ingestMat.dataset.ingestMat === 'anchorMode') renderShell();
      return;
    }
    const ingestGuidance = event.target.closest('[data-ingest-guidance]');
    if (ingestGuidance) {
      ingestState().guidance = ingestGuidance.value;
      return;
    }
    const ingestPick = event.target.closest('[data-action-change="ingestPick"]');
    if (ingestPick) {
      const ig = ingestState();
      for (const file of ingestPick.files || []) {
        if (ig.staged.length >= 40) break;
        if (!ig.staged.some((s) => s.name === file.name)) ig.staged.push({ name: file.name, size: file.size, file });
      }
      ingestPick.value = '';
      renderShell();
      return;
    }
    // Grafo toolbar (selects + checkboxes) → apply via the cy API directly, NO renderShell
    // (a full re-render would destroy and remount the canvas island).
    const graphOpt = event.target.closest('[data-graph-opt]');
    if (graphOpt) {
      graphSetOption(graphOpt.dataset.graphOpt, graphOpt.type === 'checkbox' ? graphOpt.checked : graphOpt.value);
      return;
    }
    // Mover skill de domínio (Administração › Domínios): selects alimentam o estado.
    const moveSkillSel = event.target.closest('[data-move-skill-id]');
    if (moveSkillSel && state.domainsAdmin) {
      state.domainsAdmin.moveSkillId = moveSkillSel.value;
      state.domainsAdmin.moveToDomain = '';
      state.domainsAdmin.moveOk = null;
      state.domainsAdmin.moveError = null;
      renderShell();
      return;
    }
    const moveDomSel = event.target.closest('[data-move-skill-domain]');
    if (moveDomSel && state.domainsAdmin) {
      state.domainsAdmin.moveToDomain = moveDomSel.value;
      renderShell();
      return;
    }
    // Domain multiselect popover — direct-DOM updates, no re-render (canvas keeps positions).
    const graphDomAll = event.target.closest('[data-graph-domain-all]');
    if (graphDomAll) {
      graphDomainsClear();
      return;
    }
    const graphDom = event.target.closest('[data-graph-domain]');
    if (graphDom) {
      graphDomainSet(graphDom.dataset.graphDomain, graphDom.checked);
      return;
    }
    const graphPreset = event.target.closest('[data-graph-preset]');
    if (graphPreset) {
      graphApplyPreset(graphPreset.value);
      return;
    }
    const graphStyleCtl = event.target.closest('[data-graph-style]');
    if (graphStyleCtl) {
      graphSetStyle(
        graphStyleCtl.dataset.graphStyle,
        graphStyleCtl.type === 'checkbox' ? graphStyleCtl.checked : graphStyleCtl.value
      );
      return;
    }
    // Governança & acesso roster/group checkboxes → pull the selection into the form.
    const wizAcl = event.target.closest('[data-wiz-acl], [data-wiz-aclg]');
    if (wizAcl && state.wizard) {
      syncWizardAcl();
      return;
    }
    // Curator/reader inputs commit as a chip on blur or datalist selection — so
    // picking a user from the autocomplete (or typing then clicking away) adds
    // them without needing Enter. Enables selecting several users in a row.
    const curCommit = event.target.closest('[data-wizard-curator-input]');
    if (curCommit && state.wizard) {
      if (String(curCommit.value || '').includes('@')) wizardAddCurator(curCommit.value);
      return;
    }
    const rdCommit = event.target.closest('[data-wizard-reader-input]');
    if (rdCommit && state.wizard) {
      if (String(rdCommit.value || '').includes('@')) wizardAddReader(rdCommit.value);
      return;
    }
    const cwCurCommit = event.target.closest('[data-cw-curator-input]');
    if (cwCurCommit && state.commonsWizard) {
      if (String(cwCurCommit.value || '').includes('@')) cwAddCurator(cwCurCommit.value);
      return;
    }
    const cwRdCommit = event.target.closest('[data-cw-reader-input]');
    if (cwRdCommit && state.commonsWizard) {
      if (String(cwRdCommit.value || '').includes('@')) cwAddReader(cwRdCommit.value);
      return;
    }
    const reassign = event.target.closest('[data-queue-reassign]');
    if (reassign) {
      queueReassign(reassign.dataset.queueReassign, reassign.value);
      return;
    }
    const capVis = event.target.closest('[data-capedit-vis]');
    if (capVis && state.queue && state.queue.capsuleEdit) {
      state.queue.capsuleEdit.vis = capVis.dataset.capeditVis || '';
      renderShell();
      return;
    }
    const docImgInput = event.target.closest('[data-doc-image-input]');
    if (docImgInput) {
      const file = docImgInput.files && docImgInput.files[0];
      if (file) uploadDocImage(file);
      docImgInput.value = '';
      return;
    }

    const commonsCadence = event.target.closest('[data-commons-cadence]');
    if (commonsCadence) {
      commonsSetCadence(commonsCadence.dataset.path || '', commonsCadence.value);
      return;
    }
    const evalRefuse = event.target.closest('[data-eval-irefuse]');
    if (evalRefuse) {
      if (state.nodeEval) state.nodeEval.iDraft.mustRefuse = evalRefuse.checked;
      return;
    }
    const wEvalRefuse = event.target.closest('[data-wizard-eval-irefuse]');
    if (wEvalRefuse) {
      const f = activeWizardForm();
      if (f) f.evalIDraft.mustRefuse = wEvalRefuse.checked;
      return;
    }
    const eclField = event.target.closest('[data-ecl-field]');
    if (eclField) {
      const fld = eclField.getAttribute('data-ecl-field');
      eclEdit(eclField.dataset.idx, fld, fld === 'enabled' ? eclField.checked : eclField.value);
      if (fld !== 'title' && fld !== 'prompt') renderShell();
      return;
    }

    const scoringField = event.target.closest('[data-scoring-field]');
    if (scoringField) {
      scoringEdit(scoringField.getAttribute('data-scoring-field'), Number(scoringField.value));
      return;
    }

    const exploreDomain = event.target.closest('[data-explore-domain]');
    if (exploreDomain) {
      if (state.explore) {
        state.explore.domainFilter = exploreDomain.value || '';
        renderShell();
      }
      return;
    }
    const exploreMine = event.target.closest('[data-explore-mine]');
    if (exploreMine) {
      if (state.explore) {
        state.explore.mineOnly = exploreMine.checked;
        renderShell();
      }
      return;
    }

    const wizCtxPath = event.target.closest('[data-wizard-context-path]');
    if (wizCtxPath) {
      wizardEditContextPath(wizCtxPath.dataset.wizardContextPath, wizCtxPath.value);
      return;
    }

    const wizCtxBucket = event.target.closest('[data-wizard-context-bucket]');
    if (wizCtxBucket) {
      wizardSetContextBucket(wizCtxBucket.dataset.wizardContextBucket, wizCtxBucket.value);
      return;
    }

    if (state.commonsWizard) {
      const cwVis = event.target.closest('[data-cw-vis]');
      if (cwVis) {
        state.commonsWizard.form.visibility = cwVis.value === 'restricted' ? 'restricted' : 'public';
        renderShell();
        return;
      }
      const cwField = event.target.closest('[data-cw-field]');
      if (cwField) {
        state.commonsWizard.form[cwField.dataset.cwField] = cwField.value;
        if (['domain', 'concept', 'categoria'].includes(cwField.dataset.cwField)) renderShell();
        return;
      }
      const cwMedia = event.target.closest('[data-cw-media-files]');
      if (cwMedia) {
        handleCommonsMediaFiles(cwMedia.files);
        cwMedia.value = '';
        return;
      }
      const cwMd = event.target.closest('[data-cw-mdfile]');
      if (cwMd) {
        handleCommonsMdFile(cwMd.files);
        return;
      }
      const cwMediaPath = event.target.closest('[data-cw-media-path]');
      if (cwMediaPath) {
        cwEditMediaPath(cwMediaPath.dataset.cwMediaPath, cwMediaPath.value);
        return;
      }
    }

    const migrateTo = event.target.closest('[data-commons-migrate-to]');
    if (migrateTo) {
      commonsMigrateEditTo(migrateTo.dataset.path, migrateTo.value);
      return;
    }

    if (state.wizard) {
      const wf = event.target.closest('[data-wizard-field]');
      if (wf) {
        state.wizard.form[wf.dataset.wizardField] = wf.value;
        if (wf.dataset.wizardField === 'outputShape') {
          renderShell();
        }
        if (['slug', 'title', 'subpath', 'domain'].includes(wf.dataset.wizardField)) {
          checkWizardSlug();
        }
        return;
      }
      const wc = event.target.closest('[data-wizard-check]');
      if (wc) {
        state.wizard.form[wc.dataset.wizardCheck] = wc.checked;
        return;
      }
      const md = event.target.closest('[data-wizard-mdfile]');
      if (md) {
        handleWizardMdFile(md.files);
        return;
      }
      const contextFiles = event.target.closest('[data-wizard-context-files]');
      if (contextFiles) {
        handleWizardContextFiles(contextFiles.files);
        contextFiles.value = ''; // allow re-selecting the same file(s)
        return;
      }
      const contextFolder = event.target.closest('[data-wizard-context-folder]');
      if (contextFolder) {
        handleWizardContextFolder(contextFolder.files);
        contextFolder.value = '';
        return;
      }
      const vis = event.target.closest('[data-wizard-vis]');
      if (vis) {
        state.wizard.form.visibility = vis.value === 'restricted' ? 'restricted' : 'public';
        return;
      }
    }

    const plenariaAskToggle = event.target.closest('[data-plenaria-ask-toggle]');
    if (plenariaAskToggle) {
      togglePlenariaAskBuddy(plenariaAskToggle.checked);
      return;
    }

    const convoFileInput = event.target.closest('[data-file-input]');
    if (convoFileInput) {
      const kind = convoFileInput.getAttribute('data-file-input');
      const files = convoFileInput.files;
      convoFileInput.value = ''; // allow re-picking the same file
      addPendingFiles(kind, files);
      return;
    }

    if (state.contribute) {
      const contributeFile = event.target.closest('[data-contribute-files]');
      if (contributeFile) {
        handleContributeFiles(contributeFile.files);
        return;
      }
      const contributeField = event.target.closest('[data-contribute-field]');
      if (contributeField) {
        state.contribute[contributeField.dataset.contributeField] = contributeField.value;
        return;
      }
    }

    if (state.draftModal) {
      const draftFile = event.target.closest('[data-draft-file]');
      if (draftFile) {
        handleDraftFiles(draftFile.files);
        return;
      }
      const draftField = event.target.closest('[data-draft-field]');
      if (draftField) {
        state.draftModal[draftField.dataset.draftField] = draftField.value;
        return;
      }
    }

    if (state.ai) {
      const aiField = event.target.closest('[data-ai-field]');
      if (aiField) {
        state.ai[aiField.dataset.aiField] = aiField.value;
        if (aiField.dataset.aiField === 'provider') {
          renderShell();
        }
        return;
      }
    }

    if (state.buddies && state.buddies.uploadModal) {
      const buddyFile = event.target.closest('[data-buddy-file]');
      if (buddyFile) {
        handleBuddyFiles(buddyFile.files);
        return;
      }
      const buddyField = event.target.closest('[data-buddy-field]');
      if (buddyField) {
        state.buddies.uploadModal[buddyField.dataset.buddyField] = buddyField.value;
        return;
      }
    }

    if (state.buddies && state.buddies.editModal) {
      const poseSlot = event.target.closest('[data-pose-slot]');
      if (poseSlot) {
        handleEditPoseFile(poseSlot.dataset.poseSlot, poseSlot.files && poseSlot.files[0]);
        return;
      }
      const editField = event.target.closest('[data-edit-field]');
      if (editField) {
        state.buddies.editModal[editField.dataset.editField] = editField.value;
        return;
      }
      const themeTempField = event.target.closest('[data-theme-temp]');
      if (themeTempField) {
        const map = (state.buddies.editModal.themeTemperaments = state.buddies.editModal.themeTemperaments || {});
        map[themeTempField.dataset.themeTemp] = themeTempField.value;
        return;
      }
    }

    if (state.buddies && state.buddies.poseView) {
      const poseViewFile = event.target.closest('[data-pose-view-file]');
      if (poseViewFile) {
        handlePoseViewFile(poseViewFile.files && poseViewFile.files[0]);
        return;
      }
    }

    if (state.ai) {
      const aiField = event.target.closest('[data-ai-field]');
      if (aiField) {
        state.ai[aiField.dataset.aiField] = aiField.value;
        if (aiField.dataset.aiField === 'provider') {
          renderShell();
        }
        return;
      }
    }

    const filter = event.target.closest('[data-filter]');
    if (!filter) {
      return;
    }

    state.filters[filter.dataset.filter] = filter.value;
    renderShell();
  });

  // Paste an image straight into the chat/plenária composer → attach it (text paste
  // is untouched; we only intercept when the clipboard carries files).
  document.addEventListener('paste', (event) => {
    const box = event.target.closest && event.target.closest('[data-chat-input], [data-plenaria-input]');
    if (!box) {
      return;
    }
    const files = event.clipboardData && event.clipboardData.files ? [...event.clipboardData.files] : [];
    if (!files.length) {
      return;
    }
    event.preventDefault();
    addPendingFiles(box.matches('[data-plenaria-input]') ? 'plenarias' : 'chats', files);
  });

  // Drag-drop files onto the composer → attach.
  document.addEventListener('dragover', (event) => {
    if (event.target.closest && event.target.closest('.chat-composer')) {
      event.preventDefault();
    }
  });
  document.addEventListener('drop', (event) => {
    const composer = event.target.closest && event.target.closest('.chat-composer');
    if (!composer) {
      return;
    }
    event.preventDefault();
    const input = composer.querySelector('[data-file-input]');
    const files = event.dataTransfer && event.dataTransfer.files ? [...event.dataTransfer.files] : [];
    if (files.length) {
      addPendingFiles(input ? input.getAttribute('data-file-input') : 'chats', files);
    }
  });

  // A corpus image the buddy referenced failed to load (missing/hallucinated path) →
  // replace the broken <img> with a muted note instead of a broken-image icon. Uses the
  // capture phase because 'error' on <img> does not bubble.
  document.addEventListener(
    'error',
    (event) => {
      const img = event.target;
      if (!img || !img.classList || !img.classList.contains('msg-corpus-img')) {
        return;
      }
      const wrap = img.closest('.msg-att-img') || img;
      const span = document.createElement('span');
      span.className = 'msg-corpus-missing';
      span.textContent = `${img.getAttribute('alt') || 'imagem'} — imagem indisponível`;
      wrap.replaceWith(span);
    },
    true
  );

  document.addEventListener('keydown', (event) => {
    if (
      linkrefMenuOpen() &&
      (event.target.closest('[data-wizard-field="body"]') ||
        event.target.closest('[data-cw-field="body"]') ||
        event.target.closest('[data-merge-edit]')) &&
      handleLinkrefKey(event)
    ) {
      return;
    }
    // #6: keyboard nav for the global search dropdown (Esc close · ↑/↓ move · Enter open).
    if (state.omni && state.omni.open && event.target.closest('.global-search')) {
      const results = omniResults();
      if (event.key === 'Escape') {
        event.preventDefault();
        closeOmni();
        return;
      }
      if (results.length && event.key === 'ArrowDown') {
        event.preventDefault();
        state.omni.active = Math.min(results.length - 1, (state.omni.active || 0) + 1);
        renderShell();
        requestAnimationFrame(refocusSearch);
        return;
      }
      if (results.length && event.key === 'ArrowUp') {
        event.preventDefault();
        state.omni.active = Math.max(0, (state.omni.active || 0) - 1);
        renderShell();
        requestAnimationFrame(refocusSearch);
        return;
      }
      if (results.length && event.key === 'Enter') {
        const r = results[state.omni.active || 0];
        if (r) {
          event.preventDefault();
          omniOpen(r.type, r.key);
          return;
        }
      }
    }
    const chatInput = event.target.closest('[data-chat-input]');
    if (chatInput) {
      if (mentionMenuOpen() && state.mention.field === 'chat' && handleMentionKey(event)) {
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
      }
      return;
    }
    const plenariaInput = event.target.closest('[data-plenaria-input]');
    if (plenariaInput) {
      if (mentionMenuOpen() && state.mention.field === 'plenaria' && handleMentionKey(event)) {
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendPlenariaMessage();
      }
      return;
    }
    const plenariaJoin = event.target.closest('[data-plenaria-join-input]');
    if (plenariaJoin) {
      if (event.key === 'Enter') {
        event.preventDefault();
        joinPlenaria();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        toggleJoinPlenaria();
      }
      return;
    }
    const plenariaRename = event.target.closest('[data-plenaria-rename-input]');
    if (plenariaRename) {
      if (event.key === 'Enter') {
        event.preventDefault();
        savePlenariaRename(ensurePlenariaState().renamingId);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        ensurePlenariaState().renamingId = null;
        renderShell();
      }
      return;
    }
    const renameInput = event.target.closest('[data-chat-rename-input]');
    if (renameInput) {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveChatRename(ensureChatState().renamingId);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        ensureChatState().renamingId = null;
        renderShell();
      }
      return;
    }
    const docEditorKey = event.target.closest('[data-doc-editor]');
    if (docEditorKey) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        saveDoc();
      }
      return;
    }
    const exploreCommonsEditorKey = event.target.closest('[data-explore-commons-editor]');
    if (exploreCommonsEditorKey) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        exploreCommonsSave();
      }
      return;
    }
    const docNewKey = event.target.closest('[data-doc-new-title], [data-doc-new-path]');
    if (docNewKey) {
      if (event.key === 'Enter') {
        event.preventDefault();
        createDoc();
      }
      return;
    }
    const wizardCurator = event.target.closest('[data-wizard-curator-input]');
    if (wizardCurator && state.wizard) {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        wizardAddCurator(wizardCurator.value);
      } else if (event.key === 'Backspace' && !wizardCurator.value && state.wizard.form.curators.length) {
        event.preventDefault();
        wizardRemoveCurator(state.wizard.form.curators[state.wizard.form.curators.length - 1]);
      }
      return;
    }
    const wizardReader = event.target.closest('[data-wizard-reader-input]');
    if (wizardReader && state.wizard) {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        wizardAddReader(wizardReader.value);
      } else if (event.key === 'Backspace' && !wizardReader.value && state.wizard.form.readers.length) {
        event.preventDefault();
        wizardRemoveReader(state.wizard.form.readers[state.wizard.form.readers.length - 1]);
      }
      return;
    }
    const wizardEval = event.target.closest('[data-wizard-eval-input]');
    if (wizardEval && state.wizard) {
      // Only Enter commits — commas are allowed inside a criterion.
      if (event.key === 'Enter') {
        event.preventDefault();
        wizardAddEval(wizardEval.value);
      } else if (event.key === 'Backspace' && !wizardEval.value && state.wizard.form.evalCriteria.length) {
        event.preventDefault();
        wizardRemoveEval(state.wizard.form.evalCriteria[state.wizard.form.evalCriteria.length - 1]);
      }
      return;
    }
    const cwCurator = event.target.closest('[data-cw-curator-input]');
    if (cwCurator && state.commonsWizard) {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        cwAddCurator(cwCurator.value);
      } else if (event.key === 'Backspace' && !cwCurator.value && state.commonsWizard.form.curators.length) {
        event.preventDefault();
        cwRemoveCurator(state.commonsWizard.form.curators[state.commonsWizard.form.curators.length - 1]);
      }
      return;
    }
    const cwReader = event.target.closest('[data-cw-reader-input]');
    if (cwReader && state.commonsWizard) {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        cwAddReader(cwReader.value);
      } else if (event.key === 'Backspace' && !cwReader.value && (state.commonsWizard.form.readers || []).length) {
        event.preventDefault();
        cwRemoveReader(state.commonsWizard.form.readers[state.commonsWizard.form.readers.length - 1]);
      }
      return;
    }
    const cwEval = event.target.closest('[data-cw-eval-input]');
    if (cwEval && state.commonsWizard) {
      if (event.key === 'Enter') {
        event.preventDefault();
        cwAddEval(cwEval.value);
      } else if (event.key === 'Backspace' && !cwEval.value && state.commonsWizard.form.evalCriteria.length) {
        event.preventDefault();
        cwRemoveEval(state.commonsWizard.form.evalCriteria[state.commonsWizard.form.evalCriteria.length - 1]);
      }
      return;
    }
    const domainsAdminInput = event.target.closest('[data-domains-admin-input]');
    if (domainsAdminInput && state.domainsAdmin) {
      // Até a 2.0.18 o Backspace num campo vazio removia o último domínio na hora, sem confirmação; com os
      // curadores organizando domínios (D1), remover fica só no botão de cada linha.
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addDomainAdmin(domainsAdminInput.value);
      }
      return;
    }
    if (!state.draftModal) {
      return;
    }
    const tagInput = event.target.closest('[data-draft-tag-input]');
    if (!tagInput) {
      return;
    }
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addDraftTag(tagInput.value);
    } else if (event.key === 'Backspace' && !tagInput.value && state.draftModal.tags.length) {
      event.preventDefault();
      removeDraftTag(state.draftModal.tags[state.draftModal.tags.length - 1]);
    }
  });

  // Apply the cached theme and wire the system-preference listener (the inline
  // <head> script already stamped data-theme to avoid a flash; profile reconciles
  // during attemptLocalLogin()).
}
