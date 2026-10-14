export function createBuddiesFeature({
  state,
  renderShell,
  escapeHtml,
  pluralize,
  icon,
  toast,
  BUDDY_POSE_VOCAB,
  option,
  optimizePoseImage,
  BUDDY_POSE_EXT_LIST,
  readFileAsBase64
}) {
  async function openBuddies() {
    if (!state.buddies) {
      state.buddies = {
        list: [],
        selectedId: null,
        detail: null,
        canCreate: false,
        loading: false,
        error: null,
        uploadModal: null,
        collapsedGroups: loadBuddyCollapsedGroups()
      };
    }
    state.buddies.loading = true;
    state.buddies.error = null;
    renderShell();
    try {
      const res = await fetch('/api/buddies', { headers: { accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        state.buddies.error = data.error || `Falha ao carregar (HTTP ${res.status}).`;
      } else {
        state.buddies.list = data.buddies || [];
        state.buddies.canCreate = Boolean(data.canCreateBuddy);
        state.buddies.isAdmin = Boolean(data.isAdmin);
        state.buddies.globalTheme = data.globalTheme || 'regular';
        state.buddies.themes = data.themes || [];
        if (!state.buddies.selectedId && state.buddies.list.length) {
          state.buddies.selectedId = state.buddies.list[0].id;
        }
      }
    } catch (error) {
      state.buddies.error = error.message || 'Erro de rede.';
    }
    state.buddies.loading = false;
    renderShell();
    if (state.buddies.selectedId) {
      await loadBuddyDetail(state.buddies.selectedId);
    }
  }

  async function loadBuddyDetail(id) {
    if (!state.buddies) {
      return;
    }
    state.buddies.selectedId = id;
    state.buddies.detail = { loading: true };
    renderShell();
    try {
      const res = await fetch(`/api/buddies/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      state.buddies.detail = res.ok && data.ok ? data : { error: data.error || `HTTP ${res.status}` };
    } catch (error) {
      state.buddies.detail = { error: error.message || 'Erro de rede.' };
    }
    renderShell();
  }

  // Buddies are grouped by a free-text `group` label (Comercial / RH / Financeiro / …);
  // empty = "Geral". These seed the input's suggestions; authors can type any label.
  const BUDDY_GROUPS_SEED = ['Geral', 'Comercial', 'RH', 'Financeiro'];
  function buddyGroupOf(buddy) {
    return (buddy && buddy.group && String(buddy.group).trim()) || 'Geral';
  }
  function buddyGroupSuggestions() {
    const set = new Set(BUDDY_GROUPS_SEED);
    ((state.buddies && state.buddies.list) || []).forEach((b) => set.add(buddyGroupOf(b)));
    return [...set];
  }
  function buddyGroupDatalist(id) {
    return `<datalist id="${id}">${buddyGroupSuggestions()
      .map((g) => `<option value="${escapeHtml(g)}"></option>`)
      .join('')}</datalist>`;
  }
  function loadBuddyCollapsedGroups() {
    try {
      return JSON.parse(localStorage.getItem('balde.buddyCollapsedGroups') || '{}') || {};
    } catch (error) {
      return {};
    }
  }
  function saveBuddyCollapsedGroups(obj) {
    try {
      localStorage.setItem('balde.buddyCollapsedGroups', JSON.stringify(obj || {}));
    } catch (error) {
      /* ignore */
    }
  }
  function toggleBuddyGroup(group) {
    const bud = state.buddies;
    if (!bud) {
      return;
    }
    bud.collapsedGroups = bud.collapsedGroups || {};
    if (bud.collapsedGroups[group]) {
      delete bud.collapsedGroups[group];
    } else {
      bud.collapsedGroups[group] = true;
    }
    saveBuddyCollapsedGroups(bud.collapsedGroups);
    renderShell();
  }
  function expandAllBuddyGroups() {
    const bud = state.buddies;
    if (!bud) {
      return;
    }
    bud.collapsedGroups = {};
    saveBuddyCollapsedGroups(bud.collapsedGroups);
    renderShell();
  }
  function collapseAllBuddyGroups() {
    const bud = state.buddies;
    if (!bud) {
      return;
    }
    const collapsed = {};
    (bud.list || []).forEach((b) => {
      collapsed[buddyGroupOf(b)] = true;
    });
    bud.collapsedGroups = collapsed;
    saveBuddyCollapsedGroups(collapsed);
    renderShell();
  }
  // Set the group field of whichever buddy modal is open (quick-pick from the chips).
  function pickBuddyGroup(group) {
    const bud = state.buddies;
    if (!bud) {
      return;
    }
    if (bud.uploadModal) {
      bud.uploadModal.group = group;
    } else if (bud.editModal) {
      bud.editModal.group = group;
    }
    renderShell();
  }
  // Buddy list, grouped into collapsible sections by `group` (Geral first, then A→Z).
  function renderBuddyGroups(bud) {
    const list = bud.list || [];
    const collapsed = bud.collapsedGroups || {};
    const groups = new Map();
    for (const b of list) {
      const g = buddyGroupOf(b);
      if (!groups.has(g)) {
        groups.set(g, []);
      }
      groups.get(g).push(b);
    }
    const names = [...groups.keys()].sort((a, b) => {
      if (a === 'Geral') {
        return -1;
      }
      if (b === 'Geral') {
        return 1;
      }
      return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
    });
    return names
      .map((g) => {
        const items = groups
          .get(g)
          .slice()
          .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }));
        const isCollapsed = !!collapsed[g];
        const cards = items
          .map(
            (buddy) => `
        <button class="buddy-card ${bud.selectedId === buddy.id ? 'active' : ''}" data-action="buddySelect" data-id="${escapeHtml(buddy.id)}">
          <img class="buddy-thumb" src="/api/buddies/${encodeURIComponent(buddy.id)}/poses/${encodeURIComponent(buddy.default_pose || 'idle')}" alt="">
          <span class="buddy-card-main">
            <strong>${escapeHtml(buddy.name)}</strong>
            <small>${pluralize(buddy.poses.length, 'pose')}</small>
          </span>
        </button>`
          )
          .join('');
        return `
        <div class="buddy-group ${isCollapsed ? 'is-collapsed' : ''}">
          <button class="buddy-group-header" data-action="toggleBuddyGroup" data-group="${escapeHtml(g)}" aria-expanded="${isCollapsed ? 'false' : 'true'}">
            ${icon('chevron', 'buddy-group-caret')}
            <span class="buddy-group-name">${escapeHtml(g)}</span>
            <span class="buddy-group-count">${items.length}</span>
          </button>
          <div class="buddy-group-items">${cards}</div>
        </div>`;
      })
      .join('');
  }

  // Admin-only global theme picker (top of the buddy library). Poses + temperaments
  // swap to this theme for every buddy (unless a buddy pins its own via Editar).
  function renderBuddyThemePicker(bud) {
    const themes = ['regular', ...(bud.themes || [])];
    const active = bud.globalTheme || 'regular';
    const label = (t) => (t === 'regular' ? 'Regular' : t);
    return `<span class="buddy-theme-picker" title="Tema global — vale para todos os buddies (um buddy pode sobrescrever no Editar)">
      ${icon('smiley')}<span class="buddy-theme-picker-label">Tema</span>
      <select data-buddy-theme-select aria-label="Tema global dos buddies">
        ${themes.map((t) => `<option value="${escapeHtml(t)}" ${t === active ? 'selected' : ''}>${escapeHtml(label(t))}</option>`).join('')}
      </select>
      <button class="ghost-button small" data-action="applyGlobalBuddyTheme">Aplicar</button>
    </span>`;
  }
  async function applyGlobalBuddyTheme() {
    const sel = document.querySelector('[data-buddy-theme-select]');
    if (!sel) {
      return;
    }
    try {
      const res = await fetch('/api/admin/buddy-theme', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: sel.value })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast(data.error || `Falha ao aplicar (HTTP ${res.status}).`, 'warning');
        return;
      }
      toast(`Tema global: ${data.active === 'regular' ? 'Regular' : data.active}.`, 'success');
      await openBuddies();
      if (state.buddies && state.buddies.selectedId) {
        await loadBuddyDetail(state.buddies.selectedId);
      }
    } catch (error) {
      toast(error.message || 'Erro de rede.', 'warning');
    }
  }

  function renderBuddies() {
    const bud = state.buddies || {};
    const list = bud.list || [];
    const cards = renderBuddyGroups(bud);

    let main;
    if (bud.loading && !list.length) {
      main = '<div class="repo-empty">Carregando…</div>';
    } else if (bud.error) {
      main = `<div class="repo-empty">${escapeHtml(bud.error)}</div>`;
    } else if (!list.length) {
      main = `<div class="repo-empty">Nenhum buddy ainda.${bud.canCreate ? ' Crie o primeiro.' : ''}</div>`;
    } else {
      main = renderBuddyDetail(bud);
    }

    return `
      <section class="panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Avatares · biblioteca</p>
            <h2>${pluralize(list.length, 'buddy', 'buddies')}</h2>
          </div>
          <div class="buddy-header-actions">
            ${bud.isAdmin ? renderBuddyThemePicker(bud) : ''}
            ${
              bud.canCreate
                ? `<button class="primary-button" data-action="openBuddyUpload">${icon('upload')}Novo buddy</button>`
                : '<span class="readonly-tag">Somente leitura</span>'
            }
          </div>
        </div>
        <div class="explore-layout">
          <aside class="repo-list" data-buddy-scroll>
            ${
              list.length
                ? `<div class="buddy-list-toolbar">
              <button class="icon-button-sm" data-action="expandAllBuddyGroups" title="Expandir todos os grupos" aria-label="Expandir todos os grupos">${icon('plus')}</button>
              <button class="icon-button-sm" data-action="collapseAllBuddyGroups" title="Recolher todos os grupos" aria-label="Recolher todos os grupos">${icon('minus')}</button>
            </div>`
                : ''
            }
            ${cards || '<div class="repo-empty">—</div>'}
          </aside>
          <div class="repo-view">${main}</div>
        </div>
      </section>
      ${bud.uploadModal ? renderBuddyUploadModal() : ''}
      ${bud.editModal ? renderBuddyEditModal() : ''}
      ${bud.poseView ? renderPoseViewModal() : ''}
    `;
  }

  function renderBuddyDetail(bud) {
    const detail = bud.detail;
    if (!detail || detail.loading) {
      return '<div class="repo-empty">Carregando…</div>';
    }
    if (detail.error) {
      return `<div class="repo-empty">${escapeHtml(detail.error)}</div>`;
    }
    const poses = detail.poses || [];
    const byCode = new Map(poses.map((pose) => [pose.code, pose]));
    // Always render all 10 canonical slots — missing poses show an empty placeholder
    // so authors see at a glance what's unassigned.
    const grid = BUDDY_POSE_VOCAB.map((code) => {
      const pose = byCode.get(code);
      const isDefault = code === detail.default_pose;
      const caption = `<figcaption>${escapeHtml(code)}${isDefault ? ' · padrão' : ''}</figcaption>`;
      if (pose) {
        return `<figure class="pose-cell pose-clickable ${isDefault ? 'is-default' : ''}" data-action="openPoseView" data-code="${code}" title="Ver ${escapeHtml(code)}"><img src="${escapeHtml(pose.url)}" alt="${escapeHtml(code)}">${caption}</figure>`;
      }
      return `<figure class="pose-cell pose-empty ${isDefault ? 'is-default' : ''}"><div class="pose-placeholder">${icon('smiley')}<span>vazio</span></div>${caption}</figure>`;
    }).join('');
    const usedBy = detail.usedBy || [];
    const canEdit = Boolean(bud.canCreate);
    const commits = (detail.history || [])
      .slice(0, 8)
      .map(
        (commit) => `
      <li class="commit-item">
        <span class="commit-subject">${escapeHtml(commit.subject || '(sem mensagem)')}</span>
        <span class="commit-meta"><code>${escapeHtml(commit.shortHash)}</code><span>${escapeHtml(commit.author || '—')} · ${escapeHtml((commit.date || '').slice(0, 10))}</span></span>
      </li>`
      )
      .join('');
    return `
      <div class="repo-header">
        <div class="repo-title">
          ${icon('smiley')}
          <div>
            <h3>${escapeHtml(detail.name)}</h3>
            <code class="repo-id">${escapeHtml(detail.id)}</code>
          </div>
          <span class="pill">${poses.length}/${BUDDY_POSE_VOCAB.length} poses</span>
          <span class="buddy-group-badge" title="Grupo">${icon('folder', 'buddy-group-badge-icon')}${escapeHtml(detail.group || 'Geral')}</span>
          ${detail.effectiveTheme && detail.effectiveTheme !== 'regular' ? `<span class="buddy-theme-badge" title="${detail.theme ? 'Tema fixado neste buddy' : 'Tema global ativo'}">${icon('smiley', 'buddy-group-badge-icon')}${escapeHtml(detail.effectiveTheme)}${detail.theme ? ' · fixo' : ''}</span>` : ''}
        </div>
        ${detail.description ? `<p class="buddy-desc">${escapeHtml(detail.description)}</p>` : ''}
        ${detail.temperament ? `<div class="buddy-temperament"><strong>Temperamento</strong><p>${escapeHtml(detail.temperament)}</p></div>` : ''}
        ${usedBy.length ? `<p class="buddy-usedby">${icon('skills')}Usado por ${usedBy.map((skill) => escapeHtml(skill.nome)).join(', ')}</p>` : ''}
        ${
          canEdit
            ? `<div class="row-actions">
          <button class="ghost-button" data-action="openBuddyEdit" data-id="${escapeHtml(detail.id)}">${icon('edit')}Editar</button>
          <button class="ghost-button danger" data-action="confirmDeleteBuddy" data-id="${escapeHtml(detail.id)}">${icon('x')}Excluir</button>
        </div>`
            : ''
        }
      </div>
      <div class="pose-grid">${grid}</div>
      ${commits ? `<div class="buddy-history"><h4>Histórico</h4><ul class="commit-list">${commits}</ul></div>` : ''}
    `;
  }

  function renderBuddyUploadModal() {
    const up = state.buddies.uploadModal;
    const recognized = (up.poses || []).map((pose) => escapeHtml(pose.code));
    const rejected = (up.rejected || []).map((name) => escapeHtml(name));
    const hint = up.reading
      ? 'Lendo imagens…'
      : `${recognized.length ? `Reconhecidas: ${recognized.join(', ')}` : 'PNG/JPG/GIF/WEBP, até 512 KB cada. O nome do arquivo define a pose.'}${rejected.length ? ` · ignoradas: ${rejected.join(', ')}` : ''}`;
    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal wide-modal" role="dialog" aria-modal="true" aria-label="Novo buddy">
          <h2>Novo buddy</h2>
          <p>Envie as imagens nomeadas pelo código da pose (<code>idle.png</code>, <code>wave.png</code>…). Vocabulário fixo de 10 poses; nomes fora dele são ignorados. Você entra como autor; o buddy é versionado no git.</p>
          ${up.error ? `<div class="form-alert form-alert-error">${escapeHtml(up.error)}</div>` : ''}
          <div class="manual-form">
            <label>Nome<input data-buddy-field="name" value="${escapeHtml(up.name || '')}" placeholder="Ex.: Marcolito" ${up.busy ? 'disabled' : ''}></label>
            <label>Descrição<textarea data-buddy-field="description" rows="2" placeholder="Quem é esse buddy." ${up.busy ? 'disabled' : ''}>${escapeHtml(up.description || '')}</textarea></label>
            <label>Temperamento<textarea data-buddy-field="temperament" rows="3" placeholder="Como o buddy conversa: tom, humor, jeito. Ex.: direto e irônico, mas sempre prestativo." ${up.busy ? 'disabled' : ''}>${escapeHtml(up.temperament || '')}</textarea><span class="field-hint">Enviado às integrações junto com o avatar — semeia o tom das respostas do chat. Não altera a execução das skills.</span></label>
            <label>Grupo<input data-buddy-field="group" list="buddy-groups-dl" value="${escapeHtml(up.group || 'Geral')}" placeholder="Ex.: Comercial, RH, Financeiro" ${up.busy ? 'disabled' : ''}><span class="field-hint">Rótulo para agrupar os buddies na biblioteca. Clique um grupo existente ou digite um novo. Vazio = "Geral".</span>
              <div class="group-chips">${buddyGroupSuggestions()
                .map(
                  (g) =>
                    `<button type="button" class="group-chip ${(up.group || 'Geral') === g ? 'is-active' : ''}" data-action="pickBuddyGroup" data-group="${escapeHtml(g)}" ${up.busy ? 'disabled' : ''}>${escapeHtml(g)}</button>`
                )
                .join('')}</div></label>
            ${buddyGroupDatalist('buddy-groups-dl')}
            <label>Pose padrão
              <select data-buddy-field="default_pose" ${up.busy ? 'disabled' : ''}>
                ${BUDDY_POSE_VOCAB.map((code) => option(code, code, up.default_pose || 'idle')).join('')}
              </select>
            </label>
            <label>Imagens de pose
              <input type="file" data-buddy-file accept="image/*" multiple ${up.busy ? 'disabled' : ''}>
              <span class="field-hint">${hint}</span>
            </label>
          </div>
          <div class="row-actions">
            <button class="ghost-button" data-action="closeBuddyUpload" ${up.busy ? 'disabled' : ''}>${icon('x')}Cancelar</button>
            <button class="primary-button" data-action="submitBuddyUpload" ${up.busy || up.reading ? 'disabled' : ''}>${icon('upload')}${up.busy ? 'Criando…' : 'Criar buddy'}</button>
          </div>
        </section>
      </div>
    `;
  }

  function openBuddyUpload() {
    if (!state.buddies) {
      return;
    }
    state.buddies.uploadModal = {
      name: '',
      description: '',
      temperament: '',
      group: 'Geral',
      default_pose: 'idle',
      poses: [],
      rejected: [],
      busy: false,
      reading: false,
      error: null
    };
    renderShell();
  }

  function closeBuddyUpload() {
    if (!state.buddies) {
      return;
    }
    state.buddies.uploadModal = null;
    renderShell();
  }

  async function handleBuddyFiles(fileList) {
    const up = state.buddies && state.buddies.uploadModal;
    if (!up) {
      return;
    }
    const files = Array.from(fileList || []);
    up.reading = true;
    up.error = null;
    renderShell();
    const poses = [];
    const rejected = [];
    try {
      for (const file of files) {
        const dot = file.name.lastIndexOf('.');
        const code = (dot >= 0 ? file.name.slice(0, dot) : file.name).toLowerCase();
        if (!BUDDY_POSE_VOCAB.includes(code)) {
          rejected.push(file.name);
          continue;
        }
        const optimized = await optimizePoseImage(file);
        const entry = { code, ext: optimized.ext, base64: optimized.base64 };
        const existing = poses.findIndex((pose) => pose.code === code);
        if (existing >= 0) {
          poses[existing] = entry;
        } else {
          poses.push(entry);
        }
      }
      up.poses = poses;
      up.rejected = rejected;
    } catch (error) {
      up.error = error.message || 'Falha ao ler imagens.';
    }
    up.reading = false;
    renderShell();
  }

  async function submitBuddyUpload() {
    const up = state.buddies && state.buddies.uploadModal;
    if (!up) {
      return;
    }
    const name = String(up.name || '').trim();
    if (!name) {
      up.error = 'Informe um nome.';
      renderShell();
      return;
    }
    if (!up.poses || !up.poses.length) {
      up.error = 'Envie ao menos uma imagem de pose (ex.: idle.png).';
      renderShell();
      return;
    }
    if (up.reading) {
      return;
    }
    up.busy = true;
    up.error = null;
    renderShell();
    try {
      const res = await fetch('/api/buddies/new', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          description: up.description,
          temperament: up.temperament,
          group: up.group,
          default_pose: up.default_pose,
          poses: up.poses
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        up.busy = false;
        up.error = data.error || `Falha ao criar (HTTP ${res.status}).`;
        renderShell();
        return;
      }
      state.buddies.uploadModal = null;
      state.buddies.selectedId = data.id;
      toast(`Buddy "${name}" criado (${pluralize((data.poses || []).length, 'pose')}).`, 'success');
      await openBuddies();
    } catch (error) {
      if (state.buddies && state.buddies.uploadModal) {
        state.buddies.uploadModal.busy = false;
        state.buddies.uploadModal.error = error.message || 'Erro de rede.';
      }
      renderShell();
    }
  }

  const POSE_MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp'
  };

  function openBuddyEdit(id) {
    const detail = state.buddies && state.buddies.detail;
    if (!detail || detail.id !== id) {
      return;
    }
    state.buddies.editModal = {
      id,
      name: detail.name || '',
      description: detail.description || '',
      temperament: detail.baseTemperament || '', // BASE (regular) temperament
      themeTemperaments: { ...(detail.themeTemperaments || {}) }, // { theme: temperament }
      poseThemes: detail.poseThemes || [], // themed pose-sets this buddy has
      theme: detail.theme || '', // per-buddy override ('' = follow global)
      group: detail.group || 'Geral',
      default_pose: detail.default_pose || 'idle',
      existing: (detail.poses || []).map((pose) => ({ code: pose.code, url: pose.url })),
      poses: {},
      removePoses: [],
      busy: false,
      reading: false,
      error: null
    };
    renderShell();
  }

  function closeBuddyEdit() {
    if (state.buddies) {
      state.buddies.editModal = null;
    }
    renderShell();
  }

  function renderBuddyEditModal() {
    const ed = state.buddies.editModal;
    const existingByCode = new Map((ed.existing || []).map((pose) => [pose.code, pose]));
    const themeList = [...new Set([...(ed.poseThemes || []), ...Object.keys(ed.themeTemperaments || {})])].sort();
    const themeTempFields = themeList
      .map(
        (t) =>
          `<label>Temperamento — tema "${escapeHtml(t)}"<textarea data-theme-temp="${escapeHtml(t)}" rows="2" placeholder="Tom deste buddy quando o tema ${escapeHtml(t)} está ativo." ${ed.busy ? 'disabled' : ''}>${escapeHtml((ed.themeTemperaments || {})[t] || '')}</textarea></label>`
      )
      .join('');
    const overrideOptions = [...new Set(['', 'regular', ...themeList])];
    const overrideField = `<label>Tema deste buddy<select data-edit-field="theme" ${ed.busy ? 'disabled' : ''}>${overrideOptions.map((t) => `<option value="${escapeHtml(t)}" ${(ed.theme || '') === t ? 'selected' : ''}>${t === '' ? 'Seguir tema global' : t === 'regular' ? 'Regular (fixo)' : escapeHtml(t)}</option>`).join('')}</select><span class="field-hint">Vazio = segue o tema global. Escolha um tema para fixar este buddy nele, independente do global.</span></label>`;
    const slots = BUDDY_POSE_VOCAB.map((code) => {
      const staged = ed.poses[code];
      const removed = ed.removePoses.includes(code);
      const existing = existingByCode.get(code);
      let thumb;
      let status = '';
      let action;
      if (removed) {
        thumb = `<div class="pose-placeholder">${icon('x')}<span>remover</span></div>`;
        status = 'será removida';
        action = `<button type="button" class="link-button" data-action="undoPose" data-code="${code}">desfazer</button>`;
      } else if (staged) {
        thumb = `<img src="data:${POSE_MIME[staged.ext] || 'image/png'};base64,${staged.base64}" alt="${escapeHtml(code)}">`;
        status = 'nova imagem';
        action = `<label class="pose-replace">trocar<input type="file" accept="image/*" data-pose-slot="${code}"></label> <button type="button" class="link-button danger" data-action="removePose" data-code="${code}">descartar</button>`;
      } else if (existing) {
        thumb = `<img src="${escapeHtml(existing.url)}" alt="${escapeHtml(code)}">`;
        action = `<label class="pose-replace">trocar<input type="file" accept="image/*" data-pose-slot="${code}"></label> <button type="button" class="link-button danger" data-action="removePose" data-code="${code}">remover</button>`;
      } else {
        thumb = `<div class="pose-placeholder">${icon('smiley')}<span>vazio</span></div>`;
        status = 'sem imagem';
        action = `<label class="pose-replace">adicionar<input type="file" accept="image/*" data-pose-slot="${code}"></label>`;
      }
      const empty = removed || (!staged && !existing);
      return `<figure class="pose-cell pose-edit ${empty ? 'pose-empty' : ''}">
        ${thumb}
        <figcaption>${escapeHtml(code)}</figcaption>
        <div class="pose-actions">${action}</div>
        ${status ? `<small class="pose-status">${status}</small>` : ''}
      </figure>`;
    }).join('');
    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal wide-modal" role="dialog" aria-modal="true" aria-label="Editar buddy">
          <h2>Editar buddy</h2>
          <p>Ajuste nome, descrição, pose padrão e cada imagem individualmente. Alterações entram como um commit no histórico.</p>
          ${ed.error ? `<div class="form-alert form-alert-error">${escapeHtml(ed.error)}</div>` : ''}
          <div class="manual-form">
            <label>Nome<input data-edit-field="name" value="${escapeHtml(ed.name || '')}" ${ed.busy ? 'disabled' : ''}></label>
            <label>Descrição<textarea data-edit-field="description" rows="2" ${ed.busy ? 'disabled' : ''}>${escapeHtml(ed.description || '')}</textarea></label>
            <label>Temperamento (regular)<textarea data-edit-field="temperament" rows="3" placeholder="Como o buddy conversa: tom, humor, jeito." ${ed.busy ? 'disabled' : ''}>${escapeHtml(ed.temperament || '')}</textarea><span class="field-hint">Tom base — usado quando o tema ativo é o regular. Enviado às integrações junto com o avatar; não altera a execução das skills.</span></label>
            ${themeTempFields}
            <label>Grupo<input data-edit-field="group" list="buddy-groups-dl-edit" value="${escapeHtml(ed.group || 'Geral')}" placeholder="Ex.: Comercial, RH, Financeiro" ${ed.busy ? 'disabled' : ''}><span class="field-hint">Rótulo para agrupar os buddies na biblioteca. Clique um grupo existente ou digite um novo. Vazio = "Geral".</span>
              <div class="group-chips">${buddyGroupSuggestions()
                .map(
                  (g) =>
                    `<button type="button" class="group-chip ${(ed.group || 'Geral') === g ? 'is-active' : ''}" data-action="pickBuddyGroup" data-group="${escapeHtml(g)}" ${ed.busy ? 'disabled' : ''}>${escapeHtml(g)}</button>`
                )
                .join('')}</div></label>
            ${buddyGroupDatalist('buddy-groups-dl-edit')}
            ${overrideField}
            <label>Pose padrão<select data-edit-field="default_pose" ${ed.busy ? 'disabled' : ''}>${BUDDY_POSE_VOCAB.map((code) => option(code, code, ed.default_pose || 'idle')).join('')}</select></label>
          </div>
          <div class="pose-grid pose-grid-edit">${slots}</div>
          <div class="row-actions">
            <button class="ghost-button" data-action="closeBuddyEdit" ${ed.busy ? 'disabled' : ''}>${icon('x')}Cancelar</button>
            <button class="primary-button" data-action="submitBuddyEdit" ${ed.busy || ed.reading ? 'disabled' : ''}>${icon('check')}${ed.busy ? 'Salvando…' : 'Salvar alterações'}</button>
          </div>
        </section>
      </div>
    `;
  }

  async function handleEditPoseFile(code, file) {
    const ed = state.buddies && state.buddies.editModal;
    if (!ed || !file) {
      return;
    }
    ed.reading = true;
    ed.error = null;
    renderShell();
    try {
      const optimized = await optimizePoseImage(file);
      ed.poses[code] = { code, ext: optimized.ext, base64: optimized.base64 };
      ed.removePoses = ed.removePoses.filter((item) => item !== code);
    } catch (error) {
      ed.error = error.message || 'Falha ao ler imagem.';
    }
    ed.reading = false;
    renderShell();
  }

  function markRemovePose(code) {
    const ed = state.buddies && state.buddies.editModal;
    if (!ed) {
      return;
    }
    delete ed.poses[code];
    const existing = (ed.existing || []).some((pose) => pose.code === code);
    if (existing && !ed.removePoses.includes(code)) {
      ed.removePoses.push(code);
    }
    renderShell();
  }

  function undoRemovePose(code) {
    const ed = state.buddies && state.buddies.editModal;
    if (!ed) {
      return;
    }
    ed.removePoses = ed.removePoses.filter((item) => item !== code);
    renderShell();
  }

  async function submitBuddyEdit() {
    const ed = state.buddies && state.buddies.editModal;
    if (!ed || ed.reading) {
      return;
    }
    const name = String(ed.name || '').trim();
    if (!name) {
      ed.error = 'Informe um nome.';
      renderShell();
      return;
    }
    ed.busy = true;
    ed.error = null;
    renderShell();
    try {
      const res = await fetch(`/api/buddies/${encodeURIComponent(ed.id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          description: ed.description,
          temperament: ed.temperament,
          themeTemperaments: ed.themeTemperaments || {},
          theme: ed.theme || '',
          group: ed.group,
          default_pose: ed.default_pose,
          poses: Object.values(ed.poses),
          removePoses: ed.removePoses
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        ed.busy = false;
        ed.error = data.error || `Falha ao salvar (HTTP ${res.status}).`;
        renderShell();
        return;
      }
      const id = ed.id;
      state.buddies.editModal = null;
      state.buddies.selectedId = id;
      toast('Alterações salvas.', 'success');
      await openBuddies();
    } catch (error) {
      if (state.buddies && state.buddies.editModal) {
        state.buddies.editModal.busy = false;
        state.buddies.editModal.error = error.message || 'Erro de rede.';
      }
      renderShell();
    }
  }

  async function deleteBuddy(id) {
    try {
      const res = await fetch(`/api/buddies/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { accept: 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      state.confirm = null;
      if (!res.ok || !data.ok) {
        toast(data.error || `Falha ao excluir (HTTP ${res.status}).`, 'warning');
        renderShell();
        return;
      }
      const stale = (data.staleSkills || []).length;
      state.buddies.selectedId = null;
      state.buddies.detail = null;
      toast(`Buddy excluído.${stale ? ` ${pluralize(stale, 'skill')} agora sem buddy (stale).` : ''}`, 'success');
      await openBuddies();
    } catch (error) {
      state.confirm = null;
      toast(error.message || 'Erro de rede.', 'warning');
      renderShell();
    }
  }

  function renderPoseViewModal() {
    const detail = state.buddies && state.buddies.detail;
    const pv = state.buddies && state.buddies.poseView;
    if (!detail || !pv) {
      return '';
    }
    const pose = (detail.poses || []).find((item) => item.code === pv.code);
    if (!pose) {
      return '';
    }
    const canEdit = Boolean(state.buddies.canCreate);
    const isDefault = pose.code === detail.default_pose;
    const filename = `${detail.id}-${pose.code}${pose.ext || '.png'}`;
    const src = `${pose.url}${pv.bust ? `?v=${encodeURIComponent(pv.bust)}` : ''}`;
    return `
      <div class="modal-backdrop pose-view-backdrop" role="presentation">
        <section class="modal pose-view-modal" role="dialog" aria-modal="true" aria-label="Pose ${escapeHtml(pose.code)}">
          <div class="pose-view-head">
            <span><strong>${escapeHtml(detail.name)}</strong> · <code>${escapeHtml(pose.code)}</code>${isDefault ? ' <span class="pill">padrão</span>' : ''}</span>
            <button class="icon-button subtle" data-action="closePoseView" aria-label="Fechar">${icon('x')}</button>
          </div>
          ${pv.error ? `<div class="form-alert form-alert-error">${escapeHtml(pv.error)}</div>` : ''}
          <div class="pose-view-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(pose.code)}"></div>
          <div class="row-actions pose-view-actions">
            <a class="ghost-button" href="${escapeHtml(pose.url)}" download="${escapeHtml(filename)}">${icon('download')}Baixar</a>
            ${canEdit ? `<label class="ghost-button ${pv.busy ? 'is-disabled' : ''}">${icon('edit')}Trocar<input type="file" accept="image/*" data-pose-view-file hidden ${pv.busy ? 'disabled' : ''}></label>` : ''}
            ${canEdit ? `<button class="ghost-button danger" data-action="removePoseView" ${pv.busy ? 'disabled' : ''}>${icon('x')}Remover</button>` : ''}
          </div>
        </section>
      </div>
    `;
  }

  function openPoseView(code) {
    if (!state.buddies) {
      return;
    }
    state.buddies.poseView = { code, bust: '', busy: false, error: null };
    renderShell();
  }

  function closePoseView() {
    if (state.buddies) {
      state.buddies.poseView = null;
    }
    renderShell();
  }

  async function refreshBuddyDetailQuiet(id) {
    try {
      const res = await fetch(`/api/buddies/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        state.buddies.detail = data;
      }
    } catch (error) {
      /* keep the current detail on failure */
    }
  }

  async function handlePoseViewFile(file) {
    const pv = state.buddies && state.buddies.poseView;
    const detail = state.buddies && state.buddies.detail;
    if (!pv || !detail || !file) {
      return;
    }
    pv.busy = true;
    pv.error = null;
    renderShell();
    try {
      // Reuse the shared client-side optimizer when present (keeps Trocar consistent
      // with the create/edit upload paths); fall back to raw bytes if it's absent.
      let ext;
      let base64;
      if (typeof optimizePoseImage === 'function') {
        ({ ext, base64 } = await optimizePoseImage(file));
      } else {
        const dot = file.name.lastIndexOf('.');
        ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '.png';
        if (!BUDDY_POSE_EXT_LIST.includes(ext)) {
          ext = '.png';
        }
        base64 = await readFileAsBase64(file);
      }
      const res = await fetch(`/api/buddies/${encodeURIComponent(detail.id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ poses: [{ code: pv.code, ext, base64 }] })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        pv.busy = false;
        pv.error = data.error || `Falha ao trocar (HTTP ${res.status}).`;
        renderShell();
        return;
      }
      await refreshBuddyDetailQuiet(detail.id);
      if (state.buddies.poseView) {
        state.buddies.poseView.busy = false;
        state.buddies.poseView.bust = String(Date.now());
      }
      toast(`Pose "${pv.code}" atualizada.`, 'success');
      renderShell();
    } catch (error) {
      if (state.buddies && state.buddies.poseView) {
        state.buddies.poseView.busy = false;
        state.buddies.poseView.error = error.message || 'Erro de rede.';
      }
      renderShell();
    }
  }

  async function removePoseView() {
    const pv = state.buddies && state.buddies.poseView;
    const detail = state.buddies && state.buddies.detail;
    if (!pv || !detail) {
      return;
    }
    const code = pv.code;
    pv.busy = true;
    pv.error = null;
    renderShell();
    try {
      const res = await fetch(`/api/buddies/${encodeURIComponent(detail.id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ removePoses: [code] })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        pv.busy = false;
        pv.error = data.error || `Falha ao remover (HTTP ${res.status}).`;
        renderShell();
        return;
      }
      state.buddies.poseView = null;
      await loadBuddyDetail(detail.id);
      toast(`Pose "${code}" removida.`, 'success');
    } catch (error) {
      if (state.buddies && state.buddies.poseView) {
        state.buddies.poseView.busy = false;
        state.buddies.poseView.error = error.message || 'Erro de rede.';
      }
      renderShell();
    }
  }

  return {
    openBuddies,
    loadBuddyDetail,
    toggleBuddyGroup,
    expandAllBuddyGroups,
    collapseAllBuddyGroups,
    pickBuddyGroup,
    applyGlobalBuddyTheme,
    renderBuddies,
    openBuddyUpload,
    closeBuddyUpload,
    handleBuddyFiles,
    submitBuddyUpload,
    openBuddyEdit,
    closeBuddyEdit,
    handleEditPoseFile,
    markRemovePose,
    undoRemovePose,
    submitBuddyEdit,
    deleteBuddy,
    openPoseView,
    closePoseView,
    handlePoseViewFile,
    removePoseView
  };
}
