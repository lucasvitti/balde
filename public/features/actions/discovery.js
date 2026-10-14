export function createDiscoveryActions({
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
}) {
  // Cada ação reconhecida encerra o despacho para evitar efeitos duplicados.
  return async function handleAction(action, event) {
    const actionName = action.dataset.action;
    const id = action.dataset.id;
    if (actionName === 'ontologyOpen') {
      await openOntologyInExplorer(action.dataset.domain);
      return true;
    }
    if (actionName === 'ontologyEdit') {
      await openOntologyEditor(action.dataset.domain);
      return true;
    }
    if (actionName === 'ontologyCreate') {
      openOntologyEditorNew(action.dataset.domain);
      return true;
    }
    if (actionName === 'ontologyCreateAi') {
      await ontologyCreateAi(action.dataset.domain);
      return true;
    }
    if (actionName === 'ontologySuggestAi') {
      await ontologySuggestAdditionsAi(action.dataset.domain);
      return true;
    }
    if (actionName === 'ontologyEditorClose') {
      closeOntologyEditor();
      return true;
    }
    if (actionName === 'ontologyAddConcept') {
      ontologyAddConcept();
      return true;
    }
    if (actionName === 'ontologyRemoveConcept') {
      ontologyRemoveConcept(action.dataset.i);
      return true;
    }
    if (actionName === 'ontologySave') {
      await saveOntology();
      return true;
    }
    if (actionName === 'dedupRescan') {
      await loadDedupAdmin();
      renderShell();
      return true;
    }
    if (actionName === 'domainAddNew') {
      await domainAddNew(action.dataset.kind);
      return true;
    }
    if (actionName === 'dedupDismiss') {
      const d = state.dedupAdmin;
      const p = d && d.pairs[Number(action.dataset.idx)];
      if (!p) return true;
      await fetch('/api/dedup/dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ a: p.a.id, b: p.b.id })
      });
      await loadDedupAdmin();
      renderShell();
      return true;
    }
    if (actionName === 'ingestSend') {
      await ingestSend();
      return true;
    }
    if (actionName === 'ingestMaterialize') {
      await ingestMaterialize();
      return true;
    }
    if (actionName === 'ingestBack') {
      ingestState().job = null;
      await ingestLoadJobs();
      renderShell();
      return true;
    }
    if (actionName === 'ingestUnstage') {
      ingestState().staged.splice(Number(action.dataset.idx), 1);
      renderShell();
      return true;
    }
    if (actionName === 'ingestOpen') {
      const data = await (await fetch(`/api/ingest/job?id=${encodeURIComponent(action.dataset.job)}`)).json();
      if (data.ok) {
        ingestState().job = data.job;
        await ingestLoadDomains();
        await ingestCheckDupes();
        renderShell();
        ingestEnsurePoll();
      }
      return true;
    }
    if (actionName === 'dupOpenNode') {
      const node = String(action.dataset.node || '');
      await navigate('explore');
      if (node.startsWith('commons/')) {
        await loadExploreCommonsConcept(node.slice('commons/'.length));
      } else {
        await loadExploreSkill(node);
      }
      return true;
    }
    if (actionName === 'ingestDiscard') {
      await fetch('/api/ingest/discard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: action.dataset.job })
      });
      ingestState().job = null;
      await ingestLoadJobs();
      renderShell();
      return true;
    }
    return false;
  };
}
