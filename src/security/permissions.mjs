import { isRepoAdmin, isRepoCurator, isRepoMember } from '../repos.mjs';

// Quem pode o quê num balde (decisão D1 de Vitti, 2026-10-06; docs/GOVERNANCE_REVIEW.md §7). Uma regra por
// ação, a mesma nas rotas da tela, na API das máquinas (MCP) e na interface, que desabilita o que o servidor
// recusaria e mostra o mesmo motivo.
//
// Os papéis vêm do balde-repo.json: o criador (owners e grupos de admin) define os curadores e o acesso;
// criador e curadores fazem toda ação de conteúdo; leitores (open, members, groups) leem e contribuem pela
// Fila. O `owner` no frontmatter de uma skill só diz quem responde por ela: não dá permissão nenhuma.
// Gravar no balde também exige poder gravar a pasta dele nesta máquina (numa instalação de usuário, edição
// na pasta do OneDrive, que o criador concede em "Aplicar no OneDrive").

const RANK = { nenhum: 0, membro: 1, curador: 2, admin: 3 };

// Papel mínimo de cada ação:
//   contribuir: enviar à Fila (Colaborar, cápsulas, ingestão, feedback do chat, MCP); não grava o corpus.
//   curar: criar, editar, mesclar, aceitar ou recusar na Fila, avaliar, publicar, arquivar e restaurar skills
//     e cápsulas; organizar domínios e categorias, a checklist de qualidade e a pontuação.
//   administrar: o que está no balde-repo.json (título, governança, quem lê, cura e administra) e quem cria
//     em cada domínio.
export const ACTION_ROLES = Object.freeze({ contribuir: 'membro', curar: 'curador', administrar: 'admin' });

export const PERMISSION_REASONS = Object.freeze({
  semAcesso: 'Você não tem acesso a este balde.',
  curar: 'Só o criador e os curadores deste balde fazem isso. Sugira pela Fila (Colaborar).',
  administrar: 'Só o criador deste balde (os admins dele) muda o acesso, o título e a governança dele.',
  pastaCompartilhada:
    'Você não tem edição na pasta deste balde no OneDrive, então a curadoria dele fica só para leitura nesta máquina. O dono do balde concede em Configurações › Baldes › Acesso › Aplicar no OneDrive (curadores recebem edição).',
  pastaLocal: 'A pasta deste balde está somente-leitura nesta máquina.',
  instalacao: 'Só os admins da instalação fazem isso.',
  instalacaoSomenteLeitura:
    'Instalação somente-leitura: grupos, prompts, documentos e baldes compartilhados são mantidos na instalação de administração.'
});

// O papel de alguém num balde: admin (o criador) > curador > membro > nenhum.
export function baldeRole(entry, groups = [], email = '') {
  if (!entry) return 'nenhum';
  if (isRepoAdmin(entry, groups, email)) return 'admin';
  if (isRepoCurator(entry, groups, email)) return 'curador';
  if (isRepoMember(entry, groups, email)) return 'membro';
  return 'nenhum';
}

// O papel permite a ação, faltando ou não a pasta: decide o que a interface mostra e o que se pode ler (abrir o
// editor, ver as avaliações); gravar pede decide().
export function roleAllows(role, action) {
  const needed = ACTION_ROLES[action];
  if (!needed) throw new Error(`Ação de permissão desconhecida: ${action}`);
  return (RANK[role] || 0) >= RANK[needed];
}

// { ok, reason } de uma ação para um papel, com a pasta do balde gravável ou não nesta máquina.
export function decide(action, { role = 'nenhum', writable = false, local = false } = {}) {
  const needed = ACTION_ROLES[action];
  if (!needed) throw new Error(`Ação de permissão desconhecida: ${action}`);
  if ((RANK[role] || 0) < RANK[needed])
    return { ok: false, reason: role === 'nenhum' ? PERMISSION_REASONS.semAcesso : PERMISSION_REASONS[action] };
  // Contribuir grava só na Fila ou na pasta de envio da pessoa, nunca no corpus.
  if (action !== 'contribuir' && !writable)
    return { ok: false, reason: local ? PERMISSION_REASONS.pastaLocal : PERMISSION_REASONS.pastaCompartilhada };
  return { ok: true, reason: '' };
}

