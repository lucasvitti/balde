import { createMachineAuthFeature } from './src/features/machine-auth.mjs';
import { createHealthRoutes } from './src/routes/health.mjs';
import { createProfileRoutes } from './src/routes/profile.mjs';
import { incompleteTransactions } from './src/governance/file-transaction.mjs';
import { createIngestionRoutes } from './src/routes/ingestion.mjs';
import { createLocalIntegrationRoutes } from './src/routes/local-integration.mjs';
import { createReposAccessRoutes } from './src/routes/repos-access.mjs';
import { createShareFoldersRoutes } from './src/routes/share-folders.mjs';
import { createChatRoutes } from './src/routes/chat.mjs';
import { createPlenariaRoutes } from './src/routes/plenaria.mjs';
import { createAdministrationRoutes } from './src/routes/administration.mjs';
import { createQueueRoutes } from './src/routes/queue.mjs';
import { createMergeRoutes } from './src/routes/merge.mjs';
import { createMachineApiRoutes } from './src/routes/machine-api.mjs';
import { createBuddiesRoutes } from './src/routes/buddies.mjs';
import { createPeopleRoutes } from './src/routes/people.mjs';
import { createSkillsRoutes } from './src/routes/skills.mjs';
import { createCommonsRoutes } from './src/routes/commons.mjs';
import { createProposalsRoutes } from './src/routes/proposals.mjs';
import { createExploreRoutes } from './src/routes/explore.mjs';
import { createDocumentsRoutes } from './src/routes/documents.mjs';
import { createCapsulesRoutes } from './src/routes/capsules.mjs';
import { createEvaluationRoutes } from './src/routes/evaluation.mjs';
import { createGraphRoutes } from './src/routes/graph.mjs';
import { createDraftsRoutes } from './src/routes/drafts.mjs';
import { createConversationsFeature } from './src/features/conversations.mjs';
import { createContextFilesFeature } from './src/features/context-files.mjs';
import { createCorpusGraphFeature } from './src/features/corpus-graph.mjs';
import { createContextManifestFeature } from './src/features/context-manifest.mjs';
import { createEvaluationsFeature } from './src/features/evaluations.mjs';
import { createCommonsFeature } from './src/features/commons.mjs';
import { createChatContextFeature } from './src/features/chat-context.mjs';
import { createPreferencesFeature } from './src/features/preferences.mjs';
import { createPromptsFeature } from './src/features/prompts.mjs';
import { createPolicyFeature } from './src/features/policy.mjs';
import { createCapsulesFeature } from './src/features/capsules.mjs';
import { createDomainMovesFeature } from './src/features/domain-moves.mjs';
import { createProposalsFeature } from './src/features/proposals.mjs';
import { createDraftsFeature } from './src/features/drafts.mjs';
import { createCatalogFeature } from './src/features/catalog.mjs';
import { createDiscoveryFeature } from './src/features/discovery.mjs';
import { createQueueFeature } from './src/features/queue.mjs';
import { createAccessFeature } from './src/features/access.mjs';
import { createUsageFeature } from './src/features/usage.mjs';
import { createExchangeFeature } from './src/features/exchange.mjs';
import { createOnedriveFeature } from './src/features/onedrive.mjs';
import { createShareFoldersFeature } from './src/features/share-folders.mjs';

import { createBrowserSession } from './src/security/browser-session.mjs';

import { createPublicationRoute } from './src/governance/publication-route.mjs';

import { operationKey, serializeOperation } from './src/governance/operations.mjs';

import { createPermissions, gateAction, roleAllows } from './src/security/permissions.mjs';
import { localIdentity, runWithTestIdentity, validateLocalRequest } from './src/security/local-session.mjs';
import { withFileLock } from './src/storage/file-lock.mjs';

import { createServer } from 'node:http';

import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

import { decryptSecret } from './scripts/secrets.mjs';

import {
  rootDir,
  publicDir,
  port,
  encryptedOpenAiKeyPath,
  buddiesRoot,
  queueRoot,
  legacyCentralQueueRoot,
  baldeFeedback,
  repoDirOf,
  groupsRoot,
  activeRepo,
  runWithRepo,
  DEFAULT_REPO,
  localRepos,
  mimeTypes
} from './src/config.mjs';
import { pathExists } from './src/fs-utils.mjs';
import {
  actorFromReq,
  commitRepo as gitCommitRepo,
  ensureRepo,
  commitCorpus as gitCommitCorpus,
  ensureCorpusRepo
} from './src/git-corpus.mjs';

import {
  ensureRepoLayout,
  listRepos,
  repoByName,
  isRepoMember,
  REPO_NAME_RE,
  reloadRepoRegistry,
  migrateRepoManifests
} from './src/repos.mjs';

async function commitCorpus(message, actor, paths) {
  markCorpusGraphDirty();
  return gitCommitCorpus(message, actor, paths);
}
async function commitRepo(root, message, actor, paths) {
  markCorpusGraphDirty();
  return gitCommitRepo(root, message, actor, paths);
}
import { callAiWithConfig } from './src/ai-provider.mjs';

import { mcpSupported, refreshAllLaunchers, writeBaldeCliLauncher } from './src/mcp-setup.mjs';
import { servePoseImage } from './src/buddies.mjs';

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, maxBytes = 32 * 1024 * 1024) {
  if (req.parsedJsonBody !== undefined) return req.parsedJsonBody;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (maxBytes && total > maxBytes) {
      throw new Error('Payload muito grande.');
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return {};
  }

  req.parsedJsonBody = JSON.parse(raw);
  return req.parsedJsonBody;
}

let cachedOpenAiApiKey;

async function getOpenAiApiKey() {
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  if (cachedOpenAiApiKey !== undefined) {
    return cachedOpenAiApiKey;
  }

  if (!process.env.BALDE_SECRET_KEY || !(await pathExists(encryptedOpenAiKeyPath))) {
    cachedOpenAiApiKey = null;
    return cachedOpenAiApiKey;
  }

  try {
    cachedOpenAiApiKey = await decryptSecret({
      inputPath: encryptedOpenAiKeyPath,
      secretKey: process.env.BALDE_SECRET_KEY
    });
  } catch {
    cachedOpenAiApiKey = null;
  }

  return cachedOpenAiApiKey;
}

async function callOpenAiDirect(payload, type) {
  if (process.env.AI_DIRECT_OPENAI !== '1') {
    return null;
  }
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) {
    return null;
  }
  return callAiWithConfig(payload, type, {
    provider: 'openai',
    apiKey,
    model: process.env.OPENAI_MODEL || 'gpt-4.1'
  });
}

function fallbackReport(skill, feedback = []) {
  const wrongCount = feedback.filter((item) => item.veredito === 'errado').length;
  const stale = skill.frescor === 'vermelho';
  const weakEval = skill.evalSummary?.falhou > 0 || skill.evalSummary?.total === 0;
  const outOfScope = Math.min(38, 8 + wrongCount * 6 + (stale ? 9 : 0) + (weakEval ? 7 : 0));

  return {
    provider: 'heuristic-local',
    geradoEm: new Date().toISOString(),
    engajamentoVsObjetivo: {
      resumo: `${outOfScope}% das execuções recentes parecem sair do objetivo declarado. Priorize exemplos de referência ligados ao uso real e deixe recusas mais explícitas no escopo.`,
      usoForaDoObjetivo: outOfScope
    },
    consistenciaVsEval: [
      weakEval
        ? 'Há caso de aceitação falhando; revisar a regra de recusa e o schema de saída antes de publicar.'
        : 'Casos de aceitação recentes seguem estáveis; manter acompanhamento após troca de modelo.',
      stale
        ? 'A revisão está vencida; exigir carimbo de owner antes de qualquer promoção canônica.'
        : 'Frescor da revisão dentro do limite esperado para o status atual.'
    ],
    sugestoesDeRegra: [
      {
        id: `sug-${skill.id}-1`,
        titulo: 'Reforçar objetivo e limites no prompt',
        tipo: 'prompt',
        antes: 'Responder à solicitação do usuário usando os dados disponíveis.',
        depois: `Responder apenas quando a solicitação estiver dentro de: ${skill.objetivo}. Recusar quando faltar base, período, métrica ou granularidade.`,
        impacto: 'Reduz uso fora do escopo e melhora rastreabilidade do owner.'
      },
      {
        id: `sug-${skill.id}-2`,
        titulo: 'Adicionar bloco "não invento números"',
        tipo: 'regra',
        antes: 'Gerar análise com base no contexto.',
        depois:
          'Se números, colunas, períodos ou fontes não estiverem presentes no arquivo ou payload, declarar a limitação e não estimar valores.',
        impacto: 'Diminui respostas marcadas como Errado por fabricação de dado.'
      }
    ]
  };
}

