// Governança › Arquivadas (D6, 2.0.19): as skills e cápsulas que saíram do corpus ativo, com quem arquivou e
// quando, e a restauração, que devolve cada uma ao mesmo id como estava. Só curadores veem a tela; restaurar
// segue a regra única (src/security/permissions.mjs), então sem edição na pasta do balde o botão fica
// desabilitado com o motivo.
export function createArchiveViewFeature({
  state,
  escapeHtml,
  icon,
  toast,
  renderShell,
  readJsonResponse,
  fmtDateTime,
  permissionAttrs,
  permissionNote,
  reloadSkills
}) {
  async function fetchArchived(path) {
    const res = await fetch(path);
    const data = await readJsonResponse(res);
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
    return data.archived || [];
  }

  async function openArchived() {
    state.archived = { loading: true, skills: [], capsules: [], error: null, busy: null };
    renderShell();
    try {
      const [skills, capsules] = await Promise.all([
        fetchArchived('/api/skills/archived'),
        fetchArchived('/api/commons/archived')
      ]);
      state.archived = { loading: false, skills, capsules, error: null, busy: null };
    } catch (error) {
      state.archived = {
        loading: false,
        skills: [],
        capsules: [],
        error: error.message || 'Erro de rede.',
        busy: null
      };
    }
    renderShell();
  }

  function archivedRow(kind, item, busy) {
    const who = item.archivedBy && (item.archivedBy.name || item.archivedBy.email);
    const when = item.legacy
      ? 'arquivada antes da 2.0.19, sem registro de quem ou quando'
      : `arquivada${item.archivedAt ? ` em ${escapeHtml(fmtDateTime(item.archivedAt))}` : ''}${who ? ` por ${escapeHtml(who)}` : ''}`;
    const target = item.archivedId !== item.id ? ` · volta para <code>${escapeHtml(item.id)}</code>` : '';
    const isBusy = busy === `${kind}:${item.archivedId}`;
    return `
      <li class="archived-item">
        <div class="archived-item-main">
          <strong>${escapeHtml(item.id)}</strong>
          <small>${when}${target}</small>
        </div>
        <button class="ghost-button small" data-action="restoreArchived" data-kind="${kind}" data-id="${escapeHtml(item.archivedId)}"${isBusy ? ' disabled' : permissionAttrs('curar')}>${icon('history')}${isBusy ? 'Restaurando…' : 'Restaurar'}</button>
      </li>`;
  }

  function archivedSection(title, kind, items, busy) {
    return `
      <section class="archived-section">
        <h2>${title} <span class="muted">(${items.length})</span></h2>
        ${
          items.length
            ? `<ul class="archived-list">${items.map((item) => archivedRow(kind, item, busy)).join('')}</ul>`
            : `<p class="repo-empty">Nenhuma ${kind === 'skill' ? 'skill' : 'cápsula'} arquivada.</p>`
        }
      </section>`;
  }

  function renderArchived() {
    const a = state.archived;
    const intro =
      '<p class="queue-intro">O que é arquivado sai do corpus ativo: chat, MCP e buscas deixam de ver. Nada é apagado; restaurar devolve cada item ao mesmo lugar, como estava.</p>';
    if (!a || a.loading)
      return `<section class="archived-view">${intro}<p class="repo-empty">Carregando…</p></section>`;
    if (a.error)
      return `<section class="archived-view">${intro}<p role="alert">Falha ao carregar: ${escapeHtml(a.error)}</p></section>`;
    return `
      <section class="archived-view">
        ${intro}
        ${permissionNote('curar')}
        ${archivedSection('Skills', 'skill', a.skills, a.busy)}
        ${archivedSection('Cápsulas', 'capsule', a.capsules, a.busy)}
      </section>`;
  }

  async function restoreArchived(kind, archivedId) {
    if (!state.archived || state.archived.busy) return;
    state.archived.busy = `${kind}:${archivedId}`;
    renderShell();
    try {
      const res = await fetch(kind === 'skill' ? '/api/skills/restore' : '/api/commons/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archivedId })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      toast(`${kind === 'skill' ? 'Skill' : 'Cápsula'} "${data.id}" restaurada.`, 'success');
      // As listas em cache voltam a ser lidas: a skill no catálogo, a cápsula no explorador.
      if (kind === 'skill') await reloadSkills();
      else if (state.explore) state.explore.commonsData = null;
    } catch (error) {
      toast(error.message || 'Falha ao restaurar.', 'warning');
    }
    await openArchived();
  }

  return { openArchived, renderArchived, restoreArchived };
}
