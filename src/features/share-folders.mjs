import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, normalize } from 'node:path';
import { corpusRoot } from '../config.mjs';

// O acesso esperado de cada pasta do compartilhamento no OneDrive (Vitti, 2026-10-13, depois de cópias de
// conflito de outros computadores em app\): os membros do site só leem, e só os admins gravam, exceto em
// exchange, onde fica a pasta de envio de cada pessoa. Toda pasta tem permissões próprias, para uma mudança
// na raiz não alcançar as outras. A ordem é a do plano: exchange primeiro, a raiz por último (o script
// também não baixa a raiz enquanto exchange herdar dela).
export const SHARE_FOLDERS = Object.freeze([
  Object.freeze({
    key: 'exchange',
    rel: 'exchange',
    membros: 'write',
    motivo: 'As pastas de envio: cada pessoa grava a sua aqui.'
  }),
  Object.freeze({
    key: 'app',
    rel: 'app',
    membros: 'read',
    motivo: 'Versões, aplicativo e componentes: só quem publica grava.'
  }),
  Object.freeze({
    key: 'corpus',
    rel: 'corpus',
    membros: 'read',
    motivo: 'Os baldes: cada balde dá edição aos curadores dele em "Aplicar no OneDrive".'
  }),
  Object.freeze({ key: 'docs', rel: 'docs', membros: 'read', motivo: 'Documentos de instalação.' }),
  Object.freeze({
    key: 'admin',
    rel: 'admin',
    membros: 'read',
    motivo: 'A Fila central antiga, da instalação de administração.'
  }),
  Object.freeze({
    key: 'raiz',
    rel: '',
    membros: 'read',
    motivo: 'O instalador e o marcador de versão; muda depois de exchange ter permissões próprias.'
  })
]);

const normPath = (p) =>
  normalize(String(p || ''))
    .replace(/[\\/]+$/, '')
    .toLowerCase();

// O compartilhamento é a pasta acima do corpus (o app passa CORPUS_ROOT = <compartilhamento>\corpus) e tem app\.
export function shareRootFrom(corpusDir) {
  if (!corpusDir || basename(normalize(corpusDir)).toLowerCase() !== 'corpus') return null;
  const root = dirname(normalize(corpusDir));
  return existsSync(join(root, 'app')) ? root : null;
}

// O grupo do site Membros: "<site> Members" num site em inglês, "Membros de <site>" num site em português.
export const MEMBERS_GROUP_RE = /(Members$|^Membros\b)/;

// O papel do grupo do site Membros numa lista de permissões { quem, tipo, papel, origem } (a saída do
// script): o mais forte, ou '' quando o grupo não está na pasta.
export function membersRole(permissions) {
  let role = '';
  for (const p of permissions || []) {
    if (!p || p.tipo !== 'grupo do site' || !MEMBERS_GROUP_RE.test(String(p.quem || ''))) continue;
    const roles = String(p.papel || '').split(',');
    if (roles.includes('owner')) return 'owner';
    if (roles.includes('write')) role = 'write';
    else if (!role && roles.includes('read')) role = 'read';
  }
  return role;
}

// O estado mais recente de cada pasta: a verificação ("Quem abre cada pasta") e o recibo de uma aplicação,
// o mais novo por cima do outro. Chave: o caminho normalizado.
export function currentStates(verification, receipt) {
  const fromVerification = new Map();
  for (const f of (verification && verification.folders) || []) {
    if (!f || !f.folder) continue;
    fromVerification.set(
      normPath(f.folder),
      f.error
        ? { error: String(f.error), at: verification.checkedAt || '' }
        : {
            inherits: f.inherits === true,
            membros: membersRole(f.permissions),
            webUrl: f.webUrl || '',
            at: verification.checkedAt || ''
          }
    );
  }
  const fromReceipt = new Map();
  for (const f of (receipt && receipt.folders) || []) {
    if (!f || !f.folder) continue;
    fromReceipt.set(
      normPath(f.folder),
      f.depois
        ? {
            inherits: f.depois.inherits === true,
            membros: String(f.depois.membros || ''),
            webUrl: f.webUrl || '',
            at: receipt.at || ''
          }
        : { error: String(f.erro || 'sem leitura depois da aplicação'), webUrl: f.webUrl || '', at: receipt.at || '' }
    );
  }
  const receiptNewer = String((receipt && receipt.at) || '') > String((verification && verification.checkedAt) || '');
  const [older, newer] = receiptNewer ? [fromVerification, fromReceipt] : [fromReceipt, fromVerification];
  return new Map([...older, ...newer]);
}

// ok, diferente, erro ou sem-dados (a pasta ainda não foi verificada).
export function folderSituation(expected, current) {
  if (!current) return 'sem-dados';
  if (current.error) return 'erro';
  if (expected.proprias && current.inherits) return 'diferente';
  return current.membros === expected.membros ? 'ok' : 'diferente';
}

