export function createQueueFeature({
  state,
  computeQueueCountsLocal,
  provider,
  renderShell,
  toast,
  curatesActiveBalde,
  roleAllows,
  permissionAttrs,
  permissionNote,
  skillNameById,
  escapeHtml,
  currentAccessUser,
  queueStatusPill,
  icon,
  queueWhen,
  formatDate,
  renderProposalText,
  renderAiGenerateButton,
  isBasicRequirementProposal,
  refresh,
  cssToken,
  dupMatchList,
  formatBytes
}) {
  const QUEUE_MERGE_SEED_CAP = 8000;
  function computeMergeSeed(item) {
    if (item?.ai?.cleanedContent) {
      return item.ai.cleanedContent;
    }
    const content = String(item?.content || '');
    return content.length <= QUEUE_MERGE_SEED_CAP ? content : '';
  }

  function queueCharLabel(n) {
    const value = Number(n) || 0;
    return value >= 1000 ? `${Math.round(value / 1000)}k car.` : `${value} car.`;
  }

  // Project a full item down to a light list-meta (drop content + the cleaned sidecar).
  function queueMetaOf(item) {
    const meta = { ...item };
    delete meta.content;
    if (meta.ai) {
      meta.ai = { ...meta.ai };
      delete meta.ai.cleanedContent;
    }
    return meta;
  }

  // Apply a mutation result: refresh the list-meta slot + counts, and the open detail.
  function replaceQueueItem(fullItem) {
    if (!state.queue || !fullItem) {
      return;
    }
    const meta = queueMetaOf(fullItem);
    const index = state.queue.items.findIndex((entry) => entry.id === fullItem.id);
    if (index >= 0) {
      state.queue.items[index] = meta;
    } else {
      state.queue.items.unshift(meta);
    }
    state.queue.counts = computeQueueCountsLocal(state.queue.items);
    state.queuePendingCount = state.queue.counts.pendente || 0;
    if (state.queue.selectedId === fullItem.id) {
      state.queue.detail = fullItem;
    }
  }

  // Fila view loader: refresh the Aprovações proposals (everyone) and, for
  // curators/admins, load the contributions queue.
  async function openFila() {
    try {
      state.proposals = await provider.listProposals();
    } catch (error) {
      /* keep prior */
    }
    await openQueue();
  }

  async function openQueue() {
    if (!state.queue) {
      state.queue = {
        items: [],
        counts: {},
        selectedId: null,
        filter: 'pendente',
        busy: false,
        editContent: null,
        detail: null,
        detailLoading: false
      };
    }
    state.queue.busy = true;
    renderShell();
    try {
      const res = await fetch('/api/queue');
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao carregar a fila.');
      }
      state.queue.error = null;
      state.queue.items = data.items || [];
      state.queue.counts = data.counts || {};
      state.queue.writable = data.writable !== false;
      state.queue.incoming = Number(data.incoming) || 0;
      state.queue.recovery = data.recovery || [];
      state.queuePendingCount = state.queue.counts.pendente || 0;
      if (state.queue.selectedId && !state.queue.items.some((item) => item.id === state.queue.selectedId)) {
        state.queue.selectedId = null;
        state.queue.detail = null;
      }
    } catch (error) {
      toast(error.message, 'warning');
      state.queue.error = error.message;
    }
    state.queue.busy = false;
    renderShell();
  }

  // The list holds only metadata; open fetches the full item (content + files + cleaned text).
  async function openQueueItem(id) {
    if (!state.queue) {
      return;
    }
    state.queue.selectedId = id;
    state.queue.detail = null;
    state.queue.detailLoading = true;
    state.queue.editContent = null;
    // Um rascunho de edição congelado de OUTRO item não pode ressurgir por cima do detalhe fresco.
    if (state.queue.capsuleEdit && state.queue.capsuleEdit.itemId !== id) state.queue.capsuleEdit = null;
    renderShell();
    try {
      const res = await fetch(`/api/queue/item?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao carregar a contribuição.');
      }
      state.queue.detail = data.item;
      state.queue.editContent = computeMergeSeed(data.item);
      // Governança: duplicatas das cápsulas deste manifesto contra o corpus (curador vê antes de aprovar).
      state.queue.dupes = null;
      if (data.item && data.item.type === 'capsule' && curatesActiveBalde()) {
        fetch(`/api/dedup/queue-item?id=${encodeURIComponent(data.item.id)}`)
          .then((r) => r.json())
          .then((d) => {
            if (d.ok && state.queue.detail && state.queue.detail.id === data.item.id) {
              state.queue.dupes = d.results;
              renderShell();
            }
          })
          .catch(() => {});
      }
    } catch (error) {
      toast(error.message, 'warning');
      state.queue.selectedId = null;
    }
    state.queue.detailLoading = false;
    renderShell();
  }

  async function queuePreprocess(id) {
    if (!state.queue) {
      return;
    }
    state.queue.busy = true;
    renderShell();
    try {
      const res = await fetch('/api/queue/preprocess', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao preprocessar.');
      }
      replaceQueueItem(data.item);
      if (state.queue.selectedId === id) {
        state.queue.editContent = computeMergeSeed(data.item);
      }
      toast('Contribuição preprocessada pela IA.', 'success');
    } catch (error) {
      toast(error.message, 'warning');
    }
    state.queue.busy = false;
    renderShell();
  }

  async function queueReassign(id, skillId) {
    if (!skillId) {
      return;
    }
    try {
      const res = await fetch('/api/queue/reassign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, skillId })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao reatribuir.');
      }
      replaceQueueItem(data.item);
      toast(`Reatribuída para "${skillNameById(skillId)}".`, 'success');
    } catch (error) {
      toast(error.message, 'warning');
    }
    renderShell();
  }

  async function queueDecide(id, decision) {
    if (!state.queue) {
      return;
    }
    // Capture where to go AFTER the decision — the next item in the list as it stands now —
    // before deciding removes this one from the pendentes view. Lets approve/reject flow
    // straight to the next item instead of lingering on the decided one.
    const filaSel = state.fila && state.fila.selected ? { ...state.fila.selected } : null;
    const filaNav = (() => {
      const { list } = filaVisibleEntries();
      const i = filaSel ? list.findIndex((e) => e.kind === filaSel.kind && String(e.id) === String(filaSel.id)) : -1;
      return { curIdx: i, next: i >= 0 && i + 1 < list.length ? list[i + 1] : null };
    })();
    const item = state.queue.detail && state.queue.detail.id === id ? state.queue.detail : null;
    const isCapsule = Boolean(item && item.type === 'capsule');
    const payload = { id, decision, revision: item?.revision };
    const noteEl = document.querySelector('[data-queue-note]');
    if (noteEl) {
      payload.note = noteEl.value;
    }
    // Capsule items carry their own manifest — approval applies it; no merge content involved.
    if (decision === 'aprovar' && !isCapsule) {
      payload.content = state.queue.editContent != null ? state.queue.editContent : computeMergeSeed(item || {});
      if (!String(payload.content).trim() && !item?.files?.length) {
        toast('Nada para mesclar: escreva o texto a mesclar ou anexe arquivos.', 'warning');
        return;
      }
    }
    let decided = false;
    state.queue.busy = true;
    renderShell();
    try {
      const res = await fetch('/api/queue/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        // Stale capsule (409): the corpus moved since submit — surface the fresh compile errors.
        if (isCapsule && Array.isArray(data.errors) && data.errors.length) {
          throw new Error(
            `${data.error || 'A cápsula não compila mais.'} ${data.errors.map((e) => e.message).join(' · ')}`.slice(
              0,
              600
            )
          );
        }
        throw new Error(data.error || 'Falha ao registrar decisão.');
      }
      replaceQueueItem(data.item);
      if (isCapsule) {
        toast(decision === 'aprovar' ? 'Cápsula aplicada ao corpus.' : 'Cápsula recusada.', 'success');
        state.commonsIndex = null; // new/updated capsules — refresh the [[ index next time
      } else {
        toast(
          decision === 'aprovar'
            ? `Aprovada e mesclada em "${skillNameById(data.item.skillId)}".`
            : 'Contribuição recusada.',
          'success'
        );
      }
      if (decision === 'aprovar') {
        await provider.reload?.();
        state.skills = await provider.listSkills();
      }
      decided = true;
    } catch (error) {
      toast(error.message, 'warning');
    }
    state.queue.busy = false;
    renderShell();
    // After a successful decision, pause ~1s (so the confirmation lands) then jump to the next
    // queue item — don't linger on the just-approved/rejected one.
    if (decided) {
      setTimeout(() => {
        const cur = state.fila && state.fila.selected;
        // Respect the user if they navigated elsewhere during the pause.
        if (!cur || !filaSel || cur.kind !== filaSel.kind || String(cur.id) !== String(filaSel.id)) return;
        const { list } = filaVisibleEntries();
        let target = null;
        if (
          filaNav.next &&
          list.some((e) => e.kind === filaNav.next.kind && String(e.id) === String(filaNav.next.id))
        ) {
          target = filaNav.next; // the item that followed this one
        } else if (list.length) {
          // this was the last item: land on whatever now occupies its slot (clamped)…
          target = list[Math.min(filaNav.curIdx < 0 ? 0 : filaNav.curIdx, list.length - 1)];
          // …but never re-land on the item we just decided (can still be in non-pendente views)
          if (filaSel && target && target.kind === filaSel.kind && String(target.id) === String(filaSel.id))
            target = null;
        }
        if (target) openFilaItem(target.kind, target.id);
        else {
          if (state.fila) {
            state.fila.selected = null;
          }
          renderShell();
        } // nothing left → clear the detail
      }, 1000);
    }
  }

  // The Fila hub bundles two governance queues: "Contribuições" (context awaiting
  // curation — curators/admins only) and "Aprovações" (skill drafts awaiting the
  // owner's validation — everyone). Non-curators only ever have Aprovações, so
  // they skip the tab chrome.
  // The Fila is ONE queue: aprovações (drafts) + contribuições (context) + feedbacks (chat Errado/Fraco,
  // which also become contributions). Master-detail: a single list on the left, kind-aware detail right.
  // The filtered+sorted list the Fila shows — shared by renderQueue and the ‹ Anterior/Próximo › stepper
  // so stepping walks EXACTLY what the list shows.
  function filaVisibleEntries() {
    const canCurate = curatesActiveBalde();
    const st = state.fila || (state.fila = { kind: 'todos', status: 'pendente', selected: null, feedbackDraft: '' });
    const entries = buildFilaEntries(canCurate);
    // Um item aberto que saiu da Fila (publicado em "Revisar e publicar", promovido na página da skill, validado
    // ou decidido por outro curador) devolve a Fila à lista: o detalhe só diria que o item sumiu, e a Fila mostra
    // a lista ou um item, nunca os dois. Numa aprovação o título confirma que é o mesmo item: o id dela é
    // posicional (prop-<skill>-<n>) e passa à próxima aprovação da mesma skill quando esta é resolvida.
    const sel = st.selected;
    if (
      sel &&
      !entries.some(
        (e) => e.kind === sel.kind && String(e.id) === String(sel.id) && (sel.title == null || e.title === sel.title)
      )
    ) {
      st.selected = null;
    }
    let list = entries.slice();
    if (st.kind !== 'todos') list = list.filter((e) => e.kind === st.kind);
    if (st.status === 'pendente') list = list.filter((e) => e.status === 'pendente');
    else if (st.status === 'decididas') list = list.filter((e) => e.status !== 'pendente');
    list.sort((a, b) => String(b.when || '').localeCompare(String(a.when || '')));
    return { entries, list, st };
  }
  function filaStep(dir) {
    const { list, st } = filaVisibleEntries();
    if (!list.length) return;
    const idx = st.selected
      ? list.findIndex((e) => e.kind === st.selected.kind && String(e.id) === String(st.selected.id))
      : -1;
    const next = idx < 0 ? 0 : Math.min(Math.max(idx + dir, 0), list.length - 1);
    if (next === idx) return;
    openFilaItem(list[next].kind, list[next].id);
  }
  function renderQueue() {
    const canCurate = curatesActiveBalde();
    const { entries, list, st } = filaVisibleEntries();
    const pend = { aprovacao: 0, contrib: 0, feedback: 0 };
    entries.forEach((e) => {
      if (e.status === 'pendente') pend[e.kind] = (pend[e.kind] || 0) + 1;
    });
    const kinds = [
      ['todos', 'Todos'],
      ['aprovacao', 'Aprovações'],
      ['contrib', 'Contribuições'],
      ['feedback', 'Feedback']
    ];
    const selIdx = st.selected
      ? list.findIndex((e) => e.kind === st.selected.kind && String(e.id) === String(st.selected.id))
      : -1;
    const stepNav = st.selected
      ? `
        <div class="fila-stepnav">
          <button class="ghost-button small" data-action="filaStep" data-dir="-1" ${selIdx <= 0 ? 'disabled' : ''}>‹ Anterior</button>
          <span class="fila-stepnav-pos">${selIdx >= 0 ? `${selIdx + 1} de ${list.length}` : `${list.length} na lista`}</span>
          <button class="ghost-button small" data-action="filaStep" data-dir="1" ${selIdx < 0 || selIdx >= list.length - 1 ? 'disabled' : ''}>Próximo ›</button>
        </div>`
      : '';
    const pageSize = 12;
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    st.page = Math.min(Math.max(st.page || 0, 0), pages - 1);
    const visible = list.slice(st.page * pageSize, (st.page + 1) * pageSize);
    const detail = st.selected
      ? renderFilaDetail(st.selected, entries)
      : '<div class="queue-detail-empty">Selecione um item para revisar.</div>';
    // The Fila lives in the balde's folder: a curator without edit rights there reads it but cannot
    // decide, and contributions still in someone's outbox are on their way.
    const q = state.queue || {};
    const folderNote = canCurate ? permissionNote('curar') : '';
    const incomingNote =
      canCurate && q.incoming
        ? `<p class="queue-note">${q.incoming === 1 ? '1 contribuição está a caminho' : `${q.incoming} contribuições estão a caminho`}: ainda na pasta de envio de quem contribuiu, entra na Fila quando o app de alguém com edição no balde a mover.</p>`
        : '';
    return `
      <section class="queue-view">
        <p class="queue-intro">Uma fila só: <strong>aprovações</strong> de rascunhos, <strong>contribuições</strong> de contexto e <strong>feedbacks</strong> do chat — que também viram contribuições. Selecione um item para revisar.</p>
        ${folderNote}${incomingNote}
        ${(q.recovery || []).length ? `<section class="form-alert" role="status"><strong>Conclusão pendente</strong><p>Os dados foram preservados. Há operações que precisam continuar ou ser reconciliadas.</p><ul>${q.recovery.map((item) => `<li>${item.type === 'history' ? 'Histórico Git' : item.type === 'capsule' ? 'Aplicação de cápsula' : 'Publicação ou feedback'}: ${escapeHtml(item.error || item.status)} <code>${escapeHtml(item.id)}</code>${item.type === 'capsule' ? ` <button type="button" class="ghost-button small" data-action="capsuleDiscard" data-id="${escapeHtml(item.id)}"${permissionAttrs('curar')}>Desfazer aplicação</button>` : ''}</li>`).join('')}</ul>${q.recovery.some((item) => item.type === 'history') ? `<button type="button" class="ghost-button small" data-action="retryHistory"${permissionAttrs('curar')}>Tentar registrar histórico novamente</button>` : ''}</section>` : ''}${q.error ? `<p role="alert">Falha ao atualizar: ${escapeHtml(q.error)}. Os dados anteriores foram mantidos.</p>` : ''}
        <div class="queue-tabs fila-kinds">
          ${kinds.map(([k, label]) => `<button class="queue-tab ${st.kind === k ? 'active' : ''}" data-fila-kind="${k}">${label}${k !== 'todos' && pend[k] ? ` <span>${pend[k]}</span>` : ''}</button>`).join('')}
          <span class="fila-status-filter">${[
            ['pendente', 'Pendentes'],
            ['decididas', 'Decididas'],
            ['todas', 'Todas']
          ]
            .map(
              ([k, label]) =>
                `<button class="queue-subtab ${st.status === k ? 'active' : ''}" data-fila-status="${k}">${label}</button>`
            )
            .join('')}</span>
        </div>
        <div class="queue-layout ${st.selected ? 'queue-has-selection' : ''}">
          <aside class="queue-list">
            ${list.length ? visible.map((e) => renderFilaListItem(e, st.selected)).join('') : '<p class="queue-empty">Nada nesta seleção.</p>'}
            <nav aria-label="Páginas da fila"><button data-fila-page="${st.page - 1}" ${st.page === 0 ? 'disabled' : ''}>Anterior</button><span> Página ${st.page + 1} de ${pages} </span><button data-fila-page="${st.page + 1}" ${st.page + 1 >= pages ? 'disabled' : ''}>Próxima</button></nav>
          </aside>
          <div class="queue-detail">${st.selected ? '<button class="ghost-button" data-fila-back>Voltar à lista</button>' : ''}${stepNav}${detail}</div>
        </div>
      </section>`;
  }

  // Normalize the three sources into one list. Non-curators only ever see their own aprovações.
  function buildFilaEntries(canCurate) {
    const entries = [];
    for (const p of state.proposals || []) {
      if (
        !canCurate &&
        String(p.owner?.email || '').toLowerCase() !== String(currentAccessUser()?.email || '').toLowerCase()
      )
        continue;
      entries.push({
        kind: 'aprovacao',
        id: p.id,
        title: p.titulo,
        status: p.history ? p.status : 'pendente',
        source: p.history ? 'history' : 'draft',
        skillId: p.skillId,
        who: p.owner && p.owner.nome,
        when: p.criadoEm,
        raw: p
      });
    }
    {
      for (const c of (state.queue && state.queue.items) || []) {
        entries.push({
          kind: 'contrib',
          capsule: c.type === 'capsule',
          id: c.id,
          title: c.title,
          status: c.status || 'pendente',
          source: c.source,
          skillId: c.skillId,
          who: c.submittedBy && c.submittedBy.name,
          when: c.createdAt,
          raw: c
        });
      }
      for (const s of state.skills || []) {
        for (const f of s.feedback || []) {
          if (
            (canCurate || f.usuario === currentAccessUser()?.email) &&
            (f.veredito === 'errado' || f.veredito === 'fraco') &&
            (f.source === 'feedback-log' || f.source === 'chat-verdict') &&
            f.id
          ) {
            entries.push({
              kind: 'feedback',
              id: f.id,
              title: f.question || f.comentario || 'Feedback do chat',
              status: f.resolution ? 'resolvido' : 'pendente',
              source: f.veredito,
              skillId: s.id,
              who: f.usuario,
              when: f.timestamp,
              raw: { ...f, skillId: s.id }
            });
          }
        }
      }
    }
    return entries;
  }

  const FILA_KIND_LABEL = { aprovacao: 'Aprovação', contrib: 'Contribuição', feedback: 'Feedback' };
  function renderFilaListItem(e, sel) {
    const active = sel && sel.kind === e.kind && String(sel.id) === String(e.id);
    const badge =
      e.kind === 'contrib'
        ? queueStatusPill(e.status)
        : e.kind === 'feedback'
          ? `<span class="queue-source">${e.source === 'errado' ? 'Errado' : 'Fraco'}</span>`
          : '<span class="queue-source">rascunho</span>';
    const kindChip = e.capsule
      ? '<span class="fila-kind fila-kind-capsule" title="Cápsula de importação — aprovar aplica ao corpus">Cápsula</span>'
      : `<span class="fila-kind fila-kind-${e.kind}">${FILA_KIND_LABEL[e.kind]}</span>`;
    return `
      <button class="queue-card ${active ? 'active' : ''}" data-action="openFilaItem" data-kind="${e.kind}" data-id="${escapeHtml(String(e.id))}">
        <div class="queue-card-top">${kindChip}${badge}</div>
        <strong class="queue-card-title">${escapeHtml(e.title || '(sem título)')}</strong>
        <span class="queue-card-skill">${icon('lightbulb')}${escapeHtml(e.capsule && !e.skillId ? 'sem skill âncora' : skillNameById(e.skillId))}</span>
        <div class="queue-card-meta"><span>${escapeHtml(e.who || 'anônimo')}</span>${e.when ? `<span>${escapeHtml(queueWhen(e.when))}</span>` : ''}</div>
      </button>`;
  }

  function renderFilaDetail(sel, entries) {
    if (sel.kind === 'contrib') {
      const q = state.queue;
      if (q && q.detail && q.detail.id === sel.id) return renderQueueDetail(q.detail);
      return '<div class="queue-detail-empty">Carregando contribuição…</div>';
    }
    const e = entries.find((x) => x.kind === sel.kind && String(x.id) === String(sel.id));
    if (!e) return '<div class="queue-detail-empty">Item não encontrado — pode ter sido resolvido.</div>';
    if (sel.kind === 'aprovacao') return renderApprovalDetail(e.raw);
    if (sel.kind === 'feedback') return renderFeedbackDetail(e.raw);
    return '';
  }

  // One proposal in the detail pane (same content as the Aprovações card, reused here).
  function renderApprovalDetail(proposal) {
    if (proposal.history)
      return `<article><h2>${escapeHtml(proposal.titulo)}</h2><p>${escapeHtml(proposal.status)} · ${formatDate(proposal.criadoEm)} ${escapeHtml(proposal.version || '')}</p><p>${escapeHtml(proposal.depois || '')}</p></article>`;
    return `
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
          <small>${renderProposalText(proposal.evalResultado)}${proposal.aiGeneratedAt ? ` · IA em ${formatDate(proposal.aiGeneratedAt)}` : ''}${proposal.manualAdjustedAt ? ` · ajustado em ${formatDate(proposal.manualAdjustedAt)}` : ''}</small>        ${
            roleAllows('curar')
              ? `<div class="row-actions">
            ${
              proposal.proposalType !== 'feedback-change'
                ? `<button class="primary-button" data-action="mergePromote" data-id="${escapeHtml(proposal.skillId)}"${permissionAttrs('curar')}>${icon('spark')}Revisar e publicar (IA)</button>`
                : `<button class="primary-button" data-action="approveProposal" data-id="${proposal.id}"${permissionAttrs('curar')}>${icon('check')}Validar</button>${renderAiGenerateButton(proposal)}<button class="ghost-button" data-action="adjustSuggestion" data-id="${proposal.id}"${permissionAttrs('curar')}>${icon('edit')}Ajustar</button>`
            }
            ${isBasicRequirementProposal(proposal) ? '' : `<button class="ghost-button danger" data-action="discardProposal" data-id="${proposal.id}"${permissionAttrs('curar')}>${icon('x')}Devolver</button>`}
          </div>`
              : '<p class="queue-muted">O criador e os curadores deste balde decidem esta aprovação.</p>'
          }
        </div>
      </article>`;
  }

  // A chat feedback (Errado/Fraco) in the detail pane → convert to a contribution, or dismiss.
  function renderFeedbackDetail(fb) {
    const draft = state.fila && state.fila.feedbackDraft != null ? state.fila.feedbackDraft : '';
    if (fb.resolution)
      return `<article><h2>Feedback resolvido</h2><p>${escapeHtml(fb.question || fb.comentario || '')}</p><p>${fb.resolution.action === 'converted' ? 'Convertido em contribuição' : 'Dispensado'} · ${escapeHtml(fb.resolution.contributionId || '')}</p></article>`;
    return `
      <article class="queue-item">
        <header class="queue-item-head">
          <h2>Feedback ${fb.veredito === 'errado' ? 'Errado' : 'Fraco'}</h2>
          <p class="queue-item-sub"><span class="queue-source">${fb.veredito === 'errado' ? 'Errado' : 'Fraco'}</span> · via Chat · <strong>${escapeHtml(fb.usuario || 'anônimo')}</strong> · ${escapeHtml(queueWhen(fb.timestamp))} · skill <strong>${escapeHtml(skillNameById(fb.skillId))}</strong>${fb.duplicateCount > 1 ? ` · ${fb.duplicateCount} ocorrências` : ''}</p>
        </header>
        ${fb.comentario ? `<div class="queue-field"><label>Comentário do usuário</label><p class="queue-muted">${escapeHtml(fb.comentario)}</p></div>` : ''}
        <div class="feedback-context">
          <div><small>Pergunta</small><p>${escapeHtml(fb.question || 'Não registrada')}</p></div>
          <div><small>Resposta marcada</small><p>${escapeHtml(fb.answer || 'Não registrada')}</p></div>
        </div>
        ${
          roleAllows('curar')
            ? `<div class="queue-field">
          <label for="feedback-correction">Correção — vira o conteúdo da contribuição para a skill</label>
          <textarea id="feedback-correction" data-fila-feedback-draft rows="8" class="queue-merge" placeholder="Escreva o conhecimento/correção que deve ser mesclado na skill. A pergunta e a resposta marcada entram como contexto.">${escapeHtml(draft)}</textarea>
        </div>
        <div class="row-actions">
          <button class="ghost-button" data-action="feedbackDismiss" data-id="${escapeHtml(fb.id)}"${permissionAttrs('curar')}>${icon('x')}Dispensar</button>
          <button class="primary-button" data-action="feedbackToContribution" data-id="${escapeHtml(fb.id)}" ${state.fila?.converting ? 'disabled' : permissionAttrs('curar')}>${icon('check')}Criar contribuição</button>
        </div>`
            : '<p class="queue-muted">O criador e os curadores deste balde decidem o que fazer com este feedback.</p>'
        }
      </article>`;
  }

  function openFilaItem(kind, id) {
    const st = state.fila || (state.fila = { kind: 'todos', status: 'pendente', selected: null, feedbackDraft: '' });
    // Só a aprovação guarda o título (veja filaVisibleEntries); o de uma contribuição muda quando o curador edita
    // a cápsula, e o id dela basta.
    const entry =
      kind === 'aprovacao'
        ? buildFilaEntries(curatesActiveBalde()).find((e) => e.kind === kind && String(e.id) === String(id))
        : null;
    st.selected = { kind, id, title: entry ? entry.title : null };
    st.feedbackDraft = '';
    if (kind === 'contrib') {
      openQueueItem(id);
      return;
    } // async-loads the detail + re-renders
    renderShell();
  }
  function setFilaKind(kind) {
    const st = state.fila || (state.fila = { kind: 'todos', status: 'pendente', selected: null, feedbackDraft: '' });
    st.kind = kind;
    st.selected = null;
    renderShell();
  }
  function setFilaStatus(status) {
    const st = state.fila || (state.fila = { kind: 'todos', status: 'pendente', selected: null, feedbackDraft: '' });
    st.status = status;
    st.selected = null;
    renderShell();
  }
  async function feedbackToContribution(id) {
    if (state.fila?.converting) return;
    const e = buildFilaEntries(true).find((x) => x.kind === 'feedback' && String(x.id) === String(id));
    if (!e) {
      toast('Feedback não encontrado.', 'warning');
      return;
    }
    const fb = e.raw;
    const draft = String((state.fila && state.fila.feedbackDraft) || '').trim();
    const content = `${draft ? `${draft}\n\n` : ''}--- Contexto do feedback (${fb.veredito}) ---\nPergunta: ${fb.question || '—'}\nResposta marcada: ${fb.answer || '—'}`;
    state.fila.converting = true;
    renderShell();
    try {
      const res = await fetch('/api/feedback/convert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id,
          skillId: fb.skillId,
          title: `Correção via feedback: ${String(fb.question || 'chat').slice(0, 60)}`,
          content,
          source: 'chat'
        })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      if (state.fila) {
        state.fila.selected = null;
        state.fila.feedbackDraft = '';
      }
      toast('Contribuição criada a partir do feedback — veja em Contribuições.', 'success');
      await provider.reload();
      await refresh(); // re-fetch skills → the resolved feedback drops out
      await openQueue(); // reload the contribution list (now includes the new item)
    } catch (error) {
      toast(error.message || 'Falha ao criar contribuição. Sua correção foi preservada.', 'warning');
    } finally {
      state.fila.converting = false;
      renderShell();
    }
  }
  async function feedbackDismiss(id) {
    try {
      const res = await fetch('/api/feedback/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action: 'dismissed' })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      if (state.fila) {
        state.fila.selected = null;
        state.fila.feedbackDraft = '';
      }
      toast('Feedback dispensado.', 'success');
      await provider.reload();
      await refresh();
      renderShell();
    } catch (error) {
      toast(error.message || 'Falha ao dispensar.', 'warning');
    }
  }

  // "Contribuições" tab body: the context-contribution queue (status filter +
  // master-detail).
  function renderQueueContribBody() {
    const q = state.queue || { items: [], counts: {}, filter: 'pendente', busy: false };
    const counts = q.counts || {};
    const filter = q.filter || 'pendente';
    const filters = [
      ['pendente', 'Pendentes', counts.pendente || 0],
      ['aprovado', 'Aprovadas', counts.aprovado || 0],
      ['recusado', 'Recusadas', counts.recusado || 0],
      ['todas', 'Todas', (q.items || []).length]
    ];
    const items = (q.items || []).filter((item) =>
      filter === 'todas' ? true : (item.status || 'pendente') === filter
    );
    const detailPane = q.detailLoading
      ? '<div class="queue-detail-empty">Carregando contribuição…</div>'
      : q.detail
        ? renderQueueDetail(q.detail)
        : q.selectedId
          ? '<div class="queue-detail-empty">Carregando contribuição…</div>'
          : '<div class="queue-detail-empty">Selecione uma contribuição para revisar.</div>';

    return `
        <p class="queue-intro">Todo novo contexto enviado para uma skill entra aqui para <strong>curadoria humana</strong> e <strong>preprocessamento por IA</strong> antes de ser mesclado. Uma contribuição pode ser <strong>reatribuída</strong> quando for enviada para a skill errada.</p>
        <div class="queue-tabs">
          ${filters.map(([key, label, n]) => `<button class="queue-tab ${filter === key ? 'active' : ''}" data-queue-filter="${key}">${label} <span>${n}</span></button>`).join('')}
        </div>
        <div class="queue-layout">
          <aside class="queue-list">
            ${items.length ? items.map((item) => renderQueueListItem(item, item.id === q.selectedId)).join('') : '<p class="queue-empty">Nenhuma contribuição nesta aba.</p>'}
          </aside>
          <div class="queue-detail">
            ${detailPane}
          </div>
        </div>
    `;
  }

  function renderQueueListItem(item, active) {
    const misfiled = item.ai && item.ai.suggestedSkillId && item.ai.suggestedSkillId !== item.skillId;
    const fileCount = item.files?.length || 0;
    return `
      <button class="queue-card ${active ? 'active' : ''}" data-action="openQueueItem" data-id="${item.id}">
        <div class="queue-card-top">
          ${queueStatusPill(item.status)}
          ${item.type === 'capsule' ? '<span class="queue-capsule-badge" title="Cápsula de importação — aprovar aplica ao corpus">cápsula</span>' : ''}
          ${item.type === 'query' ? '<span class="queue-capsule-badge queue-query-badge" title="SQL gerada por IA no chat — aprovar grava como query governada da skill">query IA</span>' : ''}
          <span class="queue-source">${item.source === 'api' ? 'API' : item.source === 'chat' ? 'Chat' : 'Web'}</span>
        </div>
        <strong class="queue-card-title">${escapeHtml(item.title || '(sem título)')}</strong>
        ${item.preview ? `<span class="queue-card-preview">${escapeHtml(item.preview)}${(item.contentChars || 0) > item.preview.length ? '…' : ''}</span>` : ''}
        <span class="queue-card-skill">${icon('lightbulb')}${escapeHtml(item.skillId ? skillNameById(item.skillId) : item.type === 'capsule' ? 'sem skill âncora' : skillNameById(item.skillId))}</span>
        <div class="queue-card-meta">
          <span>${escapeHtml(item.submittedBy?.name || 'anônimo')}</span>
          ${item.contentChars ? `<span class="queue-size" title="Tamanho do texto">${queueCharLabel(item.contentChars)}</span>` : ''}
          ${fileCount ? `<span class="queue-files-badge" title="Anexos">${icon('file')}${fileCount}</span>` : ''}
          ${item.ai ? '<span class="queue-ai-dot" title="Preprocessado por IA">IA</span>' : ''}
          ${misfiled ? '<span class="queue-flag" title="IA sugere outra skill">⚑</span>' : ''}
        </div>
      </button>
    `;
  }

  const QUEUE_RAW_DISPLAY_CAP = 20000;

  // Capsule queue item: the deployment-plan review. Approving APPLIES the manifest to the corpus
  // (re-compiled server-side against the current state first); no merge editor involved.

  // POST /api/queue/edit-capsule; o servidor recompila e re-deriva plano/título/preview.
  function renderQueueCapsuleEdit(item, ce) {
    const d = ce.draft || {};
    const sk = d.skill && typeof d.skill === 'object' ? d.skill : null;
    const concepts = Array.isArray(d.concepts) ? d.concepts : [];
    if (!(ce.openConcepts instanceof Set)) ce.openConcepts = new Set(ce.openConcepts || []);
    const chip = (axis, email) =>
      `<span class="tag-chip">${escapeHtml(email)}<button class="tag-chip-x" data-action="queueCapsuleAclRemove" data-axis="${axis}" data-email="${escapeHtml(email)}" aria-label="Remover">×</button></span>`;
    const aclBox = (axis, label, list) => `
      <div class="queue-field">
        <label>${label}</label>
        <div class="queue-ai-tags">${(list || []).map((e) => chip(axis, e)).join('') || '<span class="queue-muted">—</span>'}</div>
        <div class="row-actions" style="justify-content:flex-start">
          <input class="tag-input-field" data-capedit-email-axis="${axis}" value="${escapeHtml((ce.emailDraft && ce.emailDraft[axis]) || '')}" placeholder="email@empresa.com">
          <button class="ghost-button small" data-action="queueCapsuleAclAdd" data-axis="${axis}">${icon('plus')}Adicionar</button>
        </div>
      </div>`;
    const conceptRow = (c, i) => `
      <details class="eval-testcase"${ce.openConcepts.has(i) ? ' open' : ''} data-capedit-concept-details="${i}">
        <summary><code>${escapeHtml(c.id || '(sem id)')}</code> · ${c.action === 'update' ? 'atualiza' : 'cria'}${Array.isArray(c.media) && c.media.length ? ` · ${c.media.length} arquivo(s) de mídia (não editáveis aqui)` : ''}</summary>
        ${c.action !== 'update' ? `<div class="queue-field"><label>Título</label><input class="tag-input-field" data-capedit-concept="title" data-idx="${i}" value="${escapeHtml(c.title || '')}"></div>` : ''}
        <div class="queue-field"><label>Conteúdo (context.md)</label><textarea class="queue-merge" rows="10" data-capedit-concept="body" data-idx="${i}" spellcheck="false">${escapeHtml(c.body || '')}</textarea></div>
      </details>`;
    return `
      <article class="queue-item capsule-edit">
        <header class="queue-item-head">
          <h2>${icon('edit')} Editar cápsula</h2>
          <p class="queue-item-sub">As alterações reescrevem o manifesto na fila — a aprovação aplica exatamente o que você salvar aqui. Nada é gravado se o manifesto não compilar.</p>
        </header>
        ${ce.errors && ce.errors.length ? `<div class="form-alert form-alert-error"><strong>A cápsula não compila:</strong><ul>${ce.errors.map((e) => `<li><code>${escapeHtml(e.code || 'erro')}</code> ${escapeHtml(e.message || '')}${e.path ? ` <small>(${escapeHtml(e.path)})</small>` : ''}</li>`).join('')}</ul></div>` : ''}
        <div class="queue-field"><label>Título do item</label><input class="tag-input-field" data-capedit="title" value="${escapeHtml(d.title || '')}"></div>
        ${
          sk
            ? `
        <div class="queue-field">
          <label>Definição (SKILL.md) — ${sk.action === 'update' ? `atualiza <code>${escapeHtml(sk.id || '')}</code>` : 'cria skill âncora'}</label>
          ${
            sk.action !== 'update'
              ? `
            <input class="tag-input-field" data-capedit="skill.title" value="${escapeHtml(sk.title || '')}" placeholder="Título da skill">
            <input class="tag-input-field" data-capedit="skill.objetivo" value="${escapeHtml(sk.objetivo || '')}" placeholder="Objetivo">
            <input class="tag-input-field" data-capedit="skill.escopo" value="${escapeHtml(sk.escopo || '')}" placeholder="Escopo">
            <input class="tag-input-field" data-capedit="skill.description" value="${escapeHtml(sk.description || '')}" placeholder="Descrição curta">`
              : ''
          }
          <textarea class="queue-merge" rows="14" data-capedit="skill.body" spellcheck="false" placeholder="${sk.action === 'update' ? 'Corpo do SKILL.md — vazio mantém o corpo atual; preenchido SUBSTITUI.' : 'Corpo (espinha) do SKILL.md'}">${escapeHtml(sk.body || '')}</textarea>
          ${sk.action === 'update' && !String(sk.body || '').trim() ? `<div class="row-actions" style="justify-content:flex-start"><button class="ghost-button small" data-action="queueCapsuleSeedBody" ${ce.busy ? 'disabled' : ''}>${icon('file')}Carregar corpo atual da skill</button><span class="queue-muted">carrega o corpo vigente para editar (sem o frontmatter)</span></div>` : ''}
        </div>`
            : ''
        }
        ${concepts.length ? `<div class="queue-field"><label>Cápsulas (${concepts.length})</label>${concepts.map(conceptRow).join('')}</div>` : ''}
        <div class="row-actions">
          <button class="ghost-button" data-action="queueCapsuleEditCancel" ${ce.busy ? 'disabled' : ''}>Cancelar</button>
          <button class="primary-button" data-action="queueCapsuleEditSave" ${ce.busy ? 'disabled' : ''}>${icon('check')}${ce.busy ? 'Recompilando…' : 'Recompilar e salvar'}</button>
        </div>
      </article>`;
  }
  function renderQueueCapsuleDetail(item) {
    const q = state.queue;
    if (q.capsuleEdit && q.capsuleEdit.itemId === item.id) return renderQueueCapsuleEdit(item, q.capsuleEdit);
    const decided = item.status !== 'pendente';
    const cap = item.capsule || {};
    const s = cap.summary || {};
    const plan = cap.plan || [];
    const warns = cap.warnings || [];
    const concepts = s.concepts || [];
    const review = item.review || {};
    const manifest = cap.manifest;
    const conceptRow = (c) => `
      <li class="capsule-concept">
        <span class="capsule-action capsule-action-${cssToken(c.action || 'create')}">${c.action === 'update' ? 'atualiza' : 'cria'}</span>
        <code>${escapeHtml(c.id)}</code>
        ${c.serie ? `<span class="capsule-serie" title="Episódio da série">${icon('commit')}${escapeHtml(c.serie)}${c.periodo ? ` · ${escapeHtml(c.periodo)}` : ''}</span>` : ''}
        ${c.media ? `<span class="capsule-media" title="Arquivos de mídia">${icon('image')}${c.media}</span>` : ''}
      </li>`;
    const decision = decided
      ? item.status === 'aprovado'
        ? `<div class="queue-decision ok">${icon('check')} Aplicada por <strong>${escapeHtml(review.by || 'curador')}</strong> · ${escapeHtml(queueWhen(review.at))}${review.note ? `<p class="queue-decision-note">${escapeHtml(review.note)}</p>` : ''}
            ${review.applied ? `<p class="queue-decision-note">${(review.applied.concepts || []).length} cápsula(s) aplicada(s)${(review.applied.linked || []).length ? ` · ${(review.applied.linked || []).length} vínculo(s) no SKILL.md` : ''}${review.applied.skillBodyReplaced ? ' · corpo do SKILL.md substituído' : ''}${(review.applied.notes || []).length ? ` · ${review.applied.notes.map((n) => escapeHtml(n)).join(' · ')}` : ''}</p>` : ''}</div>`
        : `<div class="queue-decision muted">${icon('x')} Recusada por <strong>${escapeHtml(review.by || 'curador')}</strong> · ${escapeHtml(queueWhen(review.at))}${review.note ? `<p class="queue-decision-note">${escapeHtml(review.note)}</p>` : ''}</div>`
      : `
        <div class="queue-field">
          <label for="queue-review-note">Nota da revisão (opcional)</label>
          <input id="queue-review-note" data-queue-note placeholder="Motivo da decisão...">
        </div>`;
    // Decidir é a ação principal: os botões ficam no TOPO (o plano/manifesto pode ser longo e o
    // curador não deve rolar até o fim para agir). A nota da revisão continua junto do conteúdo.
    const dupes = (state.queue && state.queue.dupes) || [];
    const dupPanel =
      !decided && dupes.length
        ? `
        <div class="queue-field dup-panel">
          <label>${icon('alert')} Possíveis duplicatas no corpus — avalie antes de aprovar</label>
          ${dupes.map((r) => `<div class="dup-group"><code>${escapeHtml(r.id)}</code>${dupMatchList(r.matches)}</div>`).join('')}
          <p class="queue-muted">Se o conhecimento já existe, recuse (ou edite a cápsula para complementar em vez de duplicar).</p>
        </div>`
        : '';
    const decisionBar = decided
      ? ''
      : `
        <div class="row-actions merge-nav-top queue-decision-bar">
          ${manifest ? `<button class="ghost-button" data-action="queueCapsuleEditStart" data-id="${item.id}" ${q.busy || q.writable === false ? 'disabled' : ''} title="Editar SKILL.md, acesso e conteúdo das cápsulas antes de aprovar">${icon('edit')}Editar cápsula</button>` : ''}
          <button class="ghost-button" data-action="queueReject" data-id="${item.id}" ${q.busy || q.writable === false ? 'disabled' : ''}>${icon('x')}Recusar</button>
          <button class="primary-button" data-action="queueApprove" data-id="${item.id}" ${q.busy || q.writable === false ? 'disabled' : ''} title="Recompila contra o corpus atual e aplica: cápsulas + governança + vínculos no SKILL.md">${icon('check')}${q.busy ? 'Aplicando…' : 'Aprovar e aplicar'}</button>
        </div>`;
    const reopenEdit =
      decided && item.status === 'recusado' && manifest
        ? `<div class="row-actions"><button class="ghost-button small" data-action="queueCapsuleEditStart" data-id="${item.id}" ${(state.queue || {}).writable === false ? 'disabled' : ''}>${icon('edit')}Editar cápsula (reabre a revisão)</button></div>`
        : '';
    return `
      <article class="queue-item">
        <header class="queue-item-head">
          <h2>${escapeHtml(item.title || '(cápsula)')}</h2>
          <p class="queue-item-sub">${queueStatusPill(item.status)} · <span class="queue-capsule-badge">cápsula</span> · ${item.source === 'api' ? 'via API' : 'via Web'} · enviado por <strong>${escapeHtml(item.submittedBy?.name || 'anônimo')}</strong>${item.submittedBy?.email ? ` (${escapeHtml(item.submittedBy.email)})` : ''} · ${escapeHtml(queueWhen(item.createdAt))}</p>
        </header>
        ${decisionBar}
        ${dupPanel}
  
        <div class="queue-field">
          <label>Skill âncora</label>
          ${s.anchorId ? `<p class="capsule-anchor">${icon('lightbulb')}<strong>${escapeHtml(skillNameById(s.anchorId))}</strong> <code>${escapeHtml(s.anchorId)}</code>${s.skillBodyReplaced ? ' · <span class="capsule-body-flag">corpo do SKILL.md será substituído</span>' : ''}</p>` : '<p class="queue-muted">Sem skill âncora — só cápsulas do commons.</p>'}
        </div>
  
        <div class="queue-field">
          <label>Plano de deploy${decided ? '' : ' — o que a aprovação fará'}</label>
          <ul class="capsule-plan">${plan.map((p) => `<li>${escapeHtml(p)}</li>`).join('') || '<li class="queue-muted">—</li>'}</ul>
        </div>
  
        ${
          concepts.length
            ? `
        <div class="queue-field">
          <label>Cápsulas (${concepts.length})</label>
          <ul class="capsule-concepts">${concepts.map(conceptRow).join('')}</ul>
        </div>`
            : ''
        }
        ${(s.references || []).length ? `<div class="queue-field"><label>Referências vinculadas</label><p class="capsule-refs">${s.references.map((r) => `<code>${escapeHtml(r)}</code>`).join(' ')}</p></div>` : ''}
  
        ${
          warns.length
            ? `
        <div class="queue-field">
          <label>Avisos do compilador (${warns.length})</label>
          <ul class="capsule-warns">${warns.map((w) => `<li><code>${escapeHtml(w.code)}</code> ${escapeHtml(w.message)}</li>`).join('')}</ul>
        </div>`
            : ''
        }
  
        ${
          manifest
            ? `
        <details class="capsule-manifest">
          <summary>Manifesto (JSON)</summary>
          <pre class="queue-original">${escapeHtml(JSON.stringify(manifest, null, 2).slice(0, QUEUE_RAW_DISPLAY_CAP))}</pre>
        </details>`
            : ''
        }
  
        ${decision}
        ${reopenEdit}
      </article>
    `;
  }

  function queueCapsuleEditStart(id) {
    const q = state.queue;
    if (!q || !q.detail || q.detail.id !== id) return;
    const item = q.detail;
    const manifest = item.capsule && item.capsule.manifest;
    if (!manifest) {
      toast('Manifesto da cápsula não encontrado.', 'warning');
      return;
    }
    const draft = JSON.parse(JSON.stringify(manifest));
    const sk = draft.skill && typeof draft.skill === 'object' ? draft.skill : null;
    const acc = item.capsule.summary && item.capsule.summary.access;
    const uniq = (arr) => [
      ...new Set(
        arr
          .map((e) =>
            String(e || '')
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
      )
    ];
    q.capsuleEdit = {
      itemId: id,
      draft,
      vis: '', // access per capsule no longer exists: the balde decides
      // Lista ÚNICA por eixo (visão do curador): o save grava em skill.curators/readers (ACL da âncora)
      // E no topo do manifesto (summary.access → ACLs das cápsulas) — união idempotente.
      curators: acc ? uniq(acc.curators || []) : uniq([...((sk && sk.curators) || []), ...(draft.curators || [])]),
      readers: acc ? uniq(acc.readers || []) : uniq([...((sk && sk.readers) || []), ...(draft.readers || [])]),
      emailDraft: { curators: '', readers: '' },
      openConcepts: new Set(),
      errors: [],
      warnings: [],
      busy: false
    };
    renderShell();
  }
  function queueCapsuleEditCancel() {
    const q = state.queue;
    if (q) {
      q.capsuleEdit = null;
      renderShell();
    }
  }
  function queueCapsuleAclAdd(axis) {
    const q = state.queue;
    const ce = q && q.capsuleEdit;
    if (!ce) return;
    const input = document.querySelector(`[data-capedit-email-axis="${axis}"]`);
    const email = String((input ? input.value : ce.emailDraft[axis]) || '')
      .trim()
      .toLowerCase();
    if (!email || !email.includes('@')) {
      toast('Informe um e-mail válido.', 'warning');
      return;
    }
    const list = axis === 'readers' ? ce.readers : ce.curators;
    if (!list.includes(email)) list.push(email);
    ce.emailDraft[axis] = '';
    renderShell();
  }
  function queueCapsuleAclRemove(axis, email) {
    const q = state.queue;
    const ce = q && q.capsuleEdit;
    if (!ce) return;
    if (axis === 'readers') ce.readers = ce.readers.filter((e) => e !== email);
    else ce.curators = ce.curators.filter((e) => e !== email);
    renderShell();
  }
  // Draft → manifesto: visibilidade única no topo (skill.visibility removida — evita
  // 'visibilidade-conflitante'); listas editadas vão para os DOIS eixos que o apply usa.
  // "Não alterar" (vis === '') deixa os campos de acesso EXATAMENTE como submetidos — nunca
  // remove uma visibilidade declarada (removê-la faria um manifesto restrito nascer público).
  function buildCapsuleDraftManifest(ce) {
    const m = JSON.parse(JSON.stringify(ce.draft));
    if (ce.vis) {
      if (m.skill && typeof m.skill === 'object') delete m.skill.visibility;
      m.visibility = ce.vis;
      m.curators = [...ce.curators];
      m.readers = [...ce.readers];
      if (m.skill && typeof m.skill === 'object') {
        m.skill.curators = [...ce.curators];
        m.skill.readers = [...ce.readers];
      }
    }
    return m;
  }
  async function saveCapsuleEdit() {
    const q = state.queue;
    const ce = q && q.capsuleEdit;
    if (!ce || ce.busy) return;
    if (ce.vis === 'restricted' && !ce.curators.length) {
      toast('Visibilidade restrita precisa de ao menos um curador — adicione um e-mail.', 'warning');
      return;
    }
    ce.busy = true;
    renderShell();
    try {
      const res = await fetch('/api/queue/edit-capsule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: ce.itemId, manifest: buildCapsuleDraftManifest(ce) })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      if (!d.ok) {
        ce.errors = d.errors || [];
        ce.warnings = d.warnings || [];
        ce.busy = false;
        toast('A cápsula não compila — revise os erros.', 'warning');
        renderShell();
        return;
      }
      q.detail = d.item;
      replaceQueueItem(queueMetaOf(d.item));
      q.capsuleEdit = null;
      toast('Cápsula atualizada — plano recompilado.', 'success');
      renderShell();
    } catch (error) {
      ce.busy = false;
      toast(error.message || 'Falha ao salvar a cápsula.', 'warning');
      renderShell();
    }
  }
  // Conveniência em action:update sem corpo: carrega o corpo VIGENTE da skill (sem o frontmatter —
  // o apply substitui só o corpo; um seed com frontmatter viraria texto literal).
  async function queueCapsuleSeedBody() {
    const q = state.queue;
    const ce = q && q.capsuleEdit;
    if (!ce || ce.busy) return;
    const sk = ce.draft && ce.draft.skill;
    if (!sk || !sk.id) return;
    ce.busy = true;
    renderShell();
    try {
      const res = await fetch(`/api/merge/context?skillId=${encodeURIComponent(sk.id)}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      const f =
        (d.files || []).find((x) => x.path === 'SKILL.md' && x.scope === 'skill') ||
        (d.files || []).find((x) => x.path === 'SKILL.md');
      if (!f) throw new Error('SKILL.md não encontrado.');
      sk.body = String(f.content || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
      ce.busy = false;
      renderShell();
    } catch (error) {
      ce.busy = false;
      toast(error.message || 'Falha ao carregar o corpo da skill.', 'warning');
      renderShell();
    }
  }

  // Query draft (AI-written SQL captured from a chat's run_sql): show the river-formatted
  // SQL + destination path; approving writes query/<slug>.sql into the skill and commits.
  function renderQueueQueryDetail(item) {
    const q = state.queue;
    const decided = item.status !== 'pendente';
    const canDecide = !decided && curatesActiveBalde();
    const proposed = (item.query && (item.query.appliedPath || item.query.path)) || 'query/consulta-ia.sql';
    const decisionBar = canDecide
      ? `
        <div class="row-actions merge-nav-top queue-decision-bar">
          <button class="ghost-button" data-action="queueReject" data-id="${item.id}" ${q.busy || q.writable === false ? 'disabled' : ''}>${icon('x')}Recusar</button>
          <button class="primary-button" data-action="queueApprove" data-id="${item.id}" ${q.busy || q.writable === false ? 'disabled' : ''} title="Grava a SQL como ${escapeHtml(proposed)} na skill e faz o commit — vira query governada (run_query)">${icon('check')}${q.busy ? 'Aplicando…' : 'Aprovar e canonizar'}</button>
        </div>`
      : '';
    return `
      <article class="queue-item">
        <header class="queue-item-head">
          <h2>${escapeHtml(item.title || '(query IA)')}</h2>
          <p class="queue-item-sub">${queueStatusPill(item.status)} · <span class="queue-capsule-badge queue-query-badge">query IA</span> · via Chat · enviado por <strong>${escapeHtml(item.submittedBy?.name || 'anônimo')}</strong>${item.submittedBy?.email ? ` (${escapeHtml(item.submittedBy.email)})` : ''} · ${escapeHtml(queueWhen(item.createdAt))}</p>
        </header>
        ${decisionBar}
        <div class="queue-field">
          <label>Skill de destino</label>
          <p class="capsule-anchor">${icon('lightbulb')}<strong>${escapeHtml(skillNameById(item.skillId))}</strong> <code>${escapeHtml(item.skillId)}</code></p>
        </div>
        <div class="queue-field">
          <label>${item.query && item.query.appliedPath ? 'Gravada em' : 'Caminho proposto'}</label>
          <p><code>${escapeHtml(proposed)}</code>${item.query && item.query.appliedPath ? ' · <span class="capsule-body-flag">query governada — o buddy agora a executa via run_query</span>' : ''}</p>
        </div>
        <div class="queue-field">
          <label>SQL (gerada por IA no chat — revise filtros, joins e segmentos antes de aprovar)</label>
          <pre class="queue-original">${escapeHtml(String(item.content || '').slice(0, QUEUE_RAW_DISPLAY_CAP))}</pre>
        </div>
        ${
          item.review
            ? `
        <div class="queue-field">
          <label>Decisão</label>
          <p class="queue-muted">${escapeHtml(item.review.decision || '')} por <strong>${escapeHtml(item.review.by || '')}</strong> · ${escapeHtml(queueWhen(item.review.at))}${item.review.note ? ` — ${escapeHtml(item.review.note)}` : ''}</p>
        </div>`
            : ''
        }
      </article>
    `;
  }

  function renderQueueDetail(item) {
    if (!curatesActiveBalde())
      return `<article class="queue-item"><h2>${escapeHtml(item.title)}</h2><p>${queueStatusPill(item.status)} · ${escapeHtml(queueWhen(item.createdAt))}</p><p>${item.review?.publicationId ? 'Conteúdo publicado.' : item.review?.appliedState === 'draft' ? 'Aplicada ao rascunho. Publicação pendente.' : item.review ? 'Decisão registrada.' : 'Aguardando recebimento ou revisão do curador.'}</p><pre class="queue-original">${escapeHtml(item.content || '')}</pre>${item.review ? renderQueueDecision(item) : ''}</article>`;
    if (item && item.type === 'capsule') return renderQueueCapsuleDetail(item);
    if (item && item.type === 'query') return renderQueueQueryDetail(item);
    const q = state.queue;
    const decided = item.status !== 'pendente';
    const ai = item.ai;
    const reassignOptions = (state.skills || [])
      .map(
        (skill) =>
          `<option value="${skill.id}" ${skill.id === item.skillId ? 'selected' : ''}>${escapeHtml(skill.nome)}</option>`
      )
      .join('');
    const misfiled = ai && ai.suggestedSkillId && ai.suggestedSkillId !== item.skillId;
    const editValue = q.editContent != null ? q.editContent : computeMergeSeed(item);
    const fullContent = String(item.content || '');
    const rawTruncated = fullContent.length > QUEUE_RAW_DISPLAY_CAP;
    const shownRaw = rawTruncated ? fullContent.slice(0, QUEUE_RAW_DISPLAY_CAP) : fullContent;
    const files = item.files || [];
    const bigUnprocessed = !decided && !ai && fullContent.length > QUEUE_MERGE_SEED_CAP;
    return `
      <article class="queue-item">
        <header class="queue-item-head">
          <h2>${escapeHtml(item.title || '(sem título)')}</h2>
          <p class="queue-item-sub">${queueStatusPill(item.status)} · ${item.source === 'api' ? 'via API' : item.source === 'chat' ? 'via Chat' : 'via Web'} · enviado por <strong>${escapeHtml(item.submittedBy?.name || 'anônimo')}</strong>${item.submittedBy?.email ? ` (${escapeHtml(item.submittedBy.email)})` : ''} · ${escapeHtml(queueWhen(item.createdAt))}</p>
          ${
            decided
              ? ''
              : `<div class="row-actions merge-nav-top queue-decision-bar">
            <button class="ghost-button" data-action="queueReject" data-id="${item.id}" ${q.busy || q.writable === false ? 'disabled' : ''}>${icon('x')}Recusar</button>
            <button class="ghost-button" data-action="queueApprove" data-id="${item.id}" ${q.busy || q.writable === false ? 'disabled' : ''} title="Aplica ao rascunho; a publicação exige revisão e avaliação">${icon('check')}Aplicar ao rascunho</button>
            <button class="primary-button" data-action="mergeStart" data-id="${item.id}" ${q.writable === false ? 'disabled' : ''}>${icon('spark')}Revisar e mesclar (IA)</button>
          </div>`
          }
        </header>
  
        <div class="queue-field">
          <label>Skill de destino</label>
          <div class="queue-reassign">
            <select aria-label="Skill de destino" data-queue-reassign="${item.id}" ${decided ? 'disabled' : ''} ${q.writable === false ? 'disabled' : ''}>${reassignOptions}</select>
            ${item.originalSkillId && item.originalSkillId !== item.skillId ? `<span class="queue-reassigned">reatribuída · original: ${escapeHtml(skillNameById(item.originalSkillId))}</span>` : ''}
          </div>
        </div>
  
        ${
          ai
            ? `
          <div class="queue-ai-panel">
            <div class="queue-ai-head">${icon('spark')} Preprocessamento — ${escapeHtml(ai.provider || 'IA')}${ai.quality != null ? ` · qualidade ${ai.quality}/100` : ''}</div>
            ${ai.summary ? `<p class="queue-ai-summary">${escapeHtml(ai.summary)}</p>` : ''}
            ${misfiled ? `<div class="queue-ai-suggest">A IA sugere mover para <strong>${escapeHtml(skillNameById(ai.suggestedSkillId))}</strong>${ai.suggestedSkillReason ? ` — ${escapeHtml(ai.suggestedSkillReason)}` : ''} <button class="ghost-button small" data-action="queueApplyAiSkill" data-id="${item.id}" data-skill="${ai.suggestedSkillId}" ${q.writable === false ? 'disabled' : ''}>Aplicar sugestão</button></div>` : ''}
            ${ai.suggestedTags && ai.suggestedTags.length ? `<div class="queue-ai-tags">${ai.suggestedTags.map((tag) => `<span class="tag-chip tag-chip-static">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
            ${ai.concerns && ai.concerns.length ? `<ul class="queue-ai-concerns">${ai.concerns.map((concern) => `<li>${escapeHtml(concern)}</li>`).join('')}</ul>` : ''}
            ${(item.contentChars || 0) > 40000 ? '<p class="queue-hint">Conteúdo extenso — a IA analisou uma amostra (início + fim) para a triagem.</p>' : ''}
          </div>
        `
            : `
          <div class="queue-ai-empty">
            <span>Ainda não preprocessado pela IA.</span>
            <button class="ghost-button small" data-action="queuePreprocess" data-id="${item.id}" ${q.busy || q.writable === false ? 'disabled' : ''}>${icon('spark')}Preprocessar com IA</button>
          </div>
        `
        }
  
        ${
          item.ontologyLint && (item.ontologyLint.findings || []).length
            ? `
          <div class="queue-onto-lint">
            <div class="queue-onto-lint-head">${icon('ontology')}Ontologia do domínio <strong>${escapeHtml(item.ontologyLint.domain)}</strong> — vocabulário</div>
            <ul>${item.ontologyLint.findings.map((f) => `<li>O texto usa <strong>“${escapeHtml(f.usado)}”</strong> (${f.count}×) — a ontologia define <strong>“${escapeHtml(f.termo)}”</strong> como termo canônico. Considere padronizar ao mesclar.</li>`).join('')}</ul>
          </div>`
            : ''
        }
  
        <div class="queue-field">
          <label>Conteúdo enviado${item.contentChars ? ` <span class="queue-size">(${queueCharLabel(item.contentChars)})</span>` : ''}</label>
          ${
            fullContent
              ? `<pre class="queue-original">${escapeHtml(shownRaw)}${rawTruncated ? `\n\n[… exibindo ${QUEUE_RAW_DISPLAY_CAP.toLocaleString('pt-BR')} de ${fullContent.length.toLocaleString('pt-BR')} caracteres …]` : ''}</pre>`
              : '<p class="queue-muted">Sem texto — apenas anexos.</p>'
          }
        </div>
  
        ${
          files.length
            ? `
          <div class="queue-field">
            <label>Anexos (${files.length})</label>
            <ul class="queue-files">
              ${files.map((file) => `<li><a href="/api/queue/file?id=${encodeURIComponent(item.id)}&name=${encodeURIComponent(file.name)}" target="_blank" rel="noopener">${icon('file')}${escapeHtml(file.name)}</a> <span class="queue-file-size">${formatBytes(file.bytes)}</span></li>`).join('')}
            </ul>
          </div>
        `
            : ''
        }
        ${item.tags && item.tags.length ? `<div class="queue-ai-tags">${item.tags.map((tag) => `<span class="tag-chip tag-chip-static">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
  
        ${
          decided
            ? renderQueueDecision(item)
            : `
          <div class="queue-field">
            <label for="queue-edit-content">Conteúdo a mesclar na skill${ai ? ' — versão da IA, edite se precisar' : ''}</label>
            ${bigUnprocessed ? `<p class="queue-hint">Texto extenso (${queueCharLabel(fullContent.length)}). Use “Preprocessar com IA” para gerar uma versão condensada, ou escreva/cole abaixo o trecho a mesclar.</p>` : ''}
            <textarea id="queue-edit-content" data-queue-field="editContent" rows="10" class="queue-merge" placeholder="O texto que será salvo no contexto do rascunho${files.length ? ' (deixe vazio para mesclar apenas os anexos)' : ''}." ${q.busy ? 'disabled' : ''}>${escapeHtml(editValue)}</textarea>
          </div>
          <div class="queue-field">
            <label for="queue-review-note">Nota da revisão (opcional)</label>
            <input id="queue-review-note" data-queue-note placeholder="Motivo da decisão, ajustes feitos...">
          </div>
        `
        }
      </article>
    `;
  }

  function renderQueueDecision(item) {
    const review = item.review || {};
    if (item.status === 'aprovado') {
      const mergedFiles =
        review.mergedFiles && review.mergedFiles.length
          ? `<p class="queue-decision-note">Arquivos copiados: ${review.mergedFiles.map((name) => `<code>context/${escapeHtml(name)}</code>`).join(', ')}</p>`
          : '';
      return `<div class="queue-decision ok">${icon('check')} Aprovada por <strong>${escapeHtml(review.by || 'curador')}</strong> · ${review.publicationId ? 'publicada em' : review.appliedState === 'draft' ? 'aplicada ao rascunho de' : 'aplicada em'} <strong>${escapeHtml(skillNameById(review.mergedInto || item.skillId))}</strong> · ${escapeHtml(queueWhen(review.at))}${review.note ? `<p class="queue-decision-note">${escapeHtml(review.note)}</p>` : ''}${mergedFiles}</div>`;
    }
    return `<div class="queue-decision muted">${icon('x')} Recusada por <strong>${escapeHtml(review.by || 'curador')}</strong> · ${escapeHtml(queueWhen(review.at))}${review.note ? `<p class="queue-decision-note">${escapeHtml(review.note)}</p>` : ''}<p class="queue-decision-hint">Para retomar, reatribua a skill de destino acima.</p></div>`;
  }

  return {
    computeMergeSeed,
    openFila,
    openQueueItem,
    queuePreprocess,
    queueReassign,
    queueDecide,
    filaStep,
    renderQueue,
    openFilaItem,
    setFilaKind,
    setFilaStatus,
    feedbackToContribution,
    feedbackDismiss,
    queueCapsuleEditStart,
    queueCapsuleEditCancel,
    queueCapsuleAclAdd,
    queueCapsuleAclRemove,
    saveCapsuleEdit,
    queueCapsuleSeedBody
  };
}
