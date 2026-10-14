import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { operationKey } from './operations.mjs';

export async function recordQueueDecision(root, item) {
  if (!item.review) return;
  const directory = join(root, '_decisions', item.id);
  const outcome = {
    decision: item.review.decision,
    skillId: item.skillId,
    publicationId: item.review.publicationId || null,
    appliedPath: item.review.appliedPath || null
  };
  const id = operationKey(JSON.stringify(outcome));
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(
      join(directory, `${id}.json`),
      JSON.stringify({ id, itemId: item.id, revision: item.revision, outcome, review: item.review }),
      { flag: 'wx' }
    );
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

export async function queueDecisionConflict(root, id) {
  let names;
  try {
    names = (await readdir(join(root, '_decisions', id))).filter((name) => name.endsWith('.json'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const events = [];
  for (const name of names) events.push(JSON.parse(await readFile(join(root, '_decisions', id, name), 'utf8')));
  const outcomes = new Set(events.map((event) => JSON.stringify(event.outcome)));
  return outcomes.size > 1
    ? {
        state: 'conflict',
        events,
        message: 'Decisões concorrentes recebidas. Revise os resultados antes de continuar.'
      }
    : null;
}
