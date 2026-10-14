function freshnessFromDate(date, status) {
  if (status !== 'canonico' || !date) return 'neutro';
  const ageInDays = (Date.now() - Date.parse(date)) / 86400000;
  if (!Number.isFinite(ageInDays)) return 'neutro';
  return ageInDays < 183 ? 'verde' : ageInDays < 274 ? 'amarelo' : 'vermelho';
}

function buildProposals(skills) {
  return skills
    .filter((skill) => skill.status !== 'depreciado')
    .flatMap((skill, index) => {
      const aiFindings = skill.aiReview?.findings || [];
      const issues = skill.governanceIssues?.length
        ? skill.governanceIssues
        : skill.evalSummary?.falhou
          ? [`${skill.evalSummary.falhou} eval falhando`]
          : [];
      // A draft ALWAYS surfaces a card — the owner still has to publish it, and the queue card is the
      // only publish entry point. Non-drafts appear only when they have real governance issues —
      // and eval-related ones DON'T count for canonicals: since the gate/score split, eval richness
      // is Selo territory, not a queue pendência (a canonical skill without eval/cases.json is a
      // lower Selo, not work waiting in the Fila).
      const isDraft = skill.status === 'rascunho' || skill.pendingWorkingChanges;
      const cardIssues = isDraft ? issues : issues.filter((issue) => !issue.toLowerCase().includes('eval'));
      const draftProposal =
        isDraft || cardIssues.length
          ? {
              id: `prop-${skill.id}-${index}`,
              skillId: skill.id,
              titulo: isDraft ? `Validar rascunho: ${skill.nome}` : cardIssues[0],
              owner: skill.owner,
              severity: aiFindings[0]?.severity || 'média',
              category: aiFindings[0]?.category || 'governança',
              findings: aiFindings,
              status: 'aguardando owner',
              criadoEm: skill.draftApproval?.updatedAt || skill.lastReviewed || null,
              antes: isDraft
                ? aiFindings.length || issues.length
                  ? `Skill em rascunho no corpus local. Apontamentos: ${(aiFindings.length ? aiFindings.map((item) => item.title) : issues).join('; ')}.`
                  : 'Skill em rascunho no corpus local. Sem apontamentos pendentes — pronta para o owner publicar como canônica.'
                : cardIssues[0],
              depois: skill.aiReview?.ownerActions?.length
                ? skill.aiReview.ownerActions.join(' ')
                : issues.some((issue) => issue.includes('eval'))
                  ? 'Criar eval/cases.json com casos de aceitação por asserção, incluindo pelo menos um caso de recusa.'
                  : issues.length
                    ? 'Completar o frontmatter de governança com status, objetivo, escopo, owner, versão e carimbo de revisão.'
                    : 'Revisar os arquivos e publicar como canônica (a avaliação obrigatória já passou).',
              evalResultado: skill.evalSummary?.total
                ? `passou ${skill.evalSummary.total - skill.evalSummary.falhou}/${skill.evalSummary.total} no modelo ${skill.modelTier}`
                : 'sem eval/cases.json para executar',
              proposalType: 'draft-validation'
            }
          : null;

      const persisted = (skill.changeSuggestions || [])
        .filter(
          (suggestion) =>
            suggestion.shouldApply !== false && !['approved', 'returned', 'rejected'].includes(suggestion.status)
        )
        .map((suggestion, suggestionIndex) => {
          const aiFillAvailable = Boolean(suggestion.aiFillAvailable || suggestion.ai_fill_available);

          return {
            id: `change-${skill.id}-${suggestionIndex}`,
            skillId: skill.id,
            titulo: suggestion.title || `Sugestão para ${skill.nome}`,
            owner: skill.owner,
            severity: suggestion.severity || 'média',
            category: aiFillAvailable ? 'requisito básico pendente' : 'sugestão por feedback',
            findings: [],
            status: aiFillAvailable ? 'aguardando owner' : 'avaliada por IA',
            criadoEm: skill.suggestionReview?.generatedAt || null,
            antes:
              suggestion.rationale ||
              (aiFillAvailable ? 'Campo básico pendente no rascunho.' : 'Sugestão baseada em feedback/mensagem.'),
            depois: aiFillAvailable ? '' : suggestion.proposedChange || '',
            evalResultado: aiFillAvailable ? '' : suggestion.acceptanceCase || '',
            provider: skill.suggestionReview?.provider || 'unknown',
            sourceSuggestionIndex: suggestion.sourceSuggestionIndex ?? suggestionIndex,
            aiFillAvailable,
            aiFillKind: suggestion.aiFillKind || suggestion.ai_fill_kind || null,
            aiGeneratedAt: suggestion.aiGeneratedAt || suggestion.ai_generated_at || null,
            proposalType: aiFillAvailable ? 'basic-requirement' : 'feedback-change'
          };
        });

      return [
        ...(draftProposal ? [draftProposal] : []),
        ...persisted,
        ...(skill.ledger || []).map((entry) => ({
          id: `history-${entry.id}`,
          skillId: skill.id,
          titulo: entry.resumoMudanca || 'Publicação registrada',
          owner: skill.owner,
          status: 'aprovado',
          criadoEm: entry.timestamp,
          depois: entry.resumoMudanca,
          evalResultado: entry.evalResultado,
          history: true,
          version: entry.version
        })),
        ...(skill.changeSuggestions || [])
          .filter((entry) => ['approved', 'returned', 'rejected'].includes(entry.status))
          .map((entry) => ({
            id: `decision-${skill.id}-${entry.sourceSuggestionIndex}`,
            skillId: skill.id,
            titulo: entry.title || 'Sugestão revisada',
            owner: skill.owner,
            status: entry.status === 'approved' ? 'aprovado' : 'devolvido',
            criadoEm: entry.approvedAt || entry.returnedAt || null,
            depois: entry.proposedChange || entry.returnReason || '',
            history: true
          }))
      ];
    });
}

