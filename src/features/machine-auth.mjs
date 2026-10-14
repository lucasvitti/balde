import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../../scripts/secrets.mjs';
import { usersRoot } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';

export function createMachineAuthFeature({ corpusGroupsForEmail, reqGroups }) {
  let apiKeys = String(process.env.API_KEY || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  const AUTHENTIK_API_URL = (process.env.AUTHENTIK_API_URL || '').replace(/\/+$/, '');
  const AUTHENTIK_TOKEN_TTL_MS = Number(process.env.AUTHENTIK_TOKEN_TTL_MS || 60000);
  const machineTokenCache = new Map(); // sha256(token) -> { actor: {...}|null, expires }
  const AUTHENTIK_SERVICE_TOKEN = process.env.AUTHENTIK_SERVICE_TOKEN || ''; // brokered mint/list/revoke
  const API_GROUP = process.env.API_GROUP || ''; // optional per-API gate group (empty = any active user)
  const BALDE_TOKEN_PREFIX = 'balde-'; // identifier marker for Balde-minted personal tokens

  function normalizeGroups(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((g) => (typeof g === 'string' ? g : (g && (g.name || g.pk)) || ''))
      .filter(Boolean)
      .map(String);
  }

  async function validateMachineToken(token) {
    if (!AUTHENTIK_API_URL || !token) return null;
    const cacheKey = createHash('sha256').update(token).digest('hex');
    const hit = machineTokenCache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.actor;
    let actor = null;
    try {
      const res = await fetch(`${AUTHENTIK_API_URL}/api/v3/core/users/me/`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' }
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const u = data && data.user ? data.user : data;
        if (u && u.is_active !== false && (u.username || u.email)) {
          actor = {
            email: String(u.email || u.username || '').trim() || null,
            username: u.username || null,
            name: u.name || u.username || null,
            groups: normalizeGroups(u.groups)
          };
        }
      }
    } catch (error) {
      actor = null; // Authentik unreachable → fail closed (short negative cache below)
    }

    if (actor && API_GROUP && !(await userInApiGroup(actor))) {
      actor = null;
    }

    machineTokenCache.set(cacheKey, {
      actor,
      expires: Date.now() + (actor ? AUTHENTIK_TOKEN_TTL_MS : Math.min(AUTHENTIK_TOKEN_TTL_MS, 15000))
    });
    return actor;
  }

  async function authorizeMachine(req) {
    const header = req.headers.authorization || '';
    const token = header.replace(/^Bearer\s+/i, '').trim();
    let result = null;
    if (token) {
      if (apiKeys.length && apiKeys.includes(token)) {
        const localEmail = String(process.env.DEV_FAKE_EMAIL || '').trim() || null;
        const localGroups =
          process.env.BALDE_GROUPS_FROM_CORPUS === '1'
            ? corpusGroupsForEmail(localEmail)
            : String(process.env.DEV_FAKE_GROUPS || '')
                .split(/[|,]/)
                .map((g) => g.trim())
                .filter(Boolean);
        result = localEmail
          ? {
              via: 'shared-key',
              email: localEmail,
              username: null,
              name: process.env.DEV_FAKE_NAME || localEmail,
              groups: localGroups
            }
          : { via: 'shared-key', email: null, username: null, name: 'integração', groups: [] };
      } else {
        const actor = await validateMachineToken(token);
        result = actor ? { via: 'authentik-token', ...actor } : null;
      }
    }
    if (req) req._machineActor = result; // stash for the /api/v1 access log (handleApi finish-hook)
    return result;
  }

  function authentikServiceReady() {
    return Boolean(AUTHENTIK_API_URL && AUTHENTIK_SERVICE_TOKEN);
  }

  async function authentikAdmin(path, { method = 'GET', body } = {}) {
    if (!authentikServiceReady()) {
      throw new Error('Serviço Authentik não configurado (AUTHENTIK_API_URL + AUTHENTIK_SERVICE_TOKEN).');
    }
    const res = await fetch(`${AUTHENTIK_API_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${AUTHENTIK_SERVICE_TOKEN}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      throw new Error(`Authentik ${res.status}${data && data.detail ? ': ' + data.detail : ''}`);
    }
    return data;
  }

  async function authentikUserPk(actor) {
    const email = String(actor.email || '')
      .trim()
      .toLowerCase();
    if (!email) return null;
    const data = await authentikAdmin(`/api/v3/core/users/?email=${encodeURIComponent(email)}`);

    const match = (data.results || []).find(
      (u) =>
        String(u.email || '')
          .trim()
          .toLowerCase() === email
    );
    return match ? match.pk : null;
  }

  async function userInApiGroup(actor) {
    if (!API_GROUP) return true;
    if (!authentikServiceReady()) return false;
    const uname = String(actor.username || '').trim();
    if (!uname) return false;
    try {
      const data = await authentikAdmin(
        `/api/v3/core/groups/?name=${encodeURIComponent(API_GROUP)}&members_by_username=${encodeURIComponent(uname)}`
      );
      return (data.results || []).some((g) => String(g.name || '').trim() === API_GROUP.trim());
    } catch (error) {
      return false;
    }
  }

  async function listUserApiTokens(actor) {
    const pk = await authentikUserPk(actor);
    if (!pk) return [];
    const data = await authentikAdmin(`/api/v3/core/tokens/?user=${encodeURIComponent(pk)}&intent=api`);
    return (data.results || [])
      .filter((t) => t.user === pk && String(t.identifier || '').startsWith(BALDE_TOKEN_PREFIX)) // ownership guard (server ?user= filter is unreliable)
      .map((t) => ({
        identifier: t.identifier,
        description: t.description || '',
        expiring: Boolean(t.expiring),
        expires: t.expires || null
      }));
  }

  async function createUserApiToken(actor, label) {
    const pk = await authentikUserPk(actor);
    if (!pk) throw new Error('Usuário não encontrado no Authentik.');
    const slug = String(actor.email || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''); // Authentik identifier = slug (no dots)
    const identifier = `${BALDE_TOKEN_PREFIX}${slug}-${randomBytes(4).toString('hex')}`.slice(0, 120);
    await authentikAdmin('/api/v3/core/tokens/', {
      method: 'POST',
      body: {
        identifier,
        intent: 'api',
        user: pk,
        description: `Balde API${label ? ' — ' + label : ''}`,
        expiring: false
      }
    });
    const keyData = await authentikAdmin(`/api/v3/core/tokens/${encodeURIComponent(identifier)}/view_key/`);
    return { identifier, key: keyData.key };
  }

  async function revokeUserApiToken(actor, identifier) {
    const id = String(identifier || '');
    if (!id.startsWith(BALDE_TOKEN_PREFIX)) throw new Error('Identificador inválido.');
    const pk = await authentikUserPk(actor);
    const tok = await authentikAdmin(`/api/v3/core/tokens/${encodeURIComponent(id)}/`);
    if (!pk || tok.user !== pk) throw new Error('Este token não pertence a você.');
    await authentikAdmin(`/api/v3/core/tokens/${encodeURIComponent(id)}/`, { method: 'DELETE' });
    return true;
  }

  async function revealUserApiToken(actor, identifier) {
    const id = String(identifier || '');
    if (!id.startsWith(BALDE_TOKEN_PREFIX)) throw new Error('Identificador inválido.');
    const pk = await authentikUserPk(actor);
    const tok = await authentikAdmin(`/api/v3/core/tokens/${encodeURIComponent(id)}/`);
    if (!pk || tok.user !== pk) throw new Error('Este token não pertence a você.');
    const keyData = await authentikAdmin(`/api/v3/core/tokens/${encodeURIComponent(id)}/view_key/`);
    return keyData.key;
  }

  async function renameUserApiToken(actor, identifier, label) {
    const id = String(identifier || '');
    if (!id.startsWith(BALDE_TOKEN_PREFIX)) throw new Error('Identificador inválido.');
    const pk = await authentikUserPk(actor);
    const tok = await authentikAdmin(`/api/v3/core/tokens/${encodeURIComponent(id)}/`);
    if (!pk || tok.user !== pk) throw new Error('Este token não pertence a você.');
    const clean = String(label || '')
      .trim()
      .slice(0, 60);
    const description = `Balde API${clean ? ' — ' + clean : ''}`;

    await authentikAdmin(`/api/v3/core/tokens/${encodeURIComponent(id)}/`, {
      method: 'PATCH',
      body: { description, user: tok.user }
    });
    return description;
  }

  const apiKeyStorePath =
    process.env.API_KEY_STORE_PATH ||
    (process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Balde', '_system', 'api-key.enc.json')
      : join(usersRoot, '_system', 'api-key.enc.json'));
  const EXPOSED_APIS = [
    {
      method: 'GET',
      path: '/api/v1/repos',
      auth: 'Chave pessoal',
      desc: 'Lista os repos (baldes) que o dono da chave pode ler — name, título, perfil de governança. TODA chamada /api/v1 opera num repo: escolha com o header X-Balde-Repo (ou ?repo=); sem ele, o repo padrão "corporate". Não-membro recebe 404 honesto.'
    },
    {
      method: 'GET',
      path: '/api/v1/search?q=',
      auth: 'Chave pessoal',
      desc: 'Busca no corpus por texto: ranqueia skills e cápsulas contra a consulta usando a mesma engine léxica da deduplicação (vetores de termos + cosseno, pt-BR, sem embeddings e sem banco vetorial). Parâmetros: q (obrigatório), limit (padrão 20), kind (skill|capsule). Devolve id, kind, title, score, termos em comum e as URLs de leitura. Só retorna nós que a chave pode ler — restritos nunca aparecem.'
    },
    {
      method: 'GET/POST',
      path: '/api/v1/ask?q=',
      auth: 'Chave pessoal',
      desc: 'PERGUNTA e resposta em uma chamada: o Balde responde a pergunta aterrado no corpus (a mesma pilha do chat, sem estado — não grava conversa, não enfileira, não infla contadores). GET ?q= para um curl rápido; POST { question, skills?, stream?, maxSteps? } para perguntas longas e para fixar skills. Sem "skills", o modelo busca e lê o corpus inteiro sob demanda; com "skills", aterra só nelas (+ run_query governado). stream=1 devolve SSE (delta/tool/done). Usa o provedor de IA do dono da chave (chave própria ou Claude Code/Codex local); ACL e repo são os do token.'
    },
    {
      method: 'GET',
      path: '/api/v1/skills',
      auth: 'Chave pessoal',
      desc: 'Lista as skills canônicas visíveis para o dono da chave (OKF).'
    },
    {
      method: 'GET',
      path: '/api/v1/skills/{id}',
      auth: 'Chave pessoal',
      desc: 'Uma skill canônica completa (OKF + markdown + evals). contextMode="inline" (skills pequenas) traz context[] com todos os arquivos em texto; contextMode="paged" (skills grandes) traz contextManifest (resumos + links) e o conteúdo é lido via /context/{path}. Binários em contextSkipped. Se o domínio tiver uma cápsula de ontologia (<domínio>/ontologia), domainOntology traz o vocabulário canônico — use esses termos ao responder. 404 se o dono da chave não puder lê-la.'
    },
    {
      method: 'GET',
      path: '/api/v1/skills/{id}/context',
      auth: 'Chave pessoal',
      desc: 'Manifesto (grafo OKF) dos arquivos de contexto: path, bytes, kind, resumo + links/backlinks/dangling entre conceitos, SEM baixar o conteúdo — para paginar/percorrer skills grandes.'
    },
    {
      method: 'GET',
      path: '/api/v1/skills/{id}/context/{path}',
      auth: 'Chave pessoal',
      desc: 'Baixa UM arquivo de contexto (texto + links de saída) pelo path do manifesto — progressive disclosure percorrendo o grafo sob demanda.'
    },
    {
      method: 'GET',
      path: '/api/v1/skills/{id}/query-run?path=query/x.sql',
      auth: 'Chave pessoal',
      desc: 'Executa uma query GOVERNADA da skill (arquivo .sql versionado — nunca SQL arbitrário) num sandbox DuckDB efêmero sobre os datasets da skill (analytics/ + data/) e das cápsulas vinculadas (data/), nomeados pelo stem do arquivo (base.parquet → tabela base). Retorna columns/rows (limitados) + datasets usados. A última SELECT do arquivo é o resultado.'
    },
    {
      method: 'GET',
      path: '/api/v1/skills/{id}/data-inspect?path=analytics/base.parquet',
      auth: 'Chave pessoal',
      desc: 'Perfil de UM dataset da skill (csv/parquet): schema (DESCRIBE), contagem de linhas e estatísticas por coluna (SUMMARIZE — nulos, distintos, min/max, quantis). Use antes de confiar/consultar o dado.'
    },
    {
      method: 'GET',
      path: '/api/v1/files',
      auth: 'Chave pessoal',
      desc: 'BUSCA arquivos anexos (o sidecar files/ — PDFs, planilhas, zips) em skills e cápsulas por termo (?q=). Mesma engine e mesmo ACL do buscador do chat: só retorna o que o dono da chave pode ler. Esses arquivos NÃO aparecem no índice de contexto — é assim que se descobre um anexo sem saber a skill/cápsula dona. Cada resultado traz path, name, size, url (download com a chave) e webUrl (abrir no navegador via SSO).'
    },
    {
      method: 'GET',
      path: '/api/v1/skills/{id}/files/{name}',
      auth: 'Chave pessoal',
      desc: 'Baixa UM arquivo anexado a uma skill (o sidecar files/ — PDFs, zips, .docx/.xlsx). Respeita a visibilidade da skill (404 se restrita e sem acesso). Os arquivos disponíveis aparecem em media.files[] de GET /api/v1/skills/{id}.'
    },
    {
      method: 'POST',
      path: '/api/v1/skills/{id}/files',
      auth: 'Chave pessoal',
      desc: 'Anexa UM arquivo a uma skill (sidecar files/). Corpo JSON { name, base64 }; máx. 20 MB. Exige gerência (curador/admin) da skill. Devolve { ok, name, size, url }.'
    },
    {
      method: 'GET',
      path: '/api/v1/commons',
      auth: 'Chave pessoal',
      desc: 'Lista os conceitos compartilhados do commons: path (pasta), resumo, referencedBy (skills que os referenciam) e contagem de mídia (img/data). Sem conteúdo — para descobrir/percorrer o commons. Cápsulas RESTRITAS só aparecem para chaves cujo dono está listado (curador/leitor).'
    },
    {
      method: 'GET',
      path: '/api/v1/commons/{path}',
      auth: 'Chave pessoal',
      desc: 'Um conceito do commons pelo path da pasta (ex.: "dados_vendas/dicionario_dados", também aceita "/commons/..."). O content JÁ INCLUI as descrições de mídia geradas por IA (imagens descritas + tabelas em markdown) — vira contexto — mais os links de saída. media.files[] lista os arquivos anexados (name/size/url para baixar). Siga os links /commons/... das skills até aqui. 404 se não existir OU se a cápsula for restrita e a chave não tiver acesso.'
    },
    {
      method: 'GET',
      path: '/api/v1/commons/{path}/files/{name}',
      auth: 'Chave pessoal',
      desc: 'Baixa UM arquivo anexado a uma cápsula (o sidecar files/ — PDFs, zips, .docx/.xlsx). Respeita a visibilidade da cápsula (404 se restrita e sem acesso). Os arquivos disponíveis aparecem em media.files[] de GET /api/v1/commons/{path}.'
    },
    {
      method: 'POST',
      path: '/api/v1/commons/{path}/files',
      auth: 'Chave pessoal',
      desc: 'Anexa UM arquivo a uma cápsula (sidecar files/). Corpo JSON { name, base64 }; máx. 20 MB. Exige gerência (curador/admin) da cápsula. Devolve { ok, name, size, url }.'
    },
    { method: 'GET', path: '/api/v1/buddies', auth: 'Chave pessoal', desc: 'Lista de buddies (avatares).' },
    {
      method: 'GET',
      path: '/api/v1/buddies/{id}',
      auth: 'Chave pessoal',
      desc: 'Manifesto de um buddy (poses disponíveis).'
    },
    {
      method: 'GET',
      path: '/api/v1/buddies/{id}/poses/{pose}',
      auth: 'Chave pessoal',
      desc: 'Imagem de uma pose de um buddy.'
    },
    {
      method: 'POST',
      path: '/api/v1/queue',
      auth: 'Chave pessoal',
      desc: 'Envia novo contexto para a fila de curadoria de uma skill (skill, content, title?, tags?, files?).'
    },
    {
      method: 'GET',
      path: '/api/v1/capsule/spec',
      auth: 'Chave pessoal',
      desc: 'A especificação das cápsulas de importação (balde-capsule/1) em markdown cru — alimente seu assistente de IA com ela para gerar manifestos.'
    },
    {
      method: 'POST',
      path: '/api/v1/capsule/compile',
      auth: 'Chave pessoal',
      desc: 'Compila um manifesto de cápsula SEM gravar nada: devolve {ok, errors[], warnings[], plan[]} legíveis por máquina — itere até ok:true.'
    },
    {
      method: 'POST',
      path: '/api/v1/capsule/submit',
      auth: 'Chave pessoal',
      desc: 'Compila e envia a cápsula limpa para a fila de curadoria (UM item; aprovação do curador aplica ao corpus). Devolve {queueId, plan}. Exige poder ler a skill âncora.'
    }
  ];

  const dedupPairKey = (a, b) => [String(a), String(b)].sort().join('\u0001');

  function isAdminReq(req) {
    const adminGroup = process.env.ADMIN_GROUP || 'Balde - Admins';
    return reqGroups(req).includes(adminGroup);
  }

  function currentApiKey() {
    return apiKeys[0] || '';
  }

  async function loadApiKeyStore() {
    try {
      if (process.env.BALDE_SECRET_KEY && (await pathExists(apiKeyStorePath))) {
        const key = await decryptSecret({ inputPath: apiKeyStorePath, secretKey: process.env.BALDE_SECRET_KEY });
        if (key && key.trim()) {
          apiKeys = [key.trim()];
        }
      }
    } catch (error) {}
  }

  async function ensureLocalMachineKey() {
    if (apiKeys.length) return apiKeys[0];
    if (!process.env.BALDE_SECRET_KEY) {
      throw new Error('Servidor sem BALDE_SECRET_KEY — não dá para criar a chave do MCP com segurança.');
    }
    const key = `balde-${randomBytes(24).toString('hex')}`;
    await mkdir(join(usersRoot, '_system'), { recursive: true });
    await encryptSecret({
      plaintext: key,
      outputPath: apiKeyStorePath,
      secretKey: process.env.BALDE_SECRET_KEY,
      label: 'machine-key:local'
    });
    apiKeys = [key];
    return key;
  }

  return {
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
  };
}
