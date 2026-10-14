export function createIntegrationsFeature({
  state,
  escapeHtml,
  icon,
  aiModelPlaceholder,
  renderShell,
  toast,
  isAdmin,
  isBaldeAdmin,
  roleAllows,
  renderShareFoldersBody,
  renderDomainsBody,
  renderCategoriasBody,
  renderMoveSkillBody,
  renderUserDomainsPanel,
  renderGroupsBody,
  renderEvalChecklistBody,
  renderScoringBody,
  refreshRepos,
  renderAdminUsageCard,
  renderAdminApisCard,
  startViewOr,
  chatAvailable,
  renderSystemPromptsCard
}) {
  function isCliProviderName(provider) {
    return provider === 'claude-cli' || provider === 'codex-cli';
  }

  function renderAiProviderCard() {
    const ai = state.ai || {
      provider: 'openai',
      model: '',
      baseUrl: '',
      keySet: false,
      encryptionAvailable: true,
      apiKey: ''
    };
    const provider = ai.provider || 'openai';
    const isCli = isCliProviderName(provider);
    const canTest = Boolean(isCli || ai.keySet || (ai.apiKey && ai.apiKey.trim()));
    const tr = ai.testResult;
    const providerOption = (value, label) =>
      `<option value="${value}" ${provider === value ? 'selected' : ''}>${label}</option>`;
    return `
        <article class="settings-card ai-config-card">
          <h3>Provedor de IA — da sua conta</h3>
          <p>Defina seu provedor para usar a IA do Balde (chat, criação e análises). A chave de API fica criptografada no seu perfil local. Com um <strong>cliente local (CLI)</strong>, o Balde usa o Claude Code/Codex instalado <strong>nesta máquina</strong> e a sessão já conectada — veja <strong>Clientes de IA (CLI)</strong>.</p>
          ${!isCli && ai.encryptionAvailable === false ? '<div class="form-alert form-alert-error">A proteção de chaves do perfil local não está configurada. Reabra pelo aplicativo Balde ou repare a configuração antes de salvar uma chave.</div>' : ''}
          ${ai.error ? `<div class="form-alert form-alert-error">${escapeHtml(ai.error)}</div>` : ''}
          ${ai.notice ? `<div class="form-alert form-alert-success">${escapeHtml(ai.notice)}</div>` : ''}
          ${
            tr
              ? tr.ok
                ? `<div class="form-alert form-alert-success">${icon('check')}Conexão OK — ${escapeHtml(tr.provider || provider)} · <code>${escapeHtml(tr.model || '')}</code>${tr.ms ? ` · ${tr.ms} ms` : ''}</div>`
                : `<div class="form-alert form-alert-error">Falha no teste: ${escapeHtml(tr.error || 'erro desconhecido')}</div>`
              : ''
          }
          <div class="manual-form">
            <label>
              Provedor
              <select data-ai-field="provider" ${ai.busy ? 'disabled' : ''}>
                ${providerOption('openai', 'OpenAI (GPT) — chave de API')}
                ${providerOption('anthropic', 'Anthropic (Claude) — chave de API')}
                ${providerOption('compatible', 'OpenAI-compatível (base URL)')}
                ${providerOption('claude-cli', 'Claude Code (cliente local, sem chave)')}
                ${providerOption('codex-cli', 'Codex / ChatGPT (cliente local, sem chave)')}
              </select>
            </label>
            <div class="form-grid-2">
              <label>
                Modelo
                <input data-ai-field="model" value="${escapeHtml(ai.model || '')}" placeholder="${escapeHtml(aiModelPlaceholder(provider))}" ${ai.busy ? 'disabled' : ''}>
              </label>
              ${
                provider === 'compatible'
                  ? `<label>Base URL<input data-ai-field="baseUrl" value="${escapeHtml(ai.baseUrl || '')}" placeholder="https://seu-endpoint/v1" ${ai.busy ? 'disabled' : ''}></label>`
                  : '<div class="form-grid-spacer"></div>'
              }
            </div>
            ${
              isCli
                ? `<p class="muted">Sem chave de API: o processo roda localmente com a sessão do ${provider === 'claude-cli' ? 'Claude Code' : 'Codex'}. Instalação e login ficam na aba <strong>Clientes de IA (CLI)</strong>.</p>`
                : `
            <label>
              Chave de API ${ai.keySet ? '<span class="key-set-tag">definida ••••</span>' : ''}
              <input type="password" data-ai-field="apiKey" value="${escapeHtml(ai.apiKey || '')}" autocomplete="off" placeholder="${ai.keySet ? 'Deixe em branco para manter a chave atual' : 'cole sua chave de API'}" ${ai.busy ? 'disabled' : ''}>
            </label>`
            }
          </div>
          <div class="row-actions">
            ${!isCli && ai.keySet ? `<button class="ghost-button" data-action="clearAiKey" ${ai.busy ? 'disabled' : ''}>${icon('x')}Remover chave</button>` : ''}
            <button class="ghost-button" data-action="testAiKey" ${ai.busy || ai.testing || !canTest ? 'disabled' : ''} title="${canTest ? 'Faz uma chamada mínima para validar o provedor' : 'Salve ou digite uma chave para testar'}">${icon('spark')}${ai.testing ? 'Testando…' : isCli ? 'Testar cliente' : 'Testar chave'}</button>
            <button class="primary-button" data-action="saveAiConfig" ${ai.busy ? 'disabled' : ''}>${icon('check')}${ai.busy ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </article>
    `;
  }
  // Detecção + login + teste dos clientes instalados NA MÁQUINA DO USUÁRIO. O login é um
  // PROCESSO SHELL: o servidor local abre uma janela de terminal e o usuário conclui lá.
  async function loadAiCliStatus(fresh = false) {
    state.aiCli = { ...(state.aiCli || {}), loading: true, error: null };
    renderShell();
    try {
      const res = await fetch(`/api/ai-cli/status${fresh ? '?fresh=1' : ''}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        state.aiCli = {
          loading: false,
          aiMode: data.aiMode,
          platform: data.platform,
          clients: data.clients || [],
          results: (state.aiCli && state.aiCli.results) || {},
          notices: {},
          error: null
        };
      } else {
        state.aiCli = {
          loading: false,
          clients: [],
          results: {},
          notices: {},
          error: data.error || `HTTP ${res.status}`
        };
      }
    } catch (error) {
      state.aiCli = { loading: false, clients: [], results: {}, notices: {}, error: error.message || 'Erro de rede.' };
    }
    try {
      const res = await fetch('/api/mcp/status');
      const data = await res.json().catch(() => ({}));
      state.aiCli.mcp = res.ok && data.ok ? data : { supported: false };
    } catch (error) {
      state.aiCli.mcp = { supported: false };
    }
    // Baldes aos quais ESTE usuário tem acesso — alimenta o seletor do MCP (qual balde ingerir).
    // O endpoint já filtra por membership, então o seletor só oferece baldes válidos.
    try {
      const res = await fetch('/api/repos');
      const data = await res.json().catch(() => ({}));
      state.aiCli.mcpRepos = res.ok && data.ok && Array.isArray(data.repos) ? data.repos : [];
    } catch (error) {
      state.aiCli.mcpRepos = [];
    }
    renderShell();
  }
  async function aiMcpSetup(client) {
    const s = state.aiCli || {};
    // Lê o balde escolhido ANTES do re-render (o "Configurando…" recria o <select>); persiste em
    // state para manter a seleção visível. Vazio = corporativo (padrão).
    const picked = document.querySelector('[data-mcp-repo]');
    if (picked) s.mcpRepo = picked.value || '';
    const repo = s.mcpRepo || '';
    s.mcpBusy = client;
    renderShell();
    try {
      const res = await fetch('/api/mcp/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client, repo })
      });
      const data = await res.json().catch(() => ({}));
      s.mcpNotices = s.mcpNotices || {};
      if (data.ok) {
        const scope = data.repo && data.repo !== 'corporate' ? ` — balde "${data.repo}"` : ' — balde corporativo';
        s.mcpNotices[client] = { ok: true, text: (data.restart || 'Configurado.') + scope };
        if (s.mcp && s.mcp.clients && s.mcp.clients[client]) {
          s.mcp.clients[client].configured = true;
        }
      } else if (res.status === 403 && data.suggestRepo) {
        // Sem acesso ao balde pedido: sugere o balde pessoal (não força — o usuário decide).
        s.mcpNotices[client] = {
          ok: false,
          text: `${data.error || 'Sem acesso.'} ${data.hint || ''} Sugestão: "${data.suggestRepo}".`
        };
      } else {
        s.mcpNotices[client] = { ok: false, text: data.error || `HTTP ${res.status}` };
      }
    } catch (error) {
      s.mcpNotices = s.mcpNotices || {};
      s.mcpNotices[client] = { ok: false, text: error.message || 'Erro de rede.' };
    }
    s.mcpBusy = null;
    renderShell();
  }

  function renderMcpCard() {
    const s = state.aiCli || {};
    const mcp = s.mcp;
    if (!mcp || !mcp.supported) {
      return '';
    }
    const row = (key, title, desc) => {
      const c = (mcp.clients || {})[key] || {};
      const notice = (s.mcpNotices || {})[key];
      return `
        <div class="notify-row" style="align-items:center; gap:12px">
          <span class="notify-row-text"><strong>${title}</strong> ${c.configured ? '<span class="key-set-tag">conectado</span>' : ''}<small>${desc}</small>
          ${notice ? `<small class="${notice.ok ? '' : 'muted'}" style="display:block; margin-top:4px; ${notice.ok ? 'color:var(--ok, #2e9e5b)' : ''}">${escapeHtml(notice.text)}</small>` : ''}</span>
          <button class="ghost-button small" data-action="aiMcpSetup" data-client="${key}" ${s.mcpBusy ? 'disabled' : ''}>${icon('spark')}${s.mcpBusy === key ? 'Configurando…' : c.configured ? 'Reconfigurar' : 'Conectar'}</button>
        </div>`;
    };
    return `
        <article class="settings-card">
          <h3>Conectar via MCP — usar o Balde DENTRO do Claude/Codex</h3>
          <p>O caminho inverso do provedor CLI: aqui é o <strong>seu Claude/Codex</strong> que ganha as ferramentas <code>balde_*</code> (ler skills e cápsulas, rodar queries governadas, enviar contribuições para a Fila) apontando para o Balde <strong>desta máquina</strong>. Um clique grava a configuração do cliente; a credencial fica num launcher local, fora dos configs.</p>
          <label style="display:block; margin:8px 0 12px">
            Balde de destino <small class="muted">— onde as ingestões vão parar</small>
            <select data-mcp-repo style="display:block; width:100%; max-width:360px; margin-top:4px">
              <option value=""${!s.mcpRepo ? ' selected' : ''}>Corporativo (padrão)</option>
              ${(s.mcpRepos || [])
                .filter((r) => r.name && r.name !== 'corporate')
                .map(
                  (r) =>
                    `<option value="${escapeHtml(r.name)}"${s.mcpRepo === r.name ? ' selected' : ''}>${escapeHtml(r.titulo || r.name)}</option>`
                )
                .join('')}
            </select>
            <small class="muted" style="display:block; margin-top:4px">Cada balde vira um servidor MCP separado (<code>balde-&lt;nome&gt;</code>), então dá para conectar vários e coexistir. Só aparecem baldes aos quais você tem acesso.</small>
          </label>
          <div class="notify-rows">
            ${row('claude-desktop', 'Claude Desktop (chat)', 'Grava claude_desktop_config.json — reinicie o Claude Desktop depois.')}
            ${row('claude-code', 'Claude Code (CLI)', 'Registra via "claude mcp add" no escopo do usuário — vale para novas sessões.')}
            ${row('codex', 'Codex CLI', 'Acrescenta [mcp_servers.balde] ao ~/.codex/config.toml — vale para novas sessões.')}
          </div>
          <p class="muted">O ChatGPT Desktop não executa servidores MCP locais (só conectores remotos) — no lado OpenAI, use o Codex CLI.</p>
        </article>`;
  }

  async function aiCliLogin(client) {
    const s = state.aiCli || {};
    try {
      const res = await fetch('/api/ai-cli/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client })
      });
      const data = await res.json().catch(() => ({}));
      s.notices = s.notices || {};
      if (data.spawned) {
        s.notices[client] = 'Janela de login aberta — conclua o login por lá e depois clique em Testar.';
      } else {
        s.notices[client] =
          `Abra um terminal e rode: ${data.command || (client === 'claude' ? 'claude /login' : 'codex login')}`;
      }
    } catch (error) {
      s.notices = s.notices || {};
      s.notices[client] = error.message || 'Falha ao abrir o login.';
    }
    renderShell();
  }

  async function aiCliTest(client) {
    const s = state.aiCli || {};
    s.results = s.results || {};
    s.results[client] = { testing: true };
    renderShell();
    try {
      const res = await fetch('/api/me/ai/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: client === 'codex' ? 'codex-cli' : 'claude-cli' })
      });
      const data = await res.json().catch(() => ({}));
      s.results[client] = data.ok
        ? { ok: true, ms: data.ms, model: data.model }
        : { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (error) {
      s.results[client] = { ok: false, error: error.message || 'Erro de rede.' };
    }
    renderShell();
  }

  async function aiCliUse(client) {
    const provider = client === 'codex' ? 'codex-cli' : 'claude-cli';
    try {
      const res = await fetch('/api/me/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, model: '' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (state.ai) {
        state.ai.provider = provider;
        state.ai.keySet = false;
      }
      toast(`${client === 'codex' ? 'Codex' : 'Claude Code'} definido como seu provedor de IA.`, 'success');
    } catch (error) {
      toast(error.message || 'Falha ao salvar o provedor.', 'warning');
    }
    renderShell();
  }

  function renderAiCliClientCard(c) {
    const s = state.aiCli || {};
    const key = c.kind;
    const title = key === 'claude' ? 'Claude Code (Anthropic)' : 'Codex / ChatGPT (OpenAI)';
    const notice = (s.notices || {})[key];
    const result = (s.results || {})[key];
    const current = state.ai && state.ai.provider === (key === 'codex' ? 'codex-cli' : 'claude-cli');
    return `
        <article class="settings-card">
          <h3>${title} ${current ? '<span class="key-set-tag">provedor atual</span>' : ''}</h3>
          <p>
            ${
              c.installed
                ? `${icon('check')} Instalado — <code>${escapeHtml(c.version || c.bin)}</code><br>${c.authLikely ? `${icon('check')} Login detectado (heurística — confirme com Testar)` : 'Login não detectado nesta máquina.'}`
                : `Não encontrado no PATH desta máquina (<code>${escapeHtml(c.bin)}</code>). Instale o cliente e clique em Re-detectar.${c.error ? `<br><small class="muted">${escapeHtml(c.error)}</small>` : ''}`
            }
          </p>
          ${notice ? `<div class="form-alert form-alert-success">${escapeHtml(notice)}</div>` : ''}
          ${result && result.testing ? '<div class="form-alert form-alert-success">Testando — o cliente está respondendo uma chamada mínima…</div>' : ''}
          ${result && result.ok ? `<div class="form-alert form-alert-success">${icon('check')}Funcionando — <code>${escapeHtml(result.model || '')}</code>${result.ms ? ` · ${result.ms} ms` : ''}</div>` : ''}
          ${result && result.ok === false ? `<div class="form-alert form-alert-error">${escapeHtml(result.error || 'falha no teste')}</div>` : ''}
          <div class="row-actions">
            <button class="ghost-button" data-action="aiCliLogin" data-client="${key}" ${c.installed ? '' : 'disabled'}>${icon('spark')}Entrar (abre terminal)</button>
            <button class="ghost-button" data-action="aiCliTest" data-client="${key}" ${c.installed && !(result && result.testing) ? '' : 'disabled'}>${icon('spark')}Testar</button>
            <button class="primary-button" data-action="aiCliUse" data-client="${key}" ${c.installed && !current ? '' : 'disabled'}>${icon('check')}Usar no Balde</button>
          </div>
        </article>`;
  }

  function renderAiCliCard() {
    const s = state.aiCli;
    if (!s) {
      setTimeout(() => loadAiCliStatus(), 0);
      return '<div class="repo-empty">Detectando clientes de IA nesta máquina…</div>';
    }
    if (s.loading) {
      return '<div class="repo-empty">Detectando clientes de IA nesta máquina…</div>';
    }
    return `
        <article class="settings-card">
          <h3>Clientes de IA locais — sem chave de API</h3>
          <p>O Balde pode usar o <strong>Claude Code</strong> ou o <strong>Codex</strong> instalados nesta máquina como provedor de IA: o modelo roda como <strong>processo local</strong>, autenticado com a <strong>sua conta corporativa</strong> — nenhuma chave de API é necessária e nada é configurado no servidor. Chat, wizard e análises passam a funcionar por esse cliente quando você o define como provedor.</p>
          ${s.error ? `<div class="form-alert form-alert-error">${escapeHtml(s.error)}</div>` : ''}
          <div class="row-actions"><button class="ghost-button" data-action="aiCliRefresh">${icon('spark')}Re-detectar clientes</button></div>
        </article>
        ${(s.clients || []).map((c) => renderAiCliClientCard(c)).join('')}
        ${renderMcpCard()}`;
  }

  // Navegador e processo local têm testes separados, mas usam a rede desta máquina.
  const CONN_DIAG_LABELS = {
    app: 'App (navegador → Balde)',
    sso: 'Sessão local',
    cfg: 'Config de IA',
    srv: 'IA no aplicativo local',
    direct: 'Navegador → provedor (direto)'
  };
  function connDiagProviderHost(cfg) {
    const p = (cfg && cfg.provider) || (state.ai && state.ai.provider) || 'openai';
    if (p === 'anthropic') return 'api.anthropic.com';
    if (p === 'compatible') {
      const b = (cfg && cfg.baseUrl) || (state.ai && state.ai.baseUrl) || '';
      try {
        return new URL(b).host || 'api.openai.com';
      } catch (error) {
        return 'api.openai.com';
      }
    }
    return 'api.openai.com';
  }
  async function connDiagProbeDirect(host) {
    // no-cors: we can't read the response, but resolve (opaque) = reachable, reject = blocked/unreachable.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      await fetch(`https://${host}/v1/models`, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
      return { reachable: true };
    } catch (error) {
      return { reachable: false, err: error.name || 'erro' };
    } finally {
      clearTimeout(timer);
    }
  }
  async function connDiagStep(key, fn) {
    const t0 = performance.now();
    try {
      const r = await fn();
      return {
        key,
        ms: Math.round(performance.now() - t0),
        label: r.label || CONN_DIAG_LABELS[key],
        status: r.status || 'info',
        detail: r.detail || '',
        code: r.code || null
      };
    } catch (error) {
      return {
        key,
        ms: Math.round(performance.now() - t0),
        label: CONN_DIAG_LABELS[key],
        status: 'fail',
        detail: error.message || String(error),
        code: 'error'
      };
    }
  }
  // Plain-language conclusion from the steps — the line the user (and I) read first.
  function connDiagVerdict(steps) {
    const by = {};
    for (const s of steps || []) by[s.key] = s;
    const app = by.app;
    const srv = by.srv;
    if (app && app.status === 'fail')
      return {
        tone: 'fail',
        text: 'O navegador não alcançou o Balde local. Verifique se o aplicativo está aberto e examine o erro de conexão.'
      };
    if (srv) {
      if (srv.code === 'ok')
        return { tone: 'ok', text: 'Teste concluído: o provedor de IA respondeu ao aplicativo local.' };
      if (srv.code === 'blocked')
        return {
          tone: 'warn',
          text: 'O teste não recebeu uma resposta válida do Balde local. Verifique o aplicativo e a conexão; o resultado não identifica sozinho a causa.'
        };
      if (srv.code === 'nokey')
        return { tone: 'warn', text: 'Falta configurar sua chave de IA em Configurações › Provedor de IA.' };
      if (srv.code === 'fail' || srv.code === 'error')
        return {
          tone: 'fail',
          text: `O Balde recebeu o POST, mas a chamada de IA falhou: ${srv.detail}. Pode ser a chave ou o provedor.`
        };
    }
    return { tone: 'info', text: 'Diagnóstico incompleto — rode novamente.' };
  }
  async function runConnDiag() {
    const d = {
      running: true,
      done: false,
      at: new Date().toISOString(),
      ua: navigator.userAgent,
      online: navigator.onLine,
      me: null,
      steps: []
    };
    state.connDiag = d;
    renderShell();
    const push = (row) => {
      d.steps.push(row);
      renderShell();
    };

    // 1) Browser → Balde reachability (+ the server's AI mode)
    push(
      await connDiagStep('app', async () => {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        return {
          label: `App (navegador → Balde): HTTP ${res.status}`,
          status: res.ok ? 'ok' : 'fail',
          detail: data.aiMode ? `modo de IA local: ${data.aiMode}` : ''
        };
      })
    );
    // A identidade vem da sessão local, não de um proxy SSO.
    push(
      await connDiagStep('sso', async () => {
        const res = await fetch('/api/me', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        d.me = data;
        const who = data.email || data.username || '(sem identidade)';
        const role = data.isAdmin ? 'Admin' : data.isCurator ? 'Curador' : 'Colaborador';
        return {
          label: `Sessão local: ${who}`,
          status: res.ok && data.email ? 'ok' : 'warn',
          detail: `papel: ${role}`
        };
      })
    );
    // 3) The user's AI config
    let cfg = null;
    push(
      await connDiagStep('cfg', async () => {
        const res = await fetch('/api/me/ai', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        cfg = data;
        return {
          label: `Config de IA: ${data.provider || '—'}${data.model ? ` · ${data.model}` : ''}`,
          status: data.keySet ? 'ok' : 'warn',
          detail: data.keySet ? 'chave definida' : 'sem chave configurada'
        };
      })
    );
    // Resposta inválida pode ter várias causas; não atribuímos a falha a um proxy sem evidência.
    push(
      await connDiagStep('srv', async () => {
        let res;
        try {
          res = await fetch('/api/me/ai/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}'
          });
        } catch (netErr) {
          return {
            code: 'blocked',
            label: 'IA local: falha de conexão',
            status: 'warn',
            detail: `Não foi possível concluir a requisição: ${netErr.message || 'falha de conexão'}.`
          };
        }
        let data = null;
        try {
          data = await res.json();
        } catch (parseErr) {
          data = null;
        }
        const isBaldeReply = data && (typeof data.ok !== 'undefined' || typeof data.error !== 'undefined');
        if (!isBaldeReply) {
          // O teste exige o contrato JSON esperado antes de interpretar o resultado.
          return {
            code: 'blocked',
            label: `IA local: resposta HTTP ${res.status} fora do formato esperado`,
            status: 'warn',
            detail: 'A resposta não permite confirmar o teste. Verifique o aplicativo local e os detalhes da conexão.'
          };
        }
        const noKey = !res.ok && data.error && /chave/i.test(data.error);
        const succeeded = res.ok && data.ok === true;
        return {
          code: succeeded ? 'ok' : noKey ? 'nokey' : 'fail',
          label: `IA no aplicativo local: ${succeeded ? 'OK' : noKey ? 'sem chave' : 'falha'}`,
          status: succeeded ? 'ok' : noKey ? 'warn' : 'fail',
          detail: succeeded
            ? `${data.provider || ''}${data.model ? ` · ${data.model}` : ''}${data.ms ? ` · ${data.ms} ms no processo local` : ''}`
            : data.error || `HTTP ${res.status}`
        };
      })
    );
    // 5) Informational: can the user's OWN browser reach the provider? (Balde doesn't need this)
    const host = connDiagProviderHost(cfg);
    push(
      await connDiagStep('direct', async () => {
        const r = await connDiagProbeDirect(host);
        return {
          label: `Navegador → provedor direto (${host})`,
          status: r.reachable ? 'ok' : 'info',
          detail: r.reachable
            ? 'alcançável do seu navegador'
            : 'inacessível diretamente do navegador; consulte também o teste do aplicativo local, pois as restrições podem diferir'
        };
      })
    );

    d.verdict = connDiagVerdict(d.steps);
    d.running = false;
    d.done = true;
    renderShell();
  }
  function connDiagReportText() {
    const d = state.connDiag;
    if (!d) return '';
    const tag = (s) => ({ ok: 'OK   ', warn: 'AVISO', fail: 'FALHA', info: 'i    ', running: '...  ' })[s] || '     ';
    const lines = (d.steps || []).map(
      (s) => `[${tag(s.status)}] ${s.label}${s.ms != null ? ` (${s.ms} ms)` : ''}${s.detail ? ` — ${s.detail}` : ''}`
    );
    return [
      '=== Diagnóstico de conexão — Balde ===',
      `Gerado: ${d.at}`,
      `Usuário: ${(d.me && (d.me.email || d.me.username)) || '(desconhecido)'}`,
      `Navegador: ${d.ua}`,
      `Online: ${d.online ? 'sim' : 'não'}`,
      ...(d.verdict ? ['', `VEREDITO: ${d.verdict.text}`] : []),
      '',
      ...lines
    ].join('\n');
  }
  async function copyConnDiag() {
    const text = connDiagReportText();
    try {
      await navigator.clipboard.writeText(text);
      toast('Relatório copiado — cole e envie ao Lucas.', 'success');
    } catch (error) {
      toast('Não foi possível copiar automaticamente — selecione o texto do relatório e copie.', 'warning');
    }
  }
  function renderConnDiagCard() {
    const d = state.connDiag || { running: false, done: false, steps: [] };
    const chip = (status) => {
      const map = {
        ok: ['✓', 'cd-ok'],
        warn: ['!', 'cd-warn'],
        fail: ['✕', 'cd-fail'],
        info: ['i', 'cd-info'],
        running: ['…', 'cd-run']
      };
      const [sym, cls] = map[status] || ['·', 'cd-info'];
      return `<span class="cd-chip ${cls}">${sym}</span>`;
    };
    const rows = (d.steps || [])
      .map(
        (s) => `
      <li class="cd-row">
        ${chip(s.status)}
        <div class="cd-row-main">
          <div class="cd-row-label">${escapeHtml(s.label)}${s.ms != null ? ` <span class="cd-ms">${s.ms} ms</span>` : ''}</div>
          ${s.detail ? `<div class="cd-row-detail">${escapeHtml(s.detail)}</div>` : ''}
        </div>
      </li>`
      )
      .join('');
    return `
        <article class="settings-card conn-diag-card">
          <h3>Diagnóstico de conexão</h3>
          <p>Verifica a conexão com o Balde e o acesso ao provedor de IA a partir <strong>desta máquina</strong>. Rede, VPN ou proxy podem afetar as chamadas. Se houver uma falha, copie o relatório para investigar o resultado de cada teste.</p>
          <div class="row-actions">
            <button class="primary-button" data-action="runConnDiag" ${d.running ? 'disabled' : ''}>${icon('spark')}${d.running ? 'Executando…' : 'Executar diagnóstico'}</button>
            ${d.done ? `<button class="ghost-button" data-action="copyConnDiag">${icon('copy')}Copiar relatório</button>` : ''}
          </div>
          ${d.steps && d.steps.length ? `<ul class="cd-list">${rows}</ul>` : ''}
          ${d.done && d.verdict ? `<div class="cd-verdict cd-verdict-${d.verdict.tone}"><strong>Veredito:</strong> ${escapeHtml(d.verdict.text)}</div>` : ''}
          ${d.done ? `<label class="cd-report-label">Relatório (copie e envie):<textarea class="cd-report" readonly rows="10" onclick="this.select()">${escapeHtml(connDiagReportText())}</textarea></label>` : ''}
        </article>
    `;
  }

  // Admin config hub — bundles the admin-only pages (API, Prompts do sistema,
  // Tags, Grupos) as tabs on one page, mirroring the user Configurações page.
  // Administração has two scopes. The install-wide tabs (API, prompts, users, groups, baldes) are for
  // the Balde - Admins group. The tabs of the ACTIVE balde follow its rule (D1, 2.0.19): organizing its
  // content (domains, categories, moving skills, quality policy, duplicates) is for its creator and
  // curators; who creates in each domain is for its creator. Admins are per balde, so an install admin
  // sees the balde tabs only in the baldes that list them.
  const ADMIN_INSTALL_TABS = [
    ['api', 'API'],
    ['prompts', 'Prompts do sistema'],
    ['usuarios', 'Usuários'],
    ['groups', 'Grupos'],
    ['baldes', 'Baldes'],
    ['pastas', 'Pastas do compartilhamento']
  ];
  const ADMIN_BALDE_TABS = [
    ['domains', 'Domínios'],
    ['categorias', 'Categorias'],
    ['move-skill', 'Mover skill de domínio'],
    ['user-domains', 'Domínios por usuário'],
    ['checklist', 'Checklist de qualidade'],
    ['scoring', 'Pontuação'],
    ['dedup', 'Duplicatas']
  ];
  function adminTabsAvailable() {
    // Pastas do compartilhamento só onde o aplicador de acesso do OneDrive existe (a versão local).
    const install = isAdmin() ? ADMIN_INSTALL_TABS.filter(([key]) => key !== 'pastas' || state.acessoApplier) : [];
    // local version: the balde's Domínios has its own menu page
    const balde = ADMIN_BALDE_TABS.filter(([key]) => !(state.mountsEnabled && key === 'domains')).filter(([key]) =>
      roleAllows(key === 'user-domains' ? 'administrar' : 'curar')
    );
    return { install, balde, keys: [...install, ...balde].map(([key]) => key) };
  }

  function renderAdmin() {
    const { install, balde, keys } = adminTabsAvailable();
    if (!keys.length) {
      return '<section class="panel empty-state">Acesso restrito a administradores.</section>';
    }
    const tab = keys.includes(state.adminTab) ? state.adminTab : keys[0];
    const activeBalde = (state.repos || []).find((r) => r.name === state.activeRepo);
    const baldeName = (activeBalde && (activeBalde.titulo || activeBalde.name)) || state.activeRepo || '';
    const tabButton = ([key, label]) =>
      `<button class="tab ${tab === key ? 'active' : ''}" data-action="setAdminTab" data-admin-tab="${key}">${label}</button>`;
    const body =
      tab === 'prompts'
        ? renderPromptsBody()
        : tab === 'domains'
          ? renderDomainsBody()
          : tab === 'categorias'
            ? renderCategoriasBody()
            : tab === 'move-skill'
              ? renderMoveSkillBody()
              : tab === 'user-domains'
                ? renderUserDomainsPanel()
                : tab === 'usuarios'
                  ? renderUsersAdminBody()
                  : tab === 'groups'
                    ? renderGroupsBody()
                    : tab === 'checklist'
                      ? renderEvalChecklistBody()
                      : tab === 'scoring'
                        ? renderScoringBody()
                        : tab === 'pastas'
                          ? renderShareFoldersBody()
                          : tab === 'baldes'
                            ? renderBaldesBody()
                            : tab === 'dedup'
                              ? renderDedupBody()
                              : renderApiBody();
    return `
      <section class="panel settings-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Configurações</p>
            <h2>Administração</h2>
          </div>
        </div>
        <div class="tabs" role="tablist">
          ${install.length && balde.length ? '<span class="tabs-group-label">Instalação</span>' : ''}
          ${install.map(tabButton).join('')}
          ${balde.length ? `<span class="tabs-group-label">Balde ${escapeHtml(baldeName)}</span>` : ''}
          ${balde.map(tabButton).join('')}
        </div>
        ${body}
      </section>
    `;
  }
  // O "log" de papéis vive em groups/ DENTRO do corpus — somente-leitura para usuários no
  // SharePoint. Editar aqui grava os ymls (e o git registra); o config.json local não manda.
  const ROLE_GROUPS = {
    admin: { slug: 'balde-admins', name: 'Balde - Admins' },
    curador: { slug: 'balde-curadores', name: 'Balde - Curadores' }
  };

  async function loadUsersAdmin() {
    state.usersAdmin = { loading: true, users: [], groups: [], error: null, busy: null };
    renderShell();
    try {
      const res = await fetch('/api/users');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const byEmail = new Map();
      for (const u of data.users || []) {
        byEmail.set(String(u.email).toLowerCase(), { ...u });
      }
      // membros de grupos que nunca logaram também aparecem (adicionados por e-mail)
      const groupsFull = await fetch('/api/groups')
        .then((r) => r.json())
        .catch(() => ({ groups: [] }));
      for (const g of groupsFull.groups || []) {
        for (const m of g.members || []) {
          const k = String(m).trim().toLowerCase();
          if (!k) continue;
          if (!byEmail.has(k)) {
            byEmail.set(k, { email: k, name: k, lastSeen: null, groups: [] });
          }
          const u = byEmail.get(k);
          if (!u.groups.includes(g.name)) {
            u.groups.push(g.name);
          }
        }
      }
      state.usersAdmin = {
        loading: false,
        users: [...byEmail.values()].sort((a, b) =>
          String(a.name || a.email).localeCompare(String(b.name || b.email), 'pt-BR')
        ),
        groups: groupsFull.groups || [],
        error: null,
        busy: null
      };
    } catch (error) {
      state.usersAdmin = {
        loading: false,
        users: [],
        groups: [],
        error: error.message || 'Falha ao carregar usuários.',
        busy: null
      };
    }
    renderShell();
  }

  async function toggleRoleGroup(email, role) {
    const spec = ROLE_GROUPS[role];
    const ua = state.usersAdmin;
    if (!spec || !ua) {
      return;
    }
    ua.busy = `${role}:${email}`;
    renderShell();
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(spec.slug)}`);
      const data = await res.json().catch(() => ({}));
      const e = String(email).trim().toLowerCase();
      if (res.status === 404 || !data.group) {
        const create = await fetch('/api/groups', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slug: spec.slug,
            name: spec.name,
            description: `Papel ${spec.name} (gerenciado na aba Usuários)`,
            members: [e]
          })
        });
        const cd = await create.json().catch(() => ({}));
        if (!create.ok || !cd.ok) {
          throw new Error(cd.error || `HTTP ${create.status}`);
        }
        toast(`${e} agora é ${role}.`, 'success');
      } else {
        const members = (data.group.members || []).map((m) => String(m).trim().toLowerCase()).filter(Boolean);
        const has = members.includes(e);
        const next = has ? members.filter((m) => m !== e) : [...members, e];
        const put = await fetch(`/api/groups/${encodeURIComponent(spec.slug)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ members: next })
        });
        const pd = await put.json().catch(() => ({}));
        if (!put.ok || !pd.ok) {
          throw new Error(pd.error || `HTTP ${put.status}`);
        }
        toast(has ? `${e} deixou de ser ${role}.` : `${e} agora é ${role}.`, 'success');
      }
    } catch (error) {
      toast(error.message || 'Falha ao atualizar o papel.', 'warning');
    }
    await loadUsersAdmin();
  }

  async function usersAdminAdd() {
    const input = document.querySelector('[data-users-add-email]');
    const roleSel = document.querySelector('[data-users-add-role]');
    const email = String((input && input.value) || '')
      .trim()
      .toLowerCase();
    const role = String((roleSel && roleSel.value) || 'curador');
    if (!email.includes('@')) {
      toast('Informe um e-mail válido.', 'warning');
      return;
    }
    await toggleRoleGroup(email, role);
  }

  function renderUsersAdminBody() {
    const ua = state.usersAdmin;
    if (!ua) {
      setTimeout(() => loadUsersAdmin(), 0);
      return '<div class="repo-empty">Carregando usuários…</div>';
    }
    if (ua.loading) {
      return '<div class="repo-empty">Carregando usuários…</div>';
    }
    const roleNames = [ROLE_GROUPS.admin.name, ROLE_GROUPS.curador.name];
    const row = (u) => {
      const isAdminU = (u.groups || []).includes(ROLE_GROUPS.admin.name);
      const isCur = (u.groups || []).includes(ROLE_GROUPS.curador.name);
      const other = (u.groups || []).filter((g) => !roleNames.includes(g));
      return `
      <tr>
        <td><strong>${escapeHtml(u.name || u.email)}</strong><br><code class="muted">${escapeHtml(u.email)}</code></td>
        <td>${u.lastSeen ? escapeHtml(String(u.lastSeen).slice(0, 10)) : '<span class="muted">nunca</span>'}</td>
        <td>${other.map((g) => `<code class="muted">${escapeHtml(g)}</code>`).join(' ') || '<span class="muted">—</span>'}</td>
        <td><input type="checkbox" data-action="toggleRoleGroup" data-email="${escapeHtml(u.email)}" data-role="curador" ${isCur ? 'checked' : ''} ${ua.busy ? 'disabled' : ''}></td>
        <td><input type="checkbox" data-action="toggleRoleGroup" data-email="${escapeHtml(u.email)}" data-role="admin" ${isAdminU ? 'checked' : ''} ${ua.busy ? 'disabled' : ''}></td>
      </tr>`;
    };
    return `
        <article class="settings-card">
          <h3>Usuários e papéis</h3>
          <p>Os papéis vivem em <code>groups/</code> <strong>dentro do corpus</strong> — pasta que os usuários só leem (o SharePoint aplica). Mudar o <code>config.json</code> local <strong>não</strong> dá admin: o servidor ignora papéis declarados e resolve pelos arquivos de grupo, pelo e-mail da conta OneDrive que sincroniza o share. <strong>Acesso</strong> em si (ver o share, escrever no exchange) continua sendo o compartilhamento do SharePoint; usuários novos aparecem aqui no primeiro acesso.</p>
          ${ua.error ? `<div class="form-alert form-alert-error">${escapeHtml(ua.error)}</div>` : ''}
          <div class="commons-table-wrap">
            <table class="commons-table">
              <thead><tr><th>Usuário</th><th>Último acesso</th><th>Grupos</th><th>Curador</th><th>Admin</th></tr></thead>
              <tbody>${ua.users.map(row).join('')}</tbody>
            </table>
          </div>
          <div class="row-actions" style="margin-top:12px; gap:8px; align-items:center">
            <input data-users-add-email placeholder="nome.sobrenome@empresa.com.br" style="min-width:240px" ${ua.busy ? 'disabled' : ''}>
            <select data-users-add-role ${ua.busy ? 'disabled' : ''}>
              <option value="curador">Curador</option>
              <option value="admin">Admin</option>
            </select>
            <button class="ghost-button" data-action="usersAdminAdd" ${ua.busy ? 'disabled' : ''}>${icon('plus')}Adicionar papel</button>
          </div>
        </article>`;
  }
  // Registry CRUD (create + edit titulo/groups/members/profile). Names are permanent.
  function renderBaldesBody() {
    const b = state.baldesAdmin || { repos: [], form: {}, editing: null, error: null, ok: null };
    const f = b.form || {};
    const ed = b.editing;
    const isEditing = !!ed;
    const paneOpen = isEditing || !!b.createOpen; // edit auto-opens; create is collapsed by default
    const v = isEditing ? ed : f;
    const groupsVal = isEditing ? (ed.groups || []).join(', ') : f.groups || '';
    const membersVal = isEditing ? (ed.members || []).join(', ') : f.members || '';
    const row = (r) => `
      <tr>
        <td><code>${escapeHtml(r.name)}</code></td>
        <td>${escapeHtml(r.titulo || r.name)}</td>
        <td>${escapeHtml(r.profile === 'light' ? 'leve (sem fila)' : 'completa')}</td>
        <td>${(r.groups || []).map((g) => `<code class="muted">${escapeHtml(g)}</code>`).join(' ') || '<span class="muted">—</span>'}</td>
        <td>${(r.members || []).map((m) => `<code class="muted">${escapeHtml(m)}</code>`).join(' ') || '<span class="muted">—</span>'}</td>
        <td>${r.name === 'corporate' ? '<span class="muted">padrão</span>' : `<button class="ghost-button tiny" data-action="baldesEdit" data-repo="${escapeHtml(r.name)}">${icon('edit')}Editar</button>`}${b.sp && b.sp.configured ? ` <button class="ghost-button tiny" data-action="baldesSpSync" data-repo="${escapeHtml(r.name)}" title="Empurra os membros deste balde para o grupo/pasta do SharePoint (Leitura)">${icon('shield')}Sincronizar SharePoint</button>` : ''}</td>
      </tr>`;
    const paneBody = `
        <div class="balde-form-grid">
          ${isEditing ? '' : `<label>Nome <small>(slug, permanente)</small><input data-baldes-field="name" value="${escapeHtml(f.name || '')}" placeholder="ex.: revenue"></label>`}
          <label>Título<input data-baldes-field="titulo" value="${escapeHtml(v.titulo || '')}" placeholder="ex.: Comercial"></label>
          <label>Governança<select data-baldes-field="profile"><option value="full" ${!isEditing || ed.profile !== 'light' ? 'selected' : ''}>completa (fila)</option><option value="light" ${isEditing && ed.profile === 'light' ? 'selected' : ''}>leve (sem fila)</option></select></label>
          ${
            isEditing
              ? // A lista aqui junta donos, curadores e membros; salvá-la como membros fechava um balde aberto.
                '<p class="muted">O acesso deste balde (quem lê, curadores e admins) fica no próprio balde, em <strong>Configurações › Baldes › Acesso</strong>.</p>'
              : `<label>Grupos <small>(Authentik, vírgula)</small><input data-baldes-field="groups" value="${escapeHtml(groupsVal)}" placeholder="vazio = todos"></label>
          <label>Membros <small>(e-mails, vírgula)</small><input data-baldes-field="members" value="${escapeHtml(membersVal)}" placeholder="vazio = todos"></label>`
          }
        </div>
        <div class="form-actions">
          ${
            isEditing
              ? `<button class="primary-button small" data-action="baldesSave">${icon('check')}Salvar</button><button class="ghost-button small" data-action="baldesCancelEdit">Cancelar</button>`
              : `<button class="primary-button small" data-action="baldesCreate">${icon('plus')}Criar balde</button>`
          }
        </div>`;
    return `
      <div class="settings-card baldes-card">
        <h3>Baldes (repos)</h3>
        <p class="muted">Partições independentes do corpus — cada balde tem seus próprios domínios, skills, cápsulas e ledgers git. Acesso por grupos do Authentik <em>ou</em> e-mails; ambos vazios = todos os usuários autenticados. O nome nunca muda.</p>
        ${b.error ? `<div class="form-alert form-alert-error">${escapeHtml(b.error)}</div>` : ''}
        ${b.ok ? `<div class="form-alert">${escapeHtml(b.ok)}</div>` : ''}
        ${
          b.sp
            ? b.sp.configured
              ? `<p class="muted">${icon('shield')} SharePoint conectável (PnP): membros de cada balde podem ser empurrados para o grupo/pasta correspondente. ${escapeHtml(b.sp.probe || '')}</p>`
              : '<p class="muted">SharePoint não configurado nesta instalação (defina sharePoint na config do BaldeApp / envs SP_*) — as permissões de pasta seguem manuais.</p>'
            : ''
        }
        ${b.spResult ? `<div class="form-alert"><strong>SharePoint:</strong><pre class="ingest-cand-body">${escapeHtml(b.spResult)}</pre></div>` : ''}
        ${
          !isEditing && state.mountsEnabled
            ? '<p class="muted">Criar balde agora fica em <strong>Configurações › Baldes</strong>: cada pessoa cria o seu numa pasta à escolha, e o acesso fica no próprio balde. Aqui os admins de cada balde ajustam o título e a governança dele.</p>'
            : `<div class="balde-pane ${paneOpen ? 'is-open' : ''}">
          ${
            isEditing
              ? `<div class="balde-pane-head is-static">${icon('edit')}<span>Editar <code>${escapeHtml(ed.name)}</code></span></div>`
              : `<button class="balde-pane-head" data-action="baldesToggleCreate" aria-expanded="${paneOpen ? 'true' : 'false'}">${icon('chevron')}<span>Criar novo balde</span></button>`
          }
          <div class="balde-pane-body">${paneBody}</div>
        </div>`
        }
        <div class="table-scroll"><table class="mini-table baldes-table">
          <thead><tr><th>Nome</th><th>Título</th><th>Governança</th><th>Grupos</th><th>Membros</th><th></th></tr></thead>
          <tbody>${(b.repos || []).map(row).join('')}</tbody>
        </table></div>
      </div>`;
  }
  function renderDedupBody() {
    const d = state.dedupAdmin || { pairs: [], nodes: 0, threshold: 0.45, dismissed: 0, loading: false };
    const pct = (s) => `${Math.round(s * 100)}%`;
    return `
      <div class="settings-card">
        <h3>Duplicatas no corpus — balde ativo</h3>
        <p class="muted">Varredura <strong>léxica</strong> (local, instantânea, zero tokens): ${d.nodes} nós comparados aos pares; limiar ${pct(d.threshold)}. Suprimidos: pares já <strong>vinculados</strong> (âncora↔cápsula), pares <strong>série↔série</strong>${d.suppressedSeries ? ` (${d.suppressedSeries})` : ''}, <strong>irmãos de catálogo</strong> — skills referenciadas pela mesma âncora${d.suppressedSiblings ? ` (${d.suppressedSiblings})` : ''} — e os marcados como "não é duplicata" (${d.dismissed}). Tiers com IA (embeddings + juiz) entram por cima desta shortlist quando necessário.</p>
        <div class="form-actions">
          <button class="ghost-button small" data-action="dedupRescan">${icon('search')}Reexecutar varredura</button>
        </div>
        ${
          d.loading
            ? '<p class="muted">Varrendo…</p>'
            : d.pairs.length
              ? `
        <div class="table-scroll"><table class="mini-table">
          <thead><tr><th>Similaridade</th><th>Nó A</th><th>Nó B</th><th>Termos em comum</th><th></th></tr></thead>
          <tbody>${d.pairs
            .map(
              (p, i) => `
            <tr>
              <td><span class="dup-score ${p.score >= 0.6 ? 'dup-high' : ''}">${p.exact ? 'idêntico' : pct(p.score)}</span></td>
              <td><span class="graph-scope-tag">${p.a.kind === 'skill' ? 'skill' : 'cápsula'}</span> <button class="linklike" data-action="dupOpenNode" data-node="${escapeHtml(p.a.id)}">${escapeHtml(p.a.title)}</button></td>
              <td><span class="graph-scope-tag">${p.b.kind === 'skill' ? 'skill' : 'cápsula'}</span> <button class="linklike" data-action="dupOpenNode" data-node="${escapeHtml(p.b.id)}">${escapeHtml(p.b.title)}</button></td>
              <td><small class="muted">${escapeHtml((p.terms || []).join(', '))}</small></td>
              <td><button class="ghost-button tiny" data-action="dedupDismiss" data-idx="${i}" title="Marcar como não-duplicata (suprime este par)">não é duplicata</button></td>
            </tr>`
            )
            .join('')}
          </tbody>
        </table></div>`
              : '<p class="muted">Nenhum par suspeito acima do limiar — corpus sem duplicatas aparentes. 🎉</p>'
        }
      </div>`;
  }

  async function loadDedupAdmin() {
    state.dedupAdmin = {
      ...(state.dedupAdmin || { pairs: [], nodes: 0, threshold: 0.45, dismissed: 0 }),
      loading: true
    };
    try {
      const res = await fetch('/api/dedup/corpus');
      const data = await res.json();
      if (data.ok)
        state.dedupAdmin = {
          pairs: data.pairs || [],
          nodes: data.nodes || 0,
          threshold: data.threshold,
          dismissed: data.dismissed || 0,
          suppressedSeries: data.suppressedSeries || 0,
          suppressedSiblings: data.suppressedSiblings || 0,
          loading: false
        };
      else state.dedupAdmin = { pairs: [], nodes: 0, threshold: 0.45, dismissed: 0, loading: false };
    } catch (error) {
      state.dedupAdmin = { pairs: [], nodes: 0, threshold: 0.45, dismissed: 0, loading: false };
    }
  }

  async function loadBaldesAdmin() {
    try {
      const res = await fetch('/api/repos', { headers: { accept: 'application/json' } });
      const data = await res.json();
      state.baldesAdmin = { ...(state.baldesAdmin || {}), repos: data.repos || [], error: null };
    } catch (error) {
      state.baldesAdmin = { repos: [], error: 'Não foi possível carregar os baldes.' };
    }
    try {
      const sp = await (await fetch('/api/sp/status')).json();
      state.baldesAdmin.sp = sp.configured ? { configured: true, probe: sp.probe || '' } : { configured: false };
    } catch (error) {
      state.baldesAdmin.sp = { configured: false };
    }
  }

  function baldesFormRead() {
    const out = {};
    document.querySelectorAll('[data-baldes-field]').forEach((el) => {
      out[el.dataset.baldesField] = el.value;
    });
    return out;
  }

  const parseCsvList = (s) =>
    String(s || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  async function baldesCreate() {
    const f = baldesFormRead();
    const body = {
      name: f.name,
      titulo: f.titulo,
      groups: parseCsvList(f.groups),
      members: parseCsvList(f.members),
      profile: f.profile
    };
    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!data.ok) {
        state.baldesAdmin.error = data.error;
        state.baldesAdmin.ok = null;
        renderShell();
        return;
      }
      state.baldesAdmin.form = {};
      state.baldesAdmin.error = null;
      state.baldesAdmin.ok = `Balde "${data.repo.name}" criado.`;
      state.baldesAdmin.createOpen = false;
    } catch (error) {
      state.baldesAdmin.error = 'Falha ao criar.';
    }
    await loadBaldesAdmin();
    await refreshRepos();
    renderShell();
  }

  async function baldesSave() {
    const ed = state.baldesAdmin && state.baldesAdmin.editing;
    if (!ed) return;
    const f = baldesFormRead();
    // Só título e governança: o acesso é editado no próprio balde (ver o formulário acima).
    const body = { titulo: f.titulo, profile: f.profile };
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(ed.name)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!data.ok) {
        state.baldesAdmin.error = data.error;
        renderShell();
        return;
      }
      state.baldesAdmin.editing = null;
      state.baldesAdmin.error = null;
      state.baldesAdmin.ok = `Balde "${ed.name}" atualizado.`;
    } catch (error) {
      state.baldesAdmin.error = 'Falha ao salvar.';
    }
    await loadBaldesAdmin();
    await refreshRepos();
    renderShell();
  }

  // Machine-access internals: exposed endpoints and usage. Personal API keys
  // ("Minhas chaves de API") moved to the Configurações page. Now a tab body of
  // the Administração page (renderAdmin); the standalone route is defensive.
  function renderApiBody() {
    const tab = state.apiTab === 'usage' ? 'usage' : 'exposed';
    return `
        <div class="tabs sub-tabs" role="tablist">
          <button class="tab ${tab === 'exposed' ? 'active' : ''}" data-action="setApiTab" data-api-tab="exposed">APIs expostas</button>
          <button class="tab ${tab === 'usage' ? 'active' : ''}" data-action="setApiTab" data-api-tab="usage">Uso</button>
        </div>
        ${tab === 'usage' ? renderAdminUsageCard() : renderAdminApisCard()}
    `;
  }

  function renderApiAccess() {
    const heading = `
      <div class="section-heading">
        <div>
          <p class="eyebrow">Configurações</p>
          <h2>API</h2>
        </div>
      </div>`;
    // Keys now live under Configurações — send non-admins there.
    if (!isAdmin()) {
      return `<section class="panel settings-panel">${heading}<article class="settings-card"><p>Suas chaves de API agora ficam em <strong>Configurações → Minhas chaves de API</strong>.</p></article></section>`;
    }
    return `<section class="panel settings-panel">${heading}${renderApiBody()}</section>`;
  }

  // Look & Feel cards (theme + chat buddy size) — the "Aparência" tab of the
  // config page. Returns the cards only, so it composes inside renderSettings.
  // Aba "Geral": preferências compactas — segmentos de pílulas em vez de cartões grandes.
  function renderAppearanceCards() {
    const seg = (active, action, attr, items) => `
      <div class="pref-seg">${items
        .map(
          ([value, ic, title, desc]) => `
        <button class="pref-opt ${active === value ? 'active' : ''}" data-action="${action}" data-${attr}="${value}" aria-pressed="${active === value}" title="${escapeHtml(desc)}">${icon(ic)}<span>${title}</span></button>`
        )
        .join('')}
      </div>`;
    const block = (title, hint, body) => `
      <div class="pref-block">
        <div class="pref-label"><strong>${title}</strong>${hint ? `<small class="muted">${hint}</small>` : ''}</div>
        ${body}
      </div>`;
    const su = state.startup;
    if (su === undefined) {
      state.startup = null;
      setTimeout(() => loadStartupState(), 0);
    }
    const startupBlock =
      su && su.supported
        ? block(
            'Inicialização',
            'Da máquina — abre minimizado na bandeja junto com o Windows.',
            `
        <label class="pref-toggle"><input type="checkbox" data-action="toggleStartup" ${su.enabled ? 'checked' : ''} ${su.busy ? 'disabled' : ''}> Abrir o Balde junto com o Windows</label>`
          )
        : '';
    return `
        <article class="settings-card">
          <h3>Geral</h3>
          ${block(
            'Tema',
            'Salvo no seu perfil, vale em qualquer dispositivo.',
            seg(state.theme || 'system', 'setTheme', 'theme', [
              ['light', 'sun', 'Claro', 'Sempre no tema claro'],
              ['dark', 'moon', 'Escuro', 'Sempre no tema escuro'],
              ['system', 'monitor', 'Sistema', 'Segue o sistema operacional']
            ])
          )}
          ${block(
            'Buddy do chat',
            'Avatar sobre o chat.',
            seg(state.buddySize || 'medium', 'setBuddySize', 'size', [
              ['small', 'smiley', 'Pequeno', 'Discreto, no canto'],
              ['medium', 'smiley', 'Médio', 'Tamanho padrão'],
              ['large', 'smiley', 'Grande', 'Bem visível'],
              ['off', 'x', 'Desligado', 'Não mostrar']
            ])
          )}
          ${block(
            'Página inicial',
            'Onde o Balde abre — e o clique no logo.',
            seg(startViewOr('explore'), 'setStartView', 'startview', [
              ...(chatAvailable() ? [['chat', 'chat', 'Chat', 'Converse com suas skills']] : []),
              ['explore', 'folder', 'Corpus', 'Explorar o corpus'],
              ['graph', 'spark', 'Grafo', 'Mapa de conhecimento']
            ])
          )}
          ${startupBlock}
        </article>
    `;
  }

  // "Abrir com o Windows" via web: o servidor local gerencia a chave Run (o shell passa o
  // caminho do exe em BALDE_SHELL_EXE). Fora da instalação local, o bloco simplesmente some.
  async function loadStartupState() {
    try {
      const res = await fetch('/api/startup');
      const data = await res.json().catch(() => ({}));
      state.startup =
        res.ok && data.ok
          ? { supported: !!data.supported, enabled: !!data.enabled, busy: false }
          : { supported: false };
    } catch (error) {
      state.startup = { supported: false };
    }
    renderShell();
  }

  async function toggleStartup() {
    const su = state.startup;
    if (!su || !su.supported || su.busy) {
      return;
    }
    su.busy = true;
    renderShell();
    try {
      const res = await fetch('/api/startup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enable: !su.enabled })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      su.enabled = !!data.enabled;
      toast(su.enabled ? 'O Balde abre junto com o Windows.' : 'Abertura automática desligada.', 'success');
    } catch (error) {
      toast(error.message || 'Falha ao alterar a inicialização.', 'warning');
    }
    su.busy = false;
    renderShell();
  }

  // Standalone Aparência page — retained as a defensive route; the appearance
  // cards now normally live as a tab inside renderSettings().
  function renderAppearance() {
    return `
      <section class="panel settings-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Configurações</p>
            <h2>Aparência</h2>
          </div>
        </div>
        ${renderAppearanceCards()}
      </section>
    `;
  }

  // "Prompts do sistema" — tab body of the Administração page.
  function renderPromptsBody() {
    return `
        <p class="structure-lead">Prompts internos do assistente de criação de skills (<strong>Criar skill</strong>). Editáveis apenas por admins; cada alteração é versionada em git.</p>
        ${renderSystemPromptsCard()}
    `;
  }

  function renderPromptsPage() {
    if (!isAdmin()) {
      return '<section class="panel empty-state">Acesso restrito a administradores.</section>';
    }
    return `<section class="prompts-page">${renderPromptsBody()}</section>`;
  }

  return {
    renderAiProviderCard,
    loadAiCliStatus,
    aiMcpSetup,
    aiCliLogin,
    aiCliTest,
    aiCliUse,
    renderAiCliCard,
    runConnDiag,
    copyConnDiag,
    renderConnDiagCard,
    adminTabsAvailable,
    renderAdmin,
    loadUsersAdmin,
    toggleRoleGroup,
    usersAdminAdd,
    loadDedupAdmin,
    loadBaldesAdmin,
    parseCsvList,
    baldesCreate,
    baldesSave,
    renderApiAccess,
    renderAppearanceCards,
    toggleStartup,
    renderAppearance,
    renderPromptsPage
  };
}
