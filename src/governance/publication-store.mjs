import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseFrontmatter } from '../skill-format.mjs';
import { atomicJson, containedPath } from '../storage/atomic-files.mjs';
import { withFileLock } from '../storage/file-lock.mjs';
import { serializeOperation } from './operations.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Na instalação local a pasta de governança é a própria pasta da skill: o lock da publicação fica ao lado
// do conteúdo e não faz parte dele.
const PUBLICATION_LOCK = 'publication.lock';
const excluded = (path) =>
  /^(?:canonico|legado|logs|rascunho|\.git|\.balde)(?:\/|$)/.test(path) ||
  path.startsWith('.') ||
  path === PUBLICATION_LOCK;

export async function publicationDirectory(governanceDirectory) {
  const canonical = join(governanceDirectory, 'canonico');
  let pointer;
  try {
    pointer = JSON.parse(await readFile(join(canonical, 'current.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (pointer) return containedPath(canonical, pointer.snapshot);
  try {
    await lstat(join(canonical, 'metadata.json'));
    return canonical;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readPublication(governanceDirectory) {
  const directory = await publicationDirectory(governanceDirectory);
  if (!directory) return null;
  const metadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'));
  if (metadata.files) {
    for (const file of metadata.files) {
      if (hash(await readFile(containedPath(directory, file.path))) !== file.sha256)
        throw new Error('Publicação incompleta ou alterada. Aguarde a sincronização; o conteúdo não foi consumido.');
    }
    const snapshots = join(governanceDirectory, 'canonico', 'snapshots');
    const predecessors = new Map();
    for (const entry of await readdir(snapshots, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      let candidate;
      try {
        candidate = JSON.parse(await readFile(join(snapshots, entry.name, 'metadata.json'), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      const prior = candidate.previousPublicationId || 'initial';
      if (predecessors.has(prior) && predecessors.get(prior) !== candidate.operationId)
        throw new Error(
          'Publicações concorrentes detectadas. O curador precisa reconciliar as versões antes do consumo.'
        );
      predecessors.set(prior, candidate.operationId);
    }
  }
  return { directory, metadata };
}

async function collectFiles(root, result, prefix = '') {
  let entries;
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (excluded(relative)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Link não permitido no conteúdo publicado: ${relative}`);
    if (entry.isDirectory()) await collectFiles(root, result, relative);
    else if (entry.isFile()) result.set(relative, await readFile(containedPath(root, relative)));
  }
}

export async function collectWorkingFiles(source, draft) {
  const files = new Map();
  await collectFiles(source, files);
  if (draft && draft !== source) await collectFiles(draft, files);
  return files;
}

export async function publishSnapshot({
  governanceDirectory,
  sourceDirectory,
  draftDirectory,
  operationId,
  buildPublication,
  renderMarkdown,
  rollbackVersion = null
}) {
  return serializeOperation(governanceDirectory, () =>
    withFileLock(join(governanceDirectory, PUBLICATION_LOCK), async () => {
      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(operationId)) throw new Error('Identificador de publicação inválido.');
      const canonical = join(governanceDirectory, 'canonico');
      const relative = `snapshots/${operationId}`;
      const destination = containedPath(canonical, relative);
      let previous = await readPublication(governanceDirectory);
      if (previous?.metadata.operationId === operationId) return previous.metadata;
      let completed;
      try {
        completed = JSON.parse(await readFile(join(destination, 'metadata.json'), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (completed) {
        if (completed.previousPublicationId !== (previous?.metadata.id || null))
          throw new Error('Outra versão foi publicada; revise o conflito antes de continuar.');
        await atomicJson(join(canonical, 'current.json'), { snapshot: relative, operationId });
        return completed;
      }
      let files;
      if (rollbackVersion) {
        let restored;
        for (const entry of await readdir(join(canonical, 'snapshots'), { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const directory = join(canonical, 'snapshots', entry.name);
          const meta = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'));
          if (meta.version !== rollbackVersion) continue;
          if (restored) throw new Error('Versão de destino ambígua; reconcilie o histórico.');
          restored = new Map();
          for (const file of meta.files || []) {
            const bytes = await readFile(containedPath(directory, file.path));
            if (hash(bytes) !== file.sha256) throw new Error('Snapshot de rollback incompleto.');
            restored.set(file.path, bytes);
          }
        }
        if (!restored) throw new Error('Snapshot completo da versão de destino não encontrado.');
        files = restored;
      } else files = await collectWorkingFiles(sourceDirectory, draftDirectory);
      files.delete('metadata.json');
      if (!files.has('SKILL.md')) throw new Error('A publicação exige SKILL.md.');
      const metadata = await buildPublication(previous?.metadata || null, files.get('SKILL.md').toString('utf8'));
      Object.assign(metadata, {
        operationId,
        previousPublicationId: previous?.metadata.id || null,
        snapshot: relative,
        workingFiles: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes) }))
      });
      files.set('SKILL.md', Buffer.from(renderMarkdown(files.get('SKILL.md').toString('utf8'), metadata)));
      const stage = join(canonical, `.staging-${randomUUID()}`);
      try {
        await mkdir(stage, { recursive: true });
        const manifest = [];
        for (const [path, bytes] of files) {
          const target = containedPath(stage, path);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, bytes, { flag: 'wx' });
          manifest.push({ path, sha256: hash(bytes), bytes: bytes.length });
        }
        metadata.files = manifest;
        metadata.paths = { ...(metadata.paths || {}), canonico: join(destination, 'SKILL.md') };
        await atomicJson(join(stage, 'metadata.json'), metadata);
        for (const file of manifest) {
          if (hash(await readFile(containedPath(stage, file.path))) !== file.sha256)
            throw new Error('Falha ao verificar a publicação.');
        }
        await mkdir(dirname(destination), { recursive: true });
        await rename(stage, destination);
        // O ponteiro é o último efeito: falhas anteriores deixam a versão publicada intacta.
        await atomicJson(join(canonical, 'current.json'), { snapshot: relative, operationId });
        return metadata;
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    })
  );
}

// Registro de governança que vive na pasta da skill (avaliação e seus vereditos, cadência e revisões,
// índice de contexto, sugestões) muda sem mudar o conteúdo: não abre rascunho a publicar.
const governanceRecord = (path) => /^(?:eval\/|governance\.json$|context-index\.json$|suggestions\.json$)/.test(path);

export async function hasWorkingChanges(published, source, draft) {
  if (!published) return true;
  if (!Array.isArray(published.metadata.workingFiles)) return legacyWorkingChanges(published, source, draft);
  const files = await collectWorkingFiles(source, draft);
  for (const path of [...files.keys()]) if (governanceRecord(path)) files.delete(path);
  // As publicações da 2.0.16 registraram o lock entre os arquivos de trabalho; ele não conta.
  const expected = published.metadata.workingFiles.filter(
    (entry) => !excluded(entry.path) && !governanceRecord(entry.path)
  );
  return (
    files.size !== expected.length ||
    expected.some((entry) => !files.has(entry.path) || hash(files.get(entry.path)) !== entry.sha256)
  );
}

// Publicação anterior à 2.0.16 (canonico/metadata.json sem workingFiles): o Publicar antigo gravava o
// SKILL.md de trabalho com status, versão e revisão no frontmatter e o bloco "Alteracoes canonizadas
// pelo owner" no fim. Há alteração pendente quando o texto ou os demais campos mudaram depois dela.
const LEGACY_APPROVAL_SECTION = /^## Alteracoes canonizadas pelo owner[ \t]*$/m;
const LEGACY_PUBLICATION_FIELDS = new Set(['status', 'version', 'last_reviewed']);

export function legacyComparableSkill(markdown) {
  const { meta, body } = parseFrontmatter(markdown);
  const fields = Object.entries(meta)
    .filter(([key]) => !LEGACY_PUBLICATION_FIELDS.has(key))
    .sort(([a], [b]) => a.localeCompare(b));
  const text = body.replace(/\r\n/g, '\n');
  const approval = text.search(LEGACY_APPROVAL_SECTION);
  const content = (approval >= 0 ? text.slice(0, approval) : text)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
  return JSON.stringify([fields, content]);
}

async function readSkillMarkdown(directory) {
  try {
    return await readFile(join(directory, 'SKILL.md'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function legacyWorkingChanges(published, source, draft) {
  const publishedMarkdown = await readSkillMarkdown(published.directory);
  const workingMarkdown = (draft && (await readSkillMarkdown(draft))) || (await readSkillMarkdown(source));
  if (publishedMarkdown === null || workingMarkdown === null) return true;
  return legacyComparableSkill(workingMarkdown) !== legacyComparableSkill(publishedMarkdown);
}
