export function createMergeFeature({
  escapeHtml,
  state,
  toast,
  computeMergeSeed,
  renderShell,
  icon,
  dupMatchList,
  provider,
  refresh,
  loadNodeEval,
  mergeLoadSelo,
  openFila,
  loadCommonsConcepts,
  linkrefClose,
  skillNameById,
  fileTreeCount,
  buildFileTree,
  renderNodeEval,
  cssToken
}) {
  function diffLcsPairs(a, b) {
    const n = a.length,
      m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const pairs = [];
    let i = 0,
      j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        pairs.push([i, j]);
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
      else j += 1;
    }
    return pairs;
  }
  // Highlight the changed tokens within a modified line pair (whitespace tokens preserved).
  function diffWordHtml(oldLine, newLine) {
    const split = (s) => String(s).split(/(\s+)/);
    const ao = split(oldLine),
      bo = split(newLine);
    const pairs = diffLcsPairs(ao, bo);
    const mA = new Set(pairs.map((p) => p[0])),
      mB = new Set(pairs.map((p) => p[1]));
    const left = ao
      .map((t, k) => (mA.has(k) || !t ? escapeHtml(t) : `<span class="d-del">${escapeHtml(t)}</span>`))
      .join('');
    const right = bo
      .map((t, k) => (mB.has(k) || !t ? escapeHtml(t) : `<span class="d-add">${escapeHtml(t)}</span>`))
      .join('');
    return [left, right];
  }
  // Aligned rows for a side-by-side diff: { type: equal|del|add|change, leftHtml, rightHtml }.
  function diffRows(oldText, newText) {
    const a = String(oldText || '').split('\n'),
      b = String(newText || '').split('\n');
    if (a.length * b.length > 4000000)
      return [{ type: 'note', text: 'Arquivo muito grande para diff visual — revise o texto completo.' }];
    const pairs = diffLcsPairs(a, b);
    const rows = [];
    let i = 0,
      j = 0;
    const flush = (dels, adds) => {
      const k = Math.max(dels.length, adds.length);
      for (let x = 0; x < k; x += 1) {
        const l = x < dels.length ? dels[x] : null,
          r = x < adds.length ? adds[x] : null;
        if (l != null && r != null) {
          const [lh, rh] = diffWordHtml(l, r);
          rows.push({ type: 'change', leftHtml: lh, rightHtml: rh });
        } else if (l != null) rows.push({ type: 'del', leftHtml: escapeHtml(l), rightHtml: '' });
        else rows.push({ type: 'add', leftHtml: '', rightHtml: escapeHtml(r) });
      }
    };
    for (const [pi, pj] of pairs) {
      const dels = [],
        adds = [];
      while (i < pi) dels.push(a[i++]);
      while (j < pj) adds.push(b[j++]);
      flush(dels, adds);
      rows.push({ type: 'equal', leftHtml: escapeHtml(a[pi]), rightHtml: escapeHtml(b[pj]) });
      i = pi + 1;
      j = pj + 1;
    }
    const dels = [],
      adds = [];
    while (i < a.length) dels.push(a[i++]);
    while (j < b.length) adds.push(b[j++]);
    flush(dels, adds);
    return rows;
  }
  function renderDiffTable(oldText, newText) {
    const rows = diffRows(oldText, newText);
    const body = rows
      .map((r) => {
        if (r.type === 'note') return `<tr class="diff-note"><td colspan="2">${escapeHtml(r.text)}</td></tr>`;
        const lc = r.type === 'del' || r.type === 'change' ? ' diff-del' : '';
        const rc = r.type === 'add' || r.type === 'change' ? ' diff-add' : '';
        return `<tr><td class="diff-cell${lc}">${r.leftHtml || '&nbsp;'}</td><td class="diff-cell${rc}">${r.rightHtml || '&nbsp;'}</td></tr>`;
      })
      .join('');
    return `<div class="diff-scroll"><table class="diff-table"><tbody>${body}</tbody></table></div>`;
  }
  function mergeStart(id) {
    const q = state.queue;
    const item = q && q.detail && q.detail.id === id ? q.detail : null;
    if (!item) {
      toast('Abra a contribuição primeiro.', 'warning');
      return;
    }
    const content = (q.editContent != null ? q.editContent : computeMergeSeed(item)) || String(item.content || '');
    openMergeWizard(item.id, item.skillId, content);
  }
  function openMergeWizard(itemId, skillId, content, mode, requirement) {
    const m = mode === 'promotion' ? 'promotion' : 'merge';
    state.mergeWizard = {
      itemId: itemId || null,
      skillId: skillId || '',
      content: String(content || ''),
      mode: m,
      stage: m === 'promotion' ? 'revisao' : 'contexto',
      analyzing: false,
      analysis: null,
      error: null,
      changes: [],
      fileIdx: 0,
      openFolders: new Set(),
      requirement: requirement || null,
      loadingContext: m === 'promotion',
      writing: false,
      applying: false,
      applyError: null
    };
    state.view = 'mergeReview';
    renderShell();
    if (m === 'promotion') mergeLoadContext(); // seed Revisão with the skill's current files (editable)
  }
  // Promote a draft to canonical: carry the approval's own "what's pending" (blockers + recommendation)
  // into the wizard so the curator keeps seeing it in the file explorer, not just on the card they left.
  function mergePromote(skillId) {
    const p = (state.proposals || []).find((x) => x.skillId === skillId && x.proposalType !== 'feedback-change');
    const requirement = p
      ? {
          titulo: p.titulo,
          antes: p.antes,
          depois: p.depois,
          evalResultado: p.evalResultado,
          blockers: (p.blockers || []).map((b) => b.label).filter(Boolean),
          canPromote: p.canPromote
        }
      : null;
    openMergeWizard(null, skillId, '', 'promotion', requirement);
  }
  // Load a skill's current files into the wizard's changes[] so a promotion can edit them (no diff yet — a
  // change only "counts" once the curator edits it, so mergeWriteAndEval writes only what actually changed).
  async function mergeLoadContext() {
    const w = state.mergeWizard;
    if (!w) return;
    try {
      const res = await fetch(`/api/merge/context?skillId=${encodeURIComponent(w.skillId)}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      w.changes = (d.files || []).map((f) => ({
        scope: f.scope,
        path: String(f.path).replaceAll('\\', '/'),
        action: 'update',
        reason: '',
        oldContent: f.content,
        curatorContent: f.content,
        decision: 'accept',
        editing: false
      }));
      w.fileIdx = 0;
      w.loadingContext = false;
      renderShell();
      mergeCheckDupes(); // governança: duplicatas contra o corpus, sem bloquear o carregamento
    } catch (error) {
      w.loadingContext = false;
      w.error = error.message;
      renderShell();
    }
  }
  // Governança na promoção: a skill em revisão comparada ao corpus (tier léxico, local).
  // Exclui a própria skill; o painel aparece no passo Revisão quando há algo parecido.
  async function mergeCheckDupes() {
    const w = state.mergeWizard;
    if (!w || !w.skillId) return;
    const skillMd = (w.changes || []).find((c) => String(c.path).toLowerCase() === 'skill.md');
    if (!skillMd) return;
    const sk = (state.skills || []).find((s) => s.id === w.skillId);
    try {
      const res = await fetch('/api/dedup/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: [{ id: 'promo', title: (sk && sk.nome) || w.skillId, body: skillMd.curatorContent }],
          excludeLinkedOf: w.skillId
        })
      });
      const data = await res.json();
      if (data.ok && state.mergeWizard === w) {
        w.dupes = ((data.results || [])[0] || {}).matches || [];
        if (w.dupes.length) renderShell();
      }
    } catch (error) {
      /* sem checagem — a promoção segue */
    }
  }

  function renderMergeDupPanel(w) {
    const matches = w.dupes || [];
    if (!matches.length) return '';
    return `<div class="dup-panel">
      <strong>${icon('alert')} Possíveis duplicatas no corpus</strong> — antes de publicar, confira se este conhecimento já existe (complemente ou vincule em vez de duplicar):
      ${dupMatchList(matches)}
    </div>`;
  }

  function mergeClose() {
    state.mergeWizard = null;
    state.view = 'queue';
    renderShell();
  }
  async function mergeWriteAndEval(target = 'governanca') {
    const w = state.mergeWizard;
    if (!w) return false;
    const pending = (w.changes || []).filter(
      (c) => c.decision !== 'skip' && String(c.curatorContent) !== String(c.oldContent)
    );
    const accepted = pending.map((c) => ({ scope: c.scope, path: c.path, content: c.curatorContent }));
    w.writing = true;
    w.error = null;
    renderShell();
    try {
      if (accepted.length) {
        const res = await fetch('/api/merge/write', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ skillId: w.skillId, changes: accepted })
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
        // O que foi gravado vira a nova linha de base: voltar à Revisão e seguir não regrava (nem
        // gera commit) o mesmo conteúdo; só uma edição NOVA volta a contar como pendente.
        for (const c of pending) c.oldContent = c.curatorContent;
      }
      w.writing = false;
      w.stage = target;
      await provider.reload();
      await refresh(); // reflect the merged content
      if (accepted.length) loadNodeEval('skill', w.skillId); // verdicts were reset server-side
      if (target === 'aplicar') mergeLoadSelo();
      else renderShell();
      return true;
    } catch (error) {
      w.writing = false;
      w.error = error.message;
      renderShell();
      return false;
    }
  }
  async function mergePublish() {
    const w = state.mergeWizard;
    if (!w || w.applying) return;
    w.operationId ||= crypto.randomUUID();
    w.applying = true;
    w.applyError = null;
    renderShell();
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          skillId: w.skillId,
          operationId: w.operationId,
          queueItemId: w.mode === 'merge' ? w.itemId : null
        })
      });
      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || `HTTP ${res.status}`);
      toast(result.queueClosed ? 'Publicado; contribuição concluída.' : 'Publicado como canônica.', 'success');
      state.mergeWizard = null;
      state.view = 'queue';
      // Volta à lista da Fila, não ao item recém-resolvido: os pendentes que restam ficam à vista.
      if (state.fila) state.fila.selected = null;
      await provider.reload();
      await refresh();
      await openFila();
    } catch (error) {
      w.applying = false;
      w.applyError = `${error.message} Você pode tentar novamente sem repetir uma publicação já concluída.`;
      renderShell();
    }
  }

  async function mergeAnalyse() {
    const w = state.mergeWizard;
    if (!w) return;
    if (!w.skillId) {
      w.error = 'Escolha a skill de destino.';
      renderShell();
      return;
    }
    if (!String(w.content).trim()) {
      w.error = 'Sem conteúdo para analisar.';
      renderShell();
      return;
    }
    w.analyzing = true;
    w.error = null;
    renderShell();
    toast('Analisando com IA…');
    try {
      const res = await fetch('/api/merge/analyse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillId: w.skillId, content: w.content })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      w.analysis = d.analysis || { changes: [] };
      w.changes = (w.analysis.changes || []).map((c) => ({
        scope: c.scope,
        path: String(c.path).replaceAll('\\', '/'),
        action: c.action,
        reason: c.reason || '',
        oldContent: c.oldContent || '',
        curatorContent: c.newContent || '',
        decision: 'accept',
        editing: false
      }));
      w.fileIdx = 0;
      w.analyzing = false;
      w.openFolders = new Set(w.changes.flatMap((c) => mergeAncestors(c.path))); // few AI-proposed files → show them all expanded
      if (!w.changes.length) {
        w.error = 'A IA não propôs nenhuma mudança. Ajuste o texto ou tente outra skill.';
        renderShell();
        return;
      }
      w.stage = 'revisao';
      renderShell();
    } catch (error) {
      w.analyzing = false;
      w.error = error.message;
      renderShell();
    }
  }
  function mergeSelectFile(i) {
    const w = state.mergeWizard;
    if (!w) return;
    w.fileIdx = Number(i);
    renderShell();
  }
  function mergeToggleEdit() {
    const w = state.mergeWizard;
    const c = w && w.changes[w.fileIdx];
    if (!c) return;
    w.editorOpen = true;
    loadCommonsConcepts();
    renderShell();
  }
  function mergeCloseEditor() {
    const w = state.mergeWizard;
    if (!w) return;
    w.editorOpen = false;
    linkrefClose();
    renderShell();
  }
  function mergeSkipFile() {
    const w = state.mergeWizard;
    const c = w && w.changes[w.fileIdx];
    if (!c) return;
    c.decision = c.decision === 'skip' ? 'accept' : 'skip';
    renderShell();
  }
  // Navegação livre entre etapas (as abas de topo andam para frente E para trás). Sair da Revisão
  // grava o que foi editado — o passo de gravação não pode ser pulado por navegação.
  async function mergeGoto(stage) {
    const w = state.mergeWizard;
    if (!w || w.writing) return;
    if (w.editorOpen) {
      w.editorOpen = false;
      linkrefClose();
    } // sair da edição ao trocar de etapa
    if (w.stage === 'revisao' && stage !== 'revisao' && stage !== 'contexto') {
      const pending = (w.changes || []).some(
        (c) => c.decision !== 'skip' && String(c.curatorContent) !== String(c.oldContent)
      );
      if (pending) {
        await mergeWriteAndEval(stage);
        return;
      }
    }
    w.stage = stage;
    if (stage === 'aplicar') {
      mergeLoadSelo();
      return;
    } // mergeLoadSelo já renderiza
    renderShell();
  }

  const MERGE_STAGES = [
    ['contexto', 'Contexto'],
    ['revisao', 'Revisão'],
    ['governanca', 'Governança'],
    ['casos', 'Casos de uso'],
    ['aplicar', 'Aplicar']
  ];
  function renderMergeWizard() {
    const w = state.mergeWizard;
    if (!w) {
      state.view = 'queue';
      return '<div class="repo-empty">—</div>';
    }
    const stages = w.mode === 'promotion' ? MERGE_STAGES.filter(([k]) => k !== 'contexto') : MERGE_STAGES;
    const stageIdx = stages.findIndex(([k]) => k === w.stage);
    // Em modo merge, as etapas seguintes só existem depois que a IA propôs mudanças.
    const locked = (k) => w.mode === 'merge' && k !== 'contexto' && !(w.changes || []).length;
    const steps = stages
      .map(
        ([k, label], i) =>
          `<button class="merge-step ${w.stage === k ? 'active' : ''} ${i < stageIdx ? 'done' : ''}" data-action="mergeGoto" data-stage="${k}" ${locked(k) ? 'disabled title="Analise o conteúdo primeiro"' : ''}>${i + 1}. ${label}</button>`
      )
      .join('');
    const body =
      w.stage === 'contexto'
        ? renderMergeContexto(w)
        : w.stage === 'revisao'
          ? renderMergeRevisao(w)
          : w.stage === 'governanca'
            ? renderMergeGovernanca(w)
            : w.stage === 'casos'
              ? renderMergeCasos(w)
              : renderMergeAplicar(w);
    return `
      <section class="panel merge-wizard">
        <div class="section-heading">
          <div><p class="eyebrow">Revisar e mesclar</p><h2>${escapeHtml(skillNameById(w.skillId) || 'Contribuição')}</h2></div>
          <button class="ghost-button" data-action="mergeClose">${icon('x')}Fechar</button>
        </div>
        <div class="merge-steps">${steps}</div>
        ${w.error ? `<div class="form-alert form-alert-error">${escapeHtml(w.error)}</div>` : ''}
        ${body}
      </section>`;
  }
  function renderMergeContexto(w) {
    const opts = (state.skills || [])
      .map(
        (s) =>
          `<option value="${escapeHtml(s.id)}" ${s.id === w.skillId ? 'selected' : ''}>${escapeHtml(s.nome)}</option>`
      )
      .join('');
    return `
      <p class="queue-intro">A IA vai analisar onde este conhecimento entra na skill (e nas cápsulas ligadas), classificar cada mudança como <strong>adição</strong> ou <strong>atualização</strong>, e propor um <strong>diff</strong> por arquivo para você revisar.</p>
      <div class="manual-form">
        <label>Skill de destino <span class="field-hint">o usuário pode ter marcado a skill errada — confirme</span>
          <select data-merge-field="skillId">${opts}</select>
        </label>
        <label>Conhecimento a integrar
          <textarea data-merge-field="content" rows="8">${escapeHtml(w.content || '')}</textarea>
        </label>
      </div>
      <div class="row-actions">
        <button class="primary-button" data-action="mergeAnalyse" ${w.analyzing ? 'disabled' : ''}>${icon('spark')}${w.analyzing ? 'Analisando…' : 'Analisar'}</button>
      </div>`;
  }
  // Ancestor folder paths of a file path ("a/b/c.md" → ["a","a/b"]) — used to pre-expand the tree.
  function mergeAncestors(path) {
    const parts = String(path).split('/');
    const out = [];
    for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(0, i + 1).join('/'));
    return out;
  }
  // Sidebar file list as a collapsible tree (mirrors the corpus Explorar view), but leaves carry merge
  // state: active/edited/skip + a novo/editado/atualiza/ignorado badge. Selection is by change index.
  function renderMergeTreeNodes(node, w, pathIndex, openFolders, prefix, depth) {
    let html = '';
    const folderNames = [...node.folders.keys()].sort((a, b) => a.localeCompare(b));
    for (const name of folderNames) {
      const folderPath = prefix ? `${prefix}/${name}` : name;
      const child = node.folders.get(name);
      const isOpen = openFolders.has(folderPath);
      html += `<button class="folder-node ${isOpen ? 'is-open' : ''}" data-action="mergeToggleFolder" data-folder="${escapeHtml(folderPath)}" style="--depth:${depth}" title="${escapeHtml(name)}">${icon('chevron', 'folder-caret')}${icon('folder')}<span>${escapeHtml(name)}</span><small>${fileTreeCount(child)}</small></button>`;
      if (isOpen) html += renderMergeTreeNodes(child, w, pathIndex, openFolders, folderPath, depth + 1);
    }
    for (const f of node.files.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      const i = pathIndex.get(f.path);
      const c = w.changes[i];
      if (!c) continue;
      const promo = w.mode === 'promotion';
      const edited = String(c.curatorContent) !== String(c.oldContent);
      const skip = !promo && c.decision === 'skip';
      let badgeText = '',
        badgeCls = 'is-edit';
      if (c.action === 'create') {
        badgeText = 'novo';
        badgeCls = 'is-new';
      } else if (skip) {
        badgeText = 'ignorado';
        badgeCls = 'is-skip';
      } else if (promo) {
        if (edited) badgeText = 'editado';
      } else {
        badgeText = 'atualiza';
      }
      const badge = badgeText ? `<small class="merge-file-badge ${badgeCls}">${badgeText}</small>` : '';
      const cls = [
        'file-node',
        'merge-file-node',
        i === w.fileIdx ? 'active' : '',
        promo && edited ? 'is-edited' : '',
        skip ? 'is-skip' : ''
      ]
        .filter(Boolean)
        .join(' ');
      html += `<button class="${cls}" data-merge-file="${i}" style="--depth:${depth}" title="${escapeHtml(f.path)}">${icon('file')}<span>${escapeHtml(f.name)}</span>${c.scope === 'commons' ? '<small class="merge-file-tag">cápsula</small>' : ''}${badge}</button>`;
    }
    return html;
  }
  // Persistent "what to change" panel: on promotion, the approval's pending requirements + recommendation
  // (so it doesn't vanish when the curator enters the file explorer); on merge, the knowledge being integrated.
  function renderMergeGuidance(w) {
    if (w.mode === 'promotion') {
      const r = w.requirement;
      if (!r) return '';
      const blockers = (r.blockers || []).filter(Boolean);
      const depois = String(r.depois || '').trim();
      const antes = String(r.antes || '').trim();
      const hasDepois = depois && depois.toLowerCase() !== 'em aberto';
      const hasAntes = antes && antes.toLowerCase() !== 'em aberto';
      if (!blockers.length && !hasDepois && !hasAntes) return '';
      return `<div class="merge-guidance">
        <div class="merge-guidance-head">${icon('alert')}O que precisa mudar para publicar</div>
        ${blockers.length ? `<div class="merge-guidance-block"><small>Requisitos pendentes</small><ul>${blockers.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul></div>` : ''}
        ${hasDepois ? `<div class="merge-guidance-block"><small>Recomendação</small><p>${escapeHtml(depois)}</p></div>` : ''}
        ${hasAntes ? `<div class="merge-guidance-block"><small>Situação atual</small><p>${escapeHtml(antes)}</p></div>` : ''}
      </div>`;
    }
    const content = String(w.content || '').trim();
    const summary = w.analysis && w.analysis.summary ? String(w.analysis.summary).trim() : '';
    if (!content && !summary) return '';
    return `<div class="merge-guidance">
      <div class="merge-guidance-head">${icon('spark')}Conhecimento a integrar</div>
      ${summary ? `<div class="merge-guidance-block"><small>Resumo da IA</small><p>${escapeHtml(summary)}</p></div>` : ''}
      ${content ? `<div class="merge-guidance-block"><small>Texto original</small><pre class="merge-guidance-pre">${escapeHtml(content.slice(0, 4000))}${content.length > 4000 ? '\n…' : ''}</pre></div>` : ''}
    </div>`;
  }
  // Top action bar for a wizard stage — kept at the top so it's never lost below a long file diff / eval list.
  // Navegação por etapa: Voltar/Continuar em cima (as abas de topo fazem o mesmo, em qualquer ordem).
  function renderMergeNav(w, stage) {
    const promo = w.mode === 'promotion';
    const cancel = '<button class="ghost-button" data-action="mergeClose">Cancelar</button>';
    const backTo = (target, label = 'Voltar') =>
      `<button class="ghost-button" data-action="mergeGoto" data-stage="${target}">${label}</button>`;
    if (stage === 'revisao') {
      const changes = w.changes || [];
      const disabled = w.writing
        ? 'disabled'
        : !promo && changes.length && changes.every((x) => x.decision === 'skip')
          ? 'disabled title="Inclua ao menos um arquivo"'
          : '';
      return `<div class="row-actions merge-nav merge-nav-top">${promo ? cancel : backTo('contexto')}<button class="primary-button" data-action="mergeWriteAndEval" ${disabled}>${w.writing ? 'Gravando…' : 'Continuar para Governança'}</button></div>`;
    }
    if (stage === 'governanca') {
      return `<div class="row-actions merge-nav merge-nav-top">${backTo('revisao')}<button class="primary-button" data-action="mergeGoto" data-stage="casos">Continuar para Casos de uso</button></div>`;
    }
    if (stage === 'casos') {
      const overall =
        state.nodeEval && state.nodeEval.nodeType === 'skill' && state.nodeEval.id === w.skillId && state.nodeEval.data
          ? state.nodeEval.data.overall
          : 'pending';
      return `<div class="row-actions merge-nav merge-nav-top">${backTo('governanca')}<button class="primary-button" data-action="mergeGoto" data-stage="aplicar">${overall === 'pass' ? 'Continuar para Aplicar' : 'Ver Aplicar (gate pendente)'}</button></div>`;
    }
    return '';
  }
  function renderMergeRevisao(w) {
    if (w.loadingContext) return '<div class="queue-detail-empty">Carregando arquivos da skill…</div>';
    const changes = w.changes || [];
    const promo = w.mode === 'promotion';
    if (!(w.openFolders instanceof Set)) w.openFolders = new Set();
    const pathIndex = new Map(changes.map((c, i) => [c.path, i]));
    const tree = changes.length
      ? renderMergeTreeNodes(buildFileTree(changes.map((c) => ({ path: c.path }))), w, pathIndex, w.openFolders, '', 0)
      : '<p class="queue-empty">Nenhum arquivo.</p>';
    const c = changes[w.fileIdx];
    const unchanged = c && String(c.curatorContent) === String(c.oldContent);
    // O editor é uma "aba" própria (mesma experiência do passo SKILL.md do wizard): página
    // dedicada com linkref ([[ cápsula, [[[ skill), contador e botões de vínculo. O conteúdo
    // sincroniza ao digitar — "Concluir edição" volta à revisão (os diffs refletem na hora).
    if (w.editorOpen && c) {
      const isMd = /\.md$/i.test(c.path);
      return `
      ${renderMergeNav(w, 'revisao')}
      <div class="merge-editor-page">
        <h2>${icon('edit')}Editando · <code>${escapeHtml(c.path)}</code></h2>
        ${isMd ? `<p class="wizard-hint">Digite <code>[[</code> para vincular uma <strong>cápsula</strong> e <code>[[[</code> para uma <strong>skill</strong>. O que você digitar já vale — "Concluir edição" volta para a revisão com o diff atualizado.</p>` : `<p class="wizard-hint">O que você digitar já vale — "Concluir edição" volta para a revisão com o diff atualizado.</p>`}
        <div class="manual-form">
          <label>Conteúdo<textarea data-merge-edit rows="22" spellcheck="false" class="wizard-body">${escapeHtml(c.curatorContent)}</textarea></label>
          <div class="wizard-charcount"><span data-merge-charcount>${String(c.curatorContent || '').length}</span> caracteres</div>
          ${isMd ? `<div class="row-actions"><button class="ghost-button small" type="button" data-action="mergeVincularCommons">${icon('library')}+ cápsula</button> <button class="ghost-button small" type="button" data-action="mergeVincularSkill">${icon('lightbulb')}+ skill</button></div>` : ''}
        </div>
        <div class="row-actions merge-nav-top">
          <button class="primary-button" data-action="mergeCloseEditor">${icon('check')}Concluir edição</button>
        </div>
      </div>`;
    }
    const detail = c
      ? `
      <p class="queue-item-sub">${c.action === 'create' ? 'Novo arquivo' : promo ? 'Arquivo atual' : 'Atualização'} · <code>${escapeHtml(c.path)}</code>${c.reason ? ` — ${escapeHtml(c.reason)}` : ''}</p>
      ${
        promo && unchanged
          ? `<pre class="queue-original">${escapeHtml(String(c.curatorContent).slice(0, 20000))}</pre>`
          : renderDiffTable(c.oldContent, c.curatorContent)
      }
      <div class="row-actions">
        <button class="ghost-button small" data-action="mergeToggleEdit">${icon('edit')}${promo ? 'Editar arquivo' : 'Editar proposta'}</button>
        ${!promo ? `<button class="ghost-button small" data-action="mergeSkipFile">${c.decision === 'skip' ? 'Reincluir' : 'Ignorar este arquivo'}</button>` : ''}
      </div>`
      : '<div class="queue-detail-empty">Sem arquivo.</div>';
    const intro = promo
      ? 'Revise e <strong>edite os arquivos</strong> da skill se precisar (ex.: completar o frontmatter). O que você não alterar fica como está.'
      : '';
    return `
      ${renderMergeNav(w, 'revisao')}
      ${intro ? `<p class="queue-intro">${intro}</p>` : ''}
      ${renderMergeGuidance(w)}
      ${renderMergeDupPanel(w)}
      <div class="merge-layout">
        <aside class="file-tree merge-tree">${tree}</aside>
        <div class="merge-detail">${detail}</div>
      </div>`;
  }
  function renderMergeGovernanca(w) {
    const intro =
      w.mode === 'promotion'
        ? 'Esta skill é um <strong>rascunho</strong>. Para publicar, o <strong>gate de governança</strong> precisa passar: a IA aprova cada item obrigatório — ou um curador aceita (aceite forçado, que reduz o Selo).'
        : 'As mudanças foram gravadas na skill — <strong>reavalie o conteúdo novo</strong>: rode a avaliação e aceite cada item obrigatório. Precisa passar para publicar.';
    return `
      ${renderMergeNav(w, 'governanca')}
      <p class="queue-intro">${intro}</p>
      ${renderMergeGuidance(w)}
      ${renderNodeEval('skill', w.skillId, true, { only: 'obrigatorios', fixAction: { action: 'mergeGoto', dataset: { stage: 'revisao' }, label: 'Ir para Revisão' } })}`;
  }
  function renderMergeCasos(w) {
    return `
      ${renderMergeNav(w, 'casos')}
      <p class="queue-intro">Os <strong>casos de uso</strong> da skill: eles não travam a publicação, mas contam para o <strong>Selo</strong>. <strong>Testar caso</strong> responde a pergunta usando a skill como contexto (igual ao chat) e julga a resposta.</p>
      ${renderNodeEval('skill', w.skillId, true, { only: 'casos', fixAction: { action: 'mergeGoto', dataset: { stage: 'revisao' }, label: 'Ir para Revisão' } })}`;
  }
  // Barra do Selo projetado: cada dimensão 0–100 com o peso que ela tem na nota final.
  function renderSeloEstimate(w) {
    if (w.seloLoading) return '<div class="queue-detail-empty">Estimando o selo…</div>';
    if (w.seloError) return `<div class="form-alert form-alert-error">${escapeHtml(w.seloError)}</div>`;
    const s = w.selo;
    if (!s || !s.selo) return '';
    const det = s.selo.detalhe || {};
    const weights = s.weights || {};
    const dims = [
      ['casos', 'Casos de uso'],
      ['validacao', 'Validação'],
      ['governanca', 'Governança'],
      ['clareza', 'Clareza'],
      ['frescor', 'Frescor']
    ];
    const atual = (state.skills || []).find((x) => x.id === w.skillId);
    const delta = atual && typeof atual.seloQualidade === 'number' ? s.selo.total - atual.seloQualidade : null;
    return `
      <div class="selo-estimate">
        <div class="selo-estimate-head">
          <div><p class="eyebrow">Selo estimado se publicar agora</p><h3><strong class="selo-estimate-total">${s.selo.total}</strong><span class="muted">/100</span> <span class="quality-chip quality-chip-${cssToken(s.selo.grade)}">${escapeHtml(s.selo.grade)}</span>${delta !== null && delta !== 0 ? `<small class="selo-estimate-delta">${delta > 0 ? '+' : ''}${delta} vs. hoje</small>` : ''}</h3></div>
        </div>
        <ul class="selo-estimate-dims">
          ${dims
            .map(([k, label]) => {
              const v = Number(det[k]) || 0;
              return `<li><span class="selo-dim-label">${label} <small>peso ${Number(weights[k]) || 0}</small></span><span class="selo-dim-bar"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span><span class="selo-dim-val">${v}</span></li>`;
            })
            .join('')}
        </ul>
        ${det.aceitesForcados ? `<p class="muted">${det.aceitesForcados} aceite(s) forçado(s) — cada um desconta pontos da dimensão Validação.</p>` : ''}
        <p class="muted">Casos de uso cadastrados: <strong>${Number(s.casos) || 0}</strong> (alvo de pontuação cheia: ${Number(s.casosAlvo) || 5}). Publicar carimba a revisão de hoje, então o <strong>frescor</strong> entra como verde.</p>
      </div>`;
  }
  function renderMergeAplicar(w) {
    const changed = (w.changes || []).filter((c) => c.decision !== 'skip');
    const overall =
      state.nodeEval && state.nodeEval.nodeType === 'skill' && state.nodeEval.id === w.skillId && state.nodeEval.data
        ? state.nodeEval.data.overall
        : (w.selo && w.selo.gateOverall) || 'pending';
    const gateOk = overall === 'pass';
    return `
      <div class="row-actions merge-nav merge-nav-top">
        <button class="ghost-button" data-action="mergeGoto" data-stage="casos">Voltar</button>
        <button class="primary-button" data-action="mergePublish" ${w.applying || !gateOk ? 'disabled' : ''} ${gateOk ? '' : 'title="O gate de governança precisa passar (aprovado)"'}>${icon('check')}${w.applying ? 'Publicando…' : 'Publicar canônica'}</button>
      </div>
      <p class="queue-intro">Publicar a versão <strong>canônica</strong>: a versão atual vai para o arquivo (<code>legado</code>, com rollback) e a nova entra no lugar${w.mode === 'merge' && changed.length ? `, com ${changed.length} arquivo(s) mesclado(s)` : ''}.</p>
      ${gateOk ? '' : '<div class="form-alert form-alert-error">O gate de <strong>Governança</strong> ainda não passou — volte à etapa Governança, rode a avaliação e aprove (ou aceite) cada item obrigatório.</div>'}
      ${w.applyError ? `<div class="form-alert form-alert-error">${escapeHtml(w.applyError)}</div>` : ''}
      ${renderSeloEstimate(w)}`;
  }

  return {
    mergeStart,
    mergePromote,
    mergeClose,
    mergeWriteAndEval,
    mergePublish,
    mergeAnalyse,
    mergeSelectFile,
    mergeToggleEdit,
    mergeCloseEditor,
    mergeSkipFile,
    mergeGoto,
    renderMergeWizard
  };
}
