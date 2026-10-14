export function createCapsuleEditorFeature({
  state,
  currentAccessUser,
  loadDomainList,
  isBaldeAdmin,
  isCurator,
  roleAllows,
  permissionAttrs,
  refusalNote,
  toast,
  renderShell,
  loadUserList,
  loadCommonsConcepts,
  loadEvalChecklistCached,
  loadWizardEval,
  escapeHtml,
  icon,
  renderEvalWizardStep,
  capsuleCategoryDef,
  capsuleCategories,
  capsuleCategoryKey,
  formatBytes,
  navigate,
  stripFrontmatter,
  fileExt,
  IMG_EXTS,
  CONTEXT_MAX_FILE,
  fileToBase64,
  persistWizardEval,
  provider,
  refresh
}) {
  const COMMONS_WIZARD_STEP_LABELS = {
    general: 'Geral',
    context: 'context.md',
    media: 'Mídia & dados',
    governance: 'Governança',
    eval: 'Avaliação',
    review: 'Revisão'
  };
  function commonsWizardStepList() {
    return ['general', 'context', 'media', 'governance', 'eval', 'review'];
  }

  function slugCommonsSegClient(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^[-]+|[-]+$/g, '')
      .slice(0, 60);
  }
  function commonsWizardId(f) {
    const d = slugCommonsSegClient(f.domain),
      c = slugCommonsSegClient(f.concept);
    return d && c ? `${d}/${c}` : '';
  }

  function initCommonsWizard() {
    state.commonsWizard = {
      step: 'general',
      form: {
        domain: '',
        concept: '',
        title: '',
        summary: '',
        body: '',
        mediaFiles: [],
        owner: (currentAccessUser() && currentAccessUser().email) || '',
        curators: [],
        curatorDraft: '',
        visibility: 'public',
        readers: [],
        readerDraft: '',
        serie: '',
        periodo: '',
        cadence: '',
        evalItems: [],
        evalIDraft: { title: '', prompt: '', question: '', expected: '', mustRefuse: false },
        evalSuggesting: false
      },
      busy: false,
      error: null
    };
    if (!state.domainList) {
      loadDomainList();
    } // governed domain vocab for the commons domain select
  }

  // Corpus Explorer → Curadoria: turn a skill context file into a shared capsule.
  // Opens the capsule create wizard PREFILLED from the file (domain from the skill,
  // concept/title from the filename, body = the file's content). A create flow — the
  // user reviews governance/eval and submits; nothing is written until they do.
  async function migrateToCapsule(skillId, path) {
    if (!skillId || !path) return;
    if (!roleAllows('curar')) {
      toast('Só o criador e os curadores deste balde criam cápsulas.', 'warning');
      return;
    }
    if (!state.domainList) {
      loadDomainList();
    }
    try {
      const res = await fetch(
        `/api/explore/file?skill=${encodeURIComponent(skillId)}&path=${encodeURIComponent(path)}`
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        toast(d.error || 'Não foi possível ler o arquivo para migrar.', 'warning');
        return;
      }
      const base = String(path)
        .split('/')
        .pop()
        .replace(/\.[^.]+$/, '');
      initCommonsWizard();
      // A capsule migrated out of a restricted skill starts restricted too (the curator can
      // still flip it in the Governança step — but the default never widens the audience).
      const srcSkill = (state.skills || []).find((s) => s.id === skillId) || null;
      Object.assign(state.commonsWizard.form, {
        domain: String(skillId).includes('/') ? String(skillId).split('/')[0] : '',
        concept: slugCommonsSegClient(base),
        title: base.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
        summary: `Migrado de ${skillId} · ${path}`,
        body: d.content || '',
        visibility: srcSkill && srcSkill.visibility === 'restricted' ? 'restricted' : 'public'
      });
      state.view = 'createCommons';
      renderShell();
      loadUserList();
      loadCommonsConcepts();
      loadEvalChecklistCached();
      toast(
        d.tooLarge
          ? 'Arquivo grande — cole o conteúdo manualmente.'
          : 'Cápsula pré-preenchida a partir do arquivo. Revise e crie.',
        d.tooLarge ? 'warning' : 'success'
      );
    } catch (error) {
      toast('Erro ao preparar a migração.', 'warning');
    }
  }

  // Open the commons wizard in EDIT mode — prefill from the concept (id locked, existing media
  // prefilled for full management). Mirrors openEditSkill.
  async function openEditCommons(path) {
    if (!path) return;
    if (!state.domainList) {
      loadDomainList();
    }
    try {
      const res = await fetch(`/api/commons/edit?path=${encodeURIComponent(path)}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        toast(d.error || 'Não foi possível carregar o conceito para edição.', 'warning');
        return;
      }
      state.commonsWizard = {
        step: 'general',
        editId: d.id,
        form: {
          domain: d.domain || '',
          concept: d.concept || '',
          title: d.titulo || d.title || '',
          summary: d.summary || '',
          body: d.body || '',
          // Existing media prefilled for full management (rename / remove); content stays on disk.
          mediaFiles: (Array.isArray(d.media) ? d.media : []).map((m) => ({
            relPath: m.relPath,
            base64: null,
            existing: true,
            origPath: m.relPath,
            size: m.size || 0
          })),
          owner: d.owner || '',
          curators: Array.isArray(d.curators) ? d.curators : [],
          curatorDraft: '',
          visibility: d.access && d.access.visibility === 'restricted' ? 'restricted' : 'public',
          readers: d.access && Array.isArray(d.access.readers) ? d.access.readers : [],
          readerDraft: '',
          cadence: d.cadence || '',
          serie: d.serie || '',
          periodo: d.periodo || '',
          categoria: d.categoria || 'dado',
          evalItems: [],
          evalIDraft: { title: '', prompt: '', question: '', expected: '', mustRefuse: false },
          evalSuggesting: false,
          cadenceLocked: !!d.cadenceLocked,
          cadenceLockedBy: d.cadenceLockedBy || ''
        },
        busy: false,
        error: null
      };
      state.view = 'createCommons';
      renderShell();
      loadUserList();
      loadCommonsConcepts();
      loadEvalChecklistCached();
      loadWizardEval('commons', d.id);
    } catch (error) {
      toast('Erro ao carregar o conceito.', 'warning');
    }
  }

  function commonsWizardStepValid(key, f) {
    if (key === 'general') return Boolean(commonsWizardId(f) && String(f.title || '').trim());
    if (key === 'context') return Boolean(String(f.body || '').trim());
    if (key === 'media' || key === 'governance' || key === 'eval') return true;
    return false;
  }

  function renderCreateCommons() {
    if (!state.commonsWizard) initCommonsWizard();
    const w = state.commonsWizard;
    const steps = commonsWizardStepList();
    const currentIdx = Math.max(0, steps.indexOf(w.step));
    const isLast = currentIdx === steps.length - 1;
    return `
      <section class="wizard">
        <aside class="wizard-rail">
          ${steps
            .map((key, idx) => {
              const done = idx < currentIdx && commonsWizardStepValid(key, w.form);
              return `
            <button class="wizard-step ${key === w.step ? 'active' : ''} ${done ? 'done' : ''}" data-action="cwGoto" data-step="${key}">
              <span class="wizard-step-n">${done ? '✓' : idx + 1}</span><span>${COMMONS_WIZARD_STEP_LABELS[key]}</span>
            </button>`;
            })
            .join('')}
        </aside>
        <div class="wizard-panel">
          ${refusalNote('curar')}
          ${w.error ? `<div class="form-alert form-alert-error">${escapeHtml(w.error)}</div>` : ''}
          ${renderCommonsStep(w.step, w)}
          <div class="wizard-footer">
            <button class="link-button" data-action="cwCancel" ${w.busy ? 'disabled' : ''}>Cancelar</button>
            <div class="wizard-footer-nav">
              <button class="ghost-button" data-action="cwBack" ${currentIdx === 0 || w.busy ? 'disabled' : ''}>${icon('rollback')}Voltar</button>
              ${
                !isLast
                  ? `<button class="primary-button" data-action="cwNext" ${w.busy ? 'disabled' : ''}>Próximo ${icon('play')}</button>`
                  : `<button class="primary-button" data-action="submitCreateCommons" ${w.busy ? 'disabled' : permissionAttrs('curar')}>${icon('check')}${w.busy ? (w.editId ? 'Salvando…' : 'Criando…') : w.editId ? 'Salvar cápsula' : 'Criar cápsula'}</button>`
              }
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderCommonsStep(step, w) {
    const f = w.form;
    if (step === 'general') return renderCommonsGeneral(f);
    if (step === 'context') return renderCommonsContext(f);
    if (step === 'media') return renderCommonsMedia(f);
    if (step === 'governance') return renderCommonsGovernance(f);
    if (step === 'eval') return renderEvalWizardStep(f);
    return renderCommonsReview(w);
  }

  function renderCommonsGeneral(f) {
    const id = commonsWizardId(f);
    const editing = Boolean(state.commonsWizard && state.commonsWizard.editId);
    const lock = editing
      ? 'disabled title="O identificador não muda na edição — renomear moveria a pasta e quebraria os links."'
      : '';
    const cat = capsuleCategoryDef(f.categoria);
    return `
      <h2>Geral</h2>
      <p class="wizard-hint">${
        editing
          ? 'O <strong>domínio</strong> e o <strong>identificador</strong> são fixos — eles são o endereço da cápsula. O <strong>nome</strong>, o resumo e a categoria você muda quando quiser.'
          : 'O <strong>domínio</strong> + o <strong>identificador</strong> formam o endereço permanente da cápsula. O <strong>nome</strong> é só o rótulo exibido e pode mudar depois.'
      }</p>
      ${editing ? '' : `<div class="wizard-callout">${icon('lock')}<span><strong>Escolha com calma:</strong> domínio e identificador <strong>não mudam</strong> depois de criada — eles viram o caminho da pasta e o alvo de todos os links. O nome de exibição, esse sim, pode ser reescrito a qualquer momento.</span></div>`}
      <div class="manual-form">
        <div class="wizard-grid">
          <label>Domínio <span class="field-req">obrigatório</span>
            <select data-cw-field="domain" ${lock}>
              <option value="">— escolha um domínio —</option>
              ${((state.domainMine != null ? state.domainMine : state.domainList) || []).map((d) => `<option value="${escapeHtml(d)}" ${f.domain === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
              ${f.domain && !((state.domainMine != null ? state.domainMine : state.domainList) || []).includes(f.domain) ? `<option value="${escapeHtml(f.domain)}" selected>${escapeHtml(f.domain)}</option>` : ''}
            </select>
            ${state.domainRestricted && !(state.domainMine || []).length ? '<span class="field-hint field-hint-warn">Nenhum domínio liberado para você — peça a um admin (Administração › Domínios por usuário).</span>' : ''}
          </label>
          <label>Identificador (slug) <span class="field-req">permanente</span>
            <input data-cw-field="concept" value="${escapeHtml(f.concept || '')}" placeholder="ex.: dicionario_dados" spellcheck="false" autocapitalize="off" ${lock}>
            <span class="field-hint">Minúsculas, sem acento — é o endereço, não o nome.</span>
          </label>
        </div>
        ${id ? `<p class="wizard-hint">Endereço: <code>/commons/${escapeHtml(id)}</code></p>` : ''}
        <label>Nome de exibição <span class="field-req">obrigatório</span>
          <input data-cw-field="title" value="${escapeHtml(f.title || '')}" placeholder="Ex.: Dicionário da base de vendas — validação 2026">
          <span class="field-hint">É o rótulo que aparece no Mapa, no explorador e nas listas. Pode ser mudado depois.</span>
        </label>
        <label>Categoria
          <select data-cw-field="categoria">
            ${capsuleCategories()
              .map(
                (c) =>
                  `<option value="${escapeHtml(c.key)}"${capsuleCategoryKey(f.categoria) === c.key ? ' selected' : ''}>${escapeHtml(c.label)}</option>`
              )
              .join('')}
          </select>
          <span class="field-hint">${escapeHtml(cat.hint || 'Que tipo de conhecimento esta cápsula guarda.')}</span>
        </label>
        <label>Resumo<textarea data-cw-field="summary" rows="2" placeholder="Uma frase: o que este conceito compartilhado descreve.">${escapeHtml(f.summary || '')}</textarea></label>
      </div>
    `;
  }

  function renderCommonsContext(f) {
    return `
      <h2>context.md</h2>
      <p class="wizard-hint">O conteúdo da cápsula (markdown) — é o que vira contexto quando uma skill referencia o link. <button class="link-button" data-action="cwPrefillBody">Usar template</button>, cole, ou envie um .md. Cápsulas são <strong>atômicas</strong>: não referenciam outras cápsulas.</p>
      <div class="manual-form">
        <label>Conteúdo (markdown)<textarea data-cw-field="body" rows="14" spellcheck="false" class="wizard-body" placeholder="# Cápsula&#10;Conteúdo do conceito…">${escapeHtml(f.body || '')}</textarea></label>
        <label>Enviar context.md (opcional)<input type="file" accept=".md,.markdown,.txt" data-cw-mdfile></label>
      </div>
    `;
  }

  function renderCommonsMedia(f) {
    const files = f.mediaFiles || [];
    const total = files.reduce((n, x) => n + (x.size || 0), 0);
    return `
      <h2>Mídia & dados</h2>
      <p class="wizard-hint">Imagens (→ <code>img/</code>) e tabelas pequenas CSV/TSV (→ <code>data/</code>). Dê uma <strong>descrição</strong> a cada arquivo — digite você mesmo ou gere com IA. As descrições viram o contexto do conceito.</p>
      <div class="manual-form">
        <label>Arquivos (imagens · csv/tsv)<input type="file" multiple accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.csv,.tsv" data-cw-media-files></label>
      </div>
      ${
        files.length
          ? `
      <div class="wizard-context">
        <div class="wizard-context-head">
          <strong>${files.length} arquivo(s)</strong>
          <small>${formatBytes(total)}</small>
          ${files.some((x) => x.base64) ? `<button type="button" class="ghost-button small" data-action="cwDescribeAllMedia" ${f.describingAll ? 'disabled' : ''}>${icon('spark')}${f.describingAll ? 'Processando…' : 'Processar tudo com IA'}</button>` : ''}
        </div>
        <ul class="wizard-media-list">
          ${files
            .map(
              (x) => `
          <li class="wizard-media-item">
            <div class="wizard-media-row">
              ${icon('file')}
              <input type="text" class="wizard-context-path-input" data-cw-media-path="${escapeHtml(x.relPath)}" value="${escapeHtml(x.relPath)}" spellcheck="false" autocapitalize="off">
              <span class="wizard-context-size">${formatBytes(x.size || 0)}</span>
              <button type="button" class="tag-chip-x" data-action="cwRemoveMedia" data-rel="${escapeHtml(x.relPath)}" aria-label="Remover">×</button>
            </div>
            <div class="wizard-media-desc-row">
              <textarea class="wizard-media-desc" data-cw-media-desc="${escapeHtml(x.relPath)}" rows="2" placeholder="Descrição (vira contexto) — digite ou gere com IA…" ${x.describing || f.describingAll ? 'disabled' : ''}>${escapeHtml(x.description || '')}</textarea>
              ${
                x.base64
                  ? `<button type="button" class="ghost-button small wizard-media-ai" data-action="cwDescribeMedia" data-rel="${escapeHtml(x.relPath)}" ${x.describing || f.describingAll ? 'disabled' : ''} title="Gerar descrição com IA">${icon('spark')}${x.describing ? '…' : 'IA'}</button>`
                  : '<span class="wizard-media-existing muted" title="Arquivo já salvo — reprocessável ao editar">existente</span>'
              }
            </div>
          </li>`
            )
            .join('')}
        </ul>
      </div>`
          : ''
      }
    `;
  }

  function renderCommonsGovernance(f) {
    const chips = (list, action) =>
      (list || [])
        .map(
          (e) =>
            `<span class="tag-chip">${escapeHtml(e)}<button type="button" class="tag-chip-x" data-action="${action}" data-email="${escapeHtml(e)}">×</button></span>`
        )
        .join('');
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
        <div class="form-grid-2">
          <label>Owner<input data-cw-field="owner" list="balde-users" value="${escapeHtml(f.owner || '')}" placeholder="owner@exemplo.com"></label>
          <label title="${cadenceReadOnly ? 'Definida na criação; os curadores mudam.' : 'Você define; depois os curadores mudam.'}">Cadência de revisão${
            cadenceReadOnly
              ? `<span class="cadence-locked">${icon('shield')}${escapeHtml(cadLabels[f.cadence] || f.cadence || '—')}</span>`
              : `<select data-cw-field="cadence">${cadences.map(([v, l]) => `<option value="${v}" ${f.cadence === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`
          }</label>
        </div>
        <div class="wizard-group">
          <span class="wizard-group-title">Série temporal <small>opcional — marca a cápsula como episódio de uma série</small></span>
          <div class="form-grid-2">
            <label>Série<input data-cw-field="serie" value="${escapeHtml(f.serie || '')}" placeholder="fechamento" spellcheck="false" autocapitalize="off"></label>
            <label>Período<input data-cw-field="periodo" value="${escapeHtml(f.periodo || '')}" placeholder="2026-07" spellcheck="false" autocapitalize="off"></label>
          </div>
          <p class="wizard-hint">Prefixo <code>serie-</code> automático · período ISO define a granularidade: <code>2026</code> anual · <code>2026-07</code> mensal · <code>2026-W31</code> semanal · <code>2026-07-15</code> diário.</p>
        </div>
      </div>
    `;
  }

  function renderCommonsReview(w) {
    const f = w.form;
    const row = (k, v) =>
      v ? `<div class="wizard-review-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>` : '';
    const id = commonsWizardId(f);
    const cadLabel =
      { weekly: 'semanal', monthly: 'mensal', quarterly: 'trimestral', yearly: 'anual' }[f.cadence] || '';
    const mediaCount = (f.mediaFiles || []).length;
    return `
      <h2>Revisão</h2>
      <dl class="wizard-review">
        ${row('Id / link', id ? `/commons/${id}` : '')}
        ${row('Título', f.title)}
        ${row('Resumo', f.summary)}
        ${row('context.md', f.body ? `${f.body.length} caracteres` : '(template padrão)')}
        ${mediaCount ? row('Mídia', `${mediaCount} arquivo(s) — processe a mídia após criar`) : ''}
        ${row('Owner', f.owner)}
        ${cadLabel ? row('Cadência', cadLabel) : ''}
        ${f.serie ? row('Série temporal', `${f.serie}${f.periodo ? ` · ${f.periodo}` : ''}`) : ''}
        ${(f.evalItems || []).length ? row('Itens de avaliação', `${f.evalItems.length}`) : ''}
      </dl>
      <p class="wizard-hint">A cápsula é criada e fica disponível para qualquer skill do balde referenciar por link.</p>
    `;
  }
  function cwGoto(step) {
    const w = state.commonsWizard;
    if (!w) return;
    w.step = step;
    renderShell();
  }
  function cwBack() {
    const w = state.commonsWizard;
    if (!w) return;
    const s = commonsWizardStepList();
    const i = s.indexOf(w.step);
    if (i > 0) {
      w.step = s[i - 1];
      renderShell();
    }
  }
  function cwNext() {
    const w = state.commonsWizard;
    if (!w) return;
    const f = w.form;
    if (w.step === 'general') {
      if (!commonsWizardId(f)) {
        w.error = 'Informe domínio e conceito.';
        renderShell();
        return;
      }
      if (!String(f.title || '').trim()) {
        w.error = 'Informe o título.';
        renderShell();
        return;
      }
    }
    w.error = null;
    const s = commonsWizardStepList();
    const i = s.indexOf(w.step);
    if (i < s.length - 1) {
      w.step = s[i + 1];
      renderShell();
    }
  }
  function cwCancel() {
    const editId = state.commonsWizard && state.commonsWizard.editId;
    state.commonsWizard = null;
    if (editId) {
      // return to the concept in the explorer
      if (!state.explore) state.explore = {};
      state.explore.mode = 'commons';
      state.explore.commonsSelectedPath = editId;
      navigate('explore');
    } else {
      navigate('commons');
    }
  }
  function cwPrefillBody() {
    const w = state.commonsWizard;
    if (!w) return;
    const t = String(w.form.title || '').trim() || 'Conceito';
    const s = String(w.form.summary || '').trim();
    w.form.body = `# ${t}\n\n${s ? `${s}\n\n` : ''}## Definição\n\nDescreva o conceito.\n\n## Como usar\n\nComo uma skill deve aplicar este conceito.`;
    renderShell();
  }
  async function handleCommonsMdFile(fileList) {
    const file = (fileList || [])[0];
    const w = state.commonsWizard;
    if (!file || !w) return;
    try {
      w.form.body = stripFrontmatter(await file.text());
      renderShell();
      toast('context.md carregado.', 'success');
    } catch (error) {
      toast('Falha ao ler o arquivo.', 'warning');
    }
  }
  async function handleCommonsMediaFiles(fileList) {
    const w = state.commonsWizard;
    if (!w) return;
    let added = 0,
      rejected = 0;
    for (const file of Array.from(fileList || [])) {
      const ext = fileExt(file.name);
      const bucket = IMG_EXTS.includes(ext) ? 'img' : ext === 'csv' || ext === 'tsv' ? 'data' : '';
      if (!bucket) {
        rejected += 1;
        continue;
      }
      if (file.size > CONTEXT_MAX_FILE) {
        toast(`${file.name} acima de 3 MB — ignorado.`, 'warning');
        continue;
      }
      try {
        const read = await fileToBase64(file);
        const rel = `${bucket}/${file.name}`;
        w.form.mediaFiles = (w.form.mediaFiles || []).filter((x) => x.relPath !== rel);
        w.form.mediaFiles.push({ relPath: rel, base64: read.base64, size: file.size, description: '' });
        added += 1;
      } catch (error) {
        toast(`Falha ao ler ${file.name}.`, 'warning');
      }
    }
    if (added) toast(`${added} arquivo(s) adicionados.`, 'success');
    if (rejected) toast(`${rejected} arquivo(s) ignorados (só imagens e csv/tsv).`, 'warning');
    renderShell();
  }
  function cwEditMediaPath(oldRel, rawNew) {
    const w = state.commonsWizard;
    if (!w) return;
    const files = w.form.mediaFiles || [];
    const t = files.find((x) => x.relPath === oldRel);
    if (!t) return;
    const clean = String(rawNew || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    const seg = clean.split('/')[0];
    if (seg !== 'img' && seg !== 'data') {
      toast('A mídia deve ficar em img/ ou data/.', 'warning');
      renderShell();
      return;
    }
    if (clean === oldRel) return;
    if (files.some((x) => x !== t && x.relPath === clean)) {
      toast(`Já existe um arquivo em "${clean}".`, 'warning');
      renderShell();
      return;
    }
    t.relPath = clean;
    renderShell();
  }
  function cwRemoveMedia(rel) {
    const w = state.commonsWizard;
    if (!w) return;
    w.form.mediaFiles = (w.form.mediaFiles || []).filter((x) => x.relPath !== rel);
    renderShell();
  }
  // Live-edit a media file's description (no re-render per keystroke, like the path input).
  function cwEditMediaDesc(rel, value) {
    const w = state.commonsWizard;
    if (!w) return;
    const t = (w.form.mediaFiles || []).find((x) => x.relPath === rel);
    if (t) t.description = value;
  }
  // Describe ONE uploaded media file with the BYO AI (stateless /api/media/describe).
  async function cwDescribeMediaOne(item) {
    if (!item || !item.base64) return false;
    const res = await fetch('/api/media/describe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: item.relPath.split('/').pop(), base64: item.base64 })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    item.description = data.description || '';
    return true;
  }
  async function cwDescribeMedia(rel) {
    const w = state.commonsWizard;
    if (!w) return;
    const item = (w.form.mediaFiles || []).find((x) => x.relPath === rel);
    if (!item || !item.base64) return;
    item.describing = true;
    renderShell();
    try {
      await cwDescribeMediaOne(item);
    } catch (error) {
      toast(`Falha ao descrever: ${error.message}`, 'warning');
    }
    item.describing = false;
    renderShell();
  }
  async function cwDescribeAllMedia() {
    const w = state.commonsWizard;
    if (!w) return;
    const items = (w.form.mediaFiles || []).filter((x) => x.base64);
    if (!items.length) return;
    w.form.describingAll = true;
    renderShell();
    let ok = 0,
      fail = 0;
    for (const item of items) {
      try {
        await cwDescribeMediaOne(item);
        ok += 1;
      } catch (error) {
        fail += 1;
      }
    }
    w.form.describingAll = false;
    renderShell();
    toast(`${ok} descrição(ões) gerada(s)${fail ? `, ${fail} falharam` : ''}.`, fail ? 'warning' : 'success');
  }
  function cwAddCurator(raw) {
    const w = state.commonsWizard;
    if (!w) return;
    const e = String(raw || '')
      .trim()
      .toLowerCase();
    if (e.includes('@') && !w.form.curators.includes(e)) w.form.curators.push(e);
    w.form.curatorDraft = '';
    renderShell();
  }
  function cwRemoveCurator(email) {
    const w = state.commonsWizard;
    if (!w) return;
    w.form.curators = w.form.curators.filter((x) => x !== email);
    renderShell();
  }
  function cwAddReader(raw) {
    const w = state.commonsWizard;
    if (!w) return;
    const e = String(raw || '')
      .trim()
      .toLowerCase();
    if (e.includes('@') && !(w.form.readers || []).includes(e)) (w.form.readers = w.form.readers || []).push(e);
    w.form.readerDraft = '';
    renderShell();
  }
  function cwRemoveReader(email) {
    const w = state.commonsWizard;
    if (!w) return;
    w.form.readers = (w.form.readers || []).filter((x) => x !== email);
    renderShell();
  }
  function cwAddEval(raw) {
    const w = state.commonsWizard;
    if (!w) return;
    const c = String(raw || '').trim();
    if (c && !w.form.evalCriteria.includes(c)) w.form.evalCriteria.push(c);
    w.form.evalDraft = '';
    renderShell();
  }
  function cwRemoveEval(crit) {
    const w = state.commonsWizard;
    if (!w) return;
    w.form.evalCriteria = w.form.evalCriteria.filter((x) => x !== crit);
    renderShell();
  }

  async function submitCreateCommons() {
    const w = state.commonsWizard;
    if (!w) return;
    const f = w.form;
    const editing = Boolean(w.editId);
    if (!editing && !commonsWizardId(f)) {
      w.step = 'general';
      w.error = 'Informe domínio e conceito.';
      renderShell();
      return;
    }
    if (!String(f.title || '').trim()) {
      w.step = 'general';
      w.error = 'Informe o título.';
      renderShell();
      return;
    }
    const curators = [...(f.curators || [])];
    const cd = String(f.curatorDraft || '')
      .trim()
      .toLowerCase();
    if (cd.includes('@') && !curators.includes(cd)) curators.push(cd);
    const readers = [...(f.readers || [])];
    const rd = String(f.readerDraft || '')
      .trim()
      .toLowerCase();
    if (rd.includes('@') && !readers.includes(rd)) readers.push(rd);
    w.busy = true;
    w.error = null;
    renderShell();
    try {
      // On EDIT: existing media → existingFiles (kept/renamed); new uploads → files. On CREATE: all
      // media ship their content. The server reconciles the desired media set (delete/rename/add).
      const newMedia = [];
      const existingFiles = [];
      for (const m of f.mediaFiles || []) {
        if (m.existing) {
          existingFiles.push({ relPath: m.relPath, origPath: m.origPath || m.relPath });
        } else if (m.base64) {
          newMedia.push({ relPath: m.relPath, base64: m.base64, description: m.description || '' });
        }
      }
      const payload = {
        domain: f.domain,
        concept: f.concept,
        title: f.title,
        summary: f.summary,
        body: f.body,
        owner: f.owner,
        curators,
        cadence: f.cadence || '',
        visibility: f.visibility === 'restricted' ? 'restricted' : 'public',
        readers,
        serie: f.serie || '',
        periodo: f.periodo || '',
        categoria: f.categoria || 'dado',
        files: newMedia
      };
      let res;
      if (editing) {
        payload.path = w.editId;
        payload.existingFiles = existingFiles;
        res = await fetch('/api/commons/update', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch('/api/commons/new', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        w.busy = false;
        w.error = data.error || `Falha ao ${editing ? 'salvar' : 'criar'} (HTTP ${res.status}).`;
        renderShell();
        return;
      }
      state.commonsWizard = null;
      if (data.id) await persistWizardEval('commons', data.id, f); // Phase 2b: save the eval step
      state.commonsIndex = null; // concept changed — refresh the [[ autocomplete index next time
      await provider.reload();
      await refresh();
      if (editing) {
        toast(`Conceito "${data.id}" atualizado.`, 'success');
        // land on the edited concept in the corpus explorer (commons mode)
        if (!state.explore) state.explore = {};
        state.explore.mode = 'commons';
        state.explore.commonsSelectedPath = data.id;
        state.explore.commonsData = null; // force a fresh list load
        navigate('explore');
      } else {
        toast(`Cápsula "${data.id}" criada.`, 'success');
        navigate('commons');
      }
    } catch (error) {
      if (state.commonsWizard) {
        state.commonsWizard.busy = false;
        state.commonsWizard.error = error.message || 'Erro de rede.';
      }
      renderShell();
    }
  }

  return {
    slugCommonsSegClient,
    initCommonsWizard,
    migrateToCapsule,
    openEditCommons,
    renderCreateCommons,
    cwGoto,
    cwBack,
    cwNext,
    cwCancel,
    cwPrefillBody,
    handleCommonsMdFile,
    handleCommonsMediaFiles,
    cwEditMediaPath,
    cwRemoveMedia,
    cwEditMediaDesc,
    cwDescribeMedia,
    cwDescribeAllMedia,
    cwAddCurator,
    cwRemoveCurator,
    cwAddReader,
    cwRemoveReader,
    cwAddEval,
    cwRemoveEval,
    submitCreateCommons
  };
}
