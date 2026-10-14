import test from 'node:test';
import assert from 'node:assert/strict';
import { baldeRole, createPermissions, decide, gateAction, PERMISSION_REASONS } from '../src/security/permissions.mjs';
import { normalizeAccess } from '../src/repos.mjs';

const balde = (access) => ({ name: 'time', access: normalizeAccess(access) });
const team = balde({
  owners: ['criador@corp.test'],
  curators: ['cur@corp.test'],
  curatorGroups: ['Curadoria'],
  members: ['leitor@corp.test']
});

test('Roles come from the balde manifest: creator, curators, readers', () => {
  assert.equal(baldeRole(team, [], 'criador@corp.test'), 'admin');
  assert.equal(baldeRole(team, [], 'cur@corp.test'), 'curador');
  assert.equal(baldeRole(team, ['Curadoria'], 'outra@corp.test'), 'curador');
  assert.equal(baldeRole(team, [], 'leitor@corp.test'), 'membro');
  assert.equal(baldeRole(team, [], 'estranho@corp.test'), 'nenhum');
  assert.equal(baldeRole(null, [], 'criador@corp.test'), 'nenhum');
  // A balde without owners is administered by the install's Admins group.
  assert.equal(baldeRole(balde({ open: true }), ['Balde - Admins'], 'x@corp.test'), 'admin');
  assert.equal(baldeRole(balde({ open: true }), [], 'x@corp.test'), 'membro');
});

test('D1: creator and curators do every content action; only the creator administers', () => {
  for (const role of ['admin', 'curador']) assert.equal(decide('curar', { role, writable: true }).ok, true);
  assert.equal(decide('administrar', { role: 'admin', writable: true }).ok, true);
  assert.deepEqual(decide('administrar', { role: 'curador', writable: true }), {
    ok: false,
    reason: PERMISSION_REASONS.administrar
  });
  assert.deepEqual(decide('curar', { role: 'membro', writable: true }), {
    ok: false,
    reason: PERMISSION_REASONS.curar
  });
  assert.equal(decide('contribuir', { role: 'membro', writable: false }).ok, true);
  assert.deepEqual(decide('contribuir', { role: 'nenhum' }), { ok: false, reason: PERMISSION_REASONS.semAcesso });
});

test('Writing the balde also needs its folder, and the reason says which folder', () => {
  assert.deepEqual(decide('curar', { role: 'curador', writable: false }), {
    ok: false,
    reason: PERMISSION_REASONS.pastaCompartilhada
  });
  assert.deepEqual(decide('administrar', { role: 'admin', writable: false, local: true }), {
    ok: false,
    reason: PERMISSION_REASONS.pastaLocal
  });
});

test('Permissions resolve the same for the web and for machine callers', async () => {
  const probes = [];
  const permissions = createPermissions({
    repoByName: async (name) => (name === 'time' ? team : null),
    isLocalRepo: () => false,
    baldeWritable: async (name) => {
      probes.push(name);
      return true;
    },
    readonlyInstall: true
  });
  const curator = await permissions.forActor({ email: 'CUR@corp.test', groups: [] }, 'time');
  assert.equal(curator.role, 'curador');
  assert.equal(curator.curar.ok, true);
  assert.equal(curator.administrar.ok, false);
  assert.equal(curator.instalacao.ok, false);
  const reader = await permissions.forActor({ email: 'leitor@corp.test', groups: [] }, 'time');
  assert.equal(reader.curar.ok, false);
  assert.equal(reader.contribuir.ok, true);
  assert.deepEqual(probes, ['time'], 'the folder is probed only for whoever could write it');
  const installAdmin = await permissions.forActor({ email: 'x@corp.test', groups: ['Balde - Admins'] }, 'time');
  assert.equal(installAdmin.instalacao.reason, PERMISSION_REASONS.instalacaoSomenteLeitura);
  assert.deepEqual(await permissions.check({ email: 'cur@corp.test' }, 'time', 'administrar'), {
    ok: false,
    reason: PERMISSION_REASONS.administrar
  });
});

test('The read-only gate classifies every write by the action it needs', () => {
  for (const path of [
    '/api/merge/write',
    '/api/publish',
    '/api/skills/geral%2Fexample/eval/run',
    '/api/skills/new',
    '/api/skills/geral%2Fexample',
    '/api/skills/restore',
    '/api/commons/archive',
    '/api/commons/restore',
    '/api/domains/add',
    '/api/admin/domains/rename',
    '/api/admin/skills/move',
    '/api/eval-checklist',
    '/api/v1/skills/geral%2Fexample/files'
  ])
    assert.equal(gateAction('POST', path), 'curar', path);
  assert.equal(gateAction('POST', '/api/admin/user-domains'), 'administrar');
  for (const path of ['/api/groups', '/api/admin/prompts', '/api/admin/buddy-theme', '/api/repos', '/api/sp/sync'])
    assert.equal(gateAction('POST', path), 'instalacao', path);
  for (const path of ['/api/queue/decide', '/api/me/prefs', '/api/capsule/submit', '/api/repos/create'])
    assert.equal(gateAction('POST', path), 'livre', path);
  assert.equal(gateAction('PUT', '/api/repos/time'), 'livre');
  assert.equal(gateAction('POST', '/api/skills/geral%2Fexample/query-run'), 'livre');
  // Pedir sugestões de casos de uso à IA não grava: o handler pede só o papel de curador.
  assert.equal(gateAction('POST', '/api/skills/geral%2Fexample/eval/suggest'), 'livre');
  assert.equal(gateAction('POST', '/api/commons/eval/suggest'), 'livre');
  // Pastas do compartilhamento: só o plano nesta máquina; o handler pede o grupo de admins da instalação.
  assert.equal(gateAction('POST', '/api/compartilhamento/plano'), 'livre');
  assert.equal(gateAction('POST', '/api/compartilhamento/verificar'), 'livre');
  assert.equal(gateAction('POST', '/api/something/else'), null);
});
