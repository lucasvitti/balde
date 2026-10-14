import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptSecret } from './secrets.mjs';
import { loadLocalEnv } from './env-loader.mjs';

await loadLocalEnv(process.cwd());

const defaultSkillsRoot = './demo-corpus/repos/corporate/skills';
const defaultLogsRoot = './demo-corpus/logs';
const skillsRoot = process.env.SKILLS_ROOT || defaultSkillsRoot;
const logsRoot = process.env.LOGS_ROOT || defaultLogsRoot;
const outputRoot = process.env.GOVERNANCE_OUTPUT_ROOT || 'governance\\skills';

function slug(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseFrontmatter(markdown) {
  const cleanMarkdown = markdown.replace(/^\uFEFF/, '');
  const match = cleanMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      meta: {},
      body: cleanMarkdown
    };
  }

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!item) {
      continue;
    }

    const [, key, rawValue] = item;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }

  return {
    meta,
    body: cleanMarkdown.slice(match[0].length)
  };
}

function latestConversationPair(conversation = []) {
  const assistantIndex = conversation.findLastIndex((item) => item.role === 'assistant');
  const answer = assistantIndex >= 0 ? conversation[assistantIndex]?.content || '' : '';
  const prior = assistantIndex >= 0 ? conversation.slice(0, assistantIndex) : conversation;
  const question = [...prior].reverse().find((item) => item.role === 'user')?.content || '';

  return {
    question,
    answer
  };
}

