import { CAPSULE_CATEGORY_DEFAULT } from '../policy/governance-policy.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { assertSafeUploadName, slugifySkillId } from '../skill-format.mjs';
import { skillsRoot, docsRoot, commonsRoot, activeRepo } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { actorFromReq, gitHistoryForPath } from '../git-corpus.mjs';
import { loadGlobalTheme, saveGlobalTheme, listAllThemes } from '../buddies.mjs';
import { gateAction } from '../security/permissions.mjs';

export function createAdministrationRoutes({
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
}) {
  return async function administrationRoutes(req, res, url) {
    if (url.pathname.startsWith('/api/admin/')) {
      // A regra única decide (D1): organizar o balde ativo (domínios, categorias, mover skills) é curadoria;
      // quem cria em cada domínio é do criador; o resto (visão das APIs, prompts, documentos, tema dos
      // buddies) é da instalação, para o grupo de Admins. Ler pede só o papel; gravar, também a pasta.
      const action = gateAction('POST', url.pathname);
      if (action === 'curar' || action === 'administrar') {
        if (!(await (req.method === 'GET' ? roleReq : permitReq)(req, res, action))) return true;
      } else if (!isAdminReq(req)) {
        sendJson(res, 403, { ok: false, error: 'Acesso restrito a administradores.' });
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
        sendJson(res, 200, {
          ok: true,
          apis: EXPOSED_APIS,
          usage: await usageSummary(),
          baseUrl: NOTIFY_BASE_URL,
          machineAuth: {
            mode: 'personal-token', // shared API_KEY retired
            gateGroup: API_GROUP || null, // group required to use a personal token
            serviceReady: authentikServiceReady(), // broker (mint/reveal/revoke) available?
            sharedKeyActive: Boolean(currentApiKey()) // should be false; surfaces a lingering legacy key
          },
          authentik: {
            apiUrl: Boolean(AUTHENTIK_API_URL),
            serviceToken: Boolean(AUTHENTIK_SERVICE_TOKEN),
            gateGroup: API_GROUP || null,
            tokenTtlMs: AUTHENTIK_TOKEN_TTL_MS
          }
        });
        return true;
      }
      // Buddy theme: global active theme (christmas/carnival/…) + the theme names in use.
      // Poses + temperaments swap to the active theme server-side; API/URLs are unchanged.
      if (req.method === 'GET' && url.pathname === '/api/admin/buddy-theme') {
        sendJson(res, 200, { ok: true, active: await loadGlobalTheme(), themes: await listAllThemes() });
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/buddy-theme') {
        const body = await readJsonBody(req);
        try {
          const active = await saveGlobalTheme(body.active, actorFromReq(req));
          sendJson(res, 200, { ok: true, active, themes: await listAllThemes() });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
        return true;
      }
      // System prompts (Criar skill wizard) — list + edit body (git-versioned).
      if (req.method === 'GET' && url.pathname === '/api/admin/prompts') {
        sendJson(res, 200, { ok: true, prompts: await listPrompts() });
        return true;
      }
      if (req.method === 'PUT' && url.pathname === '/api/admin/prompts') {
        const body = await readJsonBody(req);
        try {
          const prompt = await writePromptBody(body.id, body.body, actorFromReq(req));
          sendJson(res, 200, { ok: true, prompt });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
        return true;
      }
      // Governed domain vocabulary (shared by skills + commons). Admin CRUD.
      if (req.method === 'GET' && url.pathname === '/api/admin/capsule-categories') {
        sendJson(res, 200, {
          ok: true,
          categories: await loadCapsuleCategories(),
          usage: await capsuleCategoryUsage()
        });
        return true;
      }
      if (req.method === 'PUT' && url.pathname === '/api/admin/capsule-categories') {
        const body = await readJsonBody(req);
        try {
          // Remover uma categoria em uso deixaria cápsulas apontando para um vocabulário morto:
          // recusa e diz quantas usam, para o admin reatribuir antes.
          const incoming = new Set(
            (Array.isArray(body.categories) ? body.categories : [])
              .map((c) => normCapsuleCategoryKey(c && c.key))
              .filter(Boolean)
          );
          const usage = await capsuleCategoryUsage();
          const orphaned = Object.entries(usage)
            .filter(([k, n]) => n > 0 && !incoming.has(k) && k !== CAPSULE_CATEGORY_DEFAULT)
            .map(([k, n]) => `${k} (${n})`);
          if (orphaned.length && !body.force) {
            sendJson(res, 409, {
              ok: false,
              error: `Estas categorias ainda estão em uso: ${orphaned.join(', ')}. Reatribua as cápsulas antes de remover (ou envie force para mandá-las para "${CAPSULE_CATEGORY_DEFAULT}").`
            });
            return true;
          }
          const categories = await saveCapsuleCategories(body.categories, actorFromReq(req));
          // force: as órfãs voltam para o padrão, para nenhuma cápsula ficar com categoria inválida.
          let reassigned = 0;
          const reassignedPaths = [];
          if (orphaned.length && body.force) {
            const keys = categories.map((c) => c.key);
            for (const id of await listCommonsConcepts()) {
              const g = await loadCommonsConceptGov(id);
              const k = normCapsuleCategoryKey(g.categoria);
              if (k && !keys.includes(k)) {
                g.categoria = CAPSULE_CATEGORY_DEFAULT;
                await writeFile(
                  commonsConceptGovPath(id),
                  `${JSON.stringify(g, null, 2)}
    `,
                  'utf8'
                );
                reassigned += 1;
                reassignedPaths.push(id);
              }
            }
            if (reassigned)
              await commitRepo(
                commonsRoot(),
                `categorias de cápsula: ${reassigned} cápsula(s) reatribuída(s) para ${CAPSULE_CATEGORY_DEFAULT}`,
                actorFromReq(req),
                reassignedPaths
              );
          }
          sendJson(res, 200, { ok: true, categories, reassigned, usage: await capsuleCategoryUsage() });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/domains') {
        sendJson(res, 200, { ok: true, domains: await loadDomains() });
        return true;
      }
      if (req.method === 'PUT' && url.pathname === '/api/admin/domains') {
        const body = await readJsonBody(req);
        try {
          const domains = await saveDomains(body.domains, actorFromReq(req));
          sendJson(res, 200, { ok: true, domains });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
        return true;
      }
      // Per-user CREATION whitelist (LP Builder's lp_user_domains): who may create in which
      // governed domain. GET = every assignment; POST = replace one user's set (empty = revoke all).
      if (req.method === 'GET' && url.pathname === '/api/admin/user-domains') {
        const { open, people } = await baldePeople(activeRepo());
        sendJson(res, 200, {
          ok: true,
          domains: await loadDomains(),
          assignments: (await loadUserDomainAssignments()).users,
          people,
          open
        });
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/user-domains') {
        const body = await readJsonBody(req);
        try {
          const saved = await saveUserDomainAssignment(body.email, body.domains, actorFromReq(req));
          sendJson(res, 200, { ok: true, ...saved, assignments: (await loadUserDomainAssignments()).users });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
        return true;
      }
      // Rename a domain — cascades: moves every skill + commons concept under it, remaps references.
      if (req.method === 'POST' && url.pathname === '/api/admin/domains/rename') {
        const body = await readJsonBody(req);
        try {
          const result = await renameDomain(body.from, body.to, actorFromReq(req));
          sendJson(res, 200, { ok: true, ...result, domains: await loadDomains() });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
        return true;
      }

      // Move ONE skill to another governed domain (keeps the slug; capsules stay where they are).
      if (req.method === 'POST' && url.pathname === '/api/admin/skills/move') {
        const body = await readJsonBody(req);
        try {
          const result = await moveSkillToDomain(body.id, body.toDomain, actorFromReq(req));
          sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
        return true;
      }
      // Documentation: edit an existing document (git-versioned). Admin gate applied above.
      if (req.method === 'PUT' && url.pathname === '/api/admin/docs/file') {
        const body = await readJsonBody(req, QUEUE_MAX_BODY);
        const rel = safeDocRel(body.path);
        if (!rel) {
          sendJson(res, 400, { ok: false, error: 'Caminho inválido.' });
          return true;
        }
        const target = join(docsRoot, rel);
        if (!(await pathExists(target))) {
          sendJson(res, 404, { ok: false, error: 'Documento não encontrado.' });
          return true;
        }
        const content = String(body.content ?? '');
        if (Buffer.byteLength(content, 'utf8') > 512 * 1024) {
          sendJson(res, 400, { ok: false, error: 'Documento muito grande (máx. 512 KB).' });
          return true;
        }
        await writeFile(target, content, 'utf8');
        const actor = actorFromReq(req);
        await commitRepo(docsRoot, `docs(${rel}): edição por ${actor.name || actor.email || 'curador'}`, actor, [rel]);
        const history = await gitHistoryForPath(docsRoot, rel);
        sendJson(res, 200, { ok: true, path: rel, content, size: Buffer.byteLength(content, 'utf8'), history });
        return true;
      }
      // Documentation: create a new document (git-versioned). Admin gate applied above.
      if (req.method === 'POST' && url.pathname === '/api/admin/docs') {
        const body = await readJsonBody(req, QUEUE_MAX_BODY);
        const rel = safeDocRel(body.path);
        if (!rel) {
          sendJson(res, 400, { ok: false, error: 'Nome de arquivo inválido (use um nome .md simples).' });
          return true;
        }
        const target = join(docsRoot, rel);
        if (await pathExists(target)) {
          sendJson(res, 409, { ok: false, error: 'Já existe um documento com esse nome.' });
          return true;
        }
        const title = String(body.title || rel.replace(/\.md$/i, '')).trim();
        const content = String(body.content != null ? body.content : `# ${title}\n\n`);
        if (Buffer.byteLength(content, 'utf8') > 512 * 1024) {
          sendJson(res, 400, { ok: false, error: 'Documento muito grande (máx. 512 KB).' });
          return true;
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, 'utf8');
        const actor = actorFromReq(req);
        await commitRepo(
          docsRoot,
          `docs(${rel}): novo documento por ${actor.name || actor.email || 'curador'}`,
          actor,
          [rel]
        );
        const history = await gitHistoryForPath(docsRoot, rel);
        sendJson(res, 201, { ok: true, path: rel, content, size: Buffer.byteLength(content, 'utf8'), history });
        return true;
      }
      // Documentation: upload an image into the docs corpus (assets/), git-versioned. Admin gate applied above.
      if (req.method === 'POST' && url.pathname === '/api/admin/docs/asset') {
        const body = await readJsonBody(req, QUEUE_MAX_BODY);
        let base;
        try {
          base = assertSafeUploadName(body && body.filename);
        } catch {
          sendJson(res, 400, { ok: false, error: 'Nome de arquivo inválido.' });
          return true;
        }
        const ext = extname(base).toLowerCase();
        if (!MEDIA_IMG_EXTS.has(ext)) {
          sendJson(res, 400, { ok: false, error: 'Formato não suportado (use PNG, JPG, GIF, WEBP ou BMP).' });
          return true;
        }
        const payload = String((body && body.base64) || '').replace(/^data:[^;,]*;base64,/, '');
        const content = Buffer.from(payload, 'base64');
        if (!content.length) {
          sendJson(res, 400, { ok: false, error: 'Imagem vazia.' });
          return true;
        }
        if (content.length > 8 * 1024 * 1024) {
          sendJson(res, 413, { ok: false, error: 'Imagem muito grande (máx. 8 MB).' });
          return true;
        }
        const assetsDir = join(docsRoot, 'assets');
        await mkdir(assetsDir, { recursive: true });
        const stem = slugifySkillId(base.slice(0, base.length - ext.length)) || 'imagem';
        let name = `${stem}${ext}`;
        for (let n = 2; await pathExists(join(assetsDir, name)); n += 1) {
          name = `${stem}-${n}${ext}`;
        }
        const rel = `assets/${name}`;
        await writeFile(join(docsRoot, rel), content);
        const actor = actorFromReq(req);
        await commitRepo(
          docsRoot,
          `docs(${rel}): imagem enviada por ${actor.name || actor.email || 'curador'}`,
          actor,
          [rel]
        );
        sendJson(res, 201, { ok: true, path: rel, url: `/api/docs/asset?path=${encodeURIComponent(rel)}` });
        return true;
      }
      // Documentação → skill: gera um manifesto balde-capsule/1 (uma cápsula por página + a skill
      // espinha) e o envia para a Fila. Determinístico e idempotente: páginas sem mudança são puladas;
      // aprovação na Fila aplica. Admin gate vem do bloco. Domínio fixo: "balde".
      if (req.method === 'POST' && url.pathname === '/api/admin/docs/publish-skill') {
        const DOCS_SKILL_DOMAIN = 'balde';
        const DOCS_SKILL_ID = `${DOCS_SKILL_DOMAIN}/documentacao`;
        const SKIP_DOCS = new Set(['README.md', 'ai-buddy-prompt.md', 'ai-buddy-exemplos.md']);
        const actor = actorFromReq(req);
        // 1) garante o domínio no vocabulário governado
        const domains = await loadDomains();
        if (!domains.includes(DOCS_SKILL_DOMAIN)) await saveDomains([...domains, DOCS_SKILL_DOMAIN], actor);
        // 2) lê as páginas na ordem das trilhas (a mesma ordenação da TOC)
        const docs = (await listDocs()).filter((d) => !SKIP_DOCS.has(d.path) && !d.path.includes('/'));
        docs.sort((a, b) => {
          const so = (x) => (Number.isFinite(Number(x.sectionOrder)) ? Number(x.sectionOrder) : Infinity);
          const oo = (x) => (Number.isFinite(Number(x.order)) ? Number(x.order) : Infinity);
          return (
            so(a) - so(b) ||
            String(a.section || '').localeCompare(String(b.section || ''), 'pt-BR') ||
            oo(a) - oo(b) ||
            a.title.localeCompare(b.title, 'pt-BR')
          );
        });
        const stripForCapsule = (raw) =>
          String(raw || '')
            .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
            .split('\n')
            .filter((ln) => !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(ln))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        const concepts = [];
        const skipped = [];
        const linksBySection = new Map();
        for (const d of docs) {
          const slug = `doc-${d.path.replace(/\.md$/i, '')}`
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .slice(0, 60);
          const id = `${DOCS_SKILL_DOMAIN}/${slug}`;
          const raw = await readFile(join(docsRoot, d.path), 'utf8');
          const body = stripForCapsule(raw);
          if (!body) {
            skipped.push({ path: d.path, reason: 'vazia' });
            continue;
          }
          if (capsuleOutboundLink(body)) {
            skipped.push({ path: d.path, reason: 'link absoluto no corpo (atomicidade)' });
            continue;
          }
          const section = String(d.section || '').trim() || 'Outros';
          if (!linksBySection.has(section)) linksBySection.set(section, []);
          linksBySection.get(section).push({ id, title: d.title });
          const exists = await pathExists(join(commonsRoot(), id, 'context.md'));
          if (exists) {
            const current = await readFile(join(commonsRoot(), id, 'context.md'), 'utf8');
            if (current.trim() === body.trim()) {
              skipped.push({ path: d.path, reason: 'sem mudanças' });
              continue;
            }
          }
          concepts.push({
            action: exists ? 'update' : 'create',
            id,
            title: d.title,
            summary: `Documentação do Balde — trilha "${section}".`,
            body,
            link: true
          });
        }
        // 3) a skill espinha: prompt curto + o sumário ordenado por trilha
        const spineLines = [];
        for (const [section, items] of linksBySection) {
          spineLines.push(`### ${section}`);
          for (const it of items) spineLines.push(`- [${it.title}](/commons/${it.id})`);
          spineLines.push('');
        }
        const spineBody = [
          '## Papel',
          '',
          'Você é o guia oficial da plataforma Balde de conhecimento. Responde dúvidas sobre conceitos (cápsulas, skills, OKF), governança, avaliação e o uso das telas — sempre com base nas páginas da documentação vinculadas abaixo.',
          '',
          '## Como responder',
          '',
          '- Fundamente cada resposta nas cápsulas vinculadas e cite a página-fonte (ex.: "veja Criação manual — Cápsulas").',
          '- Para instruções de uso, responda em passo a passo, na ordem das telas.',
          '- Se a pergunta for sobre negócio (pricing, vendas, dados), recuse e aponte as skills de negócio do corpus.',
          '',
          '## Regras inegociáveis',
          '',
          '- Não invente telas, campos ou comportamentos que não estejam nas páginas vinculadas.',
          '- Quando a documentação não cobrir a pergunta, diga isso explicitamente e sugira falar com um curador.',
          '',
          '## Cápsulas vinculadas',
          '',
          ...spineLines
        ]
          .join('\n')
          .trim();
        const DOCS_SKILL_EVAL = [
          {
            title: 'Responde citando a página-fonte da documentação',
            prompt:
              'Verifique se a instrução manda fundamentar cada resposta nas cápsulas vinculadas e citar a página da documentação usada como fonte.'
          },
          {
            title: 'Recusa perguntas de negócio (fora do escopo da plataforma)',
            question: 'Qual desconto posso dar num plano frota?',
            expected:
              'Recusa — pergunta de negócio, fora da documentação da plataforma; aponta as skills de negócio do corpus.',
            mustRefuse: true
          },
          {
            title: 'Instrução de uso em passo a passo',
            question: 'Como crio uma cápsula pela interface?',
            expected:
              'Passo a passo do assistente Criar → Cápsula, nas 6 etapas (Geral, context.md, Mídia & dados, Governança, Avaliação, Revisão).'
          }
        ];
        const skillExists = await pathExists(join(skillsRoot(), DOCS_SKILL_ID, 'SKILL.md'));
        let skillChanged = true;
        let evalSeeded = false;
        if (skillExists) {
          const rawSkill = await readFile(join(skillsRoot(), DOCS_SKILL_ID, 'SKILL.md'), 'utf8');
          const fm = rawSkill.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
          skillChanged = rawSkill.slice(fm ? fm[0].length : 0).trim() !== spineBody.trim();
          // Back-fill: a docs skill born before the eval seeding (or wiped) gets the baseline use
          // cases directly — same as the wizard writing the eval right after create; no queue needed.
          try {
            const storedEval = await loadNodeEvalStored('skill', DOCS_SKILL_ID);
            if (!storedEval.items.length) {
              await saveNodeEval('skill', DOCS_SKILL_ID, { items: DOCS_SKILL_EVAL }, actor);
              evalSeeded = true;
            }
          } catch (error) {
            /* best-effort */
          }
        }
        if (!concepts.length && !skillChanged) {
          sendJson(res, 200, {
            ok: true,
            submitted: false,
            unchanged: true,
            evalSeeded,
            skipped,
            plan: [],
            warnings: []
          });
          return true;
        }
        const manifest = {
          format: CAPSULE_FORMAT,
          title: `Documentação → skill (${concepts.length} página(s) ${skillExists ? 'sincronizada(s)' : 'convertida(s)'})`,
          skill: skillExists
            ? { action: 'update', id: DOCS_SKILL_ID, body: spineBody }
            : {
                action: 'create',
                domain: DOCS_SKILL_DOMAIN,
                slug: 'documentacao',
                title: 'Documentação do Balde',
                description: 'A documentação oficial da plataforma como skill — uma cápsula por página.',
                objetivo:
                  'Responder dúvidas sobre a plataforma Balde — conceitos, governança, avaliação e uso das telas — com base na documentação oficial.',
                escopo:
                  'Responde apenas sobre o funcionamento e os conceitos da plataforma Balde, citando a página-fonte. Não responde perguntas de negócio; recusa e aponta a documentação quando a resposta não estiver nas páginas vinculadas.',
                body: spineBody,
                owner: actor.email || '',
                evalCriteria: DOCS_SKILL_EVAL
              },
          concepts
        };
        const compiled = await compileCapsule(manifest);
        if (!compiled.ok) {
          sendJson(res, 200, {
            ok: false,
            submitted: false,
            errors: compiled.errors,
            warnings: compiled.warnings,
            skipped,
            plan: []
          });
          return true;
        }
        const item = await createCapsuleQueueItem(manifest, compiled, {
          source: 'web',
          submittedBy: { name: actor.name, email: actor.email }
        });
        sendJson(res, 201, {
          ok: true,
          submitted: true,
          queueId: item.id,
          plan: compiled.plan,
          warnings: compiled.warnings,
          skipped,
          concepts: concepts.length,
          skillAction: manifest.skill.action,
          evalSeeded
        });
        return true;
      }
      sendJson(res, 404, { ok: false, error: 'Rota admin desconhecida.' });
      return true;
    }
    return false;
  };
}
