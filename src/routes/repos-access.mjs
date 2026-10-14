import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { activeRepo, runWithRepo, userConfigPath } from '../config.mjs';
import {
  repoByName,
  isRepoMember,
  isRepoCurator,
  isRepoOwner,
  isRepoAdmin,
  normalizeAccess,
  reposForActor,
  createRepo,
  updateRepo,
  mountsEnabled,
  listMountStatus,
  mountRepo,
  unmountRepo,
  createRepoAt
} from '../repos.mjs';

export function createReposAccessRoutes({
  reqGroups,
  webActor,
  permissionsFor,
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
}) {
  return async function reposAccessRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/repos') {
      const groups = reqGroups(req);
      const email = webActor(req).email;
      const mine = await reposForActor(groups, email);
      // OneDrive access applier: local version, script present in this release
      const applier = mountsEnabled() && (await acessoApplierAvailable());
      const repos = await Promise.all(
        mine.map(async (r) => {
          const admin = isRepoAdmin(r, groups, email);
          return {
            name: r.name,
            titulo: r.titulo,
            profile: r.profile,
            source: r.source,
            open: r.access.open,
            canCurate: isRepoCurator(r, groups, email),
            isOwner: isRepoOwner(r, email), // listed as an owner (the role shown)
            isAdmin: admin, // administers it: owners and its admin groups
            // the folder, the full access list and whether it sits on OneDrive only for its admins
            ...(admin
              ? {
                  dir: r.dir,
                  access: r.access,
                  oneDrive: applier ? await isOnOneDrive(r.dir) : false,
                  groups: r.groups,
                  members: r.members
                }
              : {})
          };
        })
      );
      sendJson(res, 200, {
        ok: true,
        active: activeRepo(),
        org: process.env.BALDE_ORG_NAME || '',
        aiMode: AI_MODE,
        readonlyCorpus: READONLY_CORPUS,
        mountsEnabled: mountsEnabled(),
        acessoApplier: applier,
        repos
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/repos/mounts') {
      sendJson(res, 200, {
        ok: true,
        enabled: mountsEnabled(),
        configPath: userConfigPath,
        mounts: mountsEnabled() ? await listMountStatus() : []
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/repos/mount') {
      const body = await readJsonBody(req);
      const me = webActor(req);
      try {
        const entry = await mountRepo({ folder: body.path, name: body.name, titulo: body.titulo, owner: me.email });
        if (entry && isRepoOwner(entry, me.email)) {
          await runWithRepo(entry.name, async () => {
            await ensureCommons();
            await ensureDomainsSeed();
          });
        }
        sendJson(res, 200, {
          ok: true,
          repo: entry ? { name: entry.name, titulo: entry.titulo, profile: entry.profile, source: entry.source } : null
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/repos/unmount') {
      const body = await readJsonBody(req);
      try {
        sendJson(res, 200, { ok: true, ...(await unmountRepo({ folder: body.path, name: body.name })) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/repos/create') {
      const body = await readJsonBody(req);
      const me = webActor(req);
      if (!me.email) {
        sendJson(res, 400, { ok: false, error: 'Identidade do usuário não disponível.' });
        return true;
      }
      try {
        const entry = await createRepoAt({
          folder: body.path,
          name: body.name,
          titulo: body.titulo,
          profile: body.profile,
          owner: me.email
        });
        await runWithRepo(entry.name, async () => {
          await ensureCommons();
          await ensureDomainsSeed();
        });
        sendJson(res, 200, {
          ok: true,
          repo: { name: entry.name, titulo: entry.titulo, profile: entry.profile, source: entry.source, dir: entry.dir }
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/repos') {
      if (!isAdminReq(req)) {
        sendJson(res, 403, { ok: false, error: 'Apenas admins criam repos.' });
        return true;
      }
      const body = await readJsonBody(req);
      try {
        const entry = await createRepo({
          name: body.name,
          titulo: body.titulo,
          groups: body.groups,
          members: body.members,
          profile: body.profile
        });
        // Seed the new repo's corpus scaffolding (commons README, domains vocabulary) in ITS context.
        await runWithRepo(entry.name, async () => {
          await ensureCommons();
          await ensureDomainsSeed();
        });
        sendJson(res, 200, { ok: true, repo: entry });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    const acessoRoute = url.pathname.match(/^\/api\/repos\/([^/]+)\/acesso\/(plano|verificar|resultado)$/);
    if (acessoRoute) {
      const entry = await repoByName(decodeURIComponent(acessoRoute[1]).trim().toLowerCase());
      const action = acessoRoute[2];
      const me = String(webActor(req).email || '')
        .trim()
        .toLowerCase();
      if (!entry || !isRepoAdmin(entry, reqGroups(req), me)) {
        sendJson(res, 403, { ok: false, error: 'Só os admins do balde aplicam o acesso no OneDrive.' });
        return true;
      }
      const dir = acessoRuntimeDir(entry.name);
      if (!dir || !(await acessoApplierAvailable())) {
        sendJson(res, 400, {
          ok: false,
          error: 'O aplicador de acesso do OneDrive não está disponível nesta instalação.'
        });
        return true;
      }
      if (action === 'resultado') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'Use GET.' });
          return true;
        }
        const id = String(url.searchParams.get('id') || '');
        if (!ACESSO_ID_RE.test(id)) {
          sendJson(res, 400, { ok: false, error: 'id inválido.' });
          return true;
        }
        let result = null;
        try {
          result = JSON.parse(
            await readFile(join(dir, id.startsWith('p-') ? `recibo-${id}.json` : `verificar-${id}.json`), 'utf8')
          );
        } catch {
          result = null;
        }
        sendJson(res, 200, { ok: true, pending: !result, result });
        return true;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'Use POST.' });
        return true;
      }
      if (!(await isOnOneDrive(entry.dir))) {
        sendJson(res, 400, {
          ok: false,
          error: 'A pasta deste balde não está no OneDrive: o acesso dela vale só dentro do Balde.'
        });
        return true;
      }
      await mkdir(dir, { recursive: true });
      const rand = randomBytes(3).toString('hex');
      if (action === 'verificar') {
        const id = `v-${acessoStamp()}-${rand}`;
        sendJson(res, 200, {
          ok: true,
          id,
          command: acessoCommand(`-Out "${join(dir, `verificar-${id}.json`)}" "${entry.dir}"`)
        });
        return true;
      }
      const body = await readJsonBody(req);
      const id = `p-${acessoStamp()}-${rand}`;
      const lists = await acessoPlanLists(entry.access);
      const plan = {
        format: 'balde-acesso-plano/1',
        id,
        balde: entry.name,
        folder: entry.dir,
        open: entry.access.open === true,
        write: lists.write,
        read: lists.read,
        owners: lists.owners,
        unresolvedGroups: lists.unresolvedGroups,
        notify: body.notify === true,
        message: String(body.message || '').slice(0, 2000),
        receipt: join(dir, `recibo-${id}.json`),
        ledger: '',
        createdAt: new Date().toISOString(),
        createdBy: me
      };
      const planPath = join(dir, `plano-${id}.json`);
      await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
      sendJson(res, 200, { ok: true, id, plan, command: acessoCommand(`-Plano "${planPath}"`) });
      return true;
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/api/repos/')) {
      const name = decodeURIComponent(url.pathname.slice('/api/repos/'.length)).trim().toLowerCase();
      const groups = reqGroups(req);
      const me = String(webActor(req).email || '')
        .trim()
        .toLowerCase();
      const entry = await repoByName(name);
      // O título, a governança e o acesso são do criador do balde (D1), com a pasta dele gravável aqui.
      const decision = entry ? (await permissionsFor(webActor(req), name)).administrar : null;
      if (!decision || !decision.ok) {
        sendJson(res, 403, {
          ok: false,
          error: (decision && decision.reason) || 'Só os admins do balde (o dono, por padrão) editam o balde.'
        });
        return true;
      }
      const body = await readJsonBody(req);
      // an admin cannot take themselves out of the balde's admins and lock it out (nobody above them)
      if (
        body.access &&
        typeof body.access === 'object' &&
        !isRepoAdmin({ access: normalizeAccess({ ...entry.access, ...body.access }) }, groups, me)
      ) {
        sendJson(res, 400, {
          ok: false,
          error: 'Você deixaria de administrar este balde: mantenha-se entre os donos ou num grupo de admins dele.'
        });
        return true;
      }
      try {
        const updated = await updateRepo(name, {
          titulo: body.titulo,
          profile: body.profile,
          access: body.access,
          groups: body.groups,
          members: body.members
        });
        sendJson(res, 200, { ok: true, repo: updated });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/repos/personal') {
      const me = webActor(req);
      if (!me.email) {
        sendJson(res, 400, { ok: false, error: 'Identidade do usuário não disponível.' });
        return true;
      }
      const slug = personalRepoSlug(me.email);
      try {
        let entry = await repoByName(slug);
        if (!entry) {
          entry = await createRepo({ name: slug, titulo: 'Meu Balde', members: [me.email], profile: 'light' });
          await runWithRepo(entry.name, async () => {
            await ensureCommons();
            await ensureDomainsSeed();
          });
        } else if (!isRepoMember(entry, me.groups || [], me.email)) {
          sendJson(res, 409, { ok: false, error: `O repo "${slug}" já existe e não é seu.` });
          return true;
        }
        sendJson(res, 200, { ok: true, repo: { name: entry.name, titulo: entry.titulo, profile: entry.profile } });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }
    return false;
  };
}