function normalizeText(value = '') {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function normalizeFeedbackKey(value = '') {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isBusinessContextQuestion(question = '') {
  const normalized = normalizeText(question);
  return /\b(o que e|oque e|qual e|qual o significado|me explique|explique|defina|definicao|significa|conceito|conceitue)\b/.test(normalized)
    || /\badesao zero\b/.test(normalized);
}

function extractBusinessContextTerm(question = '') {
  const match = String(question).match(/ades[aã]o zero/i);
  if (match) {
    return 'Adesão Zero';
  }

  return 'o termo perguntado';
}

function feedbackSuggestionKey(item) {
  return [
    item.skillId || '__unknown__',
    normalizeFeedbackKey(item.question),
    normalizeFeedbackKey(item.answer),
    normalizeFeedbackKey(localSuggestionForMessage(item).title)
  ].join('|');
}

function feedbackOccurrence(item) {
  return {
    id: item.id,
    timestamp: item.timestamp,
    user: item.user,
    machine: item.machine,
    sessionId: item.sessionId,
    sourceFile: item.sourceFile
  };
}

function appendWrongFeedback(grouped, skillId, item) {
  const items = grouped.get(skillId) || [];
  const dedupeKey = feedbackSuggestionKey(item);
  const existing = items.find((candidate) => candidate.dedupeKey === dedupeKey);

  if (existing) {
    existing.duplicateCount = (existing.duplicateCount || 1) + 1;
    existing.occurrences = [
      ...(existing.occurrences || [feedbackOccurrence(existing)]),
      feedbackOccurrence(item)
    ];
    existing.lastTimestamp = item.timestamp || existing.lastTimestamp || existing.timestamp;
    return;
  }

  grouped.set(skillId, [
    ...items,
    {
      ...item,
      dedupeKey,
      duplicateCount: 1,
      occurrences: [feedbackOccurrence(item)],
      lastTimestamp: item.timestamp
    }
  ]);
}

function localSuggestionForMessage(item) {
  const question = normalizeText(item.question);
  const answer = normalizeText(item.answer);
  const looksLikeGreeting = /\b(oi|ola|bom dia|boa tarde|boa noite|fale sobre voce|fale sobre você)\b/.test(question);
  const answeredAsGenericAssistant = answer.includes('sou um assistente') || answer.includes('estou aqui para ajudar');

  if (looksLikeGreeting && answeredAsGenericAssistant) {
    return {
      title: 'Tratar saudação e metapergunta fora do objetivo',
      shouldApply: true,
      rationale: 'O usuário marcou como Errado uma resposta genérica de apresentação dentro de uma skill especializada.',
      proposedChange: 'Quando a pergunta for saudação, metapergunta ou pedido fora do objetivo, responder curto, declarar o escopo da skill e pedir uma amostra/entrada válida, sem se apresentar como assistente genérico.',
      acceptanceCase: 'Pergunta: "oi, fale sobre você" deve responder com o escopo da skill e pedir uma amostra válida, sem se apresentar como assistente genérico.',
      severity: 'alta'
    };
  }

  if (isBusinessContextQuestion(item.question)) {
    const term = extractBusinessContextTerm(item.question);
    return {
      title: 'Decidir escopo e definição aprovada do termo de negócio',
      shouldApply: true,
      rationale: `A pergunta marcada como Errado pede definição de "${term}" e a resposta parece ter sido inferida sem referência aprovada na skill.`,
      proposedChange: `Quando a pergunta for sobre "${term}", responder apenas se houver definição, fonte ou regra de negócio aprovada no contexto da skill. Sem essa referência, não explicar por inferência; declarar que a skill não tem contexto aprovado para o termo e pedir a base ou regra de negócio.`,
      acceptanceCase: `Critério de aceite: diante da pergunta "${item.question || '(sem pergunta registrada)'}", a skill só responde se existir definição/fonte aprovada para "${term}"; caso contrário recusa a definição e pede contexto de negócio.`,
      severity: 'alta'
    };
  }

  return {
    title: 'Revisar feedback Errado com análise de IA',
    shouldApply: true,
    rationale: 'A pergunta e a resposta precisam ser classificadas antes de virar uma ação para o owner. UAT não deve ser a recomendação padrão para todo feedback Errado.',
    proposedChange: 'Submeter o par pergunta/resposta à IA e converter o resultado em uma ação específica: pedir contexto de negócio, ajustar regra de prompt, corrigir fonte/dados ou declarar fora de escopo.',
    acceptanceCase: `Feedback original para triagem: ${item.question || '(sem pergunta registrada)'}`,
    severity: 'média'
  };
}

function localGovernanceSuggestions(skill, wrongFeedbacks) {
  const suggestions = [];
  const meta = skill.meta;
  const text = normalizeText(skill.body);

  if (!meta.status || !meta.objetivo || !meta.escopo) {
    suggestions.push({
      title: 'Completar frontmatter de governança',
      shouldApply: true,
      rationale: 'O rascunho ainda não declara explicitamente campos necessários para owner review e canonização. O campo deve ficar em aberto até o owner solicitar uma sugestão por IA.',
      proposedChange: '',
      acceptanceCase: '',
      severity: 'alta',
      aiFillAvailable: true,
      aiFillKind: 'frontmatter'
    });
  }

  if (!text.includes('voce e') && !text.includes('you are')) {
    suggestions.push({
      title: 'Completar papel e contexto da skill',
      shouldApply: true,
      rationale: 'O prompt ainda não abre com papel/contexto claros, requisito mínimo para canonização. O texto deve ser sugerido por IA apenas quando o owner clicar em Gerar com IA.',
      proposedChange: '',
      acceptanceCase: '',
      severity: 'alta',
      aiFillAvailable: true,
      aiFillKind: 'role_context'
    });
  }

  if (!text.includes('nao invente') && !text.includes('responda apenas') && !text.includes('recuse')) {
    suggestions.push({
      title: 'Definir recusa explícita',
      shouldApply: true,
      rationale: 'A skill precisa recusar quando faltar dado, fonte, coluna, período ou granularidade. O texto final deve ser gerado sob demanda para economizar tokens.',
      proposedChange: '',
      acceptanceCase: '',
      severity: 'alta',
      aiFillAvailable: true,
      aiFillKind: 'refusal_rule'
    });
  }

  if (!skill.hasEval) {
    suggestions.push({
      title: 'Criar eval/cases.json',
      shouldApply: true,
      rationale: 'Sem UAT por asserção, o owner não tem como validar regressão antes de promover o rascunho. O rascunho de eval deve ser gerado apenas sob demanda.',
      proposedChange: '',
      acceptanceCase: '',
      severity: 'alta',
      aiFillAvailable: true,
      aiFillKind: 'eval_cases'
    });
  }

  if (meta.output_format === 'structured' && !skill.hasOutputSchema) {
    suggestions.push({
      title: 'Adicionar output_schema.json',
      shouldApply: true,
      rationale: 'Saída estruturada precisa de contrato explícito para validação e consumo pelo Excel. O schema deve ser sugerido por IA apenas quando solicitado.',
      proposedChange: '',
      acceptanceCase: '',
      severity: 'alta',
      aiFillAvailable: true,
      aiFillKind: 'output_schema'
    });
  }

  return dedupeSuggestions([
    ...suggestions,
    ...wrongFeedbacks.map(localSuggestionForMessage)
  ]);
}

function dedupeSuggestions(suggestions) {
  const seen = new Set();
  const deduped = [];

  for (const suggestion of suggestions) {
    const key = [
      suggestion.title,
      suggestion.proposedChange,
      suggestion.acceptanceCase
    ].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(suggestion);
  }

  return deduped;
}

async function getOpenAiApiKey() {
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  if (!process.env.BALDE_SECRET_KEY || !process.env.OPENAI_API_KEY_ENC_PATH) {
    return null;
  }

  try {
    return await decryptSecret({
      inputPath: process.env.OPENAI_API_KEY_ENC_PATH,
      secretKey: process.env.BALDE_SECRET_KEY
    });
  } catch {
    return null;
  }
}

async function callAiForSuggestions(skill, wrongFeedbacks, localSuggestions) {
  const payload = {
    skill: {
      id: skill.id,
      name: skill.meta.name || skill.id,
      frontmatter: skill.meta,
      markdown: skill.markdown.slice(0, 16000)
    },
    wrongFeedbacks,
    localSuggestions
  };

  if (process.env.AI_PROXY_URL) {
    const response = await fetch(process.env.AI_PROXY_URL, {
      method: 'post',
      headers: {
        'content-type': 'application/json',
        ...(process.env.AI_PROXY_TOKEN ? { authorization: `Bearer ${process.env.AI_PROXY_TOKEN}` } : {})
      },
      body: JSON.stringify({
        type: 'skill_change_suggestions',
        payload
      })
    });

    if (!response.ok) {
      throw new Error(`AI proxy returned ${response.status}`);
    }

    return response.json();
  }

  if (process.env.AI_DIRECT_OPENAI === '1') {
    const apiKey = await getOpenAiApiKey();
    if (apiKey) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'post',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4.1',
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'Você sugere mudanças em rascunhos de skills de IA com base nos requisitos mínimos de governança e em mensagens reais marcadas como Errado. Primeiro decida se a alteração faz sentido. Para cada feedback Errado, leia a pergunta e a resposta antes de sugerir mudança e classifique a causa: falta_de_contexto_negocio, fora_de_escopo, erro_de_prompt, erro_de_dados, saudacao_metapergunta ou outro. Para perguntas conceituais ou termos de negócio sem contexto explícito na skill, não recomende criar UAT como ação principal. Quando proposedChange for uma regra de prompt, escreva a regra diretamente, sem começar com "Adicionar regra", "Adicionar ao prompt", "Criar regra" ou equivalente. Para termos de negócio, a regra deve dizer se responde com definição/fonte aprovada ou se recusa por falta de contexto aprovado. Quando faltarem informações básicas de governança, não preencha o conteúdo automaticamente nesta etapa: deixe proposedChange e acceptanceCase vazios, marque aiFillAvailable=true e informe aiFillKind como frontmatter, role_context, refusal_rule, eval_cases ou output_schema. O preenchimento real será feito por outro endpoint quando o owner clicar em Gerar com IA. Responda JSON válido com provider, summary e suggestions[]. Cada suggestion deve ter title, shouldApply boolean, rationale, proposedChange, acceptanceCase, severity e, quando aplicável, aiFillAvailable e aiFillKind. Só marque shouldApply=true quando a mudança melhorar a skill sem desviar do objetivo/escopo.'
            },
            {
              role: 'user',
              content: JSON.stringify(payload)
            }
          ]
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI returned ${response.status}: ${errorBody.slice(0, 500)}`);
      }

      const data = await response.json();
      return JSON.parse(data.choices?.[0]?.message?.content || '{}');
    }
  }

  return {
    provider: 'local-fallback',
    summary: 'Sugestões geradas por regras locais porque nenhuma IA real foi configurada no ambiente.',
    suggestions: localSuggestions
  };
}

async function loadWrongFeedbacks() {
  const feedbackRoot = join(logsRoot, 'feedback');
  const grouped = new Map();

  let entries = [];
  try {
    entries = await readdir(feedbackRoot, { withFileTypes: true });
  } catch {
    return grouped;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
      continue;
    }

    const fullPath = join(feedbackRoot, entry.name);
    const lines = (await readFile(fullPath, 'utf8')).split(/\r?\n/).filter(Boolean);
    for (const [lineIndex, line] of lines.entries()) {
      try {
        const parsed = JSON.parse(line);
        if (String(parsed.verdict || '').toLowerCase() !== 'errado') {
          continue;
        }

        const { question, answer } = latestConversationPair(parsed.conversation || []);
        const item = {
          id: `${entry.name}:${lineIndex + 1}`,
          timestamp: parsed.timestamp,
          user: parsed.user,
          machine: parsed.machine,
          sessionId: parsed.sessionId,
          skillId: parsed.skillId,
          skillName: parsed.skillName,
          verdict: parsed.verdict,
          question,
          answer,
          sourceFile: fullPath
        };

        const key = parsed.skillId || '__unknown__';
        appendWrongFeedback(grouped, key, item);
      } catch {
        continue;
      }
    }
  }

  return grouped;
}

async function loadSkills() {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const id = entry.name;
    const folder = join(skillsRoot, id);
    const skillPath = join(folder, 'SKILL.md');
    let markdown = '';
    try {
      markdown = await readFile(skillPath, 'utf8');
    } catch {
      continue;
    }

    const { meta, body } = parseFrontmatter(markdown);
    const hasEval = await fileExists(join(folder, 'eval', 'cases.json'));
    const hasOutputSchema = await fileExists(join(folder, 'output_schema.json'));
    skills.push({
      id,
      folder,
      skillPath,
      markdown,
      meta,
      body,
      hasEval,
      hasOutputSchema
    });
  }

  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

async function fileExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function writeTextIfChanged(path, content) {
  try {
    const current = await readFile(path, 'utf8');
    if (current === content) {
      return false;
    }

    if (path.endsWith('.json') && sameJsonIgnoringGeneratedAt(current, content)) {
      return false;
    }

    if (path.endsWith('README.md') && stripGeneratedLine(current) === stripGeneratedLine(content)) {
      return false;
    }
  } catch {
    // Missing files are created below.
  }

  await writeFile(path, content, 'utf8');
  return true;
}

function stripGeneratedLine(value) {
  return value
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('Gerado em:'))
    .join('\n');
}

function sameJsonIgnoringGeneratedAt(left, right) {
  try {
    return JSON.stringify(stripGeneratedAt(JSON.parse(left))) === JSON.stringify(stripGeneratedAt(JSON.parse(right)));
  } catch {
    return false;
  }
}

function stripGeneratedAt(value) {
  if (Array.isArray(value)) {
    return value.map(stripGeneratedAt);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'generatedAt')
        .map(([key, child]) => [key, stripGeneratedAt(child)])
    );
  }

  return value;
}

function renderMarkdown(skill, result, wrongFeedbacks) {
  const lines = [
    `# ${skill.meta.name || skill.id}`,
    '',
    `- skill_id: \`${skill.id}\``,
    `- source: \`${skill.skillPath}\``,
    `- provider: \`${result.provider || 'unknown'}\``,
    `- wrong_feedbacks: ${wrongFeedbacks.length}`,
    '',
    '## Resumo',
    '',
    result.summary || 'Sem resumo.',
    '',
    '## Sugestões',
    ''
  ];

  for (const [index, suggestion] of (result.suggestions || []).entries()) {
    lines.push(`### ${index + 1}. ${suggestion.title || 'Sugestão sem título'}`);
    lines.push('');
    lines.push(`- aplicar: ${suggestion.shouldApply === false ? 'não' : 'sim'}`);
    lines.push(`- severidade: ${suggestion.severity || 'média'}`);
    lines.push(`- motivo: ${suggestion.rationale || 'Não informado.'}`);
    lines.push(`- mudança proposta: ${suggestion.proposedChange || 'Não informada.'}`);
    lines.push(`- caso de aceite: ${suggestion.acceptanceCase || 'Não informado.'}`);
    lines.push('');
  }

  if (wrongFeedbacks.length) {
    lines.push('## Mensagens marcadas como Errado');
    lines.push('');
    for (const item of wrongFeedbacks) {
      lines.push(`### ${item.timestamp || item.id}`);
      lines.push('');
      lines.push(`**Pergunta:** ${item.question || '(sem pergunta registrada)'}`);
      lines.push('');
      lines.push(`**Resposta:** ${item.answer || '(sem resposta registrada)'}`);
      lines.push('');
    }
  }

  return `${lines.join('\n')}\n`;
}

