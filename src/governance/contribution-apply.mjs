import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, containedPath } from '../storage/atomic-files.mjs';

export async function applyContribution({ item, content, actor, sourceDirectory, skillDirectory }) {
  const text = String(content || '').trim();
  if (!text && !(item.files || []).length) throw new Error('Contribuição sem conteúdo.');
  const directory = containedPath(skillDirectory, `context/contributions/${item.id}`);
  const files = [];
  const names = new Set();
  for (const file of item.files || []) {
    if (!file.name || /[\\/:]/.test(file.name) || names.has(file.name.toLowerCase()))
      throw new Error('Anexo inválido ou duplicado.');
    names.add(file.name.toLowerCase());
    const bytes = await readFile(containedPath(sourceDirectory, `files/${file.name}`));
    if (!bytes.length || (file.bytes != null && bytes.length !== file.bytes))
      throw new Error(`Anexo incompleto: ${file.name}`);
    files.push({ name: file.name, bytes });
  }
  const hash = createHash('sha256').update(text);
  for (const file of files) hash.update(file.name).update(file.bytes);
  const inputHash = hash.digest('hex');
  let receipt;
  try {
    receipt = JSON.parse(await readFile(join(directory, '_receipt.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (receipt) {
    if (receipt.inputHash !== inputHash) throw new Error('Esta contribuição já foi aplicada com outro conteúdo.');
    return receipt.result;
  }
  const stage = `${directory}.staging-${randomUUID()}`;
  try {
    await mkdir(join(stage, 'files'), { recursive: true });
    for (const file of files) await writeFile(containedPath(stage, `files/${file.name}`), file.bytes, { flag: 'wx' });
    const section = `Contribuição ${item.id}`;
    const markdown = `# ${section}\n\n${text}\n\nEnviado por ${item.submittedBy?.name || item.submittedBy?.email || 'colaborador'}; revisado por ${actor.name || actor.email}.\n`;
    await writeFile(join(stage, 'content.md'), markdown);
    const result = {
      section,
      files: files.map((file) => file.name),
      appliedState: 'draft',
      contextPath: `context/contributions/${item.id}`
    };
    await atomicJson(join(stage, '_receipt.json'), { inputHash, result, actor, appliedAt: new Date().toISOString() });
    await rename(stage, directory); // Texto, anexos e comprovante tornam-se visíveis juntos.
    return result;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
