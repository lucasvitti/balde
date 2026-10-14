export function createEvaluationsActions({
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
}) {
  // Cada ação reconhecida encerra o despacho para evitar efeitos duplicados.
  return async function handleAction(action, event) {
    const actionName = action.dataset.action;
    const id = action.dataset.id;
    if (actionName === 'evalAddItem') {
      evalAddItem();
      return true;
    }
    if (actionName === 'evalRemoveItem') {
      evalRemoveItem(action.dataset.id);
      return true;
    }
    if (actionName === 'evalAccept') {
      event.preventDefault();
      evalAccept(action.dataset.id, action.dataset.mandatory);
      return true;
    }
    if (actionName === 'evalReject') {
      event.preventDefault();
      evalReject(action.dataset.id, action.dataset.mandatory);
      return true;
    }
    if (actionName === 'evalTab') {
      evalTab(action.dataset.tab);
      return true;
    }
    if (actionName === 'evalSave') {
      await evalSave();
      return true;
    }
    if (actionName === 'evalRun') {
      await evalRun();
      return true;
    }
    if (actionName === 'evalTestCase') {
      await evalTestCase(action.dataset.id);
      return true;
    }
    if (actionName === 'evalSuggestCases') {
      await evalSuggestCases();
      return true;
    }
    if (actionName === 'evalSuggestionAdd') {
      await evalSuggestionAdd(action.dataset.key);
      return true;
    }
    if (actionName === 'evalSuggestionDismiss') {
      evalSuggestionDismiss(action.dataset.key);
      return true;
    }
    if (actionName === 'evalPromote') {
      await evalPromote();
      return true;
    }
    if (actionName === 'eclAdd') {
      eclAdd();
      return true;
    }
    if (actionName === 'eclRemove') {
      eclRemove(action.dataset.idx);
      return true;
    }
    if (actionName === 'eclOptAdd') {
      eclOptAdd(action.dataset.idx);
      return true;
    }
    if (actionName === 'eclOptReq') {
      eclOptReq(action.dataset.idx, action.dataset.opt);
      return true;
    }
    if (actionName === 'eclOptForbid') {
      eclOptForbid(action.dataset.idx, action.dataset.opt);
      return true;
    }
    if (actionName === 'eclOptDel') {
      eclOptDel(action.dataset.idx, action.dataset.opt);
      return true;
    }
    if (actionName === 'eclSave') {
      await eclSave();
      return true;
    }
    if (actionName === 'scoringSave') {
      await scoringSave();
      return true;
    }
    if (actionName === 'curatorKeepGreen') {
      await curatorKeepGreen(action.dataset.id, action.dataset.path || '');
      return true;
    }
    if (actionName === 'curatorKeepAllGreen') {
      await curatorKeepAllGreen(action.dataset.id);
      return true;
    }
    if (actionName === 'curatorRunEval') {
      await curatorRunEval(action.dataset.id, action.dataset.path);
      return true;
    }
    return false;
  };
}