export function shareFoldersView({ shareRoot, exists, verification, receipt }) {
  const states = currentStates(verification, receipt);
  return SHARE_FOLDERS.map((f) => {
    const folder = f.rel ? join(shareRoot, f.rel) : shareRoot;
    const present = exists(folder);
    const esperado = { proprias: true, membros: f.membros };
    const atual = states.get(normPath(folder)) || null;
    return {
      key: f.key,
      label: f.rel || 'raiz',
      folder,
      exists: present,
      motivo: f.motivo,
      esperado,
      atual,
      situacao: present ? folderSituation(esperado, atual) : 'sem-pasta'
    };
  });
}

// As pastas do compartilhamento ganham o mesmo fluxo de "Aplicar no OneDrive" de um balde: a página escreve
// um plano (balde-pastas-plano/1) ou pede uma verificação, mostra o comando que o admin roda com o próprio
// login e lê o recibo que o script escreve. Planos e recibos ficam na pasta local desta máquina.
export function createShareFoldersFeature({ isOnOneDrive, acessoApplierAvailable, acessoCommand, acessoStamp }) {
  const runtimeDir = () =>
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Balde', 'runtime', 'acesso-compartilhamento') : null;
  const shareRoot = () => shareRootFrom(corpusRoot);

  async function availability() {
    const root = shareRoot();
    if (!runtimeDir() || !(await acessoApplierAvailable()))
      return {
        available: false,
        reason: 'O aplicador de acesso do OneDrive não está disponível nesta instalação.',
        shareRoot: root
      };
    if (!root)
      return {
        available: false,
        reason: 'Esta instalação não lê o corpus de uma pasta compartilhada do Balde.',
        shareRoot: null
      };
    if (!(await isOnOneDrive(root)))
      return { available: false, reason: 'A pasta compartilhada não está no OneDrive desta máquina.', shareRoot: root };
    return { available: true, reason: '', shareRoot: root };
  }

  // O resultado mais novo de um tipo (verificar-v-<carimbo>-… ou recibo-p-<carimbo>-…): o nome ordena pelo carimbo.
  async function latest(prefix) {
    const dir = runtimeDir();
    if (!dir) return null;
    let names = [];
    try {
      names = (await readdir(dir)).filter((n) => n.startsWith(`${prefix}-`) && n.endsWith('.json')).sort();
    } catch {
      return null;
    }
    for (const name of names.reverse()) {
      try {
        return JSON.parse(await readFile(join(dir, name), 'utf8'));
      } catch {
        /* um recibo pela metade: tenta o anterior */
      }
    }
    return null;
  }

  async function view() {
    const status = await availability();
    if (!status.shareRoot) return { ...status, folders: [] };
    const verification = await latest('verificar');
    const receipt = await latest('recibo');
    return {
      ...status,
      folders: shareFoldersView({ shareRoot: status.shareRoot, exists: existsSync, verification, receipt }),
      lastVerification: verification
        ? { at: verification.checkedAt || '', by: verification.by || '', error: verification.error || '' }
        : null,
      lastReceipt: receipt ? { at: receipt.at || '', by: receipt.by || '', status: receipt.status || '' } : null
    };
  }

  const existingFolders = (root) =>
    SHARE_FOLDERS.map((f) => ({ ...f, folder: f.rel ? join(root, f.rel) : root })).filter((f) => existsSync(f.folder));

  async function newVerification() {
    const status = await availability();
    if (!status.available) return { ok: false, error: status.reason };
    const dir = runtimeDir();
    await mkdir(dir, { recursive: true });
    const id = `v-${acessoStamp()}-${randomBytes(3).toString('hex')}`;
    const folders = existingFolders(status.shareRoot)
      .map((f) => `"${f.folder}"`)
      .join(' ');
    return { ok: true, id, command: acessoCommand(`-Out "${join(dir, `verificar-${id}.json`)}" ${folders}`) };
  }

  async function newPlan(by) {
    const status = await availability();
    if (!status.available) return { ok: false, error: status.reason };
    const dir = runtimeDir();
    await mkdir(dir, { recursive: true });
    const id = `p-${acessoStamp()}-${randomBytes(3).toString('hex')}`;
    const plan = {
      format: 'balde-pastas-plano/1',
      id,
      share: status.shareRoot,
      folders: existingFolders(status.shareRoot).map((f) => ({
        key: f.key,
        folder: f.folder,
        membros: f.membros,
        proprias: true
      })),
      receipt: join(dir, `recibo-${id}.json`),
      createdAt: new Date().toISOString(),
      createdBy: by
    };
    const planPath = join(dir, `plano-${id}.json`);
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    return { ok: true, id, plan, command: acessoCommand(`-Plano "${planPath}"`) };
  }

  async function result(id) {
    const dir = runtimeDir();
    if (!dir) return null;
    try {
      return JSON.parse(
        await readFile(join(dir, id.startsWith('p-') ? `recibo-${id}.json` : `verificar-${id}.json`), 'utf8')
      );
    } catch {
      return null;
    }
  }

  return { availability, view, newVerification, newPlan, result };
}
