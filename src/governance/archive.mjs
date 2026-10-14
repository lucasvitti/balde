import { mkdir, readdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathExists } from '../fs-utils.mjs';
import { fileStamp } from '../skill-format.mjs';

// Arquivar e restaurar skills e cápsulas (D6, Vitti 2026-10-06): nada se apaga. Arquivar move a pasta para a
// pasta de arquivo da raiz, <raiz>/<arquivo>/<id>/, com um registro (arquivamento.json: o id de origem, quem
// arquivou e quando); restaurar a devolve ao id de origem, sem o registro. O que lista ou lê o corpus ignora
// essas pastas, então chat, MCP e buscas não veem o que está arquivado. Os arquivamentos anteriores à 2.0.19
// não têm registro: o id de origem sai do caminho, sem o carimbo de data que evitava colisão.
//
// Skills usam skills/_archived (onde as versões anteriores já arquivavam e que todas pulam). Cápsulas usam
// commons/.archived: as versões até a 2.0.18, que ainda rodam enquanto o OneDrive entrega a 2.0.19, pulam
// pastas com "." nas cápsulas, não com "_", e listariam uma cápsula arquivada.
export const SKILL_ARCHIVE_DIR = '_archived';
export const CAPSULE_ARCHIVE_DIR = '.archived';
export const ARCHIVE_RECORD = 'arquivamento.json';
const ARCHIVE_FORMAT = 'balde-arquivo/1';
const STAMP_SUFFIX = /-\d{8}T\d{6}Z$/;

export class ArchiveError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Um id de skill ou cápsula: segmentos relativos, nenhum vazio, "..", ou começando com "_" ou ".".
function segmentsOf(id) {
  const segments = String(id || '')
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/');
  if (
    !segments[0] ||
    segments.some((s) => !s || s === '..' || s.startsWith('_') || s.startsWith('.') || s.includes(':'))
  )
    throw new ArchiveError('Id inválido.', 400);
  return segments;
}

async function readRecord(folder) {
  try {
    const record = JSON.parse(await readFile(join(folder, ARCHIVE_RECORD), 'utf8'));
    return record && record.format === ARCHIVE_FORMAT ? record : null;
  } catch {
    return null;
  }
}

// Apaga as pastas vazias que sobraram entre `folder` e `stop` (exclusive), de baixo para cima.
async function pruneEmpty(folder, stop) {
  let current = folder;
  while (current.length > stop.length && current.startsWith(stop)) {
    try {
      await rmdir(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}

// O Windows recusa mover uma pasta com arquivo aberto por outro programa; a mensagem diz isso.
async function moveFolder(from, to) {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (error) {
    if (['EPERM', 'EBUSY', 'EACCES'].includes(error.code))
      throw new ArchiveError(
        'Não foi possível mover a pasta: algum arquivo dela está aberto em outro programa ou a pasta está somente-leitura.',
        409
      );
    throw error;
  }
}

// marker: o arquivo que identifica o item (SKILL.md numa skill, context.md numa cápsula). As listagens não
// descem na pasta de um item, então o que houver dentro dela (snapshots publicados, anexos) vai junto.
export async function archiveFolder({
  root,
  id,
  marker,
  archiveDir = SKILL_ARCHIVE_DIR,
  actor = {},
  now = new Date()
}) {
  const segments = segmentsOf(id);
  const normalized = segments.join('/');
  const source = join(root, ...segments);
  if (!(await pathExists(join(source, marker)))) throw new ArchiveError(`"${normalized}" não encontrado.`, 404);
  let archivedId = normalized;
  if (await pathExists(join(root, archiveDir, ...segments))) archivedId = `${normalized}-${fileStamp(now)}`;
  const destination = join(root, archiveDir, ...archivedId.split('/'));
  await moveFolder(source, destination);
  const record = {
    format: ARCHIVE_FORMAT,
    id: normalized,
    archivedAt: now.toISOString(),
    archivedBy: { name: String(actor.name || ''), email: String(actor.email || '') }
  };
  await writeFile(join(destination, ARCHIVE_RECORD), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { id: normalized, archivedId, paths: [normalized, `${archiveDir}/${archivedId}`] };
}

// Os itens arquivados sob root/_archived: as pastas que têm o marker (sem descer nelas).
export async function listArchivedFolders({ root, marker, archiveDir = SKILL_ARCHIVE_DIR }) {
  const base = join(root, archiveDir);
  const out = [];
  async function visit(folder, relative) {
    let entries = [];
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    if (relative && entries.some((entry) => entry.isFile() && entry.name === marker)) {
      const record = await readRecord(folder);
      out.push({
        archivedId: relative,
        id: (record && record.id) || relative.replace(STAMP_SUFFIX, ''),
        archivedAt: (record && record.archivedAt) || null,
        archivedBy: (record && record.archivedBy) || null,
        legacy: !record
      });
      return;
    }
    for (const entry of entries)
      if (entry.isDirectory() && !entry.name.startsWith('.'))
        await visit(join(folder, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
  }
  await visit(base, '');
  return out.sort(
    (a, b) => String(b.archivedAt || '').localeCompare(String(a.archivedAt || '')) || a.id.localeCompare(b.id)
  );
}

export async function restoreFolder({ root, archivedId, marker, archiveDir = SKILL_ARCHIVE_DIR }) {
  const segments = segmentsOf(archivedId);
  const normalized = segments.join('/');
  const source = join(root, archiveDir, ...segments);
  if (!(await pathExists(join(source, marker))))
    throw new ArchiveError(`"${normalized}" não está entre os arquivados.`, 404);
  const record = await readRecord(source);
  const id = segmentsOf((record && record.id) || normalized.replace(STAMP_SUFFIX, '')).join('/');
  const destination = join(root, ...id.split('/'));
  if (await pathExists(destination))
    throw new ArchiveError(`Já existe um item ativo em "${id}". Arquive ou mova o atual antes de restaurar este.`, 409);
  await moveFolder(source, destination);
  await unlink(join(destination, ARCHIVE_RECORD)).catch(() => {});
  await pruneEmpty(dirname(source), join(root, archiveDir));
  return { id, archivedId: normalized, paths: [id, `${archiveDir}/${normalized}`] };
}
