import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSafeSkillId, slugifySkillId } from '../skill-format.mjs';
import { buddiesRoot, BUDDY_POSES, BUDDY_POSE_EXTS, BUDDY_POSE_MAX_BYTES } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { actorFromReq } from '../git-corpus.mjs';
import {
  commitBuddies,
  loadBuddyPoses,
  loadBuddy,
  listBuddies,
  toBuddySummary,
  skillsUsingBuddy,
  safeTheme,
  safeThemeOverride,
  loadGlobalTheme,
  listAllThemes
} from '../buddies.mjs';

export function createBuddiesRoutes({ sendJson, canCreateBuddyReq, isAdminReq, readJsonBody }) {
  return async function buddiesRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/buddies') {
      const buddies = await listBuddies();
      sendJson(res, 200, {
        ok: true,
        count: buddies.length,
        canCreateBuddy: canCreateBuddyReq(req),
        isAdmin: isAdminReq(req),
        globalTheme: await loadGlobalTheme(),
        themes: await listAllThemes(),
        buddies: buddies.map(toBuddySummary)
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/buddies/new') {
      if (!canCreateBuddyReq(req)) {
        sendJson(res, 403, {
          ok: false,
          error: 'Sem permissao para criar buddies. Requer o grupo de autores de buddy no Authentik.'
        });
        return true;
      }
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim();
      if (!name) {
        sendJson(res, 400, { ok: false, error: 'Informe um nome para o buddy.' });
        return true;
      }
      const id = slugifySkillId(body.id || name);
      if (!id) {
        sendJson(res, 400, { ok: false, error: 'Nao foi possivel derivar um id/slug do nome.' });
        return true;
      }
      const dir = join(buddiesRoot, id);
      if ((await pathExists(join(dir, 'buddy.json'))) || (await pathExists(join(dir, 'poses')))) {
        sendJson(res, 409, { ok: false, error: `Ja existe um buddy com id "${id}".` });
        return true;
      }

      // Validate + decode every pose BEFORE writing anything (strict vocab).
      const decoded = [];
      try {
        for (const pose of Array.isArray(body.poses) ? body.poses : []) {
          const code = String((pose && pose.code) || '')
            .toLowerCase()
            .trim();
          if (!BUDDY_POSES.includes(code)) {
            throw new Error(`Pose invalida: "${code}". Use apenas: ${BUDDY_POSES.join(', ')}.`);
          }
          if (decoded.some((item) => item.code === code)) {
            throw new Error(`Pose duplicada: ${code}.`);
          }
          let ext = String((pose && pose.ext) || '').toLowerCase();
          if (ext && !ext.startsWith('.')) {
            ext = '.' + ext;
          }
          if (!BUDDY_POSE_EXTS.includes(ext)) {
            ext = '.png';
          }
          const payload = String((pose && pose.base64) || '');
          if (!payload) {
            throw new Error(`Pose sem conteudo: ${code}`);
          }
          const content = Buffer.from(payload, 'base64');
          if (content.length > BUDDY_POSE_MAX_BYTES) {
            throw new Error(`Pose "${code}" excede ${Math.round(BUDDY_POSE_MAX_BYTES / 1024)} KB.`);
          }
          decoded.push({ code, ext, content });
        }
      } catch (poseError) {
        sendJson(res, 400, { ok: false, error: poseError.message || 'Pose invalida.' });
        return true;
      }
      if (!decoded.length) {
        sendJson(res, 400, { ok: false, error: 'Envie ao menos uma imagem de pose (ex.: idle.png).' });
        return true;
      }

      const actor = actorFromReq(req);
      let defaultPose = String(body.default_pose || '')
        .toLowerCase()
        .trim();
      if (!BUDDY_POSES.includes(defaultPose) || !decoded.some((item) => item.code === defaultPose)) {
        defaultPose = decoded.some((item) => item.code === 'idle') ? 'idle' : decoded[0].code;
      }
      const poseSub = safeTheme(body.poseTheme) ? 'poses.' + safeTheme(body.poseTheme) : 'poses';
      const manifest = {
        Id: id,
        Name: name,
        Description: String(body.description || '').trim(),
        default_pose: defaultPose,
        temperament: String(body.temperament || '').trim(),
        group: String(body.group || 'Geral').trim() || 'Geral'
      };
      if (safeThemeOverride(body.theme)) {
        manifest.theme = safeThemeOverride(body.theme);
      }
      const createThemes = {};
      if (body.themeTemperaments && typeof body.themeTemperaments === 'object') {
        for (const [k, v] of Object.entries(body.themeTemperaments)) {
          const t = safeTheme(k);
          const tv = String(v || '').trim();
          if (t && tv) {
            createThemes[t] = { temperament: tv };
          }
        }
      }
      if (Object.keys(createThemes).length) {
        manifest.themes = createThemes;
      }

      await mkdir(join(dir, poseSub), { recursive: true });
      await writeFile(join(dir, 'buddy.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      for (const pose of decoded) {
        await writeFile(join(dir, poseSub, pose.code + pose.ext), pose.content);
      }
      await commitBuddies(`buddy(${id}): novo buddy por ${actor.name}`, actor, [id]);
      sendJson(res, 200, { ok: true, id, name, poses: decoded.map((item) => item.code) });
      return true;
    }

    {
      const editMatch = url.pathname.match(/^\/api\/buddies\/([^/]+)\/?$/);
      if (
        (req.method === 'PUT' || req.method === 'DELETE') &&
        editMatch &&
        decodeURIComponent(editMatch[1]) !== 'new'
      ) {
        if (!canCreateBuddyReq(req)) {
          sendJson(res, 403, {
            ok: false,
            error: 'Sem permissao para editar buddies. Requer o grupo de autores de buddy no Authentik.'
          });
          return true;
        }
        const id = decodeURIComponent(editMatch[1]);
        if (!isSafeSkillId(id)) {
          sendJson(res, 400, { ok: false, error: 'buddy id invalido.' });
          return true;
        }
        const dir = join(buddiesRoot, id);
        if (!(await pathExists(dir))) {
          sendJson(res, 404, { ok: false, error: `Buddy "${id}" nao encontrado.` });
          return true;
        }
        const actor = actorFromReq(req);

        if (req.method === 'DELETE') {
          const staleSkills = await skillsUsingBuddy(id);
          await rm(dir, { recursive: true, force: true });
          await commitBuddies(`buddy(${id}): removido por ${actor.name}`, actor, [id]);
          sendJson(res, 200, { ok: true, id, staleSkills });
          return true;
        }

        // PUT: edit manifest + add/replace/remove individual poses.
        const existing = await loadBuddy(id);
        const body = await readJsonBody(req);
        const decoded = [];
        try {
          for (const pose of Array.isArray(body.poses) ? body.poses : []) {
            const code = String((pose && pose.code) || '')
              .toLowerCase()
              .trim();
            if (!BUDDY_POSES.includes(code)) {
              throw new Error(`Pose invalida: "${code}".`);
            }
            if (decoded.some((item) => item.code === code)) {
              throw new Error(`Pose duplicada: ${code}.`);
            }
            let ext = String((pose && pose.ext) || '').toLowerCase();
            if (ext && !ext.startsWith('.')) {
              ext = '.' + ext;
            }
            if (!BUDDY_POSE_EXTS.includes(ext)) {
              ext = '.png';
            }
            const content = Buffer.from(String((pose && pose.base64) || ''), 'base64');
            if (!content.length) {
              throw new Error(`Pose sem conteudo: ${code}`);
            }
            if (content.length > BUDDY_POSE_MAX_BYTES) {
              throw new Error(`Pose "${code}" excede ${Math.round(BUDDY_POSE_MAX_BYTES / 1024)} KB.`);
            }
            decoded.push({ code, ext, content });
          }
        } catch (poseError) {
          sendJson(res, 400, { ok: false, error: poseError.message || 'Pose invalida.' });
          return true;
        }
        const removeCodes = (Array.isArray(body.removePoses) ? body.removePoses : [])
          .map((code) => String(code).toLowerCase().trim())
          .filter((code) => BUDDY_POSES.includes(code));

        // Poses are written into the theme's folder (poseTheme), default regular `poses/`.
        const posesDir = join(dir, safeTheme(body.poseTheme) ? 'poses.' + safeTheme(body.poseTheme) : 'poses');
        await mkdir(posesDir, { recursive: true });
        // remove requested poses (every extension variant)
        for (const code of removeCodes) {
          for (const ext of BUDDY_POSE_EXTS) {
            const candidate = join(posesDir, code + ext);
            if (await pathExists(candidate)) {
              await rm(candidate, { force: true });
            }
          }
        }
        // write new/replaced poses (drop any other-extension variant of the same code first)
        for (const pose of decoded) {
          for (const ext of BUDDY_POSE_EXTS) {
            if (ext === pose.ext) {
              continue;
            }
            const variant = join(posesDir, pose.code + ext);
            if (await pathExists(variant)) {
              await rm(variant, { force: true });
            }
          }
          await writeFile(join(posesDir, pose.code + pose.ext), pose.content);
        }

        const name = body.name !== undefined && body.name !== null ? String(body.name).trim() : existing.name;
        const description =
          body.description !== undefined && body.description !== null
            ? String(body.description).trim()
            : existing.description;
        // base (regular) temperament — fall back to existing BASE, not the effective one.
        const temperament =
          body.temperament !== undefined && body.temperament !== null
            ? String(body.temperament).trim()
            : existing.baseTemperament || '';
        const group =
          body.group !== undefined && body.group !== null
            ? String(body.group).trim() || 'Geral'
            : existing.group || 'Geral';
        const themeOverride =
          body.theme !== undefined && body.theme !== null ? safeThemeOverride(body.theme) : existing.theme || '';
        // per-theme temperaments: existing map + body updates ('' clears a theme).
        const themesMap = {};
        for (const [k, v] of Object.entries(existing.themeTemperaments || {})) {
          if (v) {
            themesMap[k] = { temperament: v };
          }
        }
        if (body.themeTemperaments && typeof body.themeTemperaments === 'object') {
          for (const [k, v] of Object.entries(body.themeTemperaments)) {
            const t = safeTheme(k);
            if (!t) {
              continue;
            }
            const tv = String(v || '').trim();
            if (tv) {
              themesMap[t] = { temperament: tv };
            } else {
              delete themesMap[t];
            }
          }
        }
        const finalPoses = await loadBuddyPoses(id);
        let defaultPose = String(body.default_pose || existing.default_pose || '')
          .toLowerCase()
          .trim();
        if (!finalPoses.some((pose) => pose.code === defaultPose)) {
          defaultPose = finalPoses.some((pose) => pose.code === 'idle')
            ? 'idle'
            : finalPoses[0]
              ? finalPoses[0].code
              : 'idle';
        }
        const manifest = {
          Id: id,
          Name: name || id,
          Description: description,
          default_pose: defaultPose,
          temperament,
          group
        };
        if (themeOverride) {
          manifest.theme = themeOverride;
        }
        if (Object.keys(themesMap).length) {
          manifest.themes = themesMap;
        }
        await writeFile(join(dir, 'buddy.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
        await commitBuddies(`buddy(${id}): edicao por ${actor.name}`, actor, [id]);
        const updated = await loadBuddy(id);
        sendJson(res, 200, { ok: true, id, name: updated.name, poses: updated.poses.map((pose) => pose.code) });
        return true;
      }
    }
    return false;
  };
}
