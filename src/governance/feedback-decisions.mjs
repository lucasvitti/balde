import { withFileLock } from '../storage/file-lock.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson } from '../storage/atomic-files.mjs';
import { operationKey, serializeOperation } from './operations.mjs';

export async function feedbackDecisions(queueDirectory) {
  const decisions = new Map();
  try {
    const legacy = JSON.parse(await readFile(join(queueDirectory, '_resolved-feedback.json'), 'utf8'));
    for (const entry of legacy.log || []) decisions.set(entry.id, entry);
    for (const id of legacy.ids || []) if (!decisions.has(id)) decisions.set(id, { id, action: 'resolved' });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const directory = join(queueDirectory, '_feedback-decisions');
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return decisions;
    throw error;
  }
  for (const name of names.filter((name) => name.endsWith('.json'))) {
    const entry = JSON.parse(await readFile(join(directory, name), 'utf8'));
    decisions.set(entry.id, entry);
  }
  return decisions;
}

export async function resolveFeedback(queueDirectory, id, decision) {
  const path = join(queueDirectory, '_feedback-decisions', `${operationKey(id)}.json`);
  return serializeOperation(path, () =>
    withFileLock(path + '.lock', async () => {
      const previous = (await feedbackDecisions(queueDirectory)).get(id);
      if (previous) {
        if (
          previous.action !== decision.action ||
          (previous.contributionId || null) !== (decision.contributionId || null)
        )
          throw new Error('Este feedback já recebeu outra decisão.');
        return previous;
      }
      const record = { id, ...decision, at: new Date().toISOString() };
      await atomicJson(path, record);
      return record;
    })
  );
}