function stripMarkdown(value = '') {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const {
  AUTHENTIK_API_URL,
  AUTHENTIK_TOKEN_TTL_MS,
  AUTHENTIK_SERVICE_TOKEN,
  API_GROUP,
  authorizeMachine,
  authentikServiceReady,
  authentikAdmin,
  listUserApiTokens,
  createUserApiToken,
  revokeUserApiToken,
  revealUserApiToken,
  renameUserApiToken,
  EXPOSED_APIS,
  dedupPairKey,
  isAdminReq,
  currentApiKey,
  loadApiKeyStore,
  ensureLocalMachineKey
} = createMachineAuthFeature({
  corpusGroupsForEmail: (...args) => corpusGroupsForEmail(...args),
  reqGroups: (...args) => reqGroups(...args)
});

const {
  isGovernancePath,
  isEditableContextFile,
  isCommonsMediaFile,
  userChatsDir,
  assertSafeChatId,
  readChat,
  writeChat,
  listChats,
  sanitizeChatSkillIds,
  createChat,
  resolveChatBuddy,
  newPlenariaId,
  newPlenariaKey,
  assertSafePlenariaId,
  actorEmail,
  actorLabel,
  readPlenaria,
  writePlenaria,
  plenariaIsOwner,
  plenariaIsMember,
  withPlenariaLock,
  plenariaSubscribe,
  plenariaBroadcast,
  plenariaOnline,
  listPlenariasFor,
  findPlenariaByKey,
  plenariaView,
  plenariaShouldTriggerBuddy,
  runPlenariaBuddyReply
} = createConversationsFeature({
  userAiDir: (...args) => userAiDir(...args),
  skillExistsById: (...args) => skillExistsById(...args),
  loadSkillsFromDisk: (...args) => loadSkillsFromDisk(...args),
  chatSystemPrompt: (...args) => chatSystemPrompt(...args),
  loadUserAiConfig: (...args) => loadUserAiConfig(...args),
  resolveChatContextMode: (...args) => resolveChatContextMode(...args),
  chatSystemPromptPaged: (...args) => chatSystemPromptPaged(...args),
  makeChatContextTools: (...args) => makeChatContextTools(...args),
  withRunQueryTool: (...args) => withRunQueryTool(...args),
  withRunSqlTool: (...args) => withRunSqlTool(...args),
  withContributeTool: (...args) => withContributeTool(...args),
  attachAdhocSql: (...args) => attachAdhocSql(...args)
});

const {
  corpusIndexCacheByRepo,
  corpusNodeIndex,
  corpusLinkCacheByRepo,
  corpusLinkIndex,
  markCorpusGraphDirty,
  rebuildCorpusGraphSnapshot,
  corpusGraphSnapshot,
  skillIdOfCorpusPath,
  capsuleOutboundLink,
  extractContextLinks
} = createCorpusGraphFeature({
  listSkillIds: (...args) => listSkillIds(...args),
  isGovernancePath: (...args) => isGovernancePath(...args),
  listCommonsConcepts: (...args) => listCommonsConcepts(...args),
  govSkillShape: (...args) => govSkillShape(...args),
  discoverSkillContextFiles: (...args) => discoverSkillContextFiles(...args),
  loadSkillsFromDisk: (...args) => loadSkillsFromDisk(...args),
  buildCommonsList: (...args) => buildCommonsList(...args),
  isOntologyCapsuleId: (...args) => isOntologyCapsuleId(...args),
  resolveContextLink: (...args) => resolveContextLink(...args)
});

const {
  contextNodePaths,
  skillContextManifest,
  CONTEXT_INDEX_FILE,
  loadContextIndex,
  summarizeContextFilesWithAI,
  regenerateContextIndex
} = createContextManifestFeature({
  discoverSkillContextFiles: (...args) => discoverSkillContextFiles(...args),
  corpusNodeIndex: (...args) => corpusNodeIndex(...args),
  loadGovernanceIndex: (...args) => loadGovernanceIndex(...args),
  loadSkillAccess: (...args) => loadSkillAccess(...args),
  extractContextLinks: (...args) => extractContextLinks(...args),
  contextKind: (...args) => contextKind(...args),
  heuristicSummary: (...args) => heuristicSummary(...args),
  conceptGovernance: (...args) => conceptGovernance(...args),
  corpusLinkIndex: (...args) => corpusLinkIndex(...args),
  cadenceStatus: (...args) => cadenceStatus(...args),
  loadUserAiConfig: (...args) => loadUserAiConfig(...args),
  loadSkillWorkingContext: (...args) => loadSkillWorkingContext(...args),
  commitCorpus: (...args) => commitCorpus(...args)
});

const {
  governanceIndexPath,
  loadGovernanceIndex,
  saveGovernanceIndex,
  cadenceStatus,
  computeConceptExpiresAt,
  conceptGovernanceFrom,
  normSerieField,
  normPeriodoField,
  conceptGovernance,
  stampCreator,
  pushApproval,
  creatorFromGit,
  govSkillShape,
  draftConceptEvalCriteria,
  gradeConceptEval,
  loadNodeEvalStored,
  normRubric,
  normEvalItem,
  normStoredEval,
  resetNodeEvalVerdicts,
  nodeEvalView,
  saveNodeEval,
  runNodeEval,
  testEvalCase,
  suggestEvalCases
} = createEvaluationsFeature({
  commitCorpus: (...args) => commitCorpus(...args),
  loadSkillWorkingContext: (...args) => loadSkillWorkingContext(...args),
  loadCommonsConceptGov: (...args) => loadCommonsConceptGov(...args),
  commitRepo: (...args) => commitRepo(...args),
  commonsConceptContextPath: (...args) => commonsConceptContextPath(...args),
  readPrompt: (...args) => readPrompt(...args),
  mandatoryFor: (...args) => mandatoryFor(...args),
  loadEvalChecklist: (...args) => loadEvalChecklist(...args),
  commonsConceptGovPath: (...args) => commonsConceptGovPath(...args),
  loadSkillsFromDisk: (...args) => loadSkillsFromDisk(...args),
  resolveChatContextMode: (...args) => resolveChatContextMode(...args),
  chatSystemPromptPaged: (...args) => chatSystemPromptPaged(...args),
  makeChatContextTools: (...args) => makeChatContextTools(...args),
  chatSystemPrompt: (...args) => chatSystemPrompt(...args),
  withRunQueryTool: (...args) => withRunQueryTool(...args),
  readCommonsConceptForContext: (...args) => readCommonsConceptForContext(...args)
});

const {
  planCommonsMigration,
  applyCommonsMigration,
  commonsConceptContextPath,
  commonsConceptGovPath,
  listCommonsConcepts,
  loadCommonsConceptGov,
  saveCommonsConceptGov,
  loadCommonsDefaults,
  saveCommonsDefaults,
  commonsHasConcept,
  MEDIA_IMG_EXTS,
  MEDIA_DATA_EXTS,
  MEDIA_IMG_MAX_BYTES,
  MEDIA_DATA_MAX_BYTES,
  MEDIA_IMG_SYSTEM,
  MEDIA_DATA_SYSTEM,
  mediaMimeFor,
  listMediaFiles,
  listAssetFiles,
  commonsFileAssetV1Url,
  commonsFileAssetWebUrl,
  skillFileAssetWebUrl,
  resolveCommonsFileAsset,
  skillFileAssetV1Url,
  resolveSkillFileAsset,
  processConceptMedia,
  writeWizardMediaDescriptions,
  conceptMediaEntries,
  mediaContextBlock,
  capsuleAvisoText,
  domainOntologyLintIndex,
  readCommonsConceptForContext,
  buildCommonsList,
  commonsListForActor,
  commonsConceptOfPath,
  linkedCapsuleIds,
  linkedXrepoCapsuleRefs,
  actorMemberOfRepo,
  isOntologyCapsuleId,
  domainOntologyId,
  domainOntologyFor,
  resolveLinkedCapsules
} = createCommonsFeature({
  loadSkillConsumerContext: (...args) => loadSkillConsumerContext(...args),
  govSkillShape: (...args) => govSkillShape(...args),
  discoverSkillContextFiles: (...args) => discoverSkillContextFiles(...args),
  loadContextIndex: (...args) => loadContextIndex(...args),
  contextKind: (...args) => contextKind(...args),
  commitCorpus: (...args) => commitCorpus(...args),
  stampCreator: (...args) => stampCreator(...args),
  pushApproval: (...args) => pushApproval(...args),
  corpusIndexCacheByRepo,
  corpusLinkCacheByRepo,
  computeConceptExpiresAt: (...args) => computeConceptExpiresAt(...args),
  commitRepo: (...args) => commitRepo(...args),
  formatBytesServer: (...args) => formatBytesServer(...args),
  loadScoringConfig: (...args) => loadScoringConfig(...args),
  conceptGovernanceFrom: (...args) => conceptGovernanceFrom(...args),
  canReadCommonsActor: (...args) => canReadCommonsActor(...args),
  corpusLinkIndex: (...args) => corpusLinkIndex(...args),
  creatorFromGit: (...args) => creatorFromGit(...args),
  heuristicSummary: (...args) => heuristicSummary(...args),
  loadCommonsAccess: (...args) => loadCommonsAccess(...args),
  normEmail: (...args) => normEmail(...args)
});

const { readPrompt, listPrompts, writePromptBody, loadPromptBody, ensurePromptsSeed } = createPromptsFeature({
  commitRepo: (...args) => commitRepo(...args)
});

const {
  loadEvalChecklist,
  saveEvalChecklist,
  mandatoryFor,
  migrateLegacyQueueAndPolicy,
  forEachRepoSeed,
  loadScoringConfig,
  saveScoringConfig,
  normalizeDomainServer,
  composeSkillId,
  loadDomains,
  saveDomains,
  loadUserDomainAssignments,
  saveUserDomainAssignment,
  isBaldeAdminReq,
  allowedDomainsForActor,
  createDomainDenial,
  ensureDomainsSeed
} = createPolicyFeature({
  normRubric: (...args) => normRubric(...args),
  commitRepo: (...args) => commitRepo(...args),
  commitCorpus: (...args) => commitCorpus(...args),
  normEmail: (...args) => normEmail(...args),
  webActor: (...args) => webActor(...args)
});

const { renameDomain, moveSkillToDomain } = createDomainMovesFeature({
  normalizeDomainServer: (...args) => normalizeDomainServer(...args),
  loadDomains: (...args) => loadDomains(...args),
  listSkillIds: (...args) => listSkillIds(...args),
  listCommonsConcepts: (...args) => listCommonsConcepts(...args),
  commonsHasConcept: (...args) => commonsHasConcept(...args),
  saveDomains: (...args) => saveDomains(...args),
  commitCorpus: (...args) => commitCorpus(...args),
  commitRepo: (...args) => commitRepo(...args),
  markCorpusGraphDirty: (...args) => markCorpusGraphDirty(...args)
});

const {
  extractSection,
  inferModelTier,
  inferObjective,
  inferScope,
  inferAiFillKind,
  buildLocalProposalCompletion,
  normalizeProposalCompletion,
  recordFeedback,
  migrateLocalFeedbackLog,
  loadWrongFeedbackBySkill,
  feedbackEntryId,
  markFeedbackResolved,
  loadFeedbackBySkill,
  loadPersistedSuggestionsBySkill
} = createProposalsFeature({
  stripMarkdown: (...args) => stripMarkdown(...args),
  localUserCurates: (...args) => localUserCurates(...args),
  baldeWritable: (...args) => baldeWritable(...args)
});

const {
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
} = createDraftsFeature({
  stripMarkdown: (...args) => stripMarkdown(...args),
  inferObjective: (...args) => inferObjective(...args),
  inferScope: (...args) => inferScope(...args),
  inferModelTier: (...args) => inferModelTier(...args),
  inferAiFillKind: (...args) => inferAiFillKind(...args),
  callDepartmentProxy: (...args) => callDepartmentProxy(...args),
  loadWrongFeedbackBySkill: (...args) => loadWrongFeedbackBySkill(...args),
  buildLocalProposalCompletion: (...args) => buildLocalProposalCompletion(...args),
  normalizeProposalCompletion: (...args) => normalizeProposalCompletion(...args)
});

const {
  listSkillIds,
  usageSkillKey,
  loadSkillsFromDisk,
  callDepartmentProxy,
  ensureDocs,
  ensureCommons,
  listDocs,
  safeDocRel,
  deprecationNotice,
  qualityNotice,
  toOkfSummary,
  toOkfDetail
} = createCatalogFeature({
  usageActorLabel: (...args) => usageActorLabel(...args),
  loadWrongFeedbackBySkill: (...args) => loadWrongFeedbackBySkill(...args),
  loadFeedbackBySkill: (...args) => loadFeedbackBySkill(...args),
  loadPersistedSuggestionsBySkill: (...args) => loadPersistedSuggestionsBySkill(...args),
  loadScoringConfig: (...args) => loadScoringConfig(...args),
  mandatoryFor: (...args) => mandatoryFor(...args),
  loadEvalChecklist: (...args) => loadEvalChecklist(...args),
  buildCommonsList: (...args) => buildCommonsList(...args),
  loadSkillConsumerContext: (...args) => loadSkillConsumerContext(...args),
  loadCanonicalState: (...args) => loadCanonicalState(...args),
  loadDraftEntries: (...args) => loadDraftEntries(...args),
  extractSection: (...args) => extractSection(...args),
  loadGovernanceIndex: (...args) => loadGovernanceIndex(...args),
  cadenceStatus: (...args) => cadenceStatus(...args),
  loadNodeEvalStored: (...args) => loadNodeEvalStored(...args),
  feedbackEntryId: (...args) => feedbackEntryId(...args),
  stripMarkdown: (...args) => stripMarkdown(...args),
  inferModelTier: (...args) => inferModelTier(...args),
  validateDraftWithAI: (...args) => validateDraftWithAI(...args),
  callOpenAiDirect: (...args) => callOpenAiDirect(...args),
  readPrompt: (...args) => readPrompt(...args)
});

const {
  INGEST_ROOT,
  INGEST_MAX_FILE_BYTES,
  INGEST_MAX_FILES,
  INGEST_EXTS,
  ingestJobDir,
  readIngestJob,
  saveIngestJob,
  canSeeIngestJob,
  runIngestJob,
  DEDUP_CHECK_THRESHOLD,
  DEDUP_SCAN_THRESHOLD,
  similarityIndex,
  invalidateSimilarityIndex,
  searchCorpus,
  buildAskGrounding,
  dedupDismissPath,
  loadDedupDismissed
} = createDiscoveryFeature({
  webActor: (...args) => webActor(...args),
  normEmail: (...args) => normEmail(...args),
  curatesActiveBaldeReq: (...args) => curatesActiveBaldeReq(...args),
  loadUserAiConfig: (...args) => loadUserAiConfig(...args),
  loadSkillsFromDisk: (...args) => loadSkillsFromDisk(...args),
  buildCommonsList: (...args) => buildCommonsList(...args),
  canReadCommonsActor: (...args) => canReadCommonsActor(...args),
  canReadSkillActor: (...args) => canReadSkillActor(...args),
  makeChatContextTools: (...args) => makeChatContextTools(...args),
  resolveChatContextMode: (...args) => resolveChatContextMode(...args),
  chatSystemPromptPaged: (...args) => chatSystemPromptPaged(...args),
  chatSystemPrompt: (...args) => chatSystemPrompt(...args),
  withRunQueryTool: (...args) => withRunQueryTool(...args)
});

const {
  QUEUE_MAX_FILES,
  QUEUE_MAX_TOTAL_FILE_BYTES,
  QUEUE_MAX_BODY,
  QUEUE_PREVIEW_CHARS,
  queueDir,
  newQueueId,
  skillExistsById,
  loadQueueItem,
  readQueueMeta,
  readQueueItem,
  writeQueueMeta,
  listQueueItems,
  queueCounts,
  decodeQueueFile,
  createQueueItem,
  preprocessQueueItem,
  mergeQueueItemIntoSkill,
  analyseMergeForSkill,
  queueFilePathIfExists
} = createQueueFeature({
  submissionRoot: (...args) => submissionRoot(...args),
  emitNotifyContribution: (...args) => emitNotifyContribution(...args),
  pushLocalNotice: (...args) => pushLocalNotice(...args),
  loadSkillsFromDisk: (...args) => loadSkillsFromDisk(...args),
  commitCorpus: (...args) => commitCorpus(...args),
  loadSkillWorkingContext: (...args) => loadSkillWorkingContext(...args),
  linkedCapsuleIds: (...args) => linkedCapsuleIds(...args),
  commonsConceptContextPath: (...args) => commonsConceptContextPath(...args)
});

const {
  isImageMime,
  chatFilesDir,
  plenariaFilesDir,
  storeMessageAttachments,
  findMessageAttachment,
  findAttachmentMeta,
  removeConversationFiles,
  conversationSkillFiles,
  serveFileBytes,
  serveContextSkillFile,
  serveCorpusRef,
  buddyPromptSuffix,
  formatBytesServer,
  fileViewPage,
  commonsFilePage,
  safeFence,
  contextFenceLang,
  discoverSkillContextFiles,
  readSkillTextContext,
  contextKind,
  heuristicSummary,
  resolveContextLink
} = createContextFilesFeature({
  loadSkillConsumerContext: (...args) => loadSkillConsumerContext(...args),
  userChatsDir: (...args) => userChatsDir(...args),
  QUEUE_MAX_FILES,
  decodeQueueFile: (...args) => decodeQueueFile(...args),
  QUEUE_MAX_TOTAL_FILE_BYTES,
  loadSkillsFromDisk: (...args) => loadSkillsFromDisk(...args),
  resolveCorpusNodeFull: (...args) => resolveCorpusNodeFull(...args),
  listAssetFiles: (...args) => listAssetFiles(...args),
  canReadSkillActor: (...args) => canReadSkillActor(...args),
  sendJson: (...args) => sendJson(...args),
  mediaMimeFor: (...args) => mediaMimeFor(...args),
  commonsConceptOfPath: (...args) => commonsConceptOfPath(...args),
  canReadCommonsActor: (...args) => canReadCommonsActor(...args),
  isGovernancePath: (...args) => isGovernancePath(...args)
});

const {
  DATASET_EXT_RE,
  skillQueryDatasets,
  chatSystemPrompt,
  resolveChatContextMode,
  resolveCorpusNodeFull,
  chatSystemPromptPaged,
  makeChatContextTools,
  searchCorpusFileAssets,
  withContributeTool,
  withRunQueryTool,
  withRunSqlTool,
  attachAdhocSql
} = createChatContextFeature({
  loadSkillConsumerContext: (...args) => loadSkillConsumerContext(...args),
  linkedCapsuleIds: (...args) => linkedCapsuleIds(...args),
  canReadCommonsActor: (...args) => canReadCommonsActor(...args),
  linkedXrepoCapsuleRefs: (...args) => linkedXrepoCapsuleRefs(...args),
  actorMemberOfRepo: (...args) => actorMemberOfRepo(...args),
  readSkillTextContext: (...args) => readSkillTextContext(...args),
  safeFence: (...args) => safeFence(...args),
  contextFenceLang: (...args) => contextFenceLang(...args),
  resolveLinkedCapsules: (...args) => resolveLinkedCapsules(...args),
  readCommonsConceptForContext: (...args) => readCommonsConceptForContext(...args),
  domainOntologyId: (...args) => domainOntologyId(...args),
  domainOntologyFor: (...args) => domainOntologyFor(...args),
  formatBytesServer: (...args) => formatBytesServer(...args),
  mediaContextBlock: (...args) => mediaContextBlock(...args),
  conceptMediaEntries: (...args) => conceptMediaEntries(...args),
  loadSkillsFromDisk: (...args) => loadSkillsFromDisk(...args),
  deprecationNotice: (...args) => deprecationNotice(...args),
  qualityNotice: (...args) => qualityNotice(...args),
  resolveChatBuddy: (...args) => resolveChatBuddy(...args),
  buddyPromptSuffix: (...args) => buddyPromptSuffix(...args),
  discoverSkillContextFiles: (...args) => discoverSkillContextFiles(...args),
  commonsConceptContextPath: (...args) => commonsConceptContextPath(...args),
  skillContextManifest: (...args) => skillContextManifest(...args),
  corpusNodeIndex: (...args) => corpusNodeIndex(...args),
  commonsConceptOfPath: (...args) => commonsConceptOfPath(...args),
  skillIdOfCorpusPath: (...args) => skillIdOfCorpusPath(...args),
  canReadSkillActor: (...args) => canReadSkillActor(...args),
  capsuleAvisoText: (...args) => capsuleAvisoText(...args),
  createQueueItem: (...args) => createQueueItem(...args),
  recordSkillEvent: (...args) => recordSkillEvent(...args),
  listAssetFiles: (...args) => listAssetFiles(...args),
  skillFileAssetV1Url: (...args) => skillFileAssetV1Url(...args),
  skillFileAssetWebUrl: (...args) => skillFileAssetWebUrl(...args),
  listCommonsConcepts: (...args) => listCommonsConcepts(...args),
  commonsFileAssetV1Url: (...args) => commonsFileAssetV1Url(...args),
  commonsFileAssetWebUrl: (...args) => commonsFileAssetWebUrl(...args),
  isGovernancePath: (...args) => isGovernancePath(...args),
  skillExistsById: (...args) => skillExistsById(...args),
  listQueueItems: (...args) => listQueueItems(...args),
  newQueueId: (...args) => newQueueId(...args),
  queueDir: (...args) => queueDir(...args),
  QUEUE_PREVIEW_CHARS,
  writeQueueMeta: (...args) => writeQueueMeta(...args)
});

const {
  CAPSULE_FORMAT,
  normCapsuleCategoryKey,
  loadCapsuleCategories,
  saveCapsuleCategories,
  capsuleCategoryKeys,
  capsuleCategoryUsage,
  normCapsuleCategory,
  capsuleSlugSeg,
  compileCapsule,
  createCapsuleQueueItem,
  applyCapsuleManifest
} = createCapsulesFeature({
  commitRepo: (...args) => commitRepo(...args),
  listCommonsConcepts: (...args) => listCommonsConcepts(...args),
  loadCommonsConceptGov: (...args) => loadCommonsConceptGov(...args),
  loadDomains: (...args) => loadDomains(...args),
  loadRoster: (...args) => loadRoster(...args),
  allowedDomainsForActor: (...args) => allowedDomainsForActor(...args),
  canReadSkillActor: (...args) => canReadSkillActor(...args),
  linkedCapsuleIds: (...args) => linkedCapsuleIds(...args),
  normalizeDomainServer: (...args) => normalizeDomainServer(...args),
  domainOntologyLintIndex: (...args) => domainOntologyLintIndex(...args),
  commonsHasConcept: (...args) => commonsHasConcept(...args),
  canReadCommonsActor: (...args) => canReadCommonsActor(...args),
  capsuleOutboundLink: (...args) => capsuleOutboundLink(...args),
  normSerieField: (...args) => normSerieField(...args),
  normPeriodoField: (...args) => normPeriodoField(...args),
  isOntologyCapsuleId: (...args) => isOntologyCapsuleId(...args),
  buildCommonsList: (...args) => buildCommonsList(...args),
  normEmailList: (...args) => normEmailList(...args),
  newQueueId: (...args) => newQueueId(...args),
  submissionRoot: (...args) => submissionRoot(...args),
  QUEUE_PREVIEW_CHARS,
  writeQueueMeta: (...args) => writeQueueMeta(...args),
  emitNotifyContribution: (...args) => emitNotifyContribution(...args),
  pushLocalNotice: (...args) => pushLocalNotice(...args),
  commonsConceptContextPath: (...args) => commonsConceptContextPath(...args),
  stampCreator: (...args) => stampCreator(...args),
  pushApproval: (...args) => pushApproval(...args),
  commonsConceptGovPath: (...args) => commonsConceptGovPath(...args),
  loadCommonsAccess: (...args) => loadCommonsAccess(...args),
  writeCommonsAccessDoc: (...args) => writeCommonsAccessDoc(...args),
  normEmail: (...args) => normEmail(...args),
  saveSkillAccess: (...args) => saveSkillAccess(...args),
  loadGovernanceIndex: (...args) => loadGovernanceIndex(...args),
  governanceIndexPath: (...args) => governanceIndexPath(...args),
  normStoredEval: (...args) => normStoredEval(...args),
  normEvalItem: (...args) => normEvalItem(...args),
  loadSkillAccess: (...args) => loadSkillAccess(...args),
  commitCorpus: (...args) => commitCorpus(...args),
  regenerateContextIndex: (...args) => regenerateContextIndex(...args)
});

const {
  refreshCorpusGroupsIndex,
  corpusGroupsForEmail,
  reqGroups,
  canCreateBuddyReq,
  canManageSkillReq,
  canReadSkillReq,
  normEmail,
  normEmailList,
  slugifyGroupName,
  loadGroup,
  listGroups,
  saveGroup,
  deleteGroup,
  loadRoster,
  loadAuthentikUsers,
  upsertRoster,
  loadSkillAccess,
  saveSkillAccess,
  loadCommonsAccess,
  writeCommonsAccessDoc,
  canReadCommonsActor,
  canManageCommonsActor,
  canReadCommonsReq,
  canManageCommonsReq,
  webActor,
  personalRepoSlug,
  actorIsAdmin,
  canReadSkillActor,
  canManageSkillActor,
  actorCuratesActiveRepo,
  notifyRecipientsForSkill,
  baldePeople,
  emitNotifyFeedback,
  emitNotifyContribution
} = createAccessFeature({
  commitRepo: (...args) => commitRepo(...args),
  authentikServiceReady: (...args) => authentikServiceReady(...args),
  authentikAdmin: (...args) => authentikAdmin(...args)
});

const {
  usageActorLabel,
  recordApiCall,
  recordSkillEvent,
  apiRouteTemplate,
  usageSummary,
  usageForSkill,
  NOTIFY_BASE_URL,
  pubUrl,
  buildNotifyDigestEmails
} = createUsageFeature({
  usageSkillKey: (...args) => usageSkillKey(...args),
  loadRoster: (...args) => loadRoster(...args),
  normEmail: (...args) => normEmail(...args),
  loadUserPrefs: (...args) => loadUserPrefs(...args),
  loadSkillsFromDisk: (...args) => loadSkillsFromDisk(...args),
  listQueueItems: (...args) => listQueueItems(...args),
  canManageSkillActor: (...args) => canManageSkillActor(...args),
  actorCuratesActiveRepo: (...args) => actorCuratesActiveRepo(...args)
});

const {
  localNotices,
  localNoticeState,
  pushLocalNotice,
  localUserCurates,
  baldeWritable,
  BALDE_FOLDER_READONLY,
  submissionRoot,
  outboxCountFor,
  migrateCentralQueue
} = createExchangeFeature({
  corpusGroupsForEmail: (...args) => corpusGroupsForEmail(...args),
  canReadSkillActor: (...args) => canReadSkillActor(...args)
});

const {
  SP_CONFIGURED,
  runSharePointScript,
  AI_MODE,
  READONLY_CORPUS,
  canCurateRepo,
  curatesActiveBaldeReq,
  ACESSO_ID_RE,
  acessoRuntimeDir,
  acessoStamp,
  acessoCommand,
  acessoApplierAvailable,
  isOnOneDrive,
  acessoPlanLists,
  aiModeNone
} = createOnedriveFeature({
  reqGroups: (...args) => reqGroups(...args),
  webActor: (...args) => webActor(...args),
  listGroups: (...args) => listGroups(...args),
  sendJson: (...args) => sendJson(...args)
});
const shareFolders = createShareFoldersFeature({ isOnOneDrive, acessoApplierAvailable, acessoCommand, acessoStamp });

const { userAiDir, loadUserAiConfig, userAiStatus, saveUserAiConfig, loadUserPrefs, saveUserPrefs } =
  createPreferencesFeature({});

// Uma regra por ação (D1) para as rotas da tela, a API das máquinas e a interface (/api/me).
const permissions = createPermissions({
  repoByName,
  isLocalRepo: (name) => localRepos.has(name),
  baldeWritable: (...args) => baldeWritable(...args),
  readonlyInstall: READONLY_CORPUS
});
const permissionsReq = (req) => permissions.forActor(webActor(req), activeRepo());
// Responde 403 com o motivo e devolve false quando a ação não é permitida a quem pede, no balde do pedido.
async function permitReq(req, res, action) {
  const decision = (await permissionsReq(req))[action];
  if (decision && decision.ok) return true;
  sendJson(res, 403, { ok: false, error: (decision && decision.reason) || 'Sem permissão.' });
  return false;
}
// Só o papel, faltando ou não a pasta: para ler o que a ação prepara (o editor, as avaliações).
async function roleReq(req, res, action) {
  const summary = await permissionsReq(req);
  if (roleAllows(summary.role, action)) return true;
  sendJson(res, 403, { ok: false, error: summary[action].reason || 'Sem permissão.' });
  return false;
}
const roleAllowsReq = async (req, action) => roleAllows((await permissionsReq(req)).role, action);
// Arquivar ou restaurar muda o que existe no balde: nós, links e a busca valem de novo na hora.
function invalidateCorpusIndexes() {
  corpusIndexCacheByRepo.delete(activeRepo());
  corpusLinkCacheByRepo.delete(activeRepo());
  invalidateSimilarityIndex();
}

const browserSession = createBrowserSession();
const publicationRoute = createPublicationRoute({
  readBody: readJsonBody,
  sendJson,
  actorOf: webActor,
  authorize: (req, res) => permitReq(req, res, 'curar'),
  loadItem: readQueueItem,
  writeItem: writeQueueMeta,
  queueRoot,
  repo: activeRepo,
  repoDirectory: () => repoDirOf(activeRepo()),
  evaluate: (id) => nodeEvalView('skill', id),
  publish: persistSkillPublication,
  workingText: async (id) => (await loadSkillWorkingContext(id)).markdown,
  commit: (id, actor) => commitCorpus(`skill(${id}): publicação`, actor, [id])
});

const ingestionRoutes = createIngestionRoutes({
  webActor,
  sendJson,
  saveIngestJob,
  readJsonBody,
  readIngestJob,
  canSeeIngestJob,
  INGEST_MAX_FILES,
  INGEST_EXTS,
  INGEST_MAX_FILE_BYTES,
  ingestJobDir,
  aiModeNone,
  runIngestJob,
  INGEST_ROOT,
  similarityIndex,
  linkedCapsuleIds,
  DEDUP_CHECK_THRESHOLD,
  roleReq,
  readQueueItem,
  DEDUP_SCAN_THRESHOLD,
  loadDedupDismissed,
  dedupPairKey,
  corpusLinkIndex,
  corpusNodeIndex,
  skillIdOfCorpusPath,
  dedupDismissPath,
  normalizeDomainServer,
  capsuleSlugSeg,
  commonsHasConcept,
  normSerieField,
  CAPSULE_FORMAT,
  compileCapsule,
  createCapsuleQueueItem
});
const localIntegrationRoutes = createLocalIntegrationRoutes({
  sendJson,
  readJsonBody,
  localNoticeState,
  loadUserPrefs,
  localNotices,
  AI_MODE,
  currentApiKey,
  reqGroups,
  webActor,
  personalRepoSlug,
  ensureLocalMachineKey,
  isAdminReq,
  SP_CONFIGURED,
  runSharePointScript
});
const reposAccessRoutes = createReposAccessRoutes({
  reqGroups,
  webActor,
  permissionsFor: (actor, repo) => permissions.forActor(actor, repo),
  acessoApplierAvailable,
  isOnOneDrive,
  sendJson,
  AI_MODE,
  READONLY_CORPUS,
  readJsonBody,
  ensureCommons,
  ensureDomainsSeed,
  isAdminReq,
  acessoRuntimeDir,
  ACESSO_ID_RE,
  acessoStamp,
  acessoCommand,
  acessoPlanLists,
  personalRepoSlug
});
const shareFoldersRoutes = createShareFoldersRoutes({ sendJson, isAdminReq, webActor, shareFolders, ACESSO_ID_RE });
const chatRoutes = createChatRoutes({
  sendJson,
  listChats,
  readJsonBody,
  createChat,
  readChat,
  aiModeNone,
  QUEUE_MAX_BODY,
  loadUserAiConfig,
  storeMessageAttachments,
  chatFilesDir,
  loadSkillsFromDisk,
  resolveChatContextMode,
  chatSystemPromptPaged,
  makeChatContextTools,
  chatSystemPrompt,
  withRunQueryTool,
  withRunSqlTool,
  withContributeTool,
  attachAdhocSql,
  writeChat,
  recordSkillEvent,
  sanitizeChatSkillIds,
  recordFeedback,
  emitNotifyFeedback,
  userChatsDir,
  assertSafeChatId,
  removeConversationFiles,
  findAttachmentMeta,
  findMessageAttachment,
  serveFileBytes,
  isImageMime,
  conversationSkillFiles,
  serveContextSkillFile,
  serveCorpusRef
});
const plenariaRoutes = createPlenariaRoutes({
  sendJson,
  listPlenariasFor,
  readJsonBody,
  actorEmail,
  actorLabel,
  newPlenariaId,
  sanitizeChatSkillIds,
  newPlenariaKey,
  writePlenaria,
  plenariaView,
  findPlenariaByKey,
  withPlenariaLock,
  readPlenaria,
  plenariaBroadcast,
  plenariaIsMember,
  plenariaSubscribe,
  plenariaOnline,
  QUEUE_MAX_BODY,
  storeMessageAttachments,
  plenariaFilesDir,
  plenariaShouldTriggerBuddy,
  runPlenariaBuddyReply,
  plenariaIsOwner,
  assertSafePlenariaId,
  removeConversationFiles,
  recordFeedback,
  emitNotifyFeedback,
  findAttachmentMeta,
  findMessageAttachment,
  serveFileBytes,
  isImageMime,
  conversationSkillFiles,
  serveContextSkillFile,
  serveCorpusRef
});
const administrationRoutes = createAdministrationRoutes({
  permitReq,
  roleReq,
  isAdminReq,
  sendJson,
  EXPOSED_APIS,
  usageSummary,
  NOTIFY_BASE_URL,
  API_GROUP,
  authentikServiceReady,
  currentApiKey,
  AUTHENTIK_API_URL,
  AUTHENTIK_SERVICE_TOKEN,
  AUTHENTIK_TOKEN_TTL_MS,
  readJsonBody,
  listPrompts,
  writePromptBody,
  loadCapsuleCategories,
  capsuleCategoryUsage,
  normCapsuleCategoryKey,
  saveCapsuleCategories,
  listCommonsConcepts,
  loadCommonsConceptGov,
  commonsConceptGovPath,
  commitRepo,
  loadDomains,
  saveDomains,
  baldePeople,
  loadUserDomainAssignments,
  saveUserDomainAssignment,
  renameDomain,
  moveSkillToDomain,
  QUEUE_MAX_BODY,
  safeDocRel,
  MEDIA_IMG_EXTS,
  listDocs,
  capsuleOutboundLink,
  loadNodeEvalStored,
  saveNodeEval,
  CAPSULE_FORMAT,
  compileCapsule,
  createCapsuleQueueItem
});
const queueRoutes = createQueueRoutes({
  readJsonBody,
  QUEUE_MAX_BODY,
  canReadSkillActor,
  webActor,
  sendJson,
  createQueueItem,
  recordSkillEvent,
  curatesActiveBaldeReq,
  loadFeedbackBySkill,
  feedbackEntryId,
  markFeedbackResolved,
  readQueueItem,
  canManageSkillActor,
  listQueueItems,
  queueCounts,
  outboxCountFor,
  queueFilePathIfExists,
  readQueueMeta,
  loadQueueItem,
  domainOntologyLintIndex,
  loadUserAiConfig,
  preprocessQueueItem,
  skillExistsById,
  writeQueueMeta,
  compileCapsule,
  createDomainDenial,
  queueDir,
  applyCapsuleManifest,
  permitReq,
  permissionsReq,
  commitCorpus,
  regenerateContextIndex,
  mergeQueueItemIntoSkill
});
const mergeRoutes = createMergeRoutes({
  permitReq,
  roleReq,
  sendJson,
  readJsonBody,
  QUEUE_MAX_BODY,
  loadUserAiConfig,
  analyseMergeForSkill,
  commonsConceptContextPath,
  resetNodeEvalVerdicts,
  commitCorpus,
  commitRepo,
  loadSkillWorkingContext
});
const machineApiRoutes = createMachineApiRoutes({
  authorizeMachine,
  sendJson,
  readJsonBody,
  QUEUE_MAX_BODY,
  canReadSkillActor,
  createQueueItem,
  recordSkillEvent,
  canCreateBuddyReq,
  actorIsAdmin,
  AUTHENTIK_API_URL,
  buildNotifyDigestEmails,
  loadUserPrefs,
  normEmail,
  loadRoster,
  NOTIFY_BASE_URL,
  loadSkillsFromDisk,
  notifyRecipientsForSkill,
  buildCommonsList,
  searchCorpusFileAssets,
  pubUrl,
  searchCorpus,
  AI_MODE,
  loadUserAiConfig,
  buildAskGrounding,
  toOkfSummary,
  loadSkillConsumerContext,
  skillQueryDatasets,
  formatBytesServer,
  DATASET_EXT_RE,
  skillContextManifest,
  discoverSkillContextFiles,
  extractContextLinks,
  contextNodePaths,
  corpusNodeIndex,
  contextKind,
  resolveSkillFileAsset,
  skillExistsById,
  serveFileBytes,
  mediaMimeFor,
  checkPermission: (actor, action) => permissions.check(actor, activeRepo(), action),
  commitCorpus,
  skillFileAssetV1Url,
  resolveCommonsFileAsset,
  commonsHasConcept,
  canReadCommonsActor,
  commitRepo,
  commonsFileAssetV1Url,
  commonsListForActor,
  readCommonsConceptForContext,
  commonsConceptContextPath,
  conceptGovernanceFrom,
  loadCommonsConceptGov,
  loadCommonsDefaults,
  loadScoringConfig,
  conceptMediaEntries,
  commonsFileAssetWebUrl,
  compileCapsule,
  loadCapsuleCategories,
  createCapsuleQueueItem,
  toOkfDetail,
  nodeEvalView,
  skillFileAssetWebUrl,
  domainOntologyFor,
  resolveChatContextMode,
  readSkillTextContext
});
const buddiesRoutes = createBuddiesRoutes({ sendJson, canCreateBuddyReq, isAdminReq, readJsonBody });
const peopleRoutes = createPeopleRoutes({
  webActor,
  sendJson,
  loadRoster,
  loadAuthentikUsers,
  normEmail,
  listGroups,
  isAdminReq,
  loadGroup,
  readJsonBody,
  slugifyGroupName,
  saveGroup,
  refreshCorpusGroupsIndex,
  deleteGroup
});
const skillsRoutes = createSkillsRoutes({
  canReadSkillActor,
  webActor,
  sendJson,
  readJsonBody,
  loadSkillConsumerContext,
  skillQueryDatasets,
  formatBytesServer,
  recordSkillEvent,
  DATASET_EXT_RE,
  loadSkillsFromDisk,
  loadSkillAccess,
  permitReq,
  roleReq,
  roleAllowsReq,
  invalidateCorpusIndexes,
  nodeEvalView,
  saveNodeEval,
  loadUserAiConfig,
  runNodeEval,
  testEvalCase,
  suggestEvalCases,
  loadSkillWorkingContext,
  loadScoringConfig,
  loadNodeEvalStored,
  mandatoryFor,
  loadEvalChecklist,
  normalizeDomainServer,
  composeSkillId,
  loadDomains,
  allowedDomainsForActor,
  saveDomains,
  aiModeNone,
  QUEUE_MAX_BODY,
  readPrompt,
  createDomainDenial,
  loadGovernanceIndex,
  stampCreator,
  curatesActiveBaldeReq,
  pushApproval,
  governanceIndexPath,
  commitCorpus,
  regenerateContextIndex,
  saveSkillAccess,
  relativeProjectPath,
  isEditableContextFile,
  saveGovernanceIndex,
  skillContextManifest,
  govSkillShape,
  conceptMediaEntries,
  skillFileAssetV1Url,
  processConceptMedia,
  MEDIA_IMG_EXTS,
  mediaMimeFor,
  resolveSkillFileAsset,
  canReadSkillReq,
  serveFileBytes,
  discoverSkillContextFiles,
  draftConceptEvalCriteria,
  gradeConceptEval,
  planCommonsMigration,
  applyCommonsMigration
});
const commonsRoutes = createCommonsRoutes({
  readJsonBody,
  commonsHasConcept,
  sendJson,
  canReadCommonsReq,
  DATASET_EXT_RE,
  webActor,
  commonsListForActor,
  permitReq,
  roleReq,
  roleAllowsReq,
  permissionsReq,
  corpusLinkIndex,
  invalidateCorpusIndexes,
  normalizeDomainServer,
  loadDomains,
  createDomainDenial,
  capsuleOutboundLink,
  commonsConceptContextPath,
  writeWizardMediaDescriptions,
  stampCreator,
  normSerieField,
  normPeriodoField,
  capsuleCategoryKeys,
  normCapsuleCategory,
  pushApproval,
  commonsConceptGovPath,
  writeCommonsAccessDoc,
  normEmail,
  commitRepo,
  listMediaFiles,
  MEDIA_IMG_EXTS,
  MEDIA_DATA_EXTS,
  loadCommonsConceptGov,
  isCommonsMediaFile,
  loadCommonsAccess,
  normEmailList,
  nodeEvalView,
  saveNodeEval,
  loadUserAiConfig,
  runNodeEval,
  testEvalCase,
  suggestEvalCases,
  saveCommonsConceptGov,
  saveCommonsDefaults,
  draftConceptEvalCriteria,
  gradeConceptEval,
  listCommonsConcepts,
  summarizeContextFilesWithAI,
  CONTEXT_INDEX_FILE,
  processConceptMedia,
  conceptMediaEntries,
  MEDIA_IMG_MAX_BYTES,
  mediaMimeFor,
  MEDIA_IMG_SYSTEM,
  MEDIA_DATA_MAX_BYTES,
  MEDIA_DATA_SYSTEM,
  resolveCommonsFileAsset,
  serveFileBytes,
  commonsFilePage,
  corpusIndexCacheByRepo,
  corpusLinkCacheByRepo
});
const proposalsRoutes = createProposalsRoutes({
  runNodeEval,
  sendJson,
  loadPersistedSuggestionsBySkill,
  readJsonBody,
  loadUserAiConfig,
  generateProposalCompletion,
  callDepartmentProxy,
  fallbackReport,
  permitReq,
  roleReq,
  persistProposalReturn
});
const exploreRoutes = createExploreRoutes({
  sendJson,
  roleReq,
  loadSkillWorkingContext,
  loadSkillConsumerContext,
  canReadSkillActor,
  webActor,
  loadCanonicalState,
  recordSkillEvent,
  usageForSkill,
  skillContextManifest,
  fileViewPage,
  searchCorpus
});
const documentsRoutes = createDocumentsRoutes({ webActor, sendJson, listDocs, MEDIA_IMG_EXTS, mediaMimeFor });
const capsulesRoutes = createCapsulesRoutes({
  webActor,
  sendJson,
  loadCapsuleCategories,
  readJsonBody,
  QUEUE_MAX_BODY,
  compileCapsule,
  READONLY_CORPUS,
  createCapsuleQueueItem,
  roleReq,
  normalizeDomainServer,
  loadDomains,
  loadUserAiConfig,
  loadSkillsFromDisk,
  canReadSkillActor,
  listCommonsConcepts,
  isOntologyCapsuleId,
  canReadCommonsActor,
  commonsConceptContextPath,
  domainOntologyId,
  commonsHasConcept,
  loadPromptBody
});
const evaluationRoutes = createEvaluationRoutes({
  permitReq,
  roleAllowsReq,
  webActor,
  sendJson,
  loadEvalChecklist,
  saveEvalChecklist,
  readJsonBody,
  loadScoringConfig,
  saveScoringConfig
});
const graphRoutes = createGraphRoutes({
  webActor,
  sendJson,
  corpusLinkIndex,
  canReadSkillActor,
  corpusGraphSnapshot,
  canReadCommonsActor,
  rebuildCorpusGraphSnapshot
});
const draftsRoutes = createDraftsRoutes({
  readJsonBody,
  permitReq,
  sendJson,
  persistManualSkillTextEdit,
  commitCorpus,
  persistContextUpload,
  regenerateContextIndex,
  rollbackDraftChange,
  persistDraftRequirementApproval
});

const healthRoutes = createHealthRoutes({ sendJson, browserSession });
const profileRoutes = createProfileRoutes({
  reqGroups,
  upsertRoster,
  loadUserPrefs,
  sendJson,
  curatesActiveBaldeReq,
  isBaldeAdminReq,
  permissionsReq,
  readJsonBody,
  webActor,
  saveUserPrefs,
  userAiStatus,
  saveUserAiConfig,
  loadUserAiConfig,
  authentikServiceReady,
  listUserApiTokens,
  createUserApiToken,
  revokeUserApiToken,
  revealUserApiToken,
  renameUserApiToken
});

async function handleApi(req, res, url) {
  const recoveryRoute = /^\/api\/(queue(?:\/|$)|health$|version$|me(?:\/|$)|repos(?:\/|$))/.test(url.pathname);
  if (!recoveryRoute) {
    const pending = await incompleteTransactions(repoDirOf(activeRepo()));
    if (pending.length) {
      sendJson(res, 409, {
        ok: false,
        error:
          'Uma cápsula ficou com a aplicação incompleta neste balde. Um curador conclui (Aprovar e aplicar de novo) ou desfaz (Desfazer aplicação) na Fila, em Conclusão pendente.',
        pending
      });
      return true;
    }
  }
  // O portão da instalação somente-leitura: cada escrita exige a ação que a regra única decide (D1). As subidas
  // de arquivo do MCP gravam no corpus como as da tela e passam pela mesma regra (até a 2.0.17 a chave da
  // máquina gravava onde a tela recusava).
  if (
    READONLY_CORPUS &&
    req.method !== 'GET' &&
    url.pathname.startsWith('/api/') &&
    (!url.pathname.startsWith('/api/v1/') || gateAction(req.method, url.pathname) === 'curar')
  ) {
    const action = gateAction(req.method, url.pathname);
    if (action !== 'livre') {
      const summary = await permissionsReq(req);
      // Sem classificação, só num balde local: a pasta é de quem o criou, e o curador grava o que é dele.
      const decision =
        action === null
          ? localRepos.has(activeRepo()) && summary.curar.ok
            ? summary.curar
            : {
                ok: false,
                reason:
                  'Instalação somente-leitura: o corpus é aplicado pelo curador. Envie conhecimento pela Fila (Colaborar / cápsulas / ingestão); sua contribuição chega ao curador pelo exchange.'
              }
          : summary[action];
      if (!decision.ok) {
        sendJson(res, 403, { ok: false, error: decision.reason });
        return true;
      }
    }
  }

  if (url.pathname.startsWith('/api/v1/')) {
    const startedAt = Date.now();
    res.once('finish', () => {
      recordApiCall({
        method: req.method,
        path: apiRouteTemplate(req.method, url.pathname),
        status: res.statusCode,
        ms: Date.now() - startedAt,
        actor: req._machineActor || null
      });
    });
  }
  if (await healthRoutes(req, res, url)) return true;
  if (await profileRoutes(req, res, url)) return true;
  if (await ingestionRoutes(req, res, url)) return true;
  if (await localIntegrationRoutes(req, res, url)) return true;
  if (await reposAccessRoutes(req, res, url)) return true;
  if (await shareFoldersRoutes(req, res, url)) return true;
  if (await chatRoutes(req, res, url)) return true;
  if (await plenariaRoutes(req, res, url)) return true;
  if (await administrationRoutes(req, res, url)) return true;
  if (await queueRoutes(req, res, url)) return true;
  if (await mergeRoutes(req, res, url)) return true;
  if (await machineApiRoutes(req, res, url)) return true;
  if (await buddiesRoutes(req, res, url)) return true;
  if (await peopleRoutes(req, res, url)) return true;
  if (await skillsRoutes(req, res, url)) return true;
  if (await commonsRoutes(req, res, url)) return true;
  if (await proposalsRoutes(req, res, url)) return true;
  if (await exploreRoutes(req, res, url)) return true;
  if (await documentsRoutes(req, res, url)) return true;
  if (await capsulesRoutes(req, res, url)) return true;
  if (await evaluationRoutes(req, res, url)) return true;
  if (await graphRoutes(req, res, url)) return true;
  if (await draftsRoutes(req, res, url)) return true;

  {
    const poseMatch = url.pathname.match(/^\/api\/(v1\/)?buddies\/([^/]+)\/poses\/([^/]+)$/);
    if (req.method === 'GET' && poseMatch) {
      if (poseMatch[1] && !(await authorizeMachine(req))) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <token>' });
        return true;
      }
      await servePoseImage(req, res, decodeURIComponent(poseMatch[2]), decodeURIComponent(poseMatch[3]));
      return true;
    }
  }

  if (await publicationRoute(req, res, url)) return true;

  return false;
}

