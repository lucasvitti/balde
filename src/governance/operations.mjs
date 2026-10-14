import { withFileLock } from '../storage/file-lock.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson } from '../storage/atomic-files.mjs';

const running = new Map();
export const operationKey = (value) => createHash('sha256').update(String(value)).digest('hex');

export async function serializeOperation(key, action) {
  const previous = running.get(key) || Promise.resolve();
  const pending = previous.catch(() => {}).then(action);
  running.set(key, pending);
  try {
    return await pending;
  } finally {
    if (running.get(key) === pending) running.delete(key);
  }
}

export async function runOperation(directory, id, input, action) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id)) throw new Error('Identificador da operação inválido.');
  const path = join(directory, `${id}.json`);
  return serializeOperation(path, () =>
    withFileLock(path + '.lock', async () => {
      const inputHash = operationKey(JSON.stringify(input));
      let record;
      try {
        record = JSON.parse(await readFile(path, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (record && record.inputHash !== inputHash)
        throw new Error('Esta operação já representa outro conteúdo; recarregue antes de continuar.');
      if (record?.status === 'completed') return record.result;
      record ||= { id, inputHash, createdAt: new Date().toISOString(), steps: {} };
      record.status = 'running';
      await atomicJson(path, record);
      const checkpoint = async (name, perform) => {
        if (Object.hasOwn(record.steps, name)) return record.steps[name];
        const value = await perform();
        record.steps[name] = value ?? null;
        await atomicJson(path, record);
        return value;
      };
      try {
        const result = await action({ checkpoint, id });
        record.status = 'completed';
        record.result = result;
        record.completedAt = new Date().toISOString();
        delete record.error;
        await atomicJson(path, record);
        return result;
      } catch (error) {
        record.status = 'retry-required';
        record.error = error.message;
        await atomicJson(path, record);
        throw error;
      }
    })
  );
}
