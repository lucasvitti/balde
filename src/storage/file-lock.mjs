import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hostname } from 'node:os';

export async function withFileLock(path, action) {
  await mkdir(dirname(path), { recursive: true });
  const owner = { host: hostname(), pid: process.pid, createdAt: new Date().toISOString() };
  try {
    await writeFile(path, JSON.stringify(owner), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = JSON.parse(await readFile(path, 'utf8'));
    let dead = false;
    if (prior.host === owner.host && Number.isInteger(prior.pid)) {
      try {
        process.kill(prior.pid, 0);
      } catch (probe) {
        dead = probe.code === 'ESRCH';
      }
    }
    if (!dead) throw new Error('Operação em andamento em outro processo. Aguarde e tente novamente.');
    // Só recuperamos um processo comprovadamente encerrado nesta máquina; tempo não é prova.
    await unlink(path);
    return withFileLock(path, action);
  }
  try {
    return await action();
  } finally {
    await unlink(path);
  }
}