async function stampIndexHtml() {
  const html = await readFile(join(publicDir, 'index.html'), 'utf8');
  let v = Date.now();
  try {
    const [a, s] = await Promise.all([stat(join(publicDir, 'app.js')), stat(join(publicDir, 'styles.css'))]);
    v = Math.trunc(Math.max(a.mtimeMs, s.mtimeMs));
  } catch (error) {
    /* fall back to now */
  }
  return html.replaceAll('"/app.js"', `"/app.js?v=${v}"`).replaceAll('"/styles.css"', `"/styles.css?v=${v}"`);
}
async function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const normalized = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(publicDir, normalized);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    if (normalized.endsWith('index.html')) {
      res.writeHead(200, { 'content-type': mimeTypes['.html'], 'cache-control': 'no-store' });
      res.end(await stampIndexHtml());
      return;
    }
    const content = await readFile(filePath);
    res.writeHead(200, {
      'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(content);
  } catch {
    res.writeHead(200, {
      'content-type': mimeTypes['.html'],
      'cache-control': 'no-store'
    });
    res.end(await stampIndexHtml());
  }
}

async function repoOfReq(req, url) {
  const isMachine = Boolean(url && url.pathname.startsWith('/api/v1/'));

  const wanted = String(req.headers['x-balde-repo'] || (url ? url.searchParams.get('repo') : '') || '')
    .trim()
    .toLowerCase();
  let groups = reqGroups(req);
  let email = normEmail(localIdentity().email);
  if (isMachine && wanted && wanted !== DEFAULT_REPO) {
    const machine = await authorizeMachine(req);
    if (!machine) return { error: 'Não autorizado.', status: 401 };
    groups = machine.groups || [];
    email = normEmail(machine.email || '');
  }
  if (wanted) {
    if (!REPO_NAME_RE.test(wanted)) return { error: `Repo inválido: "${wanted}".`, status: 400 };
    const entry = await repoByName(wanted);
    if (!entry || !isRepoMember(entry, groups, email)) {
      return { error: `Repo "${wanted}" não existe ou você não é membro.`, status: 404 };
    }
    return { repo: entry.name };
  }
  if (isMachine) return { repo: DEFAULT_REPO };
  try {
    const prefs = await loadUserPrefs(actorFromReq(req));
    const pref = String(prefs.repo || '')
      .trim()
      .toLowerCase();
    if (pref && pref !== DEFAULT_REPO && REPO_NAME_RE.test(pref)) {
      const entry = await repoByName(pref);
      if (entry && isRepoMember(entry, groups, email)) return { repo: entry.name };
    }
  } catch (error) {
    /* prefs unreadable — default repo */
  }
  return { repo: DEFAULT_REPO };
}

