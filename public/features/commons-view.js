export function createCommonsViewFeature({
  state,
  renderShell,
  readJsonResponse,
  toast,
  escapeHtml,
  icon,
  formatDate,
  govStatusBadge,
  isOntologyPath,
  ontologyChip,
  capsuleCategoryChip,
  govDeprecatedChip,
  govEvalBadge,
  renderMarkdownSafe,
  isAdmin,
  permissionAttrs,
  permissionNote,
  stripDocFrontmatter,
  renderRepoHistory
}) {
  async function openCommons() {
    state.commons = state.commons || {};
    state.commons.loading = true;
    state.commons.error = null;
    renderShell();
    try {
      const res = await fetch('/api/commons');
      const data = await readJsonResponse(res);
      if (!res.ok || data.ok === false) {
        state.commons.error = data.error || `HTTP ${res.status}`;
        state.commons.data = null;
      } else state.commons.data = data;
    } catch (error) {
      state.commons.error = error.message || 'Erro de rede.';
      state.commons.data = null;
    }
    state.commons.loading = false;
    renderShell();
  }

  // "Revisar" opens the capsule in a new tab (rel=noopener → no back-channel), so when the user
  // returns to this tab after clicking Validar there, silently re-fetch the list and re-render only
  // if something actually changed — no loading flash, no disruptive re-render when nothing moved.
  async function refreshCommonsSilent() {
    if (state.view !== 'commons') return;
    try {
      const res = await fetch('/api/commons');
      const data = await readJsonResponse(res);
      if (res.ok && data.ok !== false) {
        state.commons = state.commons || {};
        const changed = JSON.stringify(data) !== JSON.stringify(state.commons.data);
        state.commons.data = data;
        if (changed) renderShell();
      }
    } catch (error) {
      /* transient: keep the current view */
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.view === 'commons') refreshCommonsSilent();
  });

  async function commonsAction(endpoint, body) {
    try {
      const res = await fetch(`/api/commons/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      const data = await readJsonResponse(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } catch (error) {
      toast(error.message || 'Falha na ação de governança.', 'warning');
      return null;
    }
  }
  async function commonsRunEval(path) {
    toast('Rodando eval com IA…');
    const d = await commonsAction('govern/eval-run', { path });
    if (d) {
      const o = d.evalStatus && d.evalStatus.overall;
      toast(`Eval: ${o === 'fail' ? 'falhou' : 'passou'}.`, o === 'fail' ? 'warning' : 'success');
      await openCommons();
    }
  }
  async function commonsSetCadence(path, cadence) {
    const d = await commonsAction('govern/cadence', path ? { path, cadence } : { cadence });
    if (d) {
      toast(`Cadência: ${cadence}.`, 'success');
      await openCommons();
    }
  }
  async function commonsSummarizeAll() {
    toast('Gerando resumos com IA…');
    const d = await commonsAction('summarize', {});
    if (d) {
      toast(`${d.generated} resumo(s) gerado(s).`, 'success');
      await openCommons();
    }
  }

  const CADENCE_LABEL_PT = { weekly: 'semanal', monthly: 'mensal', quarterly: 'trimestral', yearly: 'anual' };
  const COMMONS_PAGE_SIZE = 20;
  // "A revisar" horizon: a capsule counts as needing review if it expires within this many days
  // (rolling window over its expiry date), on top of already-overdue and never-reviewed ones.
  const COMMONS_REVIEW_HORIZON_DAYS = 30;

  function govCommonsCadenceSelect(path, current) {
    const opts = ['weekly', 'monthly', 'quarterly', 'yearly'];
    return `<select class="gov-cadence" data-commons-cadence data-path="${escapeHtml(path)}">${opts.map((o) => `<option value="${o}"${o === current ? ' selected' : ''}>${CADENCE_LABEL_PT[o]}</option>`).join('')}</select>`;
  }

  // #4: cadence cell — editable select unless it's locked and the viewer isn't an admin.
  function commonsCadenceCell(c, gv, canManage) {
    // Read-only by design: cadence is set in the create/edit wizard, never inline on the dashboard.
    const label = CADENCE_LABEL_PT[gv.cadence] || gv.cadence || '—';
    const lockTip = gv.cadenceLocked ? ` · definida por ${gv.cadenceLockedBy || 'criador'} (só admin altera)` : '';
    return `<span class="cadence-ro" title="Edite no assistente de criação/edição da cápsula${escapeHtml(lockTip)}">${gv.cadenceLocked ? icon('shield') : ''}${escapeHtml(label)}</span>`;
  }

  // #2: freshness badge + the next-expiry (next curator eval) date under it.
  function commonsFreshCell(gv) {
    // Explicit expiry date (governance.json `expiresAt`), inline so the row stays a one-liner.
    const when = gv.expiresAt || gv.dueAt;
    let due = '';
    if (gv.status === 'never') due = 'defina ao revisar';
    else if (when) due = (gv.status === 'overdue' ? 'venceu ' : 'vence ') + formatDate(when);
    return `${govStatusBadge(gv.status)}${due ? ` <span class="gov-due">${escapeHtml(due)}</span>` : ''}`;
  }

  // The Cápsulas table shows expiry in its own "Expira em" column — just the date
  // (the "vence" word lived in every row and is redundant against the header).
  function commonsExpiryCell(gv) {
    const when = gv.expiresAt || gv.dueAt;
    if (gv.status === 'never' || !when) return '<span class="muted">—</span>';
    return `<span class="gov-due${gv.status === 'overdue' ? ' gov-due-overdue' : ''}">${escapeHtml(formatDate(when))}</span>`;
  }

  function initialsFromName(name) {
    return (
      String(name || '?')
        .replace(/@.*$/, '')
        .split(/[\s._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0])
        .join('')
        .toUpperCase() || '?'
    );
  }

  // #3: creator + curators as compact initials-avatars with a hover tooltip (never a text wall).
  function commonsPeopleCell(gv) {
    const people = [];
    if (gv.creator) people.push({ name: gv.creator, role: 'criador' });
    for (const c of gv.curators || []) people.push({ name: c, role: 'curador' });
    const seen = new Set();
    const uniq = people.filter((p) => {
      const k = String(p.name).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!uniq.length) return '<span class="muted">curadoria global</span>';
    const shown = uniq.slice(0, 3);
    const extra = uniq.slice(3);
    return `<span class="people-avatars">${shown.map((p) => `<span class="people-avatar" title="${escapeHtml(p.name)} · ${p.role}">${escapeHtml(initialsFromName(p.name))}</span>`).join('')}${extra.length ? `<span class="people-avatar people-more" title="${escapeHtml(extra.map((p) => p.name).join(', '))}">+${extra.length}</span>` : ''}</span>`;
  }

  // User-resizable columns on the Cápsulas table. Widths (px) for the first six
  // columns (Ações is auto/flex); persisted across sessions. The table grows and the
  // wrapper scrolls horizontally when the columns exceed the panel.
  const COMMONS_COL_DEFAULTS = [200, 92, 92, 120, 110, 112, 100];
  function commonsColWidths() {
    const st = (state.commons = state.commons || {});
    if (Array.isArray(st.colWidths) && st.colWidths.length === COMMONS_COL_DEFAULTS.length) return st.colWidths;
    try {
      const saved = JSON.parse(localStorage.getItem('balde-commons-cols') || 'null');
      if (
        Array.isArray(saved) &&
        saved.length === COMMONS_COL_DEFAULTS.length &&
        saved.every((n) => n >= 60 && n <= 900)
      ) {
        st.colWidths = saved.map((n) => Math.round(n));
        return st.colWidths;
      }
    } catch (error) {
      /* ignore */
    }
    st.colWidths = COMMONS_COL_DEFAULTS.slice();
    return st.colWidths;
  }
  function commonsHeadCells() {
    const labels = ['Conceito', 'Usado por', 'Curadoria', 'Frescor', 'Expira em', 'Cadência', 'Eval', 'Ações'];
    const w = commonsColWidths();
    return labels
      .map((label, i) => {
        const width = i < w.length ? ` style="width:${w[i]}px"` : '';
        const handle =
          i < labels.length - 1
            ? `<span class="col-resize" data-col-resize="${i}" aria-hidden="true" title="Arraste para redimensionar a coluna"></span>`
            : '';
        return `<th${width}>${escapeHtml(label)}${handle}</th>`;
      })
      .join('');
  }
  // Drag a column border to resize it. Updates the header cell width live (no
  // re-render), then persists on release.
  function startCommonsColResize(event, index) {
    const th = event.target.closest('th');
    if (!th || !(index >= 0)) return;
    event.preventDefault();
    const widths = commonsColWidths().slice();
    const startX = event.clientX;
    const startW = widths[index] || Math.round(th.getBoundingClientRect().width) || 100;
    const handle = event.target.closest('[data-col-resize]');
    if (handle) handle.classList.add('is-dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    const onMove = (ev) => {
      const w = Math.max(60, Math.min(900, Math.round(startW + (ev.clientX - startX))));
      widths[index] = w;
      th.style.width = `${w}px`;
      (state.commons = state.commons || {}).colWidths = widths;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (handle) handle.classList.remove('is-dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      try {
        localStorage.setItem('balde-commons-cols', JSON.stringify(widths));
      } catch (error) {
        /* ignore */
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function renderCommons() {
    const st = state.commons || {};
    if (st.loading && !st.data)
      return '<section class="panel"><div class="repo-empty">Carregando cápsulas…</div></section>';
    if (st.error) return `<section class="panel"><div class="repo-empty">${escapeHtml(st.error)}</div></section>`;
    const d = st.data || { concepts: [], governance: { counts: {}, auditDue: [] } };
    const g = d.governance || { counts: {}, auditDue: [] };
    const canManage = !!d.canManage;
    const auditN = (g.auditDue || []).length;
    const all = d.concepts || [];
    // #7: local filter + pagination (the shared list grows big).
    const filter = String(st.filter || '')
      .trim()
      .toLowerCase();
    // Mode: todas | vencidas (deprecated = review past its expiry).
    // Mode: revisar (DEFAULT — vencidas + nunca revisadas + a vencer nos próximos 30 dias) | todas | vencidas.
    const mode = ['todas', 'revisar', 'vencidas'].includes(st.mode) ? st.mode : 'revisar';
    const overdueN = all.filter((c) => (c.governance && c.governance.status) === 'overdue').length;
    // "A revisar" = precisa de atenção: já vencida (overdue) OU nunca revisada (never) OU com
    // expiração dentro da janela contínua de COMMONS_REVIEW_HORIZON_DAYS dias.
    const reviewCutoff = Date.now() + COMMONS_REVIEW_HORIZON_DAYS * 86400000;
    const needsReview = (c) => {
      const gv = c.governance || {};
      if (gv.status === 'overdue' || gv.status === 'never') return true;
      const when = Date.parse(gv.expiresAt || gv.dueAt || '');
      return Number.isFinite(when) && when <= reviewCutoff;
    };
    const pendingN = all.filter(needsReview).length;
    const modeFiltered =
      mode === 'vencidas'
        ? all.filter((c) => (c.governance && c.governance.status) === 'overdue')
        : mode === 'revisar'
          ? all.filter(needsReview)
          : all;
    const filtered = filter
      ? modeFiltered.filter((c) =>
          `${c.path} ${c.summary || ''} ${(c.governance && c.governance.creator) || ''} ${(c.referencedBy || []).join(' ')}`
            .toLowerCase()
            .includes(filter)
        )
      : modeFiltered;
    const pageSize = COMMONS_PAGE_SIZE;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(Math.max(0, st.page || 0), pages - 1);
    const slice = filtered.slice(page * pageSize, page * pageSize + pageSize);
    const rows = slice
      .map((c) => {
        const gv = c.governance || {};
        const m = c.media || { img: 0, data: 0 };
        const mediaBadge =
          m.img || m.data
            ? `<span class="media-badge" title="mídia: ${m.img} imagem(ns) · ${m.data} tabela(s)">${m.img ? `${icon('image') || '🖼'} ${m.img}` : ''}${m.data ? ` ▦ ${m.data}` : ''}</span>`
            : '';
        const restrictedBadge =
          c.visibility === 'restricted'
            ? `<span class="restricted-chip" title="Cápsula restrita — visível só para curadores/leitores listados">${icon('lock')}restrita</span>`
            : '';
        return `<tr class="commons-row">
        <td class="commons-cell-concept">${
          isLocalShell()
            ? `<button class="link-button commons-open" data-action="commonsFilePopup" data-path="${escapeHtml(c.path)}" title="${escapeHtml(c.summary || 'Abrir')}"><code>${escapeHtml(c.path)}</code></button>`
            : `<a class="link-button commons-open" href="/api/commons/file/view?path=${encodeURIComponent(c.path)}" target="_blank" rel="noopener" title="${escapeHtml(c.summary || 'Abrir em nova aba')}"><code>${escapeHtml(c.path)}</code></a>`
        }${isOntologyPath(c.path) ? ontologyChip() : ''}${capsuleCategoryChip(gv.categoria)}${restrictedBadge}${mediaBadge}${c.summary ? `<div class="commons-summary">${escapeHtml(c.summary)}</div>` : ''}</td>
        <td class="commons-cell-refs">${(c.referencedBy || []).length ? `<span class="commons-refs-count" title="${escapeHtml(c.referencedBy.join(', '))}">${c.referencedBy.length} ref${c.referencedBy.length > 1 ? 's' : ''}</span>` : '<span class="muted">—</span>'}</td>
        <td>${commonsPeopleCell(gv)}</td>
        <td class="commons-cell-fresh">${govStatusBadge(gv.status)}${govDeprecatedChip(gv)}</td>
        <td class="commons-cell-expiry">${commonsExpiryCell(gv)}</td>
        <td>${commonsCadenceCell(c, gv, canManage)}</td>
        <td>${govEvalBadge(gv.eval)}</td>
        <td class="commons-cell-actions">
          ${
            isLocalShell()
              ? `<button class="link-button" data-action="commonsFilePopup" data-path="${escapeHtml(c.path)}">Abrir</button>`
              : `<a class="link-button" href="/api/commons/file/view?path=${encodeURIComponent(c.path)}" target="_blank" rel="noopener">Abrir</a>`
          }
          ${canManage ? `<span class="commons-action-sep">·</span><button class="link-button" data-action="commonsReviewOpen" data-path="${escapeHtml(c.path)}" title="Abrir a cápsula e validar a revisão vendo o conteúdo"${permissionAttrs('curar')}>Revisar</button>` : ''}
        </td>
      </tr>`;
      })
      .join('');
    const pager =
      pages > 1
        ? `
        <div class="commons-pager">
          <button class="ghost-button small" data-action="commonsPagePrev" ${page === 0 ? 'disabled' : ''}>‹ Anterior</button>
          <span class="commons-pager-info">${page * pageSize + 1}–${Math.min(filtered.length, page * pageSize + pageSize)} de ${filtered.length}</span>
          <button class="ghost-button small" data-action="commonsPageNext" ${page >= pages - 1 ? 'disabled' : ''}>Próxima ›</button>
        </div>`
        : '';
    const emptyMsg = filter
      ? `Nenhuma cápsula corresponde a “${escapeHtml(st.filter)}”.`
      : mode === 'revisar'
        ? 'Tudo em dia ✓ — nenhuma cápsula a vencer, vencida ou por revisar.'
        : mode === 'vencidas'
          ? 'Nenhuma cápsula vencida.'
          : 'Nenhuma cápsula ainda — mova conceitos reutilizáveis de uma skill (Curadoria → migração) ou crie uma.';
    return `
      <section class="panel">
        <div class="section-heading">
          <div><p class="eyebrow">Corpus · cápsulas compartilhadas</p><h2>Cápsulas</h2></div>
          <div class="section-heading-actions">
            ${canManage ? `<button class="ghost-button small" data-action="commonsSummarizeAll"${permissionAttrs('curar')}>${icon('spark')}Resumir tudo (IA)</button>` : ''}
            <span class="readonly-tag">${govStatusBadge(g.overallStatus || 'green')}</span>
          </div>
        </div>
        <p class="gov-counts">${(g.counts && g.counts.green) || 0} em dia · ${auditN} auditoria pendente · ${all.length} conceito(s)${canManage ? '' : ' · somente leitura'}</p>
        ${canManage ? permissionNote('curar') : ''}
        <div class="commons-toolbar">
          <label class="commons-filter">${icon('search')}<input type="search" data-commons-filter value="${escapeHtml(st.filter || '')}" placeholder="Filtrar por caminho, resumo, criador…"></label>
          <div class="commons-mode">
            <button class="queue-subtab ${mode === 'revisar' ? 'active' : ''}" data-action="commonsSetMode" data-mode="revisar" title="Vencidas, nunca revisadas ou a vencer em 30 dias">A revisar <span>${pendingN}</span></button>
            <button class="queue-subtab ${mode === 'todas' ? 'active' : ''}" data-action="commonsSetMode" data-mode="todas">Todas <span>${all.length}</span></button>
            <button class="queue-subtab ${mode === 'vencidas' ? 'active' : ''}" data-action="commonsSetMode" data-mode="vencidas">Depreciadas <span>${overdueN}</span></button>
          </div>
        </div>
        <div class="curator-panel">
          <table class="curator-table commons-table">
            <thead><tr>${commonsHeadCells()}</tr></thead>
            <tbody>${rows || `<tr><td colspan="8" class="muted">${emptyMsg}</td></tr>`}</tbody>
          </table>
          ${pager}
        </div>
      </section>`;
  }

  // #7 pagination + local filter controls.
  function commonsSetPage(delta) {
    state.commons = state.commons || {};
    state.commons.page = Math.max(0, (state.commons.page || 0) + delta);
    renderShell();
  }
  function commonsSetFilter(value) {
    state.commons = state.commons || {};
    state.commons.filter = value;
    state.commons.page = 0;
    renderShell();
    // keep focus + caret at end after the re-render
    requestAnimationFrame(() => {
      const el = document.querySelector('[data-commons-filter]');
      if (el) {
        el.focus();
        const v = el.value;
        el.value = '';
        el.value = v;
      }
    });
  }

  // #1: open a commons concept — view rendered content + git history + approval log; edit if curator.
  function fmtDateTime(iso) {
    try {
      return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch (error) {
      return String(iso || '');
    }
  }
  function commonsConceptByPath(path) {
    const list = (state.commons && state.commons.data && state.commons.data.concepts) || [];
    return list.find((c) => c.path === path) || null;
  }
  // Flavor: no shell local (WebView2) um target=_blank cai no NAVEGADOR DO SISTEMA — jarring.
  // Lá, abrir cápsula usa o popup interno (o modal); no navegador, a nova aba continua.
  function isLocalShell() {
    return !!(window.chrome && window.chrome.webview);
  }

  async function openCommonsFile(path, opts = {}) {
    state.commons = state.commons || {};
    const reviewMode = !!opts.review;
    state.commons.file = {
      path,
      reviewMode,
      loading: true,
      error: null,
      content: '',
      history: [],
      editing: false,
      draft: '',
      saving: false,
      tooLarge: false,
      media: null,
      processing: false
    };
    renderShell();
    try {
      const res = await fetch(`/api/commons/file?path=${encodeURIComponent(path)}`);
      const data = await readJsonResponse(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      state.commons.file = {
        path,
        reviewMode,
        loading: false,
        error: null,
        content: data.content || '',
        history: data.history || [],
        editing: false,
        draft: data.content || '',
        saving: false,
        tooLarge: !!data.tooLarge,
        size: data.size,
        media: data.media || { images: [], data: [] },
        processing: false
      };
    } catch (error) {
      if (state.commons.file) {
        state.commons.file.loading = false;
        state.commons.file.error = error.message || 'Erro de rede.';
      }
    }
    renderShell();
  }
  // Revisar (flavor local): valida a revisão a partir do popup — mesmo govern/review do dashboard.
  async function commonsModalValidate(path) {
    const d = await commonsAction('govern/review', { path });
    if (d) {
      toast('Conceito revisado.', 'success');
      if (state.commons) state.commons.file = null;
      await openCommons(); // refresh the dashboard list behind the popup
    }
  }
  // Phase 2: process this concept's img/ + data/ sidecars with the BYO AI, then refresh the modal.
  async function commonsProcessMedia(path) {
    const f = state.commons && state.commons.file;
    if (f && f.path === path) {
      f.processing = true;
      renderShell();
    }
    toast('Processando mídia com IA…');
    try {
      const res = await fetch('/api/commons/process-media', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      const c = data.counts || { img: {}, data: {} };
      toast(`Mídia processada: ${c.img.described || 0} imagem(ns) · ${c.data.described || 0} tabela(s).`, 'success');
      await openCommonsFile(path); // reopen with fresh descriptions
      await openCommons(); // refresh list badges
    } catch (error) {
      if (f) {
        f.processing = false;
      }
      toast(error.message || 'Falha ao processar mídia.', 'warning');
      renderShell();
    }
  }
  function closeCommonsFile() {
    if (state.commons) state.commons.file = null;
    renderShell();
  }
  function toggleCommonsEdit() {
    const f = state.commons && state.commons.file;
    if (!f) return;
    f.editing = !f.editing;
    if (f.editing) f.draft = f.content;
    renderShell();
  }
  async function saveCommonsFile() {
    const f = state.commons && state.commons.file;
    if (!f) return;
    const editor = document.querySelector('[data-commons-editor]');
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
      await openCommons(); // refresh the list (summary/size may have changed)
    } catch (error) {
      f.saving = false;
      toast(error.message || 'Falha ao salvar.', 'warning');
      renderShell();
    }
  }
  function renderCommonsFileModal() {
    const f = state.commons.file;
    const canManage = !!(state.commons.data && state.commons.data.canManage);
    const concept = commonsConceptByPath(f.path);
    const approvals = (concept && concept.governance && concept.governance.approvals) || [];
    const isMd = true; // commons content is always context.md (markdown)
    let bodyHtml;
    if (f.loading) bodyHtml = '<div class="repo-empty">Carregando…</div>';
    else if (f.error) bodyHtml = `<div class="form-alert form-alert-error">${escapeHtml(f.error)}</div>`;
    else if (f.tooLarge) bodyHtml = '<div class="repo-empty">Arquivo muito grande para exibir aqui.</div>';
    else if (f.editing)
      bodyHtml = `<textarea class="commons-editor" data-commons-editor spellcheck="false" ${f.saving ? 'disabled' : ''}>${escapeHtml(f.draft)}</textarea>`;
    else
      bodyHtml = isMd
        ? `<div class="commons-doc">${renderMarkdownSafe(f.content)}</div>`
        : `<pre class="commons-raw">${escapeHtml(f.content)}</pre>`;
    const histHtml =
      (f.history || [])
        .slice(0, 8)
        .map(
          (h) =>
            `<li><div class="hist-top"><span class="hist-who">${escapeHtml(h.author || '')}</span><span class="hist-when">${escapeHtml(formatDate(h.date))}</span></div><div class="hist-msg">${escapeHtml(h.subject || '')}</div></li>`
        )
        .join('') || '<li class="muted">Sem histórico.</li>';
    const apprHtml = approvals.length
      ? approvals
          .slice()
          .reverse()
          .slice(0, 15)
          .map(
            (a) =>
              `<li><div class="hist-top"><span class="appr-action">${escapeHtml(a.action)}</span><span class="hist-when">${escapeHtml(fmtDateTime(a.at))}</span></div><div class="hist-msg"><strong>${escapeHtml(a.by || '')}</strong>${a.detail ? ` — ${escapeHtml(a.detail)}` : ''}</div></li>`
          )
          .join('')
      : '<li class="muted">Sem aprovações registradas.</li>';
    // Phase 2: AI-processed media (img/ rendered via endpoint + data/ tables as markdown).
    const media = f.media || { images: [], data: [], files: [] };
    const hasMedia =
      (media.images && media.images.length) || (media.data && media.data.length) || (media.files && media.files.length);
    const mediaHtml =
      !f.loading && !f.error && hasMedia
        ? `
      <div class="commons-media">
        ${media.images && media.images.length ? `<h4 class="commons-media-h">Imagens</h4><div class="media-imgs">${media.images.map((m) => `<figure class="media-img"><img src="/api/commons/img?path=${encodeURIComponent(f.path)}&name=${encodeURIComponent(m.name)}" alt="${escapeHtml(m.name)}"><figcaption><strong>${escapeHtml(m.name)}</strong>${m.description ? `<span>${escapeHtml(m.description)}</span>` : '<span class="muted">sem descrição — processe a mídia (IA)</span>'}</figcaption></figure>`).join('')}</div>` : ''}
        ${media.data && media.data.length ? `<h4 class="commons-media-h">Dados</h4>${media.data.map((m) => `<div class="media-data"><div class="media-data-head"><strong>${escapeHtml(m.name)}</strong>${m.description ? ` — ${escapeHtml(m.description)}` : ''}</div>${m.markdown ? `<div class="commons-doc">${renderMarkdownSafe(m.markdown)}</div>` : ''}</div>`).join('')}` : ''}
        ${media.files && media.files.length ? `<h4 class="commons-media-h">Arquivos</h4><div class="commons-files">${media.files.map((m) => `<a class="ghost-button small" href="/api/commons/file-asset?path=${encodeURIComponent(f.path)}&name=${encodeURIComponent(m.name)}" download>${icon('download')}${escapeHtml(m.name)}${m.size != null ? ` <small>${(m.size / 1024).toFixed(1)} KB</small>` : ''}</a>`).join('')}</div>` : ''}
      </div>`
        : '';
    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal wide-modal commons-file-modal" role="dialog" aria-modal="true" aria-label="Cápsula">
          <div class="modal-head">
            <div><p class="eyebrow">Cápsula</p><h2><code>${escapeHtml(f.path)}</code></h2></div>
            <button class="icon-button" data-action="closeCommonsFile" aria-label="Fechar">${icon('x')}</button>
          </div>
          <div class="commons-file-grid">
            <div class="commons-file-main">${bodyHtml}${mediaHtml}</div>
            <aside class="commons-file-side">
              <div class="side-block"><h4>Aprovações</h4><ul class="hist-list">${apprHtml}</ul></div>
              <div class="side-block"><h4>Histórico (git)</h4><ul class="hist-list">${histHtml}</ul></div>
            </aside>
          </div>
          <div class="row-actions">
            ${f.reviewMode && canManage && !f.loading && !f.error ? `<button class="primary-button" data-action="commonsModalValidate" data-path="${escapeHtml(f.path)}"${permissionAttrs('curar')}>${icon('check')}Validar revisão (manter em dia)</button>` : ''}
            ${
              canManage && !f.tooLarge && !f.loading && !f.error
                ? f.editing
                  ? `<button class="primary-button" data-action="saveCommonsFile" ${f.saving ? 'disabled' : permissionAttrs('curar')}>${icon('check')}${f.saving ? 'Salvando…' : 'Salvar'}</button><button class="ghost-button" data-action="toggleCommonsEdit" ${f.saving ? 'disabled' : ''}>Cancelar edição</button>`
                  : `<button class="ghost-button" data-action="toggleCommonsEdit"${permissionAttrs('curar')}>${icon('spark')}Editar</button><button class="ghost-button" data-action="commonsProcessMedia" data-path="${escapeHtml(f.path)}" ${f.processing ? 'disabled' : permissionAttrs('curar')}>${icon('spark')}${f.processing ? 'Processando…' : 'Processar mídia (IA)'}</button>`
                : ''
            }
            <button class="ghost-button" data-action="closeCommonsFile">Fechar</button>
          </div>
        </section>
      </div>`;
  }

  function renderDocs() {
    const d = state.docs;
    if (!d || (d.loading && !(d.list && d.list.length))) {
      return '<section class="panel"><p class="muted">Carregando documentação…</p></section>';
    }
    if (d.error) {
      return `<section class="panel"><div class="form-alert form-alert-error">${escapeHtml(d.error)}</div></section>`;
    }
    const admin = isAdmin();
    const list = d.list || [];
    const filter = (d.filter || '').trim().toLowerCase();

    // README is the index — pinned at the top, outside the numbered sections.
    const isReadme = (p) => /(^|\/)readme\.md$/i.test(p);
    const readmeDoc = list.find((doc) => isReadme(doc.path));
    const rest = list.filter((doc) => !isReadme(doc.path));

    // Group by `section` (frontmatter); ungrouped → "Outros" (always sorted last).
    const OUTROS = 'Outros';
    const groups = new Map();
    for (const doc of rest) {
      const name = (doc.section && String(doc.section).trim()) || OUTROS;
      if (!groups.has(name)) groups.set(name, { name, sectionOrder: null, docs: [] });
      const g = groups.get(name);
      g.docs.push(doc);
      const so = Number(doc.sectionOrder);
      if (Number.isFinite(so)) g.sectionOrder = g.sectionOrder == null ? so : Math.min(g.sectionOrder, so);
    }
    const sections = [...groups.values()].sort((a, b) => {
      if (a.name === OUTROS) return 1;
      if (b.name === OUTROS) return -1;
      const ao = a.sectionOrder == null ? Infinity : a.sectionOrder;
      const bo = b.sectionOrder == null ? Infinity : b.sectionOrder;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
    for (const g of sections) {
      g.docs.sort((a, b) => {
        const ao = Number.isFinite(Number(a.order)) ? Number(a.order) : Infinity;
        const bo = Number.isFinite(Number(b.order)) ? Number(b.order) : Infinity;
        if (ao !== bo) return ao - bo;
        return (a.title || '').localeCompare(b.title || '', 'pt-BR');
      });
    }

    // Collapse state: a Set of open section names. Start with everything collapsed —
    // only the selected doc's own section (if any) opens; the user toggles the rest.
    if (!(d.openSections instanceof Set)) {
      d.openSections = new Set();
      const selDoc = list.find((x) => x.path === d.selectedPath);
      const selSection = selDoc && selDoc.section ? String(selDoc.section).trim() : '';
      if (selSection) d.openSections.add(selSection);
    }

    const rowHtml = (doc, label) => {
      const haystack = `${doc.title} ${doc.path} ${doc.section || ''}`.toLowerCase();
      const hidden = filter && !haystack.includes(filter);
      const fname = String(doc.path).replace(/.*\//, '');
      return `
        <button class="repo-item doc-row ${d.selectedPath === doc.path ? 'active' : ''}" data-action="docSelect" data-path="${escapeHtml(doc.path)}" data-haystack="${escapeHtml(haystack)}"${hidden ? ' style="display:none"' : ''}>
          ${label ? `<span class="doc-num">${escapeHtml(label)}</span>` : icon('book')}
          <span class="repo-item-main"><strong>${escapeHtml(doc.title)}</strong><small class="doc-filename">${escapeHtml(fname)}</small></span>
        </button>`;
    };

    const readmeRow = readmeDoc ? rowHtml(readmeDoc, '') : '';
    const sectionsHtml = sections
      .map((g, si) => {
        const num = si + 1;
        const open = d.openSections.has(g.name);
        const rows = g.docs.map((doc, di) => rowHtml(doc, `${num}.${di + 1}`)).join('');
        return `
        <div class="doc-section" data-section="${escapeHtml(g.name)}">
          <button class="doc-section-head" data-action="docSection" data-section="${escapeHtml(g.name)}" aria-expanded="${open ? 'true' : 'false'}">
            <span class="doc-section-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
            <span class="doc-section-title">${escapeHtml(`${num}. ${g.name}`)}</span>
            <span class="doc-section-count">${g.docs.length}</span>
          </button>
          <div class="doc-section-body ${open ? '' : 'is-collapsed'}">${rows}</div>
        </div>`;
      })
      .join('');
    const tocHtml = readmeRow + sectionsHtml || '<p class="muted">Nenhum documento ainda.</p>';

    const newForm = d.creating
      ? `
      <div class="doc-new-form">
        <p class="eyebrow">Novo documento</p>
        <input class="doc-new-input" data-doc-new-title value="${escapeHtml(d.newTitle || '')}" placeholder="Título (ex.: Guia de catálogos)" aria-label="Título do documento">
        <input class="doc-new-input" data-doc-new-path value="${escapeHtml(d.newPath || '')}" placeholder="nome-do-arquivo.md" aria-label="Nome do arquivo">
        ${d.createError ? `<div class="form-alert form-alert-error">${escapeHtml(d.createError)}</div>` : ''}
        <div class="doc-new-actions">
          <button class="primary-button small" data-action="createDoc"${d.createSaving ? ' disabled' : ''}>${d.createSaving ? 'Criando…' : 'Criar'}</button>
          <button class="ghost-button small" data-action="docCancelNew">Cancelar</button>
        </div>
      </div>`
      : '';

    let body;
    if (d.editing) {
      body = `
        <div class="doc-edit">
          <textarea class="doc-editor" data-doc-editor spellcheck="false" aria-label="Editar markdown">${escapeHtml(d.draft != null ? d.draft : d.content)}</textarea>
          ${d.editError ? `<div class="form-alert form-alert-error">${escapeHtml(d.editError)}</div>` : ''}
          <div class="doc-edit-actions">
            <button class="primary-button small" data-action="saveDoc"${d.saving ? ' disabled' : ''}>${icon('check')}${d.saving ? 'Salvando…' : 'Salvar'}</button>
            <button class="ghost-button small" data-action="docCancelEdit">${icon('x')}Cancelar</button>
            <button class="ghost-button small" data-action="docInsertImage"${d.uploadingImg ? ' disabled' : ''}>${icon('plus')}${d.uploadingImg ? 'Enviando…' : 'Inserir imagem'}</button>
            <input type="file" data-doc-image-input accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" hidden>
            <span class="doc-edit-hint">Markdown · Ctrl+Enter para salvar</span>
          </div>
        </div>`;
    } else if (d.fileLoading) {
      body = '<p class="muted">Carregando…</p>';
    } else if (d.fileError) {
      body = `<div class="form-alert form-alert-error">${escapeHtml(d.fileError)}</div>`;
    } else if (d.tooLarge) {
      body = '<p class="muted">Documento muito grande para exibir aqui.</p>';
    } else if (d.rawView) {
      body = `<pre class="doc-raw">${escapeHtml(d.content)}</pre>`;
    } else {
      body = `<article class="doc-body">${renderMarkdownSafe(stripDocFrontmatter(d.content))}</article>`;
    }

    const hasDoc = !!d.selectedPath && !d.fileError;
    const selectedDoc = (d.list || []).find((x) => x.path === d.selectedPath);
    const canDownload = !!(selectedDoc && selectedDoc.downloadable);
    const toolbar =
      hasDoc || d.editing || d.expanded
        ? `
      <div class="doc-toolbar">
        <div class="doc-seg" role="group" aria-label="Modo de exibição">
          <button class="doc-seg-btn ${!d.rawView ? 'active' : ''}" data-action="docView" data-view="formatted"${d.editing ? ' disabled' : ''}>${icon('book')}Formatado</button>
          <button class="doc-seg-btn ${d.rawView ? 'active' : ''}" data-action="docView" data-view="code"${d.editing ? ' disabled' : ''}>${icon('file')}Código</button>
        </div>
        <div class="doc-toolbar-actions">
          ${canDownload && hasDoc && !d.editing ? `<button class="ghost-button small" data-action="docDownload">${icon('file')}Baixar TXT</button>` : ''}
          ${admin && hasDoc && !d.editing ? `<button class="ghost-button small" data-action="docEdit">${icon('edit')}Editar</button>` : ''}
          <button class="ghost-button small" data-action="docsToggleExpand" title="${d.expanded ? 'Mostrar a lista de documentos' : 'Esconder a lista e maximizar a leitura'}">${icon(d.expanded ? 'menu' : 'expand')}${d.expanded ? 'Mostrar lista' : 'Expandir'}</button>
        </div>
      </div>`
        : '';

    return `
      <section class="docs-view ${d.expanded ? 'is-expanded' : ''}"${d.width ? ` style="--docs-w:${d.width}px"` : ''}>
        <div class="docs-resize" data-docs-resize title="Arraste para redimensionar a lista" aria-hidden="true"></div>
        <aside class="docs-list">
          <div class="docs-list-head">
            <div class="docs-list-head-left">
              <p class="eyebrow">Documentos</p>
              <button class="icon-button-sm" data-action="docsExpandAll" title="Expandir todas as seções" aria-label="Expandir todas as seções">${icon('plus')}</button>
              <button class="icon-button-sm" data-action="docsCollapseAll" title="Recolher todas as seções" aria-label="Recolher todas as seções">${icon('minus')}</button>
            </div>
            <div class="docs-list-head-actions">
              ${admin ? `<button class="icon-button-sm" data-action="docsPublishSkill" title="Converter a documentação em skill: uma cápsula por página + a skill espinha (balde/documentacao) — vai para a Fila de curadoria"${d.publishingSkill ? ' disabled' : ''}>${icon('spark')}</button>` : ''}
              ${admin ? `<button class="ghost-button small" data-action="docNew">${icon('plus')}Novo</button>` : ''}
            </div>
          </div>
          ${newForm}
          <input class="explore-search" data-docs-search value="${escapeHtml(d.filter || '')}" placeholder="Buscar documento…" aria-label="Buscar documento">
          <div class="docs-toc" data-docs-scroll>${tocHtml}</div>
          <div class="explore-no-results" hidden>Nenhum documento encontrado.</div>
        </aside>
        <div class="docs-main">
          <div class="panel doc-panel">
            ${toolbar}
            ${body}
          </div>
          ${
            !d.editing && d.history && d.history.length
              ? `<div class="panel doc-history">
            <button class="doc-history-head" data-action="docsToggleHistory" aria-expanded="${d.historyOpen ? 'true' : 'false'}">
              <span class="doc-history-chevron" aria-hidden="true">${d.historyOpen ? '▾' : '▸'}</span>
              <h3>Histórico</h3>
              <span class="doc-history-count">${d.history.length}</span>
            </button>
            ${d.historyOpen ? renderRepoHistory(d.history) : ''}
          </div>`
              : ''
          }
        </div>
      </section>`;
  }

  return {
    openCommons,
    refreshCommonsSilent,
    commonsAction,
    commonsRunEval,
    commonsSetCadence,
    commonsSummarizeAll,
    CADENCE_LABEL_PT,
    commonsFreshCell,
    commonsPeopleCell,
    startCommonsColResize,
    renderCommons,
    commonsSetPage,
    commonsSetFilter,
    fmtDateTime,
    isLocalShell,
    openCommonsFile,
    commonsModalValidate,
    commonsProcessMedia,
    closeCommonsFile,
    toggleCommonsEdit,
    saveCommonsFile,
    renderCommonsFileModal,
    renderDocs
  };
}
