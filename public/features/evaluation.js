export function createEvaluationFeature({
  feedbackCounts,
  formatDate,
  escapeHtml,
  canManageSkill,
  permitted,
  permissionNote,
  state,
  renderShell,
  icon,
  toast,
  provider,
  refresh,
  loadExploreSkill
}) {
  function renderFeedback(skill) {
    const counts = feedbackCounts(skill);
    const total = Math.max(1, counts.bom + counts.fraco + counts.errado);

    return `
      <div class="feedback-grid">
        <article class="feedback-chart">
          <p class="eyebrow">Vereditos</p>
          <div class="donut" style="--good:${(counts.bom / total) * 100}; --weak:${(counts.fraco / total) * 100}; --wrong:${(counts.errado / total) * 100}">
            <strong>${total}</strong>
            <small>feedbacks</small>
          </div>
          <div class="legend">
            <span><i class="legend-good"></i>Bom ${counts.bom}</span>
            <span><i class="legend-weak"></i>Fraco ${counts.fraco}</span>
            <span><i class="legend-wrong"></i>Errado ${counts.errado}</span>
          </div>
        </article>
        <article>
          <div class="section-heading compact">
            <div>
              <p class="eyebrow">Fila do owner</p>
              <h3>Respostas marcadas (Errado e Fraco)</h3>
            </div>
          </div>
          <div class="feedback-list">
            ${
              skill.feedback
                .filter((item) => item.veredito === 'errado' || item.veredito === 'fraco')
                .map(
                  (item) => `
              <div class="feedback-item feedback-${item.veredito}">
                <span class="feedback-verdict feedback-verdict-${item.veredito}">${item.veredito === 'errado' ? 'Errado' : 'Fraco'}</span>
                <span>${formatDate(item.timestamp)}</span>
                <strong>${escapeHtml(item.usuario)}</strong>
                ${item.duplicateCount > 1 ? `<small>${item.duplicateCount} ocorrencias iguais agrupadas</small>` : ''}
                ${item.comentario ? `<p>${escapeHtml(item.comentario)}</p>` : ''}
                ${
                  item.question || item.answer
                    ? `
                  <div class="feedback-context">
                    <div>
                      <small>Pergunta</small>
                      <p>${escapeHtml(item.question || 'Não registrada')}</p>
                    </div>
                    <div>
                      <small>Resposta</small>
                      <p>${escapeHtml(item.answer || 'Não registrada')}</p>
                    </div>
                  </div>
                `
                    : ''
                }
              </div>
            `
                )
                .join('') || '<p class="empty-inline">Nenhum feedback pendente.</p>'
            }
          </div>
        </article>
      </div>
    `;
  }

  // The Evals tab is now the unified eval surface (Phase 2): mandatory checklist + user quality +
  // test cases + one overall status + run/suggest. Shared by skills and commons (renderNodeEval).
  function renderEvals(skill) {
    // Explorar o corpus is READ-ONLY for definitions: no add/remove/suggest here (that lives in the
    // Editar-skill trail). Governance actions stay: aceitar/rejeitar, and for drafts the promote flow.
    return renderNodeEval('skill', skill.id, canManageSkill(skill), {
      editable: false,
      promote: skill.status === 'rascunho',
      fixAction: { action: 'editSkill', dataset: { id: skill.id }, label: 'Editar skill' }
    });
  }
  function evalApi(nodeType, id, suffix, method, body) {
    if (nodeType === 'commons') {
      const base = `/api/commons/eval${suffix || ''}`;
      if (method === 'GET') return fetch(`${base}?path=${encodeURIComponent(id)}`);
      return fetch(base, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: id, ...(body || {}) })
      });
    }
    const base = `/api/skills/${encodeURIComponent(id)}/eval${suffix || ''}`;
    if (method === 'GET') return fetch(base);
    return fetch(base, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  // Execuções da IA em andamento por skill ou cápsula (avaliar, promover, testar um caso), com a etapa e o início.
  // Ficam fora da aba: a pessoa pode trocar de skill ou de tela enquanto a IA trabalha e, ao voltar, a aba mostra
  // o andamento e recebe o resultado. Uma execução por nó: enquanto ela roda, os controles da aba ficam travados,
  // porque o servidor grava a avaliação a partir do estado lido no início e desfaria um aceite feito no meio.
  const evalJobs = new Map();
  const evalJobKey = (nodeType, id) => `${nodeType}:${id}`;
  // Sugestões de casos de uso da IA por nó, à parte dos casos: só viram casos quando o curador adiciona. Ficam
  // fora da aba, como as execuções, para não se perderem numa troca de skill.
  const evalSuggestions = new Map();
  function setEvalSuggestions(key, list) {
    if (list.length) evalSuggestions.set(key, list);
    else evalSuggestions.delete(key);
  }
  function evalJobOf(ne) {
    return (ne && evalJobs.get(evalJobKey(ne.nodeType, ne.id))) || null;
  }
  // O estado da aba deste nó, se ele ainda é o que está aberto.
  function nodeEvalFor(nodeType, id) {
    const ne = state.nodeEval;
    return ne && ne.nodeType === nodeType && ne.id === id ? ne : null;
  }
  function beginEvalJob(ne, job) {
    const key = evalJobKey(ne.nodeType, ne.id);
    if (evalJobs.has(key)) return null;
    const entry = { ...job, startedAt: Date.now() };
    evalJobs.set(key, entry);
    ne.outcome = null;
    ne.updatedIds = null;
    startEvalClock();
    return entry;
  }
  function endEvalJob(nodeType, id) {
    evalJobs.delete(evalJobKey(nodeType, id));
    return nodeEvalFor(nodeType, id);
  }
  function fmtElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  // O relógio atualiza só o texto do tempo: re-renderizar a tela a cada segundo apagaria foco e seleção.
  let evalClock = null;
  function startEvalClock() {
    if (evalClock) return;
    evalClock = setInterval(() => {
      if (!evalJobs.size) {
        clearInterval(evalClock);
        evalClock = null;
        return;
      }
      for (const el of document.querySelectorAll('[data-eval-elapsed]')) {
        el.textContent = fmtElapsed(Date.now() - Number(el.dataset.evalElapsed));
      }
    }, 1000);
  }
  const evalItemKey = (c) => `${c.mandatory ? 'm' : 'i'}:${c.id}`;
  function verdictsByKey(items) {
    return new Map((items || []).map((c) => [evalItemKey(c), c.aiVerdict]));
  }
  // Os itens cujo veredito da IA mudou nesta execução: a aba os marca com "novo resultado".
  function changedVerdicts(before, items) {
    return new Set((items || []).filter((c) => before.get(evalItemKey(c)) !== c.aiVerdict).map(evalItemKey));
  }
  const VERDICT_WORD = { pass: 'aprovado', fail: 'reprovado', pending: 'pendente', none: 'sem avaliação' };
  function outcomeTone(verdict) {
    return verdict === 'pass' ? 'pass' : verdict === 'fail' ? 'fail' : 'pending';
  }
  // O resumo que fica na aba depois de uma avaliação (o toast some).
  function runOutcome(view, startedAt) {
    const took = fmtElapsed(Date.now() - startedAt);
    if (view.runWarning) {
      return {
        tone: 'fail',
        text: `${view.runWarning} (${took}). Os itens ficaram pendentes; rode a avaliação de novo.`
      };
    }
    const counts = { pass: 0, fail: 0, pending: 0 };
    for (const c of view.items || []) counts[outcomeTone(c.aiVerdict)] += 1;
    const parts = [
      `${counts.pass} ok`,
      `${counts.fail} ${counts.fail === 1 ? 'falhou' : 'falharam'}`,
      `${counts.pending} ${counts.pending === 1 ? 'pendente' : 'pendentes'}`
    ];
    return {
      tone: outcomeTone(view.overall),
      text: `Avaliação concluída em ${took}: ${parts.join(', ')}. Resultado: ${VERDICT_WORD[view.overall] || view.overall}.`
    };
  }
  async function loadNodeEval(nodeType, id) {
    state.nodeEval = {
      nodeType,
      id,
      data: null,
      loading: true,
      saving: false,
      outcome: null,
      updatedIds: null,
      lastTestedId: null,
      tab: 'obrigatorios',
      openItems: new Set(),
      dirty: false,
      error: null,
      iDraft: { title: '', prompt: '', question: '', expected: '', mustRefuse: false }
    };
    renderShell();
    try {
      const res = await evalApi(nodeType, id, '', 'GET');
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      if (state.nodeEval && state.nodeEval.id === id) {
        state.nodeEval.data = d.eval;
        state.nodeEval.loading = false;
      }
    } catch (error) {
      if (state.nodeEval && state.nodeEval.id === id) {
        state.nodeEval.loading = false;
        state.nodeEval.error = error.message || 'Erro de rede.';
      }
    }
    renderShell();
  }
  function evalVerdictBadge(v) {
    const label = { pass: 'ok', fail: 'falhou', pending: 'pendente', none: '—' }[v] || '—';
    const cls = v === 'pass' || v === 'fail' || v === 'pending' ? v : 'none';
    return `<span class="gov-badge gov-eval-${cls}">${label}</span>`;
  }
  function evalAcceptedBadge(a) {
    const label = { accepted: 'aceito', rejected: 'rejeitado', pending: 'a aceitar' }[a] || 'a aceitar';
    const cls = a === 'accepted' ? 'pass' : a === 'rejected' ? 'fail' : 'pending';
    return `<span class="gov-badge gov-eval-${cls}">${label}</span>`;
  }
  function evalRunningBadge(label) {
    return `<span class="gov-badge gov-eval-running">${label}</span>`;
  }
  // O andamento da execução da IA deste nó, ou o resultado da última, no topo da aba: a etapa, o tempo decorrido
  // e uma barra sem porcentagem, porque a IA não informa progresso. A avaliação julga todos os itens numa chamada.
  function renderEvalStatus(ne, job, items) {
    if (job) {
      const total = items.length;
      const tested = job.kind === 'test' ? items.find((c) => c.id === job.itemId && !c.mandatory) : null;
      const stageText = {
        salvando: 'Salvando as alterações antes de chamar a IA',
        avaliando: `A IA está avaliando ${total} ${total === 1 ? 'item' : 'itens'}${job.kind === 'promote' ? ' antes de promover' : ''}`,
        publicando: 'Gate aprovado: promovendo a skill a canônica',
        testando: `A IA está testando o caso “${tested ? tested.title || tested.question || '' : ''}”`,
        sugerindo: 'A IA está sugerindo casos de uso para este artefato'
      }[job.stage];
      const hint = {
        avaliando: 'Todos os itens vão numa chamada só à IA; cada um mostra o resultado quando ela termina.',
        testando: 'Primeiro a IA responde a pergunta usando o artefato, como no chat; depois julga a resposta.',
        sugerindo:
          'Ela lê o mesmo conteúdo que a avaliação e propõe perguntas com a resposta esperada, incluindo uma recusa. Nada vira caso sem você adicionar.'
      }[job.stage];
      return `<div class="eval-progress" role="status">
          <div class="eval-progress-line"><strong>${escapeHtml(stageText)}…</strong><span class="eval-progress-time" aria-hidden="true" data-eval-elapsed="${job.startedAt}">${fmtElapsed(Date.now() - job.startedAt)}</span></div>
          <span class="eval-progress-bar" aria-hidden="true"></span>
          ${hint ? `<small class="eval-progress-hint">${hint}</small>` : ''}
        </div>`;
    }
    const o = ne.outcome;
    return o ? `<p class="eval-outcome eval-outcome-${o.tone}" role="status">${escapeHtml(o.text)}</p>` : '';
  }
  function renderNodeEval(nodeType, id, canManage, opts = {}) {
    const ne = state.nodeEval;
    if (!ne || ne.nodeType !== nodeType || ne.id !== id) {
      setTimeout(() => loadNodeEval(nodeType, id), 0);
      return '<div class="repo-empty">Carregando avaliação…</div>';
    }
    if (ne.loading && !ne.data) return '<div class="repo-empty">Carregando avaliação…</div>';
    if (ne.error) return `<div class="form-alert form-alert-error">${escapeHtml(ne.error)}</div>`;
    // editable = definitions can change here (add/remove/suggest/save); the corpus explorer passes
    // false — there, only governance actions (aceitar/rejeitar, promote) remain.
    const editable = opts.editable !== undefined ? !!opts.editable : canManage;
    const promote = !!opts.promote && canManage;
    const d = ne.data || { items: [], overall: 'none' };
    const overallLabel =
      { pass: 'aprovado', fail: 'reprovado', pending: 'pendente', none: 'sem avaliação' }[d.overall] || d.overall;
    // Controles travados enquanto a IA roda para este nó (avaliação, promoção ou teste de caso): o servidor grava
    // o resultado ao final, e um aceite ou salvamento no meio seria desfeito ou confundiria o estado.
    // Sem a pasta do balde gravável o servidor recusaria: os controles ficam desabilitados e o aviso no topo
    // da aba diz o motivo.
    const deny = permitted('curar') ? '' : 'disabled aria-disabled="true"';
    const job = evalJobOf(ne);
    const grading = Boolean(job && job.stage === 'avaliando');
    const testingId = job && job.kind === 'test' ? job.itemId : null;
    const suggesting = Boolean(job && job.kind === 'suggest');
    const ctlLock = job ? 'disabled' : deny;
    // Depois de uma execução, os itens cujo resultado mudou levam "novo resultado" (texto, não só cor).
    const updated = (c) => Boolean(!job && ne.updatedIds && ne.updatedIds.has(evalItemKey(c)));
    const updatedTag = (c) => (updated(c) ? '<span class="eval-tag eval-tag-updated">novo resultado</span>' : '');
    const itemBadge = (c) => (grading ? evalRunningBadge('avaliando…') : evalVerdictBadge(c.aiVerdict));
    // Marca na aba que tem itens em execução, para quem está olhando a outra.
    const busyDot = '<span class="eval-maintab-busy" aria-hidden="true"></span>';
    const acceptCtl = (c) =>
      canManage
        ? `<span class="eval-accept"><button class="mini-btn ${c.accepted === 'accepted' ? 'is-on' : ''}" data-action="evalAccept" data-id="${escapeHtml(c.id)}" data-mandatory="${c.mandatory ? '1' : '0'}" title="Aceitar" ${ctlLock}>✓ aceitar</button><button class="mini-btn ${c.accepted === 'rejected' ? 'is-on' : ''}" data-action="evalReject" data-id="${escapeHtml(c.id)}" data-mandatory="${c.mandatory ? '1' : '0'}" title="Rejeitar" ${ctlLock}>✕ rejeitar</button></span>`
        : evalAcceptedBadge(c.accepted);
    if (!(ne.openItems instanceof Set)) ne.openItems = new Set(ne.openItems || []);
    // opts.only ('obrigatorios' | 'casos') renderiza UMA seção sem o trilho interno de abas — é o que
    // o assistente usa: lá as etapas já são abas de topo, e aninhar abas dentro de abas é ruim.
    const only = opts.only || '';
    const tab = only || ne.tab || 'obrigatorios';
    const rubricHtml = (c) =>
      c.opcoes && c.opcoes.length
        ? `<small class="eval-rubric">opções: ${(c.opcoes || []).map((o) => `<code class="${(c.selecionadas || []).includes(o) ? 'is-sel' : ''}">${escapeHtml(o)}</code>`).join(' ')} · IA: ${c.selecionadas && c.selecionadas.length ? escapeHtml((c.selecionadas || []).join(', ')) : '(nenhuma)'}</small>`
        : '';
    // Transparência: o fragmento enviado à IA + a resposta bruta — dentro do corpo colapsável do item.
    const transcriptHtml = (c) =>
      c.aiPrompt || c.aiAnswer
        ? `${c.aiPrompt ? `<p class="eval-transcript-h">Enviado para a IA (este item)</p><pre class="eval-pre">${escapeHtml(c.aiPrompt)}</pre>` : ''}${c.aiAnswer ? `<p class="eval-transcript-h">Resposta da IA</p><pre class="eval-pre">${escapeHtml(c.aiAnswer)}</pre>` : ''}`
        : '<p class="muted">Ainda sem execução da IA para este item — rode a avaliação.</p>';
    const fixBtn =
      opts.fixAction && canManage
        ? `<button class="mini-btn" data-action="${escapeHtml(opts.fixAction.action)}" ${deny} ${Object.entries(
            opts.fixAction.dataset || {}
          )
            .map(([k, v]) => `data-${k}="${escapeHtml(String(v))}"`)
            .join(' ')}>${escapeHtml(opts.fixAction.label)}</button>`
        : '';
    // Item de governança: linha colapsável — o sumário decide (badge + título + aceitar/rejeitar),
    // o corpo mostra o detalhe (prompt do item, nota, rubrica, evidência, prompt/resposta da IA).
    const mandRow = (
      c
    ) => `<details class="eval-item${updated(c) ? ' eval-updated' : ''}" data-eval-details="${escapeHtml(c.id)}"${ne.openItems.has(c.id) ? ' open' : ''}>
        <summary><span class="eval-item-caret">${icon('chevron', 'eval-caret')}</span>${itemBadge(c)}<strong>${escapeHtml(c.title || '(sem título)')}</strong>${c.mode === 'score' ? '<span class="eval-tag eval-tag-score" title="Pontua o Selo — não trava a promoção">pontua</span>' : ''}${updatedTag(c)}<span class="eval-item-right">${acceptCtl(c)}</span></summary>
        <div class="eval-item-body">
          ${c.prompt ? `<p class="eval-transcript-h">Prompt do item (o que a IA verifica)</p><p class="eval-item-prompt">${escapeHtml(c.prompt)}</p>` : ''}
          ${c.note ? `<small class="eval-note">${escapeHtml(c.note)}</small>` : ''}
          ${rubricHtml(c)}
          ${c.evidencia ? `<small class="eval-evidence">evidência: “${escapeHtml(c.evidencia)}”</small>` : ''}
          ${transcriptHtml(c)}
        </div>
      </details>`;
    // Caso de uso: card com pergunta/esperado, botão de teste em destaque e o último resultado.
    const caseCard = (c) => {
      const canTest = canManage && String(c.question || '').trim();
      const result = c.testAt
        ? `<div class="eval-case-result eval-case-result-${c.testVerdict === 'pass' ? 'pass' : c.testVerdict === 'fail' ? 'fail' : 'pending'}">
            <div class="eval-test-line">Último teste: ${evalVerdictBadge(c.testVerdict)} · ${formatDate(c.testAt)}${c.testNote ? ` · ${escapeHtml(c.testNote)}` : ''}</div>
            <details class="eval-transcript"${ne.lastTestedId === c.id ? ' open' : ''}><summary>Resposta gerada no teste</summary><pre class="eval-pre">${escapeHtml(c.testAnswer || '')}</pre></details>
            ${c.testVerdict === 'fail' ? `<small class="eval-note">A resposta não passou — ajuste o conteúdo do artefato e teste de novo. ${fixBtn}</small>` : ''}
          </div>`
        : canTest
          ? '<p class="muted eval-case-untested">Ainda não testado.</p>'
          : '';
      // O caso em teste mostra a etapa e o tempo no próprio card; o último resultado segue abaixo até o novo chegar.
      const testing =
        testingId === c.id
          ? `<div class="eval-case-testing">${evalRunningBadge('testando…')}<span>${job.stage === 'salvando' ? 'Salvando as alterações' : 'A IA responde a pergunta com o artefato e depois julga a resposta'}</span><span class="eval-progress-time" aria-hidden="true" data-eval-elapsed="${job.startedAt}">${fmtElapsed(Date.now() - job.startedAt)}</span></div>`
          : '';
      return `<div class="eval-case-card${testingId === c.id ? ' is-testing' : ''}${updated(c) ? ' eval-updated' : ''}">
        <div class="eval-case-head">${itemBadge(c)}<strong>${escapeHtml(c.title || c.question || '(sem título)')}</strong>${c.mustRefuse ? '<span class="eval-tag eval-tag-refuse" title="A resposta correta é uma recusa">recusa</span>' : ''}${c.opcoes && c.opcoes.length ? '<span class="eval-tag">rubrica</span>' : ''}${updatedTag(c)}<span class="eval-item-right">${acceptCtl(c)}${editable ? `<button class="tag-chip-x" data-action="evalRemoveItem" data-id="${escapeHtml(c.id)}" aria-label="Remover" ${ctlLock}>×</button>` : ''}</span></div>
        ${c.question ? `<p class="eval-case-q"><span>Pergunta</span> ${escapeHtml(c.question)}</p>` : ''}
        ${c.expected ? `<p class="eval-case-q"><span>Esperado</span> ${escapeHtml(c.expected)}</p>` : ''}
        ${c.prompt ? `<p class="eval-case-q"><span>Prompt IA</span> ${escapeHtml(c.prompt)}</p>` : ''}
        ${rubricHtml(c)}
        ${c.note && !c.testAt ? `<small class="eval-note">${escapeHtml(c.note)}</small>` : ''}
        ${c.aiPrompt || c.aiAnswer ? `<details class="eval-transcript"><summary>Prompt e resposta da IA (avaliação de conteúdo)</summary>${transcriptHtml(c)}</details>` : ''}
        <div class="eval-case-actions">
          ${canTest ? `<button class="primary-button small" data-action="evalTestCase" data-id="${escapeHtml(c.id)}" ${job ? 'disabled' : deny} title="Responde a pergunta com o artefato como contexto e julga a resposta">${icon('play')}${testingId === c.id ? 'Testando…' : 'Testar caso'}</button>` : canManage ? '<small class="muted">Sem pergunta — este item não é testável.</small>' : ''}
        </div>
        ${testing}
        ${result}
      </div>`;
    };
    const items = Array.isArray(d.items) ? d.items : [];
    const mandItems = items.filter((c) => c.mandatory);
    const caseItems = items.filter((c) => !c.mandatory);
    // Casos sugeridos pela IA: o curador adiciona (grava na hora) ou descarta, um a um ou todos.
    const suggestBtn = canManage
      ? `<button class="ghost-button small" data-action="evalSuggestCases" ${job ? 'disabled' : deny} title="A IA lê o artefato e propõe perguntas com a resposta esperada; você escolhe o que vira caso">${icon('spark')}${suggesting ? 'Sugerindo…' : 'Sugerir casos com IA'}</button>`
      : '';
    const suggestions = canManage ? evalSuggestions.get(evalJobKey(nodeType, id)) || [] : [];
    const addLock = job || ne.saving ? 'disabled' : deny;
    const suggestionRow = (s) => `<li class="eval-suggestion">
        <div class="eval-suggestion-main">${s.title ? `<strong>${escapeHtml(s.title)}</strong>` : ''}<p class="eval-case-q"><span>Pergunta</span> ${escapeHtml(s.question)}</p>${s.expected ? `<p class="eval-case-q"><span>Esperado</span> ${escapeHtml(s.expected)}</p>` : ''}${s.mustRefuse ? '<span class="eval-tag eval-tag-refuse" title="A resposta correta é uma recusa">recusa</span>' : ''}</div>
        <div class="eval-suggestion-actions"><button class="primary-button small" data-action="evalSuggestionAdd" data-key="${escapeHtml(s.key)}" ${addLock}>${icon('plus')}Adicionar</button><button class="ghost-button small" data-action="evalSuggestionDismiss" data-key="${escapeHtml(s.key)}">Descartar</button></div>
      </li>`;
    const suggestionsHtml = suggestions.length
      ? `<section class="eval-suggestions" aria-label="Casos de uso sugeridos pela IA">
          <div class="eval-suggestions-head"><strong>${icon('spark')}Sugestões da IA</strong><span class="muted">Nada é gravado até você adicionar.</span><span class="eval-item-right"><button class="ghost-button small" data-action="evalSuggestionAdd" data-key="*" ${addLock}>${icon('plus')}Adicionar todas</button><button class="ghost-button small" data-action="evalSuggestionDismiss" data-key="*">Descartar todas</button></span></div>
          <ul class="eval-suggestion-list">${suggestions.map(suggestionRow).join('')}</ul>
        </section>`
      : '';
    const stageLabel = { salvando: 'Salvando…', avaliando: 'Avaliando…', publicando: 'Promovendo…' };
    const primaryBtn = promote
      ? `<button class="primary-button small" data-action="evalPromote" ${job ? 'disabled' : deny}>${icon('check')}${job && job.kind === 'promote' ? stageLabel[job.stage] : 'Promover para Canônico'}</button>`
      : `<button class="primary-button small" data-action="evalRun" ${job ? 'disabled' : deny}>${icon('play')}${job && job.kind === 'run' ? stageLabel[job.stage] : 'Rodar avaliação'}</button>`;
    const hint = promote
      ? '<p class="wizard-hint"><strong>Promover para Canônico</strong> roda a checagem da IA e, se o gate passar, publica a skill como canônica. Cada item <strong>obrigatório (gate)</strong> precisa ser <strong>aprovado pela IA</strong> — ou <strong>aceito</strong> por um curador (aceite forçado, que reduz o Selo). Itens <strong>pontua</strong> e casos de uso contam para o <strong>Selo</strong>, não travam. Para editar os casos, use <strong>Editar skill</strong>.</p>'
      : '<p class="wizard-hint">"Rodar avaliação" salva e avalia tudo com IA. A promoção a Canônico exige que cada item <strong>obrigatório (gate)</strong> seja <strong>aprovado pela IA</strong> — ou <strong>aceito</strong> por um curador (aceite forçado). Itens <strong>pontua</strong> e seus casos de uso contam para o <strong>Selo</strong>, não travam a promoção.</p>';
    const html = `
      <div class="eval-tab">
        ${canManage ? permissionNote('curar') : ''}
        <div class="section-heading">
          <div><p class="eyebrow">Avaliação${ne.dirty ? ' · alterações não salvas' : ''}</p><h3>${evalVerdictBadge(d.overall)} ${overallLabel}${d.lastRunAt ? ` · ${formatDate(d.lastRunAt)}` : ''}</h3></div>
          ${
            canManage
              ? `<div class="row-actions">
            ${editable && ne.dirty ? `<button class="ghost-button small" data-action="evalSave" ${ne.saving || job ? 'disabled' : deny}>${icon('check')}${ne.saving ? 'Salvando…' : 'Salvar'}</button>` : ''}
            ${primaryBtn}
          </div>`
              : ''
          }
        </div>
        ${renderEvalStatus(ne, job, items)}
        ${d.lastRunMeta ? `<details class="eval-transcript eval-transcript-run"><summary>Contexto da execução — ${escapeHtml(d.lastRunMeta.model || '')}${d.lastRunMeta.at ? ` · ${formatDate(d.lastRunMeta.at)}` : ''}</summary><p class="eval-transcript-h">Prompt de sistema (compartilhado por todos os itens)</p><pre class="eval-pre">${escapeHtml(d.lastRunMeta.system || '')}</pre><p class="eval-transcript-h">Fatos (facts)</p><pre class="eval-pre">${escapeHtml(d.lastRunMeta.facts || '')}</pre><p class="muted">Conteúdo do artefato enviado: ${Number(d.lastRunMeta.contentChars) || 0} caracteres (não arquivado — é o próprio artefato no momento da execução).</p></details>` : ''}
        ${
          only
            ? ''
            : `<div class="eval-maintabs">
          <button class="eval-maintab ${tab === 'obrigatorios' ? 'active' : ''}" data-action="evalTab" data-tab="obrigatorios">${icon('check')}Governança <span class="eval-maintab-count">${mandItems.length}</span>${grading ? busyDot : ''}</button>
          <button class="eval-maintab ${tab === 'casos' ? 'active' : ''}" data-action="evalTab" data-tab="casos">${icon('play')}Casos de uso <span class="eval-maintab-count">${caseItems.length}</span>${grading || testingId || suggesting ? busyDot : ''}</button>
        </div>`
        }
        ${
          tab === 'obrigatorios'
            ? `<div class="eval-section">
          <p class="wizard-hint">Checagens de governança + OKF definidas pelos admins. Clique num item para ver o detalhe — incluindo o prompt enviado à IA e a resposta.</p>
          <div class="eval-items">${mandItems.map(mandRow).join('') || '<p class="muted">—</p>'}</div>
        </div>`
            : ''
        }
        ${
          tab === 'casos'
            ? `<div class="eval-section">
          <div class="eval-cases-toolbar"><p class="wizard-hint">Casos de uso do artefato. <strong>Testar caso</strong> responde a pergunta usando o artefato como contexto (como no chat) e julga a resposta.</p>${suggestBtn}</div>
          ${suggestionsHtml}
          <div class="eval-cases">${caseItems.map(caseCard).join('') || `<p class="muted">Nenhum caso de uso ainda.${editable ? ' Use o formulário abaixo para criar o primeiro, ou peça sugestões à IA.' : canManage ? ' Peça sugestões à IA para começar.' : ''}</p>`}</div>
          ${
            editable
              ? `<div class="eval-add-form">
            <p class="eval-transcript-h">Novo caso de uso</p>
            <label class="eval-fld"><span>Título</span><input class="tag-input-field" data-eval-ititle value="${escapeHtml(ne.iDraft.title || '')}" placeholder="O que este caso verifica…"></label>
            <label class="eval-fld"><span>Pergunta (o que será perguntado ao artefato)</span><input class="tag-input-field" data-eval-iq value="${escapeHtml(ne.iDraft.question || '')}" placeholder="Ex.: Qual a regra de reajuste em setembro?"></label>
            <label class="eval-fld"><span>Resposta esperada (opcional)</span><input class="tag-input-field" data-eval-ie value="${escapeHtml(ne.iDraft.expected || '')}" placeholder="O que uma boa resposta deve conter…"></label>
            <label class="eval-refuse"><input type="checkbox" data-eval-irefuse ${ne.iDraft.mustRefuse ? 'checked' : ''}> caso de <strong>recusa</strong> — a resposta correta é recusar</label>
            <label class="eval-fld"><span>Prompt da IA (opcional, avançado)</span><textarea class="tag-input-field" data-eval-iprompt rows="2" placeholder="Instrução extra para a avaliação de conteúdo (usa título/pergunta se vazio)">${escapeHtml(ne.iDraft.prompt || '')}</textarea></label>
            <div class="row-actions"><button class="primary-button small" data-action="evalAddItem" ${deny}>${icon('plus')}Adicionar caso</button></div>
          </div>`
              : canManage
                ? '<p class="muted eval-readonly-note">Definições de casos são editadas em <strong>Editar skill</strong>; aqui você pode aceitar, rejeitar, testar e adicionar os casos que a IA sugerir.</p>'
                : ''
          }
        </div>`
            : ''
        }
        ${canManage ? hint : ''}
      </div>`;
    // lastTestedId é consumo único: força o resultado recém-testado aberto UMA vez; depois o
    // curador pode fechá-lo sem que cada re-render o reabra.
    if (tab === 'casos') ne.lastTestedId = null;
    return html;
  }
  // Estimativa do Selo para a etapa Aplicar: quanto a skill pontuaria publicada agora.
  async function mergeLoadSelo() {
    const w = state.mergeWizard;
    if (!w || !w.skillId) return;
    w.seloLoading = true;
    w.selo = null;
    renderShell();
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(w.skillId)}/selo-preview`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      if (state.mergeWizard === w) {
        w.selo = d;
        w.seloLoading = false;
        renderShell();
      }
    } catch (error) {
      if (state.mergeWizard === w) {
        w.seloLoading = false;
        w.seloError = error.message || 'Falha ao estimar o selo.';
        renderShell();
      }
    }
  }
  function evalTab(tabName) {
    const ne = state.nodeEval;
    if (!ne) return;
    ne.tab = tabName;
    renderShell();
  }
  // Mirrors the server gate (deriveEvalOverall): only mandatory gate-mode items block; AI-pass OR a
  // curator accept satisfies a gate item; score-mode + local cases don't gate.
  function deriveEvalOverallClient(items) {
    const gate = (items || []).filter((x) => x.mandatory && x.mode === 'gate');
    if (!gate.length) return 'none';
    const sat = (x) => (x.accepted === 'rejected' ? false : x.accepted === 'accepted' ? true : x.aiVerdict === 'pass');
    if (gate.every(sat)) return 'pass';
    if (gate.some((x) => x.accepted === 'rejected' || (x.aiVerdict === 'fail' && x.accepted !== 'accepted')))
      return 'fail';
    return 'pending';
  }
  function evalAddItem() {
    const ne = state.nodeEval;
    if (!ne || !ne.data) return;
    const t = document.querySelector('[data-eval-ititle]');
    const p = document.querySelector('[data-eval-iprompt]');
    const q = document.querySelector('[data-eval-iq]');
    const e = document.querySelector('[data-eval-ie]');
    const r = document.querySelector('[data-eval-irefuse]');
    const title = String((t ? t.value : ne.iDraft.title) || '').trim();
    const prompt = String((p ? p.value : ne.iDraft.prompt) || '').trim();
    const question = String((q ? q.value : ne.iDraft.question) || '').trim();
    if (!title && !prompt && !question) return; // need at least a title, an AI prompt, or a question
    ne.data.items = [
      ...(ne.data.items || []),
      {
        id: `i${Date.now()}`,
        title,
        prompt,
        question,
        expected: String((e ? e.value : ne.iDraft.expected) || '').trim(),
        mustRefuse: r ? r.checked : !!ne.iDraft.mustRefuse,
        aiVerdict: 'pending',
        note: '',
        accepted: 'pending',
        mandatory: false
      }
    ];
    ne.iDraft = { title: '', prompt: '', question: '', expected: '', mustRefuse: false };
    ne.dirty = true;
    ne.tab = 'casos'; // mostra o caso recém-criado
    renderShell();
  }
  function evalRemoveItem(id) {
    const ne = state.nodeEval;
    if (!ne || !ne.data) return;
    ne.data.items = (ne.data.items || []).filter((c) => !(c.id === id && !c.mandatory));
    ne.dirty = true;
    renderShell();
  }
  // The human step: accept/reject an item (mandatory or local). Toggles off if you click the same again.
  // Persists IMMEDIATELY (auto-save) — an accept is a governance decision, and the read-only explorer
  // has no Salvar button; the save also carries any pending definition edits (wizard context).
  function evalSetAccepted(id, mandatory, value) {
    const ne = state.nodeEval;
    if (!ne || !ne.data) return;
    const isMand = mandatory === '1' || mandatory === true;
    const it = (ne.data.items || []).find((c) => c.id === id && !!c.mandatory === isMand);
    if (!it) return;
    it.accepted = it.accepted === value ? 'pending' : value;
    ne.data.overall = deriveEvalOverallClient(ne.data.items); // immediate feedback; server re-derives on save
    ne.dirty = true;
    renderShell();
    evalSave(); // fire-and-forget; on success the server view replaces the data and clears dirty
  }
  function evalAccept(id, mandatory) {
    evalSetAccepted(id, mandatory, 'accepted');
  }
  function evalReject(id, mandatory) {
    evalSetAccepted(id, mandatory, 'rejected');
  }
  async function evalSave() {
    const ne = state.nodeEval;
    if (!ne || !ne.data) return false;
    ne.saving = true;
    renderShell();
    // Payload SEM perdas: opcoes/modo/exigir/proibir incluídos — antes o auto-save do aceitar/rejeitar
    // apagava silenciosamente a rubrica autorada no assistente (e a mudança de assinatura resetava vereditos).
    const items = (ne.data.items || [])
      .filter((c) => !c.mandatory)
      .map((c) => ({
        id: c.id,
        title: c.title,
        prompt: c.prompt,
        question: c.question,
        expected: c.expected,
        mustRefuse: !!c.mustRefuse,
        opcoes: c.opcoes || [],
        modo: c.modo || 'todas',
        exigir: c.exigir || [],
        proibir: c.proibir || [],
        accepted: c.accepted
      }));
    const mandatory = {};
    for (const c of (ne.data.items || []).filter((c) => c.mandatory)) mandatory[c.id] = { accepted: c.accepted };
    try {
      const res = await evalApi(ne.nodeType, ne.id, '', 'POST', { items, mandatory });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      ne.data = d.eval;
      ne.dirty = false;
      ne.saving = false;
      renderShell();
      return true;
    } catch (error) {
      ne.saving = false;
      toast(error.message || 'Falha ao salvar.', 'warning');
      renderShell();
      return false;
    }
  }
  // Abre uma execução da IA neste nó: salva antes as definições pendentes (o servidor avalia o que o curador vê).
  // Devolve o registro da execução, ou null quando já há uma rodando ou o salvamento falhou.
  async function startEvalRun(ne, job) {
    const entry = beginEvalJob(ne, { ...job, stage: ne.dirty ? 'salvando' : job.stage });
    if (!entry) return null;
    renderShell();
    if (ne.dirty && !(await evalSave())) {
      endEvalJob(ne.nodeType, ne.id);
      renderShell();
      return null;
    }
    entry.stage = job.stage;
    renderShell();
    return entry;
  }
  async function evalRun() {
    const ne = state.nodeEval;
    if (!ne || !ne.data) return;
    const { nodeType, id } = ne;
    const job = await startEvalRun(ne, { kind: 'run', stage: 'avaliando' });
    if (!job) return;
    const before = verdictsByKey(ne.data.items);
    toast('Avaliando com IA…');
    let view = null;
    let outcome;
    try {
      const res = await evalApi(nodeType, id, '/run', 'POST', {});
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      view = d.eval;
      outcome = runOutcome(view, job.startedAt);
    } catch (error) {
      outcome = {
        tone: 'fail',
        text: `A avaliação falhou depois de ${fmtElapsed(Date.now() - job.startedAt)}: ${error.message || 'erro de rede'}.`
      };
    }
    toast(outcome.text, outcome.tone === 'pass' ? 'success' : 'warning');
    const cur = endEvalJob(nodeType, id);
    if (cur) {
      if (view) {
        cur.data = view;
        cur.updatedIds = changedVerdicts(before, view.items);
      }
      cur.outcome = outcome;
    }
    renderShell();
  }
  // Testa um caso de uso: o servidor responde a pergunta com o artefato como contexto (mesma pilha do
  // chat) e julga a resposta contra esperado/recusa (ou classifica na rubrica). Salva pendências antes
  // — o servidor testa a definição que o curador está vendo.
  async function evalTestCase(itemId) {
    const ne = state.nodeEval;
    if (!ne || !ne.data) return;
    const { nodeType, id } = ne;
    const job = await startEvalRun(ne, { kind: 'test', itemId, stage: 'testando' });
    if (!job) return;
    toast('Testando o caso com IA…');
    let view = null;
    let outcome;
    try {
      const res = await evalApi(nodeType, id, '/test', 'POST', { itemId });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      view = d.eval;
      const took = fmtElapsed(Date.now() - job.startedAt);
      const it = (view.items || []).find((c) => c.id === itemId && !c.mandatory);
      const v = it && it.testVerdict;
      outcome = d.warning
        ? { tone: 'fail', text: `${d.warning} (${took})` }
        : { tone: outcomeTone(v), text: `Teste do caso concluído em ${took}: ${VERDICT_WORD[v] || v}.` };
    } catch (error) {
      outcome = {
        tone: 'fail',
        text: `O teste falhou depois de ${fmtElapsed(Date.now() - job.startedAt)}: ${error.message || 'erro de rede'}.`
      };
    }
    toast(outcome.text, outcome.tone === 'pass' ? 'success' : 'warning');
    const cur = endEvalJob(nodeType, id);
    if (cur) {
      if (view) {
        cur.data = view;
        cur.lastTestedId = itemId;
        cur.updatedIds = new Set([`i:${itemId}`]);
      }
      cur.outcome = outcome;
    }
    renderShell();
  }
  // Pede à IA casos de uso para este artefato (o prompt "eval-suggest" do assistente de criação) e os mostra como
  // sugestões na aba Casos de uso. Um novo pedido acrescenta às sugestões que ainda estão lá.
  async function evalSuggestCases() {
    const ne = state.nodeEval;
    if (!ne || !ne.data) return;
    const { nodeType, id } = ne;
    const job = await startEvalRun(ne, { kind: 'suggest', stage: 'sugerindo' });
    if (!job) return;
    toast('Pedindo sugestões de casos de uso à IA…');
    let outcome;
    try {
      const res = await evalApi(nodeType, id, '/suggest', 'POST', {});
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      const key = evalJobKey(nodeType, id);
      const prev = evalSuggestions.get(key) || [];
      const seen = new Set(prev.map((s) => s.question.toLowerCase()));
      const fresh = (Array.isArray(d.cases) ? d.cases : [])
        .filter((c) => c && c.question && !seen.has(String(c.question).toLowerCase()))
        .map((c, i) => ({ ...c, key: `s${job.startedAt}-${i}` }));
      setEvalSuggestions(key, [...prev, ...fresh]);
      const took = fmtElapsed(Date.now() - job.startedAt);
      outcome = fresh.length
        ? {
            tone: 'pass',
            text: `A IA sugeriu ${fresh.length} ${fresh.length === 1 ? 'caso' : 'casos'} em ${took}. Adicione os que servem; nada é gravado antes disso.`
          }
        : { tone: 'pending', text: `A IA não trouxe casos novos para este artefato (${took}).` };
    } catch (error) {
      outcome = {
        tone: 'fail',
        text: `As sugestões falharam depois de ${fmtElapsed(Date.now() - job.startedAt)}: ${error.message || 'erro de rede'}.`
      };
    }
    toast(outcome.text, outcome.tone === 'fail' ? 'warning' : 'success');
    const cur = endEvalJob(nodeType, id);
    if (cur) {
      cur.outcome = outcome;
      cur.tab = 'casos';
    }
    renderShell();
  }
  // Adiciona sugestões como casos de uso e grava na hora, como aceitar ou rejeitar: o curador já decidiu. Se a
  // gravação falha, elas voltam para a lista de sugestões (o explorador não tem botão Salvar para tentar de novo).
  async function evalSuggestionAdd(key) {
    const ne = state.nodeEval;
    if (!ne || !ne.data || ne.saving || evalJobOf(ne)) return;
    const listKey = evalJobKey(ne.nodeType, ne.id);
    const all = evalSuggestions.get(listKey) || [];
    const picked = key === '*' ? all : all.filter((s) => s.key === key);
    if (!picked.length) return;
    const stamp = Date.now();
    const added = picked.map((s, i) => ({
      id: `i${stamp}${i}`,
      title: s.title || '',
      prompt: '',
      question: s.question,
      expected: s.expected || '',
      mustRefuse: Boolean(s.mustRefuse),
      aiVerdict: 'pending',
      note: '',
      accepted: 'pending',
      mandatory: false
    }));
    const wasDirty = ne.dirty;
    setEvalSuggestions(
      listKey,
      all.filter((s) => !picked.includes(s))
    );
    ne.data.items = [...(ne.data.items || []), ...added];
    ne.dirty = true;
    renderShell();
    if (await evalSave()) {
      toast(added.length === 1 ? 'Caso de uso adicionado.' : `${added.length} casos de uso adicionados.`, 'success');
      return;
    }
    const ids = new Set(added.map((c) => c.id));
    ne.data.items = (ne.data.items || []).filter((c) => !ids.has(c.id));
    ne.dirty = wasDirty;
    setEvalSuggestions(listKey, [...picked, ...(evalSuggestions.get(listKey) || [])]);
    renderShell();
  }
  function evalSuggestionDismiss(key) {
    const ne = state.nodeEval;
    if (!ne) return;
    const listKey = evalJobKey(ne.nodeType, ne.id);
    setEvalSuggestions(listKey, key === '*' ? [] : (evalSuggestions.get(listKey) || []).filter((s) => s.key !== key));
    renderShell();
  }
  // One-click promotion (explorer eval tab, drafts): save pending accepts → AI-grade (best-effort;
  // a failed run keeps the current gate state, so an all-forced-accepted skill still promotes) →
  // publish canonical if the gate passes.
  async function evalPromote() {
    const ne = state.nodeEval;
    if (!ne || ne.nodeType !== 'skill' || !ne.data) return;
    const { nodeType, id } = ne;
    const job = await startEvalRun(ne, { kind: 'promote', stage: 'avaliando' });
    if (!job) return;
    const before = verdictsByKey(ne.data.items);
    toast('Avaliando com IA…');
    let view = null;
    try {
      const res = await evalApi(nodeType, id, '/run', 'POST', {});
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) view = d.eval;
      else toast(`${d.error || 'Falha na avaliação IA'}; a promoção usa o estado atual do gate.`, 'warning');
    } catch (error) {
      toast('Falha na avaliação IA; a promoção usa o estado atual do gate.', 'warning');
    }
    let cur = nodeEvalFor(nodeType, id);
    if (cur && view) {
      cur.data = view;
      cur.updatedIds = changedVerdicts(before, view.items);
    }
    const overall = (view || (cur && cur.data) || ne.data || {}).overall;
    if (overall !== 'pass') {
      const text =
        'Promoção bloqueada: o gate precisa passar. Aprove pela IA ou aceite os itens obrigatórios pendentes.';
      toast(text, 'warning');
      cur = endEvalJob(nodeType, id);
      if (cur) cur.outcome = { tone: outcomeTone(overall), text };
      renderShell();
      return;
    }
    job.stage = 'publicando';
    renderShell();
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillId: id })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
    } catch (error) {
      const text = `A publicação falhou: ${error.message || 'erro de rede'}.`;
      toast(text, 'warning');
      cur = endEvalJob(nodeType, id);
      if (cur) cur.outcome = { tone: 'fail', text };
      renderShell();
      return;
    }
    toast('Publicada como canônica.', 'success');
    const text = `Publicada como canônica em ${fmtElapsed(Date.now() - job.startedAt)}.`;
    // A execução só termina quando a página já mostra a skill canônica: antes disso o botão de promover voltaria.
    try {
      await provider.reload();
      await refresh();
      await loadExploreSkill(id); // refresh the explorer node (status pill, promote button flips away)
    } catch (error) {
      toast('Publicada, mas a página não se atualizou. Abra a skill de novo para ver a versão canônica.', 'warning');
    } finally {
      cur = endEvalJob(nodeType, id);
      if (cur) cur.outcome = { tone: 'pass', text };
      renderShell();
    }
  }
  function renderProposalText(value) {
    const clean = String(value || '').trim();
    return clean ? escapeHtml(clean) : '<span class="empty-proposal-field">Em aberto</span>';
  }

  function renderAiGenerateButton(proposal) {
    if (!proposal.aiFillAvailable) {
      return '';
    }

    const loading = state.loading === `ai:${proposal.id}`;
    return `
      <button class="ghost-button" data-action="generateProposalWithAi" data-id="${proposal.id}" ${loading ? 'disabled' : ''}>
        ${icon('spark')}${loading ? 'Gerando...' : 'Gerar com IA'}
      </button>
    `;
  }

  function isBasicRequirementProposal(proposal) {
    return (
      proposal.aiFillAvailable ||
      proposal.category === 'requisito básico pendente' ||
      proposal.proposalType === 'basic-requirement' ||
      proposal.proposalType === 'draft-validation'
    );
  }

  // Standalone route kept defensively; the Aprovações content now lives as a tab
  // inside the Fila hub (renderQueue → renderApprovalsBody).
  function renderApprovals() {
    return `<section class="panel">${renderApprovalsBody()}</section>`;
  }

  // "Aprovações" body: skill-draft proposals awaiting the owner's validation.
  function renderApprovalsBody() {
    return `
        <p class="queue-intro">Rascunhos de skills aguardando <strong>validação do owner</strong> antes de virarem canônicas.</p>
        <div class="proposal-list">
          ${
            state.proposals
              .map(
                (proposal) => `
            <article class="proposal-card">
              <div class="proposal-head">
                <div>
                  <p class="eyebrow">${escapeHtml(proposal.status)} · ${escapeHtml(proposal.severity || 'média')} · ${escapeHtml(proposal.category || 'governança')}</p>
                  <h3>${escapeHtml(proposal.titulo)}</h3>
                  <small>${escapeHtml(proposal.owner.nome)} · ${formatDate(proposal.criadoEm)}</small>
                </div>
                <button class="ghost-button" data-action="openSkillInExplore" data-id="${escapeHtml(proposal.skillId)}">${icon('skills')}Abrir no corpus</button>
              </div>
              <div class="diff-view">
                <div><span>Antes</span><p>${renderProposalText(proposal.antes)}</p></div>
                <div><span>Depois</span><p>${renderProposalText(proposal.depois)}</p></div>
              </div>
              <div class="proposal-foot">
                <small>${renderProposalText(proposal.evalResultado)}${proposal.aiGeneratedAt ? ` · IA em ${formatDate(proposal.aiGeneratedAt)}` : ''}${proposal.manualAdjustedAt ? ` · ajustado em ${formatDate(proposal.manualAdjustedAt)}` : ''}</small>              <div class="row-actions">
                  <button class="primary-button" data-action="approveProposal" data-id="${proposal.id}">${icon('check')}Validar</button>
                  ${renderAiGenerateButton(proposal)}
                  <button class="ghost-button" data-action="adjustSuggestion" data-id="${proposal.id}">${icon('edit')}Ajustar</button>
                  ${isBasicRequirementProposal(proposal) ? '' : `<button class="ghost-button danger" data-action="discardProposal" data-id="${proposal.id}">${icon('x')}Devolver</button>`}
                </div>
              </div>
            </article>
          `
              )
              .join('') ||
            '<div class="empty-state"><h3>Fila limpa</h3><p>Nenhuma proposta pendente para aprovação.</p></div>'
          }
        </div>
    `;
  }

  return {
    renderFeedback,
    renderEvals,
    loadNodeEval,
    renderNodeEval,
    mergeLoadSelo,
    evalTab,
    evalAddItem,
    evalRemoveItem,
    evalAccept,
    evalReject,
    evalSave,
    evalRun,
    evalTestCase,
    evalSuggestCases,
    evalSuggestionAdd,
    evalSuggestionDismiss,
    evalPromote,
    renderProposalText,
    renderAiGenerateButton,
    isBasicRequirementProposal,
    renderApprovals
  };
}
