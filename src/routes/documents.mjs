import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { docsRoot } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';
import { gitHistoryForPath } from '../git-corpus.mjs';

export function createDocumentsRoutes({ webActor, sendJson, listDocs, MEDIA_IMG_EXTS, mediaMimeFor }) {
  return async function documentsRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/docs') {
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      sendJson(res, 200, { ok: true, docs: await listDocs() });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/docs/file') {
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      const rel = String(url.searchParams.get('path') || '');
      const target = join(docsRoot, rel);
      if (target !== docsRoot && !target.startsWith(docsRoot + '/') && !target.startsWith(docsRoot + '\\')) {
        sendJson(res, 400, { ok: false, error: 'caminho inválido.' });
        return true;
      }
      if (!(await pathExists(target))) {
        sendJson(res, 404, { ok: false, error: 'documento não encontrado.' });
        return true;
      }
      const st = await stat(target);
      if (st.isDirectory()) {
        sendJson(res, 400, { ok: false, error: 'caminho é um diretório.' });
        return true;
      }
      if (st.size > 512 * 1024) {
        sendJson(res, 200, {
          ok: true,
          path: rel.replaceAll('\\', '/'),
          content: '',
          tooLarge: true,
          size: st.size,
          history: []
        });
        return true;
      }
      const raw = await readFile(target, 'utf8');
      const history = await gitHistoryForPath(docsRoot, rel);
      sendJson(res, 200, { ok: true, path: rel.replaceAll('\\', '/'), content: raw, size: st.size, history });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/docs/asset') {
      if (!webActor(req).email) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' });
        return true;
      }
      const rel = String(url.searchParams.get('path') || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (
        !rel ||
        rel.includes('..') ||
        !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(rel) ||
        !MEDIA_IMG_EXTS.has(extname(rel).toLowerCase())
      ) {
        sendJson(res, 400, { ok: false, error: 'caminho inválido.' });
        return true;
      }
      const target = join(docsRoot, rel);
      if (target !== docsRoot && !target.startsWith(docsRoot + '/') && !target.startsWith(docsRoot + '\\')) {
        sendJson(res, 400, { ok: false, error: 'caminho inválido.' });
        return true;
      }
      if (!(await pathExists(target))) {
        sendJson(res, 404, { ok: false, error: 'imagem não encontrada.' });
        return true;
      }
      try {
        const buf = await readFile(target);
        const etag = `"${createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`;
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304).end();
          return true;
        }
        res.writeHead(200, { 'content-type': mediaMimeFor(rel), 'cache-control': 'private, max-age=300', etag });
        res.end(buf);
      } catch (error) {
        sendJson(res, 500, { ok: false, error: 'falha ao ler imagem.' });
      }
      return true;
    }
    return false;
  };
}
