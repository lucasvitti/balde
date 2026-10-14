export function createIngestionFeature({
  state,
  escapeHtml,
  icon,
  renderShell,
  curatesActiveBalde,
  refreshQueueBadge,
  isBaldeAdmin,
  isCurator,
  roleAllows,
  toast,
  stripFrontmatter,
  initCommonsWizard,
  slugCommonsSegClient,
  navigate,
  readJsonResponse
}) {
  let ingestPollTimer = null;

  function ingestState() {
    if (!state.ingest) state.ingest = { staged: [], jobs: [], job: null, sending: false, error: null };
    return state.ingest;
  }

  function renderIngest() {
    const ig = ingestState();
    const job = ig.job;
    const phasePt = {
      uploading: 'aguardando envio',
      queued: 'na fila',
      extracting: 'extraindo texto',
      analyzing: 'analisando com IA',
      ready: 'pronto',
      materialized: 'materializado',
      error: 'erro'
    };
    const stagedRows = ig.staged
      .map(
        (f, i) =>
          `<tr><td>${escapeHtml(f.name)}</td><td>${(f.size / 1024).toFixed(0)} KB</td><td><button class="ghost-button tiny" data-action="ingestUnstage" data-idx="${i}">remover</button></td></tr>`
      )
      .join('');
    const fileRows = job
      ? job.files
          .map(
            (f) =>
              `<tr><td>${escapeHtml(f.name)}</td><td>${escapeHtml(f.status)}${f.candidates != null ? ` · ${f.candidates} candidato(s)` : ''}</td><td>${f.error ? `<span class="muted">${escapeHtml(f.error)}</span>` : f.aiError ? `<span class="muted">IA: ${escapeHtml(f.aiError)}</span>` : ''}</td></tr>`
          )
          .join('')
      : '';
    const selOf = (cid) => !ig.sel || ig.sel[cid] !== false;
    const canPick = job && job.phase === 'ready';
    const dupesOf = (cid) => (ig.dupes && ig.dupes[cid]) || [];
    const candRows =
      job && job.candidates
        ? job.candidates
            .map(
              (c) => `
      <details class="ingest-cand ${canPick && !selOf(c.id) ? 'ingest-cand-off' : ''}">
        <summary>${canPick ? `<input type="checkbox" data-ingest-sel="${escapeHtml(c.id)}" ${selOf(c.id) ? 'checked' : ''} aria-label="Incluir ${escapeHtml(c.title)}">` : ''}<strong>${escapeHtml(c.title)}</strong> <span class="graph-scope-tag">${escapeHtml(c.type)}</span>${c.periodo ? ` <span class="graph-scope-tag">${escapeHtml(c.periodo)}</span>` : ''}${dupesOf(c.id).length ? ` <span class="dup-badge" title="Possível duplicata no corpus">${icon('alert')}${dupesOf(c.id).length} possível(is) duplicata(s)</span>` : ''} <small class="muted">${escapeHtml((c.sources || []).join(', '))}</small><br><small>${escapeHtml(c.resumo || '')}</small></summary>
        ${dupesOf(c.id).length ? `<div class="dup-panel"><strong>Já existe algo parecido no corpus</strong> — avalie e, para descartar este candidato, desmarque a caixa:${dupMatchList(dupesOf(c.id))}</div>` : ''}
        <pre class="ingest-cand-body">${escapeHtml(c.body || '')}</pre>
      </details>`
            )
            .join('')
        : '';
    return `
      <section class="panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Criar · ingestão</p>
            <h2>Mapear conhecimento bruto</h2>
          </div>
          <div class="section-heading-actions"><button class="ghost-button small" data-view="create">${icon('back')}Voltar</button></div>
        </div>
        <p class="muted">Os documentos viram <strong>candidatos a cápsulas atômicas</strong> para sua revisão. Selecione os candidatos e envie à Fila; o curador revisa e aplica o conteúdo ao corpus.</p>
        ${ig.error ? `<div class="form-alert form-alert-error">${escapeHtml(ig.error)}</div>` : ''}
        ${
          !job
            ? `
        <div class="settings-card">
          <h3>1 · Enviar documentos</h3>
          <p class="muted">Aceita: pdf, docx, xlsx, md, txt, csv, tsv, json, yaml (máx. 10 MB/arquivo, 40 arquivos). Imagens entram como anexo (sem texto na fase 1).</p>
          <input type="file" id="ingest-files" multiple accept=".pdf,.docx,.xlsx,.md,.txt,.csv,.tsv,.json,.yml,.yaml,.png,.jpg,.jpeg,.webp" data-action-change="ingestPick">
          <label class="ingest-guidance">Instruções para a estruturação (opcional)
            <textarea data-ingest-guidance rows="3" placeholder="Ex.: são atas mensais do comitê — crie um episódio por reunião; extraia só decisões e regras, ignore a pauta.">${escapeHtml(ig.guidance || '')}</textarea>
            <span class="field-hint">Vai junto para a IA na análise: guia O QUE extrair e COMO estruturar os candidatos (tipos, granularidade, séries).</span>
          </label>
          ${
            ig.staged.length
              ? `<div class="table-scroll"><table class="mini-table"><tbody>${stagedRows}</tbody></table></div>
          <div class="form-actions"><button class="primary-button small" data-action="ingestSend" ${ig.sending ? 'disabled' : ''}>${icon('plus')}${ig.sending ? 'Enviando…' : `Analisar ${ig.staged.length} arquivo(s)`}</button></div>`
              : ''
          }
        </div>
        ${
          ig.jobs.length
            ? `<div class="settings-card"><h3>Análises anteriores</h3><div class="table-scroll"><table class="mini-table"><thead><tr><th>Job</th><th>Fase</th><th>Arquivos</th><th>Candidatos</th><th></th></tr></thead><tbody>
          ${ig.jobs.map((j) => `<tr><td><code>${escapeHtml(j.id)}</code></td><td>${escapeHtml(phasePt[j.phase] || j.phase)}</td><td>${j.files}</td><td>${j.candidates}</td><td><button class="ghost-button tiny" data-action="ingestOpen" data-job="${escapeHtml(j.id)}">abrir</button> <button class="ghost-button tiny" data-action="ingestDiscard" data-job="${escapeHtml(j.id)}">descartar</button></td></tr>`).join('')}
        </tbody></table></div></div>`
            : ''
        }`
            : `
        <div class="settings-card">
          <h3>Job <code>${escapeHtml(job.id)}</code> — ${escapeHtml(phasePt[job.phase] || job.phase)}</h3>
          ${job.error ? `<div class="form-alert form-alert-error">${escapeHtml(job.error)}</div>` : ''}
          ${job.guidance ? `<p class="muted"><strong>Orientação usada:</strong> ${escapeHtml(job.guidance)}</p>` : ''}
          <div class="table-scroll"><table class="mini-table"><thead><tr><th>Arquivo</th><th>Status</th><th></th></tr></thead><tbody>${fileRows}</tbody></table></div>
          <div class="form-actions">
            <button class="ghost-button small" data-action="ingestBack">${icon('back')}Nova análise</button>
            <button class="ghost-button small" data-action="ingestDiscard" data-job="${escapeHtml(job.id)}">Descartar job</button>
          </div>
        </div>
        ${job.phase === 'ready' ? `<div class="settings-card"><h3>${(job.candidates || []).length} candidato(s) a cápsula</h3>${candRows || '<p class="muted">Nenhum conceito extraído.</p>'}${(job.candidates || []).length ? renderIngestMaterialize(ig, job) : ''}</div>` : ''}
        ${job.phase === 'materialized' ? `<div class="settings-card"><h3>Enviado para a Fila</h3><p>${(job.materializedIds || []).length} cápsula(s) viraram o item <code>${escapeHtml(job.queueId || '')}</code> na <strong>Fila de curadoria</strong> — a aprovação aplica ao corpus.</p><div class="form-actions"><button class="primary-button small" data-view="queue">${icon('check')}Abrir a Fila</button></div>${candRows}</div>` : ''}
        `
        }
      </section>`;
  }

  // G3: turn the SELECTED candidates into one balde-capsule/1 Fila item. The server compiles
  // (atomicity, domains, série/período, creation ACL) and the curator's approval applies.
  // Duplicatas (tier léxico): lista compacta de possíveis duplicatas com score + termos comuns.
  function dupMatchList(matches, { compact = false } = {}) {
    if (!matches || !matches.length) return '';
    return `<ul class="dup-matches ${compact ? 'dup-compact' : ''}">${matches
      .map(
        (m) => `
      <li>
        <span class="dup-score ${m.score >= 0.6 ? 'dup-high' : ''}">${m.exact ? 'idêntico' : `${Math.round(m.score * 100)}%`}</span>
        <span class="graph-scope-tag">${m.kind === 'skill' ? 'skill' : 'cápsula'}</span>
        <button class="linklike" data-action="dupOpenNode" data-node="${escapeHtml(m.id)}">${escapeHtml(m.title || m.id)}</button>
        ${m.terms && m.terms.length ? `<small class="muted">${escapeHtml(m.terms.join(', '))}</small>` : ''}
      </li>`
      )
      .join('')}</ul>`;
  }

  function renderIngestMaterialize(ig, job) {
    const m =
      ig.mat ||
      (ig.mat = {
        domain: '',
        anchorMode: 'none',
        anchorId: '',
        newTitle: '',
        newObjetivo: '',
        busy: false,
        errors: null
      });
    const nSel = (job.candidates || []).filter((c) => !ig.sel || ig.sel[c.id] !== false).length;
    const domains = ig.domains || [];
    const skills = (state.skills || []).map((s) => ({ id: s.id, nome: s.nome || s.id }));
    return `
      <div class="ingest-mat">
        <h4>Materializar no corpus</h4>
        <p class="muted">As cápsulas selecionadas viram <strong>um item na Fila de curadoria</strong> (manifesto balde-capsule/1) — nada é gravado sem aprovação. Rodapé de origem (documento + job) vai em cada cápsula.</p>
        ${m.errors ? `<div class="form-alert form-alert-error">${m.errors.map((e) => `<div><code>${escapeHtml(e.code)}</code> ${escapeHtml(e.message)}</div>`).join('')}</div>` : ''}
        <div class="form-grid">
          <label>Domínio das cápsulas
            <select data-ingest-mat="domain">${['', ...domains].map((d) => `<option value="${escapeHtml(d)}" ${m.domain === d ? 'selected' : ''}>${d ? escapeHtml(d) : 'escolha…'}</option>`).join('')}</select>
          </label>
          <label>Skill âncora
            <select data-ingest-mat="anchorMode">
              <option value="none" ${m.anchorMode === 'none' ? 'selected' : ''}>sem skill (só cápsulas)</option>
              <option value="update" ${m.anchorMode === 'update' ? 'selected' : ''}>vincular numa skill existente</option>
              <option value="create" ${m.anchorMode === 'create' ? 'selected' : ''}>criar skill âncora nova</option>
            </select>
          </label>
          ${
            m.anchorMode === 'update'
              ? `<label>Skill existente
            <select data-ingest-mat="anchorId">${['', ...skills.map((s) => s.id)].map((id) => `<option value="${escapeHtml(id)}" ${m.anchorId === id ? 'selected' : ''}>${id ? escapeHtml((skills.find((s) => s.id === id) || {}).nome || id) : 'escolha…'}</option>`).join('')}</select>
          </label>`
              : ''
          }
          ${
            m.anchorMode === 'create'
              ? `<label>Título da skill nova<input data-ingest-mat="newTitle" value="${escapeHtml(m.newTitle)}"></label>
          <label>Objetivo da skill nova<input data-ingest-mat="newObjetivo" value="${escapeHtml(m.newObjetivo)}"></label>`
              : ''
          }
        </div>
        <div class="form-actions">
          <button class="primary-button small" data-action="ingestMaterialize" ${m.busy || !nSel ? 'disabled' : ''}>${icon('check')}${m.busy ? 'Enviando…' : `Enviar ${nSel} cápsula(s) para a Fila`}</button>
        </div>
      </div>`;
  }

  // Checagem de duplicatas dos candidatos contra o corpus (tier léxico — local e grátis).
  async function ingestCheckDupes() {
    const ig = ingestState();
    const job = ig.job;
    if (!job || job.phase !== 'ready' || !(job.candidates || []).length || ig.dupesFor === job.id) return;
    try {
      const res = await fetch('/api/dedup/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: job.candidates.map((c) => ({ id: c.id, title: c.title, body: c.body })) })
      });
      const data = await res.json();
      if (data.ok) {
        ig.dupes = {};
        for (const r of data.results) if (r.matches.length) ig.dupes[r.id] = r.matches;
        ig.dupesFor = job.id;
      }
    } catch (error) {
      /* sem checagem — segue sem badges */
    }
  }

  async function ingestLoadDomains() {
    const ig = ingestState();
    if (ig.domains) return;
    try {
      const res = await fetch('/api/domains');
      const data = await res.json();
      ig.domains = (data.mine && data.mine.length ? data.mine : data.domains) || [];
    } catch (error) {
      ig.domains = [];
    }
  }

  async function ingestMaterialize() {
    const ig = ingestState();
    const job = ig.job;
    const m = ig.mat || {};
    if (!job || m.busy) return;
    const candidateIds = (job.candidates || []).filter((c) => !ig.sel || ig.sel[c.id] !== false).map((c) => c.id);
    // Text inputs may not have blurred yet — read the DOM's current values before submitting.
    document.querySelectorAll('[data-ingest-mat]').forEach((el) => {
      m[el.dataset.ingestMat] = el.value;
    });
    m.busy = true;
    m.errors = null;
    renderShell();
    try {
      const res = await fetch('/api/ingest/materialize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          candidateIds,
          domain: m.domain,
          anchorMode: m.anchorMode,
          anchorId: m.anchorId,
          newTitle: m.newTitle,
          newObjetivo: m.newObjetivo
        })
      });
      const data = await res.json();
      if (!data.ok) {
        m.errors = data.errors || [{ code: 'erro', message: data.error || 'Falha ao materializar.' }];
      } else {
        const jb = await (await fetch(`/api/ingest/job?id=${encodeURIComponent(job.id)}`)).json();
        if (jb.ok) ig.job = jb.job;
        if (curatesActiveBalde()) {
          refreshQueueBadge().catch(() => {});
        }
      }
    } catch (error) {
      m.errors = [{ code: 'erro', message: error.message }];
    }
    m.busy = false;
    renderShell();
  }

  function ingestEnsurePoll() {
    if (ingestPollTimer) {
      clearInterval(ingestPollTimer);
      ingestPollTimer = null;
    }
    const ig = ingestState();
    if (state.view !== 'ingest' || !ig.job || !['queued', 'extracting', 'analyzing'].includes(ig.job.phase)) return;
    ingestPollTimer = setInterval(async () => {
      if (state.view !== 'ingest' || !ig.job) {
        clearInterval(ingestPollTimer);
        ingestPollTimer = null;
        return;
      }
      try {
        const res = await fetch(`/api/ingest/job?id=${encodeURIComponent(ig.job.id)}`);
        const data = await res.json();
        if (data.ok) {
          ig.job = data.job;
          if (data.job.phase === 'ready') {
            await ingestLoadDomains();
            await ingestCheckDupes();
          }
          renderShell();
          if (!['queued', 'extracting', 'analyzing'].includes(data.job.phase)) {
            clearInterval(ingestPollTimer);
            ingestPollTimer = null;
          }
        }
      } catch (error) {
        /* keep polling */
      }
    }, 2500);
  }

  async function ingestLoadJobs() {
    try {
      const res = await fetch('/api/ingest/jobs');
      const data = await res.json();
      if (data.ok) ingestState().jobs = data.jobs || [];
    } catch (error) {
      /* list stays stale */
    }
  }

  async function ingestSend() {
    const ig = ingestState();
    if (!ig.staged.length || ig.sending) return;
    ig.sending = true;
    ig.error = null;
    renderShell();
    try {
      const created = await (
        await fetch('/api/ingest/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      ).json();
      if (!created.ok) throw new Error(created.error || 'Falha ao criar o job.');
      const jobId = created.job.id;
      for (const f of ig.staged) {
        const b64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1] || '');
          r.onerror = () => reject(new Error(`Falha lendo ${f.name}`));
          r.readAsDataURL(f.file);
        });
        const up = await (
          await fetch('/api/ingest/upload', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jobId, name: f.name, base64: b64 })
          })
        ).json();
        if (!up.ok) throw new Error(`${f.name}: ${up.error}`);
      }
      const st = await (
        await fetch('/api/ingest/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jobId, guidance: ig.guidance || '' })
        })
      ).json();
      if (!st.ok) throw new Error(st.error || 'Falha ao iniciar.');
      ig.staged = [];
      ig.guidance = '';
      const jb = await (await fetch(`/api/ingest/job?id=${encodeURIComponent(jobId)}`)).json();
      ig.job = jb.ok ? jb.job : { id: jobId, phase: 'queued', files: [], candidates: [] };
    } catch (error) {
      ig.error = error.message;
    }
    ig.sending = false;
    renderShell();
    ingestEnsurePoll();
  }

  function renderCreateChooser() {
    // Criar skills e cápsulas é do criador e dos curadores do balde (D1); os demais enviam pela Fila.
    const canCreate = roleAllows('curar');
    return `
      <section class="create-chooser">
        <h2>O que você quer criar?</h2>
        <div class="create-chooser-grid">
          ${
            canCreate
              ? `<button type="button" class="create-chooser-card" data-view="createSkill">
            <span class="chooser-icon chooser-icon-skill" aria-hidden="true"></span>
            <strong>Skill</strong>
            <small>Um módulo de conhecimento governado — SKILL.md + arquivos de contexto (references, analytics, query, img, data) + governança.</small>
          </button>`
              : `<div class="create-chooser-card disabled">
            <span class="chooser-icon chooser-icon-skill" aria-hidden="true"></span>
            <strong>Skill</strong>
            <small>Só o criador e os curadores deste balde criam skills. Sugira pela Fila: Colaborar na skill, Mapear conhecimento bruto ou Importar manifesto.</small>
          </div>`
          }
          ${
            canCreate
              ? `
          <button type="button" class="create-chooser-card" data-view="createCommons">
            <span class="chooser-icon chooser-icon-capsula" aria-hidden="true"></span>
            <strong>Cápsula</strong>
            <small>Uma cápsula compartilhada que qualquer skill referencia por link <code>/commons/&lt;domínio&gt;/&lt;conceito&gt;</code> — context.md + mídia + governança.</small>
          </button>
          <button type="button" class="create-chooser-card" data-action="capsuleImportPick">
            <span class="chooser-icon chooser-icon-capsula" aria-hidden="true"></span>
            <strong>Importar cápsula</strong>
            <small>Já tem o conteúdo pronto? Envie um <code>.md</code> e abrimos o mesmo passo a passo da cápsula com o context.md, o título e o resumo já preenchidos.</small>
          </button>`
              : `
          <div class="create-chooser-card disabled">
            <span class="chooser-icon chooser-icon-capsula" aria-hidden="true"></span>
            <strong>Cápsula</strong>
            <small>Só o criador e os curadores deste balde criam cápsulas. Envie pela Fila: Mapear conhecimento bruto ou Importar manifesto.</small>
          </div>`
          }
          <button type="button" class="create-chooser-card" data-view="ingest">
            <span class="chooser-icon chooser-icon-skill" aria-hidden="true"></span>
            <strong>Mapear conhecimento bruto</strong>
            <small>Envie documentos (PDF, docx, xlsx, markdown, texto, csv) para a IA extrair <strong>candidatos a cápsulas</strong> com fonte. Revise e envie à Fila para curadoria.</small>
          </button>
          <button type="button" class="create-chooser-card" data-view="importManifest">
            <span class="chooser-icon-duo" aria-hidden="true">
              <span class="chooser-icon chooser-icon-skill"></span>
              <span class="chooser-icon-plus">+</span>
              <span class="chooser-icon chooser-icon-capsula"></span>
            </span>
            <strong>Importar manifesto</strong>
            <small>O pacote pronto-para-deploy gerado pelo seu assistente de IA (JSON <code>balde-capsule/1</code>): skill + cápsulas + vínculos. Compila, mostra o plano e envia para a fila de curadoria.</small>
          </button>
        </div>
      </section>
    `;
  }

  function capsuleImportPick() {
    const input = document.createElement('input'); // não vive no DOM: sobrevive aos re-renders
    input.type = 'file';
    input.accept = '.md,.markdown,.txt';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (file) capsuleImportFromFile(file);
    });
    input.click();
  }

  async function capsuleImportFromFile(file) {
    let raw = '';
    try {
      raw = await file.text();
    } catch (error) {
      toast('Falha ao ler o arquivo.', 'warning');
      return;
    }
    const body = stripFrontmatter(raw).trim();
    if (!body) {
      toast('O arquivo está vazio.', 'warning');
      return;
    }
    const h1 = ((body.match(/^#\s+(.+)$/m) || [])[1] || '').trim();
    const baseName = String(file.name || '').replace(/\.[^.]+$/, '');
    const title = (h1 || baseName).slice(0, 120);
    // Resumo sugerido: a primeira linha de prosa (ignora títulos, listas, citações e tabelas).
    const para =
      body
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && !/^[#>\-*+|]/.test(l) && !/^\d+[.)]/.test(l)) || '';
    initCommonsWizard();
    const w = state.commonsWizard;
    w.form.title = title;
    w.form.concept = slugCommonsSegClient(h1 || baseName);
    w.form.summary = para.replace(/[*_`]/g, '').slice(0, 200);
    w.form.body = body;
    await navigate('createCommons'); // mesma trilha do Criar cápsula (carrega domínios, usuários, checklist)
    toast(`"${file.name}" carregado — revise o nome e escolha o domínio.`, 'success');
  }
  // O usuário traz o JSON balde-capsule/1 (gerado pelo assistente dele a partir da spec), o app
  // COMPILA (/api/capsule/compile — nada é gravado), mostra o plano de deploy / os erros, e
  // SUBMETE (/api/capsule/submit) para a fila de curadoria. Aberto a todos os usuários.
  function ensureManifestImport() {
    if (!state.manifestImport) {
      state.manifestImport = {
        fileName: '',
        raw: '',
        compiling: false,
        report: null,
        submitting: false,
        submitted: null
      };
    }
    return state.manifestImport;
  }

  function manifestImportPick() {
    const input = document.createElement('input'); // fora do DOM: sobrevive aos re-renders
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (file) manifestImportFromFile(file);
    });
    input.click();
  }

  async function manifestImportFromFile(file) {
    const m = ensureManifestImport();
    try {
      m.raw = await file.text();
    } catch (error) {
      toast('Falha ao ler o arquivo.', 'warning');
      return;
    }
    m.fileName = file.name || 'manifesto.json';
    m.report = null;
    m.submitted = null;
    renderShell();
    manifestImportCompile(); // compile imediatamente — o relatório é a primeira coisa que o usuário quer ver
  }

  async function manifestImportCompile() {
    const m = ensureManifestImport();
    const ta = document.querySelector('[data-manifest-raw]');
    if (ta) m.raw = ta.value;
    if (!String(m.raw || '').trim()) {
      toast('Cole o JSON do manifesto ou escolha um arquivo.', 'warning');
      return;
    }
    let manifest;
    try {
      manifest = JSON.parse(m.raw);
    } catch (error) {
      m.report = {
        ok: false,
        errors: [{ code: 'formato-invalido', path: '', message: `O texto não é JSON válido: ${error.message}` }],
        warnings: [],
        plan: []
      };
      renderShell();
      return;
    }
    m.compiling = true;
    m.report = null;
    m.submitted = null;
    renderShell();
    try {
      const res = await fetch('/api/capsule/compile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(manifest)
      });
      m.report = await readJsonResponse(res);
    } catch (error) {
      m.report = {
        ok: false,
        errors: [{ code: 'rede', path: '', message: error.message || 'Erro de rede.' }],
        warnings: [],
        plan: []
      };
    }
    m.compiling = false;
    renderShell();
  }

  async function manifestImportSubmit() {
    const m = ensureManifestImport();
    let manifest;
    try {
      manifest = JSON.parse(m.raw);
    } catch (error) {
      toast('O JSON mudou e não é mais válido — recompile.', 'warning');
      return;
    }
    m.submitting = true;
    renderShell();
    try {
      const res = await fetch('/api/capsule/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(manifest)
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok || !data.submitted) {
        // O corpus pode ter mudado desde o compile — mostra o relatório novo no lugar.
        m.report = {
          ok: false,
          errors: data.errors || [{ code: 'falha', path: '', message: data.error || `HTTP ${res.status}` }],
          warnings: data.warnings || [],
          plan: []
        };
        toast('O manifesto não compila mais — veja os erros.', 'warning');
      } else {
        m.submitted = { queueId: data.queueId, plan: data.plan || [] };
        toast(`Cápsula enviada para a fila (${data.queueId}).`, 'success');
        refreshQueueBadge();
      }
    } catch (error) {
      toast(error.message || 'Erro de rede.', 'warning');
    }
    m.submitting = false;
    renderShell();
  }

  function manifestImportReset() {
    state.manifestImport = null;
    renderShell();
  }

  function renderImportManifest() {
    const m = ensureManifestImport();
    const issueList = (items, cls) =>
      `<ul class="capsule-warns ${cls}">${items.map((e) => `<li><code>${escapeHtml(e.code || '')}</code>${e.path ? ` <code class="manifest-issue-path">${escapeHtml(e.path)}</code>` : ''} ${escapeHtml(e.message || '')}</li>`).join('')}</ul>`;
    let reportHtml = '';
    if (m.compiling) {
      reportHtml = '<div class="repo-empty">Compilando…</div>';
    } else if (m.submitted) {
      reportHtml = `
        <div class="queue-decision ok manifest-success">
          ${icon('check')} Enviado para a fila de curadoria — item <code>${escapeHtml(m.submitted.queueId)}</code>. Um curador da skill âncora revisa o plano e a aprovação aplica ao corpus.
          ${m.submitted.plan.length ? `<ul class="capsule-plan">${m.submitted.plan.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
        </div>
        <div class="row-actions">
          <button class="primary-button" data-view="queue">${icon('inbox')}Abrir a Fila</button>
          <button class="ghost-button" data-action="manifestImportReset">${icon('plus')}Importar outro manifesto</button>
        </div>`;
    } else if (m.report) {
      const r = m.report;
      reportHtml = `
        ${
          r.ok
            ? `<div class="manifest-report-head ok">${icon('check')} <strong>Compila limpo.</strong> Revise o plano de deploy e envie para a fila.</div>`
            : `<div class="manifest-report-head err">${icon('x')} <strong>${(r.errors || []).length} erro(s) de compilação.</strong> Corrija no seu assistente (devolva os erros a ele) ou edite o JSON abaixo e recompile.</div>`
        }
        ${(r.errors || []).length ? `<div class="queue-field"><label>Erros</label>${issueList(r.errors, 'manifest-errs')}</div>` : ''}
        ${(r.warnings || []).length ? `<div class="queue-field"><label>Avisos (não bloqueiam)</label>${issueList(r.warnings, '')}</div>` : ''}
        ${r.ok && (r.plan || []).length ? `<div class="queue-field"><label>Plano de deploy — o que a aprovação fará</label><ul class="capsule-plan">${r.plan.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></div>` : ''}
        <div class="row-actions">
          <button class="ghost-button" data-action="manifestImportCompile" ${m.compiling ? 'disabled' : ''}>${icon('spark')}Recompilar</button>
          ${r.ok ? `<button class="primary-button" data-action="manifestImportSubmit" ${m.submitting ? 'disabled' : ''}>${icon('check')}${m.submitting ? 'Enviando…' : 'Enviar para a fila'}</button>` : ''}
        </div>`;
    }
    return `
      <section class="panel manifest-import">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Ingestão · cápsulas de importação</p>
            <h2>Importar manifesto</h2>
          </div>
          <span class="readonly-tag">compila → fila → aprovação aplica</span>
        </div>
        <p class="wizard-hint">Traga o JSON <code>balde-capsule/1</code> gerado pelo seu assistente de IA — a especificação completa (e a receita para o assistente) está em <strong>Documentação › Ingestão de dados</strong>. Compilar não grava nada; o corpus só muda quando um curador aprova o item na Fila.</p>
        <div class="manual-form">
          <div class="row-actions">
            <button class="ghost-button" data-action="manifestImportPick">${icon('upload')}Escolher arquivo .json</button>
            ${m.fileName ? `<span class="manifest-filename">${icon('file')}${escapeHtml(m.fileName)}</span>` : ''}
          </div>
          <label>ou cole o manifesto aqui
            <textarea data-manifest-raw rows="10" spellcheck="false" class="wizard-body manifest-raw" placeholder='{ "format": "balde-capsule/1", ... }'>${escapeHtml(m.raw || '')}</textarea>
          </label>
          ${!m.report && !m.submitted && !m.compiling ? `<div class="row-actions"><button class="primary-button" data-action="manifestImportCompile">${icon('spark')}Compilar</button></div>` : ''}
        </div>
        ${reportHtml}
      </section>
    `;
  }

  return {
    ingestState,
    renderIngest,
    dupMatchList,
    ingestCheckDupes,
    ingestLoadDomains,
    ingestMaterialize,
    ingestEnsurePoll,
    ingestLoadJobs,
    ingestSend,
    renderCreateChooser,
    capsuleImportPick,
    manifestImportPick,
    manifestImportCompile,
    manifestImportSubmit,
    manifestImportReset,
    renderImportManifest
  };
}