// O que a instalação inteira permite (grupos, prompts, documentos, buddies, baldes compartilhados): o grupo
// de admins da instalação, numa instalação que grava o corpus.
export function decideInstallation({ installAdmin = false, readonlyInstall = false } = {}) {
  if (!installAdmin) return { ok: false, reason: PERMISSION_REASONS.instalacao };
  if (readonlyInstall) return { ok: false, reason: PERMISSION_REASONS.instalacaoSomenteLeitura };
  return { ok: true, reason: '' };
}

// O resumo que a interface recebe em /api/me e as rotas consultam.
export function summarizePermissions({ repo, role, writable, local, installAdmin, readonlyInstall }) {
  const context = { role, writable, local };
  return {
    repo,
    role,
    writable: Boolean(writable),
    contribuir: decide('contribuir', context),
    curar: decide('curar', context),
    administrar: decide('administrar', context),
    instalacao: decideInstallation({ installAdmin, readonlyInstall })
  };
}

// O portão de uma instalação somente-leitura: o que cada escrita exige. 'livre' = os handlers decidem (dados
// pessoais, a Fila e a pasta de envio, consultas que só calculam); 'curar' e 'administrar' = a regra acima;
// 'instalacao' = só a instalação de administração; null = recusada, salvo num balde local, onde o curador
// grava o que é dele.
const FREE_WRITES = [
  '/api/me/prefs',
  '/api/me/ai',
  '/api/me/ai/test',
  '/api/chats',
  '/api/chats/',
  // A Fila e a triagem de feedback: gravam a pasta de envio da pessoa ou a Fila do balde, e cada handler
  // confere o curador e a pasta (aprovar é a única decisão que grava o corpus).
  '/api/queue/',
  '/api/feedback',
  '/api/feedback/',
  // A lista de baldes DA PESSOA: adicionar uma pasta, criar um balde numa pasta, tirar da lista.
  '/api/repos/mount',
  '/api/repos/unmount',
  '/api/repos/create',
  '/api/capsule/compile',
  '/api/capsule/submit',
  '/api/wizard/ai',
  '/api/ingest/',
  '/api/dedup/check',
  // "Não é duplicata" fica na lista desta máquina; o handler pede curador.
  '/api/dedup/dismiss',
  '/api/auth/',
  // Pastas do compartilhamento: gravam só o plano nesta máquina; o handler pede o grupo de admins da
  // instalação, e o SharePoint confere o resto quando o admin roda o comando com o próprio login.
  '/api/compartilhamento/',
  '/api/ai-cli/',
  '/api/mcp/',
  '/api/startup',
  // POSTs que só calculam ou leem: descrever um envio do assistente, sugerir ontologia, inspecionar dados,
  // reconstruir o grafo (cache desta máquina) e a chamada aposentada do roster.
  '/api/media/describe',
  '/api/ontology/suggest',
  '/api/commons/data-inspect',
  '/api/corpus/graph-rebuild',
  '/api/users/persist',
  // Ferramentas de IA da curadoria (análise, ajuste de proposta, sugestão de casos de uso): leem e não gravam;
  // o handler pede curador.
  '/api/analyze',
  '/api/proposals/generate-ai',
  '/api/commons/eval/suggest'
];

const CURATION_PATHS = new Set([
  '/api/merge/analyse',
  '/api/merge/write',
  '/api/publish',
  '/api/rollback',
  '/api/run-evals',
  '/api/approve-requirement',
  '/api/return-proposal',
  '/api/skill-source/save',
  '/api/skill-source/upload-context',
  '/api/skill-source/rollback-draft',
  '/api/skills/restore',
  '/api/governance/generate-suggestions',
  '/api/commons/new',
  '/api/commons/update',
  '/api/commons/file',
  '/api/commons/summarize',
  '/api/commons/process-media',
  '/api/commons/archive',
  '/api/commons/restore',
  '/api/commons/eval',
  '/api/commons/eval/run',
  '/api/commons/eval/test',
  '/api/commons/govern/review',
  '/api/commons/govern/close',
  '/api/commons/govern/cadence',
  '/api/commons/govern/eval-run',
  // Organizar o conteúdo do balde (D1: curadores fazem toda ação de conteúdo).
  '/api/domains/add',
  '/api/admin/domains',
  '/api/admin/domains/rename',
  '/api/admin/skills/move',
  '/api/admin/capsule-categories',
  '/api/eval-checklist',
  '/api/scoring-config'
]);

