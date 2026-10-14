import { importSubmission, importFeedbackEvent } from '../governance/exchange.mjs';
import { localIdentity, localGroups } from '../security/local-session.mjs';
import { access, constants as fsConstants, cp, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  queueRoot,
  outboxRoot,
  legacyCentralQueueRoot,
  exchangeRoot,
  feedbackDirOf,
  repoDirOf,
  repoSkillsRoot,
  activeRepo,
  runWithRepo,
  DEFAULT_REPO,
  localRepos
} from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { flushPendingCommits } from '../git-corpus.mjs';
import { listRepos, repoByName, isRepoCurator } from '../repos.mjs';

export function createExchangeFeature({ corpusGroupsForEmail, canReadSkillActor }) {
  const EXCHANGE_ROOT = process.env.EXCHANGE_ROOT || '';
  const IMPORT_GRACE_MS = Number(process.env.BALDE_IMPORT_GRACE_MS || 4 * 60_000);
  const QUEUE_TICK_MS = Number(process.env.BALDE_QUEUE_TICK_MS || 60_000); // import + watcher cadence
  // do Windows (fila do curador). Só ações de OUTRAS pessoas — as próprias não notificam.
  const localNotices = [];
  const localNoticeState = { seq: 0 };
  function pushLocalNotice(title, body, actorEmail) {
    const self = String(process.env.DEV_FAKE_EMAIL || '')
      .trim()
      .toLowerCase();
    const who = String(actorEmail || '')
      .trim()
      .toLowerCase();
    if (self && who && who === self) return;
    localNoticeState.seq += 1;
    localNotices.push({
      id: localNoticeState.seq,
      at: new Date().toISOString(),
      title: String(title || '').slice(0, 60),
      body: String(body || '').slice(0, 180)
    });
    if (localNotices.length > 50) localNotices.shift();
  }

  // The person this local install runs as: balde-local is single-user (the app and the machine key
  // both resolve to it). Groups come from the corpus group files, like every request's.
  function localActor() {
    return { ...localIdentity(), groups: localGroups(corpusGroupsForEmail) };
  }
  async function localUserCurates(repo) {
    const me = localActor();
    if (!me.email) return false;
    let entry = null;
    try {
      entry = await repoByName(repo);
    } catch (error) {
      entry = null;
    }
    return isRepoCurator(entry, me.groups, me.email);
  }

  // Can THIS machine write the balde's folder? OneDrive marks every file of a folder the user may only
  // read as read-only on disk, so the balde's manifest is the probe: without it, a curator lacking edit
  // rights would approve into a local copy that never uploads. A balde without a manifest is left to
  // the file system. Cached for a minute, so a grant made on OneDrive shows up quickly.
  const baldeWritableCache = new Map();
  async function baldeWritable(repo) {
    const hit = baldeWritableCache.get(repo);
    if (hit && Date.now() - hit.at < 60_000) return hit.ok;
    let ok = true;
    try {
      await access(join(repoDirOf(repo), 'balde-repo.json'), fsConstants.W_OK);
    } catch (error) {
      ok = error.code === 'ENOENT';
    }
    baldeWritableCache.set(repo, { ok, at: Date.now() });
    return ok;
  }
  const BALDE_FOLDER_READONLY =
    'Você não tem edição na pasta deste balde no OneDrive, então a Fila fica só para leitura nesta máquina. O dono do balde concede em Configurações › Baldes › Acesso › Aplicar no OneDrive (curadores recebem edição).';

  // Where a NEW contribution is written: the balde's Fila, except for a shared balde on a read-only
  // user install, where whoever cannot edit the balde drops it in their outbox. A curator with edit
  // rights writes straight into the Fila.
  async function submissionRoot() {
    const repo = activeRepo();
    if (!outboxRoot || localRepos.has(repo)) return queueRoot();
    return (await localUserCurates(repo)) && (await baldeWritable(repo)) ? queueRoot() : outboxRoot;
  }

  async function importExchangeOnce() {
    if (!exchangeRoot) return 0;
    const adminInstall = process.env.BALDE_SWEEP === '1';
    const verdicts = new Map();
    const mayImport = async (repo) => {
      if (!verdicts.has(repo)) {
        let ok = false;
        try {
          ok =
            !localRepos.has(repo) &&
            Boolean(await repoByName(repo)) &&
            (adminInstall || (await localUserCurates(repo))) &&
            (await baldeWritable(repo));
        } catch (error) {
          ok = false;
        }
        verdicts.set(repo, ok);
      }
      return verdicts.get(repo);
    };
    if (!adminInstall) {
      // someone who curates no balde they can edit here never reads other people's outboxes
      let any = false;
      for (const r of await listRepos().catch(() => [])) {
        if (await mayImport(r.name)) {
          any = true;
          break;
        }
      }
      if (!any) return 0;
    }
    let users = [];
    try {
      users = (await readdir(exchangeRoot, { withFileTypes: true })).filter((e) => e.isDirectory());
    } catch (error) {
      return 0;
    }
    let imported = 0;
    for (const u of users) {
      // chat feedback events (one small file each) join the balde's feedback log
      const fdir = join(exchangeRoot, u.name, 'feedback');
      let events = [];
      try {
        events = (await readdir(fdir)).filter((n) => n.endsWith('.jsonl'));
      } catch (error) {
        events = [];
      }
      for (const n of events) {
        const src = join(fdir, n);
        try {
          const text = await readFile(src, 'utf8');
          const first = text.split(/\r?\n/).find(Boolean);
          if (!first) continue; // half-synced: next pass
          const ev = JSON.parse(first);
          if (!adminInstall && Date.now() - (Date.parse(ev.timestamp || '') || 0) < IMPORT_GRACE_MS) continue;
          const repo = String(ev.repo || DEFAULT_REPO);
          if (!(await mayImport(repo))) continue;
          await importFeedbackEvent(src, feedbackDirOf(repo));
          await rm(src, { force: true });
          imported += 1;
        } catch (error) {
          /* half-synced or locked: next pass */
        }
      }
      const qdir = join(exchangeRoot, u.name, 'queue');
      let items = [];
      try {
        items = (await readdir(qdir, { withFileTypes: true })).filter(
          (e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.')
        );
      } catch (error) {
        continue;
      }
      for (const it of items) {
        const src = join(qdir, it.name);
        try {
          let meta = null;
          try {
            meta = JSON.parse(await readFile(join(src, 'item.json'), 'utf8'));
          } catch (error) {
            continue;
          } // half-synced: next pass
          if (!meta || !meta.id) continue;
          if (!adminInstall && Date.now() - (Date.parse(meta.createdAt || '') || 0) < IMPORT_GRACE_MS) continue;
          const repo = String(meta.repo || DEFAULT_REPO);
          if (!(await mayImport(repo))) continue;
          const destRoot = join(repoDirOf(repo), 'queue');
          if (meta.id !== it.name) continue;
          if (await importSubmission(src, destRoot)) imported += 1;
        } catch (error) {
          /* half-synced or locked: next pass */
        }
      }
    }
    if (imported) console.log(`Exchange: ${imported} contribuição(ões)/feedback(s) movido(s) para o balde.`);
    return imported;
  }

  // Contributions to a shared balde still waiting in someone's outbox (shown in its Fila, so a curator
  // knows items are on their way even when no app with edit rights has moved them in yet).
  async function outboxCountFor(repo) {
    if (!exchangeRoot || localRepos.has(repo)) return 0;
    let users = [];
    try {
      users = (await readdir(exchangeRoot, { withFileTypes: true })).filter((e) => e.isDirectory());
    } catch (error) {
      return 0;
    }
    let n = 0;
    for (const u of users) {
      const qdir = join(exchangeRoot, u.name, 'queue');
      let items = [];
      try {
        items = (await readdir(qdir, { withFileTypes: true })).filter(
          (e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.')
        );
      } catch (error) {
        continue;
      }
      for (const it of items) {
        try {
          const meta = JSON.parse(await readFile(join(qdir, it.name, 'item.json'), 'utf8'));
          if (
            meta &&
            meta.id &&
            String(meta.repo || DEFAULT_REPO) === repo &&
            !(await pathExists(join(qdir, it.name, 'receipt.json')))
          )
            n += 1;
        } catch (error) {
          /* half-synced */
        }
      }
    }
    return n;
  }
  // Every item goes to <balde>/queue by its `repo` stamp (no stamp = the default balde). An item of a
  // balde this machine does not know stays put, and nothing is ever overwritten. Same-folder-tree rename
  // (OneDrive turns it into a server-side move). Idempotent: runs at every boot of the admin install.
  async function migrateCentralQueue() {
    if (!legacyCentralQueueRoot || !(await pathExists(legacyCentralQueueRoot))) return;
    const known = new Set((await listRepos()).map((r) => r.name).filter((name) => !localRepos.has(name)));
    let moved = 0;
    let left = 0;
    for (const entry of await readdir(legacyCentralQueueRoot, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const src = join(legacyCentralQueueRoot, entry.name);
      if (entry.name === '_resolved-feedback.json') {
        // feedback triage decisions: every balde's Fila gets a copy (ids are skill-scoped, extras are inert)
        for (const name of known) {
          const dest = join(repoDirOf(name), 'queue', entry.name);
          if (await pathExists(dest)) continue;
          try {
            await mkdir(dirname(dest), { recursive: true });
            await cp(src, dest);
          } catch (error) {
            /* next boot */
          }
        }
        continue;
      }
      if (entry.name.startsWith('_')) continue; // other infra stores stay with the install
      let repo = '';
      try {
        if (entry.isDirectory())
          repo = String(JSON.parse(await readFile(join(src, 'item.json'), 'utf8')).repo || DEFAULT_REPO);
        else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.imported.json'))
          repo = String(JSON.parse(await readFile(src, 'utf8')).repo || DEFAULT_REPO);
      } catch (error) {
        repo = '';
      } // unreadable (half-synced or void): the void sweep or the next boot
      if (!repo) continue;
      if (!known.has(repo)) {
        left += 1;
        continue;
      }
      const destDir = join(repoDirOf(repo), 'queue');
      const dest = join(destDir, entry.name);
      if (await pathExists(dest)) {
        left += 1;
        continue;
      }
      try {
        await mkdir(destDir, { recursive: true });
        await rename(src, dest);
        moved += 1;
      } catch (error) {
        left += 1;
      }
    }
    if (moved || left)
      console.log(
        `Fila: ${moved} item(ns) da fila central movido(s) para a pasta do balde${left ? `; ${left} ficaram em ${legacyCentralQueueRoot}` : ''}.`
      );
  }
  // its Fila gets a new pending item, not only on the machine that moved it there. The first pass only
  // records what is already waiting.
  const filaSeen = new Map();
  async function watchCuratedFilasOnce() {
    const me = localActor();
    if (!me.email) return;
    for (const r of await listRepos().catch(() => [])) {
      if (!(await localUserCurates(r.name))) continue;
      const dir = join(repoDirOf(r.name), 'queue');
      let names = [];
      try {
        names = (await readdir(dir, { withFileTypes: true }))
          .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
          .map((e) => e.name);
      } catch (error) {
        names = [];
      } // no Fila yet
      const first = !filaSeen.has(r.name);
      const seen = filaSeen.get(r.name) || new Set();
      filaSeen.set(r.name, seen);
      for (const name of names) {
        if (seen.has(name)) continue;
        if (first) {
          seen.add(name);
          continue;
        }
        let meta = null;
        try {
          meta = JSON.parse(await readFile(join(dir, name, 'item.json'), 'utf8'));
        } catch (error) {
          continue;
        } // half-synced: next pass
        seen.add(name);
        if (!meta || !meta.id || (meta.status || 'pendente') !== 'pendente') continue;
        if (meta.skillId && !(await runWithRepo(r.name, () => canReadSkillActor(meta.skillId, me)))) continue;
        const who = (meta.submittedBy && (meta.submittedBy.name || meta.submittedBy.email)) || 'alguém';
        pushLocalNotice(
          meta.type === 'capsule' ? 'Nova cápsula na Fila' : 'Nova contribuição na Fila',
          `${r.titulo || r.name} · ${who}: ${meta.title || meta.skillId || meta.id}`,
          meta.submittedBy && meta.submittedBy.email
        );
      }
      // new Fraco/Errado chat feedback on the balde's skills (it reaches the Fila's Feedback tab too)
      const fdir = feedbackDirOf(r.name);
      const ffirst = !feedbackSeen.has(r.name);
      const fseen = feedbackSeen.get(r.name) || new Set();
      feedbackSeen.set(r.name, fseen);
      let logs = [];
      try {
        logs = (await readdir(fdir)).filter((n) => n.endsWith('.jsonl'));
      } catch (error) {
        logs = [];
      }
      for (const n of logs) {
        for (const ln of (await readFile(join(fdir, n), 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean)) {
          let ev = null;
          try {
            ev = JSON.parse(ln);
          } catch (error) {
            continue;
          }
          if (!ev || !ev.eventId || fseen.has(ev.eventId)) continue;
          fseen.add(ev.eventId);
          const verdict = String(ev.verdict || '').toLowerCase();
          if (ffirst || !['fraco', 'errado'].includes(verdict)) continue;
          if (ev.skillId && !(await runWithRepo(r.name, () => canReadSkillActor(ev.skillId, me)))) continue;
          pushLocalNotice(
            `Feedback ${verdict === 'errado' ? 'Errado' : 'Fraco'} no chat`,
            `${r.titulo || r.name} · ${ev.user || 'alguém'}: ${ev.skillId || ''}`,
            ev.user
          );
        }
      }
    }
  }
  const feedbackSeen = new Map();

  // Prune VOID queue entries that render as empty "(sem título)" phantoms in the Fila:
  //  (1) import tombstones "<id>.imported.json" left by older builds' exchange sweep (source already
  //      gone, no dedup role); (2) orphaned folders whose item.json is missing/empty/idless and carry
  //      no payload (half-written or sync-truncated). SAFE: a real item ALWAYS has item.json with an
  //      id + content.md/capsule.json/files, so nothing with content is ever removed.
  // A balde's Fila is written from several machines through OneDrive, which can create an item's
  // folder before its files arrive: an entry only counts as void once it is VOID_MIN_AGE_MS old.
  const VOID_MIN_AGE_MS = 30 * 60_000;
  async function cleanVoidQueueDir(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    let removed = 0;
    for (const entry of entries) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue; // sidecar stores
      const full = join(dir, entry.name);
      try {
        if (Date.now() - (await stat(full)).mtimeMs < VOID_MIN_AGE_MS) continue; // may still be syncing
        if (entry.isFile()) {
          if (!entry.name.endsWith('.json')) continue;
          if (entry.name.endsWith('.imported.json')) {
            await rm(full, { force: true });
            removed += 1;
            continue;
          }
          let obj = null;
          try {
            obj = JSON.parse(await readFile(full, 'utf8'));
          } catch {
            obj = null;
          }
          if (!obj || !obj.id) {
            await rm(full, { force: true });
            removed += 1;
          } // empty/stray flat marker
        } else if (entry.isDirectory()) {
          let meta = null;
          try {
            meta = JSON.parse(await readFile(join(full, 'item.json'), 'utf8'));
          } catch {
            meta = null;
          }
          if (meta && meta.id) continue; // real item — leave it
          const hasContent = await stat(join(full, 'content.md')).then(
            (s) => s.size > 0,
            () => false
          );
          const hasCapsule = await pathExists(join(full, 'capsule.json'));
          const hasFiles = await pathExists(join(full, 'files'));
          if (!hasContent && !hasCapsule && !hasFiles) {
            await rm(full, { recursive: true, force: true });
            removed += 1;
          }
        }
      } catch {
        /* half-synced — retry next run */
      }
    }
    return removed;
  }

  // Recurrent cleanup: every balde Fila this machine can write, the user's own outbox and (admin) every
  // user's outbox, where older builds left their tombstones. Boot (once) + every 5 min.
  async function sweepVoidQueueOnce() {
    let removed = 0;
    for (const r of await listRepos().catch(() => [])) {
      if (await baldeWritable(r.name)) removed += await cleanVoidQueueDir(join(repoDirOf(r.name), 'queue'));
    }
    if (outboxRoot) removed += await cleanVoidQueueDir(outboxRoot);
    else if (!legacyCentralQueueRoot && process.env.QUEUE_ROOT)
      removed += await cleanVoidQueueDir(process.env.QUEUE_ROOT); // dev harness Fila
    if (EXCHANGE_ROOT) {
      let users = [];
      try {
        users = (await readdir(EXCHANGE_ROOT, { withFileTypes: true })).filter((e) => e.isDirectory());
      } catch {
        users = [];
      }
      for (const u of users) removed += await cleanVoidQueueDir(join(EXCHANGE_ROOT, u.name, 'queue'));
    }
    if (removed) console.log(`Fila: ${removed} item(ns) vazio(s)/órfão(s) removido(s).`);
    return removed;
  }
  setInterval(() => {
    sweepVoidQueueOnce().catch(() => {});
  }, 5 * 60_000).unref();
  setTimeout(() => {
    sweepVoidQueueOnce().catch(() => {});
  }, 9_000).unref();

  // Every install that sees the exchange moves what it may into the baldes (importExchangeOnce): the
  // admin's right away, a curator's after the grace period. Local installs also watch the Filas their
  // user curates, for the Windows notices.
  if (exchangeRoot) {
    setInterval(() => {
      importExchangeOnce().catch(() => {});
    }, QUEUE_TICK_MS).unref();
    setTimeout(
      () => {
        importExchangeOnce().catch(() => {});
      },
      Math.min(8_000, QUEUE_TICK_MS)
    ).unref();
  }
  if (process.env.BALDE_SHELL_EXE || outboxRoot || legacyCentralQueueRoot) {
    setInterval(() => {
      watchCuratedFilasOnce().catch(() => {});
    }, QUEUE_TICK_MS).unref();
    setTimeout(
      () => {
        watchCuratedFilasOnce().catch(() => {});
      },
      Math.min(10_000, QUEUE_TICK_MS)
    ).unref();
    setInterval(() => {
      flushAllPendingCommits().catch(() => {});
    }, QUEUE_TICK_MS).unref();
  }

  // Changes curators made from machines that do not hold a balde's ledger (approvals from their
  // desktop) wait as pending commits in the balde folder; the machine that holds the ledger commits
  // them under their authors (see src/git-corpus.mjs). No-op where this machine holds no ledger.
  async function flushAllPendingCommits() {
    for (const r of await listRepos().catch(() => [])) {
      await flushPendingCommits(repoSkillsRoot(r.name));
      await flushPendingCommits(join(repoDirOf(r.name), 'commons'));
    }
  }

  return {
    localNotices,
    localNoticeState,
    pushLocalNotice,
    localUserCurates,
    baldeWritable,
    BALDE_FOLDER_READONLY,
    submissionRoot,
    outboxCountFor,
    migrateCentralQueue
  };
}