function clone(data) {
  if (data === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(data));
}

export class CorpusDataProvider {
  constructor() {
    this.skills = [];
    this.loadError = null;
    this.loadedAt = null;
    this.pendingLoad = null;
    this.proposals = buildProposals(this.skills);
    this.loadedFromDisk = false;
    this.sourceRoot = null;
  }

  async ensureLoaded() {
    if (this.loadedFromDisk) return;
    if (this.pendingLoad) return this.pendingLoad;
    this.pendingLoad = this.loadCorpus();
    try {
      await this.pendingLoad;
    } finally {
      this.pendingLoad = null;
    }
  }

  async loadCorpus() {
    try {
      const response = await fetch('/api/skills');
      if (!response.ok) throw new Error(`Corpus indisponível (HTTP ${response.status}).`);
      const payload = await response.json();
      if (!Array.isArray(payload.skills)) throw new Error('Resposta do corpus inválida.');
      this.skills = payload.skills;
      this.sourceRoot = payload.root;
      this.proposals = buildProposals(this.skills);
      this.loadedAt = new Date().toISOString();
      this.loadedFromDisk = true;
      this.loadError = null;
    } catch (error) {
      this.loadError = error.message || 'Não foi possível carregar o corpus.';
      // Mantém dados anteriores identificados como desatualizados; uma falha não conclui a carga.
      throw error;
    }
  }

  async reload() {
    this.loadedFromDisk = false;
    await this.ensureLoaded();
  }

  async listSkills() {
    await this.ensureLoaded();
    return clone(this.skills);
  }

  async getSkill(id) {
    await this.ensureLoaded();
    return clone(this.skills.find((skill) => skill.id === id));
  }

  async listProposals() {
    await this.ensureLoaded();
    return clone(this.proposals);
  }

  async updateProposal(proposalId, fields) {
    await this.ensureLoaded();
    const proposal = this.proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      throw new Error('Proposta nao encontrada');
    }

    Object.assign(proposal, {
      titulo: fields.titulo || proposal.titulo,
      antes: fields.antes || proposal.antes,
      depois: fields.depois || proposal.depois,
      evalResultado: fields.evalResultado || proposal.evalResultado,
      status: 'ajustada pelo owner',
      provider: `${proposal.provider || 'unknown'} + owner`,
      manualAdjustedAt: new Date().toISOString()
    });

