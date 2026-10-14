export function createCreationFeature({
  state,
  currentAccessUser,
  renderShell,
  escapeHtml,
  icon,
  toast,
  fileToBase64,
  isBaldeAdmin,
  isCurator,
  roleAllows,
  permissionAttrs,
  refusalNote,
  formatBytes,
  rosterChecklistHtml,
  capsuleCategoryDef,
  navigate,
  provider,
  refresh,
  slugCommonsSegClient,
  base64ToUtf8,
  openSkillInExplore,
  loadSkillMedia
}) {
  const WIZARD_STEP_LABELS = {
    general: 'Geral & execução',
    skillmd: 'SKILL.md',
    context: 'Arquivos & contexto',
    access: 'Governança',
    eval: 'Avaliação',
    review: 'Revisão'
  };

  // One creation shape now — catalog/report artifacts live on the RevenueHub side, not in Balde.
  function wizardStepList() {
    return ['general', 'skillmd', 'context', 'access', 'eval', 'review'];
  }

  function slugifyClient(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  // Mirror of the server's composeSkillId: <domain>/<subpath?>/<slug> with each segment slugified.
  // Used for the live path preview + review row so the user sees the real target folder.
  function composeSkillIdClient(domain, subpath, slug) {
    const subs = String(subpath || '')
      .replace(/\\/g, '/')
      .split('/')
      .map((s) => slugifyClient(s))
      .filter(Boolean);
    return [domain, ...subs, slug].filter(Boolean).join('/');
  }

  function initWizard() {
    state.wizard = {
      step: 'general',
      form: {
        skillKind: 'knowledge',
        title: '',
        slug: '',
        slugTouched: false,
        slugStatus: null,
        description: '',
        objetivo: '',
        escopo: '',
        domain: '',
        subpath: '',
        buddyId: '',
        outputShape: 'scalar',
        inputKind: 'text',
        formulaSafe: true,
        modelTier: 'economico',
        maxTokens: 4096,
        temperature: 0,
        body: '',
        outputSchema: '',
        files: [],
        contextFiles: [],
        classifyBusy: false,
        cadence: '',
        evalItems: [],
        evalIDraft: { title: '', prompt: '', question: '', expected: '', mustRefuse: false },
        evalSuggesting: false,
        owner: (currentAccessUser() && currentAccessUser().email) || '',
        visibility: 'public',
        curators: [],
        readers: [],
        curator_groups: [],
        reader_groups: []
      },
      buddyOptions: [],
      buddyOptionsLoaded: false,
      busy: false,
      error: null
    };
    if (!state.domainList) {
      loadDomainList();
    } // governed domain vocab for the wizard's domain select
    loadUserList();
    ensureGroupVocab(); // roster + group vocab for the Governança & acesso step
  }

  // Populate the "Buddy" dropdown on step 1 from the git-versioned buddy library.
  // A network failure leaves buddyOptions empty; the field falls back to just
  // "— nenhum —" plus any previously-set id, so the wizard never blocks on this.
  async function loadWizardBuddies() {
    if (!state.wizard) {
      initWizard();
    }
    try {
      const res = await fetch('/api/buddies', { headers: { accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        state.wizard.buddyOptions = data.buddies || [];
      }
    } catch (_) {
      // keep whatever we had; the select still works with the empty option
    }
    state.wizard.buddyOptionsLoaded = true;
    renderShell();
  }

  // Generic AI call for a wizard step: runs a stored prompt against the user's key.
  async function wizardAi(promptId, payload) {
    const res = await fetch('/api/wizard/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ promptId, payload })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Falha na IA (HTTP ${res.status}).`);
    }
    return data;
  }
  function activeWizard() {
    return state.view === 'createCommons' ? state.commonsWizard : state.wizard;
  }
  function activeWizardForm() {
    const w = activeWizard();
    return w ? w.form : null;
  }
  function activeWizardNodeType() {
    return state.view === 'createCommons' ? 'commons' : 'skill';
  }

  async function loadEvalChecklistCached() {
    if (state.evalChecklist) return;
    try {
      const res = await fetch('/api/eval-checklist');
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) {
        state.evalChecklist = d.items || [];
        renderShell();
      }
    } catch (error) {
      /* the step still works without the mandatory preview */
    }
  }

  function renderEvalWizardStep(f) {
    const nodeType = activeWizardNodeType();
    const mandatory = (state.evalChecklist || []).filter(
      (x) => x.enabled && (x.appliesTo === 'both' || x.appliesTo === nodeType)
    );
    const tab = f.evalTab || 'obrigatorios';
    const mandHtml = mandatory.length
      ? mandatory
          .map(
            (m) =>
              `<li class="eval-row"><span class="eval-row-main">${escapeHtml(m.title || '')}${m.opcoes && m.opcoes.length ? `<span class="eval-tag">rubrica · ${m.opcoes.length} opções</span>` : m.prompt ? '<span class="eval-tag">prompt IA</span>' : ''}</span></li>`
          )
          .join('')
      : `<li class="muted">${state.evalChecklist ? '—' : 'Carregando checklist…'}</li>`;
    const casosHtml =
      (f.evalItems || [])
        .map((c) => {
          const isRub = c.opcoes && c.opcoes.length;
          return `<li class="eval-row eval-row-block">
        <div class="eval-row-main">
          <strong>${escapeHtml(c.title || c.question || '(sem título)')}</strong>${c.mustRefuse ? '<span class="eval-tag eval-tag-refuse">recusa</span>' : ''}${c.prompt ? '<span class="eval-tag">prompt IA</span>' : ''}${isRub ? '<span class="eval-tag">rubrica</span>' : ''}
          ${c.question ? `<small>pergunta: ${escapeHtml(c.question)}</small>` : ''}${c.expected ? `<small>esperado: ${escapeHtml(c.expected)}</small>` : ''}
          ${isRub ? `<small class="eval-rubric">opções: ${(c.opcoes || []).map((o) => `<code class="${(c.exigir || []).includes(o) ? 'is-req' : ''}${(c.proibir || []).includes(o) ? ' is-forb' : ''}">${escapeHtml(o)}</code>`).join(' ')} · regra: exigir ${c.modo === 'qualquer' ? 'QUALQUER' : 'TODAS'} ✓${(c.proibir || []).length ? ` · ⊘ ${escapeHtml((c.proibir || []).join(', '))}` : ''}</small>` : ''}
        </div>
        <button type="button" class="tag-chip-x" data-action="wizardEvalRemoveItem" data-id="${escapeHtml(c.id)}" aria-label="Remover">×</button>
      </li>`;
        })
        .join('') || '<li class="muted">Nenhum caso de uso ainda — adicione na aba <strong>+ Adicionar</strong>.</li>';
    const tabBtn = (id, label, count) =>
      `<button type="button" class="eval-subtab ${tab === id ? 'active' : ''}" data-action="wizardEvalTab" data-tab="${id}">${label}${count != null ? ` <span class="eval-subtab-count">${count}</span>` : ''}</button>`;
    const body =
      tab === 'obrigatorios'
        ? `<div class="eval-section"><p class="wizard-hint">Definidos pelos admins (governança + OKF) — não editáveis aqui. Gatam a promoção a Canônico.</p><ul class="eval-list-v2">${mandHtml}</ul></div>`
        : tab === 'casos'
          ? `<div class="eval-section"><ul class="eval-list-v2 eval-list-cases">${casosHtml}</ul></div>`
          : renderWizardEvalAddForm(f.evalIDraft || {});
    return `
      <h2>Avaliação</h2>
      <p class="wizard-hint">Como este artefato será avaliado: um <strong>checklist obrigatório</strong> (admins) + os <strong>seus casos de uso</strong>. A IA avalia e um humano aceita, na aba <strong>Avaliação</strong>. <button class="link-button" type="button" data-action="wizardEvalSuggest" ${f.evalSuggesting ? 'disabled' : ''}>${f.evalSuggesting ? 'Sugerindo…' : '✨ Sugerir com IA'}</button></p>
      <div class="eval-subtabs">
        ${tabBtn('obrigatorios', 'Obrigatórios', mandatory.length)}
        ${tabBtn('casos', 'Casos de uso', (f.evalItems || []).length)}
        ${tabBtn('adicionar', '＋ Adicionar', null)}
      </div>
      <div class="eval-tab">${body}</div>`;
  }
  // The "Adicionar" sub-tab: a roomy form for one use case, incl. the rubric editor (option list +
  // exigir/proibir + modo). Draft state is f.evalIDraft; wizardEvalSyncDraft() captures inputs before
  // any re-render so typed values survive adding options.
  function renderWizardEvalAddForm(d) {
    const opcoes = d.opcoes || [],
      exigir = d.exigir || [],
      proibir = d.proibir || [];
    return `
      <div class="eval-add-form">
        <label class="eval-fld"><span>Título</span><input class="tag-input-field" data-wizard-eval-ititle value="${escapeHtml(d.title || '')}" placeholder="O que este caso de uso verifica…"></label>
        <label class="eval-fld"><span>Prompt da IA</span><textarea class="tag-input-field" data-wizard-eval-iprompt rows="2" placeholder="A instrução do que verificar / a pergunta a responder">${escapeHtml(d.prompt || '')}</textarea></label>
        <fieldset class="eval-rubric-editor">
          <legend>Lista de respostas — rubrica (opcional)</legend>
          <p class="muted eval-fld-hint">Defina as opções de resposta; a IA escolhe as aplicáveis. Marque quais <strong>exigir</strong> (✓) e quais <strong>proibir</strong> (⊘). <em>Sem opções</em> = a IA decide pass/fail direto.</p>
          <div class="ecl-opts">
            ${opcoes
              .map((o) => {
                const req = exigir.includes(o);
                const forb = proibir.includes(o);
                return `<span class="ecl-opt${req ? ' is-req' : ''}${forb ? ' is-forb' : ''}"><code>${escapeHtml(o)}</code><button type="button" class="ecl-opt-btn" data-action="wizardEvalOptReq" data-opt="${escapeHtml(o)}" title="exigir">✓</button><button type="button" class="ecl-opt-btn" data-action="wizardEvalOptForbid" data-opt="${escapeHtml(o)}" title="proibir">⊘</button><button type="button" class="ecl-opt-btn" data-action="wizardEvalOptDel" data-opt="${escapeHtml(o)}" title="remover">×</button></span>`;
              })
              .join('')}
            <input class="ecl-opt-add" data-wizard-eval-optadd placeholder="+ opção…"><button type="button" class="ecl-opt-btn ecl-opt-plus" data-action="wizardEvalOptAdd" title="adicionar opção">＋</button>
          </div>
          ${opcoes.length ? `<label class="ecl-modo">critério de aceite: <select data-wizard-eval-field="modo"><option value="todas" ${d.modo !== 'qualquer' ? 'selected' : ''}>exigir TODAS as ✓</option><option value="qualquer" ${d.modo === 'qualquer' ? 'selected' : ''}>exigir QUALQUER ✓</option></select> <span class="muted">✓ = critério de aceitação · ⊘ = critério de rejeição</span></label>` : ''}
        </fieldset>
        <details class="eval-testcase"><summary>Caso de teste (opcional) — pergunta &amp; resposta esperada</summary>
          <input class="tag-input-field" data-wizard-eval-iq value="${escapeHtml(d.question || '')}" placeholder="Pergunta…">
          <input class="tag-input-field" data-wizard-eval-ie value="${escapeHtml(d.expected || '')}" placeholder="Resposta esperada…">
          <label class="eval-refuse"><input type="checkbox" data-wizard-eval-irefuse ${d.mustRefuse ? 'checked' : ''}> é um caso de recusa</label>
        </details>
        <button class="primary-button small" type="button" data-action="wizardEvalAddItem">${icon('plus')}Adicionar caso de uso</button>
      </div>`;
  }
  // Capture the visible add-form inputs into f.evalIDraft before any re-render, so typed values
  // survive adding/removing options or switching sub-tab.
  function wizardEvalSyncDraft() {
    const f = activeWizardForm();
    if (!f) return;
    const d = (f.evalIDraft = { ...(f.evalIDraft || {}) });
    const g = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.value : undefined;
    };
    const gc = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.checked : undefined;
    };
    const t = g('[data-wizard-eval-ititle]');
    if (t !== undefined) d.title = t;
    const p = g('[data-wizard-eval-iprompt]');
    if (p !== undefined) d.prompt = p;
    const q = g('[data-wizard-eval-iq]');
    if (q !== undefined) d.question = q;
    const e = g('[data-wizard-eval-ie]');
    if (e !== undefined) d.expected = e;
    const r = gc('[data-wizard-eval-irefuse]');
    if (r !== undefined) d.mustRefuse = r;
    const m = g('[data-wizard-eval-field="modo"]');
    if (m !== undefined) d.modo = m;
  }
  function wizardEvalTab(tab) {
    const f = activeWizardForm();
    if (!f) return;
    wizardEvalSyncDraft();
    f.evalTab = tab;
    renderShell();
  }
  function wizardEvalOptAdd() {
    const f = activeWizardForm();
    if (!f) return;
    wizardEvalSyncDraft();
    const el = document.querySelector('[data-wizard-eval-optadd]');
    const v = String((el ? el.value : '') || '').trim();
    const d = f.evalIDraft;
    if (v) {
      d.opcoes = [...(d.opcoes || [])];
      if (!d.opcoes.includes(v)) d.opcoes.push(v);
    }
    renderShell();
  }
  function wizardEvalOptDel(opt) {
    const f = activeWizardForm();
    if (!f) return;
    wizardEvalSyncDraft();
    const d = f.evalIDraft;
    d.opcoes = (d.opcoes || []).filter((o) => o !== opt);
    d.exigir = (d.exigir || []).filter((o) => o !== opt);
    d.proibir = (d.proibir || []).filter((o) => o !== opt);
    renderShell();
  }
  function wizardEvalOptReq(opt) {
    const f = activeWizardForm();
    if (!f) return;
    wizardEvalSyncDraft();
    const d = f.evalIDraft;
    const on = (d.exigir || []).includes(opt);
    d.exigir = on ? (d.exigir || []).filter((o) => o !== opt) : [...(d.exigir || []), opt];
    d.proibir = (d.proibir || []).filter((o) => o !== opt);
    renderShell();
  }
  function wizardEvalOptForbid(opt) {
    const f = activeWizardForm();
    if (!f) return;
    wizardEvalSyncDraft();
    const d = f.evalIDraft;
    const on = (d.proibir || []).includes(opt);
    d.proibir = on ? (d.proibir || []).filter((o) => o !== opt) : [...(d.proibir || []), opt];
    d.exigir = (d.exigir || []).filter((o) => o !== opt);
    renderShell();
  }
  function wizardEvalAddItem() {
    const f = activeWizardForm();
    if (!f) return;
    wizardEvalSyncDraft();
    const d = f.evalIDraft || {};
    const title = String(d.title || '').trim();
    const prompt = String(d.prompt || '').trim();
    const question = String(d.question || '').trim();
    if (!title && !prompt && !question) return; // need at least a title, an AI prompt, or a question
    f.evalItems = [
      ...(f.evalItems || []),
      {
        id: `i${Date.now()}`,
        title,
        prompt,
        question,
        expected: String(d.expected || '').trim(),
        mustRefuse: !!d.mustRefuse,
        opcoes: [...(d.opcoes || [])],
        modo: d.modo === 'qualquer' ? 'qualquer' : 'todas',
        exigir: [...(d.exigir || [])],
        proibir: [...(d.proibir || [])]
      }
    ];
    f.evalIDraft = {
      title: '',
      prompt: '',
      question: '',
      expected: '',
      mustRefuse: false,
      opcoes: [],
      modo: 'todas',
      exigir: [],
      proibir: []
    };
    f.evalTab = 'casos';
    renderShell();
  }
  function wizardEvalRemoveItem(id) {
    const f = activeWizardForm();
    if (!f) return;
    f.evalItems = (f.evalItems || []).filter((c) => c.id !== id);
    renderShell();
  }
  async function wizardEvalSuggest() {
    const f = activeWizardForm();
    if (!f) return;
    f.evalSuggesting = true;
    renderShell();
    toast('Sugerindo avaliação com IA…');
    try {
      const data = await wizardAi('eval-suggest', {
        type: activeWizardNodeType(),
        title: f.title || '',
        content: String(f.body || '').slice(0, 8000)
      });
      const r = data.result || {};
      // The suggest prompt may still return quality[]/cases[]; fold both into the unified items[].
      const sugg = Array.isArray(r.items)
        ? r.items
        : [
            ...(Array.isArray(r.quality) ? r.quality : []).map((q) => ({
              title: String((q && (q.text || q.title || q)) || '').trim(),
              prompt: String((q && q.prompt) || '')
            })),
            ...(Array.isArray(r.cases) ? r.cases : []).map((c) => ({
              title: String((c && (c.title || c.question)) || '').trim(),
              prompt: String((c && c.prompt) || ''),
              question: String((c && c.question) || ''),
              expected: String((c && c.expected) || ''),
              mustRefuse: !!(c && c.mustRefuse)
            }))
          ];
      const seen = new Set((f.evalItems || []).map((c) => (c.title || c.question || '').toLowerCase()));
      for (const c of sugg) {
        const key = String(c.title || c.question || '').toLowerCase();
        if (key && !seen.has(key)) {
          f.evalItems.push({
            id: `i${Date.now()}${Math.floor(Math.random() * 1000)}`,
            title: c.title || '',
            prompt: c.prompt || '',
            question: c.question || '',
            expected: c.expected || '',
            mustRefuse: !!c.mustRefuse
          });
          seen.add(key);
        }
      }
      f.evalSuggesting = false;
      toast('Sugestões adicionadas.', 'success');
      renderShell();
    } catch (error) {
      f.evalSuggesting = false;
      toast(error.message || 'Falha na sugestão.', 'warning');
      renderShell();
    }
  }
  // Persist the wizard's eval items to a node after it exists (create → after POST; edit).
  async function persistWizardEval(nodeType, id, f) {
    const items = (f.evalItems || []).map((c) => ({
      id: c.id,
      title: c.title || '',
      prompt: c.prompt || '',
      question: c.question || '',
      expected: c.expected || '',
      mustRefuse: !!c.mustRefuse,
      opcoes: c.opcoes || [],
      modo: c.modo || 'todas',
      exigir: c.exigir || [],
      proibir: c.proibir || []
    }));
    if (!items.length) return; // nothing to save
    try {
      if (nodeType === 'commons')
        await fetch('/api/commons/eval', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: id, items })
        });
      else
        await fetch(`/api/skills/${encodeURIComponent(id)}/eval`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items })
        });
    } catch (error) {
      /* best-effort; the node still exists and the eval can be edited in the tab */
    }
  }
  // Prefill the wizard's eval step from a node's stored eval (edit mode) — only the node-LOCAL items.
  async function loadWizardEval(nodeType, id) {
    try {
      const res =
        nodeType === 'commons'
          ? await fetch(`/api/commons/eval?path=${encodeURIComponent(id)}`)
          : await fetch(`/api/skills/${encodeURIComponent(id)}/eval`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok || !d.eval) return;
      const w = nodeType === 'commons' ? state.commonsWizard : state.wizard;
      if (!w || w.editId !== id) return;
      w.form.evalItems = (d.eval.items || [])
        .filter((c) => !c.mandatory)
        .map((c) => ({
          id: c.id,
          title: c.title || '',
          prompt: c.prompt || '',
          question: c.question || '',
          expected: c.expected || '',
          mustRefuse: !!c.mustRefuse,
          opcoes: c.opcoes || [],
          modo: c.modo || 'todas',
          exigir: c.exigir || [],
          proibir: c.proibir || []
        }));
      renderShell();
    } catch (error) {
      /* leave empty on failure */
    }
  }

  // A rail step shows the green ✓ only when its required content is actually present.
  // Catálogo / Additional Context / Report are optional, so they count as complete
  // once passed (nothing is required there).
  function wizardStepValid(key, f) {
    if (key === 'general')
      return Boolean(
        String(f.title || '').trim() &&
        String(f.objetivo || '').trim() &&
        String(f.domain || '').trim() &&
        f.slugStatus !== 'taken'
      );
    if (key === 'skillmd') return Boolean(String(f.body || '').trim());
    if (key === 'access') return Boolean(String(f.owner || '').trim());
    if (key === 'context' || key === 'eval') return true;
    return false; // review is the final action, never shown as done
  }

  function renderCreateSkill() {
    if (!state.wizard) {
      initWizard();
    }
    const w = state.wizard;
    const steps = wizardStepList();
    const currentIdx = Math.max(0, steps.indexOf(w.step));
    const isLast = currentIdx === steps.length - 1;
    return `
      <section class="wizard">
        <aside class="wizard-rail">
          ${steps
            .map((key, idx) => {
              const done = idx < currentIdx && wizardStepValid(key, w.form);
              return `
            <button class="wizard-step ${key === w.step ? 'active' : ''} ${done ? 'done' : ''}" data-action="wizardGoto" data-step="${key}">
              <span class="wizard-step-n">${done ? '✓' : idx + 1}</span><span>${WIZARD_STEP_LABELS[key]}</span>
            </button>`;
            })
            .join('')}
        </aside>
        <div class="wizard-panel">
          ${refusalNote('curar')}
          ${w.error ? `<div class="form-alert form-alert-error">${escapeHtml(w.error)}</div>` : ''}
          ${renderWizardStep(w.step, w)}
          <div class="wizard-footer">
            <button class="link-button" data-action="wizardCancel" ${w.busy ? 'disabled' : ''}>Cancelar</button>
            <div class="wizard-footer-nav">
              <button class="ghost-button" data-action="wizardBack" ${currentIdx === 0 || w.busy ? 'disabled' : ''}>${icon('rollback')}Voltar</button>
              ${
                !isLast
                  ? `<button class="primary-button" data-action="wizardNext" ${w.busy ? 'disabled' : ''}>Próximo ${icon('play')}</button>`
                  : `<button class="primary-button" data-action="submitCreateSkill" ${w.busy ? 'disabled' : permissionAttrs('curar')}>${icon('check')}${w.busy ? (w.editId ? 'Salvando…' : 'Criando…') : w.editId ? 'Salvar alterações' : 'Criar Blueprint'}</button>`
              }
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderWizardStep(step, w) {
    const f = w.form;
    if (step === 'general') return renderWizardGeneral(f);
    if (step === 'skillmd') return renderWizardSkillMd(f);
    if (step === 'context') return renderWizardContext(f);
    if (step === 'access') return renderWizardAccess(f);
    if (step === 'eval') return renderEvalWizardStep(f);
    return renderWizardReview(w);
  }

  function renderWizardStub(title, note) {
    return `<h2>${escapeHtml(title)}</h2><div class="empty-state">${escapeHtml(note)}</div>`;
  }

  function renderWizardContext(f) {
    const files = f.contextFiles || [];
    // Media processing (AI descriptions for img/ + data/ → context) lives HERE, in the edit trail —
    // the corpus explorer is read-only. It acts on the files already SAVED on disk, so it only shows
    // when editing an existing skill; freshly added files get processed after Salvar.
    const isMedia = (x) => /^(img|data)\//.test(String(x.relPath || ''));
    const existingMedia = files.some((x) => x.existing && isMedia(x));
    const newMedia = files.some((x) => !x.existing && isMedia(x));
    const mediaRow =
      state.wizard && state.wizard.editId && (existingMedia || newMedia)
        ? `
        <div class="wizard-media-row">
          <button class="ghost-button small" data-action="wizardProcessMedia" ${f.mediaBusy || !existingMedia ? 'disabled' : ''}>${icon('spark')}${f.mediaBusy ? 'Processando…' : 'Processar mídia (IA)'}</button>
          <small class="muted">Gera descrições para <code>img/</code> e <code>data/</code> já salvos — elas viram contexto da skill.${newMedia ? ' Arquivos recém-enviados são processados depois de <strong>Salvar</strong>.' : ''}${!existingMedia ? ' (salve primeiro para habilitar)' : ''}</small>
        </div>`
        : '';
    return `
      <h2>Arquivos & contexto</h2>
      <p class="wizard-hint">Arquivos que o SKILL.md referencia. Cada um é alocado numa <strong>pasta</strong> (references, analytics, query, img, data) — a IA sugere e você ajusta. Envie arquivos soltos ou uma <strong>pasta inteira</strong> (a estrutura é preservada). Não é o lugar para dados brutos/datasets.</p>
      <div class="manual-form">
        <div class="wizard-grid">
          <label>Arquivos<input type="file" multiple data-wizard-context-files></label>
          <label>Pasta (com subpastas)<input type="file" multiple data-wizard-context-folder webkitdirectory></label>
        </div>
        ${files.length ? `<div class="row-actions"><button class="ghost-button small" data-action="wizardClassifyFiles" ${f.classifyBusy ? 'disabled' : ''}>${icon('spark')}${f.classifyBusy ? 'Classificando…' : 'Sugerir pastas (IA)'}</button></div>` : ''}
        ${mediaRow}
      </div>
      ${(() => {
        const used = contextFilesTotal(f);
        const pct = Math.min(100, Math.round((100 * used) / CONTEXT_MAX_TOTAL));
        const over = used > CONTEXT_MAX_TOTAL;
        return `<div class="ctx-budget${over ? ' is-over' : ''}">
          <div class="ctx-budget-bar"><span style="width:${pct}%"></span></div>
          <small>${(used / 1048576).toFixed(1)} MB de ${Math.round(CONTEXT_MAX_TOTAL / 1048576)} MB usados · limite de ${Math.round(CONTEXT_MAX_FILE / 1048576)} MB por arquivo${over ? ' · <strong>acima do limite</strong>' : ''}</small>
        </div>`;
      })()}
      ${renderWizardContextTree(f)}
    `;
  }

  // Remove a leading YAML frontmatter block (--- ... ---) so an uploaded SKILL.md
  // contributes only its body; the wizard owns the frontmatter (per the import decision).
  function stripFrontmatter(text) {
    const s = String(text || '');
    const m = s.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return m ? s.slice(m[0].length).replace(/^\s*\n/, '') : s;
  }

  const CONTEXT_MAX_FILE = 3 * 1024 * 1024; // 3 MB per file
  const CONTEXT_MAX_TOTAL = 20 * 1024 * 1024; // 20 MB total (base64 ≈ 27 MB on the wire)

  function contextFilesTotal(f) {
    return (f.contextFiles || []).reduce((n, x) => n + (x.size || 0), 0);
  }

  // Skip VCS/OS/dependency junk and any dotfile segment.
  function isJunkContextPath(p) {
    const lower = String(p).toLowerCase();
    if (lower.includes('/node_modules/') || lower.startsWith('node_modules/')) return true;
    return String(p)
      .split('/')
      .some((seg) => seg.startsWith('.'));
  }

  // Folder buckets a context file can live in. Each file's path = "<bucket>/<name>"; the
  // bucket is the leading segment. The heuristic guesses it instantly; classify-file (AI) refines.
  const CONTEXT_BUCKETS = ['references', 'analytics', 'query', 'img', 'data'];
  const IMG_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
  const TEXTISH_EXTS = ['md', 'markdown', 'txt', 'json', 'yml', 'yaml', 'sql', 'csv', 'tsv'];

  function fileExt(name) {
    const m = String(name || '')
      .toLowerCase()
      .match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  // Instant, no-cost bucket guess by extension (the AI step refines it on demand).
  function guessBucket(name) {
    const ext = fileExt(name);
    if (ext === 'sql') return 'query';
    if (IMG_EXTS.includes(ext)) return 'img';
    if (ext === 'csv' || ext === 'tsv') return 'data';
    return 'references';
  }

  async function addWizardContextFile(relPath, file) {
    const w = state.wizard;
    if (!w) {
      return { skipped: true };
    }
    let clean = String(relPath || file.name)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!clean || isJunkContextPath(clean)) {
      return { skipped: true };
    }
    // A SKILL.md anywhere in an imported tree becomes the body (frontmatter dropped).
    if (clean.toLowerCase() === 'skill.md' || clean.toLowerCase().endsWith('/skill.md')) {
      try {
        w.form.body = stripFrontmatter(await file.text());
      } catch (_) {
        /* keep prior body */
      }
      return { skillmd: true };
    }
    if (file.size > CONTEXT_MAX_FILE) {
      return { tooBig: clean };
    }
    if (contextFilesTotal(w.form) + file.size > CONTEXT_MAX_TOTAL) {
      return { full: true };
    }
    // A flat pick (no folder) gets an instant heuristic bucket; a folder upload keeps its tree.
    if (!clean.includes('/')) {
      clean = `${guessBucket(clean)}/${clean}`;
    }
    const read = await fileToBase64(file);
    // Capture a small text head for the AI classifier (skip binaries/images).
    let head = '';
    if (TEXTISH_EXTS.includes(fileExt(clean))) {
      try {
        head = (await file.text()).slice(0, 800);
      } catch (_) {
        head = '';
      }
    }
    w.form.contextFiles = (w.form.contextFiles || []).filter((x) => x.relPath !== clean); // de-dupe by path
    w.form.contextFiles.push({ relPath: clean, base64: read.base64, size: file.size, head });
    return { added: true };
  }

  // Change a file's bucket = rewrite the leading path segment, preserving any deeper subpath.
  function wizardSetContextBucket(rel, bucket) {
    const w = state.wizard;
    if (!w) {
      return;
    }
    const files = w.form.contextFiles || [];
    const t = files.find((x) => x.relPath === rel);
    if (!t) {
      return;
    }
    const segs = t.relPath.split('/');
    const rest = segs.length > 1 ? segs.slice(1) : [segs[0]];
    const newRel = bucket ? [bucket, ...rest].join('/') : rest.join('/');
    if (newRel === t.relPath) {
      return;
    }
    if (files.some((x) => x !== t && x.relPath === newRel)) {
      toast(`Já existe um arquivo em "${newRel}".`, 'warning');
      renderShell();
      return;
    }
    t.relPath = newRel;
    renderShell();
  }

  // Batch-ask the AI to sort the uploaded files into buckets (best-effort; needs a BYO key).
  async function wizardClassifyFiles() {
    const w = state.wizard;
    if (!w) {
      return;
    }
    const files = w.form.contextFiles || [];
    if (!files.length || w.form.classifyBusy) {
      return;
    }
    w.form.classifyBusy = true;
    renderShell();
    try {
      const payloadFiles = files.map((x) => ({ name: x.relPath.split('/').pop(), head: x.head || '' }));
      const data = await wizardAi('classify-file', { files: payloadFiles, buckets: CONTEXT_BUCKETS });
      const assignments = data.result && Array.isArray(data.result.assignments) ? data.result.assignments : [];
      let moved = 0;
      for (const a of assignments) {
        const folder = a && CONTEXT_BUCKETS.includes(a.folder) ? a.folder : '';
        if (!folder) continue;
        const t = files.find((x) => x.relPath.split('/').pop() === a.name);
        if (!t) continue;
        const segs = t.relPath.split('/');
        const rest = segs.length > 1 ? segs.slice(1) : [segs[0]];
        const newRel = [folder, ...rest].join('/');
        if (newRel !== t.relPath && !files.some((x) => x !== t && x.relPath === newRel)) {
          t.relPath = newRel;
          moved += 1;
        }
      }
      if (moved) toast(`IA reorganizou ${moved} arquivo(s).`, 'success');
      else toast('IA não sugeriu novas pastas.');
    } catch (error) {
      toast(error.message || 'Falha ao classificar com IA.', 'warning');
    }
    w.form.classifyBusy = false;
    renderShell();
  }

  async function ingestWizardContext(fileList, useRelativePath) {
    const files = Array.from(fileList || []);
    let big = 0,
      full = false,
      skmd = false,
      added = 0;
    for (const file of files) {
      // Folder pick: webkitRelativePath = "<pickedFolder>/sub/file"; strip that first
      // segment so the tree lands relative to the skill root.
      const rel = useRelativePath
        ? String(file.webkitRelativePath || file.name)
            .split('/')
            .slice(1)
            .join('/') || file.name
        : file.name;
      const r = await addWizardContextFile(rel, file);
      if (r.tooBig) big++;
      if (r.skillmd) skmd = true;
      if (r.added) added++;
      if (r.full) {
        full = true;
        break;
      }
    }
    if (skmd) toast('SKILL.md da pasta carregado como corpo (frontmatter descartado).', 'success');
    if (added) toast(`${added} arquivo(s) de contexto adicionados.`, 'success');
    if (big) toast(`${big} arquivo(s) acima de 3 MB ignorados.`, 'warning');
    if (full) toast('Limite total de contexto atingido (20 MB).', 'warning');
    renderShell();
  }

  function handleWizardContextFiles(fileList) {
    return ingestWizardContext(fileList, false);
  }

  function handleWizardContextFolder(fileList) {
    return ingestWizardContext(fileList, true);
  }

  function wizardRemoveContextFile(rel) {
    const w = state.wizard;
    if (!w) {
      return;
    }
    w.form.contextFiles = (w.form.contextFiles || []).filter((x) => x.relPath !== rel);
    renderShell();
  }

  // Phase 4: mark/unmark a context file to be extracted to the commons (as a shared concept) on
  // submit, with a link inserted into the SKILL.md. Only text files in non-media buckets qualify.
  function wizardToggleToCommons(rel) {
    const w = state.wizard;
    if (!w) {
      return;
    }
    const t = (w.form.contextFiles || []).find((x) => x.relPath === rel);
    if (t) {
      t.toCommons = !t.toCommons;
      renderShell();
    }
  }

  // D1 UX: the path a context file lands at IS its concept id / link target — let the author
  // edit it in the wizard. Validates like the server's assertSafeRelPath; on a bad/duplicate
  // path we toast and re-render (which restores the previous value in the input).
  function wizardEditContextPath(oldRel, rawNew) {
    const w = state.wizard;
    if (!w) {
      return;
    }
    const files = w.form.contextFiles || [];
    const target = files.find((x) => x.relPath === oldRel);
    if (!target) {
      return;
    }
    const clean = String(rawNew || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (clean === oldRel) {
      return; // unchanged
    }
    let err = '';
    if (!clean) err = 'O caminho não pode ficar vazio.';
    else if (clean.split('/').some((s) => s === '..')) err = 'Caminho inválido (não use "..").';
    else if (isJunkContextPath(clean)) err = 'Caminho inválido (evite dotfiles ou node_modules).';
    else if (clean.toLowerCase() === 'skill.md' || clean.toLowerCase().endsWith('/skill.md'))
      err = 'SKILL.md é gerado à parte — use outro nome.';
    else if (files.some((x) => x !== target && x.relPath === clean)) err = `Já existe um arquivo em "${clean}".`;
    if (err) {
      toast(err, 'warning');
      renderShell(); // restores the old value in the input
      return;
    }
    target.relPath = clean;
    renderShell();
  }

  function wizardAddCurator(raw) {
    const w = state.wizard;
    if (!w) {
      return;
    }
    const email = String(raw || '')
      .trim()
      .toLowerCase();
    if (email.includes('@') && !w.form.curators.includes(email)) {
      w.form.curators.push(email);
    }
    w.form.curatorDraft = '';
    renderShell();
  }

  function wizardRemoveCurator(email) {
    const w = state.wizard;
    if (!w) {
      return;
    }
    w.form.curators = w.form.curators.filter((x) => x !== email);
    renderShell();
  }

  function wizardAddReader(raw) {
    const w = state.wizard;
    if (!w) {
      return;
    }
    const email = String(raw || '')
      .trim()
      .toLowerCase();
    if (email.includes('@') && !w.form.readers.includes(email)) {
      w.form.readers.push(email);
    }
    w.form.readerDraft = '';
    renderShell();
  }

  function wizardRemoveReader(email) {
    const w = state.wizard;
    if (!w) {
      return;
    }
    w.form.readers = w.form.readers.filter((x) => x !== email);
    renderShell();
  }

  // The Governança & acesso step picks curators/readers from the roster (checkboxes)
  // plus groups; this pulls the current checkbox state back into the wizard form so
  // the Revisão step and submit see it. No re-render — the boxes already reflect it.
  function syncWizardAcl() {
    const w = state.wizard;
    if (!w) return;
    const collect = (attr) => [...document.querySelectorAll(`[${attr}]:checked`)].map((c) => c.value);
    w.form.curators = collect('data-wiz-acl="curators"');
    w.form.readers = collect('data-wiz-acl="readers"');
    w.form.curator_groups = collect('data-wiz-aclg="curator_groups"');
    w.form.reader_groups = collect('data-wiz-aclg="reader_groups"');
  }

  // Escape hatch for a person not in the roster (e.g. someone who hasn't logged in yet).
  function wizardAclAddEmail(axis) {
    const w = state.wizard;
    if (!w) return;
    const input = document.querySelector(`[data-wiz-acl-email="${axis}"]`);
    const email = String((input && input.value) || '')
      .trim()
      .toLowerCase();
    if (!email.includes('@')) {
      toast('E-mail inválido.');
      return;
    }
    const list = w.form[axis] || (w.form[axis] = []);
    if (!list.includes(email)) list.push(email);
    renderShell();
  }

  // Buddy picker for step 1: a native dropdown of the available avatars. An id
  // already on the form that is no longer in the library stays selectable (shown
  // as "ausente") so editing an existing draft never silently drops its buddy.
  function renderWizardBuddyField(f) {
    const w = state.wizard || {};
    const options = w.buddyOptions || [];
    const current = f.buddyId || '';
    const known = options.some((b) => b.id === current);
    const empty = w.buddyOptionsLoaded && !options.length;
    const opts = [
      `<option value="" ${current ? '' : 'selected'}>— nenhum —</option>`,
      ...options.map((b) => {
        const label = b.name && b.name !== b.id ? `${b.name} (${b.id})` : b.name || b.id;
        return `<option value="${escapeHtml(b.id)}" ${b.id === current ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      }),
      current && !known
        ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (ausente)</option>`
        : ''
    ].join('');
    return `
      <label>Buddy (avatar, opcional)
        <select data-wizard-field="buddyId">${opts}</select>
      </label>
      ${empty ? '<p class="wizard-hint">Nenhum buddy disponível — crie um em AI Buddy.</p>' : ''}
    `;
  }

  // Governed domain vocabulary (shared by skills + commons). Feeds the create wizards' domain select.
  async function loadDomainList() {
    try {
      const res = await fetch('/api/domains');
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        state.domainList = data.domains || [];
        // Creation whitelist (LP Builder pattern): `mine` = where THIS user may create
        // (admins: everything). The create pickers use it; the full list keeps serving
        // display/admin views.
        state.domainMine = Array.isArray(data.mine) ? data.mine : data.domains || [];
        state.domainRestricted = !!data.restrictedCreation;
        state.domainCanManage = !!data.canManage;
        renderShell();
      }
    } catch (error) {
      /* ignore — best-effort */
    }
  }

  // Phase 4: known users (roster + Authentik) for autocomplete on owner/curator/reader fields,
  // annotated with their Balde group memberships. Cached; best-effort.
  async function loadUserList() {
    if (state.userList) return;
    try {
      const res = await fetch('/api/users');
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        state.userList = data.users || [];
        renderShell();
      }
    } catch (error) {
      /* best-effort */
    }
  }

  // Governed group vocabulary (slug + name) for the wizard's Governança & acesso step.
  // Separate from state.groups (the Administração › Grupos editor) so the two don't couple. Cached.
  async function ensureGroupVocab() {
    if (state.groupVocab) return;
    try {
      const res = await fetch('/api/groups');
      const j = await res.json().catch(() => ({}));
      state.groupVocab = j.groups || [];
    } catch (error) {
      state.groupVocab = [];
    }
    renderShell();
  }

  // Phase 4: commons concepts for the SKILL.md `[[` autocomplete + "vincular commons" picker. Cached.
  async function loadCommonsConcepts() {
    if (state.commonsIndex) return;
    try {
      const res = await fetch('/api/commons');
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        state.commonsIndex = (data.concepts || []).map((c) => ({
          path: c.path,
          title: c.title || c.path.split('/').pop(),
          summary: c.summary || ''
        }));
      }
    } catch (error) {
      /* best-effort */
    }
  }

  // Shared <datalist> of known users for `list="balde-users"` inputs (owner/curators/readers).
  function renderUsersDatalist() {
    const users = state.userList || [];
    if (!users.length) return '';
    return `<datalist id="balde-users">${users.map((u) => `<option value="${escapeHtml(u.email)}">${escapeHtml(u.name || u.email)}${u.groups && u.groups.length ? ` · ${escapeHtml(u.groups.join(', '))}` : ''}</option>`).join('')}</datalist>`;
  }

  // Dono do balde (ou admin): criar um domínio novo direto do wizard, sem ir à Administração.
  function renderNewDomainInline(kind) {
    if (!state.domainCanManage) return '';
    return `<span class="new-domain-row"><input data-new-domain="${kind}" placeholder="novo domínio…" spellcheck="false" autocapitalize="off"><button class="ghost-button tiny" type="button" data-action="domainAddNew" data-kind="${kind}">${icon('plus')}criar domínio</button></span>`;
  }

  async function domainAddNew(kind) {
    const input = document.querySelector(`[data-new-domain="${kind}"]`);
    const name = input ? input.value.trim() : '';
    if (!name) return;
    try {
      const res = await fetch('/api/domains/add', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: name })
      });
      const data = await res.json();
      if (!data.ok) {
        toast(data.error || 'Falha ao criar o domínio.', 'warning');
        return;
      }
      state.domainList = data.domains || [];
      if (!state.domainRestricted || state.domainCanManage) state.domainMine = state.domainList;
      if (kind === 'cw' && state.commonsWizard) state.commonsWizard.form.domain = data.domain;
      else if (state.wizard) state.wizard.form.domain = data.domain;
      toast(`Domínio "${data.domain}" criado.`, 'success');
      renderShell();
    } catch (error) {
      toast('Falha ao criar o domínio.', 'warning');
    }
  }

  function renderWizardGeneral(f) {
    const editing = !!(state.wizard && state.wizard.editId);
    const domainOpts = state.domainMine != null ? state.domainMine : state.domainList || [];
    const sel = (key, options) =>
      `<select data-wizard-field="${key}">${options.map((o) => `<option value="${o}" ${f[key] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    const slugBadge =
      f.slugStatus === 'checking'
        ? '<span class="slug-badge checking">verificando…</span>'
        : f.slugStatus === 'taken'
          ? '<span class="slug-badge taken">em uso</span>'
          : f.slugStatus === 'free'
            ? '<span class="slug-badge free">livre</span>'
            : '';
    return `
      <h2>Geral & execução</h2>
      <div class="manual-form">
        <label>Título <span class="field-req">obrigatório</span><input data-wizard-field="title" value="${escapeHtml(f.title || '')}" placeholder="Ex.: Resumo de Clientes"></label>
        <label>Slug (id) ${slugBadge}<input data-wizard-field="slug" value="${escapeHtml(f.slug || '')}" placeholder="derivado-do-titulo" ${state.wizard && state.wizard.editId ? 'disabled title="O slug não muda na edição."' : ''}></label>
        <label>Descrição<textarea data-wizard-field="description" rows="2" placeholder="Resumo de uma linha, exibido nas listagens do corpus.">${escapeHtml(f.description || '')}</textarea>
          <span class="field-hint">A vitrine da skill: a frase que a identifica na lista — não confundir com o objetivo.</span>
        </label>
        <label>Objetivo <span class="field-req">obrigatório</span><textarea data-wizard-field="objetivo" rows="3" placeholder="O que o agente deve entregar ao rodar esta skill — a meta operacional.">${escapeHtml(f.objetivo || '')}</textarea>
          <span class="field-hint">A instrução central que guia o comportamento do agente.</span>
        </label>
        <label>Escopo<textarea data-wizard-field="escopo" rows="3" placeholder="Limites: o que faz, o que NÃO faz e quando recusar.">${escapeHtml(f.escopo || '')}</textarea>
          <span class="field-hint">As fronteiras da skill — evita que ela extrapole.</span>
        </label>
        <label>Domínio <span class="field-req">obrigatório</span>
          <select data-wizard-field="domain" ${editing ? 'disabled title="O domínio não muda na edição."' : ''}>
            <option value="">— escolha um domínio —</option>
            ${domainOpts.map((d) => `<option value="${escapeHtml(d)}" ${f.domain === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
            ${f.domain && !domainOpts.includes(f.domain) ? `<option value="${escapeHtml(f.domain)}" selected>${escapeHtml(f.domain)}</option>` : ''}
          </select>
          ${
            state.domainRestricted && !domainOpts.length
              ? '<span class="field-hint field-hint-warn">Nenhum domínio liberado para você — peça a um admin (Administração › Domínios por usuário).</span>'
              : '<span class="field-hint">Vocabulário governado (admins editam em Administração › Domínios). O seletor mostra os domínios liberados para você.</span>'
          }
          ${renderNewDomainInline('wiz')}
        </label>
        <label>Subpasta (opcional)<input data-wizard-field="subpath" value="${escapeHtml(f.subpath || '')}" placeholder="ex.: churn ou churn/mensal" ${editing ? 'disabled title="A subpasta não muda na edição."' : ''}>
          <span class="field-hint">Sub-pastas livres sob o domínio (a governança fica no domínio). Resultado: <code>skills/${escapeHtml(composeSkillIdClient(f.domain, f.subpath, f.slug || slugifyClient(f.title)) || '<domínio>/<slug>')}/</code></span>
        </label>
        ${renderWizardBuddyField(f)}
        <details class="wizard-exec"${f.outputShape === 'table' ? ' open' : ''}>
          <summary>Execução (opcional) — como um consumidor programático (ex.: RevenueHub) roda a skill</summary>
          <div class="wizard-grid">
            <label>Formato de saída ${sel('outputShape', ['scalar', 'list', 'table', 'report'])}</label>
            <label>Entrada ${sel('inputKind', ['text', 'range', 'none'])}</label>
            <label>Model tier ${sel('modelTier', ['economico', 'balanceado', 'avancado'])}</label>
            <label>Temperature<input type="number" step="0.1" min="0" max="2" data-wizard-field="temperature" value="${escapeHtml(String(f.temperature))}"></label>
            <label>Max tokens<input type="number" step="256" min="256" data-wizard-field="maxTokens" value="${escapeHtml(String(f.maxTokens))}"></label>
            <label class="wizard-check"><input type="checkbox" data-wizard-check="formulaSafe" ${f.formulaSafe ? 'checked' : ''}> formula_safe (permite =Hub_Skill)</label>
          </div>
        </details>
      </div>
    `;
  }

  // Shared context-file tree (SKILL.md step + Arquivos step feed one list). Each row: a bucket
  // selector (folder) + the editable path (concept id) + size + remove.
  function renderWizardContextTree(f) {
    const files = f.contextFiles || [];
    if (!files.length) {
      return '';
    }
    const total = files.reduce((n, x) => n + (x.size || 0), 0);
    const bucketSel = (rel) => {
      const segs = String(rel).split('/');
      const cur = segs.length > 1 ? segs[0] : '';
      const opts = [`<option value="" ${cur ? '' : 'selected'}>(raiz)</option>`].concat(
        CONTEXT_BUCKETS.map((b) => `<option value="${b}" ${b === cur ? 'selected' : ''}>${b}</option>`)
      );
      if (cur && !CONTEXT_BUCKETS.includes(cur)) {
        opts.push(`<option value="${escapeHtml(cur)}" selected>${escapeHtml(cur)}</option>`);
      }
      return `<select class="wizard-context-bucket" data-wizard-context-bucket="${escapeHtml(rel)}" aria-label="Pasta do arquivo">${opts.join('')}</select>`;
    };
    const canManage = roleAllows('curar');
    const row = (x) => {
      const segs = String(x.relPath).split('/');
      const bucket = segs.length > 1 ? segs[0] : '';
      const canPromote = canManage && !x.existing && bucket !== 'img' && bucket !== 'data';
      const promote = canPromote
        ? `<button type="button" class="ctx-commons-btn ${x.toCommons ? 'on' : ''}" data-action="wizardToggleToCommons" data-rel="${escapeHtml(x.relPath)}" title="${x.toCommons ? 'Vira cápsula e será vinculada no SKILL.md ao criar' : 'Tornar cápsula + vincular'}">${icon('library')}${x.toCommons ? 'cápsula ✓' : 'cápsula'}</button>`
        : '<span></span>';
      return `<li class="${x.toCommons ? 'to-commons' : ''}">${icon('file')}${bucketSel(x.relPath)}<input type="text" class="wizard-context-path-input" data-wizard-context-path="${escapeHtml(x.relPath)}" value="${escapeHtml(x.relPath)}" spellcheck="false" autocapitalize="off" aria-label="Caminho (id do conceito) do arquivo de contexto"><span class="wizard-context-size">${formatBytes(x.size || 0)}</span>${promote}<button type="button" class="tag-chip-x" data-action="wizardRemoveContextFile" data-rel="${escapeHtml(x.relPath)}" aria-label="Remover ${escapeHtml(x.relPath)}">×</button></li>`;
    };
    return `
      <div class="wizard-context">
        <div class="wizard-context-head"><strong>${files.length} arquivo(s) de contexto</strong><small>${formatBytes(total)}</small></div>
        <p class="wizard-hint wizard-context-hint">A <strong>pasta</strong> + o <strong>caminho</strong> formam o <strong>id do conceito</strong> — como o SKILL.md e outras skills o referenciam por link (ex.: <code>references/base.md</code>, <code>query/churn.sql</code>). A IA sugere a pasta; ajuste à vontade.${canManage ? ' <strong>↗ cápsula</strong> extrai o arquivo como cápsula compartilhada e a vincula no SKILL.md ao criar.' : ''}</p>
        <ul class="wizard-context-list">
          ${files.map(row).join('')}
        </ul>
      </div>`;
  }

  function renderWizardSkillMd(f) {
    return `
      <h2>SKILL.md</h2>
      <p class="wizard-hint">O corpo do SKILL.md (padrão OKF) já vem pré-preenchido — edite, cole, ou <button class="link-button" data-action="wizardPrefillBody">redefina o template</button>. Digite <code>[[</code> para vincular uma <strong>cápsula</strong> e <code>[[[</code> para uma <strong>skill</strong>. O frontmatter vem da etapa 1 (o de um .md enviado é descartado).</p>
      <div class="manual-form">
        <label>Corpo (markdown)<textarea data-wizard-field="body" rows="14" spellcheck="false" class="wizard-body" placeholder="## Papel&#10;... digite [[ para cápsula, [[[ para skill">${escapeHtml(f.body || '')}</textarea></label>
        <div class="wizard-charcount"><span data-wizard-charcount>${(f.body || '').length}</span> caracteres</div>
        <div class="row-actions"><button class="ghost-button small" type="button" data-action="wizardVincularCommons">${icon('library')}+ cápsula</button> <button class="ghost-button small" type="button" data-action="wizardVincularSkill">${icon('lightbulb')}+ skill</button></div>
        <label>Enviar SKILL.md principal (opcional)<input type="file" accept=".md,.markdown,.txt" data-wizard-mdfile></label>
        ${f.outputShape === 'table' ? `<details class="wizard-schema"${f.outputSchema ? ' open' : ''}><summary>output_schema.json <span class="field-req">tabela</span></summary><textarea data-wizard-field="outputSchema" rows="6" spellcheck="false" class="wizard-body" placeholder='{ "type": "object", "properties": { } }'>${escapeHtml(f.outputSchema || '')}</textarea></details>` : ''}
      </div>
      <p class="wizard-hint">Os arquivos que o SKILL.md referencia entram na etapa <strong>Arquivos & contexto</strong>.</p>
    `;
  }

  // Roster checklist (pick from known users) + an escape hatch for an off-roster
  // e-mail, wired to the wizard form (f.curators / f.readers). Mirrors the read-only
  // ACL layout so create/edit and view look the same.
  function wizardAclPeople(axis, selected, roster) {
    return `<div class="member-picker" data-axis="${axis}">
      <div class="member-picker-head"><span>Pessoas</span>
        <input class="member-search" data-roster-search placeholder="filtrar…"></div>
      <div class="member-list" data-member-list>${rosterChecklistHtml(roster, selected, `data-wiz-acl="${axis}"`)}</div>
      <div class="member-add">
        <input data-wiz-acl-email="${axis}" list="balde-users" placeholder="adicionar e-mail">
        <button class="ghost-button small" type="button" data-action="wizardAclAddEmail" data-axis="${axis}">${icon('plus')}Adicionar</button>
      </div>
    </div>`;
  }
  function wizardAclGroups(axis, selected, groups) {
    if (!groups.length)
      return '<div class="group-picker"><span>Grupos</span><p class="muted">Nenhum grupo criado (Administração → Grupos).</p></div>';
    const sel = new Set(selected || []);
    const rows = groups
      .map(
        (g) =>
          `<label class="group-check"><input type="checkbox" data-wiz-aclg="${axis}" value="${escapeHtml(g.slug)}" ${sel.has(g.slug) ? 'checked' : ''}> ${escapeHtml(g.name)} <code>${escapeHtml(g.slug)}</code></label>`
      )
      .join('');
    return `<div class="group-picker"><span>Grupos</span>${rows}</div>`;
  }
  // Owner field: the owner says who answers for the skill and grants nothing (D1, 2.0.19), so whoever
  // curates the balde picks any valid user (a real combo of the roster). The server takes it the same way.
  function renderWizardOwnerField(f) {
    if (!roleAllows('curar')) {
      return `<label>Owner
        <input value="${escapeHtml(f.owner || '')}" disabled title="Só o criador e os curadores do balde indicam o owner.">
        <span class="field-hint">O owner é quem responde pela skill; não dá permissão de edição.</span>
      </label>`;
    }
    const roster = state.userList || [];
    const cur = String(f.owner || '').toLowerCase();
    const known = roster.some((u) => String(u.email).toLowerCase() === cur);
    const opts = [
      !f.owner ? '<option value="" disabled selected>— escolha o owner —</option>' : '',
      f.owner && !known
        ? `<option value="${escapeHtml(f.owner)}" selected>${escapeHtml(f.owner)} · fora do roster</option>`
        : '',
      ...roster.map(
        (u) =>
          `<option value="${escapeHtml(u.email)}"${String(u.email).toLowerCase() === cur ? ' selected' : ''}>${escapeHtml(u.name || u.email)} · ${escapeHtml(u.email)}</option>`
      )
    ].join('');
    return `<label>Owner
      <select data-wizard-field="owner">${opts}</select>
      <span class="field-hint">Admin: qualquer usuário válido pode ser o owner.</span>
    </label>`;
  }
  // Access per skill no longer exists: the balde decides who reads and who curates. This step keeps
  // the skill's owner and its review cadence.
  function renderWizardAccess(f) {
    const cadences = [
      ['', '— herdar padrão das cápsulas —'],
      ['weekly', 'semanal'],
      ['monthly', 'mensal'],
      ['quarterly', 'trimestral'],
      ['yearly', 'anual']
    ];
    const cadLabels = { weekly: 'semanal', monthly: 'mensal', quarterly: 'trimestral', yearly: 'anual' };
    // Curadores fazem toda ação de conteúdo (D1): mudam também uma cadência travada na criação.
    const cadenceReadOnly = f.cadenceLocked && !roleAllows('curar');
    return `
      <h2>Governança</h2>
      <div class="manual-form">
        ${renderWizardOwnerField(f)}
      </div>
      <div class="manual-form">
        <div class="wizard-group">
          <span class="wizard-group-title">Cadência de revisão <small>${cadenceReadOnly ? 'definida na criação; os curadores mudam' : 'você define; depois os curadores mudam'}</small></span>
          ${
            cadenceReadOnly
              ? `<span class="cadence-locked">${icon('shield')}${escapeHtml(cadLabels[f.cadence] || f.cadence || '—')}</span>`
              : `<label class="wizard-cadence"><select data-wizard-field="cadence">${cadences.map(([v, l]) => `<option value="${v}" ${f.cadence === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
          }
        </div>
        <p class="wizard-hint">Quem lê e quem cura é o balde (Configurações › Baldes › Acesso): os admins e curadores dele editam qualquer skill; o owner edita a própria.</p>
      </div>
    `;
  }

  function renderWizardReview(w) {
    const f = w.form;
    const row = (k, v) =>
      v ? `<div class="wizard-review-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>` : '';
    const ctxCount = (f.contextFiles || []).length;
    const cadLabel =
      { weekly: 'semanal', monthly: 'mensal', quarterly: 'trimestral', yearly: 'anual' }[f.cadence] || '';
    return `
      <h2>Revisão</h2>
      <dl class="wizard-review">
        ${row('Título', f.title)}
        ${row('Domínio', f.domain)}
        ${f.subpath ? row('Subpasta', f.subpath) : ''}
        ${row('Slug', f.slug || slugifyClient(f.title))}
        ${f.subpath ? row('Caminho', composeSkillIdClient(f.domain, f.subpath, f.slug || slugifyClient(f.title))) : ''}
        ${row('Objetivo', f.objetivo)}
        ${row('Escopo', f.escopo)}
        ${row('Buddy', f.buddyId)}
        ${row('Execução', `${f.outputShape} · ${f.inputKind} · ${f.modelTier}${f.formulaSafe ? ' · formula_safe' : ''}`)}
        ${row('Corpo', f.body ? `${f.body.length} caracteres` : '(template padrão)')}
        ${ctxCount ? row('Arquivos de contexto', `${ctxCount} arquivo(s)`) : ''}
        ${f.outputShape === 'table' ? row('output_schema', f.outputSchema ? 'definido' : '(vazio — recomendado para tabela)') : ''}
        ${row('Owner', f.owner)}
        ${(f.curators || []).length ? row('Curadores', f.curators.join(', ')) : ''}
        ${(f.curator_groups || []).length ? row('Grupos curadores', f.curator_groups.join(', ')) : ''}
        ${(f.readers || []).length ? row('Leitores', f.readers.join(', ')) : ''}
        ${(f.reader_groups || []).length ? row('Grupos leitores', f.reader_groups.join(', ')) : ''}
        ${row('Categoria', capsuleCategoryDef(f.categoria).label)}
        ${cadLabel ? row('Cadência', cadLabel) : ''}
        ${(f.evalItems || []).length ? row('Itens de avaliação', `${f.evalItems.length}`) : ''}
      </dl>
      <p class="wizard-hint">${w.editId ? 'Ao salvar, as alterações são versionadas no git (histórico da skill).' : 'Ao criar, a skill nasce como <strong>Blueprint</strong> e segue para a governança (vira Canônica quando a avaliação passa).'}</p>
    `;
  }

  // The SKILL.md body comes pre-filled with the OKF template by default.
  function bodyTemplate(objetivo) {
    const obj = String(objetivo || '').trim() || 'o objetivo declarado';
    return `## Papel\n\nVocê é um assistente que executa esta skill em pt-BR, usando apenas o que estiver na entrada.\n\n**Objetivo:** ${obj}\n\n## Como responder\n\n- Descreva o passo a passo e o formato de saída.\n\n## Regras inegociáveis\n\n- Não invente dados fora da entrada.\n- Recuse quando faltar base, dizendo o que falta.`;
  }

  function wizardEnsureBody() {
    const w = state.wizard;
    if (w && !String(w.form.body).trim()) {
      w.form.body = bodyTemplate(w.form.objetivo);
    }
  }

  // Checks slug availability against the corpus; sets form.slugStatus.
  async function checkWizardSlug() {
    const w = state.wizard;
    if (!w) {
      return;
    }
    const slug = String(w.form.slug || slugifyClient(w.form.title)).trim();
    if (!slug) {
      w.form.slugStatus = null;
      renderShell();
      return;
    }
    w.form.slugStatus = 'checking';
    renderShell();
    try {
      const res = await fetch(
        `/api/skills/check-slug?id=${encodeURIComponent(slug)}&domain=${encodeURIComponent(w.form.domain || '')}&subpath=${encodeURIComponent(w.form.subpath || '')}`
      );
      const data = await res.json().catch(() => ({}));
      w.form.slugStatus = res.ok && data.ok ? (data.available ? 'free' : 'taken') : null;
    } catch (error) {
      w.form.slugStatus = null;
    }
    renderShell();
  }

  async function wizardNext() {
    const w = state.wizard;
    if (!w) {
      return;
    }
    const steps = wizardStepList();
    const idx = steps.indexOf(w.step);
    if (w.step === 'general') {
      if (!String(w.form.title).trim()) {
        w.error = 'Informe o título.';
        renderShell();
        return;
      }
      if (!String(w.form.objetivo).trim()) {
        w.error = 'Informe o objetivo.';
        renderShell();
        return;
      }
      if (!w.editId) {
        // slug is fixed when editing an existing skill
        if (!w.form.slug) {
          w.form.slug = slugifyClient(w.form.title);
        }
        await checkWizardSlug();
        if (w.form.slugStatus === 'taken') {
          w.error = `Já existe uma skill com o slug "${w.form.slug}". Escolha outro.`;
          renderShell();
          return;
        }
      }
    }
    w.error = null;
    if (idx >= 0 && idx < steps.length - 1) {
      w.step = steps[idx + 1];
    }
    if (w.step === 'skillmd') {
      wizardEnsureBody();
    }
    renderShell();
  }

  function wizardBack() {
    const w = state.wizard;
    if (!w) {
      return;
    }
    w.error = null;
    const steps = wizardStepList();
    const idx = steps.indexOf(w.step);
    if (idx > 0) {
      w.step = steps[idx - 1];
    }
    renderShell();
  }

  function wizardGoto(step) {
    const w = state.wizard;
    if (!w) {
      return;
    }
    const steps = wizardStepList();
    if (steps.includes(step)) {
      w.error = null;
      w.step = step;
      if (step === 'skillmd') {
        wizardEnsureBody();
      }
      renderShell();
    }
  }

  function wizardCancel() {
    const wasEdit = state.wizard && state.wizard.editId;
    state.wizard = null;
    navigate(wasEdit ? 'explore' : 'skills');
  }

  // Open the wizard prefilled from an existing skill (edit mode). Same page as create;
  // the slug is locked and submit goes to the update endpoint.
  async function openEditSkill(id) {
    if (!id) {
      return;
    }
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(id)}/edit`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        toast(d.error || 'Não foi possível carregar a skill para edição.', 'warning');
        return;
      }
      // Split the folder id into its parts: domain = first segment, slug = last, subpath = middle (if any).
      const _segs = String(id).split('/');
      const _domain = _segs.length > 1 ? _segs[0] : d.domain || '';
      const _slug = _segs.length > 1 ? _segs[_segs.length - 1] : id;
      const _subpath = _segs.length > 2 ? _segs.slice(1, -1).join('/') : '';
      state.wizard = {
        step: 'general',
        editId: id,
        form: {
          skillKind: 'knowledge',
          title: d.title || '',
          slug: _slug,
          slugTouched: true,
          slugStatus: 'free',
          description: d.description || '',
          objetivo: d.objetivo || '',
          escopo: d.escopo || '',
          domain: _domain,
          subpath: _subpath,
          buddyId: d.buddyId || '',
          outputShape: d.outputShape || 'scalar',
          inputKind: d.inputKind || 'text',
          formulaSafe: d.formulaSafe !== false,
          modelTier: d.modelTier || 'economico',
          maxTokens: d.maxTokens || 4096,
          temperature: d.temperature || 0,
          body: d.body || '',
          outputSchema: d.outputSchema || '',
          files: [],
          // Existing context files prefilled for full management (re-bucket / rename / remove);
          // content stays on disk (base64 null) — the server reconciles by path.
          contextFiles: (Array.isArray(d.files) ? d.files : []).map((ff) => ({
            relPath: ff.relPath,
            base64: null,
            existing: true,
            origPath: ff.relPath,
            size: ff.size || 0,
            head: ''
          })),
          classifyBusy: false,
          cadence: d.cadence || '',
          evalItems: [],
          evalIDraft: { title: '', prompt: '', question: '', expected: '', mustRefuse: false },
          evalSuggesting: false,
          cadenceLocked: !!d.cadenceLocked,
          cadenceLockedBy: d.cadenceLockedBy || '',
          owner: d.owner || '',
          visibility: d.visibility === 'restricted' ? 'restricted' : 'public',
          curators: Array.isArray(d.curators) ? d.curators : [],
          readers: Array.isArray(d.readers) ? d.readers : [],
          curator_groups: Array.isArray(d.curator_groups) ? d.curator_groups : [],
          reader_groups: Array.isArray(d.reader_groups) ? d.reader_groups : [],
          _status: d.status,
          _version: d.version
        },
        buddyOptions: [],
        buddyOptionsLoaded: false,
        busy: false,
        error: null
      };
      state.view = 'createSkill';
      renderShell();
      loadUserList();
      ensureGroupVocab(); // roster + group vocab for the Governança & acesso step
      loadWizardBuddies();
      loadCommonsConcepts(); // [[ capsule-link autocomplete in the body (edit went straight to renderShell, skipping navigate())
      loadEvalChecklistCached();
      loadWizardEval('skill', id);
    } catch (error) {
      toast('Erro ao carregar a skill.', 'warning');
    }
  }

  function deleteSkillConfirm(id) {
    if (!id) {
      return;
    }
    state.confirm = {
      type: 'deleteSkill',
      id,
      title: `Arquivar a skill "${id}"?`,
      body: 'A skill sai do corpus ativo: chat, MCP e buscas deixam de vê-la, inclusive a versão publicada. Ela fica em Governança › Arquivadas, de onde um curador a restaura como estava.',
      confirmLabel: 'Arquivar skill'
    };
    renderShell();
  }

  async function deleteSkill(id) {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({}));
      state.confirm = null;
      if (!res.ok || !d.ok) {
        toast(d.error || 'Falha ao arquivar a skill.', 'warning');
        renderShell();
        return;
      }
      if (state.explore) {
        state.explore.selectedId = null;
        state.explore.bundle = null;
      }
      await provider.reload();
      await refresh();
      toast(`Skill "${id}" arquivada.`, 'success');
      navigate('explore');
    } catch (error) {
      state.confirm = null;
      toast('Erro ao arquivar a skill.', 'warning');
      renderShell();
    }
  }

  function wizardPrefillBody() {
    const w = state.wizard;
    if (!w) {
      return;
    }
    w.form.body = bodyTemplate(w.form.objetivo);
    renderShell();
  }

  async function handleWizardMdFile(fileList) {
    const file = (fileList || [])[0];
    if (!file || !state.wizard) {
      return;
    }
    try {
      state.wizard.form.body = stripFrontmatter(await file.text());
      renderShell();
      toast('SKILL.md carregado no corpo (frontmatter descartado).', 'success');
    } catch (error) {
      toast('Falha ao ler o arquivo.', 'warning');
    }
  }

  function wizardAddEval(raw) {
    const w = state.wizard;
    if (!w) {
      return;
    }
    const crit = String(raw || '').trim();
    if (crit && !w.form.evalCriteria.includes(crit)) {
      w.form.evalCriteria.push(crit);
    }
    w.form.evalDraft = '';
    renderShell();
  }

  function wizardRemoveEval(crit) {
    const w = state.wizard;
    if (!w) {
      return;
    }
    w.form.evalCriteria = w.form.evalCriteria.filter((x) => x !== crit);
    renderShell();
  }

  async function submitCreateSkill() {
    const w = state.wizard;
    if (!w) {
      return;
    }
    const f = w.form;
    if (!String(f.title).trim()) {
      w.step = 'general';
      w.error = 'Informe o título.';
      renderShell();
      return;
    }
    if (!String(f.objetivo).trim()) {
      w.step = 'general';
      w.error = 'Informe o objetivo.';
      renderShell();
      return;
    }
    if (!w.editId && !String(f.domain || '').trim()) {
      w.step = 'general';
      w.error = 'Escolha um domínio.';
      renderShell();
      return;
    }
    // Flush any half-typed curator/reader email still in the input.
    const curators = [...(f.curators || [])];
    const cd = String(f.curatorDraft || '')
      .trim()
      .toLowerCase();
    if (cd.includes('@') && !curators.includes(cd)) {
      curators.push(cd);
    }
    const readers = [...(f.readers || [])];
    const rd = String(f.readerDraft || '')
      .trim()
      .toLowerCase();
    if (rd.includes('@') && !readers.includes(rd)) {
      readers.push(rd);
    }
    // Eval (quality + cases) is authored on the Avaliação step and persisted after create/update.
    w.busy = true;
    w.error = null;
    renderShell();
    try {
      const editing = Boolean(w.editId);
      let body = f.body;
      // Phase 4: "↗ tornar commons" — extract flagged text files to the commons + link them in the
      // SKILL.md (create only). Runs BEFORE the skill POST; any hard failure aborts without creating.
      const promote = editing
        ? []
        : (f.contextFiles || []).filter((x) => x.toCommons && !/^(img|data)\//.test(x.relPath));
      if (promote.length) {
        // Extract into the skill's OWN governed domain (commons + skills share one vocabulary).
        const domain = f.domain || 'geral';
        const links = [];
        for (const cf of promote) {
          const title = cf.relPath.split('/').pop();
          const concept = slugCommonsSegClient(title.replace(/\.[^.]+$/, ''));
          const resC = await fetch('/api/commons/new', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ domain, concept, title, body: base64ToUtf8(cf.base64) })
          });
          const dC = await resC.json().catch(() => ({}));
          if (!resC.ok && resC.status !== 409) {
            w.busy = false;
            w.error = `Falha ao extrair "${title}" para as Cápsulas (${domain}/${concept}): ${dC.error || resC.status}`;
            renderShell();
            return;
          }
          links.push(`- [${title}](/commons/${domain}/${concept})`);
        }
        if (links.length) {
          body = `${String(body || '').trimEnd()}\n\n## Conceitos do commons vinculados\n${links.join('\n')}\n`;
        }
        state.commonsIndex = null; // promoted new commons concepts — refresh the [[ index next time
      }
      // Build the file payloads. On EDIT: existing files → existingFiles (kept/renamed, content stays
      // on disk); newly-added uploads → files (base64); the server reconciles the desired set
      // (delete/rename/add). On CREATE: every kept context file ships its content.
      const files = [...(f.files || [])];
      let existingFiles = null;
      if (editing) {
        existingFiles = [];
        for (const cf of f.contextFiles || []) {
          if (cf.existing) {
            existingFiles.push({ relPath: cf.relPath, origPath: cf.origPath || cf.relPath });
          } else if (cf.base64) {
            files.push({ relPath: cf.relPath, base64: cf.base64 });
          }
        }
      } else {
        for (const cf of (f.contextFiles || []).filter((x) => !promote.includes(x))) {
          files.push({ relPath: cf.relPath, base64: cf.base64 });
        }
      }
      const payload = {
        title: f.title,
        id: f.slug || slugifyClient(f.title),
        domain: f.domain,
        subpath: f.subpath || '',
        kind: 'skill',
        skillKind: 'knowledge',
        description: f.description,
        objetivo: f.objetivo,
        escopo: f.escopo,
        buddyId: f.buddyId,
        outputShape: f.outputShape,
        inputKind: f.inputKind,
        formulaSafe: f.formulaSafe,
        modelTier: f.modelTier,
        maxTokens: Number(f.maxTokens) || 4096,
        temperature: Number(f.temperature) || 0,
        body,
        outputSchema: f.outputShape === 'table' ? f.outputSchema : '',
        owner: f.owner,
        access: {
          visibility: f.visibility,
          curators,
          readers,
          curator_groups: f.curator_groups || [],
          reader_groups: f.reader_groups || []
        },
        files,
        cadence: f.cadence || ''
      };
      if (editing) {
        payload.existingFiles = existingFiles;
      }
      const endpoint = editing ? `/api/skills/${encodeURIComponent(w.editId)}/update` : '/api/skills/new';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        w.busy = false;
        w.error = data.error || `Falha ao ${editing ? 'salvar' : 'criar'} (HTTP ${res.status}).`;
        renderShell();
        return;
      }
      state.wizard = null;
      if (data.id) await persistWizardEval('skill', data.id, f); // Phase 2b: save the eval step
      await provider.reload();
      await refresh();
      toast(editing ? `Skill "${f.title}" atualizada.` : `Skill "${f.title}" criada como Blueprint.`, 'success');
      if (data.id) {
        await openSkillInExplore(data.id);
        loadSkillMedia(data.id);
      } else {
        renderShell();
      }
      if (!editing && (f.contextFiles || []).some((x) => /^(img|data)\//.test(x.relPath))) {
        toast('Processe a mídia (IA) na visão geral da skill para gerar as descrições.');
      }
    } catch (error) {
      if (state.wizard) {
        state.wizard.busy = false;
        state.wizard.error = error.message || 'Erro de rede.';
      }
      renderShell();
    }
  }

  return {
    slugifyClient,
    composeSkillIdClient,
    loadWizardBuddies,
    activeWizardForm,
    loadEvalChecklistCached,
    renderEvalWizardStep,
    wizardEvalTab,
    wizardEvalOptAdd,
    wizardEvalOptDel,
    wizardEvalOptReq,
    wizardEvalOptForbid,
    wizardEvalAddItem,
    wizardEvalRemoveItem,
    wizardEvalSuggest,
    persistWizardEval,
    loadWizardEval,
    renderCreateSkill,
    stripFrontmatter,
    CONTEXT_MAX_FILE,
    IMG_EXTS,
    fileExt,
    wizardSetContextBucket,
    wizardClassifyFiles,
    handleWizardContextFiles,
    handleWizardContextFolder,
    wizardRemoveContextFile,
    wizardToggleToCommons,
    wizardEditContextPath,
    wizardAddCurator,
    wizardRemoveCurator,
    wizardAddReader,
    wizardRemoveReader,
    syncWizardAcl,
    wizardAclAddEmail,
    loadDomainList,
    loadUserList,
    loadCommonsConcepts,
    renderUsersDatalist,
    domainAddNew,
    checkWizardSlug,
    wizardNext,
    wizardBack,
    wizardGoto,
    wizardCancel,
    openEditSkill,
    deleteSkillConfirm,
    deleteSkill,
    wizardPrefillBody,
    handleWizardMdFile,
    wizardAddEval,
    wizardRemoveEval,
    submitCreateSkill
  };
}
