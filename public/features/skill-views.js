export function createSkillViewsFeature({
  state,
  feedbackCounts,
  maturityLabel,
  pluralize,
  icon,
  formatCompact,
  totalMonth,
  escapeHtml,
  formatDate,
  freshnessDot,
  statusPill,
  cssToken,
  getOwners,
  filteredSkills,
  canManageSkill,
  initials,
  deprecationTag,
  qualitySeal,
  renderMarkdownSafe,
  accessInitials,
  renderShell,
  toast
}) {
  function renderDashboard() {
    const totalSkills = Math.max(state.skills.length, 1);
    const canonicas = state.skills.filter((skill) => skill.status === 'canonico').length;
    const rascunhos = state.skills.filter((skill) => skill.status === 'rascunho').length;
    const depreciadas = state.skills.filter((skill) => skill.status === 'depreciado').length;
    const withEval = state.skills.filter((skill) => skill.evals.length > 0).length;
    const evalPct = Math.round((withEval / totalSkills) * 100);
    const reuso = Math.round(
      state.skills.reduce((sum, skill) => sum + (skill.metricas.at(-1)?.reusoPorNaoAutores || 0), 0) / totalSkills
    );
    const attention = state.skills
      .filter(
        (skill) =>
          skill.frescor === 'vermelho' ||
          skill.evalSummary.total === 0 ||
          skill.evalSummary.falhou > 0 ||
          feedbackCounts(skill).errado >= 3
      )
      .sort((a, b) => dashboardRiskScore(b) - dashboardRiskScore(a))
      .slice(0, 5);
    const criticalCount = state.skills.filter((skill) => dashboardRiskScore(skill) >= 3).length;
    const avgQuality = Math.round(
      state.skills.reduce((sum, skill) => sum + (skill.seloQualidade || 0), 0) / totalSkills
    );
    const rawHealthScore = Math.round(
      avgQuality * 0.5 + evalPct * 0.2 + reuso * 0.18 + (canonicas / totalSkills) * 18 - criticalCount * 3
    );
    const healthScore = state.skills.length ? Math.max(32, Math.min(96, rawHealthScore)) : 0;
    const statusMix = [
      { label: 'Canônicas', value: canonicas, className: 'mix-canonico' },
      { label: 'Blueprints', value: rascunhos, className: 'mix-rascunho' },
      { label: 'Depreciadas', value: depreciadas, className: 'mix-depreciado' }
    ];
    const recent = state.skills
      .flatMap((skill) => [
        ...skill.ledger.slice(0, 1).map((item) => ({
          type: 'Versão',
          label: `${skill.nome} publicou ${item.version}`,
          detail: item.resumoMudanca,
          date: item.timestamp
        })),
        ...skill.feedback
          .filter((item) => item.veredito === 'errado')
          .slice(0, 1)
          .map((item) => ({
            type: 'Feedback',
            label: `${skill.nome} recebeu Errado`,
            detail: item.comentario,
            date: item.timestamp
          }))
      ])
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 6);
    const healthLabel = maturityLabel(healthScore);
    const mainAction =
      withEval < state.skills.length
        ? `${pluralize(state.skills.length - withEval, 'skill')} ainda ${state.skills.length - withEval === 1 ? 'sem UAT' : 'sem UAT'}`
        : state.proposals.length
          ? `${pluralize(state.proposals.length, 'proposta')} aguardando validação`
          : 'rotina de revisão em dia';
    const criticalText = criticalCount
      ? `${pluralize(criticalCount, 'skill')} ${criticalCount === 1 ? 'exige' : 'exigem'} ação de governança antes da próxima publicação.`
      : 'Nenhuma skill crítica no momento.';

    return `
      <section class="dashboard-hero">
        <div>
          <p class="eyebrow">Painel executivo</p>
          <h2>Maturidade de governança: ${healthLabel}</h2>
          <p>${criticalText} Próximo foco: ${mainAction}.</p>
          <div class="hero-actions-row">
            <button class="primary-button" data-action="openFilaApprovals">${icon('approvals')}Abrir aprovações</button>
            <button class="ghost-button hero-ghost" data-view="explore">${icon('skills')}Revisar corpus</button>
          </div>
        </div>
        <div class="hero-score" aria-label="Saúde do corpus">
          <strong>${healthScore}</strong>
          <span>/100</span>
          <small>qualidade, evals e adoção</small>
        </div>
        <div class="maturity-scale" aria-hidden="true">
          <span style="--score:${healthScore}%"></span>
          <small>Fundação</small>
          <small>Inicial</small>
          <small>Em evolução</small>
          <small>Avançada</small>
        </div>
      </section>
  
      <div class="dashboard-grid executive-kpis">
        ${kpiCard('Skills governadas', state.skills.length, `${canonicas} canônicas em produção`, 'shield')}
        ${kpiCard('Fila de aprovação', state.proposals.length, 'propostas aguardando owner', 'approvals')}
        ${kpiCard('Cobertura de eval', `${evalPct}%`, `${withEval}/${state.skills.length} com UAT`, 'check')}
        ${kpiCard('Reuso por não-autores', `${reuso}%`, 'sinal de adoção real', 'spark')}
      </div>
  
      <div class="dashboard-main-grid">
        <section class="panel priority-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Prioridade</p>
              <h2>Fila de risco</h2>
            </div>
            <button class="ghost-button" data-view="explore">${icon('skills')}Ver lista</button>
          </div>
          <div class="attention-list">
            ${attention.map(renderAttentionItem).join('') || '<div class="empty-inline">Nenhum risco crítico pendente.</div>'}
          </div>
        </section>
  
        <section class="panel status-panel">
          <div class="section-heading compact">
            <div>
              <p class="eyebrow">Composição</p>
              <h3>Status das skills</h3>
            </div>
          </div>
          <div class="status-meter">
            ${statusMix.map((item) => `<span class="${item.className}" style="--share:${Math.max(4, (item.value / totalSkills) * 100)}%"></span>`).join('')}
          </div>
          <div class="status-breakdown">
            ${statusMix
              .map(
                (item) => `
              <span>
                <i class="${item.className}"></i>
                <strong>${item.value}</strong>
                ${item.label}
              </span>
            `
              )
              .join('')}
          </div>
          <div class="governance-next">
            <span>${icon('alert')} ${pluralize(criticalCount, 'skill crítica', 'skills críticas')}</span>
            <span>${icon('dashboard')} ${formatCompact(totalMonth('execucoes'))} execuções/mês</span>
          </div>
          <p class="data-note">Leitura baseada no corpus local carregado nesta sessão.</p>
        </section>
  
        <section class="panel activity-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Movimento</p>
              <h2>Atividade recente</h2>
            </div>
          </div>
          <div class="activity-list">
            ${recent
              .map(
                (item) => `
              <button class="activity-item">
                <span class="activity-date">${escapeHtml(item.type)} · ${formatDate(item.date)}</span>
                <strong>${escapeHtml(item.label)}</strong>
                <small>${escapeHtml(item.detail)}</small>
              </button>
            `
              )
              .join('')}
          </div>
        </section>
      </div>
    `;
  }

  function kpiCard(label, value, helper, iconName) {
    return `
      <article class="kpi-card">
        <div class="kpi-icon">${icon(iconName)}</div>
        <span>${label}</span>
        <strong>${value}</strong>
        <small>${helper}</small>
      </article>
    `;
  }

  function qualityLabel(score, grade) {
    if (grade) {
      return { A: 'Alta', B: 'Boa', C: 'Atenção', D: 'Baixa' }[grade] || 'Baixa';
    }
    if (score >= 90) {
      return 'Alta';
    }

    if (score >= 75) {
      return 'Boa';
    }

    if (score >= 60) {
      return 'Atenção';
    }

    return 'Baixa';
  }

  function dashboardRiskScore(skill) {
    const counts = feedbackCounts(skill);
    return [
      skill.frescor === 'vermelho' ? 2 : 0,
      skill.evalSummary.total === 0 ? 2 : 0,
      skill.evalSummary.falhou ? 2 : 0,
      counts.errado >= 3 ? 2 : counts.errado ? 1 : 0,
      skill.status === 'rascunho' ? 1 : 0
    ].reduce((sum, value) => sum + value, 0);
  }

  function renderAttentionItem(skill) {
    const counts = feedbackCounts(skill);
    const reasons = [
      skill.frescor === 'vermelho' ? 'revisão vencida' : null,
      skill.evalSummary.total === 0 ? 'sem eval/cases.json' : null,
      skill.evalSummary.falhou ? `${skill.evalSummary.falhou} eval falhando` : null,
      counts.errado >= 3 ? `${counts.errado} feedbacks Errado` : null
    ].filter(Boolean);
    const action =
      skill.evalSummary.total === 0
        ? 'Criar UAT'
        : skill.evalSummary.falhou
          ? 'Corrigir eval'
          : skill.frescor === 'vermelho'
            ? 'Revisar owner'
            : 'Abrir análise';

    return `
      <button class="attention-item" data-skill="${skill.id}">
        <span>${freshnessDot(skill.frescor)}${statusPill(skill.status)}</span>
        <strong>${escapeHtml(skill.nome)}</strong>
        <small>${escapeHtml(reasons.join(' · '))}</small>
        <em>${action}</em>
        <span class="quality-chip quality-chip-${cssToken(qualityLabel(skill.seloQualidade, skill.seloGrade))}">
          <strong>${qualityLabel(skill.seloQualidade, skill.seloGrade)}</strong>
          <small>${skill.seloQualidade}/100</small>
        </span>
      </button>
    `;
  }

  function renderSkills() {
    const readOnly = state.readOnlyBrowse;
    const owners = getOwners();
    let skills = filteredSkills();
    if (!readOnly) {
      // "Suas skills" = the ones you can manage (yours, or all for curadores)
      skills = skills.filter(canManageSkill);
    }

    return `
      <section class="panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">${readOnly ? 'Catálogo · consulta' : 'Seu workspace'}</p>
            <h2>${readOnly ? pluralize(skills.length, 'skill no catálogo', 'skills no catálogo') : pluralize(skills.length, 'skill sua', 'skills suas')}</h2>
          </div>
          ${
            readOnly
              ? '<span class="readonly-tag">Somente leitura</span>'
              : `<div class="row-actions">
                <button class="ghost-button" data-action="openUpload">${icon('upload')}Importar skill</button>
                <button class="primary-button" data-view="createSkill">${icon('edit')}Criar skill</button>
              </div>`
          }
        </div>
        <div class="filters">
          <label>
            Status
            <select data-filter="status">
              ${option('todos', 'Todos', state.filters.status)}
              ${option('canonico', 'Canônico', state.filters.status)}
              ${option('rascunho', 'Blueprint', state.filters.status)}
              ${option('depreciado', 'Depreciado', state.filters.status)}
            </select>
          </label>
          <label>
            Owner
            <select data-filter="owner">
              ${option('todos', 'Todos', state.filters.owner)}
              ${owners.map((owner) => option(owner, owner, state.filters.owner)).join('')}
            </select>
          </label>
          <label>
            Frescor
            <select data-filter="frescor">
              ${option('todos', 'Todos', state.filters.frescor)}
              ${option('verde', 'Verde', state.filters.frescor)}
              ${option('amarelo', 'Amarelo', state.filters.frescor)}
              ${option('vermelho', 'Vermelho', state.filters.frescor)}
            </select>
          </label>
        </div>
        <div class="skill-table" role="table" aria-label="Lista de skills">
          <div class="skill-row skill-head" role="row">
            <span>Skill</span>
            <span>Owner</span>
            <span>Status</span>
            <span>Qualidade</span>
            <span>Versão</span>
            <span>Revisão</span>
          </div>
          ${skills.map(renderSkillRow).join('')}
        </div>
      </section>
    `;
  }

  function option(value, label, current) {
    return `<option value="${escapeHtml(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }

  function renderSkillRow(skill) {
    return `
      <button class="skill-row" role="row" data-skill="${skill.id}">
        <span class="skill-title">
          <strong>${escapeHtml(skill.nome)}</strong>
          <small>${escapeHtml(skill.domain || '')}</small>
        </span>
        <span class="owner-cell">
          <span class="avatar small">${initials(skill.owner)}</span>
          ${escapeHtml(skill.owner.nome)}
        </span>
        <span>${statusPill(skill.status)} ${deprecationTag(skill)} ${freshnessDot(skill.frescor)}</span>
        <span>${qualitySeal(skill.seloQualidade, skill.seloGrade)}</span>
        <span>${escapeHtml(skill.version)}</span>
        <span>${formatDate(skill.lastReviewed)}</span>
      </button>
    `;
  }

  function renderOverview(skill, ex) {
    // The SKILL.md body (frontmatter stripped) comes from the explore bundle (/api/explore/skill).
    const body = ex && ex.bundle && typeof ex.bundle.body === 'string' ? ex.bundle.body : '';
    return `
      <div class="overview-grid">
        <article>
          <p class="eyebrow">Objetivo</p>
          <h3>${escapeHtml(skill.objetivo)}</h3>
        </article>
        <article>
          <p class="eyebrow">Escopo</p>
          <h3>${escapeHtml(skill.escopo)}</h3>
        </article>
      </div>
      <section class="skillmd-view">
        <p class="eyebrow">SKILL.md</p>
        ${body.trim() ? `<div class="commons-doc skillmd-body">${renderMarkdownSafe(body, { corpusLinks: true })}</div>` : '<div class="repo-empty">SKILL.md sem corpo.</div>'}
      </section>
      ${renderSkillMedia(skill)}
    `;
  }

  // Compact skill info strip on the overview: domain · version · AI buddy, plus
  // owner + curator avatars (initials). Curators come from the loaded ACCESS
  // (present when the viewer can manage; otherwise just the owner shows).
  function renderSkillInfoStrip(skill) {
    const buddy = skill.buddyId ? escapeHtml(skill.buddyId) : '—';
    const curators = skill.access && Array.isArray(skill.access.curators) ? skill.access.curators : [];
    const ownerBall = skill.owner
      ? `<span class="avatar small" title="Owner: ${escapeHtml(skill.owner.nome || skill.owner.email || '')}">${escapeHtml(accessInitials(skill.owner))}</span>`
      : '';
    const curatorBalls = curators
      .map(
        (c) =>
          `<span class="avatar small avatar-curator" title="Curador: ${escapeHtml(c)}">${escapeHtml(accessInitials({ email: c }))}</span>`
      )
      .join('');
    return `
      <div class="skill-info-strip">
        <div class="info-item"><small>Domínio</small><span class="tag-chip tag-chip-static">${icon('folder')}${escapeHtml(skill.domain || '—')}</span></div>
        <div class="info-item"><small>Versão</small><strong>v${escapeHtml(skill.version || '0.0.0')}</strong></div>
        <div class="info-item"><small>Criação</small><strong>${escapeHtml(skill.criadoEm || '—')}</strong></div>
        <div class="info-item"><small>AI Buddy</small><strong>${buddy}</strong></div>
        <div class="info-item info-people"><small>Owner · curadores</small><div class="people-avatars">${ownerBall}${curatorBalls}</div></div>
      </div>
    `;
  }

  // Phase 3: a skill's AI-processed media (img/ + data/) shown on the overview — descriptions become
  // context. Loaded via loadSkillMedia (/api/skills/:id/media) when a skill opens; curators (re)process with the button.
  function renderSkillMedia(skill) {
    const sm = state.skillMedia;
    if (!sm || sm.id !== skill.id) return ''; // not loaded yet for this skill
    const media = sm.media || { images: [], data: [], files: [] };
    const imgs = media.images || [];
    const dats = media.data || [];
    const files = media.files || [];
    if (!imgs.length && !dats.length && !files.length) return ''; // no media sidecars
    return `
      <div class="commons-media skill-media">
        <div class="skill-media-head">
          <h4 class="commons-media-h">Mídia (img/ + data/ — vira contexto)</h4>
          ${sm.canManage ? `<small class="muted">${icon('lock')}Somente leitura — processe a mídia em <strong>Editar skill → Arquivos & contexto</strong>.</small>` : ''}
        </div>
        ${imgs.length ? `<div class="media-imgs">${imgs.map((m) => `<figure class="media-img"><img src="/api/skills/${encodeURIComponent(skill.id)}/img?name=${encodeURIComponent(m.name)}" alt="${escapeHtml(m.name)}"><figcaption><strong>${escapeHtml(m.name)}</strong>${m.description ? `<span>${escapeHtml(m.description)}</span>` : '<span class="muted">sem descrição</span>'}</figcaption></figure>`).join('')}</div>` : ''}
        ${dats.length ? dats.map((m) => `<div class="media-data"><div class="media-data-head"><strong>${escapeHtml(m.name)}</strong>${m.description ? ` — ${escapeHtml(m.description)}` : ''}</div>${m.markdown ? `<div class="commons-doc">${renderMarkdownSafe(m.markdown)}</div>` : ''}</div>`).join('') : ''}
        ${files.length ? `<h4 class="commons-media-h">Arquivos</h4><div class="commons-files">${files.map((m) => `<a class="ghost-button small" href="/api/skills/${encodeURIComponent(skill.id)}/file?name=${encodeURIComponent(m.name)}" download>${icon('download')}${escapeHtml(m.name)}${m.size != null ? ` <small>${(m.size / 1024).toFixed(1)} KB</small>` : ''}</a>`).join('')}</div>` : ''}
      </div>
    `;
  }

  async function loadSkillMedia(id) {
    state.skillMedia = { id, media: { images: [], data: [] }, canManage: false, loading: true };
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(id)}/media`);
      const data = await res.json().catch(() => ({}));
      state.skillMedia = {
        id,
        media: (res.ok && data.ok && data.media) || { images: [], data: [] },
        canManage: !!(res.ok && data.ok && data.canManage),
        loading: false
      };
    } catch (error) {
      state.skillMedia = { id, media: { images: [], data: [] }, canManage: false, loading: false };
    }
    if (state.explore && state.explore.selectedId === id) renderShell();
  }

  // Wizard (Editar skill → Arquivos & contexto): process the SAVED skill's img/ + data/ with AI.
  // Same endpoint as the old explorer button — this is now its only UI entry (explorer is read-only).
  async function wizardProcessMedia() {
    const w = state.wizard;
    if (!w || !w.editId || w.form.mediaBusy) return;
    w.form.mediaBusy = true;
    renderShell();
    toast('Processando mídia com IA…');
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(w.editId)}/process-media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      const c = data.counts || { img: {}, data: {} };
      toast(
        `Mídia processada: ${c.img.described || 0} imagem(ns) · ${c.data.described || 0} tabela(s) — descrições viram contexto.`,
        'success'
      );
      if (state.skillMedia && state.skillMedia.id === w.editId) {
        state.skillMedia.media = data.media || state.skillMedia.media;
      } // keep the overview in sync
    } catch (error) {
      toast(error.message || 'Falha ao processar mídia.', 'warning');
    }
    w.form.mediaBusy = false;
    renderShell();
  }
  async function skillProcessMedia(id) {
    if (state.skillMedia && state.skillMedia.id === id) {
      state.skillMedia.processing = true;
      renderShell();
    }
    toast('Processando mídia com IA…');
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(id)}/process-media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      const c = data.counts || { img: {}, data: {} };
      toast(`Mídia processada: ${c.img.described || 0} imagem(ns) · ${c.data.described || 0} tabela(s).`, 'success');
      state.skillMedia = {
        id,
        media: data.media || { images: [], data: [] },
        canManage: !!(state.skillMedia && state.skillMedia.canManage),
        loading: false
      };
      renderShell();
    } catch (error) {
      if (state.skillMedia && state.skillMedia.id === id) state.skillMedia.processing = false;
      toast(error.message || 'Falha ao processar mídia.', 'warning');
      renderShell();
    }
  }

  function metricChart(label, data, key, compact = false) {
    const max = Math.max(1, ...data.map((item) => item[key] || 0));
    return `
      <article class="metric-chart">
        <div class="chart-heading">
          <span>${label}</span>
          <strong>${compact ? formatCompact(data.at(-1)[key]) : data.at(-1)[key]}</strong>
        </div>
        <div class="bars">
          ${data
            .map((item) => {
              const v = item[key] || 0;
              const h = v > 0 ? Math.max(4, (v / max) * 100) : 0;
              return `
            <div class="bar-col">
              <div class="bar-track">
                <span class="bar-value">${compact ? formatCompact(v) : v}</span>
                <span class="bar" style="height:${h}%"></span>
              </div>
              <span class="bar-month">${escapeHtml(item.periodo)}</span>
            </div>`;
            })
            .join('')}
        </div>
      </article>
    `;
  }

  function renderReport(skill) {
    const draftReview = renderDraftReview(skill);
    if (!skill.relatorio) {
      return `
        ${draftReview}
        <div class="empty-state">
          ${icon('spark', 'empty-icon')}
          <h3>Sem análise complementar gerada</h3>
          <p>O rascunho já tem validação prévia; um curador pode rodar a análise sob demanda para sugestões adicionais.</p>
          ${canManageSkill(skill) ? `<button class="primary-button" data-action="runAnalysis" data-id="${skill.id}">${icon('play')}Analisar agora</button>` : ''}
        </div>
      `;
    }

    const report = skill.relatorio;
    return `
      ${draftReview}
      <div class="report-layout">
        <article class="report-summary">
          <p class="eyebrow">Engajamento vs objetivo</p>
          <strong>${report.engajamentoVsObjetivo.usoForaDoObjetivo}% fora do objetivo</strong>
          <p>${escapeHtml(report.engajamentoVsObjetivo.resumo)}</p>
          <small>Gerado em ${formatDate(report.geradoEm)} · ${escapeHtml(report.provider || 'agente')}</small>
        </article>
        <article class="report-summary">
          <p class="eyebrow">Consistência vs eval</p>
          <ul class="plain-list">
            ${report.consistenciaVsEval.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </article>
      </div>
      <div class="suggestions">
        <div class="section-heading compact">
          <div>
            <p class="eyebrow">Sugestões de update</p>
            <h3>Propostas do agente</h3>
          </div>
        </div>
        ${report.sugestoesDeRegra
          .map(
            (item) => `
          <article class="suggestion-card">
            <div>
              <p class="eyebrow">${escapeHtml(item.tipo)}</p>
              <h3>${escapeHtml(item.titulo)}</h3>
              <small>${escapeHtml(item.impacto)}</small>
            </div>
            <div class="diff-view">
              <div><span>Antes</span><p>${escapeHtml(item.antes)}</p></div>
              <div><span>Depois</span><p>${escapeHtml(item.depois)}</p></div>
            </div>
            <small class="muted report-fila-hint">${icon('inbox')}Gerencie esta sugestão na <strong>Fila</strong> (Aprovações) — o corpus é somente leitura.</small>
          </article>
        `
          )
          .join('')}
      </div>
    `;
  }

  function proposalsForSkill(skillId) {
    return state.proposals.filter((proposal) => proposal.skillId === skillId);
  }

  const findingStopWords = new Set([
    'para',
    'como',
    'quando',
    'pela',
    'pelo',
    'essa',
    'esse',
    'esta',
    'este',
    'skill',
    'owner',
    'caso',
    'casos',
    'dados'
  ]);

  const resolvedSuggestionStatuses = new Set(['approved', 'returned', 'rejected']);

  function findingSearchText(finding = {}) {
    return cssToken(
      [finding.title, finding.category, finding.evidence, finding.recommendation].filter(Boolean).join(' ')
    );
  }

  function candidateSearchText(candidate = {}) {
    return cssToken(
      [
        candidate.titulo,
        candidate.title,
        candidate.category,
        candidate.antes,
        candidate.rationale,
        candidate.depois,
        candidate.proposedChange,
        candidate.evalResultado,
        candidate.acceptanceCase,
        candidate.aiFillKind,
        candidate.ai_fill_kind,
        candidate.status,
        candidate.returnReason,
        ...(candidate.blockers || []).map((item) => item.label || item.id)
      ]
        .filter(Boolean)
        .join(' ')
    );
  }

  function findingTokens(finding = {}) {
    return [
      ...new Set(
        findingSearchText(finding)
          .split('-')
          .filter((part) => part.length >= 4 && !findingStopWords.has(part))
      )
    ];
  }

  function scoreFindingCandidate(finding, candidate) {
    const findingText = findingSearchText(finding);
    const candidateText = candidateSearchText(candidate);
    let score = 0;

    findingTokens(finding).forEach((token) => {
      if (candidateText.includes(token)) {
        score += 1;
      }
    });

    if (findingText.includes('eval') && candidateText.includes('eval')) score += 4;
    if (findingText.includes('papel') && candidateText.includes('papel')) score += 4;
    if (findingText.includes('prompt') && candidateText.includes('prompt')) score += 2;
    if (findingText.includes('frontmatter') && candidateText.includes('frontmatter')) score += 4;
    if (findingText.includes('recusa') && candidateText.includes('recusa')) score += 4;
    if (findingText.includes('saudacao') && candidateText.includes('saudacao')) score += 4;
    if (findingText.includes('errado') && candidateText.includes('errado')) score += 3;
    if (
      findingText.includes('feedback') &&
      (candidate.proposalType === 'feedback-change' ||
        candidate.aiFillAvailable === false ||
        candidate.ai_fill_available === false)
    )
      score += 4;

    return score;
  }

  function proposalForFinding(skill, finding, index) {
    const proposals = proposalsForSkill(skill.id);
    if (!proposals.length) {
      return null;
    }

    const scored = proposals
      .map((proposal, proposalIndex) => ({
        proposal,
        proposalIndex,
        score: scoreFindingCandidate(finding, proposal)
      }))
      .sort((a, b) => b.score - a.score || a.proposalIndex - b.proposalIndex);

    return scored[0]?.score > 0 ? scored[0].proposal : proposals[index] || proposals[0];
  }

  function resolvedSuggestionForFinding(skill, finding) {
    const suggestions = (skill.suggestionReview?.suggestions || []).filter(
      (suggestion) => suggestion.shouldApply !== false && resolvedSuggestionStatuses.has(suggestion.status)
    );
    if (!suggestions.length) {
      return null;
    }

    const scored = suggestions
      .map((suggestion, suggestionIndex) => ({
        suggestion,
        suggestionIndex,
        score: scoreFindingCandidate(finding, suggestion)
      }))
      .sort((a, b) => b.score - a.score || a.suggestionIndex - b.suggestionIndex);

    return scored[0]?.score >= 6 ? scored[0].suggestion : null;
  }

  function unresolvedFindings(skill) {
    return (skill.aiReview?.findings || []).filter((finding) => !resolvedSuggestionForFinding(skill, finding));
  }

  function draftReviewSummary(skill, findings) {
    const total = skill.aiReview?.findings?.length || 0;
    const resolved = Math.max(0, total - findings.length);
    if (!resolved) {
      return skill.aiReview.summary;
    }

    if (!findings.length) {
      return `${resolved} apontamento(s) ja registrado(s) pelo owner.`;
    }

    return `Rascunho ainda tem ${findings.length} apontamento(s) pendente(s); ${resolved} ja registrado(s) pelo owner.`;
  }

  function renderFindingActions(skill, finding, index) {
    // Explorar o corpus is read-only — findings are worked via the Fila (Aprovações) / Editar skill.
    return '';
  }

  function renderDraftReview(skill) {
    if (!skill.aiReview) {
      return '';
    }

    const findings = unresolvedFindings(skill);

    return `
      <section class="draft-review">
        <div class="section-heading compact">
          <div>
            <p class="eyebrow">Validação prévia do rascunho</p>
            <h3>${escapeHtml(draftReviewSummary(skill, findings))}</h3>
            <small>${escapeHtml(skill.aiReview.provider)} · score ${skill.aiReview.score}/100</small>
          </div>
        </div>
        <div class="review-grid">
          <article class="checklist-panel">
            <p class="eyebrow">Checklist de boas práticas</p>
            <div class="checklist">
              ${skill.aiReview.checklist
                .map(
                  (item) => `
                <span class="check-${cssToken(item.status)}">
                  ${item.status === 'passou' ? icon('check') : icon('alert')}
                  ${escapeHtml(item.label)}
                </span>
              `
                )
                .join('')}
            </div>
          </article>
          <article class="findings-panel">
            <p class="eyebrow">Apontamentos para o owner</p>
            <div class="finding-list">
              ${
                findings
                  .map(
                    (item, index) => `
                <div class="finding finding-${cssToken(item.severity)}">
                  <span>${escapeHtml(item.severity)} · ${escapeHtml(item.category)}</span>
                  <strong>${escapeHtml(item.title)}</strong>
                  ${item.evidence ? `<small>${escapeHtml(item.evidence)}</small>` : ''}
                  <p>${escapeHtml(item.recommendation)}</p>
                  ${renderFindingActions(skill, item, index)}
                </div>
              `
                  )
                  .join('') || '<p class="empty-inline">Sem apontamentos críticos.</p>'
              }
            </div>
          </article>
        </div>
      </section>
    `;
  }

  return {
    renderDashboard,
    renderSkills,
    option,
    renderOverview,
    renderSkillInfoStrip,
    loadSkillMedia,
    wizardProcessMedia,
    skillProcessMedia,
    metricChart,
    renderReport
  };
}
