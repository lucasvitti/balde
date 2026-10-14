export function createAdministrationFeature({
  isBaldeAdmin,
  roleAllows,
  permissionAttrs,
  permissionNote,
  state,
  renderShell,
  loadCapsuleCategories,
  toast,
  defaultCapsuleCategory,
  escapeHtml,
  icon,
  domainsNavVisible,
  domainRootKey,
  loadUserList,
  loadDomainList,
  provider,
  refresh,
  readJsonResponse,
  commonsDomainKey,
  normalizeDomain,
  isAdmin,
  isCurator
}) {
  async function openCategoriasAdmin() {
    if (!roleAllows('curar')) return;
    state.categoriasAdmin = { list: [], usage: {}, savedKeys: [], busy: true, error: null, dirty: false };
    renderShell();
    try {
      const res = await fetch('/api/admin/capsule-categories');
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      const list = d.categories || [];
      state.categoriasAdmin = {
        list,
        usage: d.usage || {},
        savedKeys: list.map((c) => c.key),
        busy: false,
        error: null,
        dirty: false
      };
    } catch (error) {
      state.categoriasAdmin = { list: [], usage: {}, savedKeys: [], busy: false, error: error.message, dirty: false };
    }
    renderShell();
  }

  async function saveCategoriasAdmin(force = false) {
    const t = state.categoriasAdmin;
    if (!t) return;
    t.busy = true;
    t.error = null;
    renderShell();
    try {
      const res = await fetch('/api/admin/capsule-categories', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categories: t.list, force })
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409) {
        t.busy = false;
        t.error = d.error;
        t.canForce = true;
        renderShell();
        return;
      }
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      const saved = d.categories || [];
      state.categoriasAdmin = {
        list: saved,
        usage: d.usage || {},
        savedKeys: saved.map((c) => c.key),
        busy: false,
        error: null,
        dirty: false
      };
      await loadCapsuleCategories(); // a UI inteira passa a desenhar o vocabulário novo
      toast(d.reassigned ? `Salvo — ${d.reassigned} cápsula(s) reatribuída(s).` : 'Categorias salvas.', 'success');
    } catch (error) {
      state.categoriasAdmin.busy = false;
      state.categoriasAdmin.error = error.message;
    }
    renderShell();
  }

  function renderCategoriasBody() {
    const t = state.categoriasAdmin;
    if (!t) return '<p class="repo-empty">Carregando…</p>';
    const rows = (t.list || [])
      .map((c, i) => {
        const used = t.usage[c.key] || 0;
        const isDefault = c.key === defaultCapsuleCategory();
        // A chave e' a UNICA coisa que a capsula grava. Renomea-la aqui deixaria toda capsula que
        // a usa apontando para um vocabulario que nao existe mais — entao ela so' e' editavel
        // enquanto a linha e' nova. Rotulo, cor, descricao e icone continuam livres para sempre:
        // sao lidos desta lista na hora de desenhar, nunca copiados para dentro da capsula.
        const locked = (t.savedKeys || []).includes(c.key);
        return `<div class="cat-admin-row">
        <div class="cat-admin-preview" style="color:${escapeHtml(c.color || '#3b6fd4')}">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${c.icon || ''}</svg>
        </div>
        <div class="cat-admin-fields">
          <label><span class="cat-admin-legend">Identificador${locked ? ' <span class="field-req">PERMANENTE</span>' : ''}</span>
            <input data-cat-field="key" data-cat-i="${i}" value="${escapeHtml(c.key || '')}" spellcheck="false"
              ${locked ? `disabled title="${escapeHtml(isDefault ? 'A categoria padrão não pode ser renomeada.' : `É o valor gravado em ${used} cápsula(s). Renomear deixaria todas apontando para o vazio — crie outra categoria e reatribua.`)}"` : 'placeholder="resumo-de-reuniao"'}></label>
          <label>Rótulo <input data-cat-field="label" data-cat-i="${i}" value="${escapeHtml(c.label || '')}"></label>
          <label>Cor <input type="color" data-cat-field="color" data-cat-i="${i}" value="${escapeHtml(c.color || '#3b6fd4')}"></label>
          <label class="cat-admin-wide">Descrição <input data-cat-field="hint" data-cat-i="${i}" value="${escapeHtml(c.hint || '')}" placeholder="quando usar esta categoria"></label>
          <label class="cat-admin-wide">Ícone (SVG) <textarea data-cat-field="icon" data-cat-i="${i}" rows="2" spellcheck="false" placeholder='&lt;path d="M4 7.5l2 2 3.5-4"/&gt;'>${escapeHtml(c.icon || '')}</textarea></label>
        </div>
        <div class="cat-admin-side">
          <span class="cat-admin-usage" title="cápsulas usando esta categoria">${used} cápsula(s)</span>
          ${
            isDefault
              ? '<span class="muted" title="É o destino de toda cápsula sem categoria — não pode ser removida.">padrão</span>'
              : `<button class="ghost-button small" data-action="catRemove" data-i="${i}"${permissionAttrs('curar')}>${icon('trash') || ''}Remover</button>`
          }
        </div>
      </div>`;
      })
      .join('');
    return `
      <p class="admin-hint">O vocabulário de <strong>categorias de cápsula</strong> — que tipo de conhecimento cada cápsula guarda. Vale em todas as superfícies: chip no explorador, ícone no Mapa e seletor no editor. Versionado no git do corpus.</p>
      <p class="admin-hint">A cápsula guarda <strong>só o identificador</strong> (<code>categoria: "dado"</code>). Rótulo, cor, descrição e ícone são lidos daqui na hora de desenhar — mudar qualquer um deles vale de imediato em todas as cápsulas, sem tocar em nenhum arquivo. Por isso o identificador é permanente depois de salvo: é o que as cápsulas apontam.</p>
      ${t.error ? `<div class="form-error">${escapeHtml(t.error)}${t.canForce ? ` <button class="ghost-button small" data-action="catSaveForce"${permissionAttrs('curar')}>Remover assim mesmo (manda para “${escapeHtml(defaultCapsuleCategory())}”)</button>` : ''}</div>` : ''}
      <div class="cat-admin-list">${rows || '<p class="repo-empty">Nenhuma categoria.</p>'}</div>
      <div class="cat-admin-actions">
        <button class="ghost-button" data-action="catAdd"${permissionAttrs('curar')}>${icon('plus') || ''}Nova categoria</button>
        <button class="primary-button" data-action="catSave" ${t.busy ? 'disabled' : permissionAttrs('curar')}>${t.busy ? 'Salvando…' : 'Salvar vocabulário'}</button>
      </div>
      ${permissionNote('curar')}
      <p class="wizard-hint">O ícone é o <em>miolo</em> de um SVG 24×24 (só formas: path, circle, rect, line, polyline, polygon). O traço e a cor são aplicados pela interface — não inclua <code>stroke</code> nem <code>fill</code>.</p>`;
  }

  // Local version: menu page "Domínios" for the active balde. Its creator and curators create, rename
  // and remove domains here (D1, 2.0.19: organizing the content is curation).
  function renderDomainsView() {
    if (!domainsNavVisible()) {
      return '<section class="panel empty-state">Os domínios deste balde são organizados pelo criador e pelos curadores dele.</section>';
    }
    return `<section class="panel settings-panel">${renderDomainsBody()}</section>`;
  }

  function renderDomainsBody() {
    const t = state.domainsAdmin;
    if (!t) {
      return '<p class="repo-empty">Carregando…</p>';
    }
    const admin = roleAllows('curar');
    const activeBalde = (state.repos || []).find((r) => r.name === state.activeRepo);
    // Skills-per-domain count from the loaded catalog — a "firm" usage signal (like Grupos' member count).
    const counts = {};
    (state.skills || []).forEach((s) => {
      const d = s.domain || '';
      if (d) {
        counts[d] = (counts[d] || 0) + 1;
      }
    });
    // Commons-per-domain count, loaded alongside the domains list (openDomainsAdmin).
    const commonsCounts = t.commonsCounts || {};

    // Group the flat vocabulary by root domain (domain-subdomain structure, one level deep).
    const groupMap = new Map();
    for (const d of t.list || []) {
      const key = domainRootKey(d);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(d);
    }
    const groups = [...groupMap.entries()]
      .map(([key, all]) => ({ key, all: all.slice().sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => a.key.localeCompare(b.key));

    // Live search: a root shows if its name matches (all members visible) or any member matches
    // (only those visible). Empty query → everything.
    const q = (t.query || '').trim().toLowerCase();
    let view = groups.map((g) => {
      if (!q) return { key: g.key, all: g.all, members: g.all };
      const keyMatch = g.key.toLowerCase().includes(q);
      const members = keyMatch ? g.all : g.all.filter((m) => m.toLowerCase().includes(q));
      return { key: g.key, all: g.all, members };
    });
    if (q) view = view.filter((g) => g.members.length > 0);

    // Pagination over ROOT groups, so a domain family never splits across pages.
    const PAGE = 8;
    const totalGroups = view.length;
    const pages = Math.max(1, Math.ceil(totalGroups / PAGE));
    const page = Math.min(Math.max(1, t.page || 1), pages);
    const pageGroups = view.slice((page - 1) * PAGE, (page - 1) * PAGE + PAGE);

    const renameRow = (d, isSub) => `
      <tr class="${isSub ? 'domain-sub-row' : ''}">
        <td colspan="3"><input class="tag-input-field" data-domain-rename-input value="${escapeHtml(t.renameTo != null ? t.renameTo : d)}" placeholder="novo nome do domínio" ${t.busy ? 'disabled' : ''}> <span class="muted">move todas as skills + conceitos de <code>${escapeHtml(d)}</code></span></td>
        <td><button class="link-button" data-action="domainRenameConfirm" ${t.busy ? 'disabled' : permissionAttrs('curar')}>${t.busy ? 'movendo…' : 'salvar'}</button> <button class="link-button" data-action="domainRenameCancel" ${t.busy ? 'disabled' : ''}>cancelar</button></td>
      </tr>`;
    const memberRow = (d, isSub) => {
      if (t.renaming === d) return renameRow(d, isSub);
      return `
      <tr class="${isSub ? 'domain-sub-row' : ''}">
        <td><code>${escapeHtml(d)}</code></td>
        <td>${counts[d] || 0}</td>
        <td>${commonsCounts[d] || 0}</td>
        <td>${admin ? `<button class="link-button" data-action="domainRenameStart" data-domain="${escapeHtml(d)}"${permissionAttrs('curar')}${counts[d] ? ` title="renomear move as ${counts[d]} skill(s) + conceitos deste domínio e atualiza os links"` : ''}>renomear</button> <button class="link-button danger" data-action="removeDomainAdmin" data-domain="${escapeHtml(d)}"${permissionAttrs('curar')}${counts[d] ? ` title="${counts[d]} skill(s) usam este domínio — a pasta permanece; ele só deixa de ser oferecido a novas skills"` : ''}>remover</button>` : ''}</td>
      </tr>`;
    };

    let rows;
    if (!pageGroups.length) {
      rows = `<tr><td colspan="4" class="muted">${q ? 'Nenhum domínio corresponde à busca.' : 'Nenhum domínio ainda.'}</td></tr>`;
    } else {
      rows = pageGroups
        .map((g) => {
          // A root with no subdomains is just a single flat row — no group header.
          if (g.all.length === 1) return memberRow(g.members[0] || g.all[0], false);
          const collapsed = !q && !!(t.collapsed && t.collapsed[g.key]);
          const aggS = g.members.reduce((a, m) => a + (counts[m] || 0), 0);
          const aggC = g.members.reduce((a, m) => a + (commonsCounts[m] || 0), 0);
          const header = `
      <tr class="domain-group-row${collapsed ? ' is-collapsed' : ''}" data-action="toggleDomainGroup" data-group="${escapeHtml(g.key)}" title="${collapsed ? 'Expandir' : 'Recolher'} ${escapeHtml(g.key)}">
        <td class="domain-group-key">${icon('chevron')}<strong>${escapeHtml(g.key)}</strong><span class="domain-group-count">${g.members.length}</span></td>
        <td>${aggS}</td>
        <td>${aggC}</td>
        <td></td>
      </tr>`;
          const children = collapsed ? '' : g.members.map((m) => memberRow(m, true)).join('');
          return header + children;
        })
        .join('');
    }

    const pager =
      pages > 1
        ? `
        <div class="commons-pager">
          <button class="ghost-button small" data-action="domainsPagePrev" ${page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
          <span class="commons-pager-info">Página ${page} de ${pages} · ${totalGroups} domínio(s)-raiz</span>
          <button class="ghost-button small" data-action="domainsPageNext" ${page >= pages ? 'disabled' : ''}>Próxima ›</button>
        </div>`
        : '';

    return `
        <div class="section-heading">
          <div>
            <p class="eyebrow">${state.view === 'domains' ? `Governança · ${escapeHtml((activeBalde && (activeBalde.titulo || activeBalde.name)) || state.activeRepo || '')}` : 'Config · Governança'}</p>
            <h2>Domínios</h2>
          </div>
        </div>
        <p class="groups-intro">Vocabulário canônico de <strong>domínios</strong>, compartilhado por skills e cápsulas. Cada skill/cápsula escolhe um domínio desta lista — ele vira a pasta <code>&lt;domínio&gt;/&lt;slug&gt;</code>. Versionado em git. A tabela agrupa pelo <strong>domínio-raiz</strong> (o trecho antes do primeiro traço).</p>
        ${t.error ? `<div class="form-alert form-alert-error">${escapeHtml(t.error)}</div>` : ''}
        <div class="member-add">
          <input data-domains-admin-input value="${escapeHtml(t.draft || '')}" placeholder="novo domínio (ex.: pricing ou pricing-fechamento)…" ${t.busy ? 'disabled' : ''}>
          <button class="ghost-button small" data-action="addDomainAdmin" ${t.busy ? 'disabled' : permissionAttrs('curar')}>${icon('plus')}Criar domínio</button>
        </div>
        ${admin ? permissionNote('curar') : ''}
        <div class="domains-toolbar">
          <label class="commons-filter">${icon('search')}<input type="search" data-domains-search value="${escapeHtml(t.query || '')}" placeholder="Filtrar domínios…"></label>
        </div>
        <div class="api-table-wrap">
          <table class="api-table">
            <thead><tr><th>Domínio</th><th>Skills</th><th>Cápsulas</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${pager}
        ${
          admin
            ? `<div class="row-actions">
          <button class="primary-button" data-action="saveDomainsAdmin" ${t.busy ? 'disabled' : permissionAttrs('curar')}>${icon('check')}${t.busy ? 'Salvando…' : 'Salvar lista'}</button>
        </div>`
            : ''
        }
    `;
  }

  // "Mover skill de domínio" as its OWN admin tab. Reuses the move panel, which reads the
  // domain vocabulary from state.domainsAdmin — kick that load when landing here directly.
  function renderMoveSkillBody() {
    if (!state.domainsAdmin) {
      openDomainsAdmin();
      return '<p class="repo-empty">Carregando…</p>';
    }
    return (
      renderMoveSkillPanel(state.domainsAdmin) ||
      '<p class="repo-empty">Nenhuma skill com domínio para mover ainda.</p>'
    );
  }
  // Admin assigns, per user, the governed domains they may CREATE skills/capsules in.
  // Admins bypass; everyone else with no assignment cannot create anywhere.
  function renderUserDomainsPanel() {
    const heading = `
        <div class="section-heading">
          <div>
            <p class="eyebrow">Config · Governança</p>
            <h2>Domínios por usuário</h2>
          </div>
        </div>
        <p class="groups-intro">Lista branca de <strong>criação</strong> para quem não cura o balde: cada pessoa só cria skills e cápsulas (o que envia pela Fila) nos domínios liberados aqui. <strong>O criador e os curadores do balde criam em qualquer domínio</strong> e não precisam de liberação. <strong>Sem nenhum domínio liberado, a pessoa não cria conteúdo.</strong> Só o criador do balde muda esta lista.</p>`;
    const s = state.userDomainsAdmin;
    if (!s) {
      state.userDomainsAdmin = { loading: true };
      loadUserDomainsAdmin();
      return `${heading}<p class="repo-empty">Carregando…</p>`;
    }
    if (s.loading) return `${heading}<p class="repo-empty">Carregando…</p>`;
    const doms = s.domains || state.domainList || [];
    // The balde's own people (its access list, groups included) with their role; an open balde
    // (Corporativo) also reaches everyone who signed in here. On the local version the sign-in roster
    // only knows whoever uses this machine, so the balde's list is what lets its admins grant others.
    const rosterName = new Map((state.userList || []).map((u) => [String(u.email || '').toLowerCase(), u.name]));
    const byEmail = new Map();
    for (const p of s.people || [])
      byEmail.set(p.email, { email: p.email, name: p.name || rosterName.get(p.email) || p.email, role: p.role });
    if (s.open !== false) {
      for (const u of state.userList || []) {
        const em = String(u.email || '').toLowerCase();
        if (em && !byEmail.has(em)) byEmail.set(em, { email: em, name: u.name || em, role: '' });
      }
    }
    for (const em of Object.keys(s.assignments || {})) {
      if (!byEmail.has(em)) byEmail.set(em, { email: em, name: rosterName.get(em) || em, role: '' });
    }
    if (s.editing && !byEmail.has(s.editing)) byEmail.set(s.editing, { email: s.editing, name: s.editing, role: '' }); // added by e-mail
    const people = [...byEmail.values()].sort((a, b) =>
      String(a.name || a.email).localeCompare(String(b.name || b.email), 'pt-BR')
    );
    const roleChip = (role) => (role ? ` <span class="tag-chip tag-chip-static">${escapeHtml(role)}</span>` : '');
    const rows = people
      .map((u) => {
        const em = String(u.email || '').toLowerCase();
        const assigned = (s.assignments && s.assignments[em]) || [];
        if (u.role === 'admin' || u.role === 'curador') {
          return `<tr>
        <td><strong>${escapeHtml(u.name || em)}</strong>${roleChip(u.role)}<div class="ud-email">${escapeHtml(em)}</div></td>
        <td><span class="muted">${u.role === 'admin' ? 'criador do balde' : 'curador do balde'}: cria em qualquer domínio</span></td>
        <td></td>
      </tr>`;
        }
        if (s.editing === em) {
          return `<tr>
          <td><strong>${escapeHtml(u.name || em)}</strong><div class="ud-email">${escapeHtml(em)}</div></td>
          <td><div class="ud-toggle-wrap">${doms.map((d) => `<button type="button" class="dom-pill ${s.draft.includes(d) ? 'active' : ''}" data-action="udToggle" data-domain="${escapeHtml(d)}" ${s.busy ? 'disabled' : ''}>${escapeHtml(d)}</button>`).join('') || '<span class="muted">nenhum domínio no vocabulário</span>'}</div></td>
          <td class="ud-actions"><button class="link-button" data-action="udSave" ${s.busy ? 'disabled' : permissionAttrs('administrar')}>${s.busy ? 'salvando…' : 'salvar'}</button> <button class="link-button" data-action="udCancel" ${s.busy ? 'disabled' : ''}>cancelar</button></td>
        </tr>`;
        }
        return `<tr>
        <td><strong>${escapeHtml(u.name || em)}</strong>${roleChip(u.role)}<div class="ud-email">${escapeHtml(em)}</div></td>
        <td>${assigned.length ? assigned.map((d) => `<span class="tag-chip">${escapeHtml(d)}</span>`).join(' ') : '<span class="muted">nenhum — não cria conteúdo</span>'}</td>
        <td class="ud-actions"><button class="link-button" data-action="udEdit" data-email="${escapeHtml(em)}"${permissionAttrs('administrar')}>editar</button></td>
      </tr>`;
      })
      .join('');
    return `${heading}
        ${s.error ? `<div class="form-alert form-alert-error">${escapeHtml(s.error)}</div>` : ''}
        <div class="member-add">
          <input data-ud-add-email placeholder="e-mail de alguém que não está na lista…" spellcheck="false" autocapitalize="off">
          <button class="ghost-button small" data-action="udAddEmail">${icon('plus')}Liberar domínios</button>
        </div>
        <div class="api-table-wrap">
          <table class="api-table ud-table">
            <thead><tr><th>Usuário</th><th>Domínios liberados para criação</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3" class="muted">Nenhum usuário conhecido ainda.</td></tr>'}</tbody>
          </table>
        </div>`;
  }

  async function loadUserDomainsAdmin() {
    loadUserList(); // roster for names — best-effort, re-renders when it lands
    try {
      const res = await fetch('/api/admin/user-domains');
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      state.userDomainsAdmin = {
        assignments: d.assignments || {},
        domains: d.domains || [],
        people: d.people || [],
        open: d.open !== false,
        busy: false,
        error: null,
        editing: null,
        draft: []
      };
    } catch (error) {
      state.userDomainsAdmin = {
        assignments: {},
        domains: [],
        busy: false,
        error: error.message || 'Erro de rede.',
        editing: null,
        draft: []
      };
    }
    renderShell();
  }

  function udEdit(email) {
    const s = state.userDomainsAdmin;
    if (!s || s.loading) return;
    s.editing = String(email || '').toLowerCase();
    s.draft = [...((s.assignments && s.assignments[s.editing]) || [])];
    renderShell();
  }
  function udCancel() {
    const s = state.userDomainsAdmin;
    if (!s) return;
    s.editing = null;
    s.draft = [];
    renderShell();
  }
  function udToggle(dom) {
    const s = state.userDomainsAdmin;
    if (!s || s.editing == null || s.busy) return;
    s.draft = s.draft.includes(dom) ? s.draft.filter((d) => d !== dom) : [...s.draft, dom];
    renderShell();
  }
  async function udSave() {
    const s = state.userDomainsAdmin;
    if (!s || s.editing == null || s.busy) return;
    s.busy = true;
    s.error = null;
    renderShell();
    try {
      const res = await fetch('/api/admin/user-domains', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: s.editing, domains: s.draft })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      s.assignments = d.assignments || s.assignments;
      toast(`Domínios de criação de ${s.editing} atualizados.`, 'success');
      s.editing = null;
      s.draft = [];
      s.busy = false;
      loadDomainList(); // refresh `mine` in case the admin edited a session identity in use
    } catch (error) {
      s.busy = false;
      s.error = error.message || 'Erro de rede.';
      toast(s.error, 'warning');
    }
    renderShell();
  }

  // Mover UMA skill de domínio (mantém o slug). Diferente de "renomear domínio", que leva
  // skills E cápsulas juntas — aqui as cápsulas ficam onde estão.
  function renderMoveSkillPanel(t) {
    const skills = (state.skills || []).filter((s) => String(s.id || '').includes('/'));
    if (!skills.length) return '';
    const sel = t.moveSkillId || '';
    const cur = sel ? sel.split('/')[0] : '';
    const targets = (t.list || []).filter((d) => d !== cur);
    return `
        <div class="section-heading">
          <div>
            <p class="eyebrow">Config · Governança</p>
            <h2>Mover skill de domínio</h2>
          </div>
        </div>
        <p class="groups-intro">Move <strong>uma skill</strong> para outro domínio, mantendo o slug. As <strong>cápsulas não são movidas</strong> — elas têm ids próprios e continuam onde estão. Chats, plenárias, eventos de uso, feedback e links do corpus são remapeados; o histórico de governança da skill é reescrito. <strong>Atenção:</strong> o id é o endereço público — integrações que apontam para o id antigo (<code>/api/v1/skills/…</code>, MCP) passam a dar 404.</p>
        ${t.moveError ? `<div class="form-alert form-alert-error">${escapeHtml(t.moveError)}</div>` : ''}
        ${t.moveOk ? `<div class="form-alert">${escapeHtml(t.moveOk)}</div>` : ''}
        <div class="member-add">
          <select data-move-skill-id ${t.moveBusy ? 'disabled' : ''}>
            <option value="">— escolha a skill —</option>
            ${skills.map((s) => `<option value="${escapeHtml(s.id)}" ${sel === s.id ? 'selected' : ''}>${escapeHtml(s.nome || s.id)} · ${escapeHtml(s.id)}</option>`).join('')}
          </select>
          <select data-move-skill-domain ${!sel || t.moveBusy ? 'disabled' : ''}>
            <option value="">— domínio de destino —</option>
            ${targets.map((d) => `<option value="${escapeHtml(d)}" ${t.moveToDomain === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
          </select>
          <button class="ghost-button small" data-action="moveSkillConfirm" ${!sel || !t.moveToDomain || t.moveBusy ? 'disabled' : permissionAttrs('curar')}>${icon('folder')}${t.moveBusy ? 'movendo…' : 'Mover'}</button>
        </div>
        ${sel && t.moveToDomain ? `<p class="gov-counts"><code>${escapeHtml(sel)}</code> → <code>${escapeHtml(t.moveToDomain + '/' + sel.split('/').slice(1).join('/'))}</code></p>` : ''}
    `;
  }

  async function moveSkillConfirm() {
    const t = state.domainsAdmin;
    if (!t || !t.moveSkillId || !t.moveToDomain) return;
    t.moveBusy = true;
    t.moveError = null;
    t.moveOk = null;
    renderShell();
    try {
      const res = await fetch('/api/admin/skills/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: t.moveSkillId, toDomain: t.moveToDomain })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      t.moveBusy = false;
      t.moveOk = `Skill movida: ${data.from} → ${data.to} (${data.linkFiles} link(s), ${data.ledgerFiles} arquivo(s) de governança atualizados).`;
      t.moveSkillId = '';
      t.moveToDomain = '';
      await provider.reload();
      await refresh();
      await loadDomainsCommonsCounts();
      toast('Skill movida de domínio.', 'success');
    } catch (error) {
      t.moveBusy = false;
      t.moveError = error.message || 'Erro de rede.';
    }
    renderShell();
  }

  async function openDomainsAdmin() {
    if (!roleAllows('curar') && !domainsNavVisible()) {
      return;
    }
    state.domainsAdmin = {
      list: [],
      draft: '',
      busy: true,
      error: null,
      commonsCounts: {},
      query: '',
      page: 1,
      collapsed: {}
    };
    renderShell();
    try {
      // the active balde's vocabulary; readable by everyone (the menu page also serves its owners)
      const res = await fetch('/api/domains');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      state.domainsAdmin = {
        list: data.domains || [],
        draft: '',
        busy: false,
        error: null,
        commonsCounts: {},
        query: '',
        page: 1,
        collapsed: {}
      };
      state.domainList = data.domains || state.domainList;
    } catch (error) {
      state.domainsAdmin = {
        list: [],
        draft: '',
        busy: false,
        error: error.message || 'Erro de rede.',
        commonsCounts: {},
        query: '',
        page: 1,
        collapsed: {}
      };
    }
    renderShell();
    await loadDomainsCommonsCounts();
  }

  // Per-domain commons-concept counts for the Domínios table (client-side, mirrors
  // the skills-per-domain count). A concept's domain is its path prefix.
  async function loadDomainsCommonsCounts() {
    if (!state.domainsAdmin) {
      return;
    }
    try {
      const res = await fetch('/api/commons');
      const data = await readJsonResponse(res);
      const concepts = (res.ok && data.ok !== false && data.concepts) || [];
      const counts = {};
      for (const c of concepts) {
        const d = commonsDomainKey(c.path);
        if (d && d !== '—') {
          counts[d] = (counts[d] || 0) + 1;
        }
      }
      if (state.domainsAdmin) {
        state.domainsAdmin.commonsCounts = counts;
        renderShell();
      }
    } catch (error) {
      /* leave commons counts at 0 */
    }
  }

  // Persist the domain vocabulary immediately — add / remove / save all funnel here, so a change
  // survives a refresh WITHOUT a separate "Salvar" step (the old bug: "Adicionar" only mutated the
  // local list). Optimistic: shows `nextList` at once, reverts to the previous list if the PUT fails.
  // Mutates t.list in place (preserving commonsCounts), rather than replacing the whole state object.
  async function persistDomainsAdmin(nextList) {
    const t = state.domainsAdmin;
    if (!t) {
      return false;
    }
    const prev = t.list;
    t.list = nextList;
    t.busy = true;
    t.error = null;
    renderShell();
    try {
      const res = await fetch('/api/admin/domains', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domains: nextList })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      t.list = data.domains || nextList;
      t.busy = false;
      state.domainList = data.domains || state.domainList;
      renderShell();
      return true;
    } catch (error) {
      t.list = prev; // revert the optimistic change
      t.busy = false;
      t.error = error.message;
      toast(error.message, 'warning');
      renderShell();
      return false;
    }
  }

  // Creating a domain SAVES it immediately (no separate "Salvar lista" step needed), through the
  // endpoint that admins and the active balde's owners share.
  async function addDomainAdmin(raw) {
    const t = state.domainsAdmin;
    if (!t) {
      return;
    }
    const d = normalizeDomain(raw);
    t.draft = '';
    if (!d) {
      renderShell();
      return;
    }
    if (t.list.includes(d)) {
      t.error = `O domínio "${d}" já existe.`;
      renderShell();
      return;
    }
    t.busy = true;
    t.error = null;
    renderShell();
    try {
      const res = await fetch('/api/domains/add', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: d })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      t.list = data.domains || [...t.list, d].sort();
      state.domainList = data.domains || state.domainList;
      if (!state.domainRestricted || state.domainCanManage) state.domainMine = state.domainList;
      toast(`Domínio "${data.domain || d}" criado.`, 'success');
    } catch (error) {
      t.error = error.message;
      toast(error.message, 'warning');
    }
    t.busy = false;
    renderShell();
  }

  // Removing a domain also persists immediately (git-committed, revertible; existing skills keep
  // their folder — it just stops being offered to new skills).
  async function removeDomainAdmin(domain) {
    const t = state.domainsAdmin;
    if (!t) {
      return;
    }
    if (await persistDomainsAdmin(t.list.filter((entry) => entry !== domain))) {
      toast(`Domínio "${domain}" removido da lista.`, 'success');
    }
  }

  // Still available: flushes a typed-but-not-added draft and re-persists. Add/remove already save
  // on their own, so this is now a belt-and-suspenders "save everything" button.
  async function saveDomainsAdmin() {
    const t = state.domainsAdmin;
    if (!t) {
      return;
    }
    const list = [...t.list];
    const leftover = normalizeDomain(t.draft);
    if (leftover && !list.includes(leftover)) {
      list.push(leftover);
    }
    t.draft = '';
    if (await persistDomainsAdmin(list.sort())) {
      toast('Lista de domínios salva.', 'success');
    }
  }
  function domainRenameStart(from) {
    const t = state.domainsAdmin;
    if (!t) {
      return;
    }
    t.renaming = from;
    t.renameTo = from;
    renderShell();
  }
  function domainRenameCancel() {
    const t = state.domainsAdmin;
    if (!t) {
      return;
    }
    t.renaming = null;
    t.renameTo = '';
    renderShell();
  }
  async function domainRenameConfirm() {
    const t = state.domainsAdmin;
    if (!t || !t.renaming) {
      return;
    }
    const from = t.renaming;
    const el = document.querySelector('[data-domain-rename-input]');
    const to = normalizeDomain(el ? el.value : t.renameTo);
    if (!to || to === from) {
      domainRenameCancel();
      return;
    }
    t.busy = true;
    renderShell();
    try {
      const res = await fetch('/api/admin/domains/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      toast(`Domínio "${from}" → "${to}": ${data.skills} skill(s) + ${data.concepts} conceito(s) movidos.`, 'success');
      // Preserve the table view-state (search / page / collapse / commons counts) across the rebuild.
      const keep = {
        query: t.query || '',
        page: t.page || 1,
        collapsed: t.collapsed || {},
        commonsCounts: t.commonsCounts || {}
      };
      state.domainsAdmin = {
        list: data.domains || [],
        draft: '',
        busy: false,
        error: null,
        renaming: null,
        renameTo: '',
        ...keep
      };
      state.domainList = data.domains || state.domainList;
      try {
        const r = await fetch('/api/skills');
        const j = await r.json();
        if (j && Array.isArray(j.skills)) {
          state.skills = j.skills;
        }
      } catch (error) {
        /* counts refresh on next load */
      }
    } catch (error) {
      t.busy = false;
      t.error = error.message;
      t.renaming = null;
      toast(error.message, 'warning');
    }
    renderShell();
  }
  function domainsSetSearch(value) {
    const t = state.domainsAdmin;
    if (!t) return;
    t.query = value;
    t.page = 1;
    renderShell();
    // keep focus + caret at end after the re-render (mirrors commonsSetFilter)
    requestAnimationFrame(() => {
      const el = document.querySelector('[data-domains-search]');
      if (el) {
        el.focus();
        const v = el.value;
        el.value = '';
        el.value = v;
      }
    });
  }
  function domainsSetPage(delta) {
    const t = state.domainsAdmin;
    if (!t) return;
    t.page = Math.max(1, (t.page || 1) + delta);
    renderShell();
  }
  function toggleDomainGroup(key) {
    const t = state.domainsAdmin;
    if (!t) return;
    t.collapsed = t.collapsed || {};
    t.collapsed[key] = !t.collapsed[key];
    renderShell();
  }

  function renderSystemPromptsCard() {
    const p = state.prompts;
    const rows =
      p && !p.busy && !p.error
        ? p.items.length
          ? p.items.map(renderPromptRow).join('')
          : '<p class="muted">Nenhum prompt.</p>'
        : p && p.error
          ? `<div class="form-alert form-alert-error">${escapeHtml(p.error)}</div>`
          : '<p class="muted">Carregando…</p>';
    return `
      <article class="settings-card prompts-card">
        <div class="settings-card-head">
          <h3>${icon('spark')} Prompts do sistema</h3>
          <span class="settings-card-sub">Prompts internos do assistente de criação de skills (Criar skill). Versionados em git; só admins editam.</span>
        </div>
        ${rows}
      </article>
    `;
  }

  function renderPromptRow(item) {
    return `
      <div class="prompt-row">
        <div class="prompt-row-head">
          <strong>${escapeHtml(item.label)}</strong>
          <span class="prompt-meta">${escapeHtml(item.id)} · saída ${escapeHtml(item.output)}</span>
        </div>
        <textarea data-prompt-id="${escapeHtml(item.id)}" rows="9" spellcheck="false" ${item.saving ? 'disabled' : ''}>${escapeHtml(item.draft != null ? item.draft : item.body)}</textarea>
        <div class="row-actions">
          <button class="ghost-button small" data-action="resetPrompt" data-id="${escapeHtml(item.id)}" ${item.saving ? 'disabled' : ''}>${icon('rollback')}Descartar</button>
          <button class="primary-button small" data-action="savePrompt" data-id="${escapeHtml(item.id)}" ${item.saving ? 'disabled' : ''}>${icon('check')}${item.saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    `;
  }

  async function openSettingsPrompts() {
    if (!isAdmin()) {
      return;
    }
    state.prompts = { items: [], busy: true, error: null };
    renderShell();
    try {
      const res = await fetch('/api/admin/prompts');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      state.prompts = {
        items: (data.prompts || []).map((prompt) => ({ ...prompt, draft: prompt.body, saving: false })),
        busy: false,
        error: null
      };
    } catch (error) {
      state.prompts = { items: [], busy: false, error: error.message || 'Erro de rede.' };
    }
    renderShell();
  }

  async function savePrompt(id) {
    const p = state.prompts;
    const item = p && p.items.find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    item.saving = true;
    renderShell();
    try {
      const res = await fetch('/api/admin/prompts', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, body: item.draft })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      item.body = data.prompt.body;
      item.draft = data.prompt.body;
      item.updatedAt = data.prompt.updatedAt;
      toast('Prompt salvo.', 'success');
    } catch (error) {
      toast(error.message, 'warning');
    }
    item.saving = false;
    renderShell();
  }

  function resetPrompt(id) {
    const p = state.prompts;
    const item = p && p.items.find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    item.draft = item.body;
    renderShell();
  }

  function renderTokensCard() {
    const t = state.tokens;
    if (!t) {
      return '<article class="settings-card"><h3>Minhas chaves de API</h3><p>Carregando…</p></article>';
    }
    if (t.serviceReady === false) {
      if (t.mcpLocal) {
        return '<article class="settings-card"><h3>Minhas chaves de API</h3><p>Nesta instalação local, o conector MCP (Claude Desktop / Claude Code / Codex) usa a <strong>chave da máquina</strong> automaticamente — <strong>não há chave pessoal para criar aqui</strong>. Conecte em <strong>Clientes de IA (CLI) → Conectar via MCP</strong>. (Chaves pessoais de API existem só na implantação hospedada com Authentik.)</p></article>';
      }
      return '<article class="settings-card"><h3>Minhas chaves de API</h3><p>Chaves pessoais de API ainda não estão disponíveis — um admin precisa configurar <code>AUTHENTIK_SERVICE_TOKEN</code>.</p></article>';
    }
    const created = t.created;
    const revealed = t.revealed || {};
    // The label lives in the token description as "Balde API — <label>"; strip the prefix for editing.
    const stripTokenLabel = (desc) =>
      String(desc || '')
        .replace(/^Balde API\s*(?:—\s*)?/, '')
        .trim();
    const rows =
      (t.tokens || [])
        .map((k) => {
          const key = revealed[k.identifier];
          if (t.renaming === k.identifier) {
            return `
      <tr>
        <td><code>${escapeHtml(k.identifier)}</code></td>
        <td colspan="2" class="token-rename-cell">
          <input data-token-rename-input value="${escapeHtml(stripTokenLabel(k.description))}" placeholder="ex.: MCP no notebook" maxlength="60" ${t.busy ? 'disabled' : ''}>
          <button class="link-button" data-action="saveRenameToken" data-identifier="${escapeHtml(k.identifier)}" ${t.busy ? 'disabled' : ''}>salvar</button>
          <button class="link-button" data-action="cancelRenameToken" ${t.busy ? 'disabled' : ''}>cancelar</button>
        </td>
      </tr>`;
          }
          return `
      <tr>
        <td><code>${escapeHtml(k.identifier)}</code>${key ? `<code class="token-key">${escapeHtml(key)}</code>` : ''}</td>
        <td>${escapeHtml(k.description || '')}</td>
        <td class="token-actions">
          <button class="link-button" data-action="toggleRevealToken" data-identifier="${escapeHtml(k.identifier)}" ${t.busy ? 'disabled' : ''}>${key ? 'ocultar' : 'revelar'}</button>
          ${key ? `<button class="link-button" data-action="copyToken" data-identifier="${escapeHtml(k.identifier)}">copiar</button>` : ''}
          <button class="link-button" data-action="renameApiToken" data-identifier="${escapeHtml(k.identifier)}" ${t.busy ? 'disabled' : ''}>renomear</button>
          <button class="link-button danger" data-action="revokeApiToken" data-identifier="${escapeHtml(k.identifier)}" ${t.busy ? 'disabled' : ''}>revogar</button>
        </td>
      </tr>`;
        })
        .join('') || '<tr><td colspan="3" class="muted">Nenhuma chave ainda.</td></tr>';
    return `
      <article class="settings-card tokens-card">
        <h3>Minhas chaves de API</h3>
        <p>Chaves pessoais para as ferramentas de máquina do Balde (<code>/api/v1</code>) — a "chave MCP". Cada uma é <strong>sua</strong>, revogável, e para de funcionar se sua conta for desativada. Cole em ferramentas MCP, GPT Actions ou no add-in. <strong>Dê um nome</strong> a cada chave (ao criar, ou em <em>renomear</em>) para saber onde usa cada uma. <strong>Não é exibição única</strong> — use <em>revelar</em> na lista para vê-la de novo quando quiser.</p>
        ${t.error ? `<div class="form-alert form-alert-error">${escapeHtml(t.error)}</div>` : ''}
        ${
          created
            ? `
          <div class="form-alert form-alert-success token-reveal">
            <p><strong>Chave criada:</strong></p>
            <code class="token-key">${escapeHtml(created.key)}</code>
            <div class="row-actions">
              <button class="ghost-button" data-action="copyNewToken">Copiar</button>
              <button class="link-button" data-action="dismissNewToken">ok, guardei</button>
            </div>
            <p class="field-hint">Você pode revelá-la de novo na lista abaixo a qualquer momento.</p>
          </div>`
            : ''
        }
        <div class="api-table-wrap">
          <table class="api-table">
            <thead><tr><th>Identificador</th><th>Descrição</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="manual-form">
          <label>Rótulo (opcional)<input data-token-label placeholder="ex.: MCP no notebook" ${t.busy ? 'disabled' : ''}></label>
        </div>
        <div class="row-actions">
          <button class="primary-button" data-action="createApiToken" ${t.busy ? 'disabled' : ''}>${icon('check')}${t.busy ? 'Criando…' : 'Criar nova chave'}</button>
        </div>
      </article>`;
  }
  // Access control UI: Grupos (settings) + per-skill Acesso & Curadoria tab.

  // Settings → Grupos card (curator/admin see it; only admin mutates)
  // "Grupos" — tab body of the Administração page (access cohorts). Returns
  // body-only markup (incl. its loading / editor states) so it composes under
  // the admin tabs.
  function renderGroupsBody() {
    const g = state.groups;
    if (!g) {
      return '<p class="repo-empty">Carregando…</p>';
    }
    if (state.groupEditor) {
      return renderGroupEditor();
    }
    const rows =
      (g.list || [])
        .map(
          (grp) => `
      <tr>
        <td><strong>${escapeHtml(grp.name)}</strong><br><code>${escapeHtml(grp.slug)}</code></td>
        <td>${escapeHtml(grp.description || '')}</td>
        <td>${grp.members.length}</td>
        <td>${
          g.canManage
            ? `
          <button class="link-button" data-action="editGroup" data-slug="${escapeHtml(grp.slug)}">editar</button>
          <button class="link-button danger" data-action="deleteGroup" data-slug="${escapeHtml(grp.slug)}" data-name="${escapeHtml(grp.name)}">excluir</button>`
            : '<span class="muted">—</span>'
        }</td>
      </tr>`
        )
        .join('') || '<tr><td colspan="4" class="muted">Nenhum grupo ainda.</td></tr>';
    return `
        <div class="section-heading">
          <div>
            <p class="eyebrow">Acesso</p>
            <h2>Grupos de acesso</h2>
          </div>
          ${g.canManage ? `<button class="primary-button" data-action="newGroup">${icon('plus')}Novo grupo</button>` : ''}
        </div>
        <p class="groups-intro">Coortes reutilizáveis (ex.: <em>Comercial</em>, <em>Jurídico</em>) para dar <strong>acesso</strong> ou <strong>curadoria</strong> a skills sensíveis. Nativos do Balde — versionados no corpus, sem depender do Authentik.</p>
        ${g.error ? `<div class="form-alert form-alert-error">${escapeHtml(g.error)}</div>` : ''}
        <div class="api-table-wrap">
          <table class="api-table">
            <thead><tr><th>Grupo</th><th>Descrição</th><th>Membros</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
    `;
  }

  function renderGroups() {
    if (!isAdmin()) {
      return '<section class="panel empty-state">Acesso restrito a administradores.</section>';
    }
    return `<section class="panel groups-page">${renderGroupsBody()}</section>`;
  }

  // Checkbox roster row shared by the group editor and the access pickers.
  function memberRowHtml(email, name, checked, checkAttr) {
    const hay = `${name || ''} ${email}`.toLowerCase();
    return `<label class="member-row" data-member-row data-haystack="${escapeHtml(hay)}">
      <input type="checkbox" ${checkAttr} value="${escapeHtml(email)}" ${checked ? 'checked' : ''}>
      <span>${escapeHtml(name || email)}<small>${escapeHtml(email)}</small></span>
    </label>`;
  }

  function rosterChecklistHtml(roster, selectedList, checkAttr) {
    const sel = new Set((selectedList || []).map((s) => String(s).toLowerCase()));
    const rosterEmails = new Set(roster.map((u) => String(u.email).toLowerCase()));
    const extras = (selectedList || []).filter((s) => !rosterEmails.has(String(s).toLowerCase()));
    const rows = [
      ...roster.map((u) => memberRowHtml(u.email, u.name, sel.has(String(u.email).toLowerCase()), checkAttr)),
      ...extras.map((m) => memberRowHtml(m, m, true, checkAttr))
    ].join('');
    return rows || '<p class="muted">Roster vazio (usuários aparecem após o primeiro login).</p>';
  }

  function renderGroupEditor() {
    const e = state.groupEditor;
    const roster = (state.groups && state.groups.roster) || [];
    return `
      <article class="settings-card group-editor">
        <h3>${e.isNew ? 'Novo grupo' : `Editar grupo — ${escapeHtml(e.name)}`}</h3>
        ${e.error ? `<div class="form-alert form-alert-error">${escapeHtml(e.error)}</div>` : ''}
        <div class="manual-form">
          <label>Nome<input data-group-field="name" value="${escapeHtml(e.name || '')}" placeholder="ex.: Comercial" ${e.busy ? 'disabled' : ''}></label>
          <label>Descrição<input data-group-field="description" value="${escapeHtml(e.description || '')}" placeholder="opcional" ${e.busy ? 'disabled' : ''}></label>
        </div>
        <div class="member-picker" data-axis="members">
          <div class="member-picker-head"><strong>Membros</strong>
            <input class="member-search" data-roster-search placeholder="filtrar…" ${e.busy ? 'disabled' : ''}></div>
          <div class="member-list" data-member-list>${rosterChecklistHtml(roster, e.members, 'data-member-check')}</div>
          <div class="member-add">
            <input data-free-email placeholder="adicionar por e-mail (fora do roster)" ${e.busy ? 'disabled' : ''}>
            <button class="ghost-button small" data-action="addFreeEmail" ${e.busy ? 'disabled' : ''}>${icon('plus')}Adicionar</button>
          </div>
        </div>
        <div class="row-actions">
          <button class="ghost-button" data-action="cancelGroupEditor" ${e.busy ? 'disabled' : ''}>${icon('rollback')}Cancelar</button>
          ${!e.isNew ? `<button class="ghost-button danger" data-action="deleteGroup" data-slug="${escapeHtml(e.slug)}" data-name="${escapeHtml(e.name)}" ${e.busy ? 'disabled' : ''}>${icon('x')}Excluir</button>` : ''}
          <button class="primary-button" data-action="saveGroup" ${e.busy ? 'disabled' : ''}>${icon('check')}${e.busy ? 'Salvando…' : 'Salvar grupo'}</button>
        </div>
      </article>`;
  }

  async function openSettingsGroups() {
    if (!(isCurator() || isAdmin())) {
      state.groups = null;
      return;
    }
    state.groups = { list: [], roster: [], canManage: isAdmin(), busy: true, error: null };
    renderShell();
    try {
      const [gr, ur] = await Promise.all([fetch('/api/groups'), fetch('/api/users')]);
      const gj = await gr.json().catch(() => ({}));
      const uj = await ur.json().catch(() => ({}));
      state.groups = {
        list: gj.groups || [],
        roster: uj.users || [],
        canManage: !!gj.canManage,
        busy: false,
        error: gr.ok ? null : gj.error || 'Falha ao carregar grupos.'
      };
    } catch (error) {
      state.groups = {
        list: [],
        roster: [],
        canManage: isAdmin(),
        busy: false,
        error: error.message || 'Erro de rede.'
      };
    }
    renderShell();
  }

  function newGroup() {
    state.groupEditor = { slug: null, name: '', description: '', members: [], isNew: true, busy: false, error: null };
    renderShell();
  }
  function editGroup(slug) {
    const grp = ((state.groups && state.groups.list) || []).find((x) => x.slug === slug);
    if (!grp) return;
    state.groupEditor = {
      slug: grp.slug,
      name: grp.name,
      description: grp.description || '',
      members: [...grp.members],
      isNew: false,
      busy: false,
      error: null
    };
    renderShell();
  }
  function cancelGroupEditor() {
    state.groupEditor = null;
    renderShell();
  }

  // DOM-side add (no re-render, so the search/checkbox state the user already set survives).
  function appendFreeEmailRow(listEl, email, checkAttr) {
    if ([...listEl.querySelectorAll(`input[${checkAttr.split('=')[0]}]`)].some((c) => c.value.toLowerCase() === email))
      return false;
    listEl.insertAdjacentHTML('afterbegin', memberRowHtml(email, email, true, checkAttr));
    return true;
  }
  function addFreeEmail() {
    const input = document.querySelector('[data-free-email]');
    const list = document.querySelector('.group-editor [data-member-list]');
    if (!input || !list) return;
    const email = (input.value || '').trim().toLowerCase();
    if (!email.includes('@')) {
      toast('E-mail inválido.');
      return;
    }
    appendFreeEmailRow(list, email, 'data-member-check');
    input.value = '';
  }

  async function saveGroup() {
    const e = state.groupEditor;
    if (!e) return;
    const name = (document.querySelector('[data-group-field="name"]') || {}).value?.trim() || '';
    const description = (document.querySelector('[data-group-field="description"]') || {}).value?.trim() || '';
    const members = [...document.querySelectorAll('[data-member-check]:checked')].map((c) => c.value);
    if (!name) {
      e.error = 'Nome é obrigatório.';
      renderShell();
      return;
    }
    e.name = name;
    e.description = description;
    e.members = members;
    e.busy = true;
    e.error = null;
    renderShell();
    try {
      const res = await fetch(e.isNew ? '/api/groups' : `/api/groups/${encodeURIComponent(e.slug)}`, {
        method: e.isNew ? 'POST' : 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description, members })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        e.busy = false;
        e.error = data.error || 'Falha ao salvar grupo.';
        renderShell();
        return;
      }
      state.groupEditor = null;
      await openSettingsGroups();
      toast('Grupo salvo.');
    } catch (error) {
      e.busy = false;
      e.error = error.message || 'Erro de rede.';
      renderShell();
    }
  }

  async function deleteGroup(slug, name) {
    if (!window.confirm(`Excluir o grupo "${name || slug}"? Skills que o referenciam deixam de concedê-lo.`)) return;
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(slug)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast(data.error || 'Falha ao excluir grupo.');
        return;
      }
      state.groupEditor = null;
      await openSettingsGroups();
      toast('Grupo excluído.');
    } catch (error) {
      toast(error.message || 'Erro de rede.');
    }
  }

  return {
    openCategoriasAdmin,
    saveCategoriasAdmin,
    renderCategoriasBody,
    renderDomainsView,
    renderDomainsBody,
    renderMoveSkillBody,
    renderUserDomainsPanel,
    loadUserDomainsAdmin,
    udEdit,
    udCancel,
    udToggle,
    udSave,
    moveSkillConfirm,
    openDomainsAdmin,
    addDomainAdmin,
    removeDomainAdmin,
    saveDomainsAdmin,
    domainRenameStart,
    domainRenameCancel,
    domainRenameConfirm,
    domainsSetSearch,
    domainsSetPage,
    toggleDomainGroup,
    renderSystemPromptsCard,
    openSettingsPrompts,
    savePrompt,
    resetPrompt,
    renderTokensCard,
    renderGroupsBody,
    renderGroups,
    memberRowHtml,
    rosterChecklistHtml,
    openSettingsGroups,
    newGroup,
    editGroup,
    cancelGroupEditor,
    addFreeEmail,
    saveGroup,
    deleteGroup
  };
}
