export function createExplorerViewFeature({
  escapeHtml,
  domainRootKey,
  isCurator,
  isBaldeAdmin,
  roleAllows,
  permissionAttrs,
  permissionNote,
  currentAccessUser,
  state,
  canManageSkill,
  cssToken,
  isOntologyPath,
  icon,
  capsuleCategoryDef,
  capsuleCategoryGlyph,
  renderCorpusGraph,
  CADENCE_LABEL_PT,
  renderMarkdownSafe,
  parseOntologyMarkdown,
  fmtDateTime,
  commonsFreshCell,
  govEvalBadge,
  commonsPeopleCell,
  govStatusBadge,
  govDeprecatedChip,
  ontologyChip,
  capsuleCategoryChip,
  isLocalShell,
  renderNodeEval,
  statusPill,
  deprecationTag,
  renderCuratorPanel,
  renderReport,
  renderFeedback,
  renderEvals,
  renderAccessReadOnly,
  renderOverview,
  renderSkillInfoStrip,
  qualitySeal,
  freshnessDot,
  statusLabel,
  formatDate,
  metricChart,
  graphThemeColors,
  graphForceLayoutName,
  formatBytes,
  renderShell
}) {
  function commonsDomainKey(path) {
    return String(path || '').includes('/') ? String(path).split('/')[0] : '—';
  }
  function skillGroupKey(skill, groupBy) {
    if (groupBy === 'owner') return (skill.owner && (skill.owner.nome || skill.owner.email)) || 'Sem owner';
    const d = skill.domain || (skill.id && String(skill.id).includes('/') ? String(skill.id).split('/')[0] : '');
    return d || 'Sem domínio';
  }
  function exploreGroupNameSort(a, b) {
    const aEmpty = /^(Sem |—)/.test(a),
      bEmpty = /^(Sem |—)/.test(b);
    if (aEmpty && !bEmpty) return 1;
    if (bEmpty && !aEmpty) return -1;
    return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
  }
  function exploreGroupSection(ex, name, count, rowsHtml) {
    const open = ex.openDomains instanceof Set && ex.openDomains.has(name);
    return `
      <div class="explore-group" data-group="${escapeHtml(name)}">
        <button class="explore-group-head" data-action="exploreToggleDomain" data-group="${escapeHtml(name)}" aria-expanded="${open ? 'true' : 'false'}">
          <span class="explore-group-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
          <span class="explore-group-name">${escapeHtml(name)}</span>
          <span class="explore-group-count">${count}</span>
        </button>
        <div class="explore-group-body ${open ? '' : 'is-collapsed'}">${rowsHtml}</div>
      </div>`;
  }

  // A collapsible domain sub-group nested inside a root (Skills/Commons). `key` is
  // namespaced (e.g. "skills::vendas") so the same domain toggles independently in
  // each root; `label` is the bare domain. Open by default (tracked as CLOSED in
  // collapsedDomains) so items stay visible until the user collapses a domain.
  function exploreDomainGroup(ex, key, label, count, rowsHtml) {
    const open = !(ex.collapsedDomains instanceof Set && ex.collapsedDomains.has(key));
    return `
      <div class="explore-dgroup" data-dgroup="${escapeHtml(key)}">
        <button class="explore-dgroup-head" data-action="exploreToggleDomainGroup" data-dgroup="${escapeHtml(key)}" aria-expanded="${open ? 'true' : 'false'}">
          <span class="explore-dgroup-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
          <span class="explore-dgroup-name">${escapeHtml(label)}</span>
          <span class="explore-dgroup-count">${count}</span>
        </button>
        <div class="explore-dgroup-body ${open ? '' : 'is-collapsed'}">${rowsHtml}</div>
      </div>`;
  }

  // Bucket items by domain (name-sorted, "Sem domínio" last) → [ [domain, items] ].
  function exploreByDomain(items, domainOf) {
    const groups = new Map();
    for (const it of items) {
      const d = domainOf(it) || 'Sem domínio';
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(it);
    }
    return [...groups.keys()].sort(exploreGroupNameSort).map((d) => [d, groups.get(d)]);
  }

  // Regroup domain buckets by ROOT domain (segment before the first dash, one level deep) —
  // `pricing`, `pricing-fechamento`, `pricing-reajuste-inflacao` all fold under root `pricing`.
  // Preserves the incoming (name-sorted) order within each root; "Sem domínio" / "—" stay their
  // own root. Returns [ [rootKey, [[domain, items], ...]], ... ].
  function exploreGroupByRoot(domainBuckets) {
    const roots = new Map();
    for (const [dom, items] of domainBuckets) {
      const root = /^(Sem |—)/.test(dom) ? dom : domainRootKey(dom);
      if (!roots.has(root)) roots.set(root, []);
      roots.get(root).push([dom, items]);
    }
    return [...roots.keys()].sort(exploreGroupNameSort).map((r) => [r, roots.get(r)]);
  }

  // A root-domain wrapper nesting its subdomain groups. Reuses the .explore-dgroup machinery
  // (so search + collapse + expand/collapse-all keep working) with an .explore-rootgroup class
  // for the nested indent + emphasis. Open by default (tracked as CLOSED in collapsedDomains).
  function exploreRootGroup(ex, key, label, count, innerHtml) {
    const open = !(ex.collapsedDomains instanceof Set && ex.collapsedDomains.has(key));
    return `
      <div class="explore-dgroup explore-rootgroup" data-dgroup="${escapeHtml(key)}">
        <button class="explore-dgroup-head explore-rootgroup-head" data-action="exploreToggleDomainGroup" data-dgroup="${escapeHtml(key)}" aria-expanded="${open ? 'true' : 'false'}">
          <span class="explore-dgroup-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
          <span class="explore-dgroup-name">${escapeHtml(label)}</span>
          <span class="explore-dgroup-count">${count}</span>
        </button>
        <div class="explore-dgroup-body explore-rootgroup-body ${open ? '' : 'is-collapsed'}">${innerHtml}</div>
      </div>`;
  }

  function skillDomainOf(skill) {
    return skill.domain || (skill.id && String(skill.id).includes('/') ? String(skill.id).split('/')[0] : '');
  }

  // "Seus artefatos" ownership test for a commons concept: you created it, own
  // it, or curate it — or you are a global curador/admin (parity with skills'
  // canManageSkill, which the retired "Suas skills" page used).
  function isMyExploreConcept(c) {
    if (isCurator() || isBaldeAdmin()) return true;
    const user = currentAccessUser();
    const me = (user?.email || '').toLowerCase();
    if (!me) return false;
    const g = c.governance || {};
    if ((g.owner || '').toLowerCase() === me) return true;
    if ((g.creator || '').toLowerCase() === me) return true;
    return (g.curators || []).some((e) => String(e).toLowerCase() === me);
  }

  // Union of domains across skills + commons, for the domain filter dropdown.
  function exploreDomainList(ex) {
    const set = new Set();
    for (const s of state.skills || []) {
      const d = skillDomainOf(s);
      if (d) set.add(d);
    }
    for (const c of (ex.commonsData && ex.commonsData.concepts) || []) {
      const d = commonsDomainKey(c.path);
      if (d && d !== '—') set.add(d);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  }

  // Root category "Skills": every skill as a flat, name-sorted row (optionally
  // narrowed by the domain filter). Search hides rows client-side by haystack.
  function renderExploreSkillsRoot(ex, domFilter) {
    const filter = (ex.filter || '').trim().toLowerCase();
    const skills = (state.skills || []).filter((skill) => {
      if (domFilter && skillDomainOf(skill) !== domFilter) return false;
      if (ex.mineOnly && !canManageSkill(skill)) return false;
      return true;
    });
    const skillRow = (skill) => {
      const haystack = `${skill.nome} ${skill.id} ${skill.domain || ''}`.toLowerCase();
      const hidden = filter && !haystack.includes(filter);
      return `
        <button class="explore-row ${ex.mode !== 'commons' && ex.selectedId === skill.id ? 'active' : ''}" data-action="exploreSelect" data-id="${escapeHtml(skill.id)}" data-haystack="${escapeHtml(haystack)}" title="${escapeHtml(skill.id)}"${hidden ? ' style="display:none"' : ''}>
          <span class="explore-row-dot status-dot-${cssToken(skill.status)}" aria-hidden="true"></span>
          <span class="explore-row-label">${escapeHtml(skill.nome)}</span>
        </button>`;
    };
    const domGroupHtml = ([dom, items]) => {
      const rows = items
        .slice()
        .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }))
        .map(skillRow)
        .join('');
      return exploreDomainGroup(ex, `skills::${dom}`, dom, items.length, rows);
    };
    // Domain-subdomain: group the domain buckets by root; a root with a single bucket stays flat.
    const body =
      exploreGroupByRoot(exploreByDomain(skills, skillDomainOf))
        .map(([root, subs]) => {
          if (subs.length === 1) return domGroupHtml(subs[0]);
          const total = subs.reduce((sum, [, items]) => sum + items.length, 0);
          return exploreRootGroup(ex, `skills::root::${root}`, root, total, subs.map(domGroupHtml).join(''));
        })
        .join('') || '<div class="repo-empty">Nenhuma skill.</div>';
    return exploreGroupSection(ex, 'Skills', skills.length, body);
  }

  // Root category "Commons": every shared concept as a flat row.
  function renderExploreCommonsRoot(ex, domFilter) {
    if (ex.commonsLoading && !ex.commonsData)
      return exploreGroupSection(ex, 'Cápsulas', 0, '<div class="repo-empty">Carregando…</div>');
    if (ex.commonsError)
      return exploreGroupSection(ex, 'Cápsulas', 0, `<div class="repo-empty">${escapeHtml(ex.commonsError)}</div>`);
    const filter = (ex.filter || '').trim().toLowerCase();
    const concepts = ((ex.commonsData && ex.commonsData.concepts) || []).filter((c) => {
      if (domFilter && commonsDomainKey(c.path) !== domFilter) return false;
      if (ex.mineOnly && !isMyExploreConcept(c)) return false;
      return true;
    });
    // Commons domain = path prefix; "—" (no prefix) shares the "Sem domínio" bucket.
    const conceptDomain = (c) => {
      const d = commonsDomainKey(c.path);
      return d === '—' ? 'Sem domínio' : d;
    };
    const conceptRow = (c) => {
      const leaf = c.title || c.path.split('/').pop();
      const haystack = `${c.path} ${c.summary || ''} ${(c.referencedBy || []).join(' ')}`.toLowerCase();
      const hidden = filter && !haystack.includes(filter);
      const gv = c.governance || {};
      return `
        <button class="explore-row ${ex.mode === 'commons' && ex.commonsSelectedPath === c.path ? 'active' : ''}" data-action="exploreSelectCommons" data-path="${escapeHtml(c.path)}" data-haystack="${escapeHtml(haystack)}" title="${escapeHtml(c.path)}${isOntologyPath(c.path) ? ' · ontologia do domínio' : ''}${c.visibility === 'restricted' ? ' · restrita' : ''}"${hidden ? ' style="display:none"' : ''}>
          <span class="explore-row-dot gov-dot-${cssToken(gv.status || 'green')}" aria-hidden="true"></span>
          ${
            isOntologyPath(c.path)
              ? `<span class="explore-row-cat onto-row-glyph" title="Ontologia do domínio — vocabulário canônico">${icon('ontology')}</span>`
              : `<span class="explore-row-cat" style="color:${escapeHtml(capsuleCategoryDef(gv.categoria).color)}" title="${escapeHtml(capsuleCategoryDef(gv.categoria).label)}">${capsuleCategoryGlyph(capsuleCategoryDef(gv.categoria))}</span>`
          }
          <span class="explore-row-label">${escapeHtml(leaf)}</span>
          ${c.visibility === 'restricted' ? `<span class="explore-row-lock" title="Cápsula restrita">${icon('lock')}</span>` : ''}
        </button>`;
    };
    const domGroupHtml = ([dom, items]) => {
      const rows = items
        .slice()
        .sort((a, b) => (a.path || '').localeCompare(b.path || '', 'pt-BR', { sensitivity: 'base' }))
        .map(conceptRow)
        .join('');
      return exploreDomainGroup(ex, `commons::${dom}`, dom, items.length, rows);
    };
    // Domain-subdomain: group the domain buckets by root; a root with a single bucket stays flat.
    const body =
      exploreGroupByRoot(exploreByDomain(concepts, conceptDomain))
        .map(([root, subs]) => {
          if (subs.length === 1) return domGroupHtml(subs[0]);
          const total = subs.reduce((sum, [, items]) => sum + items.length, 0);
          return exploreRootGroup(ex, `commons::root::${root}`, root, total, subs.map(domGroupHtml).join(''));
        })
        .join('') || '<div class="repo-empty">Nenhum conceito.</div>';
    return exploreGroupSection(ex, 'Cápsulas', concepts.length, body);
  }

  // The corpus list: skills + commons under two root categories, with a domain
  // filter and a single search box that spans both (the search input handler
  // hides rows across the whole list by haystack).
  function renderExploreList(ex) {
    const domains = exploreDomainList(ex);
    const domFilter = ex.domainFilter || '';
    // The three-level namespace, visible where you navigate it: balde -> domínio -> artefato.
    // Always rendered (single-repo shows the one balde, disabled) so the layer is discoverable;
    // the select reuses data-action="repoSwitch" — switching re-scopes the whole app.
    const repoRow = `
      <label class="explore-repo-row" title="Balde (repo) ativo — o nível acima dos domínios">
        ${icon('library')}<span class="explore-repo-label">Balde</span>
        <select data-action="repoSwitch" aria-label="Trocar de balde" ${(state.repos || []).length > 1 ? '' : 'disabled'}>
          ${((state.repos || []).length ? state.repos : [{ name: state.activeRepo || 'corporate', titulo: 'Corporativo' }]).map((r) => `<option value="${escapeHtml(r.name)}" ${r.name === state.activeRepo ? 'selected' : ''}>${escapeHtml(r.titulo || r.name)}</option>`).join('')}
        </select>
      </label>`;
    const controls = `
      ${repoRow}
      <div class="explore-list-controls">
        <select class="explore-domain-select" data-explore-domain aria-label="Filtrar por domínio" title="Filtrar por domínio">
          <option value="">Todos os domínios</option>
          ${domains.map((d) => `<option value="${escapeHtml(d)}"${domFilter === d ? ' selected' : ''}>${escapeHtml(d)}</option>`).join('')}
        </select>
        <span class="explore-list-toolbar">
          <button class="icon-button-sm" data-action="exploreExpandAll" title="Expandir Skills e Cápsulas" aria-label="Expandir">${icon('plus')}</button>
          <button class="icon-button-sm" data-action="exploreCollapseAll" title="Recolher Skills e Cápsulas" aria-label="Recolher">${icon('minus')}</button>
        </span>
      </div>
      <label class="explore-mine-toggle" title="Só artefatos que você criou ou cura">
        <input type="checkbox" data-explore-mine ${ex.mineOnly ? 'checked' : ''}>
        Seus artefatos
      </label>
      <input class="explore-search" data-explore-search value="${escapeHtml(ex.filter || '')}" placeholder="Buscar em skills e cápsulas…" aria-label="Buscar">`;
    const roots = renderExploreSkillsRoot(ex, domFilter) + renderExploreCommonsRoot(ex, domFilter);
    return `${controls}<div class="explore-rows">${roots}</div><div class="explore-no-results" hidden>Nada encontrado.</div>`;
  }

  function renderExplore() {
    const ex = state.explore || {};
    const mode = ex.mode || 'skills';

    let main;
    if (ex.corpusView) {
      main = renderCorpusGraph(ex);
    } else if (mode === 'commons') {
      main = renderExploreCommonsMain(ex);
    } else if (ex.loading && !ex.bundle) {
      main = '<div class="repo-empty">Carregando…</div>';
    } else if (ex.error) {
      main = `<div class="repo-empty">${escapeHtml(ex.error)}</div>`;
    } else if (!ex.bundle) {
      main = '<div class="repo-empty">Selecione uma skill para explorar.</div>';
    } else {
      main = renderRepoView(ex);
    }

    return `
      <section class="panel explore-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Consulta · repositório</p>
          </div>
          <div class="section-heading-actions">
            ${(ex.navStack || []).length ? `<button class="ghost-button small explore-back" data-action="exploreBack" title="Voltar ao artefato anterior">${icon('arrowLeft')}Voltar</button>` : ''}
            <button class="ghost-button small ${ex.corpusView ? 'active' : ''}" data-action="toggleCorpusGraph" title="Grafo de todo o corpus (skills + cápsulas e suas conexões)">${icon('spark')}${ex.corpusView ? 'Ver conteúdo' : 'Mapa do corpus'}</button>
            <button class="ghost-button small" data-action="exploreToggleExpand" title="${ex.expanded ? 'Mostrar a lista' : 'Esconder a lista e maximizar o conteúdo'}">${icon(ex.expanded ? 'menu' : 'expand')}${ex.expanded ? 'Mostrar lista' : 'Expandir'}</button>
            <span class="readonly-tag">Somente leitura · git</span>
          </div>
        </div>
        <div class="explore-layout ${ex.expanded ? 'is-expanded' : ''}">
          <aside class="explore-list">${renderExploreList(ex)}</aside>
          <div class="repo-view">${main}</div>
        </div>
      </section>
    `;
  }
  // Explorar o corpus é somente leitura: a cadência (janela de revisão) aparece como TEXTO fixo.
  // A edição vive na página Commons e na criação — nunca no explorador.
  function commonsCadenceCellExplore(c, gv) {
    const label = CADENCE_LABEL_PT[gv.cadence] || gv.cadence || '—';
    if (gv.cadenceLocked) {
      return `<span class="cadence-locked" title="Definida por ${escapeHtml(gv.cadenceLockedBy || 'criador')}">${icon('shield')}${escapeHtml(label)}</span>`;
    }
    return escapeHtml(label);
  }

  function exploreCommonsMediaHtml(concept, file) {
    const media = (file && file.media) || { images: [], data: [] };
    const hasMedia = (media.images && media.images.length) || (media.data && media.data.length);
    if (!hasMedia) return '';
    return `
      <div class="commons-media">
        ${media.images && media.images.length ? `<h4 class="commons-media-h">Imagens</h4><div class="media-imgs">${media.images.map((m) => `<figure class="media-img"><img src="/api/commons/img?path=${encodeURIComponent(concept.path)}&name=${encodeURIComponent(m.name)}" alt="${escapeHtml(m.name)}"><figcaption><strong>${escapeHtml(m.name)}</strong>${m.description ? `<span>${escapeHtml(m.description)}</span>` : '<span class="muted">sem descrição — processe a mídia (IA)</span>'}</figcaption></figure>`).join('')}</div>` : ''}
        ${media.data && media.data.length ? `<h4 class="commons-media-h">Dados</h4>${media.data.map((m) => `<div class="media-data"><div class="media-data-head"><strong>${escapeHtml(m.name)}</strong>${m.description ? ` — ${escapeHtml(m.description)}` : ''}</div>${m.markdown ? `<div class="commons-doc">${renderMarkdownSafe(m.markdown)}</div>` : ''}</div>`).join('')}` : ''}
      </div>`;
  }

  function renderExploreCommonsOverview(concept, file, canManage) {
    if (!file || file.loading) return '<div class="repo-empty">Carregando…</div>';
    if (file.error) return `<div class="form-alert form-alert-error">${escapeHtml(file.error)}</div>`;
    if (file.tooLarge)
      return '<div class="repo-empty">Conceito grande demais para exibir aqui — abra em nova aba.</div>';
    if (file.editing) {
      return `
        <div class="commons-edit">
          <textarea class="commons-editor" data-explore-commons-editor spellcheck="false" ${file.saving ? 'disabled' : ''}>${escapeHtml(file.draft)}</textarea>
          <div class="row-actions">
            <button class="primary-button small" data-action="exploreCommonsSave" ${file.saving ? 'disabled' : ''}>${icon('check')}${file.saving ? 'Salvando…' : 'Salvar'}</button>
            <button class="ghost-button small" data-action="exploreCommonsEdit" ${file.saving ? 'disabled' : ''}>${icon('x')}Cancelar</button>
            <span class="doc-edit-hint">Markdown · Ctrl+Enter para salvar</span>
          </div>
        </div>`;
    }
    // Ontologia do domínio: a parsed concept table on top of the raw markdown — the vocabulary
    // reads at a glance (termo · definição · sinônimos) without scrolling the prose.
    let ontoTable = '';
    if (isOntologyPath(concept.path)) {
      const parsed = parseOntologyMarkdown(file.content);
      if (parsed.concepts.length) {
        ontoTable = `
          <div class="onto-view">
            <table class="onto-table">
              <thead><tr><th>Termo canônico</th><th>Definição</th><th>Sinônimos aceitos</th></tr></thead>
              <tbody>${parsed.concepts
                .map(
                  (c) => `<tr>
                <td class="onto-td-termo">${escapeHtml(c.termo)}</td>
                <td>${escapeHtml(c.definicao)}</td>
                <td>${
                  String(c.sin || '')
                    .split(/[,;]/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((s) => `<span class="onto-syn">${escapeHtml(s)}</span>`)
                    .join(' ') || '<span class="muted">—</span>'
                }</td>
              </tr>`
                )
                .join('')}</tbody>
            </table>
            <p class="field-hint">${icon('ontology')}Vocabulário do domínio <strong>${escapeHtml(concept.path.split('/')[0])}</strong> — sempre incluído no contexto do chat e das chamadas de máquina (MCP/API).</p>
          </div>`;
      }
    }
    return `${ontoTable}<article class="doc-body commons-doc">${renderMarkdownSafe(file.content, { corpusLinks: true })}</article>${exploreCommonsMediaHtml(concept, file)}`;
  }

  function renderExploreCommonsGovernance(concept, canManage) {
    const gv = concept.governance || {};
    const approvals = (gv.approvals || []).slice().reverse().slice(0, 15);
    const apprHtml = approvals.length
      ? approvals
          .map(
            (a) =>
              `<li><div class="hist-top"><span class="appr-action">${escapeHtml(a.action)}</span><span class="hist-when">${escapeHtml(fmtDateTime(a.at))}</span></div><div class="hist-msg"><strong>${escapeHtml(a.by || '')}</strong>${a.detail ? ` — ${escapeHtml(a.detail)}` : ''}</div></li>`
          )
          .join('')
      : '<li class="muted">Sem aprovações registradas.</li>';
    return `
      <div class="governance-tab">
        <div class="governance-facts">
          <div><small>Frescor</small><strong>${commonsFreshCell(gv)}</strong></div>
          <div><small>Cadência</small><strong>${commonsCadenceCellExplore(concept, gv)}</strong></div>
          <div><small>Eval</small><strong>${govEvalBadge(gv.eval)}</strong></div>
          <div><small>Criador</small><strong>${escapeHtml(gv.creator || '—')}</strong></div>
          <div><small>Owner</small><strong>${escapeHtml(gv.owner || '—')}</strong></div>
          <div><small>Curadoria</small><strong>${commonsPeopleCell(gv)}</strong></div>
        </div>
        ${gv.deprecated ? `<p class="field-hint onto-new-hint gov-dep-hint">${icon('shield')}<strong>Cápsula DEPRECIADA</strong> — ${escapeHtml(((gv.deprecation && gv.deprecation.reasons) || []).join('; '))}. Consumidores de IA recebem o aviso junto do conteúdo. Revise (Manter em dia) ou atualize o conteúdo para sair deste estado.</p>` : ''}
        ${gv.closed ? `<p class="field-hint onto-new-hint gov-closed-hint">${icon('lock')}<strong>Cápsula FECHADA</strong>${gv.closedAt ? ` em ${escapeHtml(String(gv.closedAt).slice(0, 10))}` : ''}${gv.closedBy ? ` por ${escapeHtml(gv.closedBy)}` : ''} — fato passado validado e congelado: fora do ciclo de revisão, imune à depreciação e com conteúdo bloqueado para edição. Reabra para editar.</p>` : ''}
        ${
          canManage
            ? `<div class="row-actions">
          ${
            gv.closed
              ? `<button class="ghost-button small" data-action="commonsToggleClosed" data-path="${escapeHtml(concept.path)}" data-close="0"${permissionAttrs('curar')}>${icon('edit')}Reabrir cápsula</button>`
              : `<button class="ghost-button small" data-action="exploreCommonsKeepGreen" data-path="${escapeHtml(concept.path)}"${permissionAttrs('curar')}>${icon('check')}Manter em dia</button>
          <button class="ghost-button small" data-action="exploreCommonsRunEval" data-path="${escapeHtml(concept.path)}"${permissionAttrs('curar')}>${icon('spark')}Rodar eval (IA)</button>
          ${
            gv.lastReviewedAt
              ? `<button class="ghost-button small" data-action="commonsToggleClosed" data-path="${escapeHtml(concept.path)}" data-close="1" title="Congela a cápsula como fato passado validado: sai do ciclo de revisão e o conteúdo fica bloqueado."${permissionAttrs('curar')}>${icon('lock')}Fechar cápsula</button>`
              : `<button class="ghost-button small" disabled aria-disabled="true" title="Revise a cápsula (Manter em dia) antes de fechar.">${icon('lock')}Fechar cápsula</button>`
          }`
          }
        </div>`
            : ''
        }
        <div class="side-block gov-approvals"><h4>Aprovações</h4><ul class="hist-list">${apprHtml}</ul></div>
      </div>`;
  }

  function renderExploreCommonsFiles(concept, file) {
    const ctxSize =
      concept.size != null
        ? concept.size
        : file && file.content != null
          ? new TextEncoder().encode(file.content).length
          : null;
    const rows = [{ path: 'context.md', size: ctxSize }];
    const media = (file && file.media) || { images: [], data: [], files: [] };
    (media.images || []).forEach((m) => rows.push({ path: `img/${m.name}`, size: null }));
    (media.data || []).forEach((m) => rows.push({ path: `data/${m.name}`, size: null }));
    // Downloadable file-assets (files/ sidecar — PDFs, zips, office docs). NON-context; the only
    // action is "Baixar" (SSO download route; respects the capsule read ACL server-side).
    (media.files || []).forEach((m) =>
      rows.push({
        path: `files/${m.name}`,
        size: m.size != null ? m.size : null,
        download: `/api/commons/file-asset?path=${encodeURIComponent(concept.path)}&name=${encodeURIComponent(m.name)}`
      })
    );
    // Queryable datasets not covered by the media list (parquet is binary, never AI-described).
    ((file && file.datasets) || []).forEach((d) => {
      if (!rows.some((r) => r.path === d.path)) rows.push({ path: d.path, size: d.size });
    });
    const ex = state.explore || {};
    const cdt = ex.commonsDataTool && ex.commonsDataTool.concept === concept.path ? ex.commonsDataTool : null;
    const items = rows
      .map(
        (f) => `
      <div class="repo-file-row">
        <span class="repo-file-name">${icon('file')}<code>${escapeHtml(f.path)}</code></span>
        ${f.download ? `<a class="ghost-button tiny" href="${f.download}" download>${icon('download')}Baixar</a>` : ''}
        ${/^data\/.+\.(csv|parquet)$/i.test(f.path) ? `<button class="ghost-button tiny" data-action="capsuleDataInspect" data-concept="${escapeHtml(concept.path)}" data-file="${escapeHtml(f.path)}" ${cdt && cdt.loading ? 'disabled' : ''}>${icon('search')}${cdt && cdt.loading && cdt.file === f.path ? 'Perfilando…' : 'Inspecionar'}</button>` : ''}
        ${f.size != null ? `<span class="repo-file-size">${(f.size / 1024).toFixed(1)} KB</span>` : ''}
      </div>`
      )
      .join('');
    const toolResult =
      cdt && !cdt.loading && cdt.result ? renderDataToolResult({ kind: 'inspect', result: cdt.result }) : '';
    return `<div class="repo-files-flat">${items}</div>${toolResult}`;
  }

  function renderExploreCommonsMain(ex) {
    if (ex.commonsLoading && !ex.commonsData) return '<div class="repo-empty">Carregando cápsulas…</div>';
    if (ex.commonsError) return `<div class="repo-empty">${escapeHtml(ex.commonsError)}</div>`;
    const concepts = (ex.commonsData && ex.commonsData.concepts) || [];
    if (!concepts.length) return '<div class="repo-empty">Nenhuma cápsula ainda.</div>';
    const concept = concepts.find((c) => c.path === ex.commonsSelectedPath) || null;
    if (!concept) return '<div class="repo-empty">Selecione uma cápsula.</div>';
    const file = ex.commonsFile && ex.commonsFile.path === concept.path ? ex.commonsFile : null;
    const canManage = !!(ex.commonsData && ex.commonsData.canManage);
    const tab = ['overview', 'governance', 'files', 'history', 'evals'].includes(ex.tab) ? ex.tab : 'overview';
    const gv = concept.governance || {};
    const m = concept.media || { img: 0, data: 0 };
    const mediaBadge =
      m.img || m.data
        ? `<span class="repo-media-badge" title="mídia: ${m.img || 0} imagem(ns) · ${m.data || 0} tabela(s)">${m.img ? `${icon('image')}${m.img}` : ''}${m.data ? ` ▦ ${m.data}` : ''}</span>`
        : '';
    const refs = concept.referencedBy || [];
    // Uma cápsula fechada está congelada: editar pede reabrir antes (o servidor recusa com 409).
    const editAttrs = gv.closed
      ? ' disabled aria-disabled="true" title="Cápsula fechada: reabra-a na aba Governança para editar."'
      : permissionAttrs('curar');
    const header = `
      <div class="repo-header${exploreHeaderCollapsed() ? ' is-collapsed' : ''}">
        ${repoCollapseToggle()}
        <div class="repo-title">
          ${icon('library')}
          <div>
            <h3>${escapeHtml(concept.title || concept.path.split('/').pop())}</h3>
            <code class="repo-id">/commons/${escapeHtml(concept.path)}</code>
          </div>
          ${govStatusBadge(gv.status || 'green')}
          ${govDeprecatedChip(gv)}
          ${concept.visibility === 'restricted' ? `<span class="restricted-chip" title="Cápsula restrita — visível só para curadores/leitores listados">${icon('lock')}restrita</span>` : ''}
        </div>
        <div class="repo-meta">
          <span>${icon('folder')}${escapeHtml(commonsDomainKey(concept.path))}</span>
          ${isOntologyPath(concept.path) ? ontologyChip() : ''}
          ${capsuleCategoryChip(concept.governance && concept.governance.categoria)}
          ${concept.governance && concept.governance.serie ? `<span title="Episódio da série ${escapeHtml(concept.governance.serie)}">${icon('commit')}${escapeHtml(concept.governance.serie)}${concept.governance.periodo ? ` · ${escapeHtml(concept.governance.periodo)}` : ''}</span>` : ''}
          ${gv.creator ? `<span>${icon('users')}${escapeHtml(gv.creator)}</span>` : ''}
          <span title="cadência">${icon('history')}${escapeHtml(CADENCE_LABEL_PT[gv.cadence] || gv.cadence || '—')}</span>
          ${mediaBadge}
        </div>
        ${concept.summary ? `<p class="repo-summary">${escapeHtml(concept.summary)}</p>` : ''}
        ${refs.length ? `<div class="repo-tags"><span class="repo-refs-label">usado por:</span>${refs.map((sk) => `<span class="graph-scope-tag graph-node--cross">${escapeHtml(sk)}</span>`).join(' ')}</div>` : ''}
        <div class="repo-actions">
          ${
            isLocalShell()
              ? `<button class="ghost-button small" data-action="commonsFilePopup" data-path="${escapeHtml(concept.path)}">${icon('file')}Abrir</button>`
              : `<a class="ghost-button small" href="/api/commons/file/view?path=${encodeURIComponent(concept.path)}" target="_blank" rel="noopener">${icon('file')}Abrir em nova aba</a>`
          }
          ${canManage && isOntologyPath(concept.path) ? `<button class="ghost-button small" data-action="ontologyEdit" data-domain="${escapeHtml(concept.path.split('/')[0])}"${editAttrs}>${icon('ontology')}Editor de ontologia</button>` : ''}
          ${canManage ? `<button class="ghost-button small" data-action="editCommons" data-path="${escapeHtml(concept.path)}"${editAttrs}>${icon('edit')}Editar cápsula</button>` : ''}
          ${canManage && file && !file.tooLarge && !file.loading && !file.error ? `<button class="ghost-button small" data-action="exploreCommonsEdit"${editAttrs}>${icon('edit')}${file.editing ? 'Cancelar edição' : 'Editar texto'}</button>` : ''}
          ${canManage ? `<button class="ghost-button small danger" data-action="archiveCapsule" data-path="${escapeHtml(concept.path)}"${permissionAttrs('curar')}>${icon('trash')}Arquivar</button>` : ''}
        </div>
        ${canManage ? permissionNote('curar') : ''}
      </div>
      <div class="repo-tabs">
        <button class="repo-tab ${tab === 'overview' ? 'active' : ''}" data-action="exploreTab" data-tab="overview">${icon('dashboard')}Visão geral</button>
        <button class="repo-tab ${tab === 'governance' ? 'active' : ''}" data-action="exploreTab" data-tab="governance">${icon('approvals')}Governança</button>
        <button class="repo-tab ${tab === 'files' ? 'active' : ''}" data-action="exploreTab" data-tab="files">${icon('file')}Arquivos<small>${1 + (m.img || 0) + (m.data || 0) + (m.files || 0)}</small></button>
        <button class="repo-tab ${tab === 'evals' ? 'active' : ''}" data-action="exploreTab" data-tab="evals">${icon('check')}Avaliação</button>
        <button class="repo-tab ${tab === 'history' ? 'active' : ''}" data-action="exploreTab" data-tab="history">${icon('commit')}Histórico<small>${file ? (file.history || []).length : ''}</small></button>
      </div>`;
    let body;
    if (tab === 'governance') body = renderExploreCommonsGovernance(concept, canManage);
    else if (tab === 'files') body = renderExploreCommonsFiles(concept, file);
    else if (tab === 'evals')
      body = renderNodeEval('commons', concept.path, canManage, {
        fixAction: { action: 'editCommons', dataset: { path: concept.path }, label: 'Editar cápsula' }
      });
    else if (tab === 'history') body = renderRepoHistory(file ? file.history : []);
    else body = renderExploreCommonsOverview(concept, file, canManage);
    return header + `<div class="repo-tab-body${tab === 'overview' ? ' is-detail' : ''}">${body}</div>`;
  }

  // Collapse the artifact header (owner · usage · action buttons) down to just the title, to hand
  // more of the pane to the reading area. Persisted per-device and synced via the layout prefs.
  function exploreHeaderCollapsed() {
    try {
      return localStorage.getItem('balde.exploreHeaderCollapsed') === '1';
    } catch (error) {
      return false;
    }
  }
  function repoCollapseToggle() {
    const collapsed = exploreHeaderCollapsed();
    return `<button class="repo-collapse-toggle" data-action="exploreToggleHeader" aria-expanded="${collapsed ? 'false' : 'true'}" title="${collapsed ? 'Expandir cabeçalho' : 'Recolher cabeçalho — mais área de leitura'}">${icon('chevron')}</button>`;
  }

  function renderRepoView(ex) {
    const bundle = ex.bundle;
    const meta = bundle.meta || {};
    // The corpus view is now the unified skill surface: the git bundle drives the
    // Arquivos/Histórico tabs, and the full client-side skill object (looked up by
    // the selected id) drives the migrated detail tabs.
    const skill = (state.skills || []).find((s) => s.id === ex.selectedId) || null;
    const canManage = skill ? canManageSkill(skill) : false;
    // Reuse signal for this skill (Balde's north star): total events + the app-vs-agente
    // source split (reuse by non-authors + external agents) + distinct users.
    const us = bundle.usage || null;
    const usageChip =
      us && us.total
        ? (() => {
            const bs = us.bySource || { app: 0, machine: 0 };
            const tip = `${us.view || 0} aberturas · ${us.consume || 0} consumos via API · ${us.chat || 0} em chat · ${us.contribute || 0} contribuições · ${us.users || 0} usuário(s)${us.lastAt ? ' · último ' + fmtDateTime(us.lastAt) : ''}`;
            return `<span class="repo-usage" title="${escapeHtml(tip)}">${icon('spark')}${Number(us.total).toLocaleString('pt-BR')} usos <span class="src-pill src-app">app ${Number(bs.app || 0).toLocaleString('pt-BR')}</span><span class="src-pill src-machine">agente ${Number(bs.machine || 0).toLocaleString('pt-BR')}</span> · ${Number(us.users || 0).toLocaleString('pt-BR')} usuário(s)</span>`;
          })()
        : '';
    const header = `
      <div class="repo-header${exploreHeaderCollapsed() ? ' is-collapsed' : ''}">
        ${repoCollapseToggle()}
        <div class="repo-title">
          ${icon('folder')}
          <div>
            <h3>${escapeHtml(bundle.nome)}</h3>
            <code class="repo-id">${escapeHtml(bundle.id)}</code>
          </div>
          ${statusPill(meta.status)}${skill ? ` ${deprecationTag(skill)}` : ''}
        </div>
        <div class="repo-meta">
          ${meta.owner ? `<span>${icon('users')}${escapeHtml(meta.owner)}</span>` : ''}
          ${usageChip}
          <span>${meta.contentState === 'published' ? `Publicada · v${escapeHtml(meta.version || '')}` : 'Rascunho · ainda não publicado'}</span>
        </div>
        ${meta.pendingWorkingChanges && meta.contentState === 'published' ? '<p class="field-hint">Há alterações no rascunho. Este conteúdo continua sendo a versão publicada.</p>' : ''}
        ${
          skill
            ? `<div class="repo-actions">
          <button class="ghost-button small" data-action="openContribute" data-id="${skill.id}">${icon('inbox')}Colaborar</button>
          ${canManage ? `<button class="ghost-button small" data-action="editSkill" data-id="${skill.id}"${permissionAttrs('curar')}>${icon('edit')}${meta.pendingWorkingChanges ? 'Revisar rascunho' : 'Editar skill'}</button>` : ''}
          ${canManage ? `<button class="ghost-button small danger" data-action="deleteSkill" data-id="${skill.id}"${permissionAttrs('curar')}>${icon('trash')}Arquivar</button>` : ''}
        </div>
        ${canManage ? permissionNote('curar') : ''}`
            : ''
        }
      </div>
      <div class="repo-tabs">
        ${
          skill
            ? `
        <button class="repo-tab ${ex.tab === 'overview' ? 'active' : ''}" data-action="exploreTab" data-tab="overview">${icon('dashboard')}Visão geral</button>
        <button class="repo-tab ${ex.tab === 'governance' ? 'active' : ''}" data-action="exploreTab" data-tab="governance">${icon('approvals')}Governança</button>
        <button class="repo-tab ${ex.tab === 'report' ? 'active' : ''}" data-action="exploreTab" data-tab="report">${icon('spark')}Relatório do agente</button>
        <button class="repo-tab ${ex.tab === 'feedback' ? 'active' : ''}" data-action="exploreTab" data-tab="feedback">${icon('chat')}Feedbacks<small>${(skill.feedback || []).length}</small></button>
        <button class="repo-tab ${ex.tab === 'evals' ? 'active' : ''}" data-action="exploreTab" data-tab="evals">${icon('check')}Evals<small>${(skill.evals || []).length}</small></button>
        <button class="repo-tab ${ex.tab === 'access' ? 'active' : ''}" data-action="exploreTab" data-tab="access">${icon('users')}Acessos</button>
        `
            : ''
        }
        <button class="repo-tab ${ex.tab === 'files' ? 'active' : ''}" data-action="exploreTab" data-tab="files">${icon('file')}Arquivos<small>${bundle.files.length}</small></button>
        <button class="repo-tab ${ex.tab === 'graph' ? 'active' : ''}" data-action="exploreTab" data-tab="graph">${icon('spark')}Grafo</button>
        <button class="repo-tab ${ex.tab === 'timeline' ? 'active' : ''}" data-action="exploreTab" data-tab="timeline">${icon('commit')}Linha do tempo</button>
        <button class="repo-tab ${ex.tab === 'curadoria' ? 'active' : ''}" data-action="exploreTab" data-tab="curadoria">${icon('shield')}Curadoria</button>
        <button class="repo-tab ${ex.tab === 'history' ? 'active' : ''}" data-action="exploreTab" data-tab="history">${icon('commit')}Histórico<small>${bundle.history.length}</small></button>
      </div>`;

    const detailTab = ['overview', 'governance', 'report', 'feedback', 'evals', 'access'].includes(ex.tab);
    return (
      header +
      `<div class="repo-tab-body${detailTab && skill ? ' is-detail' : ''}">${renderRepoTabBody(ex, skill, canManage)}</div>`
    );
  }

  function renderRepoTabBody(ex, skill, canManage) {
    const bundle = ex.bundle;
    if (ex.tab === 'history') {
      return renderRepoHistory(bundle.history);
    }
    if (ex.tab === 'graph') {
      return renderContextGraph(ex);
    }
    if (ex.tab === 'timeline') {
      return renderSkillTimeline(ex);
    }
    if (ex.tab === 'curadoria') {
      return renderCuratorPanel(ex, canManage);
    }
    if (ex.tab === 'files') {
      return renderRepoFiles(ex);
    }
    // Migrated detail tabs need the full skill object; if it isn't loaded yet,
    // fall back to the file browser so the view is never empty.
    if (!skill) {
      return renderRepoFiles(ex);
    }
    if (ex.tab === 'governance') {
      return renderGovernance(skill);
    }
    if (ex.tab === 'report') {
      return renderReport(skill);
    }
    if (ex.tab === 'feedback') {
      return renderFeedback(skill);
    }
    if (ex.tab === 'evals') {
      return renderEvals(skill);
    }
    if (ex.tab === 'access') {
      return renderAccessReadOnly(skill, canManage);
    }
    return renderOverview(skill, ex);
  }

  // Governança tab: the skill's governance stamp — quality seal, status, freshness,
  // last review date, version, owner — plus any open governance issues.
  function renderGovernance(skill) {
    const issues = skill.governanceIssues || [];
    // Selo transparency: the weighted dimensions behind the number (Config → Pontuação).
    const det = skill.seloDetalhe;
    const seloBreakdown = det
      ? `
        <div class="selo-breakdown">
          <small>Composição do selo</small>
          <div class="selo-dims">
            <span title="Riqueza dos casos de uso">casos de uso <strong>${det.casos}</strong></span>
            <span title="Integridade da validação (aceites forçados descontam)">validação <strong>${det.validacao}</strong></span>
            <span title="Governança do frontmatter">governança <strong>${det.governanca}</strong></span>
            <span title="Clareza & segurança">clareza <strong>${det.clareza}</strong></span>
            <span title="Frescor da revisão">frescor <strong>${det.frescor}</strong></span>
            ${det.aceitesForcados ? `<span class="selo-forced" title="Itens do gate aceitos por curador sem aprovação da IA">${det.aceitesForcados} aceite(s) forçado(s)</span>` : ''}
          </div>
        </div>`
      : '';
    return `
      <div class="governance-tab">
        ${renderSkillInfoStrip(skill)}
        <div class="governance-stamp-row">
          ${qualitySeal(skill.seloQualidade, skill.seloGrade)}
          <div class="governance-stamp-meta">
            <span class="stamp-line">${statusPill(skill.status)} ${deprecationTag(skill)} ${freshnessDot(skill.frescor)}</span>
            <span class="stamp-sub">selo ${skill.seloQualidade}/100</span>
          </div>
        </div>
        ${seloBreakdown}
        <div class="governance-facts">
          <div><small>Status</small><strong>${escapeHtml(statusLabel[skill.status] || skill.status)}</strong></div>
          <div><small>Selo de qualidade</small><strong>${skill.seloQualidade}/100</strong></div>
          <div><small>Última revisão</small><strong>${formatDate(skill.lastReviewed)}</strong></div>
          <div><small>Versão</small><strong>v${escapeHtml(skill.version)}</strong></div>
          <div><small>Model tier</small><strong>${escapeHtml(skill.modelTier || '—')}</strong></div>
          <div><small>Owner</small><strong>${escapeHtml(skill.owner?.nome || '—')}</strong></div>
        </div>
        ${
          issues.length
            ? `<div class="governance-issues">${icon('alert')}<span>${escapeHtml(issues.join(' · '))}</span></div>`
            : `<div class="governance-ok">${icon('check')}<span>Sem pendências de governança.</span></div>`
        }
        <div class="metrics-grid">
          ${metricChart('Execuções', skill.metricas, 'execucoes')}
          ${metricChart('Usuários', skill.metricas, 'usuariosDistintos')}
          ${metricChart('Aberturas', skill.metricas, 'aberturas')}
        </div>
      </div>`;
  }

  function renderRepoHistory(history) {
    if (!history || !history.length) {
      return '<div class="repo-empty">Sem histórico de commits.</div>';
    }
    const rows = history
      .map(
        (commit) => `
      <li class="commit-item">
        <span class="commit-subject">${escapeHtml(commit.subject || '(sem mensagem)')}</span>
        <span class="commit-meta">
          <code>${escapeHtml(commit.shortHash)}</code>
          <span>${escapeHtml(commit.author || '—')} · ${escapeHtml((commit.date || '').slice(0, 10))}</span>
        </span>
      </li>`
      )
      .join('');
    return `<ul class="commit-list">${rows}</ul>`;
  }
  const GRAPH_KIND = {
    root: 'Índice (SKILL.md)',
    schema: 'Schema',
    query: 'Query',
    contexto: 'Contexto',
    catalogo: 'Catálogo',
    eval: 'Eval',
    binario: 'Binário',
    outro: 'Outro',
    cross: 'Outra skill',
    commons: 'Cápsula'
  };

  // Turn the /context manifest into {nodes, edges}. SKILL.md is the root node; every context
  // file (text + binary) is a node. Links are objects {path, scope, targetSkill}; cross-skill /
  // commons targets live in other neighborhoods, so we add badged STUB nodes for them.
  function contextGraphModel(g) {
    const crossFrom = (arr) => [...new Set((arr || []).map((b) => b.fromSkill))].sort();
    const nodes = [
      {
        id: 'SKILL.md',
        kind: 'root',
        summary: 'Índice da skill — ponto de entrada (SKILL.md).',
        backlinks: 0,
        crossBacklinks: crossFrom(g.entry && g.entry.crossBacklinks),
        links: (g.entry && g.entry.links) || [],
        dangling: (g.entry && g.entry.dangling) || []
      }
    ];
    for (const f of g.files || []) {
      nodes.push({
        id: f.path,
        kind: f.kind || 'outro',
        summary: f.summary || '',
        source: f.summarySource,
        backlinks: (f.backlinks || []).length,
        crossBacklinks: crossFrom(f.crossBacklinks),
        links: f.links || [],
        dangling: f.dangling || []
      });
    }
    for (const s of g.skipped || []) {
      nodes.push({
        id: s.path,
        kind: 'binario',
        summary: s.reason || 'binário',
        backlinks: (s.backlinks || []).length,
        crossBacklinks: crossFrom(s.crossBacklinks),
        links: [],
        dangling: []
      });
    }
    const ids = new Set(nodes.map((n) => n.id));
    // Stub nodes for cross-skill / commons targets (not in this skill's files) so their edges render.
    const stubId = (l) => (l.scope === 'xrepo' ? `@${l.repo}/${l.path}` : l.path);
    const addStub = (l) => {
      if (!l || !l.path || l.scope === 'within') return;
      const id = stubId(l);
      if (ids.has(id)) return;
      ids.add(id);
      nodes.push({
        id,
        kind: l.scope === 'commons' ? 'commons' : l.scope === 'xrepo' ? 'xrepo' : 'cross',
        scope: l.scope,
        targetSkill: l.targetSkill,
        external: true,
        summary:
          l.scope === 'commons'
            ? 'Cápsula compartilhada.'
            : l.scope === 'xrepo'
              ? `Nó de outro balde (@${l.repo}).`
              : `Conceito de outra skill (${l.targetSkill}).`,
        backlinks: 0,
        links: [],
        dangling: []
      });
    };
    for (const l of (g.entry && g.entry.links) || []) addStub(l);
    for (const f of g.files || []) for (const l of f.links || []) addStub(l);
    const edges = [];
    const seen = new Set();
    const addEdge = (from, l) => {
      const to = typeof l === 'string' ? l : l && (l.scope === 'xrepo' ? `@${l.repo}/${l.path}` : l.path);
      if (!to || !ids.has(to) || from === to) return;
      const key = `${from}->${to}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ from, to, scope: (l && l.scope) || 'within' });
    };
    for (const l of (g.entry && g.entry.links) || []) addEdge('SKILL.md', l);
    for (const f of g.files || []) for (const l of f.links || []) addEdge(f.path, l);
    return { nodes, edges };
  }

  // Deterministic force-directed layout (Fruchterman–Reingold-ish; circle-seeded, no RNG →
  // identical every render, so re-rendering on select never makes the graph jump). Root pinned
  // at center.
  function computeGraphLayout(nodes, edges, W, H) {
    const N = nodes.length;
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const rootI = idx.get('SKILL.md');
    const R = Math.min(W, H) * 0.34;
    const pos = nodes.map((n, i) => ({
      x: W / 2 + Math.cos((i / N) * 2 * Math.PI) * R,
      y: H / 2 + Math.sin((i / N) * 2 * Math.PI) * R
    }));
    if (rootI != null) {
      pos[rootI].x = W / 2;
      pos[rootI].y = H / 2;
    }
    const k = Math.sqrt((W * H) / Math.max(1, N)) * 0.55;
    const iters = 320;
    for (let it = 0; it < iters; it++) {
      const disp = pos.map(() => ({ x: 0, y: 0 }));
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          let dx = pos[i].x - pos[j].x,
            dy = pos[i].y - pos[j].y;
          const d = Math.hypot(dx, dy) || 0.01;
          const f = (k * k) / d;
          disp[i].x += (dx / d) * f;
          disp[i].y += (dy / d) * f;
          disp[j].x -= (dx / d) * f;
          disp[j].y -= (dy / d) * f;
        }
      }
      for (const e of edges) {
        const a = idx.get(e.from),
          b = idx.get(e.to);
        if (a == null || b == null) continue;
        let dx = pos[a].x - pos[b].x,
          dy = pos[a].y - pos[b].y;
        const d = Math.hypot(dx, dy) || 0.01;
        const f = (d * d) / k;
        disp[a].x -= (dx / d) * f;
        disp[a].y -= (dy / d) * f;
        disp[b].x += (dx / d) * f;
        disp[b].y += (dy / d) * f;
      }
      const temp = (1 - it / iters) * k * 1.2;
      for (let i = 0; i < N; i++) {
        disp[i].x += (W / 2 - pos[i].x) * 0.03;
        disp[i].y += (H / 2 - pos[i].y) * 0.03;
        const d = Math.hypot(disp[i].x, disp[i].y) || 0.01;
        const lim = Math.min(d, temp);
        pos[i].x += (disp[i].x / d) * lim;
        pos[i].y += (disp[i].y / d) * lim;
        pos[i].x = Math.max(26, Math.min(W - 26, pos[i].x));
        pos[i].y = Math.max(26, Math.min(H - 26, pos[i].y));
      }
      if (rootI != null) {
        pos[rootI].x = W / 2;
        pos[rootI].y = H / 2;
      }
    }
    return pos;
  }

  function graphNodeLabel(id) {
    const base = String(id).split('/').pop();
    return base.length > 16 ? base.slice(0, 15) + '…' : base;
  }

  // The per-skill context graph now runs on the SAME vendored Cytoscape engine as the Mapa de
  // conhecimento — a deliberately simple version: force layout, drag/pan/zoom, hover-highlight,
  // click-to-select. Selection updates the detail panel IN PLACE (no re-render → positions survive).
  function renderContextGraph(ex) {
    if (ex.graphLoading) return '<div class="repo-empty">Carregando grafo de contexto…</div>';
    if (ex.graphError) return `<div class="repo-empty">${escapeHtml(ex.graphError)}</div>`;
    if (!ex.graph) return '<div class="repo-empty">Abra a aba para carregar o grafo.</div>';
    const model = contextGraphModel(ex.graph);
    if (model.nodes.length <= 1) {
      return '<div class="repo-empty">Esta skill não tem arquivos de contexto — só o SKILL.md.</div>';
    }
    const kinds = [...new Set(model.nodes.map((n) => n.kind))];
    const legend = kinds
      .map(
        (kd) =>
          `<span class="graph-legend-item"><i class="graph-swatch graph-node--${kd}"></i>${escapeHtml(GRAPH_KIND[kd] || kd)}</span>`
      )
      .join('');
    const danglingCount = (ex.graph.files || []).reduce((acc, f) => acc + (f.dangling || []).length, 0);
    const stats = `${model.nodes.length} nós · ${model.edges.length} conexões${danglingCount ? ` · ${danglingCount} link(s) quebrado(s)` : ''}`;
    return `
      <div class="graph-view">
        <div class="graph-toolbar"><span class="graph-stats">${stats}</span><div class="graph-legend">${legend}</div></div>
        <div id="skill-cy" aria-label="Grafo de contexto da skill"></div>
        <div id="skill-graph-detail">${skillGraphDetailHtml(model, ex.graphSelected)}</div>
      </div>`;
  }

  // The selected-node detail (summary + links in/out + open-file) — empty selection renders
  // NOTHING (the hint card was retired; the container collapses via :empty).
  function skillGraphDetailHtml(model, selectedId) {
    const sel = selectedId ? model.nodes.find((n) => n.id === selectedId) : null;
    if (!sel) return '';
    return `<div class="graph-detail">
      <div class="graph-detail-head"><code>${escapeHtml(sel.id)}</code><span class="graph-kind-tag graph-node--${sel.kind}">${escapeHtml(GRAPH_KIND[sel.kind] || sel.kind)}</span></div>
      <p class="graph-detail-summary">${escapeHtml(sel.summary || '(sem resumo)')}${sel.source ? ` <em>(${sel.source === 'ai' ? 'IA' : 'heurístico'})</em>` : ''}</p>
      <div class="graph-detail-refs">
        <div class="graph-ref-col"><small>Referencia (${(sel.links || []).length})</small>${(sel.links || []).length ? '<ul>' + sel.links.map((l) => `<li><button class="linklike" data-action="graphSelectNode" data-path="${escapeHtml(l.path)}">${escapeHtml(graphNodeLabel(l.path))}</button>${l.scope && l.scope !== 'within' ? ` <span class="graph-scope-tag graph-node--${l.scope}">${escapeHtml(l.scope === 'commons' ? 'cápsula' : l.scope === 'xrepo' ? `@${l.repo}` : l.targetSkill)}</span>` : ''}</li>`).join('') + '</ul>' : '<span class="muted">—</span>'}</div>
        <div class="graph-ref-col"><small>Referenciado por</small><strong>${sel.backlinks}</strong>${(sel.crossBacklinks || []).length ? `<div class="gov-counts">outras skills: ${sel.crossBacklinks.map((sk) => escapeHtml(sk)).join(', ')}</div>` : ''}</div>
        ${(sel.dangling || []).length ? `<div class="graph-ref-col"><small>Links quebrados</small><ul>${sel.dangling.map((d) => `<li class="muted">${escapeHtml(d)}</li>`).join('')}</ul></div>` : ''}
      </div>
      ${
        sel.kind !== 'root' && sel.kind !== 'binario' && !sel.external
          ? `<button class="ghost-button small" data-action="graphOpenFile" data-path="${escapeHtml(sel.id)}">${icon('file')}Abrir arquivo</button>`
          : sel.external
            ? `<p class="muted">${sel.scope === 'commons' ? 'Cápsula compartilhada' : `Conceito da skill ${escapeHtml(sel.targetSkill || '')}`} — abra na sua própria neighborhood.</p>`
            : ''
      }
    </div>`;
  }

  // Same hexes as the .graph-node--<kind> CSS swatches (canvas colors can't use CSS vars).
  const SKILL_GRAPH_COLORS = {
    root: '#6366f1',
    schema: '#0ea5e9',
    query: '#f59e0b',
    contexto: '#10b981',
    catalogo: '#8b5cf6',
    eval: '#ec4899',
    binario: '#94a3b8',
    outro: '#64748b',
    cross: '#ef4444',
    xrepo: '#a855f7',
    commons: '#14b8a6'
  };

  let skillCy = null;
  function destroySkillCy() {
    if (skillCy) {
      try {
        skillCy.destroy();
      } catch (error) {
        /* gone */
      }
      skillCy = null;
    }
  }

  function mountSkillGraph() {
    const ex = state.explore;
    const el = document.getElementById('skill-cy');
    if (!ex || !ex.graph || !el || state.view !== 'explore' || ex.tab !== 'graph') return;
    if (typeof cytoscape === 'undefined') {
      el.innerHTML = '<div class="repo-empty">Biblioteca do grafo não carregada (vendor/cytoscape.min.js).</div>';
      return;
    }
    destroySkillCy();
    const model = contextGraphModel(ex.graph);
    const theme = graphThemeColors();
    const textColor = theme.text;
    const lineColor = theme.edge;
    const surface = theme.surface;
    skillCy = window.cytoscape({
      container: el,
      elements: [
        ...model.nodes.map((n) => ({
          group: 'nodes',
          data: { id: n.id, kind: n.kind, external: n.external ? 1 : 0, backlinks: n.backlinks }
        })),
        ...model.edges.map((e, i) => ({
          group: 'edges',
          data: { id: `se${i}`, source: e.from, target: e.to, scope: e.scope }
        }))
      ],
      wheelSensitivity: 0.2,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele) => SKILL_GRAPH_COLORS[ele.data('kind')] || '#64748b',
            width: (ele) => (ele.data('kind') === 'root' ? 26 : Math.min(22, 13 + (ele.data('backlinks') || 0) * 2)),
            height: (ele) => (ele.data('kind') === 'root' ? 26 : Math.min(22, 13 + (ele.data('backlinks') || 0) * 2)),
            label: (ele) => graphNodeLabel(ele.id()),
            'font-size': 9,
            color: textColor,
            'min-zoomed-font-size': 7,
            'text-valign': 'bottom',
            'text-margin-y': 4
          }
        },
        // External stubs (cross-skill / capsule): hollow dashed ring, like the old SVG look.
        {
          selector: 'node[external = 1]',
          style: {
            'background-color': surface,
            'border-width': 2,
            'border-style': 'dashed',
            'border-color': (ele) => SKILL_GRAPH_COLORS[ele.data('kind')] || '#64748b'
          }
        },
        {
          selector: 'edge',
          style: {
            width: 1.2,
            'line-color': lineColor,
            'curve-style': 'straight',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': lineColor,
            'arrow-scale': 0.6,
            opacity: 0.6
          }
        },
        // Skill→skill references (scope=cross): dashed, matching the Mapa convention.
        { selector: 'edge[scope = "cross"]', style: { 'line-style': 'dashed', 'line-dash-pattern': [7, 4] } },
        // Cross-repo references (scope=xrepo): dotted — a link that crosses a balde boundary.
        { selector: 'edge[scope = "xrepo"]', style: { 'line-style': 'dotted' } },
        { selector: '.faded', style: { opacity: 0.1, 'text-opacity': 0 } },
        { selector: 'node.hl', style: { 'border-width': 2, 'border-color': textColor, 'border-style': 'solid' } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': textColor, 'border-style': 'solid' } }
      ]
    });
    skillCy.on('mouseover', 'node', (ev) => {
      const n = ev.target;
      skillCy.elements().addClass('faded');
      n.closedNeighborhood().removeClass('faded');
      n.addClass('hl');
    });
    skillCy.on('mouseout', 'node', () => {
      skillCy.elements().removeClass('faded');
      skillCy.nodes().removeClass('hl');
    });
    skillCy.on('tap', 'node', (ev) => {
      skillGraphSelect(ev.target.id());
    });
    skillCy.on('tap', (ev) => {
      if (ev.target === skillCy) skillGraphSelect(null);
    });
    const lay = skillCy.elements().layout({
      name: graphForceLayoutName(),
      animate: false,
      randomize: true,
      nodeRepulsion: 5500,
      idealEdgeLength: 70
    });
    lay.one('layoutstop', () => {
      try {
        skillCy.fit(undefined, 35);
      } catch (error) {
        /* empty */
      }
    });
    try {
      lay.run();
    } catch (error) {
      skillCy.elements().layout({ name: 'cose', animate: false }).run();
    }
    if (ex.graphSelected) {
      const n = skillCy.$id(ex.graphSelected);
      if (n.nonempty()) n.select();
    }
  }

  // Select a node (from a canvas tap or a panel link): update the detail panel in place and
  // mirror the selection on the canvas — NO renderShell, so the layout keeps its positions.
  function skillGraphSelect(path) {
    const ex = state.explore;
    if (!ex || !ex.graph) return;
    ex.graphSelected = ex.graphSelected === path ? null : path;
    const host = document.getElementById('skill-graph-detail');
    if (host) host.innerHTML = skillGraphDetailHtml(contextGraphModel(ex.graph), ex.graphSelected);
    if (skillCy) {
      skillCy.$(':selected').unselect();
      if (ex.graphSelected) {
        const n = skillCy.$id(ex.graphSelected);
        if (n.nonempty()) n.select();
      }
    }
  }
  // Linking ANY episode shows the WHOLE series (episodes gathered corpus-wide from the commons
  // list's governance.serie/periodo). Monthly series get gap markers for missing months.
  function skillLinkedCapsuleIdsClient(markdown) {
    return [
      ...new Set(
        (String(markdown || '').match(/\/commons\/[A-Za-z0-9._/-]+/g) || []).map((m) =>
          m.replace('/commons/', '').replace(/[).,]+$/, '')
        )
      )
    ];
  }

  function renderSkillTimeline(ex) {
    const bundle = ex.bundle;
    if (!bundle) return '<div class="repo-empty">Abra uma skill para ver a linha do tempo.</div>';
    const concepts = (ex.commonsData && ex.commonsData.concepts) || [];
    if (ex.commonsLoading && !concepts.length) return '<div class="repo-empty">Carregando cápsulas…</div>';
    const linked = skillLinkedCapsuleIdsClient(bundle.markdown);
    const byId = new Map(concepts.map((c) => [c.path, c]));
    const seriesKeys = new Set();
    for (const cid of linked) {
      const c = byId.get(cid);
      const serie = c && c.governance && c.governance.serie;
      if (serie) seriesKeys.add(`${cid.split('/')[0]}/${serie}`);
    }
    if (!seriesKeys.size) {
      return '<div class="repo-empty">Nenhuma série temporal vinculada a esta skill. Marque cápsulas com <strong>série</strong> + <strong>período</strong> (etapa Governança do editor de cápsulas) e referencie um episódio no SKILL.md.</div>';
    }
    const sections = [];
    for (const key of [...seriesKeys].sort()) {
      const dom = key.split('/')[0];
      const serie = key.split('/').slice(1).join('/');
      const eps = concepts
        .filter((c) => c.governance && c.governance.serie === serie && c.path.split('/')[0] === dom)
        .map((c) => ({
          path: c.path,
          periodo: String((c.governance && c.governance.periodo) || ''),
          title: c.title || c.path.split('/').pop(),
          summary: c.summary || '',
          status: (c.governance && c.governance.status) || 'never'
        }))
        .sort((a, b) => b.periodo.localeCompare(a.periodo));
      const monthly = eps.length > 1 && eps.every((e) => /^\d{4}-\d{2}$/.test(e.periodo));
      const rows = [];
      for (let i = 0; i < eps.length; i++) {
        rows.push(timelineItemHtml(eps[i], i === 0));
        if (monthly && i < eps.length - 1) {
          for (const g of monthsBetweenDesc(eps[i + 1].periodo, eps[i].periodo)) {
            rows.push(`<div class="stl-gap">${icon('alert')}sem episódio em <strong>${escapeHtml(g)}</strong></div>`);
          }
        }
      }
      sections.push(`
        <section class="stl-serie">
          <div class="stl-serie-head"><strong>${escapeHtml(key)}</strong><small>${eps.length} episódio(s)</small></div>
          <div class="stl-rail">${rows.join('')}</div>
        </section>`);
    }
    return `<div class="skill-timeline">${sections.join('')}</div>`;
  }

  function timelineItemHtml(e, isLatest) {
    const st = { green: 'verde', 'due-soon': 'amarelo', overdue: 'vermelho', never: 'neutro' }[e.status] || 'neutro';
    return `
      <button type="button" class="stl-item" data-action="exploreSelectCommons" data-path="${escapeHtml(e.path)}" title="Abrir a cápsula">
        <span class="stl-periodo">${escapeHtml(e.periodo || '—')}</span>
        <span class="stl-dot stl-dot--${st}" title="governança: ${escapeHtml(e.status)}"></span>
        <span class="stl-main"><strong>${escapeHtml(e.title)}</strong><small>${escapeHtml(e.summary)}</small></span>
        ${isLatest ? '<span class="stl-badge">mais recente</span>' : ''}
      </button>`;
  }

  // Exclusive list of missing YYYY-MM months between two monthly periods, newest-first.
  function monthsBetweenDesc(olderYm, newerYm) {
    const out = [];
    let y = Number(newerYm.slice(0, 4));
    let m = Number(newerYm.slice(5, 7));
    for (let guard = 0; guard < 120; guard++) {
      m -= 1;
      if (m === 0) {
        m = 12;
        y -= 1;
      }
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      if (ym <= olderYm) break;
      out.push(ym);
    }
    return out;
  }

  // Group the flat file list into a nested folder tree. Root-level files stay at
  // the top level; every intermediate path segment becomes a collapsible folder.
  function buildFileTree(files) {
    const root = { folders: new Map(), files: [] };
    for (const entry of files || []) {
      const parts = String(entry.path).split('/');
      if (parts.length === 1) {
        root.files.push({ name: parts[0], path: entry.path, size: entry.size });
        continue;
      }
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        if (!node.folders.has(seg)) {
          node.folders.set(seg, { folders: new Map(), files: [] });
        }
        node = node.folders.get(seg);
      }
      node.files.push({ name: parts[parts.length - 1], path: entry.path, size: entry.size });
    }
    return root;
  }

  function fileTreeCount(node) {
    let n = node.files.length;
    for (const child of node.folders.values()) {
      n += fileTreeCount(child);
    }
    return n;
  }

  // Render folders (collapsible, folders first) then files, recursing into open
  // folders. `openFolders` is a Set of folder paths; absent = collapsed.
  function renderFileTreeNodes(node, active, openFolders, prefix, depth) {
    let html = '';
    const folderNames = [...node.folders.keys()].sort((a, b) => a.localeCompare(b));
    for (const name of folderNames) {
      const folderPath = prefix ? `${prefix}/${name}` : name;
      const child = node.folders.get(name);
      const isOpen = openFolders.has(folderPath);
      html += `
        <button class="folder-node ${isOpen ? 'is-open' : ''}" data-action="exploreToggleFolder" data-folder="${escapeHtml(folderPath)}" style="--depth:${depth}" title="${escapeHtml(name)}">
          ${icon('chevron', 'folder-caret')}${icon('folder')}<span>${escapeHtml(name)}</span><small>${fileTreeCount(child)}</small>
        </button>`;
      if (isOpen) {
        html += renderFileTreeNodes(child, active, openFolders, folderPath, depth + 1);
      }
    }
    const files = node.files.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const f of files) {
      html += `
        <button class="file-node ${active === f.path ? 'active' : ''}" data-action="exploreFile" data-path="${escapeHtml(f.path)}" style="--depth:${depth}" title="${escapeHtml(f.path)}">
          ${icon('file')}<span>${escapeHtml(f.name)}</span><small>${formatBytes(f.size)}</small>
        </button>`;
    }
    return html;
  }

  function renderRepoFiles(ex) {
    const bundle = ex.bundle;
    const active = ex.file || 'SKILL.md';
    const openFolders = ex.openFolders instanceof Set ? ex.openFolders : new Set();
    const tree =
      renderFileTreeNodes(buildFileTree(bundle.files), active, openFolders, '', 0) ||
      '<div class="repo-empty">Sem arquivos.</div>';

    let viewer;
    if (active === 'SKILL.md') {
      viewer = `<div class="md-body">${renderMarkdownSafe(bundle.body || bundle.markdown)}</div>`;
    } else if (ex.fileContent && ex.fileContent.loading) {
      viewer = '<div class="repo-empty">Carregando…</div>';
    } else if (ex.fileContent && ex.fileContent.error) {
      viewer = `<div class="repo-empty">${escapeHtml(ex.fileContent.error)}</div>`;
    } else if (ex.fileContent && ex.fileContent.tooLarge) {
      viewer = `<div class="repo-empty">Arquivo grande demais para exibir (${formatBytes(ex.fileContent.size)}).</div>`;
    } else if (ex.fileContent && ex.fileContent.binary) {
      viewer = '<div class="repo-empty">Arquivo binário — sem pré-visualização.</div>';
    } else if (ex.fileContent) {
      viewer = renderFileContent(active, ex.fileContent.content || '');
    } else {
      viewer = '<div class="repo-empty">Selecione um arquivo.</div>';
    }

    // DuckDB tools: Executar on .sql, Inspecionar on csv/parquet — result renders under the file.
    const lowerActive = active.toLowerCase();
    const dt = ex.dataTool && ex.dataTool.path === active ? ex.dataTool : null;
    let toolBar = '';
    if (active !== 'SKILL.md' && lowerActive.endsWith('.sql')) {
      toolBar = `<div class="data-tool-bar"><button class="primary-button small" data-action="skillQueryRun" data-path="${escapeHtml(active)}" ${dt && dt.loading ? 'disabled' : ''}>${icon('play')}${dt && dt.loading ? 'Executando…' : 'Executar (DuckDB)'}</button><span class="gov-counts">query governada — sandbox sobre os datasets da skill + cápsulas vinculadas; a última SELECT é o resultado</span></div>`;
    } else if (/\.(csv|parquet)$/.test(lowerActive)) {
      toolBar = `<div class="data-tool-bar"><button class="primary-button small" data-action="skillDataInspect" data-path="${escapeHtml(active)}" ${dt && dt.loading ? 'disabled' : ''}>${icon('search')}${dt && dt.loading ? 'Perfilando…' : 'Inspecionar (DuckDB)'}</button><span class="gov-counts">schema + perfil das colunas, sem escrever SQL</span></div>`;
    }
    const toolResult = dt && !dt.loading && dt.result ? renderDataToolResult(dt) : '';

    return `<div class="file-explorer">
      <aside class="file-tree">${tree}</aside>
      <div class="file-viewer">${toolBar}${viewer}${toolResult}</div>
    </div>`;
  }
  function dataToolCell(v) {
    if (v === null || v === undefined) return '<span class="muted">∅</span>';
    if (typeof v === 'object') return escapeHtml(JSON.stringify(v));
    return escapeHtml(String(v));
  }

  function renderDataToolResult(dt) {
    const r = dt.result;
    if (!r) return '';
    if (r.ok === false) {
      return `<div class="data-tool-result"><div class="form-alert form-alert-error"><strong>Erro na execução</strong><pre class="dt-error">${escapeHtml(r.error || 'falha desconhecida')}</pre></div></div>`;
    }
    if (dt.kind === 'inspect') {
      const schemaRows = (r.schema || [])
        .map((c) => `<tr><td><code>${escapeHtml(c.column_name)}</code></td><td>${escapeHtml(c.column_type)}</td></tr>`)
        .join('');
      const profRows = (r.profile || [])
        .map(
          (c) => `<tr>
        <td><code>${escapeHtml(c.column_name)}</code></td><td>${escapeHtml(c.column_type)}</td>
        <td class="dt-num">${dataToolCell(c.null_percentage)}%</td><td class="dt-num">${dataToolCell(c.approx_unique)}</td>
        <td>${dataToolCell(c.min)}</td><td>${dataToolCell(c.max)}</td>
      </tr>`
        )
        .join('');
      return `<div class="data-tool-result">
        <div class="dt-head"><strong>Perfil</strong><span class="gov-counts">tabela <code>${escapeHtml(r.table || '')}</code> · ${Number(r.rowCount || 0).toLocaleString('pt-BR')} linha(s) · ${r.elapsedMs} ms</span></div>
        <div class="dt-tables">
          <table class="dt-table"><thead><tr><th>Coluna</th><th>Tipo</th></tr></thead><tbody>${schemaRows}</tbody></table>
          <table class="dt-table"><thead><tr><th>Coluna</th><th>Tipo</th><th>Nulos</th><th>Distintos</th><th>Mín</th><th>Máx</th></tr></thead><tbody>${profRows}</tbody></table>
        </div>
      </div>`;
    }
    const cols = r.columns || [];
    const head = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
    const rows = (r.rows || [])
      .map((row) => `<tr>${cols.map((c) => `<td>${dataToolCell(row[c])}</td>`).join('')}</tr>`)
      .join('');
    const dsChips = (r.datasets || [])
      .map((d) => `<span class="dt-ds" title="${escapeHtml(d.source)}"><code>${escapeHtml(d.table)}</code></span>`)
      .join('');
    return `<div class="data-tool-result">
      <div class="dt-head"><strong>Resultado</strong><span class="gov-counts">${Number(r.rowCount || 0).toLocaleString('pt-BR')} linha(s)${r.truncated ? ` — mostrando ${r.rows.length}` : ''} · ${r.elapsedMs} ms</span></div>
      ${dsChips ? `<div class="dt-datasets"><small>tabelas:</small>${dsChips}</div>` : ''}
      ${cols.length ? `<div class="dt-scroll"><table class="dt-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="repo-empty">A execução não produziu um resultado (termine o script com uma SELECT).</div>'}
      ${r.truncated ? '<p class="gov-counts">Resultado truncado — refine com LIMIT ou agregações.</p>' : ''}
    </div>`;
  }

  async function skillQueryRun(path) {
    const ex = state.explore;
    if (!ex || !ex.selectedId) return;
    ex.dataTool = { kind: 'query', path, loading: true, result: null };
    renderShell();
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(ex.selectedId)}/query-run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path })
      });
      ex.dataTool = {
        kind: 'query',
        path,
        loading: false,
        result: await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
      };
    } catch (error) {
      ex.dataTool = {
        kind: 'query',
        path,
        loading: false,
        result: { ok: false, error: error.message || 'Erro de rede.' }
      };
    }
    renderShell();
  }

  async function skillDataInspect(path) {
    const ex = state.explore;
    if (!ex || !ex.selectedId) return;
    ex.dataTool = { kind: 'inspect', path, loading: true, result: null };
    renderShell();
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(ex.selectedId)}/data-inspect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path })
      });
      ex.dataTool = {
        kind: 'inspect',
        path,
        loading: false,
        result: await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
      };
    } catch (error) {
      ex.dataTool = {
        kind: 'inspect',
        path,
        loading: false,
        result: { ok: false, error: error.message || 'Erro de rede.' }
      };
    }
    renderShell();
  }

  async function capsuleDataInspect(concept, fileRel) {
    const ex = state.explore;
    if (!ex) return;
    ex.commonsDataTool = { concept, file: fileRel, loading: true, result: null };
    renderShell();
    try {
      const res = await fetch('/api/commons/data-inspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ concept, file: fileRel })
      });
      ex.commonsDataTool = {
        concept,
        file: fileRel,
        loading: false,
        result: await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
      };
    } catch (error) {
      ex.commonsDataTool = {
        concept,
        file: fileRel,
        loading: false,
        result: { ok: false, error: error.message || 'Erro de rede.' }
      };
    }
    renderShell();
  }

  function renderFileContent(path, content) {
    const lower = path.toLowerCase();
    if (lower.endsWith('.md')) {
      return `<div class="md-body">${renderMarkdownSafe(content)}</div>`;
    }
    if (lower.endsWith('.json')) {
      let pretty = content;
      try {
        pretty = JSON.stringify(JSON.parse(content), null, 2);
      } catch (error) {
        pretty = content;
      }
      return `<pre class="md-code">${escapeHtml(pretty)}</pre>`;
    }
    return `<pre class="md-code">${escapeHtml(content)}</pre>`;
  }

  return {
    commonsDomainKey,
    skillGroupKey,
    skillDomainOf,
    renderExplore,
    exploreHeaderCollapsed,
    renderRepoHistory,
    computeGraphLayout,
    destroySkillCy,
    mountSkillGraph,
    skillGraphSelect,
    buildFileTree,
    fileTreeCount,
    skillQueryRun,
    skillDataInspect,
    capsuleDataInspect
  };
}
