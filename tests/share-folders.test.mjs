import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SHARE_FOLDERS,
  currentStates,
  folderSituation,
  membersRole,
  shareFoldersView,
  shareRootFrom
} from '../src/features/share-folders.mjs';

const site = (name, papel, origem = 'direta') => ({ quem: name, tipo: 'grupo do site', papel, origem });

test('The expected access: members write only in exchange, which comes first; the root comes last', () => {
  assert.equal(SHARE_FOLDERS[0].key, 'exchange');
  assert.equal(SHARE_FOLDERS.at(-1).key, 'raiz');
  assert.deepEqual(
    SHARE_FOLDERS.filter((f) => f.membros === 'write').map((f) => f.key),
    ['exchange']
  );
});

test('The Members role is read from the site group, in English or Portuguese', () => {
  assert.equal(membersRole([site('Vendas Owners', 'owner'), site('Vendas Members', 'write')]), 'write');
  assert.equal(membersRole([site('Membros de Vendas', 'read')]), 'read');
  assert.equal(membersRole([site('Vendas Visitors', 'read')]), '');
  assert.equal(membersRole([{ quem: 'Members', tipo: 'pessoa', papel: 'write' }]), '');
});

test('A folder matches only with its own permissions and the expected Members role', () => {
  const expected = { proprias: true, membros: 'read' };
  assert.equal(folderSituation(expected, null), 'sem-dados');
  assert.equal(folderSituation(expected, { inherits: false, membros: 'read' }), 'ok');
  assert.equal(folderSituation(expected, { inherits: true, membros: 'read' }), 'diferente');
  assert.equal(folderSituation(expected, { inherits: false, membros: 'write' }), 'diferente');
  assert.equal(folderSituation(expected, { error: 'acesso negado' }), 'erro');
});

test('The newest of the verification and the receipt gives each folder its state', () => {
  const verification = {
    checkedAt: '2026-10-13T10:00:00.000Z',
    folders: [
      { folder: 'C:\\Share\\app', inherits: true, permissions: [site('X Members', 'write', 'herdada')] },
      { folder: 'C:\\Share\\docs', inherits: true, permissions: [site('X Members', 'write', 'herdada')] }
    ]
  };
  const receipt = {
    at: '2026-10-13T11:00:00.000Z',
    folders: [{ folder: 'C:\\Share\\app\\', depois: { inherits: false, membros: 'read' } }]
  };
  const states = currentStates(verification, receipt);
  assert.deepEqual(
    { inherits: states.get('c:\\share\\app').inherits, membros: states.get('c:\\share\\app').membros },
    { inherits: false, membros: 'read' }
  );
  assert.equal(states.get('c:\\share\\docs').membros, 'write');
  const older = currentStates({ ...verification, checkedAt: '2026-10-13T12:00:00.000Z' }, receipt);
  assert.equal(older.get('c:\\share\\app').membros, 'write');
});

test('The view lists every expected folder, marking the ones missing on disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'balde-share-folders-'));
  try {
    await mkdir(join(root, 'corpus'));
    assert.equal(shareRootFrom(join(root, 'corpus')), null, 'without app\\ it is not a Balde share');
    await mkdir(join(root, 'app'));
    assert.equal(shareRootFrom(join(root, 'corpus')), root);
    assert.equal(shareRootFrom(join(root, 'outro')), null);
    const present = new Set([join(root, 'app'), join(root, 'corpus'), root]);
    const view = shareFoldersView({
      shareRoot: root,
      exists: (p) => present.has(p),
      verification: {
        checkedAt: '2026-10-13T10:00:00.000Z',
        folders: [{ folder: join(root, 'app'), inherits: false, permissions: [site('X Members', 'read')] }]
      },
      receipt: null
    });
    assert.deepEqual(
      view.map((f) => [f.key, f.situacao]),
      [
        ['exchange', 'sem-pasta'],
        ['app', 'ok'],
        ['corpus', 'sem-dados'],
        ['docs', 'sem-pasta'],
        ['admin', 'sem-pasta'],
        ['raiz', 'sem-dados']
      ]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
