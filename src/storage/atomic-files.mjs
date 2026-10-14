import { lstatSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export function containedPath(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes(':') || path.includes('\\'))
    throw new Error('Caminho relativo inválido.');
  const target = resolve(root, path);
  const rel = relative(resolve(root), target);
  if (
    !rel ||
    rel === '..' ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    path.split('/').some((part) => part === '..' || part === '.')
  )
    throw new Error('Caminho fora da pasta permitida.');
  const segments = path.split('/');
  // eslint-disable-next-line no-control-regex -- Nomes com caracteres de controle são recusados.
  const invalidCharacters = /[<>"|?*\x00-\x1f]/;
  if (
    segments.some(
      (part) =>
        !part ||
        /[. ]$/.test(part) ||
        invalidCharacters.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    )
  )
    throw new Error('Nome de arquivo inválido.');
  let current = resolve(root);
  for (const part of ['', ...segments]) {
    if (part) current = resolve(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('Links não são permitidos nesta operação.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return target;
}

export async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, value, { flag: 'wx' });
    await rename(temporary, path); // Leitores nunca observam um JSON parcialmente gravado.
  } finally {
    await rm(temporary, { force: true });
  }
}

export const atomicJson = (path, value) => atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
