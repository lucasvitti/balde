export function createAiSettingsFeature({
  state,
  renderShell,
  isAdmin,
  adminTabsAvailable,
  openSettingsPrompts,
  openDomainsAdmin,
  openCategoriasAdmin,
  loadUserDomainsAdmin,
  loadUsersAdmin,
  openSettingsGroups,
  openEvalChecklistAdmin,
  openScoringAdmin,
  loadBaldesAdmin,
  loadShareFolders,
  loadDedupAdmin,
  escapeHtml,
  fmtDateTime,
  icon,
  toast
}) {
  function aiModelPlaceholder(provider) {
    if (provider === 'anthropic') {
      return 'claude-sonnet-4-5';
    }
    if (provider === 'compatible') {
      return 'nome-do-modelo';
    }
    if (provider === 'claude-cli') {
      return 'sonnet · opus · haiku (vazio = padrão do cliente)';
    }
    if (provider === 'codex-cli') {
      return 'vazio = padrão do cliente';
    }
    return 'gpt-4.1';
  }

  // Loader for the merged Configurações page: AI provider config + the personal
  // API keys (so the "Minhas chaves de API" tab is ready without a second click).
  async function openSettings() {
    if (!['provider', 'keys', 'appearance'].includes(state.settingsTab)) {
      state.settingsTab = 'provider';
    }
    await openSettingsAi();
    await openSettingsTokens();
  }

  async function openSettingsAi() {
    state.ai = {
      provider: 'openai',
      model: '',
      baseUrl: '',
      keySet: false,
      encryptionAvailable: true,
      apiKey: '',
      busy: true,
      error: null,
      notice: null
    };
    renderShell();
    try {
      const res = await fetch('/api/me/ai');
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        state.ai = {
          provider: data.provider || 'openai',
          model: data.model || '',
          baseUrl: data.baseUrl || '',
          keySet: !!data.keySet,
          encryptionAvailable: data.encryptionAvailable !== false,
          apiKey: '',
          busy: false,
          error: null,
          notice: null
        };
      } else {
        state.ai.busy = false;
        state.ai.error = data.error || 'Falha ao carregar configuração de IA.';
      }
    } catch (error) {
      state.ai.busy = false;
      state.ai.error = error.message || 'Erro de rede.';
    }
    renderShell();
  }

  // Loader for the API page: personal tokens (all users) + admin overview (admins).
  async function openApiAccess() {
    await openSettingsTokens();
    if (isAdmin()) {
      await loadAdminOverview();
    }
  }

  // Loader for the Administração page: lazily fetch the active tab's data (each
  // underlying opener renders its own busy state). Only fetches what's missing,
  // so switching back to a visited tab is instant.
  async function openAdmin() {
    const { keys } = adminTabsAvailable();
    if (!keys.length) {
      return;
    }
    if (!keys.includes(state.adminTab)) {
      state.adminTab = keys[0];
    }
    await loadAdminTab(state.adminTab);
  }

  async function loadAdminTab(tab) {
    if (tab === 'prompts') {
      if (!state.prompts) {
        await openSettingsPrompts();
      }
      return;
    }
    if (tab === 'domains') {
      if (!state.domainsAdmin) {
        await openDomainsAdmin();
      }
      return;
    }
    if (tab === 'categorias') {
      if (!state.categoriasAdmin) {
        await openCategoriasAdmin();
      }
      return;
    }
    if (tab === 'move-skill') {
      if (!state.domainsAdmin) {
        await openDomainsAdmin();
      }
      return;
    }
    if (tab === 'user-domains') {
      if (!state.userDomainsAdmin) {
        state.userDomainsAdmin = { loading: true };
        loadUserDomainsAdmin();
      }
      return;
    }
    if (tab === 'usuarios') {
      if (!state.usersAdmin) {
        await loadUsersAdmin();
      }
      return;
    }
    if (tab === 'groups') {
      if (!state.groups) {
        await openSettingsGroups();
      }
      return;
    }
    if (tab === 'checklist') {
      if (!state.evalChecklistAdmin) {
        await openEvalChecklistAdmin();
      }
      return;
    }
    if (tab === 'scoring') {
      if (!state.scoringAdmin) {
        await openScoringAdmin();
      }
      return;
    }
    if (tab === 'baldes') {
      await loadBaldesAdmin();
      renderShell();
      return;
    }
    if (tab === 'pastas') {
      if (!state.shareFolders || !state.shareFolders.data) await loadShareFolders();
      return;
    }
    if (tab === 'dedup') {
      await loadDedupAdmin();
      renderShell();
      return;
    }
    if (!state.adminOverview) {
      await openApiAccess();
    }
  }

  async function loadAdminOverview() {
    try {
      const res = await fetch('/api/admin/overview');
      const data = await res.json().catch(() => ({}));
      state.adminOverview =
        res.ok && data.ok ? { ...data, revealed: null } : { error: data.error || `HTTP ${res.status}` };
    } catch (error) {
      state.adminOverview = { error: error.message || 'Erro de rede.' };
    }
  }

  // Build a ready-to-run curl for one exposed API, with the given key (real or placeholder).
  function apiCurl(api, base, key) {
    const url = `${base}${api.path}`;
    const auth = `-H "Authorization: Bearer ${key}"`;
    if (api.method === 'POST') {
      return `curl -X POST ${auth} -H "content-type: application/json" -d '{"skill":"<id>","content":"<texto>"}' ${url}`;
    }
    return `curl ${auth} ${url}`;
  }

  function renderAdminApisCard() {
    const ov = state.adminOverview;
    if (!ov) {
      return '<article class="settings-card"><h3>APIs expostas</h3><p>Carregando…</p></article>';
    }
    if (ov.error) {
      return `<article class="settings-card"><h3>APIs expostas</h3><div class="form-alert form-alert-error">${escapeHtml(ov.error)}</div></article>`;
    }
    const ma = ov.machineAuth || {};
    const base = ov.baseUrl || '';
    const keyShown = Boolean(ov.keyShown && ov.exampleKey);
    const key = keyShown ? ov.exampleKey : '<SUA_CHAVE>';
    const tokens = (state.tokens && state.tokens.tokens) || [];
    const hasToken = tokens.length > 0;
    const usageByApi = new Map(((ov.usage && ov.usage.byApi) || []).map((u) => [u.path, u]));
    const calls = (ov.apis || [])
      .map((a, idx) => {
        const u = usageByApi.get(`${a.method} ${a.path}`);
        const hits = u
          ? `<span class="api-hits" title="chamadas registradas · ${u.users} usuário(s)${u.lastAt ? ' · última ' + fmtDateTime(u.lastAt) : ''}">${u.count.toLocaleString('pt-BR')} chamada${u.count === 1 ? '' : 's'}</span>`
          : '<span class="api-hits api-hits-zero" title="ainda sem chamadas registradas">sem uso</span>';
        return `
      <div class="api-call">
        <div class="api-call-head">
          <span class="api-method">${escapeHtml(a.method)}</span>
          <code class="api-call-path">${escapeHtml(a.path)}</code>
          ${hits}
          <button class="ghost-button small" data-action="copyApiCurl" data-idx="${idx}">${icon('key')}copiar curl</button>
        </div>
        <p class="api-call-desc">${escapeHtml(a.desc)}</p>
        <pre class="md-code api-curl">${escapeHtml(apiCurl(a, base, key))}</pre>
      </div>`;
      })
      .join('');
    return `
      <article class="settings-card admin-apis-card">
        <h3>APIs expostas <span class="admin-tag">admin</span></h3>
        <p>Endpoints de máquina do Balde (<code>/api/v1</code>), autenticados pela <strong>chave pessoal (MCP)</strong>. Base: <code>${escapeHtml(base)}</code>. Copie um curl e teste direto no terminal.</p>
        <div class="api-key-toggle">
          <label class="api-key-select">Chave nos exemplos:
            <select data-api-key-select ${hasToken ? '' : 'disabled'}>
              <option value="" ${keyShown ? '' : 'selected'}>&lt;SUA_CHAVE&gt; — não mostrar</option>
              ${tokens.map((t) => `<option value="${escapeHtml(t.identifier)}" ${keyShown && ov.exampleIdentifier === t.identifier ? 'selected' : ''}>${escapeHtml((t.description || 'Balde API') + ' · ' + String(t.identifier).slice(-8))}</option>`).join('')}
            </select>
          </label>
          <span class="muted">${keyShown ? 'exemplos com sua chave real — prontos para colar no terminal' : hasToken ? 'escolha uma chave para inserir a real' : 'crie uma chave em “Minhas chaves de API” para inserir a sua'}</span>
        </div>
        <div class="api-calls">${calls}</div>
        <div class="machine-auth-box">
          <p><strong>Autenticação = chave pessoal (Bearer)</strong> — a "chave MCP". Cada usuário gera a sua em <em>Minhas chaves de API</em> (acima): herda a visibilidade do dono, só funciona enquanto a conta estiver ativa e no grupo <code>${escapeHtml(ma.gateGroup || '—')}</code>, e é revelada/revogada pelo próprio dono. A chave compartilhada antiga foi <strong>aposentada</strong>.</p>
          ${ma.serviceReady === false ? '<div class="form-alert form-alert-error">Broker de chaves indisponível — configure <code>AUTHENTIK_SERVICE_TOKEN</code>.</div>' : ''}
          ${ma.sharedKeyActive ? '<div class="form-alert form-alert-error">Atenção: uma chave compartilhada legada ainda está ativa no servidor. Remova <code>API_KEY</code> do ambiente.</div>' : ''}
        </div>
      </article>`;
  }

  // Admin "Uso" tab — who consumed what (API calls + per-skill events), by source.
  // Data rides in state.adminOverview.usage (loaded with the overview; no extra fetch).
  function renderAdminUsageCard() {
    const ov = state.adminOverview;
    if (!ov) return '<article class="settings-card"><h3>Uso</h3><p>Carregando…</p></article>';
    if (ov.error)
      return `<article class="settings-card"><h3>Uso</h3><div class="form-alert form-alert-error">${escapeHtml(ov.error)}</div></article>`;
    const u = ov.usage || { totals: { api: 0, skill: 0 }, topUsers: [], topSkills: [], byApi: [] };
    const t = u.totals || { api: 0, skill: 0 };
    const nf = (n) => Number(n || 0).toLocaleString('pt-BR');
    const when = (iso) => (iso ? fmtDateTime(iso) : '—');
    const srcSplit = (s) =>
      `<span class="src-split"><span class="src-pill src-app" title="uso interno por pessoas">app ${nf((s || {}).app)}</span><span class="src-pill src-machine" title="agentes de IA via /api/v1">agente ${nf((s || {}).machine)}</span></span>`;
    const empty = !(t.api || 0) && !(t.skill || 0);
    const usersRows = (u.topUsers || [])
      .map(
        (r) => `
      <tr><td class="u-who">${escapeHtml(r.who)}</td><td class="u-num">${nf(r.api)}</td><td class="u-num">${nf(r.skill)}</td><td class="u-num u-strong">${nf(r.total)}</td><td class="u-dim">${when(r.lastAt)}</td></tr>`
      )
      .join('');
    const skillRows = (u.topSkills || [])
      .map(
        (r) => `
      <tr>
        <td><code>${escapeHtml(r.skill)}</code></td>
        <td class="u-num">${nf(r.view)}</td>
        <td class="u-num">${nf(r.consume)}</td>
        <td class="u-num">${nf(r.chat)}</td>
        <td class="u-num">${nf(r.contribute)}</td>
        <td>${srcSplit(r.bySource)}</td>
        <td class="u-num">${nf(r.users)}</td>
        <td class="u-num u-strong">${nf(r.total)}</td>
      </tr>`
      )
      .join('');
    const apiRows = (u.byApi || [])
      .map(
        (r) => `
      <tr><td><code>${escapeHtml(r.path)}</code></td><td class="u-num u-strong">${nf(r.count)}</td><td class="u-num">${nf(r.users)}</td><td class="u-dim">${
        escapeHtml(
          Object.entries(r.byStatus || {})
            .map(([s, c]) => `${s}:${c}`)
            .join('  ')
        ) || '—'
      }</td><td class="u-dim">${when(r.lastAt)}</td></tr>`
      )
      .join('');
    return `
      <article class="settings-card usage-card">
        <h3>Uso <span class="admin-tag">admin</span></h3>
        <p>Quem consumiu o quê — chamadas de API (por chave pessoal) e eventos por skill, classificados pela <strong>origem</strong>: <span class="src-pill src-app">app</span> = uso interno por pessoas · <span class="src-pill src-machine">agente</span> = provedores de IA via <code>/api/v1</code>. Trilha completa em <code>usage/AAAA-MM.jsonl</code>.</p>
        <div class="usage-totals">
          <div class="usage-kpi"><span class="usage-kpi-num">${nf(t.api)}</span><span class="usage-kpi-label">chamadas de API</span></div>
          <div class="usage-kpi"><span class="usage-kpi-num">${nf(t.skill)}</span><span class="usage-kpi-label">eventos de skill</span></div>
          <div class="usage-kpi"><span class="usage-kpi-num">${nf((u.topUsers || []).length)}</span><span class="usage-kpi-label">usuários ativos</span></div>
          <span class="usage-updated">${u.updatedAt ? 'atualizado ' + when(u.updatedAt) : 'sem eventos ainda'}</span>
        </div>
        ${
          empty
            ? '<p class="muted usage-empty">Ainda não há eventos registrados. Assim que alguém abrir uma skill, conversar com ela ou um agente chamar a API, os números aparecem aqui.</p>'
            : `
        <h4 class="usage-h">Skills mais usadas</h4>
        <div class="usage-scroll"><table class="usage-table">
          <thead><tr><th>Skill</th><th class="u-num">Aberturas</th><th class="u-num">Consumos (API)</th><th class="u-num">Chat</th><th class="u-num">Contrib.</th><th>Origem</th><th class="u-num">Usuários</th><th class="u-num">Total</th></tr></thead>
          <tbody>${skillRows || '<tr><td colspan="8" class="muted">—</td></tr>'}</tbody>
        </table></div>
        <h4 class="usage-h">Quem mais usa</h4>
        <div class="usage-scroll"><table class="usage-table">
          <thead><tr><th>Usuário</th><th class="u-num">API</th><th class="u-num">Skill</th><th class="u-num">Total</th><th>Último</th></tr></thead>
          <tbody>${usersRows || '<tr><td colspan="5" class="muted">—</td></tr>'}</tbody>
        </table></div>
        <h4 class="usage-h">Chamadas por endpoint</h4>
        <div class="usage-scroll"><table class="usage-table">
          <thead><tr><th>Endpoint</th><th class="u-num">Chamadas</th><th class="u-num">Usuários</th><th>Status</th><th>Último</th></tr></thead>
          <tbody>${apiRows || '<tr><td colspan="5" class="muted">—</td></tr>'}</tbody>
        </table></div>`
        }
      </article>`;
  }

  async function selectApiExampleKey(identifier) {
    if (!state.adminOverview) {
      return;
    }
    if (!identifier) {
      state.adminOverview.keyShown = false;
      state.adminOverview.exampleKey = null;
      state.adminOverview.exampleIdentifier = null;
      renderShell();
      return;
    }
    try {
      const res = await fetch('/api/me/tokens/reveal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast(data.error || 'Falha ao revelar a chave.', 'warning');
        return;
      }
      state.adminOverview.exampleKey = data.key;
      state.adminOverview.exampleIdentifier = identifier;
      state.adminOverview.keyShown = true;
      renderShell();
    } catch (error) {
      toast(error.message || 'Erro de rede.', 'warning');
    }
  }

  async function copyApiCurl(idx) {
    const ov = state.adminOverview;
    if (!ov) {
      return;
    }
    const api = (ov.apis || [])[Number(idx)];
    if (!api) {
      return;
    }
    const key = ov.keyShown && ov.exampleKey ? ov.exampleKey : '<SUA_CHAVE>';
    try {
      await navigator.clipboard.writeText(apiCurl(api, ov.baseUrl || '', key));
      toast(
        ov.keyShown ? 'Curl copiado com sua chave.' : 'Curl copiado — substitua o placeholder pela sua chave.',
        'success'
      );
    } catch (error) {
      toast('Não foi possível copiar.', 'warning');
    }
  }

  async function postAiConfig(extra) {
    if (!state.ai) {
      return;
    }
    const ai = state.ai;
    ai.busy = true;
    ai.error = null;
    ai.notice = null;
    renderShell();
    try {
      const res = await fetch('/api/me/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: ai.provider, model: ai.model, baseUrl: ai.baseUrl, ...extra })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        ai.busy = false;
        ai.error = data.error || `Falha ao salvar (HTTP ${res.status}).`;
        renderShell();
        return false;
      }
      state.ai = {
        provider: data.provider,
        model: data.model,
        baseUrl: data.baseUrl,
        keySet: !!data.keySet,
        encryptionAvailable: data.encryptionAvailable !== false,
        apiKey: '',
        busy: false,
        error: null,
        notice: extra.clearKey ? 'Chave removida.' : 'Configuração de IA salva.'
      };
      renderShell();
      return true;
    } catch (error) {
      ai.busy = false;
      ai.error = error.message || 'Erro de rede.';
      renderShell();
      return false;
    }
  }

  async function saveAiConfig() {
    const ok = await postAiConfig({ apiKey: state.ai?.apiKey || '' });
    if (ok) {
      toast('Configuração de IA salva.', 'success');
    }
  }

  async function clearAiKey() {
    const ok = await postAiConfig({ clearKey: true });
    if (ok) {
      toast('Chave de IA removida.');
    }
  }

  // Test the AI key against the provider — the entered key if typed, else the saved one.
  async function testAiKey() {
    if (!state.ai) {
      return;
    }
    const ai = state.ai;
    ai.testing = true;
    ai.testResult = null;
    ai.error = null;
    ai.notice = null;
    renderShell();
    try {
      const body = { provider: ai.provider, model: ai.model, baseUrl: ai.baseUrl };
      if (ai.apiKey && ai.apiKey.trim()) {
        body.apiKey = ai.apiKey;
      }
      const res = await fetch('/api/me/ai/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      ai.testResult = data.ok
        ? { ok: true, provider: data.provider, model: data.model, ms: data.ms }
        : { ok: false, error: data.error || `Falha (HTTP ${res.status}).` };
    } catch (error) {
      ai.testResult = { ok: false, error: error.message || 'Erro de rede.' };
    }
    ai.testing = false;
    renderShell();
    toast(
      ai.testResult.ok ? 'Chave de IA válida.' : 'Teste da chave falhou.',
      ai.testResult.ok ? 'success' : 'warning'
    );
  }

  async function openSettingsTokens() {
    state.tokens = { tokens: [], serviceReady: true, busy: true, error: null, created: null };
    renderShell();
    try {
      const res = await fetch('/api/me/tokens');
      const data = await res.json().catch(() => ({}));
      state.tokens = {
        tokens: data.tokens || [],
        serviceReady: data.serviceReady !== false,
        mcpLocal: data.mcpLocal === true,
        busy: false,
        error: data.ok === false ? data.error || 'Falha ao listar chaves.' : null,
        created: null
      };
    } catch (error) {
      state.tokens = {
        tokens: [],
        serviceReady: true,
        busy: false,
        error: error.message || 'Erro de rede.',
        created: null
      };
    }
    renderShell();
  }

  async function refreshTokensList() {
    try {
      const res = await fetch('/api/me/tokens');
      const data = await res.json().catch(() => ({}));
      if (state.tokens) {
        state.tokens.tokens = data.tokens || [];
        state.tokens.serviceReady = data.serviceReady !== false;
      }
    } catch (error) {
      /* keep existing list */
    }
  }

  async function createApiToken() {
    if (!state.tokens || state.tokens.busy) {
      return;
    }
    const labelEl = document.querySelector('[data-token-label]');
    const label = labelEl ? labelEl.value.trim() : '';
    state.tokens.busy = true;
    state.tokens.error = null;
    renderShell();
    try {
      const res = await fetch('/api/me/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        state.tokens.busy = false;
        state.tokens.error = data.error || `Falha ao criar (HTTP ${res.status}).`;
        renderShell();
        return;
      }
      await refreshTokensList();
      state.tokens.created = { identifier: data.identifier, key: data.key };
      state.tokens.busy = false;
      renderShell();
      toast('Chave criada.', 'success');
    } catch (error) {
      state.tokens.busy = false;
      state.tokens.error = error.message || 'Erro de rede.';
      renderShell();
    }
  }

  async function toggleRevealToken(identifier) {
    if (!state.tokens || !identifier) {
      return;
    }
    state.tokens.revealed = state.tokens.revealed || {};
    if (state.tokens.revealed[identifier]) {
      delete state.tokens.revealed[identifier];
      renderShell();
      return;
    }
    try {
      const res = await fetch('/api/me/tokens/reveal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast(data.error || 'Falha ao revelar a chave.', 'warning');
        return;
      }
      state.tokens.revealed[identifier] = data.key;
      renderShell();
    } catch (error) {
      toast(error.message || 'Erro de rede.', 'warning');
    }
  }

  async function copyToken(identifier) {
    const key = state.tokens && state.tokens.revealed && state.tokens.revealed[identifier];
    if (!key) {
      return;
    }
    try {
      await navigator.clipboard.writeText(key);
      toast('Chave copiada.', 'success');
    } catch (error) {
      toast('Não foi possível copiar.', 'warning');
    }
  }

  async function revokeApiToken(identifier) {
    if (!state.tokens || state.tokens.busy || !identifier) {
      return;
    }
    state.tokens.busy = true;
    state.tokens.error = null;
    renderShell();
    try {
      const res = await fetch('/api/me/tokens/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        state.tokens.busy = false;
        state.tokens.error = data.error || 'Falha ao revogar.';
        renderShell();
        return;
      }
      await refreshTokensList();
      if (state.tokens.created && state.tokens.created.identifier === identifier) {
        state.tokens.created = null;
      }
      state.tokens.busy = false;
      renderShell();
      toast('Chave revogada.');
    } catch (error) {
      state.tokens.busy = false;
      state.tokens.error = error.message || 'Erro de rede.';
      renderShell();
    }
  }

  function renameApiToken(identifier) {
    if (!state.tokens || state.tokens.busy || !identifier) {
      return;
    }
    state.tokens.renaming = identifier;
    state.tokens.error = null;
    renderShell();
  }

  function cancelRenameToken() {
    if (!state.tokens) {
      return;
    }
    state.tokens.renaming = null;
    renderShell();
  }

  async function saveRenameToken(identifier) {
    if (!state.tokens || state.tokens.busy || !identifier) {
      return;
    }
    const input = document.querySelector('[data-token-rename-input]');
    const label = input ? input.value.trim() : '';
    state.tokens.busy = true;
    state.tokens.error = null;
    renderShell();
    try {
      const res = await fetch('/api/me/tokens/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, label })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        state.tokens.busy = false;
        state.tokens.error = data.error || 'Falha ao renomear.';
        renderShell();
        return;
      }
      await refreshTokensList();
      state.tokens.renaming = null;
      state.tokens.busy = false;
      renderShell();
      toast('Chave renomeada.', 'success');
    } catch (error) {
      state.tokens.busy = false;
      state.tokens.error = error.message || 'Erro de rede.';
      renderShell();
    }
  }

  function dismissNewToken() {
    if (state.tokens) {
      state.tokens.created = null;
      renderShell();
    }
  }

  async function copyNewToken() {
    const key = state.tokens && state.tokens.created && state.tokens.created.key;
    if (!key) {
      return;
    }
    try {
      await navigator.clipboard.writeText(key);
      toast('Chave copiada.');
    } catch (error) {
      toast('Copie manualmente.');
    }
  }

  return {
    aiModelPlaceholder,
    openSettings,
    openApiAccess,
    openAdmin,
    loadAdminTab,
    renderAdminApisCard,
    renderAdminUsageCard,
    selectApiExampleKey,
    copyApiCurl,
    saveAiConfig,
    clearAiKey,
    testAiKey,
    createApiToken,
    toggleRevealToken,
    copyToken,
    revokeApiToken,
    renameApiToken,
    cancelRenameToken,
    saveRenameToken,
    dismissNewToken,
    copyNewToken
  };
}