function normalizeSuggestions(suggestions) {
  return (suggestions || []).map((suggestion) => {
    const aiFillAvailable = Boolean(suggestion.aiFillAvailable || suggestion.ai_fill_available);

    return {
      title: suggestion.title || 'Sugestão sem título',
      shouldApply: aiFillAvailable ? true : suggestion.shouldApply !== false,
      rationale: suggestion.rationale || 'Não informado.',
      proposedChange: aiFillAvailable ? '' : suggestion.proposedChange || suggestion.proposed_change || '',
      acceptanceCase: aiFillAvailable ? '' : suggestion.acceptanceCase || suggestion.acceptance_case || '',
      severity: suggestion.severity || 'média',
      aiFillAvailable,
      aiFillKind: suggestion.aiFillKind || suggestion.ai_fill_kind || null
    };
  });
}

function suggestionKey(suggestion) {
  return [
    suggestion.title,
    suggestion.proposedChange,
    suggestion.acceptanceCase
  ].map((value) => String(value || '').trim().toLowerCase()).join('|');
}

async function loadExistingSuggestionStates(skillOutputDir) {
  const suggestionPath = join(skillOutputDir, 'suggestions.json');
  try {
    const parsed = JSON.parse(await readFile(suggestionPath, 'utf8'));
    const statesByKey = new Map();
    const statesByTitle = new Map();

    for (const suggestion of parsed.suggestions || []) {
      if (!suggestion.status && !suggestion.approvedAt && !suggestion.reviewPath) {
        continue;
      }

      const state = {
        status: suggestion.status,
        approvedAt: suggestion.approvedAt,
        approvedBy: suggestion.approvedBy,
        approvedVersion: suggestion.approvedVersion,
        returnedAt: suggestion.returnedAt,
        returnedBy: suggestion.returnedBy,
        returnReason: suggestion.returnReason,
        reviewPath: suggestion.reviewPath
      };
      statesByKey.set(suggestionKey(suggestion), state);
      statesByTitle.set(String(suggestion.title || '').trim().toLowerCase(), state);
    }

    return {
      statesByKey,
      statesByTitle
    };
  } catch {
    return {
      statesByKey: new Map(),
      statesByTitle: new Map()
    };
  }
}

