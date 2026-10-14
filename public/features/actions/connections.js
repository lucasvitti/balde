export function createConnectionsActions({
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
}) {
  // Cada ação reconhecida encerra o despacho para evitar efeitos duplicados.
  return async function handleAction(action, event) {
    const actionName = action.dataset.action;
    const id = action.dataset.id;
    if (actionName === 'saveAiConfig') {
      await saveAiConfig();
      return true;
    }
    if (actionName === 'aiCliRefresh') {
      await loadAiCliStatus(true);
      return true;
    }
    if (actionName === 'aiCliLogin') {
      await aiCliLogin(action.dataset.client);
      return true;
    }
    if (actionName === 'aiCliTest') {
      await aiCliTest(action.dataset.client);
      return true;
    }
    if (actionName === 'aiCliUse') {
      await aiCliUse(action.dataset.client);
      return true;
    }
    if (actionName === 'aiMcpSetup') {
      await aiMcpSetup(action.dataset.client);
      return true;
    }
    if (actionName === 'testAiKey') {
      await testAiKey();
      return true;
    }
    if (actionName === 'clearAiKey') {
      await clearAiKey();
      return true;
    }
    if (actionName === 'runConnDiag') {
      await runConnDiag();
      return true;
    }
    if (actionName === 'copyConnDiag') {
      await copyConnDiag();
      return true;
    }
    if (actionName === 'createApiToken') {
      await createApiToken();
      return true;
    }
    if (actionName === 'revokeApiToken') {
      await revokeApiToken(action.dataset.identifier);
      return true;
    }
    if (actionName === 'renameApiToken') {
      renameApiToken(action.dataset.identifier);
      return true;
    }
    if (actionName === 'cancelRenameToken') {
      cancelRenameToken();
      return true;
    }
    if (actionName === 'saveRenameToken') {
      await saveRenameToken(action.dataset.identifier);
      return true;
    }
    if (actionName === 'toggleRevealToken') {
      await toggleRevealToken(action.dataset.identifier);
      return true;
    }
    if (actionName === 'copyToken') {
      await copyToken(action.dataset.identifier);
      return true;
    }
    if (actionName === 'copyApiCurl') {
      await copyApiCurl(action.dataset.idx);
      return true;
    }
    if (actionName === 'setApiTab') {
      state.apiTab = action.dataset.apiTab;
      renderShell();
      return true;
    }
    if (actionName === 'dismissNewToken') {
      dismissNewToken();
      return true;
    }
    if (actionName === 'copyNewToken') {
      await copyNewToken();
      return true;
    }
    return false;
  };
}
