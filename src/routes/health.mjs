import { baldeVersion, encryptedOpenAiKeyPath, feedbackPollMs } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';

export function createHealthRoutes({ sendJson, browserSession }) {
  return async function healthRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const hasEncryptedKey = await pathExists(encryptedOpenAiKeyPath);
      const hasServerKey = Boolean(process.env.OPENAI_API_KEY || (process.env.BALDE_SECRET_KEY && hasEncryptedKey));
      const aiMode = process.env.AI_PROXY_URL
        ? 'department-proxy'
        : process.env.AI_DIRECT_OPENAI === '1' && hasServerKey
          ? 'openai-direct'
          : hasServerKey
            ? 'openai-key-stored-disabled'
            : 'heuristic-local';

      sendJson(res, 200, {
        ok: true,
        application: 'balde-local',
        sessionProof: browserSession.proof(url.searchParams.get('challenge') || ''),
        aiMode,
        graphMode: 'local-corpus',
        feedbackWatch: process.env.FEEDBACK_WATCH === '0' ? 'disabled' : 'enabled',
        feedbackPollMs
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/version') {
      sendJson(res, 200, { ok: true, version: baldeVersion });
      return true;
    }
    return false;
  };
}
