import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontmatter } from '../skill-format.mjs';
import { promptsRoot } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { ensureRepo } from '../git-corpus.mjs';

export function createPromptsFeature({ commitRepo }) {
  const DEFAULT_PROMPTS = [
    {
      id: 'aviso-depreciacao',
      step: 0,
      output: 'text',
      label: 'Aviso de depreciação (chat + MCP)',
      body: `ATENÇÃO: esta skill está DEPRECIADA (conteúdo possivelmente desatualizado). Motivos: {{motivos}}.
  Ao usá-la: avise o usuário de que a informação pode estar desatualizada, indique que a skill aguarda revisão da curadoria e NÃO apresente números ou regras dela como verdade atual sem essa ressalva.`
    },
    {
      id: 'aviso-qualidade',
      step: 0,
      output: 'text',
      label: 'Aviso de qualidade baixa (chat + MCP)',
      body: `ATENÇÃO: esta skill tem selo de qualidade BAIXO (nota {{nota}}, {{selo}}/100) — pouco validada, casos de uso escassos ou governança incompleta. Ao usá-la: avise o usuário de que o conteúdo tem baixa validação e trate números e regras dela com cautela, deixando essa ressalva explícita na resposta.`
    },
    {
      id: 'ontologia-sugerir',
      step: 0,
      output: 'markdown',
      label: 'Ontologia — sugestão por IA',
      body: `Você propõe a ONTOLOGIA de um domínio do Balde — o vocabulário controlado do domínio: os conceitos de negócio canônicos, uma definição clara de cada um e os sinônimos aceitos (outros nomes que as pessoas usam para a mesma coisa).
  A partir do material do domínio (skills e cápsulas anexadas no payload), identifique de 5 a 15 conceitos recorrentes e centrais.
  Responda SOMENTE com markdown neste formato exato, sem frontmatter e sem texto fora dele:
  
  # Ontologia do domínio {{dominio}}
  
  <preâmbulo de 1 a 2 frases sobre o vocabulário deste domínio>
  
  ## <Termo canônico>
  <definição em 1 a 3 frases, pt-BR, auto-contida — legível por quem nunca viu o material>
  
  **Sinônimos:** <lista separada por vírgulas; omita esta linha quando não houver sinônimos>
  
  Regras: um conceito por seção "##"; o termo canônico na forma mais usada no material; NÃO invente conceitos que não aparecem no material; defina com base apenas no material fornecido; prefira termos de negócio a nomes técnicos de arquivo/tabela.`
    },
    {
      id: 'ontologia-complementar',
      step: 0,
      output: 'markdown',
      label: 'Ontologia — sugestão de adições (IA)',
      body: `Você COMPLEMENTA a ontologia existente de um domínio do Balde. O payload traz a ontologia atual (ontologiaAtual, markdown) e o material do domínio (skills e cápsulas).
  Proponha APENAS adições:
  (a) conceitos NOVOS relevantes que aparecem no material e ainda não estão na ontologia;
  (b) sinônimos ADICIONAIS para conceitos que já existem.
  Responda SOMENTE com markdown neste formato, sem frontmatter e sem texto fora dele:
  
  ## <Termo>
  <para conceito NOVO: definição em 1 a 3 frases, pt-BR, auto-contida. Para conceito EXISTENTE que só ganha sinônimos: repita o termo EXATAMENTE como está na ontologia e não escreva definição>
  
  **Sinônimos:** <lista separada por vírgulas; para conceito existente, liste apenas os sinônimos NOVOS>
  
  Regras: NÃO repita conceitos existentes sem novidade; NÃO reescreva definições existentes; conceitos novos só se aparecem de fato no material; no máximo 10 adições; se não houver nada a adicionar, responda apenas "# Sem adições".`
    },
    {
      id: 'eval-resposta-estruturada',
      step: 0,
      output: 'json',
      label: 'Avaliação — reforço de resposta estruturada',
      body: `Reforço para a avaliação: responda SEMPRE em JSON válido, exatamente no formato pedido, sem texto fora do JSON.
  Para itens com "opcoes": escolha apenas valores presentes na lista; se nenhum se aplicar, retorne "selecionadas": []. A "evidencia" deve ser um trecho curto e literal do artefato (ou "não encontrado").
  Para itens sem "opcoes": "verdict" deve ser exatamente "pass" ou "fail".`
    },
    {
      id: 'create-params',
      step: 1,
      output: 'json',
      label: 'Etapa 1 — Parâmetros gerais',
      body: `Você ajuda a preencher os parâmetros iniciais de uma skill do RevenueHub.
  A partir de um título e de uma intenção curta (e, quando fornecido, do vocabulário de tags já usado no corpus), responda SOMENTE com JSON válido:
  {
    "slug": "kebab-case sem acentos, derivado do título",
    "description": "uma frase objetiva do que a skill entrega",
    "objetivo": "o que a skill deve alcançar (a definição principal)",
    "escopo": "o que ela faz e o que NÃO faz / quando recusar",
    "tags": ["3 a 6 tags em minúsculas, reaproveitando o vocabulário do corpus quando fizer sentido"]
  }
  Regras: não invente escopo além do que o título/intenção sugerem; slug em minúsculas com hifens, sem espaços nem acentos.`
    },
    {
      id: 'create-skillmd',
      step: 2,
      output: 'markdown',
      label: 'Etapa 2 — Corpo do SKILL.md',
      body: `Você redige o corpo do SKILL.md (padrão OKF) de uma skill do Hub, em pt-BR, a partir do objetivo e do escopo informados.
  Produza exatamente estas seções em markdown:
  ## Papel
  Quem a skill é + o objetivo, em uma ou duas frases.
  ## Como responder
  Passo a passo de como a resposta é produzida e o formato de saída (campos/ordem). Se houver output_schema.json, responda nesse formato.
  ## Regras inegociáveis
  - Não inventar dados, números, nomes ou prazos fora da entrada.
  - Recusar quando faltar base, declarando o que falta.
  - Não buscar informação fora do contexto fornecido.
  Se o autor já colou ou subiu um .md, PRESERVE o conteúdo dele e apenas complete lacunas e alinhe ao padrão. Não gere frontmatter; não publique nem aprove nada.`
    },
    {
      id: 'create-catalog',
      step: 3,
      output: 'json',
      label: 'Etapa 3 — catalog.json a partir de dados',
      body: `Você gera metadados de catálogo (catalog.json) a partir de uma amostra tabular: a primeira linha é o cabeçalho e as demais são exemplos.
  Responda SOMENTE com JSON válido no formato { "columns": [ { … } ] }, um objeto por coluna do cabeçalho, com:
  - name: exatamente como no cabeçalho.
  - display_name: versão humana pt-BR (snake_case → Title Case; nrc→NRC, qtd→Quantidade, dt_*→Data de *, vlr_*→Valor *).
  - type: um de text|number|date|boolean|percent|currency, inferido dos exemplos. IDs são sempre "text".
  - description: frase curta do significado de negócio da coluna.
  - format: máscara Excel (currency "R$ #,##0.00", percent "0.0%", date "yyyy-mm-dd", number "#,##0.##" ou "#,##0", text/boolean null).
  - filterable: true por padrão. default_visible: true para as 4–8 colunas mais úteis.
  - allowed_values: preencha apenas se a coluna for claramente enum (≤6 valores distintos, textuais); senão null.
  Não invente colunas; em dúvida sobre o tipo, escolha o mais conservador (text). Apenas o JSON, sem markdown.`
    },
    {
      id: 'create-query',
      step: 4,
      output: 'json',
      label: 'Etapa 4 — Consistência de query',
      body: `Você revisa um script (SQL ou similar) de uma skill do Hub quanto à consistência. ASSUMA que as tabelas e campos upstream referenciados existem — não valide a existência deles.
  Verifique: consistência de conceitos com os catálogos/colunas declarados na skill; erros prováveis de query (joins sem chave, agregação sem GROUP BY, filtros ambíguos, aliases quebrados, colunas referenciadas mas não projetadas); alinhamento com o objetivo/escopo da skill.
  Responda SOMENTE com JSON válido:
  { "issues": [ { "severidade": "alta|media|baixa", "local": "trecho ou linha", "descricao": "…", "sugestao": "…" } ], "resumo": "1–2 frases", "script_revisado": "opcional, versão corrigida" }
  Não invente tabelas nem campos; se o script estiver consistente, retorne issues vazio.`
    },
    {
      id: 'create-report',
      step: 5,
      output: 'json',
      label: 'Etapa 5 — report.json a partir do template',
      body: `Você gera report.json a partir da descrição do template Excel e do(s) dataset(s) que acompanham o relatório.
  Responda SOMENTE com JSON válido:
  { "template": "template.xlsx", "output_mode": "new_workbook|active_workbook",
    "datasets": [ { "id": "…", "data_file": "…", "columns": [ /* mesmo shape de coluna do catálogo */ ] } ],
    "data_bindings": [ { "dataset_id ou catalog_id": "…", "target_sheet": "…", "target_range": "A2", "include_header": false, "columns": ["…ordem exigida pelo template…"], "filters": {} } ] }
  A ordem em data_bindings[].columns é o contrato com as fórmulas do template — todo nome precisa existir nas colunas do dataset. Havendo mais de um dataset, todo binding declara dataset_id. Não invente nomes de coluna, aba nem dataset. Apenas o JSON.`
    },
    {
      id: 'eval-suggest',
      step: 0,
      output: 'json',
      label: 'Avaliação — sugerir qualidade + casos (IA)',
      body: `Você propõe uma AVALIAÇÃO para um artefato de conhecimento (uma skill ou um conceito do commons), em pt-BR. Entrada: { "type": "skill|commons", "title": "…", "content": "…(corpo do SKILL.md ou o context.md)…" }.
  Proponha dois blocos:
  - "quality": 2 a 5 critérios de QUALIDADE objetivos e verificáveis sobre o artefato (é claro; delimita o que faz e o que NÃO faz; cita fontes; completo). NÃO repita itens genéricos de governança (owner, idioma, dados sensíveis) — foque no conteúdo específico.
  - "cases": 2 a 5 CASOS DE TESTE — perguntas realistas que um usuário faria, cada uma com a resposta geral esperada em uma frase. Inclua ao menos um caso de recusa (mustRefuse=true) para um pedido fora do escopo.
  Responda SOMENTE com JSON válido: { "quality": [ { "text": "…" } ], "cases": [ { "question": "…", "expected": "…", "mustRefuse": false } ] }.`
    },
    {
      id: 'classify-file',
      step: 0,
      output: 'json',
      label: 'Classificação de arquivos de contexto',
      body: `Você classifica arquivos de contexto de uma skill nas pastas do repositório. Entrada: { "files": [ { "name": "…", "head": "trecho inicial do arquivo (pode vir vazio para binários/imagens)" } ], "buckets": ["references","analytics","query","img","data"] }.
  Para CADA arquivo de entrada, escolha a melhor pasta e um kind, usando a extensão do nome e o head:
  - references: definições, glossários, contexto de negócio, notas, instruções (.md/.txt).
  - analytics: catálogos, dicionários de dados, esquemas, técnicas de análise.
  - query: SQL ou scripts (.sql e afins).
  - img: imagens (.png/.jpg/.jpeg/.gif/.webp/.svg).
  - data: tabelas pequenas (.csv/.tsv) — não datasets grandes.
  Responda SOMENTE com JSON válido: { "assignments": [ { "name": "<igual ao de entrada>", "folder": "references|analytics|query|img|data", "kind": "contexto|catalogo|query|imagem|dados" } ] }.
  Um assignment por arquivo de entrada; não invente arquivos; sem markdown.`
    }
  ];

  function assertSafePromptId(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(String(id || ''))) {
      throw new Error('id de prompt invalido');
    }
  }

  function promptPath(id) {
    assertSafePromptId(id);
    return join(promptsRoot, `${id}.md`);
  }

  function serializePrompt({ id, label, step, output, body }) {
    const q = (value) => JSON.stringify(String(value == null ? '' : value));
    return `---\nid: ${id}\nlabel: ${q(label)}\nstep: ${step}\noutput: ${output === 'markdown' ? 'markdown' : 'json'}\n---\n\n${String(body || '').trim()}\n`;
  }

  async function readPrompt(id) {
    try {
      assertSafePromptId(id);
      const raw = await readFile(promptPath(id), 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      let updatedAt = null;
      try {
        updatedAt = (await stat(promptPath(id))).mtime.toISOString();
      } catch (error) {
        /* ignore */
      }
      return {
        id,
        label: meta.label ? String(meta.label) : id,
        step: Number(meta.step) || 0,
        output: meta.output === 'markdown' ? 'markdown' : 'json',
        body: String(body || '').trim(),
        updatedAt
      };
    } catch (error) {
      return null;
    }
  }

  async function listPrompts() {
    if (!(await pathExists(promptsRoot))) {
      return [];
    }
    const out = [];
    for (const entry of await readdir(promptsRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }
      const prompt = await readPrompt(entry.name.slice(0, -3));
      if (prompt) {
        out.push(prompt);
      }
    }
    out.sort((a, b) => a.step - b.step || a.id.localeCompare(b.id));
    return out;
  }

  // Overwrite a prompt's BODY only (frontmatter label/step/output stay as seeded), commit.
  async function writePromptBody(id, body, actor) {
    const existing = await readPrompt(id);
    if (!existing) {
      throw new Error('Prompt não encontrado.');
    }
    const text = String(body || '').trim();
    if (!text) {
      throw new Error('O prompt não pode ficar vazio.');
    }
    await mkdir(promptsRoot, { recursive: true });
    await writeFile(promptPath(id), serializePrompt({ ...existing, body: text }), 'utf8');
    await commitRepo(promptsRoot, `prompt(${id}): edição`, actor, [`${id}.md`]);
    return readPrompt(id);
  }

  // Live prompt body for the wizard (Phase C reads this at run time). '' if missing.
  async function loadPromptBody(id) {
    const prompt = await readPrompt(id);
    return prompt ? prompt.body : '';
  }

  // Seed any missing default prompt (never clobbers an admin-edited one), then git-init.
  async function ensurePromptsSeed() {
    try {
      await mkdir(promptsRoot, { recursive: true });
      for (const prompt of DEFAULT_PROMPTS) {
        if (!(await pathExists(promptPath(prompt.id)))) {
          await writeFile(promptPath(prompt.id), serializePrompt(prompt), 'utf8');
        }
      }
      await ensureRepo(promptsRoot, 'prompts');
    } catch (error) {
      console.log('ensurePromptsSeed skipped:', error.message);
    }
  }

  return { readPrompt, listPrompts, writePromptBody, loadPromptBody, ensurePromptsSeed };
}
