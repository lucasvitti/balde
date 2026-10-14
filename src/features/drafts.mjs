import { readPublication, publishSnapshot, hasWorkingChanges } from '../governance/publication-store.mjs';
import { operationKey } from '../governance/operations.mjs';
import { localIdentity } from '../security/local-session.mjs';
import { atomicJson } from '../storage/atomic-files.mjs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { generateGovernanceSuggestions } from '../../scripts/generate-governance-suggestions.mjs';
import {
  parseFrontmatter,
  assertSafeSkillId,
  assertSafeUploadName,
  assertContextTargetKind,
  safeSlug,
  fileStamp,
  nextPatchVersion,
  upsertFrontmatter,
  extractFencedBlock,
  parseFrontmatterSuggestion,
  parseJsonSuggestion
} from '../skill-format.mjs';
import { rootDir, skillsRoot, feedbackRoot, governanceOutputRoot, feedbackPollMs } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { listRelativeFiles, loadEvalCases } from '../skill-helpers.mjs';
import { normalizeText, localDraftReview } from '../governance.mjs';

export function createDraftsFeature({
  stripMarkdown,
  inferObjective,
  inferScope,
  inferModelTier,
  inferAiFillKind,
  callDepartmentProxy,
  loadWrongFeedbackBySkill,
  buildLocalProposalCompletion,
  normalizeProposalCompletion
}) {
  function draftDirForSkill(skillId) {
    assertSafeSkillId(skillId);
    return join(governanceOutputRoot(), skillId, 'rascunho');
  }

  async function listMergedRelativeFiles(sourceDir, draftDir) {
    const files = new Set(await listRelativeFiles(sourceDir));
    if (await pathExists(draftDir)) {
      for (const file of await listRelativeFiles(draftDir)) {
        files.add(file);
      }
    }
    return [...files].sort((a, b) => a.localeCompare(b));
  }

  async function loadPreferredEvalCases(sourceDir, draftDir) {
    if (await pathExists(join(draftDir, 'eval', 'cases.json'))) {
      return loadEvalCases(draftDir);
    }
    return loadEvalCases(sourceDir);
  }

  async function loadSkillWorkingContext(skillId) {
    assertSafeSkillId(skillId);
    const sourceDir = join(skillsRoot(), skillId);
    const sourceSkillPath = join(sourceDir, 'SKILL.md');
    if (!(await pathExists(sourceSkillPath))) {
      throw new Error(`SKILL.md nao encontrado para ${skillId}`);
    }

    const draftDir = draftDirForSkill(skillId);
    const draftSkillPath = join(draftDir, 'SKILL.md');
    const hasDraft = await pathExists(draftSkillPath);
    const skillPath = hasDraft ? draftSkillPath : sourceSkillPath;
    const markdown = await readFile(skillPath, 'utf8');
    const { meta, body } = parseFrontmatter(markdown);
    const files = await listMergedRelativeFiles(sourceDir, draftDir);
    const evals = await loadPreferredEvalCases(sourceDir, draftDir);
    const fileStat = await stat(skillPath);

    return {
      skillId,
      sourceDir,
      sourceSkillPath,
      draftDir,
      draftSkillPath,
      hasDraft,
      skillDir: hasDraft ? draftDir : sourceDir,
      skillPath,
      markdown,
      meta,
      body,
      files,
      evals,
      fileStat
    };
  }

  async function loadSkillConsumerContext(skillId) {
    assertSafeSkillId(skillId);
    const published = await readPublication(join(governanceOutputRoot(), skillId));
    if (!published)
      return { ...(await loadSkillWorkingContext(skillId)), contentState: 'draft', pendingWorkingChanges: true };
    const skillPath = join(published.directory, 'SKILL.md');
    const markdown = await readFile(skillPath, 'utf8');
    const { meta, body } = parseFrontmatter(markdown);
    const working = await loadSkillWorkingContext(skillId);
    return {
      skillId,
      sourceDir: published.directory,
      sourceSkillPath: skillPath,
      draftDir: published.directory,
      draftSkillPath: skillPath,
      hasDraft: false,
      skillDir: published.directory,
      skillPath,
      markdown,
      meta,
      body,
      // Snapshots da 2.0.16 levaram o publication.lock junto; não é arquivo da skill.
      files: (await listRelativeFiles(published.directory)).filter(
        (path) => path !== 'metadata.json' && path !== 'publication.lock'
      ),
      evals: await loadEvalCases(published.directory),
      fileStat: await stat(skillPath),
      contentState: 'published',
      pendingWorkingChanges: await hasWorkingChanges(
        published,
        working.sourceDir,
        working.hasDraft ? working.draftDir : null
      )
    };
  }

  function relativeProjectPath(path) {
    return path.startsWith(rootDir)
      ? path
          .slice(rootDir.length)
          .replace(/^[/\\]/, '')
          .replaceAll('\\', '/')
      : path.replaceAll('\\', '/');
  }

  function renderApprovalBlock(publication) {
    const change = publication.changeRequest || {};
    return [
      `### ${publication.approvedAt.slice(0, 10)} - ${publication.summary}`,
      '',
      `- versao canonica: ${publication.version}`,
      `- versao anterior/legado: ${publication.previousVersion}`,
      `- aprovado por: ${publication.approvedBy}`,
      `- origem: ${change.provider || change.status || 'owner review'}`,
      `- severidade: ${change.severity || 'nao informada'}`,
      '',
      '**Mudanca aprovada**',
      '',
      change.depois || change.proposedChange || publication.summary,
      '',
      '**Caso de aceite**',
      '',
      change.evalResultado || change.acceptanceCase || 'Caso de aceite nao informado.'
    ].join('\n');
  }

  function applyApprovedChange(markdown, publication) {
    const canonical = upsertFrontmatter(markdown, {
      status: 'canonico',
      version: publication.version,
      last_reviewed: publication.approvedAt.slice(0, 10)
    });
    const heading = '## Alteracoes canonizadas pelo owner';
    const block = renderApprovalBlock(publication);

    if (canonical.includes(`\n${heading}`)) {
      return `${canonical.trimEnd()}\n\n${block}\n`;
    }

    return `${canonical.trimEnd()}\n\n${heading}\n\n${block}\n`;
  }

  function renderCodeReviewMarkdown(publication) {
    const change = publication.changeRequest || {};
    const before = change.antes || change.rationale || 'Contexto anterior nao informado pela proposta.';
    const after = change.depois || change.proposedChange || publication.summary;
    const acceptance = change.evalResultado || change.acceptanceCase || 'Caso de aceite nao informado.';
    const writtenFiles = [
      `- canonico: ${publication.paths.canonico}`,
      publication.paths.canonicalEvalCases ? `- eval canonico: ${publication.paths.canonicalEvalCases}` : null,
      publication.paths.canonicalOutputSchema
        ? `- output schema canonico: ${publication.paths.canonicalOutputSchema}`
        : null,
      `- legado: ${publication.paths.legado}`,
      publication.paths.legacyEvalCases ? `- eval legado: ${publication.paths.legacyEvalCases}` : null,
      publication.paths.legacyOutputSchema ? `- output schema legado: ${publication.paths.legacyOutputSchema}` : null,
      publication.paths.legacyMetadata ? `- metadata legado: ${publication.paths.legacyMetadata}` : null,
      `- change log: ${publication.paths.changeLogMarkdown}`
    ].filter(Boolean);

    return [
      `# Code review - ${publication.skillId} v${publication.version}`,
      '',
      `- status: aprovado para canonizacao`,
      `- data: ${publication.approvedAt}`,
      `- aprovado por: ${publication.approvedBy}`,
      `- versao anterior: ${publication.previousVersion}`,
      `- versao canonica: ${publication.version}`,
      `- acao: ${publication.action}`,
      '',
      '## Arquivos gravados',
      '',
      ...writtenFiles,
      '',
      '## Resumo da alteracao',
      '',
      publication.summary,
      '',
      '## Antes',
      '',
      before,
      '',
      '## Depois',
      '',
      after,
      '',
      '## Caso de aceite',
      '',
      acceptance,
      '',
      '## Parecer de code review',
      '',
      '- A decisao do owner foi registrada em log append-only dentro do projeto.',
      '- A versao anterior foi preservada no legado antes da escrita da nova versao canonica.',
      '- A versao canonica recebeu os artefatos governados aprovados quando disponiveis.',
      '- O diretorio original de rascunhos do RevHub nao foi sobrescrito por este fluxo.',
      '',
      '## Checklist',
      '',
      '- [x] Snapshot legado salvo',
      '- [x] SKILL.md canonico gravado',
      '- [x] Artefatos auxiliares preservados quando existiam',
      '- [x] Change log atualizado',
      '- [x] Review markdown gerado',
      '- [ ] Patch aplicado no diretorio original do RevHub'
    ].join('\n');
  }

  function renderChangeLogMarkdown(entries) {
    const lines = ['# Change log de canonizacao', ''];
    for (const entry of [...entries].reverse()) {
      lines.push(`## ${entry.approvedAt.slice(0, 10)} - v${entry.version}`);
      lines.push('');
      lines.push(`- resumo: ${entry.summary}`);
      lines.push(`- aprovado por: ${entry.approvedBy}`);
      lines.push(`- versao anterior: ${entry.previousVersion}`);
      lines.push(`- review: ${entry.paths.review}`);
      lines.push(`- legado: ${entry.paths.legado}`);
      lines.push('');
    }

    return `${lines.join('\n').trimEnd()}\n`;
  }

  async function readJsonFile(path, fallback) {
    if (!(await pathExists(path))) {
      return fallback;
    }

    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return fallback;
    }
  }

  async function loadPublicationEntries(skillId) {
    assertSafeSkillId(skillId);
    const logJsonPath = join(governanceOutputRoot(), skillId, 'logs', 'change-log.json');
    const parsed = await readJsonFile(logJsonPath, { entries: [] });
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  }

  async function loadDraftEntries(skillId) {
    assertSafeSkillId(skillId);
    const logJsonPath = join(governanceOutputRoot(), skillId, 'logs', 'draft-change-log.json');
    const parsed = await readJsonFile(logJsonPath, { entries: [] });
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  }

  async function loadCanonicalState(skillId) {
    assertSafeSkillId(skillId);
    const published = await readPublication(join(governanceOutputRoot(), skillId));
    if (!published) return null;
    const metadata = published.metadata;

    const entries = await loadPublicationEntries(skillId);
    const ledger = entries
      .slice()
      .reverse()
      .map((entry) => ({
        id: entry.id,
        version: entry.version,
        timestamp: entry.approvedAt.slice(0, 10),
        autor: entry.author,
        resumoMudanca: entry.summary,
        evalResultado:
          entry.changeRequest?.evalResultado || entry.changeRequest?.acceptanceCase || 'sem eval registrado',
        aprovadoPor: entry.approvedBy,
        versaoPai: entry.previousVersion,
        status: entry.action === 'rollback' ? 'rollback' : 'publicada',
        reviewPath: entry.paths.review,
        canonicalPath: entry.paths.canonico,
        legacyPath: entry.paths.legado
      }));

    return {
      ...metadata,
      entries,
      ledger
    };
  }

  async function markSuggestionApproved(skillId, changeRequest, publication) {
    if (!changeRequest?.id) {
      return;
    }

    const suggestionPath = join(governanceOutputRoot(), skillId, 'suggestions.json');
    if (!(await pathExists(suggestionPath))) {
      return;
    }

    const parsed = await readJsonFile(suggestionPath, null);
    if (!parsed?.suggestions?.length) {
      return;
    }

    const suggestionPrefix = `change-${skillId}-`;
    let suggestionIndex = String(changeRequest.id).startsWith(suggestionPrefix)
      ? Number(String(changeRequest.id).slice(suggestionPrefix.length))
      : -1;
    const changeTitle = changeRequest.titulo || changeRequest.title;
    if (
      suggestionIndex < 0 ||
      !parsed.suggestions[suggestionIndex] ||
      (changeTitle && parsed.suggestions[suggestionIndex].title !== changeTitle)
    ) {
      suggestionIndex = parsed.suggestions.findIndex((item) => item.title === changeTitle);
    }

    if (suggestionIndex < 0 || !parsed.suggestions[suggestionIndex]) {
      return;
    }

    parsed.suggestions[suggestionIndex] = {
      ...parsed.suggestions[suggestionIndex],
      status: 'approved',
      approvedAt: publication.approvedAt,
      approvedBy: publication.approvedBy,
      approvedVersion: publication.version,
      reviewPath: publication.paths.review
    };

    await writeFile(suggestionPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  }

  async function markSuggestionReturned(skillId, changeRequest, returned) {
    if (!changeRequest?.id) {
      return;
    }

    const suggestionPath = join(governanceOutputRoot(), skillId, 'suggestions.json');
    if (!(await pathExists(suggestionPath))) {
      return;
    }

    const parsed = await readJsonFile(suggestionPath, null);
    if (!parsed?.suggestions?.length) {
      return;
    }

    const suggestionPrefix = `change-${skillId}-`;
    let suggestionIndex = String(changeRequest.id).startsWith(suggestionPrefix)
      ? Number(String(changeRequest.id).slice(suggestionPrefix.length))
      : -1;
    const changeTitle = changeRequest.titulo || changeRequest.title;
    if (
      suggestionIndex < 0 ||
      !parsed.suggestions[suggestionIndex] ||
      (changeTitle && parsed.suggestions[suggestionIndex].title !== changeTitle)
    ) {
      suggestionIndex = parsed.suggestions.findIndex((item) => item.title === changeTitle);
    }

    if (suggestionIndex < 0 || !parsed.suggestions[suggestionIndex]) {
      return;
    }

    parsed.suggestions[suggestionIndex] = {
      ...parsed.suggestions[suggestionIndex],
      status: 'returned',
      returnedAt: returned.returnedAt,
      returnedBy: returned.returnedBy,
      returnReason: returned.reason,
      reviewPath: returned.paths.review
    };

    await writeFile(suggestionPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  }

  async function persistSkillPublication({
    skillId,
    ledgerEntry = {},
    changeRequest = {},
    action,
    operationId,
    queueItemId = null,
    actor = {},
    targetVersion = null
  }) {
    assertSafeSkillId(skillId);
    if (action === 'rollback' && !targetVersion) throw new Error('Informe a versão publicada de destino.');
    const working = await loadSkillWorkingContext(skillId);
    const governanceDirectory = join(governanceOutputRoot(), skillId);
    const id =
      operationId ||
      operationKey(`${skillId}:${working.markdown}:${JSON.stringify(ledgerEntry)}:${JSON.stringify(changeRequest)}`);
    const publication = await publishSnapshot({
      governanceDirectory,
      sourceDirectory: working.sourceDir,
      draftDirectory: working.hasDraft ? working.draftDir : null,
      operationId: id,
      rollbackVersion: action === 'rollback' ? targetVersion : null,
      buildPublication: (previous, markdown) => {
        const previousVersion = previous?.version || parseFrontmatter(markdown).meta.version || '0.0.0';
        const version = nextPatchVersion(previousVersion);
        return {
          id,
          skillId,
          queueItemId,
          action,
          version,
          previousVersion,
          approvedAt: new Date().toISOString(),
          approvedBy: actor.name || actor.email || localIdentity().email,
          author: actor.name || actor.email || localIdentity().email,
          summary: ledgerEntry.resumoMudanca || changeRequest?.titulo || 'Publicação aprovada pelo curador',
          changeRequest,
          paths: { review: '', legado: previous?.paths?.canonico || '' }
        };
      },
      renderMarkdown: applyApprovedChange
    });
    const logDirectory = join(governanceDirectory, 'logs');
    const entries = await loadPublicationEntries(skillId);
    if (!entries.some((entry) => entry.id === publication.id)) entries.push(publication);
    await atomicJson(join(logDirectory, 'change-log.json'), { entries });
    await writeFile(join(logDirectory, 'change-log.md'), renderChangeLogMarkdown(entries), 'utf8');
    await markSuggestionApproved(skillId, changeRequest || {}, publication);
    return publication;
  }

  function markdownHeadingPattern(heading) {
    return heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function upsertMarkdownSection(markdown, heading, content) {
    const cleanContent = String(content || '').trim();
    const section = `## ${heading}\n\n${cleanContent}\n`;
    const pattern = new RegExp(`(^|\\n)##\\s+${markdownHeadingPattern(heading)}\\s*\\n[\\s\\S]*?(?=\\n##\\s+|$)`, 'i');

    if (pattern.test(markdown)) {
      return markdown.replace(pattern, (match, prefix) => `${prefix}${section.trimEnd()}`);
    }

    const frontmatterMatch = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (frontmatterMatch) {
      const before = frontmatterMatch[0].trimEnd();
      const after = markdown.slice(frontmatterMatch[0].length).replace(/^\s+/, '');
      return `${before}\n\n${section}\n${after}`.trimEnd();
    }

    return `${section}\n${markdown.replace(/^\s+/, '')}`.trimEnd();
  }

  function cleanTextRequirementContent(value = '', kind = 'generic') {
    let content = extractFencedBlock(value);
    const directivePatterns = [
      /^adicionar\s+no\s+in[ií]cio\s+do\s+skill\.md\s*:?\s*/i,
      /^adicionar\s+bloco\s+de\s+seguran[cç]a\s+anal[ií]tica\s*:?\s*/i,
      /^adicionar\s+ao\s+prompt\s*:?\s*/i,
      /^incluir\s+no\s+prompt\s*:?\s*/i
    ];

    for (const pattern of directivePatterns) {
      content = content.replace(pattern, '').trim();
    }

    if (kind === 'role_context' && !normalizeText(content).includes('voce e')) {
      content = `Você é o agente responsável por executar esta skill dentro do objetivo aprovado.\n\n${content}`.trim();
    }

    return content;
  }

  function applySmartTextRequirementPatch(markdown, changeRequest, kind) {
    const content = cleanTextRequirementContent(changeRequest.depois || changeRequest.proposedChange || '', kind);
    const targets = {
      role_context: 'Papel e contexto',
      refusal_rule: 'Segurança analítica e recusa',
      generic: 'Ajuste aprovado pelo owner'
    };
    const heading = targets[kind] || targets.generic;

    return {
      markdown: upsertMarkdownSection(markdown, heading, content),
      patch: {
        operation: 'upsert_section',
        heading,
        kind
      }
    };
  }

  function buildFrontmatterFieldsForRequirement(context, changeRequest) {
    const parsed = parseFrontmatterSuggestion(changeRequest.depois || changeRequest.proposedChange || '');
    const current = context.meta;
    const body = context.body;

    return {
      name: parsed.name || current.name || context.skillId,
      description: parsed.description || current.description || stripMarkdown(body).slice(0, 220),
      status: parsed.status || 'rascunho',
      objetivo:
        parsed.objetivo || parsed.objective || current.objetivo || inferObjective(current, body, context.skillId),
      escopo: parsed.escopo || parsed.scope || current.escopo || inferScope(current, body),
      owner: parsed.owner || current.owner || 'owner-nao-definido@exemplo.com',
      last_reviewed:
        parsed.last_reviewed ||
        parsed.data_updated ||
        current.last_reviewed ||
        current.data_updated ||
        new Date().toISOString().slice(0, 10),
      model_tier: parsed.model_tier || current.model_tier || inferModelTier(current),
      version: parsed.version || current.version || '1.0.0'
    };
  }

  function renderDraftRequirementReview(approval) {
    const change = approval.changeRequest || {};
    return [
      `# Code review - ${approval.skillId} requisito aprovado`,
      '',
      '- status: salvo no rascunho governado',
      `- data: ${approval.approvedAt}`,
      `- aprovado por: ${approval.approvedBy}`,
      `- tipo: ${approval.requirementKind}`,
      '',
      '## Arquivos gravados',
      '',
      `- legado anterior: ${approval.paths.legado}`,
      `- rascunho: ${approval.paths.draftSkill}`,
      approval.paths.evalCases ? `- eval: ${approval.paths.evalCases}` : null,
      approval.paths.outputSchema ? `- output schema: ${approval.paths.outputSchema}` : null,
      approval.paths.patch ? `- patch: ${approval.paths.patch}` : null,
      `- review: ${approval.paths.review}`,
      `- log: ${approval.paths.changeLogMarkdown}`,
      '',
      '## Antes',
      '',
      change.antes || change.rationale || 'Contexto anterior nao informado pela proposta.',
      '',
      '## Depois',
      '',
      change.depois || change.proposedChange || 'Mudanca proposta nao informada.',
      '',
      '## Caso de aceite',
      '',
      change.evalResultado || change.acceptanceCase || 'Caso de aceite nao informado.'
    ]
      .filter((line) => line !== null)
      .join('\n');
  }

  function renderDraftRequirementLog(entries) {
    const lines = ['# Change log de requisitos do rascunho', ''];
    for (const entry of [...entries].reverse()) {
      lines.push(`## ${entry.approvedAt.slice(0, 10)} - ${entry.summary}`);
      lines.push('');
      lines.push(`- tipo: ${entry.requirementKind}`);
      lines.push(`- aprovado por: ${entry.approvedBy}`);
      lines.push(`- legado: ${entry.paths.legado}`);
      lines.push(`- review: ${entry.paths.review}`);
      lines.push('');
    }
    return `${lines.join('\n').trimEnd()}\n`;
  }

  async function readFirstExisting(paths) {
    for (const path of paths) {
      if (await pathExists(path)) {
        return {
          path,
          content: await readFile(path, 'utf8')
        };
      }
    }

    return null;
  }

  async function firstExistingDirectory(paths) {
    for (const path of paths) {
      if (!(await pathExists(path))) {
        continue;
      }

      const info = await stat(path);
      if (info.isDirectory()) {
        return path;
      }
    }

    return null;
  }

  async function copyOptionalDirectory(sourcePaths, targetPath) {
    const sourcePath = await firstExistingDirectory(sourcePaths);
    if (!sourcePath) {
      return null;
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { recursive: true });
    return relativeProjectPath(targetPath);
  }

  async function writeOptionalTextArtifact(sourcePaths, targetPath) {
    const snapshot = await readFirstExisting(sourcePaths);
    if (!snapshot) {
      return null;
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, snapshot.content, 'utf8');
    return relativeProjectPath(targetPath);
  }

  async function persistDraftLegacySnapshot({ skillId, context, stamp, kind, summary }) {
    const legacyDir = join(
      governanceOutputRoot(),
      skillId,
      'legado',
      `${stamp}-draft-${safeSlug(kind)}-${safeSlug(summary)}`
    );
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, 'SKILL.md'), `${context.markdown.trimEnd()}\n`, 'utf8');

    const evalSnapshot = await readFirstExisting([
      join(context.draftDir, 'eval', 'cases.json'),
      join(context.sourceDir, 'eval', 'cases.json')
    ]);
    if (evalSnapshot) {
      await mkdir(join(legacyDir, 'eval'), { recursive: true });
      await writeFile(join(legacyDir, 'eval', 'cases.json'), evalSnapshot.content, 'utf8');
    }

    const outputSchemaSnapshot = await readFirstExisting([
      join(context.draftDir, 'output_schema.json'),
      join(context.sourceDir, 'output_schema.json')
    ]);
    if (outputSchemaSnapshot) {
      await writeFile(join(legacyDir, 'output_schema.json'), outputSchemaSnapshot.content, 'utf8');
    }

    const analyticsSnapshot = await copyOptionalDirectory(
      [join(context.draftDir, 'analytics'), join(context.sourceDir, 'analytics')],
      join(legacyDir, 'analytics')
    );
    const querySnapshot = await copyOptionalDirectory(
      [join(context.draftDir, 'query'), join(context.sourceDir, 'query')],
      join(legacyDir, 'query')
    );

    const metadata = {
      skillId,
      kind,
      summary,
      capturedAt: new Date().toISOString(),
      source: context.hasDraft ? 'rascunho-governado' : 'revhub-original',
      sourceSkillPath: context.skillPath,
      files: {
        skill: 'SKILL.md',
        evalCases: evalSnapshot ? 'eval/cases.json' : null,
        outputSchema: outputSchemaSnapshot ? 'output_schema.json' : null,
        analytics: analyticsSnapshot ? 'analytics' : null,
        query: querySnapshot ? 'query' : null
      }
    };
    await writeFile(join(legacyDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

    return {
      dir: relativeProjectPath(legacyDir),
      skill: relativeProjectPath(join(legacyDir, 'SKILL.md')),
      evalCases: evalSnapshot ? relativeProjectPath(join(legacyDir, 'eval', 'cases.json')) : null,
      outputSchema: outputSchemaSnapshot ? relativeProjectPath(join(legacyDir, 'output_schema.json')) : null,
      analytics: analyticsSnapshot,
      query: querySnapshot,
      metadata: relativeProjectPath(join(legacyDir, 'metadata.json'))
    };
  }

  async function persistDraftRequirementApproval({ skillId, changeRequest = {} }) {
    assertSafeSkillId(skillId);
    const context = await loadSkillWorkingContext(skillId);
    const draftDir = draftDirForSkill(skillId);
    const logsDir = join(governanceOutputRoot(), skillId, 'logs');
    const draftSkillPath = join(draftDir, 'SKILL.md');
    const evalPath = join(draftDir, 'eval', 'cases.json');
    const outputSchemaPath = join(draftDir, 'output_schema.json');
    await mkdir(draftDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });

    const kind = inferAiFillKind(changeRequest);
    const approvedAt = new Date().toISOString();
    const stamp = fileStamp(new Date(approvedAt));
    const summary = changeRequest.titulo || 'Requisito minimo aprovado pelo owner';
    const legacySnapshot = await persistDraftLegacySnapshot({
      skillId,
      context,
      stamp,
      kind,
      summary
    });
    let nextMarkdown = context.markdown;
    const writtenPaths = {
      legado: legacySnapshot.dir,
      draftSkill: relativeProjectPath(draftSkillPath)
    };
    let patch = null;

    if (kind === 'frontmatter') {
      nextMarkdown = upsertFrontmatter(context.markdown, buildFrontmatterFieldsForRequirement(context, changeRequest));
      patch = {
        operation: 'upsert_frontmatter',
        fields: Object.keys(buildFrontmatterFieldsForRequirement(context, changeRequest))
      };
    } else if (kind === 'eval_cases') {
      const evalCases = parseJsonSuggestion(changeRequest.depois || changeRequest.proposedChange || '');
      await mkdir(join(draftDir, 'eval'), { recursive: true });
      await writeFile(evalPath, `${JSON.stringify(evalCases, null, 2)}\n`, 'utf8');
      writtenPaths.evalCases = relativeProjectPath(evalPath);
      patch = {
        operation: 'write_json',
        path: writtenPaths.evalCases
      };
    } else if (kind === 'output_schema') {
      const schema = parseJsonSuggestion(changeRequest.depois || changeRequest.proposedChange || '');
      await writeFile(outputSchemaPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
      writtenPaths.outputSchema = relativeProjectPath(outputSchemaPath);
      patch = {
        operation: 'write_json',
        path: writtenPaths.outputSchema
      };
    } else {
      const patched = applySmartTextRequirementPatch(context.markdown, changeRequest, kind);
      nextMarkdown = patched.markdown;
      patch = patched.patch;
    }

    await writeFile(draftSkillPath, `${nextMarkdown.trimEnd()}\n`, 'utf8');

    const reviewPath = join(logsDir, `code-review-${stamp}-draft-${safeSlug(summary)}.md`);
    const patchPath = join(logsDir, `patch-${stamp}-draft-${safeSlug(summary)}.json`);
    const logJsonPath = join(logsDir, 'draft-change-log.json');
    const logMarkdownPath = join(logsDir, 'draft-change-log.md');
    writtenPaths.patch = relativeProjectPath(patchPath);
    const approval = {
      id: `${skillId}-draft-${stamp}`,
      skillId,
      action: 'approve-requirement',
      requirementKind: kind,
      approvedAt,
      approvedBy: changeRequest.owner?.nome || 'owner nao informado',
      summary,
      changeRequest,
      legacySnapshot,
      patch,
      paths: {
        ...writtenPaths,
        review: relativeProjectPath(reviewPath),
        changeLogJson: relativeProjectPath(logJsonPath),
        changeLogMarkdown: relativeProjectPath(logMarkdownPath)
      }
    };

    const log = await readJsonFile(logJsonPath, { entries: [] });
    const entries = Array.isArray(log.entries) ? [...log.entries, approval] : [approval];
    await writeFile(patchPath, `${JSON.stringify(patch, null, 2)}\n`, 'utf8');
    await writeFile(logJsonPath, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
    await writeFile(logMarkdownPath, renderDraftRequirementLog(entries), 'utf8');
    await writeFile(reviewPath, `${renderDraftRequirementReview(approval)}\n`, 'utf8');
    await markSuggestionApproved(skillId, changeRequest, approval);

    return approval;
  }

  async function appendDraftGovernanceEntry({ skillId, approval, patch }) {
    const logsDir = join(governanceOutputRoot(), skillId, 'logs');
    await mkdir(logsDir, { recursive: true });

    const stamp = fileStamp(new Date(approval.approvedAt));
    const summarySlug = safeSlug(approval.summary);
    const reviewPath = join(logsDir, `code-review-${stamp}-draft-${summarySlug}.md`);
    const patchPath = join(logsDir, `patch-${stamp}-draft-${summarySlug}.json`);
    const logJsonPath = join(logsDir, 'draft-change-log.json');
    const logMarkdownPath = join(logsDir, 'draft-change-log.md');

    approval.paths = {
      ...approval.paths,
      patch: relativeProjectPath(patchPath),
      review: relativeProjectPath(reviewPath),
      changeLogJson: relativeProjectPath(logJsonPath),
      changeLogMarkdown: relativeProjectPath(logMarkdownPath)
    };

    const log = await readJsonFile(logJsonPath, { entries: [] });
    const entries = Array.isArray(log.entries) ? [...log.entries, approval] : [approval];
    await writeFile(patchPath, `${JSON.stringify(patch, null, 2)}\n`, 'utf8');
    await writeFile(logJsonPath, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
    await writeFile(logMarkdownPath, renderDraftRequirementLog(entries), 'utf8');
    await writeFile(reviewPath, `${renderDraftRequirementReview(approval)}\n`, 'utf8');

    return approval;
  }

  async function persistManualSkillTextEdit({ skillId, sourceText, editedBy = 'owner nao informado' }) {
    assertSafeSkillId(skillId);
    const nextText = String(sourceText || '').trimEnd();
    if (!nextText) {
      throw new Error('Texto do SKILL.md nao pode ficar vazio.');
    }

    const context = await loadSkillWorkingContext(skillId);
    const approvedAt = new Date().toISOString();
    const stamp = fileStamp(new Date(approvedAt));
    const summary = 'Edicao manual do Texto atual';
    const legacySnapshot = await persistDraftLegacySnapshot({
      skillId,
      context,
      stamp,
      kind: 'manual_text_edit',
      summary
    });

    const draftDir = draftDirForSkill(skillId);
    const draftSkillPath = join(draftDir, 'SKILL.md');
    await mkdir(draftDir, { recursive: true });
    await writeFile(draftSkillPath, `${nextText}\n`, 'utf8');

    const patch = {
      operation: 'replace_skill_text',
      path: relativeProjectPath(draftSkillPath),
      previousPath: context.skillPath,
      kind: 'manual_text_edit'
    };
    const approval = {
      id: `${skillId}-draft-${stamp}`,
      skillId,
      action: 'manual-text-edit',
      requirementKind: 'manual_text_edit',
      approvedAt,
      approvedBy: editedBy,
      summary,
      changeRequest: {
        titulo: summary,
        antes: `Texto anterior em ${relativeProjectPath(context.skillPath)}`,
        depois: `Texto salvo em ${relativeProjectPath(draftSkillPath)}`,
        evalResultado: 'Requisitos minimos recalculados apos a edicao manual.'
      },
      legacySnapshot,
      patch,
      paths: {
        legado: legacySnapshot.dir,
        draftSkill: relativeProjectPath(draftSkillPath)
      }
    };

    return appendDraftGovernanceEntry({ skillId, approval, patch });
  }

  async function persistContextUpload({ skillId, targetKind, files = [], uploadedBy = 'owner nao informado' }) {
    assertSafeSkillId(skillId);
    const kind = assertContextTargetKind(targetKind);
    if (!Array.isArray(files) || !files.length) {
      throw new Error('Selecione pelo menos um arquivo para upload.');
    }

    const context = await loadSkillWorkingContext(skillId);
    const approvedAt = new Date().toISOString();
    const stamp = fileStamp(new Date(approvedAt));
    const summary = `Upload de contexto em ${kind}`;
    const legacySnapshot = await persistDraftLegacySnapshot({
      skillId,
      context,
      stamp,
      kind: `upload_${kind}`,
      summary
    });

    const draftDir = draftDirForSkill(skillId);
    const draftSkillPath = join(draftDir, 'SKILL.md');
    const targetDir = join(draftDir, kind);
    await mkdir(targetDir, { recursive: true });
    if (!(await pathExists(draftSkillPath))) {
      await mkdir(draftDir, { recursive: true });
      await writeFile(draftSkillPath, `${context.markdown.trimEnd()}\n`, 'utf8');
    }

    const written = [];
    for (const file of files) {
      const filename = assertSafeUploadName(file.name);
      const payload = String(file.base64 || '');
      if (!payload) {
        throw new Error(`Arquivo sem conteudo: ${filename}`);
      }

      const content = Buffer.from(payload, 'base64');
      const targetPath = join(targetDir, filename);
      if (!targetPath.startsWith(targetDir)) {
        throw new Error(`Caminho de upload invalido: ${filename}`);
      }

      await writeFile(targetPath, content);
      written.push(relativeProjectPath(targetPath));
    }

    const patch = {
      operation: 'upload_context_files',
      targetKind: kind,
      files: written,
      kind: `upload_${kind}`
    };
    const approval = {
      id: `${skillId}-draft-${stamp}`,
      skillId,
      action: 'upload-context',
      requirementKind: `upload_${kind}`,
      approvedAt,
      approvedBy: uploadedBy,
      summary,
      changeRequest: {
        titulo: summary,
        antes: `Contexto anterior salvo em ${legacySnapshot.dir}`,
        depois: `Arquivos adicionados em ${relativeProjectPath(targetDir)}: ${written.map((item) => item.split('/').pop()).join(', ')}`,
        evalResultado: 'Arquivos de contexto passam a compor o rascunho governado da skill.'
      },
      legacySnapshot,
      patch,
      uploadedFiles: written,
      paths: {
        legado: legacySnapshot.dir,
        draftSkill: relativeProjectPath(draftSkillPath),
        [kind]: relativeProjectPath(targetDir)
      }
    };

    return appendDraftGovernanceEntry({ skillId, approval, patch });
  }

  async function restoreOptionalFileFromLegacy({ legacyDir, relativePath, targetPath }) {
    const sourcePath = join(legacyDir, relativePath);
    if (await pathExists(sourcePath)) {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, await readFile(sourcePath));
      return;
    }

    await rm(targetPath, { force: true });
  }

  async function restoreOptionalDirectoryFromLegacy({ legacyDir, relativePath, targetPath }) {
    const sourcePath = join(legacyDir, relativePath);
    await rm(targetPath, { recursive: true, force: true });
    if (await pathExists(sourcePath)) {
      await mkdir(dirname(targetPath), { recursive: true });
      await cp(sourcePath, targetPath, { recursive: true });
    }
  }

  async function rollbackDraftChange({ skillId, entryId, rolledBackBy = 'owner nao informado' }) {
    assertSafeSkillId(skillId);
    const logJsonPath = join(governanceOutputRoot(), skillId, 'logs', 'draft-change-log.json');
    const log = await readJsonFile(logJsonPath, { entries: [] });
    const entries = Array.isArray(log.entries) ? log.entries : [];
    const targetEntry = entries.find((entry) => entry.id === entryId);
    if (!targetEntry?.legacySnapshot?.dir) {
      throw new Error('Snapshot de rollback nao encontrado para este rascunho.');
    }

    const context = await loadSkillWorkingContext(skillId);
    const approvedAt = new Date().toISOString();
    const stamp = fileStamp(new Date(approvedAt));
    const summary = `Rollback do rascunho para ${targetEntry.summary}`;
    const currentSnapshot = await persistDraftLegacySnapshot({
      skillId,
      context,
      stamp,
      kind: 'draft_rollback_previous',
      summary: `${summary} - estado anterior ao rollback`
    });

    const legacyDir = join(rootDir, targetEntry.legacySnapshot.dir);
    if (!legacyDir.startsWith(governanceOutputRoot()) || !(await pathExists(join(legacyDir, 'SKILL.md')))) {
      throw new Error('Snapshot legado invalido para rollback.');
    }

    const draftDir = draftDirForSkill(skillId);
    const draftSkillPath = join(draftDir, 'SKILL.md');
    await mkdir(draftDir, { recursive: true });
    await writeFile(draftSkillPath, await readFile(join(legacyDir, 'SKILL.md'), 'utf8'), 'utf8');
    await restoreOptionalFileFromLegacy({
      legacyDir,
      relativePath: join('eval', 'cases.json'),
      targetPath: join(draftDir, 'eval', 'cases.json')
    });
    await restoreOptionalFileFromLegacy({
      legacyDir,
      relativePath: 'output_schema.json',
      targetPath: join(draftDir, 'output_schema.json')
    });
    await restoreOptionalDirectoryFromLegacy({
      legacyDir,
      relativePath: 'analytics',
      targetPath: join(draftDir, 'analytics')
    });
    await restoreOptionalDirectoryFromLegacy({
      legacyDir,
      relativePath: 'query',
      targetPath: join(draftDir, 'query')
    });

    const patch = {
      operation: 'rollback_draft',
      restoredFrom: targetEntry.legacySnapshot.dir,
      currentBackup: currentSnapshot.dir,
      kind: 'draft_rollback'
    };
    const approval = {
      id: `${skillId}-draft-${stamp}`,
      skillId,
      action: 'draft-rollback',
      requirementKind: 'draft_rollback',
      approvedAt,
      approvedBy: rolledBackBy,
      summary,
      changeRequest: {
        titulo: summary,
        antes: `Estado antes do rollback salvo em ${currentSnapshot.dir}`,
        depois: `Rascunho restaurado a partir de ${targetEntry.legacySnapshot.dir}`,
        evalResultado: 'Rollback de rascunho registrado com backup do estado anterior.'
      },
      legacySnapshot: currentSnapshot,
      patch,
      paths: {
        legado: currentSnapshot.dir,
        draftSkill: relativeProjectPath(draftSkillPath)
      }
    };

    return appendDraftGovernanceEntry({ skillId, approval, patch });
  }

  function renderReturnReviewMarkdown(returned) {
    const change = returned.changeRequest || {};
    return [
      `# Code review - ${returned.skillId} devolvido`,
      '',
      '- status: devolvido para ajuste',
      `- data: ${returned.returnedAt}`,
      `- devolvido por: ${returned.returnedBy}`,
      `- acao: ${returned.action}`,
      '',
      '## Arquivos gravados',
      '',
      `- return log: ${returned.paths.returnLogMarkdown}`,
      `- review: ${returned.paths.review}`,
      '',
      '## Proposta devolvida',
      '',
      returned.summary,
      '',
      '## Antes',
      '',
      change.antes || change.rationale || 'Contexto anterior nao informado pela proposta.',
      '',
      '## Depois proposto',
      '',
      change.depois || change.proposedChange || 'Mudanca proposta nao informada.',
      '',
      '## Caso de aceite proposto',
      '',
      change.evalResultado || change.acceptanceCase || 'Caso de aceite nao informado.',
      '',
      '## Motivo da devolucao',
      '',
      returned.reason,
      '',
      '## Parecer de code review',
      '',
      '- A proposta nao foi canonizada.',
      '- O motivo da devolucao foi registrado em log append-only dentro do projeto.',
      '- A sugestao foi marcada como returned para nao voltar automaticamente na fila sem novo ajuste.',
      '- Nenhum SKILL.md canonico ou legado foi alterado por esta devolucao.',
      '',
      '## Checklist',
      '',
      '- [x] Motivo salvo',
      '- [x] Review markdown gerado',
      '- [x] Sugestao marcada como returned',
      '- [x] Versao canonica preservada'
    ].join('\n');
  }

  function renderReturnLogMarkdown(entries) {
    const lines = ['# Return log de propostas', ''];
    for (const entry of [...entries].reverse()) {
      lines.push(`## ${entry.returnedAt.slice(0, 10)} - ${entry.summary}`);
      lines.push('');
      lines.push(`- devolvido por: ${entry.returnedBy}`);
      lines.push(`- motivo: ${entry.reason}`);
      lines.push(`- review: ${entry.paths.review}`);
      lines.push('');
    }

    return `${lines.join('\n').trimEnd()}\n`;
  }

  async function persistProposalReturn({ skillId, changeRequest = {}, reason = '' }) {
    assertSafeSkillId(skillId);
    const logsDir = join(governanceOutputRoot(), skillId, 'logs');
    await mkdir(logsDir, { recursive: true });

    const returnedAt = new Date().toISOString();
    const stamp = fileStamp(new Date(returnedAt));
    const summary = changeRequest.titulo || 'Proposta devolvida pelo owner';
    const reviewPath = join(logsDir, `code-review-${stamp}-returned-${safeSlug(summary)}.md`);
    const returnLogJsonPath = join(logsDir, 'return-log.json');
    const returnLogMarkdownPath = join(logsDir, 'return-log.md');
    const returned = {
      id: `${skillId}-returned-${stamp}`,
      skillId,
      action: 'return',
      returnedAt,
      returnedBy: changeRequest.owner?.nome || 'owner nao informado',
      summary,
      reason: reason || 'Motivo nao informado.',
      changeRequest,
      paths: {
        review: relativeProjectPath(reviewPath),
        returnLogJson: relativeProjectPath(returnLogJsonPath),
        returnLogMarkdown: relativeProjectPath(returnLogMarkdownPath)
      }
    };

    const parsed = await readJsonFile(returnLogJsonPath, { entries: [] });
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const nextEntries = [...entries, returned];

    await writeFile(returnLogJsonPath, `${JSON.stringify({ entries: nextEntries }, null, 2)}\n`, 'utf8');
    await writeFile(returnLogMarkdownPath, renderReturnLogMarkdown(nextEntries), 'utf8');
    await writeFile(reviewPath, `${renderReturnReviewMarkdown(returned)}\n`, 'utf8');
    await markSuggestionReturned(skillId, changeRequest, returned);

    return returned;
  }

  async function feedbackSignature() {
    if (!(await pathExists(feedbackRoot))) {
      return 'missing';
    }

    const entries = await readdir(feedbackRoot, { withFileTypes: true });
    const parts = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }

      const fullPath = join(feedbackRoot, entry.name);
      const fileStat = await stat(fullPath);
      parts.push(`${entry.name}:${fileStat.size}:${fileStat.mtimeMs}`);
    }

    return parts.sort().join('|');
  }

  let lastFeedbackSignature = null;
  let suggestionGenerationRunning = false;

  async function startFeedbackMonitor() {
    if (process.env.FEEDBACK_WATCH === '0') {
      return;
    }

    try {
      lastFeedbackSignature = await feedbackSignature();
    } catch (error) {
      console.warn(`Feedback monitor initialization failed: ${error.message}`);
    }

    setInterval(async () => {
      if (suggestionGenerationRunning) {
        return;
      }

      try {
        const currentSignature = await feedbackSignature();
        if (lastFeedbackSignature === null) {
          lastFeedbackSignature = currentSignature;
          return;
        }

        if (currentSignature === lastFeedbackSignature) {
          return;
        }

        lastFeedbackSignature = currentSignature;
        suggestionGenerationRunning = true;
        const index = await generateGovernanceSuggestions();
        console.log(`Governance suggestions refreshed from feedback changes: ${index.skills.length} skills`);
      } catch (error) {
        console.warn(`Feedback monitor failed: ${error.message}`);
      } finally {
        suggestionGenerationRunning = false;
      }
    }, feedbackPollMs);
  }

  async function validateDraftWithAI(skill, context) {
    const localReview = localDraftReview(skill, context);
    if (process.env.AI_REVIEW_ON_SKILLS_LOAD !== '1') {
      return localReview;
    }

    const proxyReview = await callDepartmentProxy(
      {
        skill: {
          id: skill.id,
          nome: skill.nome,
          descricao: skill.descricao,
          owner: skill.owner,
          version: skill.version,
          objetivo: skill.objetivo,
          escopo: skill.escopo
        },
        frontmatter: context.meta,
        markdown: context.body.slice(0, 12000),
        files: context.files,
        wrongFeedbacks: context.wrongFeedbacks || [],
        localChecklist: localReview
      },
      'skill_draft_governance_review'
    ).catch((error) => ({
      ...localReview,
      provider: 'proxy-error-fallback',
      proxyError: error.message
    }));

    return proxyReview || localReview;
  }

  async function loadSkillCompletionContext(skillId) {
    const context = await loadSkillWorkingContext(skillId);
    const wrongFeedbackBySkill = await loadWrongFeedbackBySkill();

    return {
      ...context,
      wrongFeedbacks: wrongFeedbackBySkill.get(skillId) || []
    };
  }

  async function generateProposalCompletion(body, aiConfig = null) {
    const proposal = body.proposal || {};
    const skillId = body.skillId || proposal.skillId;
    if (!skillId) {
      throw new Error('skillId é obrigatório para gerar sugestão com IA.');
    }

    const context = await loadSkillCompletionContext(skillId);
    const fallback = buildLocalProposalCompletion(context, proposal);
    const aiResult = await callDepartmentProxy(
      {
        contract: {
          requiredJsonFields: ['provider', 'title', 'rationale', 'proposedChange', 'acceptanceCase', 'severity'],
          instruction:
            'Complete somente esta proposta para revisão do owner. Não publique, não aprove e não altere arquivos.'
        },
        targetKind: fallback.aiFillKind,
        skill: {
          id: context.skillId,
          name: context.meta.name || context.skillId,
          description: context.meta.description || '',
          frontmatter: context.meta,
          markdown: context.markdown.slice(0, 16000),
          files: context.files,
          evals: context.evals,
          wrongFeedbacks: context.wrongFeedbacks
        },
        proposal,
        localFallback: fallback
      },
      'skill_missing_basic_completion',
      aiConfig
    ).catch((error) => ({
      ...fallback,
      provider: 'proxy-error-fallback',
      proxyError: error.message
    }));

    const completion = normalizeProposalCompletion(aiResult || fallback, fallback);

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      skillId,
      provider: completion.provider,
      proposal: {
        titulo: completion.title,
        antes: completion.rationale,
        depois: completion.proposedChange,
        evalResultado: completion.acceptanceCase,
        severity: completion.severity,
        status: 'preenchida por IA',
        provider: completion.provider,
        aiFillAvailable: true,
        aiFillKind: completion.aiFillKind,
        aiGeneratedAt: new Date().toISOString()
      }
    };
  }

  return {
    loadSkillWorkingContext,
    loadSkillConsumerContext,
    relativeProjectPath,
    loadDraftEntries,
    loadCanonicalState,
    persistSkillPublication,
    persistDraftRequirementApproval,
    persistManualSkillTextEdit,
    persistContextUpload,
    rollbackDraftChange,
    persistProposalReturn,
    startFeedbackMonitor,
    validateDraftWithAI,
    generateProposalCompletion
  };
}