// O que está no balde-repo.json e quem cria em cada domínio: só o criador.
const ADMINISTRATION_PATHS = new Set(['/api/admin/user-domains']);

export function gateAction(method, path) {
  const p = String(path || '');
  if (FREE_WRITES.some((free) => (free.endsWith('/') ? p.startsWith(free) : p === free))) return 'livre';
  // Rodar uma consulta da skill (o uso vai para o log desta máquina), inspecionar um dataset ou pedir à IA
  // sugestões de casos de uso (não grava; o handler pede curador).
  if (method === 'POST' && /^\/api\/skills\/[^/]+\/(?:query-run|data-inspect|eval\/suggest)$/.test(p)) return 'livre';
  // O acesso de um balde: o handler confere o criador (a pasta de um balde local é da própria pessoa).
  if (method === 'PUT' && p.startsWith('/api/repos/')) return 'livre';
  if (method === 'POST' && /^\/api\/repos\/[^/]+\/acesso\/(?:plano|verificar)$/.test(p)) return 'livre';
  if (ADMINISTRATION_PATHS.has(p)) return 'administrar';
  if (CURATION_PATHS.has(p)) return 'curar';
  // Criar, importar e arquivar uma skill, e cada ação de curadoria dela; as subidas de arquivo do MCP.
  if (/^\/api\/skills\/[^/]+$/.test(p)) return 'curar';
  if (
    /^\/api\/skills\/[^/]+\/(?:eval(?:\/run|\/test)?|govern\/(?:eval-criteria|eval-run|review|cadence)|update|process-media|context-index\/rebuild|commons\/(?:plan|apply))$/.test(
      p
    )
  )
    return 'curar';
  if (method === 'POST' && /^\/api\/v1\/(?:skills|commons)\/.+\/files$/.test(p)) return 'curar';
  // A instalação inteira: grupos, buddies, SharePoint, a administração da instalação (prompts, docs) e
  // novos baldes compartilhados.
  if (/^\/api\/(?:groups|buddies|sp)(?:\/|$)/.test(p) || p.startsWith('/api/admin/')) return 'instalacao';
  if (p === '/api/repos' || p === '/api/repos/personal') return 'instalacao';
  return null;
}

// As permissões de quem pede, no balde do pedido. Funciona igual para a tela (identidade local) e para as
// máquinas (o ator da chave do MCP).
export function createPermissions({ repoByName, isLocalRepo, baldeWritable, readonlyInstall, installAdminGroup }) {
  const adminGroup = () => installAdminGroup || process.env.ADMIN_GROUP || 'Balde - Admins';

  async function forActor(actor, repoName) {
    let entry = null;
    try {
      entry = await repoByName(repoName);
    } catch {
      entry = null;
    }
    const groups = (actor && actor.groups) || [];
    const email = String((actor && actor.email) || '')
      .trim()
      .toLowerCase();
    const role = baldeRole(entry, groups, email);
    const local = Boolean(isLocalRepo(repoName));
    // Só sonda a pasta de quem poderia gravar nela (a sonda faz cache de um minuto por balde).
    const writable = RANK[role] >= RANK.curador ? Boolean(await baldeWritable(repoName)) : false;
    return summarizePermissions({
      repo: repoName,
      role,
      writable,
      local,
      installAdmin: groups.includes(adminGroup()),
      readonlyInstall: Boolean(readonlyInstall)
    });
  }

  // { ok, reason } de uma ação; actions: contribuir, curar, administrar, instalacao.
  async function check(actor, repoName, action) {
    const summary = await forActor(actor, repoName);
    const decision = summary[action];
    if (!decision) throw new Error(`Ação de permissão desconhecida: ${action}`);
    return decision;
  }

  return { forActor, check };
}
