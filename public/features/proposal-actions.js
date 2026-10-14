export function createProposalActionsFeature({
  state,
  openSkillInExplore,
  renderShell,
  provider,
  refresh,
  toast,
  isBasicRequirementProposal
}) {
  async function runAnalysis(id) {
    state.loading = 'analysis';
    if (!state.explore || state.explore.selectedId !== id) {
      await openSkillInExplore(id); // open (or focus) the skill in the corpus explorer
    }
    state.explore.tab = 'report';
    renderShell();
    await provider.runAnalysis(id);
    await refresh();
    state.loading = null;
    toast('Relatório do agente atualizado.');
    renderShell();
  }

  async function runEvals(id) {
    state.loading = 'evals';
    renderShell();
    const result = await provider.runEvals(id);
    state.evalResult = {
      ...result,
      skillId: id
    };
    state.loading = null;
    toast(
      `Evals finalizados: passou ${result.passou}/${result.total}.`,
      result.passou === result.total ? 'success' : 'warning'
    );
    renderShell();
  }

  async function publishSuggestion(id, summary) {
    try {
      const skill = await provider.publishVersion(id, summary || 'Sugestão aprovada pelo owner');
      await refresh();
      toast(`Versão canônica salva: ${skill.canonical?.paths?.canonico || 'governance/skills'}.`);
      renderShell();
    } catch (error) {
      toast(error.message || 'Não foi possível publicar a versão canônica.', 'warning');
    }
  }

  async function approveProposal(id) {
    try {
      const result = await provider.approveProposal(id);
      await refresh();
      if (result.draftApproval) {
        toast(
          `Requisito salvo no rascunho: ${result.draftApproval.paths?.review || 'logs/draft-change-log.md'}.`,
          'success'
        );
      } else {
        toast(`Validação salva com review: ${result.canonical?.paths?.review || 'logs/change-log.md'}.`);
      }
      renderShell();
    } catch (error) {
      toast(error.message || 'Não foi possível validar a proposta.', 'warning');
    }
  }

  async function generateProposalWithAi(id) {
    try {
      state.loading = `ai:${id}`;
      renderShell();
      const proposal = await provider.generateProposalWithAi(id);
      state.proposals = await provider.listProposals();
      state.loading = null;
      toast(`Sugestão preenchida com ${proposal.provider || 'IA'}.`, 'success');
      renderShell();
    } catch (error) {
      state.loading = null;
      toast(error.message || 'Não foi possível gerar a sugestão com IA.', 'warning');
      renderShell();
    }
  }

  async function generateAdjustmentWithAi(id) {
    try {
      state.loading = `ai:${id}`;
      renderShell();
      const proposal = await provider.generateProposalWithAi(id);
      state.proposals = await provider.listProposals();
      state.adjustment = { ...proposal };
      state.loading = null;
      toast(`Sugestão preenchida com ${proposal.provider || 'IA'}.`, 'success');
      renderShell();
    } catch (error) {
      state.loading = null;
      toast(error.message || 'Não foi possível gerar a sugestão com IA.', 'warning');
      renderShell();
    }
  }

  function readAdjustmentFields() {
    const fields = {};
    document.querySelectorAll('[data-adjust-field]').forEach((field) => {
      fields[field.dataset.adjustField] = field.value.trim();
    });
    return fields;
  }

  function syncAdjustmentApprovalButton() {
    if (!state.adjustment) {
      return;
    }

    const draftSave = state.adjustment.canPromote === false;
    if (!draftSave) {
      return;
    }

    const afterValue = document.querySelector('[data-adjust-field="depois"]')?.value.trim();
    const button = document.querySelector('[data-action="saveAndApproveAdjustment"]');
    if (!button) {
      return;
    }

    button.disabled = !afterValue;
    button.title = afterValue ? '' : 'Preencha o campo Depois ou clique em Gerar com IA';
  }

  async function openManualAdjustment(id) {
    const proposal = state.proposals.find((item) => item.id === id);
    if (!proposal) {
      toast('Proposta não encontrada para ajuste.', 'warning');
      return;
    }

    state.adjustment = { ...proposal };
    renderShell();
  }

  async function saveManualAdjustment(approveAfterSave = false) {
    if (!state.adjustment) {
      return;
    }

    const proposalId = state.adjustment.id;
    const updated = await provider.updateProposal(proposalId, readAdjustmentFields());
    state.proposals = await provider.listProposals();
    state.adjustment = null;

    if (approveAfterSave) {
      await approveProposal(updated.id);
      return;
    }

    toast('Ajuste manual salvo na proposta.');
    renderShell();
  }

  async function openReturnProposal(id) {
    const proposal = state.proposals.find((item) => item.id === id);
    if (!proposal) {
      toast('Proposta não encontrada para devolução.', 'warning');
      return;
    }

    if (isBasicRequirementProposal(proposal)) {
      toast('Requisito básico não pode ser devolvido; ele precisa ser preenchido antes da canonização.', 'warning');
      return;
    }

    state.returning = { ...proposal };
    renderShell();
  }

  async function confirmReturnProposal() {
    if (!state.returning) {
      return;
    }

    const reason = document.querySelector('[data-return-reason]')?.value.trim();
    if (!reason) {
      toast('Informe o motivo da devolução.', 'warning');
      return;
    }

    const returned = await provider.returnProposal(state.returning.id, reason);
    state.returning = null;
    await refresh();
    toast(`Devolução registrada: ${returned.paths?.review || 'logs/return-log.md'}.`);
    renderShell();
  }

  async function rollback(id, version) {
    const skill = await provider.rollback(id, version);
    await refresh();
    state.confirm = null;
    toast(`Rollback para ${version} salvo em ${skill.canonical?.paths?.canonico || 'canonico/SKILL.md'}.`);
    renderShell();
  }

  function currentActor() {
    return state.auth.user?.email || state.auth.user?.nome || 'owner';
  }

  async function saveSourceText(id) {
    const field = document.querySelector(`[data-source-text][data-id="${CSS.escape(id)}"]`);
    const sourceText = field?.value || '';
    if (!sourceText.trim()) {
      toast('O texto do SKILL.md não pode ficar vazio.', 'warning');
      return;
    }

    try {
      state.loading = `source:${id}`;
      renderShell();
      const result = await provider.saveSkillSource(id, sourceText, currentActor());
      await refresh();
      state.loading = null;
      toast(`Texto salvo no rascunho: ${result.draftApproval.paths?.review || 'logs/draft-change-log.md'}.`, 'success');
      renderShell();
    } catch (error) {
      state.loading = null;
      toast(error.message || 'Não foi possível salvar o texto atual.', 'warning');
      renderShell();
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve({
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          base64: result.includes(',') ? result.split(',').pop() : result
        });
      };
      reader.onerror = () => reject(reader.error || new Error(`Falha ao ler ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  async function uploadContextFiles(id, kind) {
    const input = document.querySelector(`[data-context-upload="${CSS.escape(kind)}"]`);
    const files = [...(input?.files || [])];
    if (!files.length) {
      toast(`Selecione ao menos um arquivo para ${kind}.`, 'warning');
      return;
    }

    try {
      state.loading = `upload:${kind}:${id}`;
      renderShell();
      const payload = await Promise.all(files.map(fileToBase64));
      const result = await provider.uploadContextFiles(id, kind, payload, currentActor());
      await refresh();
      state.loading = null;
      toast(
        `Upload salvo no rascunho: ${result.draftApproval.paths?.review || 'logs/draft-change-log.md'}.`,
        'success'
      );
      renderShell();
    } catch (error) {
      state.loading = null;
      toast(error.message || 'Não foi possível enviar os arquivos.', 'warning');
      renderShell();
    }
  }

  async function rollbackDraft(id, entryId) {
    try {
      const result = await provider.rollbackDraft(id, entryId, currentActor());
      await refresh();
      state.confirm = null;
      toast(
        `Rollback de rascunho salvo: ${result.draftApproval.paths?.review || 'logs/draft-change-log.md'}.`,
        'success'
      );
      renderShell();
    } catch (error) {
      state.confirm = null;
      toast(error.message || 'Não foi possível restaurar o rascunho.', 'warning');
      renderShell();
    }
  }

  return {
    runAnalysis,
    runEvals,
    publishSuggestion,
    approveProposal,
    generateProposalWithAi,
    generateAdjustmentWithAi,
    syncAdjustmentApprovalButton,
    openManualAdjustment,
    saveManualAdjustment,
    openReturnProposal,
    confirmReturnProposal,
    rollback,
    saveSourceText,
    fileToBase64,
    uploadContextFiles,
    rollbackDraft
  };
}
