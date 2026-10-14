export function createCreationActions({
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
}) {
  // Cada ação reconhecida encerra o despacho para evitar efeitos duplicados.
  return async function handleAction(action, event) {
    const actionName = action.dataset.action;
    const id = action.dataset.id;
    if (actionName === 'openUpload') {
      openUpload();
      return true;
    }
    if (actionName === 'closeUpload') {
      closeUpload();
      return true;
    }
    if (actionName === 'submitUpload') {
      await submitUpload();
      return true;
    }
    if (actionName === 'openContribute') {
      openContribute(id);
      return true;
    }
    if (actionName === 'closeContribute') {
      closeContribute();
      return true;
    }
    if (actionName === 'submitContribute') {
      await submitContribute();
      return true;
    }
    if (actionName === 'wizardNext') {
      await wizardNext();
      return true;
    }
    if (actionName === 'wizardBack') {
      wizardBack();
      return true;
    }
    if (actionName === 'wizardGoto') {
      wizardGoto(action.dataset.step);
      return true;
    }
    if (actionName === 'wizardCancel') {
      wizardCancel();
      return true;
    }
    if (actionName === 'wizardPrefillBody') {
      wizardPrefillBody();
      return true;
    }
    if (actionName === 'submitCreateSkill') {
      await submitCreateSkill();
      return true;
    }
    if (actionName === 'wizardClassifyFiles') {
      await wizardClassifyFiles();
      return true;
    }
    if (actionName === 'wizardProcessMedia') {
      await wizardProcessMedia();
      return true;
    }
    if (actionName === 'wizardRemoveContextFile') {
      wizardRemoveContextFile(action.dataset.rel);
      return true;
    }
    if (actionName === 'wizardToggleToCommons') {
      wizardToggleToCommons(action.dataset.rel);
      return true;
    }
    if (actionName === 'wizardRemoveCurator') {
      wizardRemoveCurator(action.dataset.email);
      return true;
    }
    if (actionName === 'wizardRemoveReader') {
      wizardRemoveReader(action.dataset.email);
      return true;
    }
    if (actionName === 'wizardRemoveEval') {
      wizardRemoveEval(action.dataset.crit);
      return true;
    }
    if (actionName === 'cwGoto') {
      cwGoto(action.dataset.step);
      return true;
    }
    if (actionName === 'cwBack') {
      cwBack();
      return true;
    }
    if (actionName === 'cwNext') {
      cwNext();
      return true;
    }
    if (actionName === 'cwCancel') {
      cwCancel();
      return true;
    }
    if (actionName === 'cwPrefillBody') {
      cwPrefillBody();
      return true;
    }
    if (actionName === 'cwRemoveMedia') {
      cwRemoveMedia(action.dataset.rel);
      return true;
    }
    if (actionName === 'cwDescribeMedia') {
      await cwDescribeMedia(action.dataset.rel);
      return true;
    }
    if (actionName === 'cwDescribeAllMedia') {
      await cwDescribeAllMedia();
      return true;
    }
    if (actionName === 'cwRemoveCurator') {
      cwRemoveCurator(action.dataset.email);
      return true;
    }
    if (actionName === 'cwRemoveReader') {
      cwRemoveReader(action.dataset.email);
      return true;
    }
    if (actionName === 'cwRemoveEval') {
      cwRemoveEval(action.dataset.crit);
      return true;
    }
    if (actionName === 'capsuleImportPick') {
      capsuleImportPick();
      return true;
    }
    if (actionName === 'manifestImportPick') {
      manifestImportPick();
      return true;
    }
    if (actionName === 'manifestImportCompile') {
      await manifestImportCompile();
      return true;
    }
    if (actionName === 'manifestImportSubmit') {
      await manifestImportSubmit();
      return true;
    }
    if (actionName === 'manifestImportReset') {
      manifestImportReset();
      return true;
    }
    if (actionName === 'submitCreateCommons') {
      await submitCreateCommons();
      return true;
    }
    if (actionName === 'wizardVincularCommons') {
      insertLinkrefTrigger('wizardBody', 2);
      return true;
    }
    if (actionName === 'wizardVincularSkill') {
      insertLinkrefTrigger('wizardBody', 3);
      return true;
    }
    if (actionName === 'addPastedFile') {
      addDraftPastedFile();
      return true;
    }
    if (actionName === 'removeDraftFile') {
      removeDraftFile(action.dataset.name);
      return true;
    }
    if (actionName === 'addTag') {
      addDraftTag(action.dataset.tag);
      return true;
    }
    if (actionName === 'removeTag') {
      removeDraftTag(action.dataset.tag);
      return true;
    }
    if (actionName === 'wizardEvalAddItem') {
      wizardEvalAddItem();
      return true;
    }
    if (actionName === 'wizardEvalRemoveItem') {
      wizardEvalRemoveItem(action.dataset.id);
      return true;
    }
    if (actionName === 'wizardEvalSuggest') {
      await wizardEvalSuggest();
      return true;
    }
    if (actionName === 'wizardEvalTab') {
      wizardEvalTab(action.dataset.tab);
      return true;
    }
    if (actionName === 'wizardEvalOptAdd') {
      wizardEvalOptAdd();
      return true;
    }
    if (actionName === 'wizardEvalOptReq') {
      wizardEvalOptReq(action.dataset.opt);
      return true;
    }
    if (actionName === 'wizardEvalOptForbid') {
      wizardEvalOptForbid(action.dataset.opt);
      return true;
    }
    if (actionName === 'wizardEvalOptDel') {
      wizardEvalOptDel(action.dataset.opt);
      return true;
    }
    if (actionName === 'wizardAclAddEmail') {
      wizardAclAddEmail(action.dataset.axis);
      return true;
    }
    return false;
  };
}
