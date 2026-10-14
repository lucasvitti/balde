import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { slugifySkillId } from '../skill-format.mjs';
import {
  skillsRoot,
  legacyQueueRoot,
  reposRoot,
  repoSkillsRoot,
  corpusRoot,
  promptsRoot,
  commonsRoot,
  activeRepo,
  runWithRepo,
  DEFAULT_REPO
} from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { listRepos, repoByName, isRepoAdmin, isRepoCurator } from '../repos.mjs';
import { normScoringConfig } from '../scoring.mjs';

export function createPolicyFeature({ normRubric, commitRepo, commitCorpus, normEmail, webActor }) {
  const DEFAULT_EVAL_CHECKLIST = [
    {
      id: 'desc-clara',
      title: 'Descreve claramente o que é e para que serve',
      prompt: 'Verifique que o artefato descreve claramente o que é e para que serve.',
      appliesTo: 'both'
    },
    {
      id: 'gov-escopo',
      title: 'Declara o que faz e o que NÃO faz / quando recusar',
      prompt: 'Verifique que o artefato declara o que faz e o que NÃO faz, e quando deve recusar.',
      appliesTo: 'both'
    },
    {
      id: 'papel-contexto',
      title: 'Papel e contexto claros no prompt',
      prompt:
        'Verifique que o prompt abre com papel/contexto claros (ex.: "Você é um analista sênior..."), deixando explícito o papel do agente.',
      appliesTo: 'skill'
    },
    {
      id: 'fontes',
      title: 'Não inventa números; recusa sem base; aponta as fontes',
      prompt:
        'Verifique que o artefato não inventa números, tem regra explícita de recusa quando faltam dados/colunas/períodos/fontes, e aponta as fontes.',
      appliesTo: 'both'
    },
    {
      id: 'idioma-ptbr',
      title: 'Conteúdo consistente em pt-BR',
      prompt: 'Verifique que o conteúdo está todo consistente em pt-BR.',
      appliesTo: 'both'
    },
    {
      id: 'sem-sensivel',
      title: 'Sem credenciais ou dados sensíveis',
      prompt: 'Verifique que não há credenciais, segredos ou dados pessoais/sensíveis expostos.',
      appliesTo: 'both'
    },
    {
      id: 'gov-owner',
      title: 'Owner, versão e carimbo de revisão declarados',
      prompt:
        'Pelos METADADOS fornecidos (facts), confirme que há owner, versão e carimbo de revisão declarados (facts.hasOwnerVersionReview = true).',
      appliesTo: 'both'
    },
    {
      id: 'okf-frontmatter',
      title: 'Frontmatter OKF + governança (title, status, objetivo, escopo)',
      prompt:
        'Pelos METADADOS fornecidos (facts), confirme frontmatter OKF válido e com governança (facts.hasFrontmatter = true E facts.hasGovernanceFrontmatter = true).',
      appliesTo: 'skill'
    },
    {
      id: 'output-schema',
      title: 'Schema explícito quando a saída é estruturada',
      prompt:
        'Pelos METADADOS fornecidos (facts): se facts.isStructured = true, confirme que facts.hasOutputSchema = true (existe output_schema.json); caso contrário, aprove.',
      appliesTo: 'skill'
    },
    {
      id: 'tem-casos-teste',
      title: 'Tem casos de teste (UAT)',
      prompt:
        'Pelos METADADOS fornecidos (facts), confirme que existe ao menos um caso de teste de aceitação (facts.hasTestCases = true).',
      appliesTo: 'skill',
      mode: 'score'
    },
    {
      id: 'tem-caso-recusa',
      title: 'Tem ao menos um caso de teste de recusa',
      prompt:
        'Pelos METADADOS fornecidos (facts), confirme que existe ao menos um caso de teste de recusa (facts.hasRefuseCase = true).',
      appliesTo: 'skill',
      mode: 'score'
    }
  ];
  // PER-REPO (2026-09): a política de qualidade vive no corpus do balde (padrão _domains.json)
  // — cada balde tem seu próprio gate; baldes sem arquivo caem nos defaults do código.
  function evalChecklistPath() {
    return join(skillsRoot(), '_eval-checklist.json');
  }
  // Which default checklist ids are SCORE-only (feed the Selo, don't gate promotion) when a stored item
  // carries no explicit `mode` — the two use-case checks: richer cases raise the score instead of blocking.
  const CHECKLIST_SCORE_ONLY_DEFAULT = new Set(['tem-casos-teste', 'tem-caso-recusa']);
  function normEvalChecklistItem(x, i) {
    const id =
      String((x && x.id) || `q${i + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || `q${i + 1}`;
    const appliesTo = ['skill', 'commons', 'both'].includes(x && x.appliesTo) ? x.appliesTo : 'both';
    // gate = blocks promotion; score = feeds the Selo only. Absent mode defaults by id (so existing stored
    // checklists relax the use-case checks without a migration); an admin's explicit mode always wins.
    const mode =
      x && x.mode === 'score'
        ? 'score'
        : x && x.mode === 'gate'
          ? 'gate'
          : CHECKLIST_SCORE_ONLY_DEFAULT.has(id)
            ? 'score'
            : 'gate';
    return {
      id,
      title: String((x && (x.title || x.text)) || '').trim(),
      prompt: String((x && x.prompt) || '').trim(),
      appliesTo,
      mode,
      ...normRubric(x),
      enabled: (x && x.enabled) !== false
    };
  }
  async function loadEvalChecklist() {
    try {
      const p = JSON.parse(await readFile(evalChecklistPath(), 'utf8'));
      if (Array.isArray(p.items)) return p.items.map(normEvalChecklistItem).filter((x) => x.title);
    } catch (error) {
      /* fall through to defaults */
    }
    return DEFAULT_EVAL_CHECKLIST.map((x) => ({ ...x, enabled: true }));
  }
  async function saveEvalChecklist(items, actor) {
    const norm = (Array.isArray(items) ? items : [])
      .map(normEvalChecklistItem)
      .filter((x) => x.title)
      .slice(0, 40);
    // Tombstones: default ids the admin removed must STAY removed. ensureEvalChecklistSeed
    // re-merges "missing" defaults on boot (feature-rollout mechanism) and can't tell "never
    // seen" from "deleted" — without this list every deploy resurrected deleted defaults.
    const have = new Set(norm.map((x) => x.id));
    const removedDefaults = DEFAULT_EVAL_CHECKLIST.map((d) => d.id).filter((id) => !have.has(id));
    await mkdir(skillsRoot(), { recursive: true });
    await writeFile(evalChecklistPath(), JSON.stringify({ version: 2, items: norm, removedDefaults }, null, 2), 'utf8');
    await commitRepo(
      skillsRoot(),
      `eval-checklist: edição por ${(actor && (actor.name || actor.email)) || 'admin'}`,
      actor,
      ['_eval-checklist.json']
    );
    return norm;
  }
  async function ensureEvalChecklistSeed() {
    try {
      // Sem arquivo = o balde usa os defaults do código (nenhum seed necessário) — só o merge
      // de NOVOS defaults em checklists já armazenadas precisa rodar, balde a balde.
      if (!(await pathExists(evalChecklistPath()))) {
        return;
      }
      // Merge in NEW default items (by id) not yet stored — e.g. checks added by a code rollout.
      // Existing items and admin edits are preserved, and ids in `removedDefaults` (tombstones
      // written by saveEvalChecklist when an admin deletes a default) are NEVER re-added.
      const stored = JSON.parse(await readFile(evalChecklistPath(), 'utf8'));
      const items = Array.isArray(stored.items) ? stored.items : [];
      const have = new Set(items.map((x) => x && x.id));
      const removed = new Set(Array.isArray(stored.removedDefaults) ? stored.removedDefaults : []);
      const missing = DEFAULT_EVAL_CHECKLIST.filter((d) => !have.has(d.id) && !removed.has(d.id)).map((x) => ({
        ...x,
        enabled: true
      }));
      if (missing.length) {
        await writeFile(
          evalChecklistPath(),
          JSON.stringify({ version: 2, items: [...items, ...missing], removedDefaults: [...removed] }, null, 2),
          'utf8'
        );
      }
    } catch (error) {
      /* ignore */
    }
  }
  // The mandatory items that apply to a node type (skill|commons), enabled only.
  function mandatoryFor(checklist, nodeType) {
    return (checklist || []).filter((x) => x.enabled && (x.appliesTo === 'both' || x.appliesTo === nodeType));
  }
  // Fila legada (corpus/queue, itens stampados com `repo`) → repos/<repo>/queue; política
  // legada (prompts/scoring-config.json + eval-checklist.json, instância-inteira) → copiada
  // para o balde padrão, que era o único que a usava de fato. Idempotente e best-effort.
  async function migrateLegacyQueueAndPolicy() {
    // 1) Fila: mover cada item para a fila do balde do seu stamp (sem stamp = balde padrão).
    try {
      if (!process.env.QUEUE_ROOT && (await pathExists(legacyQueueRoot))) {
        const known = new Set((await listRepos()).map((r) => r.name));
        const destFor = (repo) => join(reposRoot, known.has(repo) ? repo : DEFAULT_REPO, 'queue');
        for (const entry of await readdir(legacyQueueRoot, { withFileTypes: true })) {
          const src = join(legacyQueueRoot, entry.name);
          // `_`-prefixados são infra, não itens: notify vai para o novo lar da instância,
          // o marcador de feedback resolvido vai para a fila do balde padrão.
          if (entry.name === '_notify-events.json') {
            const dest = join(corpusRoot, 'notify', 'events.json');
            if (!(await pathExists(dest))) {
              await mkdir(join(corpusRoot, 'notify'), { recursive: true });
              try {
                await rename(src, dest);
              } catch (error) {
                /* deixa */
              }
            }
            continue;
          }
          let repo = DEFAULT_REPO;
          try {
            if (entry.isDirectory()) {
              repo = String(JSON.parse(await readFile(join(src, 'item.json'), 'utf8')).repo || DEFAULT_REPO);
            } else if (entry.name.endsWith('.json') && !entry.name.startsWith('_')) {
              repo = String(JSON.parse(await readFile(src, 'utf8')).repo || DEFAULT_REPO);
            }
          } catch (error) {
            repo = DEFAULT_REPO;
          }
          const destDir = destFor(repo);
          await mkdir(destDir, { recursive: true });
          const dest = join(destDir, entry.name);
          if (await pathExists(dest)) continue; // já migrado — nunca sobrescreve
          try {
            await rename(src, dest);
          } catch (error) {
            /* cross-device etc. — deixa no legado */
          }
        }
        try {
          const left = await readdir(legacyQueueRoot);
          if (!left.length) await rm(legacyQueueRoot, { recursive: true, force: true });
        } catch (error) {
          /* mantém */
        }
        console.log('fila legada migrada para repos/<balde>/queue');
      }
    } catch (error) {
      console.log('migração da fila pulada:', error.message);
    }
    // 2) Política: copiar a config da instância para o balde padrão (uma vez).
    try {
      for (const [legacyName, repoName] of [
        ['scoring-config.json', '_scoring-config.json'],
        ['eval-checklist.json', '_eval-checklist.json']
      ]) {
        const legacy = join(promptsRoot, legacyName);
        const dest = join(repoSkillsRoot(DEFAULT_REPO), repoName);
        if ((await pathExists(legacy)) && !(await pathExists(dest))) {
          await cp(legacy, dest);
          console.log(`política ${legacyName} copiada para o balde padrão`);
        }
      }
    } catch (error) {
      console.log('migração da política pulada:', error.message);
    }
  }

  // Seeds/merges que agora são por balde (o merge de novos defaults da checklist).
  async function forEachRepoSeed() {
    try {
      for (const r of await listRepos()) {
        await runWithRepo(r.name, () => ensureEvalChecklistSeed());
      }
    } catch (error) {
      /* best-effort */
    }
  }
  // PER-REPO (2026-09): vive no corpus do balde ao lado de _domains.json — cada balde tem seus
  // pesos, faixas e critérios de depreciação; sem arquivo = defaults do código.
  function scoringConfigPath() {
    return join(skillsRoot(), '_scoring-config.json');
  }
  async function loadScoringConfig() {
    try {
      return normScoringConfig(JSON.parse(await readFile(scoringConfigPath(), 'utf8')));
    } catch (error) {
      return normScoringConfig(null);
    }
  }
  async function saveScoringConfig(cfg, actor) {
    const norm = normScoringConfig(cfg);
    await mkdir(skillsRoot(), { recursive: true });
    await writeFile(scoringConfigPath(), JSON.stringify({ version: 1, ...norm }, null, 2), 'utf8');
    await commitRepo(
      skillsRoot(),
      `scoring-config: edição por ${(actor && (actor.name || actor.email)) || 'admin'}`,
      actor,
      ['_scoring-config.json']
    );
    return norm;
  }
  // Same shape as the tag list, but domain slugs KEEP underscores (e.g. dados_vendas) to match
  // commons ids (slugSeg). Both skills and commons pick their domain from this one governed list.
  const domainsPath = () => join(skillsRoot(), '_domains.json');
  const DEFAULT_DOMAINS = ['analytics', 'financeiro', 'geral', 'pricing', 'produtividade', 'suporte', 'vendas'];

  function normalizeDomainServer(value) {
    return (
      String(value || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]+/g, '-')
        // Sem "_" no início: pastas com "_" (como _archived) não são domínios.
        .replace(/^[-_]+|[-]+$/g, '')
        .slice(0, 60)
    );
  }

  // Option 1 multi-level ids: a skill lives at <domain>/<subpath?>/<slug>. The domain is governed
  // (the caller validates it against the vocab); the subpath is free, ungoverned sub-folders. Every
  // segment is slugified; callers then bound the composed id with isSafeSkillId (depth + charset).
  function composeSkillId(domain, subpath, slug) {
    const subSegs = String(subpath || '')
      .replace(/\\/g, '/')
      .split('/')
      .map((s) => slugifySkillId(s))
      .filter(Boolean);
    return [domain, ...subSegs, slug].filter(Boolean).join('/');
  }

  async function loadDomains() {
    try {
      const list = JSON.parse(await readFile(domainsPath(), 'utf8'));
      return Array.isArray(list) ? [...new Set(list.map(normalizeDomainServer).filter(Boolean))].sort() : [];
    } catch (error) {
      return [...DEFAULT_DOMAINS];
    }
  }

  async function saveDomains(list, actor) {
    const clean = [...new Set((Array.isArray(list) ? list : []).map(normalizeDomainServer).filter(Boolean))].sort();
    await mkdir(skillsRoot(), { recursive: true });
    await writeFile(domainsPath(), `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
    await commitCorpus('domains: atualização da lista', actor, ['_domains.json']);
    return clean;
  }
  // Which governed domains each user may CREATE content in (skills + capsules), set by the balde's
  // creator in Administração › Domínios por usuário; git-versioned beside the vocabulary. The creator
  // and the curators create anywhere (D1, 2.0.19); everyone else needs an assignment, and none means
  // no creation at all. Editing existing content is NOT gated here (src/security/permissions.mjs).
  const userDomainsPath = () => join(skillsRoot(), '_user-domains.json');

  async function loadUserDomainAssignments() {
    try {
      const raw = JSON.parse(await readFile(userDomainsPath(), 'utf8'));
      const users =
        raw && typeof raw === 'object' && raw.users && typeof raw.users === 'object' && !Array.isArray(raw.users)
          ? raw.users
          : {};
      const out = {};
      for (const [email, list] of Object.entries(users)) {
        const e = normEmail(email);
        if (!e || !e.includes('@')) continue;
        out[e] = [...new Set((Array.isArray(list) ? list : []).map(normalizeDomainServer).filter(Boolean))].sort();
      }
      return { users: out };
    } catch {
      return { users: {} };
    }
  }

  // Replace-set semantics per user (like the LP editor's PUT /users/:id/domains). An empty
  // set removes the entry — equivalent to "cannot create anywhere".
  async function saveUserDomainAssignment(email, domains, actor) {
    const e = normEmail(email);
    if (!e || !e.includes('@')) throw new Error('e-mail inválido');
    const governed = await loadDomains();
    const clean = [
      ...new Set((Array.isArray(domains) ? domains : []).map(normalizeDomainServer).filter((d) => governed.includes(d)))
    ].sort();
    const all = await loadUserDomainAssignments();
    if (clean.length) all.users[e] = clean;
    else delete all.users[e];
    await writeFile(userDomainsPath(), `${JSON.stringify({ version: 1, users: all.users }, null, 2)}\n`, 'utf8');
    await commitCorpus(`domains: liberações de criação de ${e} atualizadas`, actor, ['_user-domains.json']);
    return { email: e, domains: clean };
  }

  // null = unrestricted (admin); array = the actor's whitelist ∩ governed vocabulary
  // (may be empty — cannot create anywhere).
  // Admins são POR BALDE: os donos do balde ativo e os membros dos grupos de admin listados no
  // manifesto dele (balde-repo.json). No próprio balde o admin é soberano (domínios, quem cria em
  // cada um, políticas, tudo o que está dentro); o grupo Admins da instalação só administra os baldes
  // que o listam (por padrão, os sem dono, como o Corporativo). Membro comum NÃO é admin.
  async function actorAdministersActiveRepo(actor) {
    let entry = null;
    try {
      entry = await repoByName(activeRepo());
    } catch {
      entry = null;
    }
    return isRepoAdmin(entry, (actor && actor.groups) || [], normEmail((actor && actor.email) || ''));
  }
  async function isBaldeAdminReq(req) {
    return actorAdministersActiveRepo(webActor(req));
  }

  // Criador e curadores criam em qualquer domínio (D1, Vitti 2026-10-06): a lista de "Domínios por usuário"
  // limita só quem não cura o balde (o que essas pessoas enviam pela Fila).
  async function actorCuratesActiveRepo(actor) {
    let entry = null;
    try {
      entry = await repoByName(activeRepo());
    } catch {
      entry = null;
    }
    return isRepoCurator(entry, (actor && actor.groups) || [], normEmail((actor && actor.email) || ''));
  }

  async function allowedDomainsForActor(actor) {
    if (await actorCuratesActiveRepo(actor)) return null; // criador e curadores: sem lista
    const assignments = await loadUserDomainAssignments();
    const mine = assignments.users[normEmail(actor && actor.email)] || [];
    if (!mine.length) return [];
    return (await loadDomains()).filter((d) => mine.includes(d));
  }

  // null = allowed; string = the 403 message for a creation attempt in `domain`.
  async function createDomainDenial(actor, domain) {
    const allowed = await allowedDomainsForActor(actor);
    if (!allowed || allowed.includes(domain)) return null;
    return `Você não tem permissão para criar no domínio "${domain}": ${allowed.length ? `seus domínios liberados são ${allowed.join(', ')}` : 'nenhum domínio liberado para você'}. Peça ao criador do balde em Administração › Domínios por usuário.`;
  }

  // Existing top-level dirs under the commons root ARE domains — fold them into the first seed.
  async function commonsDomainDirs() {
    try {
      const entries = await readdir(commonsRoot(), { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
        .map((e) => normalizeDomainServer(e.name))
        .filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  async function ensureDomainsSeed() {
    try {
      if (!(await pathExists(domainsPath()))) {
        const seed = [...new Set([...DEFAULT_DOMAINS, ...(await commonsDomainDirs())])].sort();
        await writeFile(domainsPath(), `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
      }
    } catch (error) {
      /* ignore */
    }
  }

  return {
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
  };
}
