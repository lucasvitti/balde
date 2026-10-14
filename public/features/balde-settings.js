export function createBaldeSettingsFeature({
  state,
  renderTokensCard,
  renderAiCliCard,
  renderAppearanceCards,
  renderAiProviderCard,
  renderConnDiagCard,
  renderShell,
  toast,
  refreshRepos,
  escapeHtml,
  icon,
  switchRepo,
  parseCsvList
}) {
  function renderSettings() {
    const tab = ['provider', 'cli', 'keys', 'appearance', 'notify', 'balde'].includes(state.settingsTab)
      ? state.settingsTab
      : 'provider';
    const body =
      tab === 'keys'
        ? renderTokensCard()
        : tab === 'cli'
          ? renderAiCliCard()
          : tab === 'appearance'
            ? renderAppearanceCards()
            : tab === 'notify'
              ? renderNotifyCard()
              : tab === 'balde'
                ? renderBaldesUserCards()
                : renderAiProviderCard() + renderConnDiagCard();
    return `
      <section class="panel settings-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Configurações</p>
            <h2>Suas preferências</h2>
          </div>
        </div>
        <div class="tabs" role="tablist">
          <button class="tab ${tab === 'provider' ? 'active' : ''}" data-action="setSettingsTab" data-settings-tab="provider">Provedor de IA</button>
          <button class="tab ${tab === 'cli' ? 'active' : ''}" data-action="setSettingsTab" data-settings-tab="cli">Clientes de IA (CLI)</button>
          <button class="tab ${tab === 'keys' ? 'active' : ''}" data-action="setSettingsTab" data-settings-tab="keys">Minhas chaves de API</button>
          <button class="tab ${tab === 'appearance' ? 'active' : ''}" data-action="setSettingsTab" data-settings-tab="appearance">Geral</button>
          <button class="tab ${tab === 'notify' ? 'active' : ''}" data-action="setSettingsTab" data-settings-tab="notify">Notificações</button>
          <button class="tab ${tab === 'balde' ? 'active' : ''}" data-action="setSettingsTab" data-settings-tab="balde">Baldes</button>
        </div>
        ${body}
      </section>
    `;
  }
  async function loadNotifyPrefsState() {
    state.notifyPrefs = { digest: true, perItem: true, loading: true, saving: false };
    renderShell();
    try {
      const res = await fetch('/api/me/prefs');
      const d = await res.json().catch(() => ({}));
      const n = (res.ok && d.notify) || {};
      state.notifyPrefs = {
        digest: n.digest !== false,
        perItem: n.perItem !== false,
        desktop: n.desktop !== false,
        loading: false,
        saving: false
      };
    } catch (error) {
      state.notifyPrefs = { digest: true, perItem: true, desktop: true, loading: false, saving: false };
    }
    renderShell();
  }
  async function toggleNotifyPref(pref) {
    const n = state.notifyPrefs;
    if (!n || n.loading || n.saving) return;
    const next = { digest: n.digest, perItem: n.perItem, desktop: n.desktop, [pref]: !n[pref] };
    n.digest = next.digest;
    n.perItem = next.perItem;
    n.desktop = next.desktop;
    n.saving = true;
    renderShell(); // optimistic
    try {
      const res = await fetch('/api/me/prefs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notify: { digest: next.digest, perItem: next.perItem, desktop: next.desktop } })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      n.digest = !!(d.notify && d.notify.digest);
      n.perItem = !!(d.notify && d.notify.perItem);
      n.desktop = !!(d.notify && d.notify.desktop);
      toast('Preferências de notificação salvas.', 'success');
    } catch (error) {
      n[pref] = !next[pref]; // roll back the optimistic flip
      toast(error.message || 'Falha ao salvar.', 'warning');
    }
    n.saving = false;
    renderShell();
  }
  function renderNotifyCard() {
    const n = state.notifyPrefs;
    if (!n) {
      setTimeout(() => loadNotifyPrefsState(), 0);
      return '<div class="repo-empty">Carregando preferências…</div>';
    }
    if (n.loading) return '<div class="repo-empty">Carregando preferências…</div>';
    const row = (pref, checked, title, desc) => `
      <label class="notify-row">
        <input type="checkbox" data-action="toggleNotifyPref" data-pref="${pref}" ${checked ? 'checked' : ''} ${n.saving ? 'disabled' : ''}>
        <span class="notify-row-text"><strong>${title}</strong><small>${desc}</small></span>
      </label>`;
    return `
        <article class="settings-card">
          <h3>Notificações por e-mail</h3>
          <p>E-mails sobre o que espera por você no Balde — enviados para o endereço da sua conta. <strong>Ativadas por padrão</strong>; desmarque o que não quiser receber.</p>
          <div class="notify-rows">
            ${row('digest', n.digest, 'Resumo diário', 'Um e-mail por dia (manhã) com suas pendências: contribuições na fila, rascunhos aguardando promoção, feedbacks a revisar e o uso das suas skills nos últimos 7 dias. Dias sem novidade não geram e-mail.')}
            ${row('perItem', n.perItem, 'Notificação por item', 'Um e-mail quando algo novo chega nas skills que você cuida: feedback Errado/Fraco (com quem deu e o contexto) ou nova contribuição na fila. Eventos próximos são agrupados num único e-mail.')}
            ${row('desktop', n.desktop, 'Notificações do Windows (app local)', 'Um balão nativo do Windows — que também fica no painel de notificações — quando chega contribuição nova na Fila (envios de outras pessoas; os seus não notificam).')}
          </div>
        </article>`;
  }
  // manifest (balde-repo.json). On the local version the user also creates or adds baldes in any
  // folder; that list lives in their per-user config (%APPDATA%\Balde\settings.json).
  const baldeRoleLabel = (r) => (r.isOwner ? 'Dono' : r.isAdmin ? 'Admin' : r.canCurate ? 'Curador' : 'Membro');
  const readBaldesFields = (selector, key) => {
    const out = {};
    document.querySelectorAll(selector).forEach((el) => {
      out[el.dataset[key]] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return out;
  };

  async function loadBaldesUser() {
    state.baldesUser = { ...(state.baldesUser || {}), loading: true };
    let mounts = [];
    let configPath = null;
    try {
      const d = await (await fetch('/api/repos/mounts')).json();
      if (d && d.ok) {
        mounts = d.mounts || [];
        configPath = d.configPath || null;
      }
    } catch (error) {
      mounts = [];
    }
    await refreshRepos();
    state.baldesUser = { ...state.baldesUser, loading: false, mounts, configPath };
    renderShell();
  }

  function renderBaldesUserCards() {
    const b = state.baldesUser;
    if (!b || (b.loading && !b.mounts)) {
      if (!b) setTimeout(() => loadBaldesUser(), 0);
      return '<div class="repo-empty">Carregando baldes…</div>';
    }
    const repos = state.repos || [];
    const local = !!state.mountsEnabled;
    const broken = (b.mounts || []).filter((m) => !m.ok);
    const ed = b.editing ? repos.find((r) => r.name === b.editing) : null;
    const where = (r) =>
      r.source === 'local'
        ? r.dir
          ? `<code class="muted">${escapeHtml(r.dir)}</code>`
          : '<span class="muted">pasta própria</span>'
        : '<span class="muted">corpus compartilhado</span>';
    const row = (r) => `
      <tr>
        <td><strong>${escapeHtml(r.titulo || r.name)}</strong><br><code class="muted">${escapeHtml(r.name)}</code></td>
        <td>${where(r)}</td>
        <td>${baldeRoleLabel(r)}</td>
        <td>${r.open ? 'aberto a todos' : 'restrito'}</td>
        <td class="row-actions">
          ${r.name === state.activeRepo ? '<span class="muted">em uso</span>' : `<button class="ghost-button tiny" data-action="switchRepoTo" data-repo="${escapeHtml(r.name)}">Usar</button>`}
          ${r.isAdmin ? `<button class="ghost-button tiny" data-action="baldesUserEdit" data-repo="${escapeHtml(r.name)}">${icon('edit')}Acesso</button>` : ''}
          ${r.source === 'local' ? `<button class="ghost-button tiny" data-action="baldesUserUnmount" data-repo="${escapeHtml(r.name)}" title="Tira da sua lista. A pasta e os arquivos ficam onde estão.">Remover da lista</button>` : ''}
        </td>
      </tr>`;
    const csv = (list) => escapeHtml((list || []).join(', '));
    const a = (ed && ed.access) || {};
    const accessEditor = ed
      ? `
      <article class="settings-card">
        <h3>Acesso de <code>${escapeHtml(ed.name)}</code></h3>
        <p class="muted">O acesso fica no próprio balde (<code>balde-repo.json</code>, na pasta dele), então vale para todos que usam esta pasta. Donos e os grupos de admins administram o balde (acesso, domínios, políticas); curadores aprovam e editam o conteúdo; membros leem e contribuem pela Fila. E-mails e grupos separados por vírgula.</p>
        <div class="balde-form-grid">
          <label>Título<input data-baldes-user-field="titulo" value="${escapeHtml(ed.titulo || '')}"></label>
          <label class="notify-row"><input type="checkbox" data-baldes-user-field="open" ${a.open ? 'checked' : ''} ${ed.name === 'corporate' ? 'disabled' : ''}><span class="notify-row-text"><strong>Aberto a todos</strong><small>Qualquer usuário autenticado lê este balde.</small></span></label>
          <label>Donos<input data-baldes-user-field="owners" value="${csv(a.owners)}"></label>
          <label>Grupos de admins<input data-baldes-user-field="adminGroups" value="${csv(a.adminGroups)}"></label>
          <label>Curadores<input data-baldes-user-field="curators" value="${csv(a.curators)}"></label>
          <label>Membros<input data-baldes-user-field="members" value="${csv(a.members)}"></label>
          <label>Grupos de curadores<input data-baldes-user-field="curatorGroups" value="${csv(a.curatorGroups)}"></label>
          <label>Grupos de membros<input data-baldes-user-field="groups" value="${csv(a.groups)}"></label>
        </div>
        <div class="form-actions">
          <button class="primary-button small" data-action="baldesUserSaveAccess">${icon('check')}Salvar</button>
          <button class="ghost-button small" data-action="baldesUserCancel">Cancelar</button>
        </div>
        ${renderAcessoOneDrive(ed)}
      </article>`
      : '';
    const brokenCard = broken.length
      ? `
      <article class="settings-card">
        <h3>Indisponíveis nesta máquina</h3>
        <p class="muted">Estão na sua lista mas não abriram aqui (por exemplo, uma pasta que só existe em outro computador).</p>
        <ul>${broken.map((m) => `<li><code>${escapeHtml(m.path)}</code>: ${escapeHtml(m.error || 'indisponível')} <button class="ghost-button tiny" data-action="baldesUserUnmountPath" data-path="${escapeHtml(m.path)}">Remover da lista</button></li>`).join('')}</ul>
      </article>`
      : '';
    const addCards = local
      ? `
      <article class="settings-card">
        <h3>Criar balde</h3>
        <p class="muted">Escolha uma pasta vazia (ou que ainda não existe) em qualquer lugar: no seu computador, no seu OneDrive ou numa pasta de equipe. O Balde cria a estrutura lá e o balde é seu (dono), privado até você abrir o acesso. Cole o caminho completo da pasta.</p>
        <div class="balde-form-grid">
          <label>Pasta<input data-baldes-new-field="path" value="${escapeHtml(b.newPath || '')}" placeholder="C:\\Users\\voce\\OneDrive\\Baldes\\meu-balde"></label>
          <label>Nome <small>(slug, permanente)</small><input data-baldes-new-field="name" value="${escapeHtml(b.newName || '')}" placeholder="ex.: vendas-2027"></label>
          <label>Título<input data-baldes-new-field="titulo" value="${escapeHtml(b.newTitulo || '')}" placeholder="ex.: Vendas 2027"></label>
          <label>Governança<select data-baldes-new-field="profile"><option value="light">leve (sem fila)</option><option value="full">completa (fila)</option></select></label>
        </div>
        <div class="form-actions"><button class="primary-button small" data-action="baldesUserCreate">${icon('plus')}Criar balde</button></div>
      </article>
      <article class="settings-card">
        <h3>Adicionar balde existente</h3>
        <p class="muted">Aponte para uma pasta que já é um balde (tem <code>balde-repo.json</code>), por exemplo um balde que um colega compartilhou com você. Vale o acesso que o próprio balde define. Uma pasta com a estrutura do Balde mas sem esse arquivo pode ser adotada: informe um nome.</p>
        <div class="balde-form-grid">
          <label>Pasta<input data-baldes-mount-field="path" placeholder="C:\\Users\\voce\\OneDrive - Empresa\\Equipe\\balde-vendas"></label>
          <label>Nome <small>(só para adotar uma pasta sem balde-repo.json)</small><input data-baldes-mount-field="name" placeholder="opcional"></label>
        </div>
        <div class="form-actions"><button class="ghost-button small" data-action="baldesUserMount">${icon('plus')}Adicionar</button></div>
      </article>`
      : `
      <article class="settings-card">
        <h3>Meu Balde</h3>
        <p>Um <strong>balde pessoal</strong>: espaço privado com seus próprios domínios, skills e cápsulas, governança leve (sem fila) e ledger git separado. Só você (e admins) enxergam. Skills suas podem referenciar o corpus corporativo com links <code>/@corporate/...</code>.</p>
        ${
          repos.some((r) => r.name.startsWith('pessoal-'))
            ? `
        <p class="muted">Você já tem um balde pessoal: troque para ele no seletor da barra superior.</p>`
            : `
        <div class="form-actions"><button class="primary-button small" data-action="meuBaldeCreate">${icon('plus')}Criar meu balde</button></div>`
        }
      </article>`;
    return `
      <article class="settings-card">
        <h3>Seus baldes</h3>
        <p class="muted">Cada balde é uma pasta com o seu conteúdo e o seu próprio controle de acesso.${local ? ` Os do corpus compartilhado aparecem para todos; os demais são pastas que você criou ou adicionou${b.configPath ? ` (lista em <code>${escapeHtml(b.configPath)}</code>)` : ''}.` : ''}</p>
        ${b.error ? `<div class="form-alert form-alert-error">${escapeHtml(b.error)}</div>` : ''}
        ${b.ok ? `<div class="form-alert">${escapeHtml(b.ok)}</div>` : ''}
        <div class="table-scroll"><table class="mini-table baldes-table">
          <thead><tr><th>Balde</th><th>Onde</th><th>Seu papel</th><th>Acesso</th><th></th></tr></thead>
          <tbody>${repos.map(row).join('')}</tbody>
        </table></div>
      </article>
      ${accessEditor}
      ${brokenCard}
      ${addCards}`;
  }

  async function baldesUserCreate() {
    const f = readBaldesFields('[data-baldes-new-field]', 'baldesNewField');
    state.baldesUser = {
      ...state.baldesUser,
      newPath: f.path,
      newName: f.name,
      newTitulo: f.titulo,
      error: null,
      ok: null
    };
    try {
      const res = await fetch('/api/repos/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: f.path, name: f.name, titulo: f.titulo, profile: f.profile })
      });
      const data = await res.json();
      if (!data.ok) {
        state.baldesUser.error = data.error || 'Não foi possível criar o balde.';
        renderShell();
        return;
      }
      state.baldesUser = {
        ...state.baldesUser,
        newPath: '',
        newName: '',
        newTitulo: '',
        ok: `Balde "${data.repo.titulo || data.repo.name}" criado em ${data.repo.dir}. Clique em Usar para abri-lo.`
      };
    } catch (error) {
      state.baldesUser.error = 'Não foi possível criar o balde.';
      renderShell();
      return;
    }
    await loadBaldesUser();
  }

  async function baldesUserMount() {
    const f = readBaldesFields('[data-baldes-mount-field]', 'baldesMountField');
    state.baldesUser = { ...state.baldesUser, error: null, ok: null };
    try {
      const res = await fetch('/api/repos/mount', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: f.path, name: f.name || undefined })
      });
      const data = await res.json();
      if (!data.ok) {
        state.baldesUser.error = data.error || 'Não foi possível adicionar o balde.';
        renderShell();
        return;
      }
      state.baldesUser.ok = `Balde "${(data.repo && (data.repo.titulo || data.repo.name)) || ''}" adicionado.`;
    } catch (error) {
      state.baldesUser.error = 'Não foi possível adicionar o balde.';
      renderShell();
      return;
    }
    await loadBaldesUser();
  }

  async function baldesUserUnmount(name, path) {
    if (!window.confirm('Tirar este balde da sua lista? A pasta e os arquivos continuam onde estão.')) return;
    state.baldesUser = { ...state.baldesUser, error: null, ok: null };
    try {
      const res = await fetch('/api/repos/unmount', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(path ? { path } : { name })
      });
      const data = await res.json();
      if (!data.ok) {
        state.baldesUser.error = data.error || 'Não foi possível remover.';
        renderShell();
        return;
      }
      state.baldesUser.ok = 'Removido da sua lista.';
    } catch (error) {
      state.baldesUser.error = 'Não foi possível remover.';
      renderShell();
      return;
    }
    if (name && name === state.activeRepo) {
      await switchRepo('corporate');
      return;
    } // it was the active balde
    await loadBaldesUser();
  }

  async function baldesUserSaveAccess() {
    const b = state.baldesUser;
    if (!b || !b.editing) return;
    const f = readBaldesFields('[data-baldes-user-field]', 'baldesUserField');
    const body = {
      titulo: f.titulo,
      access: {
        open: !!f.open,
        owners: parseCsvList(f.owners),
        adminGroups: parseCsvList(f.adminGroups),
        curators: parseCsvList(f.curators),
        members: parseCsvList(f.members),
        curatorGroups: parseCsvList(f.curatorGroups),
        groups: parseCsvList(f.groups)
      }
    };
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(b.editing)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!data.ok) {
        state.baldesUser.error = data.error || 'Não foi possível salvar.';
        renderShell();
        return;
      }
      state.baldesUser = {
        ...state.baldesUser,
        error: null,
        ok: 'Política salva no Balde. A aplicação no OneDrive continua pendente; use Aplicar e confira o resultado.'
      };
    } catch (error) {
      state.baldesUser.error = 'Não foi possível salvar.';
      renderShell();
      return;
    }
    await loadBaldesUser();
  }
  // running the applier script in their own window, under their own Microsoft login (Balde never
  // talks to Microsoft). The page writes the plan, shows the one command to run and polls for the
  // receipt the script writes.
  let acessoPollTimer = null;
  const ACESSO_POLL_MS = 2000;
  const ACESSO_POLL_MAX_MS = 10 * 60 * 1000;

  function renderAcessoOneDrive(ed) {
    if (!state.acessoApplier || !ed) return '';
    if (!ed.oneDrive)
      return '<p class="muted">A pasta deste balde não está no OneDrive: o acesso dela vale só dentro do Balde.</p>';
    const run = state.acessoRun && state.acessoRun.balde === ed.name ? state.acessoRun : null;
    return `
      <div class="acesso-onedrive">
        <h4>Acesso no OneDrive</h4>
        <p class="muted">Leva o acesso <strong>salvo</strong> acima para a pasta no OneDrive. O Balde não fala com a Microsoft: você roda um comando na sua janela, com o seu login; ele mostra o que vai mudar e pede confirmação antes de aplicar.</p>
        <label class="notify-row"><input type="checkbox" data-acesso-notify ${run && run.notify ? 'checked' : ''}><span class="notify-row-text"><strong>Avisar por e-mail quem ganhar acesso</strong><small>A Microsoft envia o e-mail de compartilhamento dela.</small></span></label>
        <div class="form-actions">
          <button class="primary-button small" data-action="acessoAplicar" data-repo="${escapeHtml(ed.name)}">Aplicar no OneDrive</button>
          <button class="ghost-button small" data-action="acessoVerificar" data-repo="${escapeHtml(ed.name)}">Quem abre esta pasta hoje?</button>
        </div>
        ${run ? renderAcessoRun(run) : ''}
      </div>`;
  }

  function renderAcessoRun(run) {
    const unresolved = (run.unresolvedGroups || []).length
      ? `<div class="form-alert">Grupos sem membros conhecidos no Balde (ficam de fora do OneDrive): ${run.unresolvedGroups.map((g) => `<code>${escapeHtml(g)}</code>`).join(', ')}</div>`
      : '';
    // The script always writes its result, failures included; nothing arrives only if pwsh 7 never
    // started or its s/N confirmation is still open in the cmd window.
    const body = run.result
      ? renderAcessoResult(run)
      : run.timedOut
        ? `<p class="muted">Nada recebido ainda: confira a janela do cmd (o comando precisa do pwsh 7; a pergunta s/N ainda está aberta?).</p>
        <div class="form-actions"><button class="ghost-button small" data-action="acessoRepoll">Continuar aguardando</button></div>`
        : '<p class="muted">Cole o comando no Prompt de Comando (cmd) e confirme por lá. Aguardando o resultado…</p>';
    return `
      <div class="acesso-run">
        <p><strong>${run.kind === 'p' ? 'Aplicar no OneDrive' : 'Quem abre esta pasta hoje'}</strong></p>
        ${unresolved}
        <pre class="acesso-cmd">${escapeHtml(run.command)}</pre>
        <div class="form-actions"><button class="ghost-button small" data-action="acessoCopiar">${icon('copy')}Copiar comando</button></div>
        ${body}
      </div>`;
  }

  function renderAcessoResult(run) {
    const r = run.result || {};
    const cell = (v) => escapeHtml(v == null ? '' : String(v));
    if (run.kind === 'v') {
      // snapshot: { checkedAt, by, error?, folders: [{ folder, url, webUrl, inherits, permissions } | { folder, error }] }
      if (r.error) return `<div class="form-alert form-alert-error">${cell(r.error)}</div>`;
      const f = Array.isArray(r.folders) && r.folders.length ? r.folders[0] : null;
      if (!f) return '<p class="muted">A verificação não retornou nenhuma pasta.</p>';
      if (f.error) return `<div class="form-alert form-alert-error">${cell(f.error)}</div>`;
      const perms = Array.isArray(f.permissions) ? f.permissions : [];
      return `
        <p>${f.inherits === false ? 'A pasta tem permissões próprias.' : 'A pasta herda as permissões do site: quem acessa o site abre esta pasta.'}${f.webUrl ? ` <a href="${escapeHtml(f.webUrl)}" target="_blank" rel="noopener">Abrir no SharePoint</a>` : ''}</p>
        ${perms.length ? `<div class="table-scroll"><table class="mini-table"><thead><tr><th>Quem</th><th>Tipo</th><th>Papel</th><th>Origem</th></tr></thead><tbody>${perms.map((p) => `<tr><td>${cell(p.quem)}</td><td>${cell(p.tipo)}</td><td>${cell(p.papel)}</td><td>${cell(p.origem)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhuma permissão listada.</p>'}`;
    }
    const label =
      {
        aplicado: 'Alterações enviadas. Verificação pendente.',
        verificado: 'Permissões verificadas: nenhuma alteração gerenciada pendente.',
        'acao-manual': 'Aplicação pendente: ação manual necessária.',
        'verificacao-pendente': 'Aplicação concluída em parte; ainda há diferenças ou avisos a resolver.',
        parcial: 'Aplicado em parte: veja os erros abaixo.',
        cancelado: 'Cancelado por você: nada mudou.',
        'sem-mudancas': 'Nenhuma alteração automática proposta. Confira os avisos e verifique as permissões.',
        simulado: 'Simulação: nada foi alterado.',
        erro: 'Erro ao aplicar.'
      }[r.status] || String(r.status || '');
    const changes = Array.isArray(r.changes) ? r.changes : [];
    const warnings = Array.isArray(r.warnings) ? r.warnings : [];
    const fora = Array.isArray(r.foraDoBalde) ? r.foraDoBalde : [];
    return `
      <p><strong>${escapeHtml(label)}</strong>${r.webUrl ? ` <a href="${escapeHtml(r.webUrl)}" target="_blank" rel="noopener">Abrir no SharePoint</a>` : ''}</p>
      ${changes.length ? `<div class="table-scroll"><table class="mini-table"><thead><tr><th>Ação</th><th>Quem</th><th>Papel</th><th>Resultado</th></tr></thead><tbody>${changes.map((c) => `<tr><td>${cell(c.acao)}</td><td>${cell(c.quem)}</td><td>${cell(c.papel)}</td><td>${cell(c.resultado)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${warnings.length ? `<ul class="acesso-warnings">${warnings.map((w) => `<li>${cell(w)}</li>`).join('')}</ul>` : ''}
      ${fora.length ? `<p class="muted">Acessos dados fora do Balde (mantidos): ${fora.map((f) => `${cell(f.quem)} (${cell(f.papel)})`).join(', ')}</p>` : ''}`;
  }

  function stopAcessoPoll() {
    if (acessoPollTimer) {
      clearTimeout(acessoPollTimer);
      acessoPollTimer = null;
    }
  }

  function pollAcesso() {
    stopAcessoPoll();
    const run = state.acessoRun;
    if (!run || run.result || run.timedOut) return;
    acessoPollTimer = setTimeout(async () => {
      const cur = state.acessoRun;
      if (!cur || cur.id !== run.id) return; // a newer run replaced this one
      try {
        const d = await (
          await fetch(`/api/repos/${encodeURIComponent(cur.balde)}/acesso/resultado?id=${encodeURIComponent(cur.id)}`)
        ).json();
        if (d && d.ok && !d.pending) {
          state.acessoRun = { ...cur, result: d.result };
          renderShell();
          return;
        }
      } catch (error) {
        /* keep polling */
      }
      if (Date.now() - cur.startedAt > ACESSO_POLL_MAX_MS) {
        state.acessoRun = { ...cur, timedOut: true };
        renderShell();
        return;
      }
      pollAcesso();
    }, ACESSO_POLL_MS);
  }

  async function acessoStart(repo, kind) {
    const box = document.querySelector('[data-acesso-notify]');
    const notify = Boolean(box && box.checked);
    stopAcessoPoll();
    state.baldesUser = { ...state.baldesUser, error: null, ok: null };
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repo)}/acesso/${kind === 'p' ? 'plano' : 'verificar'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notify })
      });
      const data = await res.json();
      if (!data.ok) {
        state.baldesUser.error = data.error || 'Não foi possível preparar o comando.';
        renderShell();
        return;
      }
      state.acessoRun = {
        balde: repo,
        kind,
        id: data.id,
        command: data.command,
        notify,
        unresolvedGroups: (data.plan && data.plan.unresolvedGroups) || [],
        startedAt: Date.now(),
        result: null,
        timedOut: false
      };
    } catch (error) {
      state.baldesUser.error = 'Não foi possível preparar o comando.';
      renderShell();
      return;
    }
    renderShell();
    pollAcesso();
  }

  async function acessoCopiar() {
    const cmd = state.acessoRun && state.acessoRun.command;
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd);
      toast('Comando copiado: cole no Prompt de Comando (cmd).', 'success');
    } catch (error) {
      toast('Não deu para copiar: selecione o comando e copie.', 'warning');
    }
  }

  // One-click personal repo: create (idempotent), switch the pref to it, reload scoped.
  async function meuBaldeCreate() {
    try {
      const res = await fetch('/api/repos/personal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || 'Não foi possível criar o balde pessoal.');
        return;
      }
      await fetch('/api/me/prefs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo: data.repo.name })
      });
      window.location.reload();
    } catch (error) {
      alert('Não foi possível criar o balde pessoal.');
    }
  }

  return {
    renderSettings,
    toggleNotifyPref,
    baldesUserCreate,
    baldesUserMount,
    baldesUserUnmount,
    baldesUserSaveAccess,
    pollAcesso,
    acessoStart,
    acessoCopiar,
    meuBaldeCreate
  };
}