function preserveSuggestionStates(suggestions, existingStates) {
  return suggestions.map((suggestion) => {
    const state = existingStates.statesByKey.get(suggestionKey(suggestion)) ||
      existingStates.statesByTitle.get(String(suggestion.title || '').trim().toLowerCase());

    return state ? { ...suggestion, ...state } : suggestion;
  });
}

export async function generateGovernanceSuggestions() {
  const wrongFeedbacks = await loadWrongFeedbacks();
  const skills = await loadSkills();
  const index = {
    generatedAt: new Date().toISOString(),
    skillsRoot,
    logsRoot,
    outputRoot,
    skills: []
  };

  await mkdir(outputRoot, { recursive: true });

  for (const skill of skills) {
    const skillOutputDir = join(outputRoot, slug(skill.id));
    const skillFeedbacks = wrongFeedbacks.get(skill.id) || [];
    const existingStates = await loadExistingSuggestionStates(skillOutputDir);
    const localSuggestions = localGovernanceSuggestions(skill, skillFeedbacks);
    const aiResult = await callAiForSuggestions(skill, skillFeedbacks, localSuggestions).catch((error) => ({
      provider: 'ai-error-local-fallback',
      error: error.message,
      summary: 'A chamada de IA falhou; sugestões locais foram preservadas.',
      suggestions: localSuggestions
    }));

    const result = {
      ...aiResult,
      skillId: skill.id,
      skillName: skill.meta.name || skill.id,
      generatedAt: new Date().toISOString(),
      wrongFeedbackCount: skillFeedbacks.length,
      suggestions: preserveSuggestionStates(
        normalizeSuggestions(aiResult.suggestions || localSuggestions),
        existingStates
      )
    };

    await mkdir(skillOutputDir, { recursive: true });
    await writeTextIfChanged(join(skillOutputDir, 'SKILL.md'), skill.markdown);
    await writeTextIfChanged(join(skillOutputDir, 'wrong-feedback.json'), `${JSON.stringify(skillFeedbacks, null, 2)}\n`);
    await writeTextIfChanged(join(skillOutputDir, 'suggestions.json'), `${JSON.stringify(result, null, 2)}\n`);
    await writeTextIfChanged(join(skillOutputDir, 'suggestions.md'), renderMarkdown(skill, result, skillFeedbacks));

    index.skills.push({
      id: skill.id,
      name: skill.meta.name || skill.id,
      outputDir: skillOutputDir,
      wrongFeedbackCount: skillFeedbacks.length,
      suggestionCount: result.suggestions?.length || 0,
      provider: result.provider || 'unknown'
    });
  }

  await writeTextIfChanged(join(outputRoot, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  await writeTextIfChanged(join(outputRoot, 'README.md'), renderIndexMarkdown(index));
  return index;
}

function renderIndexMarkdown(index) {
  const lines = [
    '# Governança de Skills',
    '',
    `Gerado em: ${index.generatedAt}`,
    '',
    '| Skill | Feedbacks Errado | Sugestões | Provider |',
    '|---|---:|---:|---|'
  ];

  for (const skill of index.skills) {
    lines.push(`| ${skill.name} | ${skill.wrongFeedbackCount} | ${skill.suggestionCount} | ${skill.provider} |`);
  }

  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const index = await generateGovernanceSuggestions();
  process.stdout.write(JSON.stringify({
    outputRoot: index.outputRoot,
    skillCount: index.skills.length,
    wrongFeedbackCount: index.skills.reduce((sum, skill) => sum + skill.wrongFeedbackCount, 0),
    suggestionCount: index.skills.reduce((sum, skill) => sum + skill.suggestionCount, 0)
  }, null, 2));
}
