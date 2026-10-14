import { createHash } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { relative, join } from 'node:path';
import { atomicJson, atomicWrite, containedPath } from '../storage/atomic-files.mjs';
import { serializeOperation } from './operations.mjs';

const hash = (bytes) => (bytes == null ? null : createHash('sha256').update(bytes).digest('hex'));
async function optionalFile(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readTransaction(path) {
  const text = await optionalFile(path);
  return text ? JSON.parse(text) : null;
}

export async function applyFileTransaction({ journalPath, root, inputHash, files, result }) {
  return serializeOperation(journalPath, async () => {
    let record = await readTransaction(journalPath);
    // Um plano desfeito não prende a próxima aplicação, mesmo que a contribuição tenha sido editada.
    if (record?.status === 'abandoned' && files) record = null;
    if (record && record.inputHash !== inputHash)
      throw new Error('A operação já contém outro conteúdo. Revise a contribuição antes de repetir.');
    if (record?.status === 'completed') return record.result;
    if (!record) {
      const entries = [];
      for (const [absolutePath, value] of files) {
        const path = relative(root, absolutePath).replaceAll('\\', '/');
        const target = containedPath(root, path);
        const before = await optionalFile(target);
        const content = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
        entries.push({
          path,
          beforeHash: hash(before),
          beforeContent: before?.toString('base64') ?? null,
          afterHash: hash(content),
          content: content.toString('base64')
        });
      }
      record = { inputHash, entries, result, status: 'prepared', createdAt: new Date().toISOString() };
      await atomicJson(journalPath, record);
    }
    // Cada destino deve continuar na revisão observada ou já conter o resultado desta operação.
    for (const entry of record.entries) {
      const current = hash(await optionalFile(containedPath(root, entry.path)));
      if (current !== entry.beforeHash && current !== entry.afterHash) {
        record.status = 'conflict';
        record.error = `Outra alteração encontrada em ${entry.path}. Nada adicional foi aplicado.`;
        await atomicJson(journalPath, record);
        throw new Error(record.error);
      }
    }
    try {
      for (const entry of record.entries) {
        const target = containedPath(root, entry.path);
        if (hash(await optionalFile(target)) !== entry.afterHash)
          await atomicWrite(target, Buffer.from(entry.content, 'base64'));
      }
      record.status = 'completed';
      record.completedAt = new Date().toISOString();
      delete record.error;
      await atomicJson(journalPath, record);
      return record.result;
    } catch (error) {
      const recoveryErrors = [];
      for (const entry of [...record.entries].reverse()) {
        const target = containedPath(root, entry.path);
        try {
          if (hash(await optionalFile(target)) !== entry.afterHash) continue;
          if (entry.beforeContent == null) await rm(target, { force: true });
          else await atomicWrite(target, Buffer.from(entry.beforeContent, 'base64'));
        } catch (recovery) {
          recoveryErrors.push(`${entry.path}: ${recovery.message}`);
        }
      }
      record.recoveryErrors = recoveryErrors;
      record.status = 'retry-required';
      record.error = error.message;
      await atomicJson(journalPath, record);
      throw new Error(`Aplicação incompleta. O plano foi preservado para continuar sem duplicar: ${error.message}`);
    }
  });
}

// Desfaz uma aplicação que ficou pela metade: cada arquivo que ainda tem o conteúdo desta operação volta ao
// que era antes; o que outra pessoa mudou depois fica como está e é listado. O registro fica 'abandoned',
// o balde deixa de ficar bloqueado e a contribuição continua pendente na Fila (pode ser aprovada de novo).
export async function discardFileTransaction({ journalPath, root, actor = '' }) {
  return serializeOperation(journalPath, async () => {
    const record = await readTransaction(journalPath);
    if (!record) throw new Error('Operação não encontrada.');
    if (record.status === 'completed') throw new Error('A operação já foi concluída; não há o que desfazer.');
    if (record.status === 'abandoned') return { status: record.status, changedByOthers: record.changedByOthers || [] };
    const changedByOthers = [];
    for (const entry of [...record.entries].reverse()) {
      const target = containedPath(root, entry.path);
      const current = hash(await optionalFile(target));
      if (current === entry.beforeHash) continue;
      if (current !== entry.afterHash) {
        changedByOthers.push(entry.path);
        continue;
      }
      if (entry.beforeContent == null) await rm(target, { force: true });
      else await atomicWrite(target, Buffer.from(entry.beforeContent, 'base64'));
    }
    Object.assign(record, {
      status: 'abandoned',
      abandonedAt: new Date().toISOString(),
      abandonedBy: actor,
      changedByOthers
    });
    await atomicJson(journalPath, record);
    return { status: record.status, changedByOthers };
  });
}

export async function incompleteTransactions(root) {
  const directory = join(root, '.balde', 'capsule-operations');
  let entries;
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const pending = [];
  for (const name of entries.filter((name) => name.endsWith('.json'))) {
    const record = await readTransaction(join(directory, name));
    if (record && record.status !== 'completed' && record.status !== 'abandoned')
      pending.push({ id: name.slice(0, -5), status: record.status });
  }
  return pending;
}
