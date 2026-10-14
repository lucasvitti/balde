import { SQL_FORMATTER_URL } from '../policy/chat-policy.mjs';
import { execFile as spExecFile } from 'node:child_process';
import { join } from 'node:path';
import { rootDir, port } from '../config.mjs';
import { actorFromReq } from '../git-corpus.mjs';
import { repoByName, isRepoMember } from '../repos.mjs';
import { detectCliClients, spawnCliLogin } from '../ai-cli.mjs';
import {
  mcpSupported,
  mcpStatus,
  writeMcpLauncher,
  setupClaudeDesktopExtension,
  setupClaudeCode,
  setupCodex
} from '../mcp-setup.mjs';

export function createLocalIntegrationRoutes({
  sendJson,
  readJsonBody,
  localNoticeState,
  loadUserPrefs,
  localNotices,
  AI_MODE,
  currentApiKey,
  reqGroups,
  webActor,
  personalRepoSlug,
  ensureLocalMachineKey,
  isAdminReq,
  SP_CONFIGURED,
  runSharePointScript
}) {
  return async function localIntegrationRoutes(req, res, url) {
    if (url.pathname === '/api/startup' && (req.method === 'GET' || req.method === 'POST')) {
      const shellExe = process.env.BALDE_SHELL_EXE || '';
      const supported = process.platform === 'win32' && Boolean(shellExe);
      const regRun = (args) =>
        new Promise((resolve) => {
          spExecFile('reg.exe', args, { windowsHide: true, timeout: 10000 }, (error, stdout, stderr) => {
            resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || '') });
          });
        });
      const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
      const VALUE = 'BaldeDeConhecimento';
      if (req.method === 'GET') {
        if (!supported) {
          sendJson(res, 200, { ok: true, supported: false });
          return true;
        }
        const q = await regRun(['query', KEY, '/v', VALUE]);
        sendJson(res, 200, { ok: true, supported: true, enabled: q.ok });
        return true;
      }
      if (!supported) {
        sendJson(res, 400, { ok: false, error: 'Disponível apenas na instalação local (BaldeApp).' });
        return true;
      }
      const body = await readJsonBody(req);
      if (body.enable) {
        const r = await regRun(['add', KEY, '/v', VALUE, '/t', 'REG_SZ', '/d', `"${shellExe}" --autostart`, '/f']);
        sendJson(res, r.ok ? 200 : 500, {
          ok: r.ok,
          enabled: r.ok,
          error: r.ok ? undefined : 'Falha ao gravar a chave de inicialização.'
        });
      } else {
        await regRun(['delete', KEY, '/v', VALUE, '/f']); // ausente já = desligado
        sendJson(res, 200, { ok: true, enabled: false });
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/notify/peek') {
      const since = Number(url.searchParams.get('since'));
      if (!Number.isFinite(since) || since < 0) {
        sendJson(res, 200, { ok: true, last: localNoticeState.seq, events: [] });
        return true;
      }
      const prefs = await loadUserPrefs(actorFromReq(req));
      const enabled = !prefs.notify || prefs.notify.desktop !== false;
      sendJson(res, 200, {
        ok: true,
        last: localNoticeState.seq,
        events: enabled ? localNotices.filter((n) => n.id > since) : []
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/ai-cli/status') {
      const fresh = url.searchParams.get('fresh') === '1';
      sendJson(res, 200, { ok: true, aiMode: AI_MODE, ...(await detectCliClients({ fresh })) });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/ai-cli/login') {
      const body = await readJsonBody(req);
      const client = body.client === 'codex' ? 'codex' : body.client === 'claude' ? 'claude' : null;
      if (!client) {
        sendJson(res, 400, { ok: false, error: 'client deve ser "claude" ou "codex".' });
        return true;
      }
      const result = spawnCliLogin(client);
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/mcp/status') {
      if (!mcpSupported()) {
        sendJson(res, 200, { ok: true, supported: false });
        return true;
      }
      sendJson(res, 200, { ok: true, ...(await mcpStatus()), keyReady: Boolean(currentApiKey()) });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/mcp/setup') {
      if (!mcpSupported()) {
        sendJson(res, 400, {
          ok: false,
          error: 'Setup de MCP local só está disponível na instalação Windows (balde-local).'
        });
        return true;
      }
      const body = await readJsonBody(req);
      const client = ['claude-desktop', 'claude-code', 'codex'].includes(body.client) ? body.client : null;
      if (!client) {
        sendJson(res, 400, { ok: false, error: 'client deve ser "claude-desktop", "claude-code" ou "codex".' });
        return true;
      }
      // Suporte a balde de primeira classe: body.repo escolhe QUAL balde o MCP vai ingerir. Vazio
      // ou "corporate" = default. Um balde específico exige que o usuário tenha acesso — senão a
      // ingestão cairia no corporate por baixo dos panos. Sem acesso: recusa e sugere o balde pessoal.
      const repo = String(body.repo || '')
        .trim()
        .toLowerCase();
      if (repo && repo !== 'corporate') {
        const entry = await repoByName(repo);
        if (!entry) {
          sendJson(res, 404, { ok: false, error: `Balde "${repo}" não encontrado.` });
          return true;
        }
        if (!isRepoMember(entry, reqGroups(req), webActor(req).email)) {
          const suggestion = personalRepoSlug(webActor(req).email || '');
          sendJson(res, 403, {
            ok: false,
            error: `Você não tem acesso ao balde "${entry.titulo || repo}", então não pode ingerir dados nele.`,
            suggestRepo: suggestion,
            hint: 'Crie/use o seu balde pessoal ("Meu Balde") e conecte o MCP a ele para ingerir seus próprios dados.'
          });
          return true;
        }
      }
      const serverName = repo && repo !== 'corporate' ? `balde-${repo}` : 'balde';
      const mcpServerPath = join(rootDir, 'integrations', 'ai-tools', 'mcp-server.mjs');
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        const key = await ensureLocalMachineKey();
        if (client === 'claude-desktop') {
          // Auto-install the Desktop EXTENSION (.mcpb) — no drag, no key to paste. It self-sources the
          // machine key from the DEFAULT launcher (balde-mcp.cmd), so ensure that exists; the target
          // balde comes from the extension's own settings (balde_repo), not a repo-scoped launcher.
          const launcher = await writeMcpLauncher({ nodeExe: process.execPath, mcpServerPath, baseUrl, apiKey: key });
          const result = await setupClaudeDesktopExtension({
            sourceDir: join(rootDir, 'integrations', 'ai-tools'),
            baseUrl,
            repo
          });
          sendJson(res, result.ok ? 200 : 502, { ...result, launcher, repo: repo || 'corporate' });
          return true;
        }
        const launcher = await writeMcpLauncher({
          nodeExe: process.execPath,
          mcpServerPath,
          baseUrl,
          apiKey: key,
          repo
        });
        const result =
          client === 'claude-code'
            ? await setupClaudeCode(launcher, serverName)
            : await setupCodex(launcher, serverName);
        sendJson(res, result.ok ? 200 : 502, { ...result, launcher, repo: repo || 'corporate', serverName });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/sp/status') {
      if (!isAdminReq(req)) {
        sendJson(res, 403, { ok: false, error: 'Apenas admins.' });
        return true;
      }
      if (!SP_CONFIGURED) {
        sendJson(res, 200, { ok: true, configured: false });
        return true;
      }
      const r = await runSharePointScript(['-Action', 'status'], 30000);
      sendJson(res, 200, { ok: true, configured: true, probe: r.output, scriptOk: r.ok });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/sp/sync-balde') {
      if (!isAdminReq(req)) {
        sendJson(res, 403, { ok: false, error: 'Apenas admins.' });
        return true;
      }
      if (!SP_CONFIGURED) {
        sendJson(res, 400, {
          ok: false,
          error: 'SharePoint não configurado (SP_SITE_URL/SP_CLIENT_ID/SP_LIBRARY/SP_ROOT_PATH).'
        });
        return true;
      }
      const body = await readJsonBody(req);
      const entry = await repoByName(
        String(body.name || '')
          .trim()
          .toLowerCase()
      );
      if (!entry) {
        sendJson(res, 404, { ok: false, error: 'Balde não encontrado.' });
        return true;
      }
      const args = ['-Action', 'sync-balde', '-Name', entry.name, '-Emails', (entry.members || []).join(',')];
      if (body.dryRun) args.push('-DryRun');
      const r = await runSharePointScript(args);
      sendJson(res, r.ok ? 200 : 502, { ok: r.ok, output: r.output, error: r.error });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/tools/format-sql') {
      const body = await readJsonBody(req, 512 * 1024);
      const sql = String(body.sql || '');
      if (!sql.trim()) {
        sendJson(res, 200, { ok: false, formatted: sql });
        return true;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const r = await fetch(SQL_FORMATTER_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sql, options: { useTabs: false, keywordCase: 'lower', where11: true } }),
          signal: controller.signal
        });
        const data = r.ok ? await r.json().catch(() => null) : null;
        const formatted = data && typeof data.formatted === 'string' ? data.formatted : sql;
        sendJson(res, 200, { ok: !!(data && typeof data.formatted === 'string'), formatted });
      } catch (error) {
        sendJson(res, 200, { ok: false, formatted: sql }); // identar down/slow → original, no break
      } finally {
        clearTimeout(timer);
      }
      return true;
    }
    return false;
  };
}
