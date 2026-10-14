import { recordHistoryRequest, flushHistoryRequests, serializeHistory } from './storage/history-requests.mjs';
import { localIdentity } from './security/local-session.mjs';
// O conteúdo e a solicitação de histórico têm persistências independentes e recuperáveis.
import { execFile } from 'node:child_process';

import { mkdir, readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { pathExists } from './fs-utils.mjs';
import { corpusRoot, skillsRoot } from './config.mjs';

const execFileAsync = promisify(execFile);

export function actorFromReq(req) {
  return localIdentity();
}

export function gitEnv(actor = {}) {
  const name = actor.name || 'Balde';
  const email = actor.email || 'balde@bot.local';
  return {
    ...process.env,
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email
  };
}

// Where a work tree's git objects live, seen from THIS machine: 'none' (not a ledger), 'local' (a
// .git directory, or a .git pointer whose target exists here) or 'elsewhere' (a pointer to another
// machine's ledger: the balde-local admin keeps the shared baldes' ledgers on its own disk, and a
// user keeps the ledger of a balde they created on theirs).
export async function ledgerState(root) {
  const dotGit = join(root, '.git');
  let st;
  try {
    st = await stat(dotGit);
  } catch (error) {
    return 'none';
  }
  if (st.isDirectory()) return 'local';
  try {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(dotGit, 'utf8'));
    if (!m) return 'none';
    const target = isAbsolute(m[1]) ? m[1] : resolve(root, m[1]);
    return (await pathExists(target)) ? 'local' : 'elsewhere';
  } catch (error) {
    return 'none';
  }
}

export async function flushPendingCommits(root) {
  if ((await ledgerState(root)) !== 'local') return 0;
  return serializeHistory(root, () => flushHistoryRequests(root, gitEnv));
}

export async function commitRepo(root, message, actor = {}, paths = null) {
  const state = await ledgerState(root);
  if (state === 'none') return { status: 'unversioned' };
  return serializeHistory(root, async () => {
    const request = await recordHistoryRequest(root, message, actor, paths);
    if (state === 'local') await flushHistoryRequests(root, gitEnv);
    return { status: 'recorded', requestId: request.id };
  });
}

// The local version (balde-local) keeps git objects in a machine-local ledger folder, never inside a
// cloud-synced folder; the VPS/dev keep a plain .git in place.
const localVersion = () => Boolean(process.env.BALDE_SHELL_EXE) || process.env.BALDE_READONLY_CORPUS === '1';
const localLedgerFallback = () =>
  localVersion() && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Balde', 'ledger') : undefined;
const insideSharedCorpus = (root) => {
  const a = resolve(root).toLowerCase();
  const b = resolve(corpusRoot).toLowerCase();
  return a === b || a.startsWith(`${b}${sep}`);
};

// Initialize a corpus root as a git repo on first run (idempotent).
// ledgerRoot: where the git objects live. Defaults to GIT_LEDGER_ROOT (set for the local admin
// role), else the machine-local ledger on the local version; a balde the user creates in a folder of
// their own passes it explicitly. A read-only user install never starts a ledger inside the SHARED
// corpus: versioning it is the admin install's job, and the user's OneDrive could not upload a new
// .git there anyway.
export async function ensureRepo(root, label = 'corpus', ledgerRootArg) {
  const ledgerRoot = ledgerRootArg || process.env.GIT_LEDGER_ROOT || localLedgerFallback();
  try {
    if (!(await pathExists(root)) || (await pathExists(join(root, '.git')))) {
      return;
    }
    if (!ledgerRootArg && process.env.BALDE_READONLY_CORPUS === '1' && insideSharedCorpus(root)) {
      return;
    }
    const env = gitEnv();
    // balde-local (admin role): the ledger's objects live OUTSIDE a cloud-synced corpus.
    // --separate-git-dir leaves only a one-line .git POINTER file in the share (sync-safe);
    // every other `git -C root` command follows it transparently. On machines where the
    // pointer's target doesn't exist (read-only users), git fails and commitRepo swallows it.
    if (ledgerRoot) {
      // Ledger dir keyed by the ROOT path (not the label): multi-repo corpora reuse labels
      // ('corpus'/'commons' per balde) but every work-tree needs its own object store.
      const { createHash } = await import('node:crypto');
      const slug = `${String(label).replace(/[^a-z0-9-]+/gi, '-')}-${createHash('sha256').update(String(root)).digest('hex').slice(0, 8)}`;
      // The ledger folder may not exist yet on this machine (a user who was never admin): without it
      // git init fails, and a later init would fall back to a real .git directory in the folder.
      await mkdir(ledgerRoot, { recursive: true });
      await execFileAsync('git', ['-C', root, 'init', `--separate-git-dir=${join(ledgerRoot, `${slug}.git`)}`], {
        env
      });
    } else {
      await execFileAsync('git', ['-C', root, 'init'], { env });
    }
    await execFileAsync('git', ['-C', root, 'add', '-A'], { env });
    await execFileAsync('git', ['-C', root, 'commit', '-m', `init: ${label} inicial`, '--no-gpg-sign'], { env });
    console.log('Git repo initialized at', root);
  } catch (error) {
    // git unavailable / already a repo -> ignore
  }
}

export async function commitCorpus(message, actor = {}, paths = null) {
  return commitRepo(skillsRoot(), message, actor, paths);
}

export async function ensureCorpusRepo() {
  return ensureRepo(skillsRoot(), 'corpus');
}

// Git commit history touching a single skill's directory (for the Explore view).
// Authored by the SSO identity of whoever made each change (see commitCorpus).
export async function gitHistoryForPath(root, id, limit = 50) {
  try {
    if (!(await pathExists(join(root, '.git')))) {
      return [];
    }
    const unit = '\x1f';
    const rec = '\x1e';
    const fmt = ['%H', '%an', '%ae', '%aI', '%s'].join(unit) + rec;
    const { stdout } = await execFileAsync(
      'git',
      ['-C', root, 'log', `--max-count=${limit}`, `--pretty=format:${fmt}`, '--', id],
      { env: gitEnv(), maxBuffer: 4 * 1024 * 1024 }
    );
    return stdout
      .split(rec)
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => {
        const [hash, author, email, date, subject] = row.split(unit);
        return { hash, shortHash: String(hash || '').slice(0, 7), author, email, date, subject };
      });
  } catch (error) {
    return [];
  }
}

export async function gitHistoryForSkill(id, limit = 50) {
  return gitHistoryForPath(skillsRoot(), id, limit);
}
