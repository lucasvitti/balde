// Administração › Pastas do compartilhamento: quem abre e quem grava cada pasta do compartilhamento no
// OneDrive, comparado com o acesso esperado. Mesmo fluxo de "Aplicar no OneDrive" de um balde: a página pede
// um comando, o admin roda na janela dele com o próprio login (o script mostra o que muda e pede
// confirmação), e a página lê o resultado que o script escreve nesta máquina.
export function createShareFoldersFeature({ state, renderShell, toast, escapeHtml, icon, fmtDateTime }) {
  const POLL_MS = 2000;
  const POLL_MAX_MS = 10 * 60 * 1000;
  let pollTimer = null;

  const ROLE = { write: 'gravam', read: 'leem', owner: 'com controle total', '': 'sem acesso' };
  // Situação em texto e cor (nunca só a cor).
  const SITUATION = {
    ok: ['pass', 'como esperado'],
    diferente: ['fail', 'diferente'],
    erro: ['fail', 'erro na leitura'],
    'sem-dados': ['pending', 'não verificada'],
    'sem-pasta': ['none', 'não existe']
  };

  function badge(situacao) {
    const [cls, label] = SITUATION[situacao] || ['none', String(situacao || '')];
    return `<span class="gov-badge gov-eval-${cls}">${escapeHtml(label)}</span>`;
  }
  const roleText = (r) => ROLE[r || ''] || String(r);
  const expectedText = (e) => `membros ${roleText(e.membros)}, permissões próprias`;
  function currentText(a) {
    if (!a) return '—';
    if (a.error) return a.error;
    return `membros ${roleText(a.membros)}, ${a.inherits ? 'herda' : 'permissões próprias'}`;
  }
  function actionText(a) {
    if (a.acao === 'nivel-membros') return `membros: ${roleText(a.de)} → ${roleText(a.para)}`;
    return 'permissões próprias, mantendo todos';
  }
  const sharepointLink = (url) =>
    url ? ` <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Abrir no SharePoint</a>` : '';

  async function loadShareFolders() {
    state.shareFolders = { ...(state.shareFolders || {}), loading: true, error: null };
    renderShell();
    try {
      const res = await fetch('/api/compartilhamento/pastas');
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      state.shareFolders = { ...state.shareFolders, loading: false, data: d };
    } catch (error) {
      state.shareFolders = { ...state.shareFolders, loading: false, error: error.message || 'Erro de rede.' };
    }
    renderShell();
  }

  function renderShareFoldersBody() {
    const s = state.shareFolders;
    if (!s || (s.loading && !s.data)) return '<p class="repo-empty">Carregando…</p>';
    if (s.error && !s.data) return `<div class="form-alert form-alert-error">${escapeHtml(s.error)}</div>`;
    const d = s.data || {};
    const folders = Array.isArray(d.folders) ? d.folders : [];
    const rows = folders
      .map(
        (f) => `<tr>
          <td><strong>${escapeHtml(f.label)}</strong><br><small class="muted">${escapeHtml(f.motivo)}</small></td>
          <td>${escapeHtml(expectedText(f.esperado))}</td>
          <td>${escapeHtml(f.exists ? currentText(f.atual) : '—')}</td>
          <td>${badge(f.situacao)}${f.situacao !== 'ok' ? sharepointLink(f.atual && f.atual.webUrl) : ''}</td>
        </tr>`
      )
      .join('');
    const lastBits = [];
    if (d.lastVerification) lastBits.push(`verificadas em ${fmtDateTime(d.lastVerification.at)}`);
    if (d.lastReceipt) lastBits.push(`última aplicação em ${fmtDateTime(d.lastReceipt.at)}`);
    const drift = folders.some((f) => f.situacao === 'diferente' || f.situacao === 'erro');
    return `
      <article class="settings-card share-folders">
        <h3>Pastas do compartilhamento</h3>
        <p>Quem abre e quem grava cada pasta do compartilhamento no OneDrive. O esperado: só os admins gravam e os membros do site leem; em <code>exchange</code>, onde fica a pasta de envio de cada pessoa, os membros gravam. O Balde não fala com a Microsoft: você roda um comando na sua janela, com o seu login; ele mostra o que vai mudar e pede confirmação antes de aplicar.</p>
        ${d.available ? '' : `<div class="form-alert">${escapeHtml(d.reason || 'Indisponível nesta instalação.')}</div>`}
        ${rows ? `<div class="table-scroll"><table class="mini-table share-folders-table"><thead><tr><th>Pasta</th><th>Esperado</th><th>Hoje</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
        <p class="muted">${lastBits.length ? `Pastas ${escapeHtml(lastBits.join('; '))}.` : 'Ainda não verificadas nesta máquina: use "Verificar agora".'}</p>
        ${drift ? '<p>Há pastas diferentes do esperado. "Aplicar o esperado" mostra o que muda antes de mudar.</p>' : ''}
        ${
          d.available
            ? `<div class="form-actions">
          <button class="ghost-button small" data-action="shareFoldersVerify">${icon('search')}Verificar agora</button>
          <button class="primary-button small" data-action="shareFoldersApply">${icon('check')}Aplicar o esperado</button>
        </div>`
            : ''
        }
        ${s.run ? renderRun(s.run) : ''}
      </article>`;
  }

  function renderRun(run) {
    // O script sempre escreve o resultado, falhas incluídas; nada chega só se o pwsh 7 não abriu ou a
    // pergunta s/N ainda está aberta na janela do cmd.
    const body = run.result
      ? renderResult(run)
      : run.timedOut
        ? `<p class="muted">Nada recebido ainda: confira a janela do cmd (o comando precisa do pwsh 7; a pergunta s/N ainda está aberta?).</p>
        <div class="form-actions"><button class="ghost-button small" data-action="shareFoldersRepoll">Continuar aguardando</button></div>`
        : '<p class="muted">Cole o comando no Prompt de Comando (cmd) e confirme por lá. Aguardando o resultado…</p>';
    return `
      <div class="acesso-run" role="status">
        <p><strong>${run.kind === 'p' ? 'Aplicar o esperado' : 'Verificar as pastas'}</strong></p>
        <pre class="acesso-cmd">${escapeHtml(run.command)}</pre>
        <div class="form-actions"><button class="ghost-button small" data-action="shareFoldersCopy">${icon('copy')}Copiar comando</button></div>
        ${body}
      </div>`;
  }

  function renderResult(run) {
    const r = run.result || {};
    if (run.kind === 'v') {
      if (r.error) return `<div class="form-alert form-alert-error">${escapeHtml(r.error)}</div>`;
      return '<p>Verificação recebida: a tabela acima mostra como as pastas estão agora.</p>';
    }
    const label =
      {
        aplicado: 'Aplicado: as pastas estão como o esperado.',
        parcial: 'Aplicado em parte: veja o que faltou abaixo.',
        verificado: 'Nada a mudar: as pastas já estavam como o esperado.',
        'acao-manual': 'Nada foi mudado: há pastas que precisam de ajuste no SharePoint.',
        cancelado: 'Cancelado por você: nada mudou.',
        simulado: 'Simulação: nada foi alterado.',
        erro: 'Erro ao aplicar.'
      }[r.status] || String(r.status || '');
    const folders = Array.isArray(r.folders) ? r.folders : [];
    const rows = folders
      .map((f) => {
        const done = (f.acoes || []).map((a) => `${actionText(a)}: ${a.resultado}`).join('; ') || 'nada a mudar';
        return `<tr><td>${escapeHtml(f.key)}</td><td>${escapeHtml(done)}</td><td>${badge(f.situacao)}${f.situacao !== 'ok' ? sharepointLink(f.webUrl) : ''}${f.erro ? `<br><small>${escapeHtml(f.erro)}</small>` : ''}</td></tr>`;
      })
      .join('');
    const warnings = [...(r.warnings || []), ...folders.flatMap((f) => (f.avisos || []).map((w) => `${f.key}: ${w}`))];
    const manual = folders.some((f) => f.situacao !== 'ok')
      ? '<p class="muted">Para o que ficou diferente: abra a pasta no SharePoint › Gerenciar acesso › Configurações avançadas.</p>'
      : '';
    return `
      <p><strong>${escapeHtml(label)}</strong></p>
      ${rows ? `<div class="table-scroll"><table class="mini-table"><thead><tr><th>Pasta</th><th>O que foi feito</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
      ${warnings.length ? `<ul class="acesso-warnings">${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
      ${manual}`;
  }

  function stopPoll() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function poll() {
    stopPoll();
    const run = state.shareFolders && state.shareFolders.run;
    if (!run || run.result || run.timedOut) return;
    pollTimer = setTimeout(async () => {
      const cur = state.shareFolders && state.shareFolders.run;
      if (!cur || cur.id !== run.id) return; // a newer run replaced this one
      try {
        const d = await (await fetch(`/api/compartilhamento/resultado?id=${encodeURIComponent(cur.id)}`)).json();
        if (d && d.ok && !d.pending) {
          state.shareFolders.run = { ...cur, result: d.result };
          await loadShareFolders(); // a tabela passa a mostrar o estado novo
          return;
        }
      } catch (error) {
        /* keep polling */
      }
      if (Date.now() - cur.startedAt > POLL_MAX_MS) {
        state.shareFolders.run = { ...cur, timedOut: true };
        renderShell();
        return;
      }
      poll();
    }, POLL_MS);
  }

  async function shareFoldersStart(kind) {
    stopPoll();
    try {
      const res = await fetch(`/api/compartilhamento/${kind === 'p' ? 'plano' : 'verificar'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      state.shareFolders = {
        ...(state.shareFolders || {}),
        run: { kind, id: d.id, command: d.command, startedAt: Date.now(), result: null, timedOut: false }
      };
    } catch (error) {
      toast(error.message || 'Não foi possível preparar o comando.', 'warning');
      return;
    }
    renderShell();
    poll();
  }

  async function shareFoldersCopy() {
    const cmd = state.shareFolders && state.shareFolders.run && state.shareFolders.run.command;
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd);
      toast('Comando copiado: cole no Prompt de Comando (cmd).', 'success');
    } catch (error) {
      toast('Não deu para copiar: selecione o comando e copie.', 'warning');
    }
  }

  function shareFoldersRepoll() {
    const run = state.shareFolders && state.shareFolders.run;
    if (!run) return;
    state.shareFolders.run = { ...run, timedOut: false, startedAt: Date.now() };
    renderShell();
    poll();
  }

  return { loadShareFolders, renderShareFoldersBody, shareFoldersStart, shareFoldersCopy, shareFoldersRepoll };
}
