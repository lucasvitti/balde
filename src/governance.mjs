// Avaliação heurística auxiliar; o gate de publicação usa o checklist governado.

export function normalizeText(value = '') {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export function reviewItem(id, label, passed, severity, category, finding, recommendation, evidence = '') {
  return {
    checklist: {
      id,
      label,
      status: passed ? 'passou' : severity === 'baixa' ? 'atenção' : 'falhou'
    },
    finding: passed
      ? null
      : {
          id,
          severity,
          category,
          title: finding,
          evidence,
          recommendation
        }
  };
}

// The hardcoded "minimum requirements" gate was removed — its checks now live in the admin-editable
// eval checklist (Config › Checklist de qualidade), which is the SINGLE Blueprint→Canônica gate.
// `localDraftReview` below stays: it feeds the advisory AI draft-review findings, not a promotion gate.

export function localDraftReview(skill, context) {
  const { meta, body, files, evals } = context;
  const text = normalizeText(`${body}\n${meta.description || ''}`);
  const hasOutputSchema = files.some((file) => file.endsWith('output_schema.json'));
  const hasRefusalLanguage =
    text.includes('nao invente') || text.includes('responda apenas') || text.includes('recuse');
  const hasRole = text.includes('voce e') || text.includes('you are');
  const hasPtBr = text.includes('pt-br') || text.includes('portugues') || /[ãõçáéíóú]/i.test(body);
  const hasGovernanceFrontmatter = Boolean(meta.status && meta.objetivo && meta.escopo);
  const hasOwnerVersionReview = Boolean(
    meta.owner && meta.version && (meta.last_reviewed || meta.data_updated || meta.timestamp)
  );
  const hasRefusalEval = evals.some((item) => item.mustRefuse);
  const hasEmbeddedSecret =
    /(sk-[a-zA-Z0-9_-]{16,}|api[_-]?key\s*[:=]\s*["']?[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}|senha\s*[:=]|password\s*[:=])/i.test(
      `${body}\n${JSON.stringify(meta)}`
    );

  const checks = [
    reviewItem(
      'frontmatter-governanca',
      'Frontmatter com status, objetivo e escopo',
      hasGovernanceFrontmatter,
      'alta',
      'frontmatter',
      'Campos de governança ainda não estão declarados no SKILL.md.',
      'Adicionar status: rascunho, objetivo, escopo, owner, last_reviewed e version antes de enviar para canonização.',
      'status/objetivo/escopo ausentes ou incompletos'
    ),
    reviewItem(
      'owner-version-review',
      'Owner, versão e carimbo de revisão declarados',
      hasOwnerVersionReview,
      'alta',
      'frontmatter',
      'Owner, version ou last_reviewed ainda não estão completos no SKILL.md.',
      'Adicionar owner, version e last_reviewed no frontmatter antes de promover para canônico.',
      'owner/version/last_reviewed ausentes ou incompletos'
    ),
    reviewItem(
      'papel-contexto',
      'Papel e contexto claros no prompt',
      hasRole,
      'média',
      'prompt',
      'O prompt não deixa o papel do agente suficientemente explícito.',
      'Abrir a skill com uma frase de papel clara, por exemplo: "Você é um analista sênior..."',
      'não foi encontrado padrão "Você é" ou equivalente'
    ),
    reviewItem(
      'nao-invento-numeros',
      'Bloco "não invento números" ou recusa equivalente',
      hasRefusalLanguage,
      'alta',
      'segurança analítica',
      'A regra de não fabricar dados precisa ficar explícita.',
      'Incluir instrução direta para recusar quando dados, colunas, períodos ou fontes não estiverem no contexto.',
      'não foi encontrada regra forte de recusa ou "não invente"'
    ),
    reviewItem(
      'output-schema',
      'Schema explícito quando a saída é estruturada',
      meta.output_format !== 'structured' || hasOutputSchema,
      'alta',
      'schema',
      'A skill gera saída estruturada, mas não tem output_schema.json.',
      'Criar output_schema.json e alinhar o prompt para emitir JSON puro no formato esperado.',
      'output_format: structured sem output_schema.json'
    ),
    reviewItem(
      'sem-dados-sensiveis',
      'Sem segredo ou credencial embutida no prompt',
      !hasEmbeddedSecret,
      'alta',
      'segurança',
      'O rascunho parece conter segredo, token ou credencial embutida.',
      'Remover qualquer chave, token, senha ou segredo do SKILL.md e referenciar somente arquivos/segredos de runtime.',
      'padrão de segredo/credencial encontrado'
    ),
    reviewItem(
      'eval-cases',
      'Casos de aceitação UAT por asserção',
      evals.length > 0,
      'alta',
      'eval',
      'Não existe eval/cases.json para validar a skill.',
      'Criar casos de aceitação por asserção: schema_valid, linhas requeridas, tolerância numérica e recusa.',
      'eval/cases.json não encontrado'
    ),
    reviewItem(
      'eval-recusa',
      'Pelo menos um caso de recusa no UAT',
      hasRefusalEval,
      'alta',
      'eval',
      'O conjunto de UAT não cobre recusa.',
      'Adicionar um caso must_refuse para pedido fora de escopo ou sem dados suficientes.',
      evals.length ? 'casos existem, mas nenhum must_refuse' : 'sem arquivo de eval'
    ),
    reviewItem(
      'idioma-ptbr',
      'Instruções em pt-BR',
      hasPtBr,
      'baixa',
      'linguagem',
      'A skill pode não estar alinhada ao idioma padrão do usuário.',
      'Padronizar instruções principais em português do Brasil.',
      'não há sinal claro de pt-BR no prompt'
    )
  ];

  const checklist = checks.map((item) => item.checklist);
  const feedbackFindings = (context.wrongFeedbacks || []).slice(0, 5).map((item, index) => {
    const duplicateText = item.duplicateCount > 1 ? ` (${item.duplicateCount} ocorrencias iguais agrupadas)` : '';

    return {
      id: `wrong-feedback-${index + 1}`,
      severity: 'alta',
      category: 'feedback errado',
      title: `Resposta marcada como Errado por ${item.user || 'usuário'}`,
      evidence: `Pergunta: ${item.question || '(sem pergunta registrada)'}${duplicateText}`,
      recommendation: item.suggestion,
      question: item.question,
      answer: item.answer,
      timestamp: item.timestamp,
      duplicateCount: item.duplicateCount || 1,
      occurrences: item.occurrences || [],
      sourceFile: item.sourceFile
    };
  });
  const findings = [...checks.map((item) => item.finding).filter(Boolean), ...feedbackFindings];
  const highCount = findings.filter((item) => item.severity === 'alta').length;
  const mediumCount = findings.filter((item) => item.severity === 'média').length;
  const score = Math.max(20, 100 - highCount * 14 - mediumCount * 8 - findings.length * 3);

  return {
    provider: 'heuristic-local-governance-validator',
    status: findings.length ? 'needs_owner_review' : 'ready_for_curator',
    generatedAt: new Date().toISOString(),
    score,
    summary: findings.length
      ? `Rascunho precisa de ${findings.length} ajuste(s) antes de seguir para curadoria.`
      : 'Rascunho aderente ao checklist mínimo de governança.',
    checklist,
    findings,
    ownerActions: findings.slice(0, 4).map((item) => item.recommendation)
  };
}
