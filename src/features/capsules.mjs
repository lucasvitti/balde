import { CADENCE_DAYS, CAPSULE_CATEGORY_DEFAULT, MAX_LINKED_CAPSULES } from '../policy/governance-policy.mjs';
import { applyFileTransaction, readTransaction } from '../governance/file-transaction.mjs';
import { operationKey } from '../governance/operations.mjs';
import { sealSubmission } from '../governance/exchange.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isSafeSkillId, slugifySkillId, buildStarterSkillMarkdown } from '../skill-format.mjs';
import { lintTextAgainstOntology, ontologyTitleMatch } from '../ontology.mjs';
import { skillsRoot, repoDirOf, commonsRoot, activeRepo } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { REPO_NAME_RE } from '../repos.mjs';

export function createCapsulesFeature({
  commitRepo,
  listCommonsConcepts,
  loadCommonsConceptGov,
  loadDomains,
  loadRoster,
  allowedDomainsForActor,
  canReadSkillActor,
  linkedCapsuleIds,
  normalizeDomainServer,
  domainOntologyLintIndex,
  commonsHasConcept,
  canReadCommonsActor,
  capsuleOutboundLink,
  normSerieField,
  normPeriodoField,
  isOntologyCapsuleId,
  buildCommonsList,
  normEmailList,
  newQueueId,
  submissionRoot,
  QUEUE_PREVIEW_CHARS,
  writeQueueMeta,
  emitNotifyContribution,
  pushLocalNotice,
  commonsConceptContextPath,
  stampCreator,
  pushApproval,
  commonsConceptGovPath,
  loadCommonsAccess,
  writeCommonsAccessDoc,
  normEmail,
  saveSkillAccess,
  loadGovernanceIndex,
  governanceIndexPath,
  normStoredEval,
  normEvalItem,
  loadSkillAccess,
  commitCorpus,
  regenerateContextIndex
}) {
  const CAPSULE_FORMAT = 'balde-capsule/1';
  const CAPSULE_BODY_MAX = 512 * 1024; // per-body cap — matches the commons editor limit
  const CAPSULE_MEDIA_MAX = 3 * 1024 * 1024; // per-media-file cap — matches the wizard limit
  const CAPSULE_CADENCES = new Set(['weekly', 'monthly', 'quarterly', 'yearly']);

  // Ortogonal à série (quando) e ao domínio (sobre o quê): diz como a cápsula deve ser LIDA.
  // O vocabulário é GOVERNADO e editável por admin (Administração › Categorias), versionado no
  // git do corpus como `_capsule-categories.json` — mesmo padrão de `_domains.json`.
  // Cápsulas sem categoria contam como 'dado' na leitura (o padrão histórico do corpus).

  const capsuleCategoriesPath = () => join(commonsRoot(), '_capsule-categories.json');
  const DEFAULT_CAPSULE_CATEGORIES = [
    {
      key: 'dado',
      label: 'Ponto de dado',
      color: '#3b6fd4',
      hint: 'Informação fechada que não muda mais — fechamento de mês, número apurado, documento vigente.',
      icon: '<rect x="4.5" y="12" width="4" height="7.5" rx="1"/><rect x="10" y="8" width="4" height="11.5" rx="1"/><rect x="15.5" y="4.5" width="4" height="15" rx="1"/>'
    },
    {
      key: 'reuniao',
      label: 'Resumo de reunião',
      color: '#2f9e63',
      hint: 'O registro de um encontro: o que foi discutido, o que ficou combinado.',
      icon: '<circle cx="9" cy="9.5" r="3"/><path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 7.5a2.6 2.6 0 010 5"/><path d="M18.5 19.5c0-2-.8-3.6-2-4.5"/>'
    },
    {
      key: 'decisao',
      label: 'Histórico de decisão',
      color: '#9b5ede',
      hint: 'Uma decisão e o contexto que a produziu — alternativas, critérios, por quê.',
      icon: '<path d="M12 3.5v6"/><circle cx="12" cy="11.5" r="2"/><path d="M10.4 12.9L5.5 19.5"/><path d="M13.6 12.9l4.9 6.6"/><path d="M4 19.5h3.5"/><path d="M16.5 19.5H20"/>'
    },
    {
      key: 'tarefas',
      label: 'Lista de tarefas',
      color: '#c2740c',
      hint: 'Itens a fazer; conteúdo vivo, revisado com frequência.',
      icon: '<path d="M4 7.5l2 2 3.5-4"/><path d="M4 16.5l2 2 3.5-4"/><path d="M12.5 7.5H20"/><path d="M12.5 16.5H20"/>'
    }
  ];

  // O ícone é markup SVG COLADO por um admin e renderizado inline em toda superfície — ou seja,
  // entrada não confiável num contexto perigoso. Só passam formas geométricas e atributos de
  // desenho: nada de <script>, <foreignObject>, <image>, href, style ou on*.
  const SVG_ICON_TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g']);
  const SVG_ICON_ATTRS = new Set([
    'd',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'x',
    'y',
    'x1',
    'y1',
    'x2',
    'y2',
    'width',
    'height',
    'points',
    'transform',
    'fill-rule',
    'clip-rule'
  ]);
  function sanitizeSvgIcon(markup) {
    const raw = String(markup || '')
      .trim()
      .slice(0, 4000);
    if (!raw) return '';
    let out = '';
    const tagRe = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
    let m;
    while ((m = tagRe.exec(raw)) !== null) {
      const tag = m[1].toLowerCase();
      if (!SVG_ICON_TAGS.has(tag)) continue; // descarta a tag inteira
      const closing = /^<\s*\//.test(m[0]);
      if (closing) {
        out += `</${tag}>`;
        continue;
      }
      let attrs = '';
      const attrRe = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
      let a;
      while ((a = attrRe.exec(m[2] || '')) !== null) {
        const name = a[1].toLowerCase();
        const val = a[2];
        if (!SVG_ICON_ATTRS.has(name)) continue;
        if (/[<>]|javascript:|url\s*\(/i.test(val)) continue;
        attrs += ` ${name}="${val}"`;
      }
      const selfClose = /\/\s*>$/.test(m[0]);
      out += `<${tag}${attrs}${selfClose ? '/' : ''}>`;
    }
    return out.slice(0, 4000);
  }

  function normCapsuleCategoryKey(v) {
    return String(v == null ? '' : v)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
  }

  async function loadCapsuleCategories() {
    try {
      const list = JSON.parse(await readFile(capsuleCategoriesPath(), 'utf8'));
      if (!Array.isArray(list) || !list.length) return [...DEFAULT_CAPSULE_CATEGORIES];
      const seen = new Set();
      const clean = [];
      for (const c of list) {
        const key = normCapsuleCategoryKey(c && c.key);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        clean.push({
          key,
          label:
            String((c && c.label) || key)
              .trim()
              .slice(0, 60) || key,
          color: /^#[0-9a-fA-F]{6}$/.test(String((c && c.color) || '')) ? String(c.color) : '#3b6fd4',
          hint: String((c && c.hint) || '')
            .trim()
            .slice(0, 300),
          icon: sanitizeSvgIcon(c && c.icon)
        });
      }
      // O padrão nunca some: sem ele, cápsulas antigas ficariam órfãs de categoria.
      if (!clean.some((c) => c.key === CAPSULE_CATEGORY_DEFAULT)) {
        clean.unshift(DEFAULT_CAPSULE_CATEGORIES[0]);
      }
      return clean;
    } catch (error) {
      return [...DEFAULT_CAPSULE_CATEGORIES];
    }
  }

  async function saveCapsuleCategories(list, actor) {
    const clean = await (async () => {
      const seen = new Set();
      const out = [];
      for (const c of Array.isArray(list) ? list : []) {
        const key = normCapsuleCategoryKey(c && c.key);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({
          key,
          label:
            String((c && c.label) || key)
              .trim()
              .slice(0, 60) || key,
          color: /^#[0-9a-fA-F]{6}$/.test(String((c && c.color) || '')) ? String(c.color) : '#3b6fd4',
          hint: String((c && c.hint) || '')
            .trim()
            .slice(0, 300),
          icon: sanitizeSvgIcon(c && c.icon)
        });
      }
      if (!out.some((c) => c.key === CAPSULE_CATEGORY_DEFAULT)) out.unshift(DEFAULT_CAPSULE_CATEGORIES[0]);
      return out;
    })();
    await mkdir(commonsRoot(), { recursive: true });
    await writeFile(
      capsuleCategoriesPath(),
      `${JSON.stringify(clean, null, 2)}
  `,
      'utf8'
    );
    await commitRepo(commonsRoot(), 'categorias de cápsula: atualização do vocabulário', actor, [
      '_capsule-categories.json'
    ]);
    return clean;
  }

  // Quantas cápsulas usam cada categoria — o admin não pode remover uma que ainda está em uso
  // sem ver o estrago, e a UI mostra a contagem antes de deixar excluir.
  async function capsuleCategoryKeys() {
    return (await loadCapsuleCategories()).map((c) => c.key);
  }

  async function capsuleCategoryUsage() {
    const usage = {};
    try {
      for (const id of await listCommonsConcepts()) {
        const g = await loadCommonsConceptGov(id);
        const k = normCapsuleCategoryKey(g.categoria) || CAPSULE_CATEGORY_DEFAULT;
        usage[k] = (usage[k] || 0) + 1;
      }
    } catch (error) {
      /* melhor esforço */
    }
    return usage;
  }
  // '' = não informado (herda o padrão) · null = informado porém fora do vocabulário.
  // `keys` é a lista governada carregada por quem chama (loadCapsuleCategories).
  function normCapsuleCategory(v, keys) {
    const s = normCapsuleCategoryKey(v);
    if (!s) return '';
    const allowed = Array.isArray(keys) ? keys : [];
    return allowed.includes(s) ? s : null;
  }

  // Same segment normalization as /api/commons/new (underscores kept — dados_vendas).
  function capsuleSlugSeg(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^[-]+|[-]+$/g, '')
      .slice(0, 60);
  }

  // `actor` (optional) enables the per-user CREATION-domain whitelist check: when given,
  // every skill/concept the manifest CREATES must sit in a domain the actor may create in
  // (error `dominio-nao-autorizado`). Submit passes the submitter; the approval re-compile
  // passes nothing — the approving curator doesn't need the submitter's domains.
  async function compileCapsule(manifest, actor = null) {
    // R2 environment guard: every compile is scoped to ONE balde (repo) — the request's active
    // repo. The report ECHOES it (response.repo + the first plan line) so the generating
    // human/AI always sees where this will land.
    const repoNow = activeRepo();
    const errors = [];
    const warnings = [];
    const plan = [];
    const err = (code, path, message) => errors.push({ code, path, message });
    const warn = (code, path, message) => warnings.push({ code, path, message });
    const done = () => ({ ok: errors.length === 0, repo: repoNow, errors, warnings, plan: errors.length ? [] : plan });
    const ontoLintCache = new Map(); // domínio → índice da ontologia (ou null), 1 leitura por compile

    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      err('formato-invalido', '', 'O corpo deve ser um objeto JSON — o manifesto da cápsula.');
      return done();
    }
    if (String(manifest.format || '') !== CAPSULE_FORMAT) {
      err('formato-invalido', 'format', `O campo "format" é obrigatório e deve ser "${CAPSULE_FORMAT}".`);
    }
    // Optional repo ASSERTION — a seatbelt, not a router: when the manifest declares "repo",
    // it must match the balde this compile is running in. Catches the classic accident of a
    // recurring pipeline (BALDE_REPO unset → default) landing episodes in the wrong balde.
    if (manifest.repo !== undefined) {
      const wantedRepo = String(manifest.repo || '')
        .trim()
        .toLowerCase();
      if (!REPO_NAME_RE.test(wantedRepo)) {
        err(
          'repo-invalido',
          'repo',
          `"repo" deve ser um nome de balde válido (minúsculas/dígitos/hífens, 2–31 chars) — recebi "${manifest.repo}".`
        );
      } else if (wantedRepo !== repoNow) {
        err(
          'repo-divergente',
          'repo',
          `O manifesto declara o balde "${wantedRepo}", mas esta compilação está no balde "${repoNow}". Selecione o balde certo (cabeçalho X-Balde-Repo, env BALDE_REPO no MCP, ou o seletor do app) — ou corrija o campo "repo" do manifesto.`
        );
      }
    }
    const skillBlock =
      manifest.skill && typeof manifest.skill === 'object' && !Array.isArray(manifest.skill) ? manifest.skill : null;
    const concepts = Array.isArray(manifest.concepts) ? manifest.concepts : [];
    const references = Array.isArray(manifest.references)
      ? manifest.references
          .map((r) =>
            String(r || '')
              .trim()
              .replace(/^\/+|\/+$/g, '')
              .replace(/^commons\//, '')
          )
          .filter(Boolean)
      : [];
    if (manifest.concepts !== undefined && !Array.isArray(manifest.concepts))
      err('formato-invalido', 'concepts', '"concepts" deve ser uma lista.');
    if (manifest.references !== undefined && !Array.isArray(manifest.references))
      err('formato-invalido', 'references', '"references" deve ser uma lista de ids de cápsulas existentes.');
    if (!skillBlock && !concepts.length && !references.length) {
      err(
        'capsula-vazia',
        '',
        'A cápsula não declara nada — inclua um bloco "skill", itens em "concepts" e/ou "references".'
      );
      return done();
    }
    plan.push(`balde: ${repoNow}`); // first plan line — the environment this deploy targets

    // Declarada no topo (`visibility`) ou em skill.visibility — é UM valor só; divergência é erro.
    // Ausente → nada muda (create nasce pública por padrão; update preserva a política atual).
    // Access per skill or capsule no longer exists: the balde decides who reads and who curates.
    // Access fields in a manifest (visibility, curators, readers) are ignored, with a warning.
    const topVis = String(manifest.visibility || '').trim();
    const skillVis = skillBlock ? String(skillBlock.visibility || '').trim() : '';
    const listed = (v) => Array.isArray(v) && v.length > 0;
    if (
      topVis ||
      skillVis ||
      listed(manifest.curators) ||
      listed(manifest.readers) ||
      (skillBlock && (listed(skillBlock.curators) || listed(skillBlock.readers)))
    ) {
      warn(
        'acesso-do-balde',
        'visibility',
        'Visibilidade, curadores e leitores por skill ou cápsula não existem mais: quem lê e quem cura é o balde (Configurações › Baldes › Acesso). Esses campos foram ignorados.'
      );
    }
    const declaredVis = '';

    const categorias = await loadCapsuleCategories();
    const categoriaKeys = categorias.map((c) => c.key);
    const categoriaMenu = categorias.map((c) => `${c.key} (${c.label})`).join(' · ');
    const domains = await loadDomains();
    const roster = await loadRoster();
    const knownEmails = new Set(roster.map((u) => String((u && u.email) || '').toLowerCase()).filter(Boolean));
    const checkEmail = (value, path) => {
      const e = String(value || '')
        .trim()
        .toLowerCase();
      if (!e) return;
      if (!e.includes('@')) {
        err('email-invalido', path, `"${value}" não é um e-mail válido.`);
        return;
      }
      if (knownEmails.size && !knownEmails.has(e))
        warn(
          'usuario-desconhecido',
          path,
          `"${e}" ainda não é conhecido pela Balde (o roster registra quem já entrou) — confira a grafia.`
        );
    };
    const checkEmailList = (list, path) => {
      (Array.isArray(list) ? list : []).forEach((v, i) => checkEmail(v, `${path}[${i}]`));
    };
    const checkCadence = (value, path) => {
      const c = String(value || '').trim();
      if (c && !CAPSULE_CADENCES.has(c))
        err(
          'cadencia-invalida',
          path,
          `Cadência "${c}" inválida — use weekly, monthly, quarterly, yearly (ou omita para herdar o padrão).`
        );
    };
    const checkCategoria = (value, path) => {
      if (value === undefined || value === null || String(value).trim() === '') return; // omitir = herda o padrão
      if (normCapsuleCategory(value, categoriaKeys) === null) {
        err(
          'categoria-invalida',
          path,
          `Categoria "${value}" inválida — use ${categoriaKeys.join(', ')} (ou omita para "${CAPSULE_CATEGORY_DEFAULT}").`
        );
      }
    };
    const checkDomain = (domain, path) => {
      if (!domains.includes(domain))
        err(
          'dominio-desconhecido',
          path,
          `Domínio "${domain}" não está no vocabulário governado (${domains.join(', ')}). Um admin pode adicioná-lo em Administração › Domínios.`
        );
    };
    const allowedCreate = actor ? await allowedDomainsForActor(actor) : null; // null = unrestricted
    const checkCreateDomain = (domain, path) => {
      if (!allowedCreate || allowedCreate.includes(domain)) return;
      err(
        'dominio-nao-autorizado',
        path,
        `Você não tem permissão para criar no domínio "${domain}": ${allowedCreate.length ? `seus domínios liberados são ${allowedCreate.join(', ')}` : 'nenhum domínio liberado para você'}. Peça ao criador do balde em Administração › Domínios por usuário.`
      );
    };

    let anchorId = null; // the skill whose SKILL.md gains the links on deploy
    let anchorLinks = new Set(); // capsule ids ALREADY linked in the anchor's spine
    if (skillBlock) {
      const action = String(skillBlock.action || '').trim();
      if (action !== 'create' && action !== 'update') {
        err(
          'acao-invalida',
          'skill.action',
          'skill.action deve ser "create" (nova skill) ou "update" (skill existente).'
        );
      } else if (action === 'update') {
        const id = String(skillBlock.id || '')
          .trim()
          .replace(/^\/+|\/+$/g, '');
        if (!id || !isSafeSkillId(id)) {
          err(
            'id-invalido',
            'skill.id',
            'Em update, informe skill.id — o id completo da skill (ex.: "pricing/pricing-processo-e-governanca").'
          );
        } else if (!(await pathExists(join(skillsRoot(), id, 'SKILL.md')))) {
          err('skill-inexistente', 'skill.id', `A skill "${id}" não existe no corpus.`);
        } else if (actor && !(await canReadSkillActor(id, actor))) {
          // Restricted skill the author can't read → same message as not-found (no existence leak).
          err('skill-inexistente', 'skill.id', `A skill "${id}" não existe no corpus.`);
        } else {
          anchorId = id;
          try {
            anchorLinks = new Set(linkedCapsuleIds(await readFile(join(skillsRoot(), id, 'SKILL.md'), 'utf8')));
          } catch (error) {
            /* unreadable spine → assume no links */
          }
          const body = String(skillBlock.body || '');
          if (body && Buffer.byteLength(body, 'utf8') > CAPSULE_BODY_MAX)
            err('conteudo-grande', 'skill.body', 'Corpo do SKILL.md acima de 512 KB.');
          plan.push(body ? `atualiza a skill ${id} (corpo do SKILL.md substituído)` : `atualiza a skill ${id}`);
        }
      } else {
        const rawId = String(skillBlock.id || '')
          .trim()
          .replace(/^\/+|\/+$/g, '');
        const domain = normalizeDomainServer(skillBlock.domain || rawId.split('/')[0] || '');
        const slug = slugifySkillId(skillBlock.slug || rawId.split('/').slice(-1)[0] || '');
        const id = rawId && rawId.includes('/') ? rawId : domain && slug ? `${domain}/${slug}` : '';
        if (!id || !isSafeSkillId(id)) {
          err(
            'id-invalido',
            'skill',
            'Em create, informe skill.domain + skill.slug (ou um skill.id "<domínio>/<slug>").'
          );
        } else {
          checkDomain(id.split('/')[0], 'skill.domain');
          checkCreateDomain(id.split('/')[0], 'skill.domain');
          if (await pathExists(join(skillsRoot(), id, 'SKILL.md')))
            err('skill-ja-existe', 'skill', `Já existe uma skill em "${id}" — use action "update".`);
          if (!String(skillBlock.title || '').trim()) err('campo-obrigatorio', 'skill.title', 'Informe skill.title.');
          if (!String(skillBlock.objetivo || '').trim())
            err('campo-obrigatorio', 'skill.objetivo', 'Informe skill.objetivo — para que a skill serve.');
          const body = String(skillBlock.body || '');
          if (body && Buffer.byteLength(body, 'utf8') > CAPSULE_BODY_MAX)
            err('conteudo-grande', 'skill.body', 'Corpo do SKILL.md acima de 512 KB.');
          if (!errors.some((e) => e.path && e.path.startsWith('skill'))) {
            anchorId = id;
            plan.push(`cria a skill ${id} (SKILL.md + governança${declaredVis === 'restricted' ? ' · restrita' : ''})`);
          }
        }
      }
      checkEmail(skillBlock.owner, 'skill.owner');
      checkEmailList(skillBlock.curators, 'skill.curators');
      checkEmailList(skillBlock.readers, 'skill.readers');
      checkCadence(skillBlock.cadence, 'skill.cadence');
      // Lint da ONTOLOGIA do domínio no corpo da skill âncora (advisory).
      {
        const skillDomain = anchorId
          ? anchorId.split('/')[0]
          : normalizeDomainServer(skillBlock.domain || String(skillBlock.id || '').split('/')[0] || '');
        const skillBody = String(skillBlock.body || '');
        if (skillDomain && skillBody.trim()) {
          const ontoIdx = await domainOntologyLintIndex(skillDomain, actor, ontoLintCache);
          if (ontoIdx) {
            for (const f of lintTextAgainstOntology(skillBody, ontoIdx, 3)) {
              warn(
                'ontologia-sinonimo',
                'skill.body',
                `A ontologia do domínio define "${f.termo}" como termo canônico — o corpo da skill usa o sinônimo "${f.usado}" (${f.count} ocorrência(s)). Prefira o termo canônico.`
              );
            }
          }
        }
      }
    }
    // Top-level ACL lists (para manifestos SEM bloco skill — só cápsulas restritas).
    checkEmailList(manifest.curators, 'curators');
    checkEmailList(manifest.readers, 'readers');

    const seenIds = new Set();
    const episodeChecks = []; // { path, id, serie, periodo } — validated against the corpus below
    const toLink = []; // capsule ids to link in the anchor spine
    for (let i = 0; i < concepts.length; i++) {
      const c = concepts[i] && typeof concepts[i] === 'object' ? concepts[i] : {};
      const base = `concepts[${i}]`;
      const action = String(c.action || '').trim();
      if (action !== 'create' && action !== 'update')
        err('acao-invalida', `${base}.action`, 'action deve ser "create" ou "update".');
      const rawId = String(c.id || '')
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .replace(/^commons\//, '');
      const segs = rawId.split('/').filter(Boolean);
      let id = null;
      if (segs.length !== 2) {
        err(
          'id-invalido',
          `${base}.id`,
          `O id de uma cápsula tem exatamente 2 segmentos: "<domínio>/<conceito>" (recebi "${rawId || '(vazio)'}").`
        );
      } else {
        const normDomain = normalizeDomainServer(segs[0]);
        const normConcept = capsuleSlugSeg(segs[1]);
        if (!normDomain || !normConcept) {
          err('id-invalido', `${base}.id`, `Id "${rawId}" inválido após normalização.`);
        } else if (normDomain !== segs[0] || normConcept !== segs[1]) {
          err(
            'id-invalido',
            `${base}.id`,
            `Use o id normalizado "${normDomain}/${normConcept}" (minúsculas, sem acentos; hífens/underscores).`
          );
        } else {
          id = rawId;
          checkDomain(normDomain, `${base}.id`);
          if (action === 'create') checkCreateDomain(normDomain, `${base}.id`);
        }
      }
      if (id) {
        if (seenIds.has(id))
          err('id-duplicado', `${base}.id`, `A cápsula "${id}" aparece mais de uma vez no manifesto.`);
        seenIds.add(id);
        const exists = await commonsHasConcept(id);
        if (action === 'create' && exists)
          err('conceito-ja-existe', `${base}.id`, `Já existe uma cápsula em "${id}" — use action "update".`);
        if (action === 'update' && !exists)
          err('conceito-inexistente', `${base}.id`, `Não existe cápsula em "${id}" — use action "create".`);
        // Restricted capsule the author can't read → same message as not-found (no existence leak).
        else if (action === 'update' && actor && !(await canReadCommonsActor(id, actor)))
          err('conceito-inexistente', `${base}.id`, `Não existe cápsula em "${id}" — use action "create".`);
        // Cápsula FECHADA = fato passado congelado — o manifesto não pode atualizá-la.
        else if (action === 'update' && (await loadCommonsConceptGov(id)).closedAt)
          err(
            'capsula-fechada',
            `${base}.id`,
            `A cápsula "${id}" está FECHADA (fato passado, congelada) — reabra-a na Governança antes de atualizar.`
          );
      }
      const body = c.body === undefined || c.body === null ? '' : String(c.body);
      if (action === 'create') {
        if (!String(c.title || '').trim()) err('campo-obrigatorio', `${base}.title`, 'Informe title.');
        if (!body.trim())
          err('campo-obrigatorio', `${base}.body`, 'Informe body — o conteúdo (markdown) do context.md.');
      }
      if (body) {
        if (Buffer.byteLength(body, 'utf8') > CAPSULE_BODY_MAX)
          err('conteudo-grande', `${base}.body`, 'Conteúdo acima de 512 KB — divida em cápsulas menores.');
        const outbound = capsuleOutboundLink(body);
        if (outbound)
          err(
            'capsula-nao-atomica',
            `${base}.body`,
            `Cápsulas são atômicas — o conteúdo não pode referenciar outros nós do corpus (encontrei um link para "${outbound}"). Relações ficam no SKILL.md da skill âncora; remova o link do corpo.`
          );
      }
      // Linha do tempo: serie + periodo (both optional; episode = both set).
      const serieRaw = String(c.serie || '').trim();
      const serieNorm = normSerieField(serieRaw);
      if (serieRaw && !serieNorm)
        err('serie-invalida', `${base}.serie`, `Série "${serieRaw}" inválida após normalização.`);
      else if (serieRaw && serieNorm !== serieRaw)
        warn(
          'serie-normalizada',
          `${base}.serie`,
          `A série será gravada como "${serieNorm}" — use essa grafia no manifesto.`
        );
      const periodoNorm = normPeriodoField(c.periodo);
      if (periodoNorm === null)
        err(
          'periodo-invalido',
          `${base}.periodo`,
          `Período "${c.periodo}" inválido — use os formatos 2026, 2026-07, 2026-W31 ou 2026-07-15 (o formato é a granularidade).`
        );
      if (periodoNorm && !serieNorm)
        warn(
          'periodo-sem-serie',
          `${base}.periodo`,
          'Período sem série não forma um episódio — informe também "serie".'
        );
      if (id && serieNorm && periodoNorm)
        episodeChecks.push({ path: base, id, serie: serieNorm, periodo: periodoNorm });
      // media (img/ + data/ sidecars, base64)
      const media = Array.isArray(c.media) ? c.media : [];
      if (c.media !== undefined && !Array.isArray(c.media))
        err('formato-invalido', `${base}.media`, '"media" deve ser uma lista de { path, base64 }.');
      for (let m = 0; m < media.length; m++) {
        const mm = media[m] && typeof media[m] === 'object' ? media[m] : {};
        const mp = String(mm.path || mm.relPath || '')
          .replace(/\\/g, '/')
          .replace(/^\/+/, '');
        const seg = mp.split('/')[0];
        if (!mp || mp.includes('..') || (seg !== 'img' && seg !== 'data') || mp.split('/').length !== 2) {
          err(
            'midia-caminho-invalido',
            `${base}.media[${m}].path`,
            `Mídia deve ficar em "img/<arquivo>" ou "data/<arquivo>" (recebi "${mp || '(vazio)'}").`
          );
        }
        const b64 = String(mm.base64 || '');
        if (!b64) {
          err('midia-vazia', `${base}.media[${m}].base64`, 'Mídia sem conteúdo base64.');
          continue;
        }
        let bytes = 0;
        try {
          bytes = Buffer.from(b64, 'base64').length;
        } catch (error) {
          bytes = 0;
        }
        if (!bytes) err('midia-vazia', `${base}.media[${m}].base64`, 'base64 inválido ou vazio.');
        else if (bytes > CAPSULE_MEDIA_MAX)
          err(
            'midia-grande',
            `${base}.media[${m}].base64`,
            `Mídia com ${(bytes / (1024 * 1024)).toFixed(1)} MB — o limite é 3 MB por arquivo.`
          );
      }
      if (c.visibility !== undefined)
        warn(
          'visibilidade-por-capsula-ignorada',
          `${base}.visibility`,
          'A visibilidade é ÚNICA por manifesto (campo "visibility" no topo) e herdada por todas as cápsulas — o campo por cápsula é ignorado.'
        );
      checkEmail(c.owner, `${base}.owner`);
      checkEmailList(c.curators, `${base}.curators`);
      checkCadence(c.cadence, `${base}.cadence`);
      checkCategoria(c.categoria, `${base}.categoria`);
      // Tipo da cápsula: um create sem categoria viraria o padrão em silêncio — o gerador deve
      // declarar o tipo, e perguntar ao usuário final quando o material não o deixa claro.
      if (action === 'create' && String(c.categoria == null ? '' : c.categoria).trim() === '') {
        warn(
          'categoria-ausente',
          `${base}.categoria`,
          `Cápsula nova sem "categoria" — será gravada como "${CAPSULE_CATEGORY_DEFAULT}". Declare o tipo do material: ${categoriaMenu}. Se o tipo não estiver claro, pergunte ao usuário final antes de submeter.`
        );
      }
      // Lint da ONTOLOGIA do domínio (advisory, nunca bloqueia): sinônimos não-canônicos no
      // corpo + título que coincide com conceito já definido. Só quando o domínio tem uma
      // ontologia legível pelo autor (ACL respeitada); a própria cápsula de ontologia escapa.
      if (id && !isOntologyCapsuleId(id)) {
        const ontoIdx = await domainOntologyLintIndex(id.split('/')[0], actor, ontoLintCache);
        if (ontoIdx) {
          if (action === 'create') {
            const tm = ontologyTitleMatch(String(c.title || '').trim() || id.split('/').pop(), ontoIdx);
            if (tm)
              warn(
                'ontologia-conceito-existente',
                `${base}.title`,
                `"${String(c.title || id.split('/').pop()).trim()}" coincide com o conceito canônico "${tm.termo}" da ontologia do domínio${tm.via === 'sinonimo' ? ` (via sinônimo "${tm.usado}")` : ''} — confira se esta cápsula não duplica um conceito já definido.`
              );
          }
          for (const f of lintTextAgainstOntology(body, ontoIdx, 3)) {
            warn(
              'ontologia-sinonimo',
              `${base}.body`,
              `A ontologia do domínio define "${f.termo}" como termo canônico — o corpo usa o sinônimo "${f.usado}" (${f.count} ocorrência(s)). Prefira o termo canônico.`
            );
          }
        }
      }
      // link into the anchor spine (default true when an anchor exists)
      const wantLink = c.link !== false;
      if (c.link === true && !skillBlock)
        err(
          'vinculo-sem-skill',
          `${base}.link`,
          'Para vincular a cápsula numa skill, inclua o bloco "skill" (create ou update).'
        );
      if (id && wantLink && anchorId) toLink.push(id);
      if (
        id &&
        action === 'update' &&
        !body.trim() &&
        !serieRaw &&
        c.periodo === undefined &&
        !String(c.title || '').trim() &&
        !String(c.summary || '').trim() &&
        c.owner === undefined &&
        c.curators === undefined &&
        c.cadence === undefined &&
        c.categoria === undefined &&
        c.evalCriteria === undefined &&
        !media.length
      ) {
        warn('atualizacao-vazia', base, `O update de "${id}" não declara nenhuma mudança.`);
      }
    }

    if (references.length && !skillBlock)
      err(
        'vinculo-sem-skill',
        'references',
        'references vincula cápsulas existentes numa skill — inclua o bloco "skill".'
      );
    for (let i = 0; i < references.length; i++) {
      const rid = references[i];
      const segs = rid.split('/').filter(Boolean);
      if (segs.length !== 2) {
        err('id-invalido', `references[${i}]`, `Referência "${rid}" inválida — use "<domínio>/<conceito>".`);
        continue;
      }
      if (seenIds.has(rid)) {
        warn(
          'referencia-redundante',
          `references[${i}]`,
          `"${rid}" já está em concepts — a referência é desnecessária.`
        );
        continue;
      }
      if (!(await commonsHasConcept(rid))) {
        err('referencia-inexistente', `references[${i}]`, `A cápsula referenciada "${rid}" não existe no corpus.`);
        continue;
      }
      // Restricted capsule the author can't read → same message as not-found (no existence leak).
      if (actor && !(await canReadCommonsActor(rid, actor))) {
        err('referencia-inexistente', `references[${i}]`, `A cápsula referenciada "${rid}" não existe no corpus.`);
        continue;
      }
      if (anchorId) toLink.push(rid);
    }

    if (episodeChecks.length && errors.length === 0) {
      try {
        const list = await buildCommonsList();
        const byKey = new Map(); // '<domínio>/<serie>' → [{path, periodo}]
        for (const cc of list.concepts || []) {
          const g = cc.governance || {};
          if (!g.serie) continue;
          const key = `${cc.path.split('/')[0]}/${g.serie}`;
          if (!byKey.has(key)) byKey.set(key, []);
          byKey.get(key).push({ path: cc.path, periodo: String(g.periodo || '') });
        }
        for (const ep of episodeChecks) {
          const key = `${ep.id.split('/')[0]}/${ep.serie}`;
          const existing = (byKey.get(key) || []).filter((x) => x.path !== ep.id);
          const periods = existing
            .map((x) => x.periodo)
            .filter(Boolean)
            .sort();
          if (periods.includes(ep.periodo))
            warn(
              'periodo-duplicado',
              `${ep.path}.periodo`,
              `A série ${key} já tem um episódio em ${ep.periodo} (${existing.find((x) => x.periodo === ep.periodo).path}).`
            );
          const monthly = periods.length > 0 && periods.every((p) => /^\d{4}-\d{2}$/.test(p));
          if (monthly && !/^\d{4}-\d{2}$/.test(ep.periodo))
            warn(
              'granularidade-mista',
              `${ep.path}.periodo`,
              `A série ${key} é mensal (AAAA-MM) e "${ep.periodo}" tem outra granularidade — os marcadores de lacuna param de funcionar.`
            );
          ep.latest = periods.length ? periods[periods.length - 1] : '';
        }
      } catch (error) {
        /* série intelligence is best-effort — never blocks a compile */
      }
    }

    for (let i = 0; i < concepts.length; i++) {
      const c = concepts[i] && typeof concepts[i] === 'object' ? concepts[i] : {};
      const rawId = String(c.id || '')
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .replace(/^commons\//, '');
      if (!rawId || errors.length) continue;
      const ep = episodeChecks.find((x) => x.path === `concepts[${i}]`);
      const serieInfo = ep
        ? ` (série ${ep.id.split('/')[0]}/${ep.serie} · ${ep.periodo}${ep.latest ? `; mais recente hoje: ${ep.latest}` : '; primeiro episódio'})`
        : '';
      const mediaInfo = Array.isArray(c.media) && c.media.length ? ` + ${c.media.length} mídia(s)` : '';
      plan.push(`${String(c.action) === 'update' ? 'atualiza' : 'cria'} a cápsula ${rawId}${serieInfo}${mediaInfo}`);
    }
    if (anchorId && toLink.length && errors.length === 0) {
      const fresh = [...new Set(toLink)].filter((idc) => !anchorLinks.has(idc));
      const already = [...new Set(toLink)].filter((idc) => anchorLinks.has(idc));
      if (fresh.length) plan.push(`vincula ${fresh.length} cápsula(s) no SKILL.md de ${anchorId}: ${fresh.join(', ')}`);
      if (already.length) plan.push(`já vinculadas (sem mudança): ${already.join(', ')}`);
      const totalAfter = anchorLinks.size + fresh.length;
      if (totalAfter > MAX_LINKED_CAPSULES)
        warn(
          'limite-de-vinculos',
          'skill',
          `O SKILL.md ficaria com ${totalAfter} cápsulas vinculadas — acima de ${MAX_LINKED_CAPSULES}, o excedente é ignorado na fundamentação do chat.`
        );
    }
    if (declaredVis && errors.length === 0) {
      plan.push(
        `política de acesso: visibilidade ${declaredVis === 'restricted' ? 'RESTRITA' : 'pública'} — herdada pela skill âncora e por TODAS as cápsulas do manifesto`
      );
    }

    // Machine-usable digest of what a clean capsule does — consumed by submit (queue item
    // metadata) and by the apply step; also returned to callers (harmless extra field).
    const result = done();
    if (result.ok) {
      result.summary = {
        anchorId: anchorId || '',
        anchorAction: skillBlock ? String(skillBlock.action || '') : '',
        skillBodyReplaced: Boolean(
          skillBlock && String(skillBlock.action) === 'update' && String(skillBlock.body || '').trim()
        ),
        toLink: [...new Set(toLink)],
        concepts: concepts.map((c, i) => {
          const cc = c && typeof c === 'object' ? c : {};
          const ep = episodeChecks.find((x) => x.path === `concepts[${i}]`);
          return {
            id: String(cc.id || '')
              .trim()
              .replace(/^\/+|\/+$/g, '')
              .replace(/^commons\//, ''),
            action: String(cc.action || ''),
            title: String(cc.title || '').trim(),
            serie: ep ? ep.serie : normSerieField(String(cc.serie || '').trim()) || '',
            periodo: ep ? ep.periodo : normPeriodoField(cc.periodo) || '',
            media: Array.isArray(cc.media) ? cc.media.length : 0
          };
        }),
        references,
        // Visibilidade única + ACL efetiva (skill.curators/readers ∪ listas do topo ∪ owner).
        // null quando o manifesto não declara visibilidade — o apply então não toca ACLs.
        access: declaredVis
          ? {
              visibility: declaredVis,
              curators: normEmailList([
                ...(skillBlock && Array.isArray(skillBlock.curators) ? skillBlock.curators : []),
                ...(Array.isArray(manifest.curators) ? manifest.curators : []),
                ...(skillBlock && skillBlock.owner ? [skillBlock.owner] : [])
              ]),
              readers: normEmailList([
                ...(skillBlock && Array.isArray(skillBlock.readers) ? skillBlock.readers : []),
                ...(Array.isArray(manifest.readers) ? manifest.readers : [])
              ])
            }
          : null
      };
    }
    return result;
  }

  // A clean capsule becomes ONE queue item (type 'capsule'): the manifest goes to its own
  // sidecar (capsule.json — may carry base64 media) so the queue LIST stays light; item.json
  // keeps the deployment plan + a digest. Approval (queue decide) re-compiles against the
  // CURRENT corpus and applies atomically; nothing enters the corpus without that human click.
  async function createCapsuleQueueItem(manifest, compiled, { source, submittedBy, root }) {
    const s = compiled.summary || {};
    const id = newQueueId();
    const where = root || (await submissionRoot());
    const dir = join(where, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'capsule.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await writeFile(join(dir, 'content.md'), '', 'utf8'); // keep the folder-item invariant
    const now = new Date().toISOString();
    const firstConcept = (s.concepts || [])[0];
    const meta = {
      id,
      type: 'capsule',
      repo: activeRepo(), // the balde this item belongs to — Fila lists/decisions are repo-scoped
      skillId: s.anchorId || '',
      originalSkillId: s.anchorId || '',
      title:
        String(manifest.title || '')
          .trim()
          .slice(0, 160) || `Cápsula: ${firstConcept ? firstConcept.id : s.anchorId || 'importação'}`,
      tags: [],
      source: ['api', 'web', 'chat'].includes(source) ? source : 'web',
      submittedBy: {
        name: String(submittedBy?.name || 'anônimo').slice(0, 120),
        email: String(submittedBy?.email || '').slice(0, 160)
      },
      status: 'pendente',
      contentChars: 0,
      preview: (compiled.plan || []).join(' · ').slice(0, QUEUE_PREVIEW_CHARS),
      files: [],
      capsule: {
        plan: compiled.plan || [],
        warnings: compiled.warnings || [],
        summary: s,
        compiledAt: now
      },
      ai: null,
      review: null,
      createdAt: now,
      updatedAt: now
    };
    await writeQueueMeta(meta, where);
    await sealSubmission(dir, meta);
    emitNotifyContribution(meta); // per-item e-mail to everyone who curates it (the balde's curators when unanchored)
    pushLocalNotice(
      'Nova cápsula na Fila',
      `${(submittedBy && (submittedBy.name || submittedBy.email)) || 'alguém'}: ${meta.title || meta.skillId || 'cápsula'}`,
      submittedBy && submittedBy.email
    );
    return meta;
  }

  // Apply a clean capsule manifest to the corpus. ALWAYS re-compiles first (the corpus may have
  // moved since submit) — on any error nothing is written and the report is returned so the
  // curator sees exactly why. isAdmin gates cadence changes on locked nodes.
  async function applyCapsuleManifest(manifest, actor, { isAdmin = false, queueId = '' } = {}) {
    const inputHash = operationKey(JSON.stringify(manifest));
    const journalPath = join(repoDirOf(activeRepo()), '.balde', 'capsule-operations', `${queueId || inputHash}.json`);
    const existing = await readTransaction(journalPath);
    // Retoma o plano gravado; um plano desfeito na Fila ("Desfazer aplicação") recomeça do zero.
    if (existing && existing.status !== 'abandoned') {
      const result = await applyFileTransaction({ journalPath, root: repoDirOf(activeRepo()), inputHash });
      const commons = existing.entries
        .filter((entry) => entry.path.startsWith('commons/'))
        .map((entry) => entry.path.slice(8));
      const skills = existing.entries
        .filter((entry) => entry.path.startsWith('skills/'))
        .map((entry) => entry.path.slice(7));
      if (commons.length) await commitRepo(commonsRoot(), `capsule: retomada ${queueId || inputHash}`, actor, commons);
      if (skills.length) await commitCorpus(`capsule: retomada ${queueId || inputHash}`, actor, skills);
      return result;
    }
    const plannedFiles = new Map();
    const plannedWrite = async (path, content) => {
      plannedFiles.set(path, content);
    };
    const prepareDirectory = async () => {};
    const compiled = await compileCapsule(manifest);
    if (!compiled.ok) return { ok: false, errors: compiled.errors, warnings: compiled.warnings };
    const s = compiled.summary || {};
    const who = actor.name || actor.email || 'curador';
    const applied = { concepts: [], linked: [], skillBodyReplaced: false, notes: [] };
    const concepts = Array.isArray(manifest.concepts) ? manifest.concepts : [];

    // 1) capsule concepts (create/update) — mirrors /api/commons/new semantics
    for (const c of concepts) {
      const cc = c && typeof c === 'object' ? c : {};
      const id = String(cc.id || '')
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .replace(/^commons\//, '');
      if (!id) continue;
      const action = String(cc.action || '');
      const conceptDir = join(commonsRoot(), id);
      const title = String(cc.title || '').trim();
      const summary = String(cc.summary || '').trim();
      let body = cc.body === undefined || cc.body === null ? '' : String(cc.body);
      if (body && title && !/^#\s/m.test(body)) body = `# ${title}\n\n${body}`;

      if (action === 'create') {
        await prepareDirectory(conceptDir, { recursive: true });
        if (!body)
          body = `# ${title || id.split('/').pop()}\n\n${summary || 'Descreva o conceito compartilhado aqui.'}`;
        await plannedWrite(commonsConceptContextPath(id), body.endsWith('\n') ? body : `${body}\n`, 'utf8');
      } else if (body) {
        await plannedWrite(commonsConceptContextPath(id), body.endsWith('\n') ? body : `${body}\n`, 'utf8');
      }

      // media sidecars (paths validated at compile; re-guarded here)
      const media = Array.isArray(cc.media) ? cc.media : [];
      for (const mm of media) {
        const mp = String((mm && (mm.path || mm.relPath)) || '')
          .replace(/\\/g, '/')
          .replace(/^\/+/, '');
        const seg = mp.split('/')[0];
        if (!mp || mp.includes('..') || (seg !== 'img' && seg !== 'data')) continue;
        const target = join(conceptDir, mp);
        if (!target.startsWith(conceptDir)) continue;
        await prepareDirectory(dirname(target), { recursive: true });
        await plannedWrite(target, Buffer.from(String((mm && mm.base64) || ''), 'base64'));
      }

      // governed-node ledger
      const gov = action === 'update' ? await loadCommonsConceptGov(id) : {};
      stampCreator(gov, actor);
      if (String(cc.owner || '').trim()) gov.owner = String(cc.owner).trim();
      const curators = Array.isArray(cc.curators)
        ? cc.curators
            .map((x) =>
              String(x || '')
                .trim()
                .toLowerCase()
            )
            .filter((x) => x.includes('@'))
        : null;
      if (curators && curators.length) gov.curators = curators;
      if (summary) gov.summary = summary;
      const cad = CAPSULE_CADENCES.has(String(cc.cadence || '')) ? String(cc.cadence) : '';
      if (cad && cad !== gov.cadence) {
        if (gov.cadenceLockedAt && !isAdmin) {
          applied.notes.push(
            `cadência de ${id} mantida (travada por ${gov.cadenceLockedBy || 'criador'} — só admin altera)`
          );
        } else {
          gov.cadence = cad;
          if (!gov.cadenceLockedAt) {
            gov.cadenceLockedAt = new Date().toISOString();
            gov.cadenceLockedBy = who;
          }
          pushApproval(gov, 'cadence', cad, actor);
        }
      }
      if (Array.isArray(cc.evalCriteria)) {
        const crit = cc.evalCriteria
          .map((x) => String(x || '').trim())
          .filter(Boolean)
          .slice(0, 20);
        if (crit.length) {
          gov.evalCriteria = crit;
          pushApproval(gov, 'eval-criteria', `${crit.length} critério(s)`, actor);
        }
      }
      const tituloNovo = String(cc.titulo == null ? '' : cc.titulo)
        .trim()
        .slice(0, 120);
      if (tituloNovo) gov.titulo = tituloNovo;
      // Categoria: create sem categoria nasce no padrão; update sem categoria preserva a atual.
      const catNorm = normCapsuleCategory(cc.categoria, await capsuleCategoryKeys());
      if (catNorm) {
        if (catNorm !== gov.categoria) pushApproval(gov, 'categoria', catNorm, actor);
        gov.categoria = catNorm;
      } else if (action === 'create' && !gov.categoria) {
        gov.categoria = CAPSULE_CATEGORY_DEFAULT;
      }
      const serieNorm = normSerieField(String(cc.serie || '').trim());
      if (serieNorm) gov.serie = serieNorm;
      const periodoNorm = normPeriodoField(cc.periodo);
      if (periodoNorm) gov.periodo = periodoNorm;
      pushApproval(
        gov,
        action === 'create' ? 'created' : 'capsule-update',
        queueId ? `cápsula via fila ${queueId}` : 'cápsula de importação',
        actor
      );
      await plannedWrite(commonsConceptGovPath(id), `${JSON.stringify(gov, null, 2)}\n`, 'utf8');
      // Visibilidade única do manifesto: cada cápsula herda a política declarada (manifesto
      // sem `visibility` → política atual intocada). O aplicador fica sempre listado como
      // curador quando restrita, para a cápsula nunca se trancar sozinha.
      if (s.access) {
        const prevAcc = await loadCommonsAccess(id);
        await writeCommonsAccessDoc(id, {
          visibility: s.access.visibility,
          curators:
            s.access.visibility === 'restricted'
              ? [
                  ...new Set(
                    [...(s.access.curators || []), normEmail(actor.email || '')].filter((e) => e && e.includes('@'))
                  )
                ]
              : s.access.curators || [],
          curator_groups: prevAcc.curator_groups,
          readers: s.access.readers || [],
          reader_groups: prevAcc.reader_groups
        });
      }
      applied.concepts.push({ id, action });
    }

    // 2) anchor skill spine. update: optional body replacement + link insertion (frontmatter
    //    untouched). create (Fase 3): a WHOLE new skill — SKILL.md via the shared starter builder
    //    (links already inserted in the body) + ACCESS.yml + governance seed, mirroring /api/skills/new.
    const anchorId = s.anchorId || '';
    const creatingSkill = Boolean(anchorId) && s.anchorAction === 'create';
    if (anchorId) {
      const spinePath = join(skillsRoot(), anchorId, 'SKILL.md');
      const sk = manifest.skill && typeof manifest.skill === 'object' ? manifest.skill : {};
      let prefix = '';
      let spineBody;
      if (creatingSkill) {
        spineBody = String(sk.body || '').trim() || `## Papel\n\n${String(sk.objetivo || '').trim()}`;
      } else {
        const raw = await readFile(spinePath, 'utf8');
        const fmMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
        prefix = fmMatch ? fmMatch[0] : '';
        spineBody = String(sk.body || '').trim() ? String(sk.body) : raw.slice(prefix.length);
        applied.skillBodyReplaced = Boolean(String(sk.body || '').trim());
      }
      const linkedNow = new Set(linkedCapsuleIds(spineBody));
      const titleById = new Map((s.concepts || []).filter((x) => x.id && x.title).map((x) => [x.id, x.title]));
      const fresh = [...new Set(s.toLink || [])].filter((idc) => !linkedNow.has(idc));
      if (fresh.length) {
        const lines = fresh.map((idc) => `- [${titleById.get(idc) || idc.split('/').pop()}](/commons/${idc})`);
        const HEADING = '## Cápsulas vinculadas';
        const bodyLines = spineBody.split('\n');
        const hIdx = bodyLines.findIndex((ln) => ln.trim() === HEADING);
        if (hIdx >= 0) {
          bodyLines.splice(hIdx + 1, 0, ...lines);
          spineBody = bodyLines.join('\n');
        } else {
          spineBody = `${spineBody.trimEnd()}\n\n${HEADING}\n${lines.join('\n')}\n`;
        }
        applied.linked = fresh;
      }
      if (creatingSkill) {
        const markdown = buildStarterSkillMarkdown({
          title: String(sk.title || '').trim(),
          kind: 'skill',
          description: sk.description,
          tags: [],
          objetivo: String(sk.objetivo || '').trim(),
          escopo: sk.escopo,
          owner: String(sk.owner || '').trim() || actor.email,
          timestamp: new Date().toISOString().slice(0, 10),
          resource: '',
          buddyId: '',
          outputShape: 'scalar',
          inputKind: 'text',
          formulaSafe: true,
          modelTier: 'economico',
          maxTokens: 4096,
          temperature: 0,
          allowedTools: [],
          dataCatalogs: [],
          reportRefs: [],
          skillKind: 'knowledge',
          body: spineBody
        });
        await prepareDirectory(join(skillsRoot(), anchorId), { recursive: true });
        await plannedWrite(spinePath, markdown, 'utf8');
        const curators = Array.isArray(sk.curators)
          ? sk.curators
              .map((x) =>
                String(x || '')
                  .trim()
                  .toLowerCase()
              )
              .filter((x) => x.includes('@'))
          : [];
        const readers = Array.isArray(sk.readers)
          ? sk.readers
              .map((x) =>
                String(x || '')
                  .trim()
                  .toLowerCase()
              )
              .filter((x) => x.includes('@'))
          : [];
        const visNew = s.access
          ? s.access.visibility
          : String(sk.visibility) === 'restricted'
            ? 'restricted'
            : 'public';
        if (visNew === 'restricted' || curators.length || readers.length) {
          // Restrita: owner + aplicador sempre listados — a skill nova não pode nascer trancada.
          const curs =
            visNew === 'restricted'
              ? [
                  ...new Set(
                    [...curators, normEmail(sk.owner || ''), normEmail(actor.email || '')].filter(
                      (e) => e && e.includes('@')
                    )
                  )
                ]
              : curators;
          try {
            await saveSkillAccess(anchorId, { visibility: visNew, curators: curs, readers }, actor);
          } catch (error) {
            applied.notes.push('ACCESS.yml não pôde ser gravado');
          }
        }
        const seedCadence = CADENCE_DAYS[String(sk.cadence || '')] ? String(sk.cadence) : '';
        // evalCriteria accepts strings (title-only criteria) or {title, prompt, question, expected,
        // mustRefuse} objects (full use cases). Titles keep feeding the legacy governance list; the
        // full items also materialize eval/cases.json so the skill is born with its avaliação
        // (otherwise every capsule-created skill shows "eval/cases.json ausente").
        const seedItems = (Array.isArray(sk.evalCriteria) ? sk.evalCriteria : [])
          .map((x) =>
            typeof x === 'string'
              ? { title: x.trim() }
              : x && typeof x === 'object'
                ? {
                    title: String(x.title || '').trim(),
                    prompt: String(x.prompt || '').trim(),
                    question: String(x.question || '').trim(),
                    expected: String(x.expected || '').trim(),
                    mustRefuse: !!x.mustRefuse
                  }
                : null
          )
          .filter((x) => x && x.title)
          .slice(0, 20);
        const seedCriteria = seedItems.map((x) => x.title);
        if (seedCadence || seedCriteria.length) {
          const gi = await loadGovernanceIndex(anchorId);
          stampCreator(gi.skill, actor);
          if (seedCadence) {
            gi.skill.cadence = seedCadence;
            gi.skill.cadenceLockedAt = new Date().toISOString();
            gi.skill.cadenceLockedBy = who;
            pushApproval(gi.skill, 'cadence', seedCadence, actor);
          }
          if (seedCriteria.length) {
            gi.skill.evalCriteria = seedCriteria;
            pushApproval(gi.skill, 'eval-criteria', `${seedCriteria.length} critério(s)`, actor);
          }
          await plannedWrite(
            governanceIndexPath(anchorId),
            `${JSON.stringify({ version: 1, skill: gi.skill, concepts: gi.concepts || {} }, null, 2)}\n`,
            'utf8'
          );
        }
        if (seedItems.length) {
          await plannedWrite(
            join(skillsRoot(), anchorId, 'eval', 'cases.json'),
            JSON.stringify(normStoredEval({ items: seedItems.map(normEvalItem) }), null, 2)
          );
        }
        applied.skillCreated = anchorId;
      } else if (applied.skillBodyReplaced || fresh.length) {
        await plannedWrite(spinePath, `${prefix}${spineBody.endsWith('\n') ? spineBody : `${spineBody}\n`}`, 'utf8');
      }
      // Visibilidade única (update): a skill âncora herda a política declarada no manifesto,
      // preservando as listas atuais quando o manifesto não as redeclara. saveSkillAccess
      // commita por conta própria, então um update só-de-visibilidade também fica no git.
      if (!creatingSkill && s.access) {
        try {
          const prevSk = await loadSkillAccess(anchorId);
          const baseCurators = Array.isArray(sk.curators) && sk.curators.length ? sk.curators : prevSk.curators;
          await saveSkillAccess(
            anchorId,
            {
              visibility: s.access.visibility,
              // capsula-spec: em escrita restrita o curador aprovador fica SEMPRE listado (anti-bloqueio) —
              // o create e as cápsulas já faziam essa união; o update ficava de fora por descuido.
              curators:
                s.access.visibility === 'restricted' && actor && actor.email
                  ? [...new Set([...baseCurators, String(actor.email).toLowerCase()])]
                  : baseCurators,
              curator_groups: prevSk.curator_groups,
              readers: Array.isArray(sk.readers) && sk.readers.length ? sk.readers : prevSk.readers,
              reader_groups: prevSk.reader_groups
            },
            actor
          );
        } catch (error) {
          applied.notes.push('ACCESS.yml da skill não pôde ser gravado');
        }
      }
    }

    await applyFileTransaction({
      journalPath,
      root: repoDirOf(activeRepo()),
      inputHash,
      files: plannedFiles,
      result: { ok: true, applied }
    });

    // 3) commits (one per repo touched) + best-effort context summaries refresh
    if (applied.concepts.length) {
      await commitRepo(
        commonsRoot(),
        `capsule: ${applied.concepts.length} cápsula(s) aplicada(s)${queueId ? ` via fila ${queueId}` : ''} por ${who}`,
        actor,
        applied.concepts.map((c) => c.id)
      );
    }
    if (anchorId && (creatingSkill || applied.skillBodyReplaced || applied.linked.length)) {
      await commitCorpus(
        creatingSkill
          ? `skill(${anchorId}): criada via cápsula${queueId ? ` da fila ${queueId}` : ''} por ${who}`
          : `skill(${anchorId}): cápsula${queueId ? ` da fila ${queueId}` : ''} aplicada por ${who}`,
        actor,
        [anchorId]
      );
      regenerateContextIndex(anchorId, actor).catch(() => {});
    }
    return { ok: true, applied };
  }

  return {
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
  };
}
