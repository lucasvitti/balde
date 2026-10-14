export function createContextReviewFeature({
  readJsonResponse,
  toast,
  loadExploreGraph,
  state,
  renderShell,
  escapeHtml,
  icon,
  isBaldeAdmin,
  roleAllows,
  permissionAttrs,
  isCurator
}) {
  async function governAction(id, endpoint, body) {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(id)}/govern/${endpoint}`, {
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

  async function curatorKeepGreen(id, path) {
    const d = await governAction(id, 'review', path ? { path } : {});
    if (d) {
      toast(path ? 'Conceito revisado.' : 'Skill revisada.', 'success');
      await loadExploreGraph(id);
    }
  }

  async function curatorKeepAllGreen(id) {
    const due =
      (state.explore &&
        state.explore.graph &&
        state.explore.graph.governance &&
        state.explore.graph.governance.auditDue) ||
      [];
    if (!due.length) {
      toast('Nada pendente de auditoria.');
      return;
    }
    const d = await governAction(id, 'review', { paths: due });
    if (d) {
      toast(`${due.length} conceito(s) mantido(s) em dia.`, 'success');
      await loadExploreGraph(id);
    }
  }

  async function curatorRunEval(id, path) {
    toast('Rodando eval com IA…');
    const d = await governAction(id, 'eval-run', { path });
    if (d) {
      const overall = d.evalStatus && d.evalStatus.overall;
      toast(`Eval: ${overall === 'fail' ? 'falhou' : 'passou'}.`, overall === 'fail' ? 'warning' : 'success');
      await loadExploreGraph(id);
    }
  }
  async function commonsMigratePlan(id) {
    if (!state.explore) return;
    state.explore.migrate = { loading: true, error: null, plan: null, selected: new Set(), edits: {} };
    renderShell();
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(id)}/commons/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      const data = await readJsonResponse(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      const moves = Array.isArray(data.moves) ? data.moves : [];
      state.explore.migrate = {
        loading: false,
        error: null,
        plan: { moves, keep: Array.isArray(data.keep) ? data.keep : [] },
        selected: new Set(moves.map((m) => m.path)),
        edits: {}
      };
    } catch (error) {
      state.explore.migrate = {
        loading: false,
        error: error.message || 'Falha ao planejar a migração.',
        plan: null,
        selected: new Set(),
        edits: {}
      };
    }
    renderShell();
  }

  function commonsMigrateToggle(path) {
    const m = state.explore && state.explore.migrate;
    if (!m || !m.selected) return;
    if (m.selected.has(path)) m.selected.delete(path);
    else m.selected.add(path);
    renderShell();
  }

  // Edit-only: store the new destination WITHOUT re-render (keeps input focus while typing).
  function commonsMigrateEditTo(path, val) {
    const m = state.explore && state.explore.migrate;
    if (!m) return;
    m.edits = m.edits || {};
    m.edits[path] = val;
  }

  function commonsMigrateCancel() {
    if (state.explore) state.explore.migrate = null;
    renderShell();
  }

  async function commonsMigrateApply(id) {
    const m = state.explore && state.explore.migrate;
    if (!m || !m.plan) return;
    const moves = m.plan.moves
      .filter((mv) => m.selected.has(mv.path))
      .map((mv) => {
        const edited = m.edits && m.edits[mv.path] != null && String(m.edits[mv.path]).trim();
        return { from: mv.path, to: edited ? String(m.edits[mv.path]).trim() : mv.to };
      });
    if (!moves.length) {
      toast('Selecione ao menos um conceito.', 'warning');
      return;
    }
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(id)}/commons/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ moves })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      const moved = (data.moved || []).length;
      const skipped = (data.skipped || []).length;
      toast(
        `${moved} cápsula(s) criada(s)${skipped ? `, ${skipped} ignorado(s)` : ''}.`,
        moved ? 'success' : 'warning'
      );
      state.explore.migrate = null;
      await loadExploreGraph(id);
    } catch (error) {
      toast(error.message || 'Falha ao aplicar a migração.', 'warning');
    }
  }

  function govStatusBadge(s) {
    const label =
      {
        green: 'em dia',
        'due-soon': 'revisar em breve',
        overdue: 'auditoria vencida',
        never: 'nunca revisado',
        closed: 'fechada'
      }[s] || s;
    return `<span class="gov-badge gov-${s}">${label}</span>`;
  }
  // Depreciação DERIVADA (critérios de Config › Pontuação): chip extra ao lado do status.
  function govDeprecatedChip(gv) {
    if (!gv || !gv.deprecated) return '';
    const reasons = ((gv.deprecation && gv.deprecation.reasons) || []).join('; ');
    return `<span class="gov-badge gov-deprecated" title="${escapeHtml(reasons || 'critérios de depreciação')}">depreciada</span>`;
  }
  function govEvalBadge(e) {
    if (!e || !e.overall) return '<span class="gov-badge gov-eval-none">sem eval</span>';
    const label = { pass: 'eval ok', fail: 'eval falhou', pending: 'eval pendente' }[e.overall] || e.overall;
    return `<span class="gov-badge gov-eval-${e.overall}">${label}</span>`;
  }
  // Explorar o corpus é somente leitura: a cadência do conceito é TEXTO fixo (não editável aqui).
  function govCadenceText(gv) {
    const label =
      { weekly: 'semanal', monthly: 'mensal', quarterly: 'trimestral', yearly: 'anual' }[gv && gv.cadence] ||
      (gv && gv.cadence) ||
      '—';
    return gv && gv.cadenceLocked
      ? `<span class="cadence-locked" title="Definida por ${escapeHtml(gv.cadenceLockedBy || 'criador')}">${icon('shield')}${escapeHtml(label)}</span>`
      : escapeHtml(label);
  }

  // S5: the curator eval panel — per-concept freshness + eval + one-click keep-green / run-eval.
  function renderCuratorPanel(ex, canManage) {
    if (ex.graphLoading) return '<div class="repo-empty">Carregando curadoria…</div>';
    if (ex.graphError) return `<div class="repo-empty">${escapeHtml(ex.graphError)}</div>`;
    if (!ex.graph) return '<div class="repo-empty">Abra a aba para carregar a curadoria.</div>';
    const id = ex.selectedId;
    const g = ex.graph.governance || { counts: {}, auditDue: [], evalFails: [] };
    const files = ex.graph.files || [];
    const auditN = (g.auditDue || []).length;
    const failN = (g.evalFails || []).length;
    const canCapsule = roleAllows('curar');
    const rows = files
      .map((f) => {
        const gv = f.governance || {};
        return `<tr>
        <td><code>${escapeHtml(f.path)}</code>${gv.ownerInherited ? '' : ` <span class="gov-owner" title="owner próprio">${escapeHtml(gv.owner || '')}</span>`}</td>
        <td data-label="Frescor">${govStatusBadge(gv.status)}</td>
        <td data-label="Cadência">${govCadenceText(gv)}</td>
        <td data-label="Eval">${govEvalBadge(gv.eval)}</td>
        <td class="gov-actions">${canCapsule ? `<button class="ghost-button tiny" data-action="migrateToCapsule" data-id="${escapeHtml(id)}" data-path="${escapeHtml(f.path)}" title="Migrar p/ Cápsula — cria uma cápsula pré-preenchida a partir deste arquivo"${permissionAttrs('curar')}>${icon('spark')}Cápsula</button>` : ''}</td></tr>`;
      })
      .join('');
    // Corpus Explorer is read-only: the Curadoria tab only REPORTS status. The single
    // per-row "Migrar p/ Cápsula" is the exception — it navigates to the capsule create
    // wizard (prefilled), a create flow, not an inline write.
    return `
      <div class="curator-panel">
        <div class="curator-head">
          <div class="curator-head-info">
            ${govStatusBadge(g.overallStatus || 'green')}
            <span class="gov-counts">${(g.counts && g.counts.green) || 0} em dia · ${auditN} auditoria pendente${failN ? ` · ${failN} eval falhou` : ''}</span>
          </div>
        </div>
        <table class="curator-table">
          <thead><tr><th>Conceito</th><th>Frescor</th><th>Cadência</th><th>Eval</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="muted">Sem conceitos.</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  // D4 UI: the AI-assisted commons migration (plan → review → apply), rendered inline under the
  // curator table. Proposes reusable concepts to move into commons/ (shared across skills); the
  // curator toggles/edits destinations and applies. Apply moves the files + relinks SKILL.md.
  function renderMigratePanel(ex, id) {
    const m = ex.migrate;
    if (!m) return '';
    if (m.loading) return '<div class="migrate-panel"><div class="repo-empty">Planejando migração com IA…</div></div>';
    if (m.error)
      return `<div class="migrate-panel"><div class="form-alert form-alert-error">${escapeHtml(m.error)}</div><div class="migrate-actions"><button class="ghost-button small" data-action="commonsMigrateCancel">Fechar</button></div></div>`;
    const p = m.plan || { moves: [], keep: [] };
    if (!p.moves.length) {
      return `<div class="migrate-panel"><div class="migrate-head"><strong>${icon('spark')}Plano de migração p/ Cápsulas</strong></div><p class="wizard-hint">A IA não encontrou conceitos claramente reutilizáveis para virar cápsula. ${p.keep.length} conceito(s) permanecem na skill.</p><div class="migrate-actions"><button class="ghost-button small" data-action="commonsMigrateCancel">Fechar</button></div></div>`;
    }
    const selCount = m.selected ? m.selected.size : 0;
    const rows = p.moves
      .map((mv) => {
        const checked = m.selected && m.selected.has(mv.path);
        const to = m.edits && m.edits[mv.path] != null ? m.edits[mv.path] : mv.to;
        return `<li class="migrate-row">
        <label class="migrate-check"><input type="checkbox" data-action="commonsMigrateToggle" data-path="${escapeHtml(mv.path)}" ${checked ? 'checked' : ''}><code>${escapeHtml(mv.path)}</code></label>
        <span class="migrate-arrow">→</span>
        <input type="text" class="migrate-to" data-commons-migrate-to data-path="${escapeHtml(mv.path)}" value="${escapeHtml(to)}" spellcheck="false" autocapitalize="off" aria-label="Destino nas Cápsulas">
        ${mv.rationale ? `<span class="migrate-rationale" title="${escapeHtml(mv.rationale)}">${escapeHtml(mv.rationale)}</span>` : ''}
      </li>`;
      })
      .join('');
    return `
      <div class="migrate-panel">
        <div class="migrate-head"><strong>${icon('spark')}Plano de migração p/ Cápsulas</strong><small>${p.moves.length} sugerido(s) · ${p.keep.length} permanecem</small></div>
        <p class="wizard-hint">Revise os conceitos reutilizáveis que a IA sugere mover para o <code>commons/</code> (compartilhável entre skills). Ajuste o destino se quiser; o SKILL.md será religado aos conceitos movidos.</p>
        <ul class="migrate-list">${rows}</ul>
        <div class="migrate-actions">
          <button class="primary-button small" data-action="commonsMigrateApply" data-id="${escapeHtml(id)}"${selCount ? '' : ' disabled'}>${icon('check')}Aplicar (${selCount})</button>
          <button class="ghost-button small" data-action="commonsMigrateCancel">Cancelar</button>
        </div>
      </div>`;
  }

  async function selectExploreFile(path) {
    if (!state.explore || !state.explore.bundle) {
      return;
    }
    state.explore.file = path;
    // SKILL.md body ships inside the bundle; other files are fetched on demand.
    if (path === 'SKILL.md') {
      state.explore.fileContent = null;
      renderShell();
      return;
    }
    state.explore.fileContent = { loading: true };
    renderShell();
    try {
      const res = await fetch(
        `/api/explore/file?skill=${encodeURIComponent(state.explore.selectedId)}&path=${encodeURIComponent(path)}`
      );
      const data = await res.json().catch(() => ({}));
      state.explore.fileContent = res.ok && data.ok ? data : { error: data.error || `HTTP ${res.status}` };
    } catch (error) {
      state.explore.fileContent = { error: error.message || 'Erro de rede.' };
    }
    renderShell();
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return {
    curatorKeepGreen,
    curatorKeepAllGreen,
    curatorRunEval,
    commonsMigratePlan,
    commonsMigrateToggle,
    commonsMigrateEditTo,
    commonsMigrateCancel,
    commonsMigrateApply,
    govStatusBadge,
    govDeprecatedChip,
    govEvalBadge,
    renderCuratorPanel,
    selectExploreFile,
    formatBytes
  };
}
