import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { parseFrontmatter, assertSafeSkillId, upsertFrontmatter } from '../skill-format.mjs';
import {
  skillsRoot,
  feedbackRoot,
  usersRoot,
  plenariasRoot,
  queueRoot,
  baldeFeedback,
  feedbackDirOf,
  usageRoot,
  commonsRoot,
  activeRepo
} from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';

export function createDomainMovesFeature({
  normalizeDomainServer,
  loadDomains,
  listSkillIds,
  listCommonsConcepts,
  commonsHasConcept,
  saveDomains,
  commitCorpus,
  commitRepo,
  markCorpusGraphDirty
}) {
  async function remapSkillIdsInJsonArrays(dir, field, idMap, nested) {
    let top = [];
    try {
      top = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      return;
    }
    const files = [];
    if (nested) {
      // usersRoot/<user>/chats/*.json
      for (const u of top) {
        if (!u.isDirectory()) continue;
        const cd = join(dir, u.name, 'chats');
        try {
          for (const c of await readdir(cd, { withFileTypes: true }))
            if (c.isFile() && c.name.endsWith('.json')) files.push(join(cd, c.name));
        } catch (error) {
          /* no chats */
        }
      }
    } else {
      for (const f of top) if (f.isFile() && f.name.endsWith('.json')) files.push(join(dir, f.name));
    }
    for (const fp of files) {
      let j;
      try {
        j = JSON.parse(await readFile(fp, 'utf8'));
      } catch (error) {
        continue;
      }
      if (j && Array.isArray(j[field]) && j[field].some((x) => idMap.has(String(x)))) {
        j[field] = j[field].map((x) => idMap.get(String(x)) || x);
        await writeFile(fp, JSON.stringify(j, null, 2), 'utf8');
      }
    }
  }
  async function remapJsonlField(dir, field, idMap) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      return;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const fp = join(dir, e.name);
      let changed = false;
      const lines = (await readFile(fp, 'utf8').catch(() => '')).split('\n').map((ln) => {
        if (!ln.trim()) return ln;
        try {
          const o = JSON.parse(ln);
          if (o && idMap.has(String(o[field]))) {
            o[field] = idMap.get(String(o[field]));
            changed = true;
            return JSON.stringify(o);
          }
        } catch (error) {
          /* keep line */
        }
        return ln;
      });
      if (changed) await writeFile(fp, lines.join('\n'), 'utf8');
    }
  }
  async function rewriteDomainLinksInTree(root, from, to) {
    const changed = [];
    const walk = async (dir) => {
      let entries = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (['.git', '.balde', 'canonico', 'legado', 'logs'].includes(e.name)) continue;
          await walk(full);
        } else if (/\.md$/i.test(e.name)) {
          const t = await readFile(full, 'utf8').catch(() => '');
          if (!t || !t.includes(`/${from}/`)) continue;
          await writeFile(full, t.split(`/${from}/`).join(`/${to}/`), 'utf8');
          changed.push(relative(root, full).replaceAll('\\', '/'));
        }
      }
    };
    await walk(root);
    return changed;
  }
  async function renameDomain(fromRaw, toRaw, actor) {
    const from = normalizeDomainServer(fromRaw);
    const to = normalizeDomainServer(toRaw);
    if (!from || !to) throw new Error('Informe o domínio atual e o novo nome.');
    if (from === to) throw new Error('O novo nome é igual ao atual.');
    const vocab = await loadDomains();
    if (!vocab.includes(from)) throw new Error(`Domínio "${from}" não existe.`);

    const skills = (await listSkillIds()).filter((id) => id.startsWith(`${from}/`));
    const concepts = (await listCommonsConcepts()).filter((id) => id.startsWith(`${from}/`));

    // Conflict check BEFORE moving anything (no partial rename).
    for (const id of skills) {
      const tgt = `${to}/${id.slice(from.length + 1)}`;
      if (await pathExists(join(skillsRoot(), tgt, 'SKILL.md')))
        throw new Error(`Conflito: já existe a skill "${tgt}".`);
    }
    for (const id of concepts) {
      const tgt = `${to}/${id.slice(from.length + 1)}`;
      if (await commonsHasConcept(tgt)) throw new Error(`Conflito: já existe o conceito "${tgt}".`);
    }

    // Move skill + commons folders into <to>/ (the emptied <from>/ dir is left behind — harmless).
    if (skills.length) {
      for (const id of skills) {
        const dest = join(skillsRoot(), to, id.slice(from.length + 1));
        await mkdir(dirname(dest), { recursive: true }); // deep skills (<from>/sub/…/slug) need the full parent chain
        await rename(join(skillsRoot(), id), dest);
      }
    }
    if (concepts.length) {
      for (const id of concepts) {
        const dest = join(commonsRoot(), to, id.slice(from.length + 1));
        await mkdir(dirname(dest), { recursive: true });
        await rename(join(commonsRoot(), id), dest);
      }
    }

    // Remap references that point at moved SKILL ids.
    const idMap = new Map(skills.map((id) => [id, `${to}/${id.slice(from.length + 1)}`]));
    if (idMap.size) {
      await remapSkillIdsInJsonArrays(usersRoot, 'skillIds', idMap, true); // chats (per-user)
      await remapSkillIdsInJsonArrays(plenariasRoot, 'skillIds', idMap, false); // plenárias
      await remapJsonlField(usageRoot, 'skill', idMap); // usage events
      try {
        await rm(join(usageRoot, 'rollup.json'), { force: true });
      } catch (error) {
        /* rebuilds */
      }
      await remapJsonlField(feedbackRoot, 'skillId', idMap); // feedback
      if (baldeFeedback) await remapJsonlField(feedbackDirOf(activeRepo()), 'skillId', idMap); // the balde's own feedback (local)
    }
    // Rewrite `/from/` content links across skills + commons.
    const skillLinks = await rewriteDomainLinksInTree(skillsRoot(), from, to);
    const commonsLinks = await rewriteDomainLinksInTree(commonsRoot(), from, to);
    const linkFiles = skillLinks.length + commonsLinks.length;
    await remapQueuePendingSkillIds(idMap);

    // Update the vocabulary + commit both repos.
    await saveDomains([...vocab.filter((d) => d !== from), to], actor);
    await commitCorpus(`domain: renomeia ${from} → ${to} (${skills.length} skill(s), ${linkFiles} link(s))`, actor, [
      from,
      to,
      '_domains.json',
      ...skillLinks
    ]);
    if (concepts.length || commonsLinks.length)
      await commitRepo(commonsRoot(), `domain: renomeia ${from} → ${to} (${concepts.length} conceito(s))`, actor, [
        from,
        to,
        ...commonsLinks
      ]);

    return { from, to, skills: skills.length, concepts: concepts.length, linkFiles };
  }

  // Rewrite links that point at ONE skill id (`/<old-id>/…`) across a corpus tree. Same idea as
  // rewriteDomainLinksInTree, but keyed on the full id — used when a single skill changes domain.
  async function rewriteSkillIdLinksInTree(root, from, to) {
    const changed = [];
    const walk = async (dir) => {
      let entries = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (['.git', '.balde', 'canonico', 'legado', 'logs'].includes(e.name)) continue;
          await walk(full);
        } else if (/\.md$/i.test(e.name)) {
          const t = await readFile(full, 'utf8').catch(() => '');
          if (!t || !t.includes(`/${from}/`)) continue;
          await writeFile(full, t.split(`/${from}/`).join(`/${to}/`), 'utf8');
          changed.push(relative(root, full).replaceAll('\\', '/'));
        }
      }
    };
    await walk(root);
    return changed;
  }

  // Queue items carry the anchor skill id (item.skillId + the capsule manifest's skill.id). Only
  // PENDING items are remapped: an item already aprovado/recusado is an audit record of what was
  // submitted at the time and must keep the id as it was. A pending item left stale would fail on
  // approval ("skill-inexistente") since the manifest is recompiled against the current corpus.
  async function remapQueuePendingSkillIds(idMap) {
    let n = 0;
    let entries = [];
    try {
      entries = await readdir(queueRoot(), { withFileTypes: true });
    } catch (error) {
      return 0;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const fp = join(queueRoot(), e.name, 'item.json');
      let item;
      try {
        item = JSON.parse(await readFile(fp, 'utf8'));
      } catch (error) {
        continue;
      }
      if (!item || item.status !== 'pendente') continue;
      let changed = false;
      for (const field of ['skillId', 'originalSkillId']) {
        if (idMap.has(String(item[field]))) {
          item[field] = idMap.get(String(item[field]));
          changed = true;
        }
      }
      const mSkill = item.capsule && item.capsule.manifest && item.capsule.manifest.skill;
      if (mSkill && idMap.has(String(mSkill.id))) {
        mSkill.id = idMap.get(String(mSkill.id));
        changed = true;
      }
      if (changed) {
        await writeFile(fp, JSON.stringify(item, null, 2), 'utf8');
        n += 1;
      }
    }
    return n;
  }

  // Move ONE skill to another governed domain, keeping its slug — the per-skill counterpart of
  // renameDomain. Capsules are NOT touched (they live in the commons and are addressed by their own
  // ids), so a domain can legitimately end up holding only capsules. Everything that references the
  // skill id is remapped: chats, plenárias, usage events, feedback, content links across the corpus,
  // and the skill's own governance ledger. NOTE: the id is the public address — machine consumers
  // (/api/v1/skills/<id>, MCP) pointing at the old id will 404 after the move.
  async function moveSkillToDomain(idRaw, toDomainRaw, actor) {
    const id = String(idRaw || '')
      .trim()
      .replace(/^\/+|\/+$/g, '');
    const toDomain = normalizeDomainServer(toDomainRaw);
    assertSafeSkillId(id);
    if (!toDomain) throw new Error('Informe o domínio de destino.');
    const vocab = await loadDomains();
    if (!vocab.includes(toDomain)) throw new Error(`Domínio "${toDomain}" não está no vocabulário governado.`);
    const parts = id.split('/');
    if (parts.length < 2) throw new Error('Skill sem domínio (formato legado) — não é possível mover.');
    if (parts[0] === toDomain) throw new Error('A skill já está nesse domínio.');
    const to = [toDomain, ...parts.slice(1)].join('/');
    if (!(await pathExists(join(skillsRoot(), id, 'SKILL.md')))) throw new Error(`Skill "${id}" não encontrada.`);
    if (await pathExists(join(skillsRoot(), to, 'SKILL.md'))) throw new Error(`Conflito: já existe a skill "${to}".`);

    const dest = join(skillsRoot(), to);
    await mkdir(dirname(dest), { recursive: true });
    await rename(join(skillsRoot(), id), dest);

    // Runtime references (same set renameDomain remaps).
    const idMap = new Map([[id, to]]);
    await remapSkillIdsInJsonArrays(usersRoot, 'skillIds', idMap, true); // chats (per-user)
    await remapSkillIdsInJsonArrays(plenariasRoot, 'skillIds', idMap, false); // plenárias
    await remapJsonlField(usageRoot, 'skill', idMap); // usage events
    try {
      await rm(join(usageRoot, 'rollup.json'), { force: true });
    } catch (error) {
      /* rebuilds */
    }
    await remapJsonlField(feedbackRoot, 'skillId', idMap); // feedback
    if (baldeFeedback) await remapJsonlField(feedbackDirOf(activeRepo()), 'skillId', idMap); // the balde's own feedback (local)
    const queueItems = await remapQueuePendingSkillIds(idMap); // itens da fila PENDENTES

    // Content links elsewhere in the corpus + the skill's own ledger.
    const skillLinks = await rewriteSkillIdLinksInTree(skillsRoot(), id, to);
    const commonsLinks = await rewriteSkillIdLinksInTree(commonsRoot(), id, to);
    const linkFiles = skillLinks.length + commonsLinks.length;
    const ledgerFiles = 0; // IDs históricos e hashes publicados descrevem o estado original.

    // Keep the (optional, legacy) frontmatter `domain:` consistent with the new folder.
    try {
      const p = join(dest, 'SKILL.md');
      const md = await readFile(p, 'utf8');
      if (parseFrontmatter(md).meta.domain) {
        await writeFile(p, upsertFrontmatter(md, { domain: toDomain }), 'utf8');
      }
    } catch (error) {
      /* frontmatter opcional */
    }

    await commitCorpus(`skill(${id}): movida para ${to}`, actor, [id, to, ...skillLinks]);
    if (commonsLinks.length)
      await commitRepo(commonsRoot(), `links: skill movida de ${id} para ${to}`, actor, commonsLinks);
    markCorpusGraphDirty();
    return { from: id, to, linkFiles, ledgerFiles, queueItems };
  }

  return { renameDomain, moveSkillToDomain };
}