    return clone(proposal);
  }

  async generateProposalWithAi(proposalId) {
    await this.ensureLoaded();
    const proposal = this.proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      throw new Error('Proposta nao encontrada');
    }

    const response = await fetch('/api/proposals/generate-ai', {
      method: 'post',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillId: proposal.skillId,
        proposal
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Falha ao gerar sugestao com IA');
    }

    Object.assign(proposal, {
      titulo: result.proposal?.titulo || proposal.titulo,
      antes: result.proposal?.antes || proposal.antes,
      depois: result.proposal?.depois || proposal.depois,
      evalResultado: result.proposal?.evalResultado || proposal.evalResultado,
      severity: result.proposal?.severity || proposal.severity,
      status: result.proposal?.status || 'preenchida por IA',
      provider: result.provider || result.proposal?.provider || proposal.provider,
      aiFillAvailable: true,
      aiFillKind: result.proposal?.aiFillKind || proposal.aiFillKind,
      aiGeneratedAt: result.generatedAt || new Date().toISOString()
    });

    return clone(proposal);
  }

  async returnProposal(proposalId, reason) {
    await this.ensureLoaded();
    const proposal = this.proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      throw new Error('Proposta nao encontrada');
    }

    const response = await fetch('/api/return-proposal', {
      method: 'post',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillId: proposal.skillId,
        changeRequest: proposal,
        reason
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Falha ao registrar devolucao');
    }

    this.proposals = this.proposals.filter((item) => item.id !== proposalId);
    this.loadedFromDisk = false;
    return clone(result.returned);
  }

  async runAnalysis(skillId) {
    const skill = this.skills.find((item) => item.id === skillId);
    const response = await fetch('/api/analyze', {
      method: 'post',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skill,
        feedback: skill.feedback,
        metrics: skill.metricas
      })
    });
    const report = await response.json();
    skill.relatorio = report;
    return clone(report);
  }

  async runEvals(skillId) {
    const skill = this.skills.find((item) => item.id === skillId);
    const response = await fetch('/api/run-evals', {
      method: 'post',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillId,
        cases: skill.evals
      })
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.error || 'Falha ao avaliar a skill.');
    return result;
  }

  async saveSkillSource(skillId, sourceText, editedBy = 'owner') {
    const response = await fetch('/api/skill-source/save', {
      method: 'post',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillId,
        sourceText,
        editedBy
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Falha ao salvar texto atual');
    }

    this.loadedFromDisk = false;
    return clone(result);
  }

  async uploadContextFiles(skillId, targetKind, files, uploadedBy = 'owner') {
    const response = await fetch('/api/skill-source/upload-context', {
      method: 'post',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillId,
        targetKind,
        files,
        uploadedBy
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Falha ao enviar arquivos de contexto');
    }

    this.loadedFromDisk = false;
    return clone(result);
  }

  async rollbackDraft(skillId, entryId, rolledBackBy = 'owner') {
    const response = await fetch('/api/skill-source/rollback-draft', {
      method: 'post',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillId,
        entryId,
        rolledBackBy
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Falha ao restaurar snapshot do rascunho');
    }

    this.loadedFromDisk = false;
    return clone(result);
  }

  async writePublication(endpoint, payload) {
    // A mesma tentativa conserva o ID quando a resposta falha depois de gravar no disco.
    this.publicationRequests ||= new Map();
    const key = JSON.stringify([endpoint, payload]);
    const operationId = this.publicationRequests.get(key) || crypto.randomUUID();
    this.publicationRequests.set(key, operationId);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, operationId })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Não foi possível concluir a publicação.');
    this.publicationRequests.delete(key);
    this.loadedFromDisk = false;
    const skill = this.skills.find((item) => item.id === payload.skillId);
    return clone({ ...skill, canonical: result.publication, version: result.publication.version });
  }

  async publishVersion(skillId, summary, changeRequest = null) {
    return this.writePublication('/api/publish', { skillId, ledgerEntry: { resumoMudanca: summary }, changeRequest });
  }

  async rollback(skillId, targetVersion) {
    return this.writePublication('/api/rollback', { skillId, targetVersion });
  }

  async approveRequirement(proposal) {
    const response = await fetch('/api/approve-requirement', {
      method: 'post',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillId: proposal.skillId,
        changeRequest: proposal
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Falha ao salvar requisito no rascunho');
    }

    this.loadedFromDisk = false;
    return clone(result);
  }

  async approveProposal(proposalId) {
    const proposal = this.proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      throw new Error('Proposta nao encontrada');
    }

    if (proposal.canPromote === false) {
      if (!String(proposal.depois || '').trim()) {
        throw new Error(
          proposal.aiFillAvailable
            ? 'Gere com IA ou preencha manualmente o campo Depois antes de salvar o requisito.'
            : 'Preencha manualmente o campo Depois antes de salvar no rascunho.'
        );
      }

      const result = await this.approveRequirement(proposal);
      this.proposals = this.proposals.filter((item) => item.id !== proposalId);
      return clone({
        draftApproval: result.draftApproval
      });
    }

    const skill = await this.publishVersion(proposal.skillId, proposal.titulo, proposal);
    this.proposals = this.proposals.filter((item) => item.id !== proposalId);
    return clone(skill);
  }
}

// TODO: trocar por Microsoft Graph (MSAL) - ler/escrever SKILL.md, eval/, versions/ no OneDrive.
// TODO: chamar o provedor de IA (via proxy) para a analise do agente e o teste de eval.
