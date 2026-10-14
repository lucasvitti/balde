import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function pendingRecovery(repoDirectory) {
  const result = [];
  for (const [folder, type] of [
    ['commits', 'history'],
    ['operations', 'publication-or-feedback'],
    ['capsule-operations', 'capsule']
  ]) {
    const directory = join(repoDirectory, '.balde', folder);
    let files;
    try {
      files = await readdir(directory);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const file of files.filter((file) => file.endsWith('.json'))) {
      const record = JSON.parse(await readFile(join(directory, file), 'utf8'));
      if (record.status === 'completed' || record.status === 'abandoned') continue;
      result.push({
        id: record.id || file.slice(0, -5),
        type,
        status: record.status,
        at: record.createdAt || record.at,
        error: record.error || record.lastError || null
      });
    }
  }
  return result;
}