const handleRequest = async (req, res) => {
  try {
    const boundaryError = validateLocalRequest(req, port);
    if (boundaryError) {
      sendJson(res, 403, { ok: false, error: boundaryError });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/session' && req.method === 'POST') {
      const body = await readJsonBody(req, 1024);
      if (!browserSession.accepts(body.token)) {
        sendJson(res, 401, { error: 'Sessão local inválida.' });
        return;
      }
      res.setHeader('Set-Cookie', browserSession.issueCookie());
      sendJson(res, 200, { ok: true });
      return;
    }
    if (
      !browserSession.legacy &&
      url.pathname.startsWith('/api/') &&
      !url.pathname.startsWith('/api/v1/') &&
      !['/api/health', '/api/version'].includes(url.pathname) &&
      !browserSession.authenticated(req)
    ) {
      // O cabeçalho deixa a página distinguir "sessão necessária" de outros 401 e pedir uma nova ao app.
      res.setHeader('X-Balde-Session', 'required');
      sendJson(res, 401, { error: 'Abra o Balde pelo aplicativo local para iniciar uma sessão.' });
      return;
    }
    if (url.pathname === '/api/session/logout' && req.method === 'POST') {
      browserSession.revoke(req);
      res.setHeader('Set-Cookie', 'balde_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
      sendJson(res, 200, { ok: true });
      return;
    }
    // A página chama de tempos em tempos só para a sessão não expirar por inatividade.
    if (url.pathname === '/api/session/ping' && req.method === 'GET') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const ctx = await repoOfReq(req, url);
      if (ctx.error) {
        sendJson(res, ctx.status || 403, { ok: false, error: ctx.error });
        return;
      }
      await runWithRepo(ctx.repo, async () => {
        const dispatch = () => handleApi(req, res, url);
        let handled;
        if (req.method === 'POST' && url.pathname.startsWith('/api/queue/') && url.pathname !== '/api/queue/submit') {
          const body = await readJsonBody(req, QUEUE_MAX_BODY);
          handled = await serializeOperation(`${queueRoot()}:${String(body.id || '')}`, () =>
            withFileLock(join(queueRoot(), '_locks', operationKey(String(body.id || '')) + '.lock'), dispatch)
          );
        } else handled = await dispatch();
        if (handled) return;
        sendJson(res, 404, { ok: false, error: `Endpoint não encontrado: ${req.method} ${url.pathname}` });
      });
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message
    });
  }
};
const server = createServer((req, res) => runWithTestIdentity(req, () => handleRequest(req, res)));

