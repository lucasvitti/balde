// A checklist de qualidade e a pontuação do Selo são da curadoria do balde (D1, 2.0.19): o servidor diz em
// canManage se o papel permite e recusa a gravação sem a pasta do balde, com o motivo.
export function createEvaluationAdminFeature({
  state,
  roleAllows,
  permissionAttrs,
  permissionNote,
  renderShell,
  escapeHtml,
  icon,
  toast
}) {
  async function openEvalChecklistAdmin() {
    state.evalChecklistAdmin = {
      items: [],
      loading: true,
      saving: false,
      error: null,
      canManage: roleAllows('curar')
    };
    renderShell();
    try {
      const res = await fetch('/api/eval-checklist');
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      state.evalChecklistAdmin = {
        items: (d.items || []).map((x) => ({ ...x })),
        loading: false,
        saving: false,
        error: null,
        canManage: !!d.canManage,
        repo: d.repo || ''
      };
    } catch (error) {
      state.evalChecklistAdmin = {
        items: [],
        loading: false,
        saving: false,
        error: error.message || 'Erro de rede.',
        canManage: roleAllows('curar')
      };
    }
    renderShell();
  }
  // "Checklist de qualidade" — tab body of the Administração page (body-only,
  // incl. its loading / error states) plus a thin standalone wrapper.
  function renderEvalChecklistBody() {
    const s = state.evalChecklistAdmin;
    if (!s || (s.loading && !s.items.length)) return '<div class="repo-empty">Carregando checklist…</div>';
    if (s.error) return `<div class="form-alert form-alert-error">${escapeHtml(s.error)}</div>`;
    const canManage = s.canManage !== false && roleAllows('curar');
    const appliesLabels = { both: 'skill+cápsula', skill: 'só skill', commons: 'só cápsula' };
    const rows = s.items
      .map(
        (it, i) => `
      <div class="ecl-row" data-idx="${i}">
        <div class="ecl-fields">
          <input class="ecl-text" data-ecl-field="title" data-idx="${i}" value="${escapeHtml(it.title || '')}" placeholder="Título do item — o que checar, em uma linha…" ${canManage ? '' : 'disabled'}>
          <textarea class="ecl-prompt" data-ecl-field="prompt" data-idx="${i}" rows="2" placeholder="Prompt da IA — a instrução do que verificar (opcional; usa o título se vazio)" ${canManage ? '' : 'disabled'}>${escapeHtml(it.prompt || '')}</textarea>
          <div class="ecl-rubric">
            <div class="ecl-opts">
              ${(it.opcoes || [])
                .map((o) => {
                  const req = (it.exigir || []).includes(o);
                  const forb = (it.proibir || []).includes(o);
                  return `<span class="ecl-opt${req ? ' is-req' : ''}${forb ? ' is-forb' : ''}"><code>${escapeHtml(o)}</code>${canManage ? `<button class="ecl-opt-btn" data-action="eclOptReq" data-idx="${i}" data-opt="${escapeHtml(o)}" title="exigir">✓</button><button class="ecl-opt-btn" data-action="eclOptForbid" data-idx="${i}" data-opt="${escapeHtml(o)}" title="proibir">⊘</button><button class="ecl-opt-btn" data-action="eclOptDel" data-idx="${i}" data-opt="${escapeHtml(o)}" title="remover">×</button>` : ''}</span>`;
                })
                .join('')}
              ${canManage ? `<input class="ecl-opt-add" data-ecl-optadd data-idx="${i}" placeholder="+ opção…"><button class="ecl-opt-btn ecl-opt-plus" data-action="eclOptAdd" data-idx="${i}" title="adicionar opção">＋</button>` : ''}
            </div>
            ${(it.opcoes || []).length ? `<label class="ecl-modo">regra: <select data-ecl-field="modo" data-idx="${i}" ${canManage ? '' : 'disabled'}><option value="todas" ${it.modo !== 'qualquer' ? 'selected' : ''}>exigir TODAS as ✓</option><option value="qualquer" ${it.modo === 'qualquer' ? 'selected' : ''}>exigir QUALQUER ✓</option></select> <span class="muted">✓ exigir · ⊘ proibir · a IA classifica, a regra decide</span></label>` : `<span class="muted ecl-rubric-hint">Adicione opções para virar rubrica (múltipla escolha). Sem opções = item pass/fail (a IA decide).</span>`}
          </div>
        </div>
        <select data-ecl-field="appliesTo" data-idx="${i}" ${canManage ? '' : 'disabled'}>${['both', 'skill', 'commons'].map((v) => `<option value="${v}" ${it.appliesTo === v ? 'selected' : ''}>${appliesLabels[v]}</option>`).join('')}</select>
        <select class="ecl-mode ${it.mode === 'score' ? 'is-score' : 'is-gate'}" data-ecl-field="mode" data-idx="${i}" title="gate = trava a promoção a Canônico; pontua = só conta para o Selo" ${canManage ? '' : 'disabled'}>
          <option value="gate" ${it.mode !== 'score' ? 'selected' : ''}>trava (gate)</option>
          <option value="score" ${it.mode === 'score' ? 'selected' : ''}>pontua o Selo</option>
        </select>
        <label class="ecl-enabled"><input type="checkbox" data-ecl-field="enabled" data-idx="${i}" ${it.enabled !== false ? 'checked' : ''} ${canManage ? '' : 'disabled'}> ativo</label>
        ${canManage ? `<button class="tag-chip-x" data-action="eclRemove" data-idx="${i}" aria-label="Remover">×</button>` : '<span></span>'}
      </div>`
      )
      .join('');
    return `
        <div class="section-heading">
          <div><p class="eyebrow">Config · governança${s.repo ? ` · balde: ${escapeHtml(s.repo)}` : ''}</p><h2>Checklist de qualidade</h2></div>
          ${canManage ? `<div class="row-actions"><button class="ghost-button" data-action="eclAdd">${icon('plus')}Novo item</button><button class="primary-button" data-action="eclSave" ${s.saving ? 'disabled' : permissionAttrs('curar')}>${icon('check')}${s.saving ? 'Salvando…' : 'Salvar'}</button></div>${permissionNote('curar')}` : '<span class="readonly-tag">Só o criador e os curadores deste balde editam</span>'}
        </div>
        <p class="wizard-hint">A checklist vale para o <strong>balde ativo</strong>${s.repo ? ` (<code>${escapeHtml(s.repo)}</code>)` : ''} — sem configuração salva, valem os itens padrão. Itens <strong>obrigatórios</strong> avaliados em toda skill/cápsula (governança + OKF). Cada item tem um modo: <strong>trava (gate)</strong> — precisa ser aprovado pela IA (ou aceito por um curador) para a promoção a Canônico — ou <strong>pontua o Selo</strong> — só entra na pontuação, sem travar. Cada item é avaliado pela <strong>IA</strong> a partir do seu <strong>prompt</strong> (ou do título, se vazio); itens sobre metadados (owner, frontmatter, casos de teste) recebem esses fatos automaticamente.</p>
        <div class="ecl-list">${rows || '<div class="repo-empty">Nenhum item.</div>'}</div>
    `;
  }

  function renderEvalChecklistAdmin() {
    return `<section class="panel">${renderEvalChecklistBody()}</section>`;
  }
  function eclAdd() {
    const s = state.evalChecklistAdmin;
    if (!s) return;
    s.items = [
      ...s.items,
      {
        id: '',
        title: '',
        prompt: '',
        appliesTo: 'both',
        mode: 'gate',
        opcoes: [],
        modo: 'todas',
        exigir: [],
        proibir: [],
        enabled: true
      }
    ];
    renderShell();
  }
  function eclRemove(idx) {
    const s = state.evalChecklistAdmin;
    if (!s) return;
    s.items = s.items.filter((_, i) => i !== Number(idx));
    renderShell();
  }
  function eclEdit(idx, field, value) {
    const s = state.evalChecklistAdmin;
    if (!s) return;
    const it = s.items[Number(idx)];
    if (it) it[field] = value;
  }
  // Rubric option editing (checklist admin): add/remove an option; toggle an option as required (✓) or
  // forbidden (⊘) — the two are mutually exclusive.
  function eclOptAdd(idx) {
    const s = state.evalChecklistAdmin;
    if (!s) return;
    const it = s.items[Number(idx)];
    if (!it) return;
    const el = document.querySelector(`[data-ecl-optadd][data-idx="${idx}"]`);
    const v = String((el ? el.value : '') || '').trim();
    if (!v) return;
    it.opcoes = [...(it.opcoes || [])];
    if (!it.opcoes.includes(v)) it.opcoes.push(v);
    if (el) el.value = '';
    renderShell();
  }
  function eclOptDel(idx, opt) {
    const s = state.evalChecklistAdmin;
    if (!s) return;
    const it = s.items[Number(idx)];
    if (!it) return;
    it.opcoes = (it.opcoes || []).filter((o) => o !== opt);
    it.exigir = (it.exigir || []).filter((o) => o !== opt);
    it.proibir = (it.proibir || []).filter((o) => o !== opt);
    renderShell();
  }
  function eclOptReq(idx, opt) {
    const s = state.evalChecklistAdmin;
    if (!s) return;
    const it = s.items[Number(idx)];
    if (!it) return;
    const on = (it.exigir || []).includes(opt);
    it.exigir = on ? (it.exigir || []).filter((o) => o !== opt) : [...(it.exigir || []), opt];
    it.proibir = (it.proibir || []).filter((o) => o !== opt);
    renderShell();
  }
  function eclOptForbid(idx, opt) {
    const s = state.evalChecklistAdmin;
    if (!s) return;
    const it = s.items[Number(idx)];
    if (!it) return;
    const on = (it.proibir || []).includes(opt);
    it.proibir = on ? (it.proibir || []).filter((o) => o !== opt) : [...(it.proibir || []), opt];
    it.exigir = (it.exigir || []).filter((o) => o !== opt);
    renderShell();
  }
  async function eclSave() {
    const s = state.evalChecklistAdmin;
    if (!s) return;
    s.saving = true;
    renderShell();
    try {
      const res = await fetch('/api/eval-checklist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: s.items.filter((x) => String(x.title || x.text || '').trim()) })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      s.items = (d.items || []).map((x) => ({ ...x }));
      s.saving = false;
      state.evalChecklist = d.items || null; // refresh the wizard-step cache
      toast('Checklist salvo.', 'success');
      renderShell();
    } catch (error) {
      s.saving = false;
      toast(error.message || 'Falha ao salvar.', 'warning');
      renderShell();
    }
  }
  async function openScoringAdmin() {
    state.scoringAdmin = { config: null, loading: true, saving: false, error: null, canManage: roleAllows('curar') };
    renderShell();
    try {
      const res = await fetch('/api/scoring-config');
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      state.scoringAdmin = {
        config: d.config,
        loading: false,
        saving: false,
        error: null,
        canManage: !!d.canManage,
        repo: d.repo || ''
      };
    } catch (error) {
      state.scoringAdmin = {
        config: null,
        loading: false,
        saving: false,
        error: error.message || 'Erro de rede.',
        canManage: roleAllows('curar')
      };
    }
    renderShell();
  }
  function scoringEdit(path, value) {
    const s = state.scoringAdmin;
    if (!s || !s.config) return;
    const [a, b] = String(path).split('.');
    if (b) {
      s.config[a] = { ...(s.config[a] || {}) };
      s.config[a][b] = value;
    } else {
      s.config[a] = value;
    }
  }
  async function scoringSave() {
    const s = state.scoringAdmin;
    if (!s || !s.config) return;
    s.saving = true;
    renderShell();
    try {
      const res = await fetch('/api/scoring-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(s.config)
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      s.config = d.config;
      s.saving = false;
      toast('Pontuação salva — o Selo de cada skill recalcula na próxima carga.', 'success');
      renderShell();
    } catch (error) {
      s.saving = false;
      toast(error.message || 'Falha ao salvar.', 'warning');
      renderShell();
    }
  }
  function renderScoringBody() {
    const s = state.scoringAdmin;
    if (!s || (s.loading && !s.config)) return '<div class="repo-empty">Carregando pontuação…</div>';
    if (s.error) return `<div class="form-alert form-alert-error">${escapeHtml(s.error)}</div>`;
    const c = s.config || {};
    const w = c.weights || {};
    const b = c.bands || {};
    const canManage = s.canManage !== false && roleAllows('curar');
    const dis = canManage ? '' : 'disabled';
    const totalW = ['casos', 'validacao', 'governanca', 'clareza', 'frescor'].reduce(
      (sum, k) => sum + (Number(w[k]) || 0),
      0
    );
    const num = (path, value, min, max) =>
      `<input type="number" class="scoring-num" data-scoring-field="${path}" value="${Number(value) || 0}" min="${min}" max="${max}" ${dis}>`;
    const dim = (key, title, desc) => `
      <div class="scoring-dim">
        <div class="scoring-dim-head"><strong>${title}</strong>${num(`weights.${key}`, w[key], 0, 100)}</div>
        <small>${desc}</small>
      </div>`;
    return `
        <div class="section-heading">
          <div><p class="eyebrow">Config · governança${s.repo ? ` · balde: ${escapeHtml(s.repo)}` : ''}</p><h2>Pontuação do Selo</h2></div>
          ${canManage ? `<button class="primary-button" data-action="scoringSave" ${s.saving ? 'disabled' : permissionAttrs('curar')}>${icon('check')}${s.saving ? 'Salvando…' : 'Salvar'}</button>` : '<span class="readonly-tag">Só o criador e os curadores deste balde editam</span>'}
        </div>
        ${canManage ? permissionNote('curar') : ''}
        <p class="wizard-hint">A política vale para o <strong>balde ativo</strong>${s.repo ? ` (<code>${escapeHtml(s.repo)}</code>)` : ''} — cada balde tem seus próprios pesos, faixas e critérios de depreciação; sem configuração salva, valem os padrões.</p>
        <p class="wizard-hint">O <strong>Selo (0–100 → A/B/C/D)</strong> é a média ponderada das 5 dimensões abaixo. Ele <strong>não trava</strong> a promoção (isso é o gate da checklist) — ele diz o quão <strong>rica e confiável</strong> a skill é. Casos de uso mais detalhados sobem o Selo; <strong>aceites forçados</strong> (curador aceita item que a IA não aprovou) descontam.</p>
        <div class="scoring-grid">
          ${dim('casos', 'Riqueza dos casos de uso', 'nº de casos (até o alvo) + profundidade (título/pergunta/esperado/prompt/rubrica) + cobertura de recusa')}
          ${dim('validacao', 'Integridade da validação', 'itens do gate aprovados pela IA; cada aceite forçado desconta a penalidade abaixo')}
          ${dim('governanca', 'Governança', 'frontmatter completo: status, objetivo, escopo, owner, versão, revisão, output_schema')}
          ${dim('clareza', 'Clareza & segurança', 'papel/contexto no prompt, linguagem de recusa, pt-BR, sem segredos embutidos')}
          ${dim('frescor', 'Frescor', 'idade da última revisão (verde/amarelo/vermelho)')}
        </div>
        <p class="scoring-total ${totalW === 100 ? '' : 'is-off'}">Soma dos pesos: <strong>${totalW}</strong>${totalW === 100 ? '' : ' — não precisa ser 100 (é normalizado), mas 100 facilita a leitura'}</p>
        <div class="scoring-row2">
          <label>Alvo de casos de uso ${num('casosAlvo', c.casosAlvo, 1, 20)} <small>nº de casos com crédito cheio de contagem</small></label>
          <label>Penalidade por aceite forçado ${num('penalidadeAceiteForcado', c.penalidadeAceiteForcado, 0, 100)} <small>pontos descontados da dimensão validação, por item</small></label>
        </div>
        <div class="scoring-bands">
          <h4 class="eval-h">Faixas do selo</h4>
          <div class="scoring-row2">
            <label>A a partir de ${num('bands.A', b.A, 1, 100)}</label>
            <label>B a partir de ${num('bands.B', b.B, 0, 100)}</label>
            <label>C a partir de ${num('bands.C', b.C, 0, 100)}</label>
          </div>
          <small class="muted">Abaixo de C = D. As faixas são ajustadas para manter A ≥ B ≥ C. <strong>Skills com nota D</strong> (não depreciadas) carregam um aviso de qualidade baixa no chat e no MCP.</small>
        </div>
        <div class="scoring-bands">
          <h4 class="eval-h">Depreciação de cápsulas</h4>
          <p class="wizard-hint">Critérios que marcam uma cápsula <strong>ABERTA</strong> como <strong>DEPRECIADA</strong> (derivado — nada é gravado na cápsula). Cápsulas <strong>fechadas</strong> (fatos passados congelados) são imunes. Depreciada = aviso explícito junto do conteúdo no chat, no read_context e no MCP/API.</p>
          <div class="scoring-row2">
            <label>Vencida há mais de (dias) ${num('deprecation.capVencidaDias', (c.deprecation || {}).capVencidaDias, 0, 3650)} <small>0 desliga — vencida (overdue) há N dias vira depreciada</small></label>
            <label>Sem revisão há mais de (dias) ${num('deprecation.capSemRevisaoDias', (c.deprecation || {}).capSemRevisaoDias, 0, 3650)} <small>0 desliga — idade da última revisão, mesmo dentro da cadência</small></label>
            <label>Eval reprovada deprecia
              <select class="scoring-num" data-scoring-field="deprecation.capEvalReprovada" ${dis}>
                <option value="1" ${Number((c.deprecation || {}).capEvalReprovada) ? 'selected' : ''}>sim</option>
                <option value="0" ${Number((c.deprecation || {}).capEvalReprovada) ? '' : 'selected'}>não</option>
              </select>
              <small>avaliação (eval) reprovada marca a cápsula como depreciada</small></label>
          </div>
        </div>
    `;
  }

  return {
    openEvalChecklistAdmin,
    renderEvalChecklistBody,
    renderEvalChecklistAdmin,
    eclAdd,
    eclRemove,
    eclEdit,
    eclOptAdd,
    eclOptDel,
    eclOptReq,
    eclOptForbid,
    eclSave,
    openScoringAdmin,
    scoringEdit,
    scoringSave,
    renderScoringBody
  };
}
