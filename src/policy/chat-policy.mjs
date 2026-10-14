export const CHAT_MAX_MESSAGE = 20000;
export const CHAT_MAX_TURNS = 40;
export const CHAT_MAX_CONTEXT_SKILLS = 12;
export const SQL_FORMATTER_URL = process.env.SQL_FORMATTER_URL || 'https://identar.lucas.mat.br/api/format';
export const CONTEXT_BUDGET_CHARS = 150000;
export const CONTEXT_PAGING_THRESHOLD_CHARS = Number(process.env.CONTEXT_PAGING_THRESHOLD_CHARS || 48000);
export const CHAT_TOOL_READ_MAX_CHARS = Number(process.env.CHAT_TOOL_READ_MAX_CHARS || 24000);
export const CHAT_TOOL_MAX_STEPS = Number(process.env.CHAT_TOOL_MAX_STEPS || 8);
export const TEXT_CONTEXT_EXTS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.text',
  '.sql',
  '.json',
  '.csv',
  '.tsv',
  '.yml',
  '.yaml',
  '.xml',
  '.html',
  '.htm',
  '.js',
  '.mjs',
  '.ts',
  '.py',
  '.r',
  '.log',
  '.ini',
  '.cfg',
  '.conf',
  '.toml',
  '.env'
]);
export const CONTEXT_FILE_MAX_BYTES = 256 * 1024;
export const RUN_QUERY_NOTE =
  '\n\nAlgumas skills desta conversa têm queries GOVERNADAS (arquivos .sql versionados) sobre datasets reais. Quando a resposta pedir um número, contagem ou agregação desses dados, EXECUTE a query com a ferramenta run_query e responda com os valores retornados — nunca estime nem invente um número que uma query disponível pode calcular.';
export const ADHOC_SQL_NOTE =
  '\n\nQuando NENHUMA query governada cobre a pergunta, você pode escrever SQL própria com a ferramenta run_sql (DuckDB) sobre as tabelas listadas na ferramenta. REGRAS: 1) prefira SEMPRE uma query governada quando existir; 2) ao responder com run_sql, diga explicitamente que o número veio de uma consulta GERADA POR IA (não governada) e declare as premissas assumidas (filtros, joins, segmentos); 3) passe um titulo curto em kebab-case descrevendo a consulta final. A consulta final vira automaticamente um RASCUNHO para o curador da skill — aprovada, torna-se query governada.';
export const AVISO_FIRST_NOTE =
  '\n\n---\nCONTEÚDO COM AVISO NO CONTEXTO: um ou mais itens acima estão marcados como DEPRECIADOS ou de QUALIDADE BAIXA. Na sua PRIMEIRA resposta desta conversa, comece avisando o usuário explicitamente sobre isso (quais itens e por quê, em 1-2 frases) ANTES de qualquer outro conteúdo; nas respostas seguintes, mantenha a ressalva sempre que usar esses itens.';