await ensureRepoLayout(); // repo layout guard: migrate legacy corpus or refuse to boot on ambiguity

await reloadRepoRegistry();

if (!READONLY_CORPUS && process.env.BALDE_SHELL_EXE)
  await migrateRepoManifests().catch((error) =>
    console.warn(`Baldes: migração dos manifestos falhou: ${error.message}`)
  );

if (legacyCentralQueueRoot)
  await migrateCentralQueue().catch((error) => console.warn(`Fila: migração da fila central falhou: ${error.message}`));

if (baldeFeedback)
  await migrateLocalFeedbackLog().catch((error) =>
    console.warn(`Feedback: migração do log local falhou: ${error.message}`)
  );
await loadApiKeyStore();
server.listen(port, '127.0.0.1', async () => {
  console.log(`Balde de conhecimento (Knowledge pail) running at http://localhost:${port}`);
  if (browserSession.legacy)
    console.log(
      'Sessão local em modo legado: o app que iniciou este servidor é anterior à 2.0.16 (sem BALDE_WEB_SESSION_KEY).'
    );

  ensureRepo(buddiesRoot, 'buddies');
  ensureRepo(groupsRoot, 'groups');

  refreshCorpusGroupsIndex();
  const groupsIndexTimer = setInterval(refreshCorpusGroupsIndex, 30000);
  if (typeof groupsIndexTimer.unref === 'function') groupsIndexTimer.unref();

  if (mcpSupported()) {
    try {
      if (!currentApiKey() && process.env.BALDE_SECRET_KEY) {
        await ensureLocalMachineKey();
        console.log('MCP: chave de máquina (re)gerada no boot — store ausente ou ilegível.');
      }
      if (currentApiKey()) {
        const written = await refreshAllLaunchers({
          nodeExe: process.execPath,
          mcpServerPath: join(rootDir, 'integrations', 'ai-tools', 'mcp-server.mjs'),
          baseUrl: `http://127.0.0.1:${port}`,
          apiKey: currentApiKey()
        });
        if (written.length) console.log(`MCP: ${written.length} launcher(s) atualizado(s) para esta release.`);

        await writeBaldeCliLauncher({
          nodeExe: process.execPath,
          cliScriptPath: join(rootDir, 'integrations', 'ai-tools', 'balde-ask.mjs'),
          baseUrl: `http://127.0.0.1:${port}`,
          apiKey: currentApiKey()
        });
      }
    } catch (error) {
      /* nunca quebra o boot */
    }
  }
  ensurePromptsSeed();
  migrateLegacyQueueAndPolicy()
    .then(() => forEachRepoSeed())
    .catch(() => {});
  ensureDocs();
  let bootRepos = [DEFAULT_REPO];
  try {
    bootRepos = (await listRepos()).map((r) => r.name);
  } catch (error) {
    /* registry unreadable */
  }
  for (const repo of bootRepos) {
    await runWithRepo(repo, async () => {
      await ensureCorpusRepo();
      await ensureDomainsSeed();
      await ensureCommons();
    }).catch(() => {});
  }
  startFeedbackMonitor();
});
