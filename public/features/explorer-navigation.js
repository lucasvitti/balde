export function createExplorerNavigationFeature({
  state,
  skillDomainOf,
  commonsDomainKey,
  renderShell,
  navigate,
  readJsonResponse,
  skillGroupKey,
  toast,
  commonsAction,
  canManageSkill,
  openAccessTab,
  escapeHtml,
  computeGraphLayout
}) {
  async function openExplore() {
    const fresh = !state.explore;
    if (fresh) {
      // Initial tidy tree: Skills root expanded, Commons root collapsed (only
      // 'Skills' in openDomains); all domains collapsed (seeded below once data loads).
      state.explore = {
        mode: 'skills',
        skillGroupBy: 'tag',
        domainFilter: '',
        mineOnly: false,
        selectedId: null,
        tab: 'overview',
        file: 'SKILL.md',
        bundle: null,
        fileContent: null,
        loading: false,
        error: null,
        filter: '',
        expanded: false,
        openFolders: new Set(),
        openDomains: new Set(['Skills']),
        collapsedDomains: new Set(),
        graph: null,
        graphLoading: false,
        graphError: null,
        graphSelected: null,
        commonsData: null,
        commonsLoading: false,
        commonsError: null,
        commonsSelectedPath: null,
        commonsFile: null
      };
    }
    // Both roots need data: skills are already in state.skills; fetch the commons list.
    await loadCommonsListForExplore();
    if (fresh) {
      // Collapse every skill + commons domain on first open.
      const collapsed = state.explore.collapsedDomains;
      for (const s of state.skills || []) collapsed.add(`skills::${skillDomainOf(s) || 'Sem domínio'}`);
      for (const c of (state.explore.commonsData && state.explore.commonsData.concepts) || []) {
        const d = commonsDomainKey(c.path);
        collapsed.add(`commons::${d === '—' ? 'Sem domínio' : d}`);
      }
    }
    // Restore/choose a default selection for the detail pane.
    if (state.explore.mode === 'commons' && state.explore.commonsSelectedPath) {
      await loadExploreCommonsConcept(state.explore.commonsSelectedPath, true);
      return;
    }
    const firstSkill = state.explore.selectedId || (state.skills[0] && state.skills[0].id);
    if (firstSkill) {
      await loadExploreSkill(firstSkill, false); // default selection: keep the tree collapsed (don't reveal its domain)
      return;
    }
    const firstConcept = ((state.explore.commonsData && state.explore.commonsData.concepts) || [])[0];
    if (firstConcept) {
      await loadExploreCommonsConcept(firstConcept.path);
      return;
    }
    renderShell();
  }

  // Open "Explorar o corpus" focused on a specific skill (e.g. from Aprovações'
  // "Abrir no corpus"), replacing the retired standalone skill detail view.
  async function openSkillInExplore(id) {
    await navigate('explore'); // initializes explore state + loads the corpus (selects first skill)
    if (id) {
      await loadExploreSkill(id); // re-focus on the requested skill
    }
  }

  // Open a capsule in the corpus explorer (mirrors openSkillInExplore) — the top-bar search uses
  // this so selecting a capsule lands on the explorer with it open, not the Commons-page popup.
  async function openCommonsInExplore(path) {
    await navigate('explore');
    if (state.explore) state.explore.navStack = []; // fresh navigation from search — clear drill-down history
    await loadCommonsListForExplore(); // ensure the concept list is present so the detail renders
    if (path) {
      await loadExploreCommonsConcept(path);
    }
  }

  // Fetch just the commons concept list into the explore state (no selection),
  // so the Commons root can render alongside Skills.
  async function loadCommonsListForExplore() {
    if (!state.explore || state.explore.commonsData) return; // cached within the session
    state.explore.commonsLoading = true;
    state.explore.commonsError = null;
    try {
      const res = await fetch('/api/commons');
      const data = await readJsonResponse(res);
      if (!res.ok || data.ok === false) {
        state.explore.commonsError = data.error || `HTTP ${res.status}`;
        state.explore.commonsData = null;
      } else state.explore.commonsData = data;
    } catch (error) {
      state.explore.commonsError = error.message || 'Erro de rede.';
      state.explore.commonsData = null;
    }
    state.explore.commonsLoading = false;
  }

  // The corpus explorer browses two neighborhoods; the combobox flips between them. Skills keep
  // the git-bundle detail; commons reuses the same repo chrome over /api/commons + /api/commons/file.
  async function setExploreMode(mode) {
    if (!state.explore) return;
    state.explore.mode = mode;
    state.explore.corpusView = false;
    if (!(state.explore.openDomains instanceof Set)) state.explore.openDomains = new Set();
    if (mode === 'commons') {
      state.explore.openDomains.add('Cápsulas');
      await openExploreCommons();
    } else {
      state.explore.openDomains.add('Skills');
      const first = state.explore.selectedId || (state.skills[0] && state.skills[0].id);
      if (first) await loadExploreSkill(first);
      else renderShell();
    }
  }

  function setExploreSkillGroupBy(key) {
    if (!state.explore) return;
    state.explore.skillGroupBy = key === 'owner' ? 'owner' : 'tag';
    state.explore.openDomains = new Set(); // regrouping invalidates the open-set
    const sk = (state.skills || []).find((s) => s.id === state.explore.selectedId);
    if (sk) state.explore.openDomains.add(skillGroupKey(sk, state.explore.skillGroupBy)); // keep the selected skill visible
    renderShell();
  }

  async function openExploreCommons() {
    if (!state.explore) return;
    state.explore.commonsLoading = true;
    state.explore.commonsError = null;
    renderShell();
    try {
      const res = await fetch('/api/commons');
      const data = await readJsonResponse(res);
      if (!res.ok || data.ok === false) {
        state.explore.commonsError = data.error || `HTTP ${res.status}`;
        state.explore.commonsData = null;
      } else state.explore.commonsData = data;
    } catch (error) {
      state.explore.commonsError = error.message || 'Erro de rede.';
      state.explore.commonsData = null;
    }
    state.explore.commonsLoading = false;
    const concepts = (state.explore.commonsData && state.explore.commonsData.concepts) || [];
    const keep =
      state.explore.commonsSelectedPath && concepts.some((c) => c.path === state.explore.commonsSelectedPath);
    const sel = keep ? state.explore.commonsSelectedPath : concepts[0] && concepts[0].path;
    if (sel) {
      if (!(state.explore.openDomains instanceof Set)) state.explore.openDomains = new Set();
      state.explore.openDomains.add(commonsDomainKey(sel));
      await loadExploreCommonsConcept(sel);
    } else {
      renderShell();
    }
  }

  // Load one commons concept's content + git history + media into the explore pane. preserveTab keeps
  // the current tab (used by refreshes after a governance/media action, so the view doesn't jump).
  async function loadExploreCommonsConcept(path, preserveTab = false) {
    if (!state.explore) return;
    state.explore.commonsSelectedPath = path;
    state.explore.mode = 'commons';
    if (!(state.explore.openDomains instanceof Set)) state.explore.openDomains = new Set();
    state.explore.openDomains.add('Cápsulas'); // reveal the Commons root on select
    if (state.explore.collapsedDomains instanceof Set) {
      const _d = commonsDomainKey(path);
      state.explore.collapsedDomains.delete(`commons::${_d === '—' ? 'Sem domínio' : _d}`);
    }
    if (!preserveTab) state.explore.tab = 'overview';
    state.explore.commonsFile = {
      path,
      loading: true,
      error: null,
      content: '',
      history: [],
      media: null,
      editing: false,
      draft: '',
      saving: false,
      processing: false,
      tooLarge: false
    };
    renderShell();
    try {
      const res = await fetch(`/api/commons/file?path=${encodeURIComponent(path)}`);
      const data = await readJsonResponse(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      state.explore.commonsFile = {
        path,
        loading: false,
        error: null,
        content: data.content || '',
        history: data.history || [],
        media: data.media || { images: [], data: [] },
        editing: false,
        draft: data.content || '',
        saving: false,
        processing: false,
        tooLarge: !!data.tooLarge,
        size: data.size
      };
    } catch (error) {
      if (state.explore.commonsFile && state.explore.commonsFile.path === path) {
        state.explore.commonsFile.loading = false;
        state.explore.commonsFile.error = error.message || 'Erro de rede.';
      }
    }
    renderShell();
  }
  // the referenced artifact and remember where we came from (navStack); "Voltar" returns to it.
  function currentExploreArtifact() {
    const ex = state.explore || {};
    if (ex.mode === 'commons' && ex.commonsSelectedPath) return { kind: 'commons', id: ex.commonsSelectedPath };
    if (ex.selectedId) return { kind: 'skill', id: ex.selectedId };
    return null;
  }
  async function exploreOpenArtifact(kind, id) {
    if (!state.explore) return;
    if (kind === 'commons') {
      state.explore.mode = 'commons';
      await loadExploreCommonsConcept(id);
    } else {
      state.explore.mode = 'skills';
      await loadExploreSkill(id);
    }
  }
  async function exploreOpenRef(href) {
    if (!href || !state.explore) return;
    let target = null;
    if (href.indexOf('/commons/') === 0) target = { kind: 'commons', id: href.slice('/commons/'.length) };
    else if (/\/SKILL\.md$/.test(href))
      target = { kind: 'skill', id: href.replace(/^\//, '').replace(/\/SKILL\.md$/, '') };
    if (!target || !target.id) return;
    const cur = currentExploreArtifact();
    state.explore.navStack = state.explore.navStack || [];
    if (cur && !(cur.kind === target.kind && String(cur.id) === String(target.id))) state.explore.navStack.push(cur);
    await exploreOpenArtifact(target.kind, target.id);
  }
  async function exploreBack() {
    const ex = state.explore;
    if (!ex || !Array.isArray(ex.navStack) || !ex.navStack.length) return;
    const prev = ex.navStack.pop();
    await exploreOpenArtifact(prev.kind, prev.id);
  }

  // Refetch the commons list (so summaries/badges/governance update) and optionally reload the open
  // concept (preserving its tab). Reuses the same endpoints as the standalone Commons page.
  async function refreshExploreCommons(reloadPath) {
    try {
      const res = await fetch('/api/commons');
      const data = await readJsonResponse(res);
      if (res.ok && data.ok !== false && state.explore) state.explore.commonsData = data;
    } catch (error) {
      /* keep prior list on a transient failure */
    }
    if (reloadPath) await loadExploreCommonsConcept(reloadPath, true);
    else renderShell();
  }

  function exploreCommonsToggleEdit() {
    const f = state.explore && state.explore.commonsFile;
    if (!f) return;
    f.editing = !f.editing;
    if (f.editing) f.draft = f.content;
    renderShell();
  }

  async function exploreCommonsSave() {
    const f = state.explore && state.explore.commonsFile;
    if (!f) return;
    const editor = document.querySelector('[data-explore-commons-editor]');
    const content = editor ? editor.value : f.draft;
    f.saving = true;
    renderShell();
    try {
      const res = await fetch('/api/commons/file', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: f.path, content })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      f.content = content;
      f.draft = content;
      f.editing = false;
      f.saving = false;
      f.history = data.history || f.history;
      toast('Conceito salvo.', 'success');
      renderShell();
      await refreshExploreCommons(); // refresh list summary/badges (no concept reload → keep tab + saved content)
    } catch (error) {
      f.saving = false;
      toast(error.message || 'Falha ao salvar.', 'warning');
      renderShell();
    }
  }

  async function exploreCommonsProcessMedia() {
    const f = state.explore && state.explore.commonsFile;
    if (!f) return;
    f.processing = true;
    renderShell();
    toast('Processando mídia com IA…');
    try {
      const res = await fetch('/api/commons/process-media', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: f.path })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      const c = data.counts || { img: {}, data: {} };
      toast(`Mídia processada: ${c.img.described || 0} imagem(ns) · ${c.data.described || 0} tabela(s).`, 'success');
      await refreshExploreCommons(f.path); // reload concept with fresh descriptions (preserveTab)
    } catch (error) {
      if (f) f.processing = false;
      toast(error.message || 'Falha ao processar mídia.', 'warning');
      renderShell();
    }
  }

  async function exploreCommonsKeepGreen(path) {
    const d = await commonsAction('govern/review', path ? { path } : {});
    if (d) {
      toast('Conceito revisado.', 'success');
      await refreshExploreCommons(path);
    }
  }
  async function exploreCommonsRunEval(path) {
    toast('Rodando eval com IA…');
    const d = await commonsAction('govern/eval-run', { path });
    if (d) {
      const o = d.evalStatus && d.evalStatus.overall;
      toast(`Eval: ${o === 'fail' ? 'falhou' : 'passou'}.`, o === 'fail' ? 'warning' : 'success');
      await refreshExploreCommons(path);
    }
  }
  // Fechar/reabrir uma cápsula (fechada = fato passado validado e congelado).
  async function commonsToggleClosed(path, close) {
    const d = await commonsAction('govern/close', { path, close });
    if (d) {
      toast(close ? 'Cápsula fechada — congelada como fato passado.' : 'Cápsula reaberta.', 'success');
      await refreshExploreCommons(path);
    }
  }

  // Arquivar uma cápsula (D6): a confirmação diz quais skills apontam para ela, porque esses links ficam
  // quebrados até a restauração, e avisa quando é a ontologia do domínio.
  function archiveCapsuleConfirm(path) {
    const concepts = (state.explore && state.explore.commonsData && state.explore.commonsData.concepts) || [];
    const refs = (concepts.find((c) => c.path === path) || {}).referencedBy || [];
    const linked = refs.length
      ? `${refs.length === 1 ? 'Uma skill aponta' : `${refs.length} skills apontam`} para ela (${refs.join(', ')}); esses links ficam quebrados até a restauração.`
      : '';
    const ontology =
      String(path).split('/')[1] === 'ontologia'
        ? 'É a ontologia do domínio: o chat deixa de receber esse vocabulário.'
        : '';
    state.confirm = {
      type: 'archiveCapsule',
      id: path,
      title: `Arquivar a cápsula "${path}"?`,
      body: [
        'A cápsula sai do corpus ativo: chat, MCP e buscas deixam de vê-la. Ela fica em Governança › Arquivadas, de onde um curador a restaura.',
        linked,
        ontology
      ]
        .filter(Boolean)
        .join(' '),
      confirmLabel: 'Arquivar cápsula'
    };
    renderShell();
  }

  async function archiveCapsule(path) {
    state.confirm = null;
    const archived = await commonsAction('archive', { path });
    if (!archived) {
      renderShell();
      return;
    }
    toast(`Cápsula "${path}" arquivada.`, 'success');
    if (state.explore) {
      state.explore.commonsSelectedPath = null;
      state.explore.commonsFile = null;
    }
    await refreshExploreCommons();
  }

  function exploreAllGroupNames() {
    // Two root categories now — Skills and Commons.
    return new Set(['Skills', 'Cápsulas']);
  }
  function exploreExpandAllGroups() {
    if (state.explore) {
      state.explore.openDomains = exploreAllGroupNames();
      state.explore.collapsedDomains = new Set();
      renderShell();
    }
  }
  function exploreCollapseAllGroups() {
    if (state.explore) {
      state.explore.openDomains = new Set();
      renderShell();
    }
  }

  async function loadExploreSkill(id, revealDomain = true) {
    if (!state.explore) {
      state.explore = {};
    }
    state.explore.selectedId = id;
    state.explore.mode = 'skills';
    // Open the Skills root; when revealDomain, also expand the selected skill's
    // domain so the selection is visible (corpus map / omni / row click). The
    // initial default selection passes false to keep the tree collapsed.
    if (!(state.explore.openDomains instanceof Set)) state.explore.openDomains = new Set();
    state.explore.openDomains.add('Skills');
    if (revealDomain && state.explore.collapsedDomains instanceof Set) {
      const _sk = (state.skills || []).find((s) => s.id === id);
      if (_sk) state.explore.collapsedDomains.delete(`skills::${skillDomainOf(_sk) || 'Sem domínio'}`);
    }
    state.explore.tab = 'overview';
    state.explore.file = 'SKILL.md';
    state.explore.fileContent = null;
    state.explore.dataTool = null; // DuckDB results are per-skill/per-file
    state.explore.commonsDataTool = null;
    state.explore.graph = null; // context graph is per-skill; reload lazily on the tab
    state.explore.graphError = null;
    state.explore.graphSelected = null;
    state.explore.openFolders = new Set(); // start with all folders collapsed
    state.explore.loading = true;
    state.explore.error = null;
    renderShell();
    try {
      const res = await fetch(`/api/explore/skill?skill=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        state.explore.error = data.error || `Falha ao carregar (HTTP ${res.status}).`;
        state.explore.bundle = null;
      } else {
        state.explore.bundle = data;
      }
    } catch (error) {
      state.explore.error = error.message || 'Erro de rede.';
      state.explore.bundle = null;
    }
    state.explore.loading = false;
    renderShell();
  }

  function setExploreTab(tab) {
    if (!state.explore) {
      return;
    }
    state.explore.tab = tab;
    renderShell();
    // The Acessos tab reuses the detail-view access editor, which needs its data
    // fetched on demand (visibility + roster + groups) for the selected skill.
    if (tab === 'access') {
      const s = (state.skills || []).find((x) => x.id === state.explore.selectedId);
      // Only stewards load the editable ACL (the /access endpoint is manager-gated);
      // everyone else gets a read-only view built from the skill's own visibility.
      if (s && canManageSkill(s)) openAccessTab(s.id);
    }
    // The Grafo + Curadoria tabs both read the context manifest (graph + per-concept governance).
    if (
      (tab === 'graph' || tab === 'curadoria') &&
      !state.explore.graph &&
      !state.explore.graphLoading &&
      state.explore.selectedId
    ) {
      loadExploreGraph(state.explore.selectedId);
    }
  }

  async function loadExploreGraph(id) {
    if (!state.explore) {
      return;
    }
    state.explore.graphLoading = true;
    state.explore.graphError = null;
    renderShell();
    try {
      const res = await fetch(`/api/explore/context?skill=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        state.explore.graphError = data.error || `Falha ao carregar o grafo (HTTP ${res.status}).`;
        state.explore.graph = null;
      } else if (state.explore.selectedId === id) {
        // ignore a stale response if the user switched skills mid-flight
        state.explore.graph = data;
      }
    } catch (error) {
      state.explore.graphError = error.message || 'Erro de rede.';
      state.explore.graph = null;
    }
    state.explore.graphLoading = false;
    renderShell();
  }

  // X2: the corpus-wide map — skills + commons as nodes, aggregated cross-links as edges.
  async function toggleCorpusGraph() {
    if (!state.explore) return;
    if (state.explore.corpusView) {
      state.explore.corpusView = false;
      renderShell();
      return;
    }
    state.explore.corpusView = true;
    state.explore.corpusLoading = true;
    state.explore.corpusError = null;
    renderShell();
    try {
      const res = await fetch('/api/corpus/graph');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        state.explore.corpusError = data.error || `Falha ao carregar o mapa (HTTP ${res.status}).`;
        state.explore.corpusGraph = null;
      } else state.explore.corpusGraph = data;
    } catch (error) {
      state.explore.corpusError = error.message || 'Erro de rede.';
      state.explore.corpusGraph = null;
    }
    state.explore.corpusLoading = false;
    renderShell();
  }

  function corpusOpenSkill(id) {
    if (!state.explore) return;
    state.explore.corpusView = false;
    if (id === 'commons') {
      setExploreMode('commons');
      return;
    } // the map's aggregate commons node → browse the commons list
    if (state.explore.mode === 'commons') state.explore.mode = 'skills';
    loadExploreSkill(id);
  }

  function renderCorpusGraph(ex) {
    if (ex.corpusLoading) return '<div class="repo-empty">Carregando mapa do corpus…</div>';
    if (ex.corpusError) return `<div class="repo-empty">${escapeHtml(ex.corpusError)}</div>`;
    const g = ex.corpusGraph;
    if (!g) return '<div class="repo-empty">Abra o mapa do corpus.</div>';
    const nodes = (g.nodes || []).map((n) => ({ id: n.id, kind: n.kind, concepts: n.concepts || 0 }));
    if (!nodes.length) return '<div class="repo-empty">Corpus vazio.</div>';
    const edges = (g.edges || []).map((e) => ({ from: e.from, to: e.to, count: e.count || 1 }));
    const W = 760,
      H = 520;
    const pos = computeGraphLayout(nodes, edges, W, H);
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const edgesSvg = edges
      .map((e) => {
        const a = pos[idx.get(e.from)],
          b = pos[idx.get(e.to)];
        if (!a || !b) return '';
        return `<line class="graph-edge graph-edge--cross" style="stroke-width:${Math.min(4, 1 + e.count * 0.6).toFixed(1)}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" />`;
      })
      .join('');
    const nodesSvg = nodes
      .map((n, i) => {
        const p = pos[i];
        const r = Math.min(20, 9 + (n.concepts || 0) * 0.45);
        const kd = n.kind === 'commons' ? 'commons' : 'skillnode';
        return `<g class="graph-node graph-node--${kd}" data-action="corpusOpenSkill" data-id="${escapeHtml(n.id)}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
        <title>${escapeHtml(`${n.id} · ${n.concepts} conceito(s)`)}</title>
        <circle r="${r.toFixed(1)}"></circle>
        <text class="graph-node-label" y="${(r + 13).toFixed(1)}">${escapeHtml(n.id)}</text>
      </g>`;
      })
      .join('');
    return `
      <div class="graph-view">
        <div class="graph-toolbar"><span class="graph-stats">${nodes.length} vizinhanças · ${edges.length} conexões entre skills</span><span class="gov-counts">clique numa skill para abrir</span></div>
        <div class="graph-canvas-wrap">
          <svg class="graph-canvas" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa do corpus">
            <g class="graph-edges">${edgesSvg}</g>
            <g class="graph-nodes">${nodesSvg}</g>
          </svg>
        </div>
      </div>`;
  }

  return {
    openExplore,
    openSkillInExplore,
    openCommonsInExplore,
    loadExploreCommonsConcept,
    exploreOpenRef,
    exploreBack,
    exploreCommonsToggleEdit,
    exploreCommonsSave,
    exploreCommonsProcessMedia,
    exploreCommonsKeepGreen,
    exploreCommonsRunEval,
    commonsToggleClosed,
    archiveCapsuleConfirm,
    archiveCapsule,
    exploreExpandAllGroups,
    exploreCollapseAllGroups,
    loadExploreSkill,
    setExploreTab,
    loadExploreGraph,
    toggleCorpusGraph,
    corpusOpenSkill,
    renderCorpusGraph
  };
}
