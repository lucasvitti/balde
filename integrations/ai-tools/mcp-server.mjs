#!/usr/bin/env node
// Zero-dependency MCP (Model Context Protocol) server exposing Balde's skills tools
// over stdio — appears natively in Claude Desktop / Claude Code / Claude.ai connectors,
// and works with any MCP-capable client. JSON-RPC 2.0, newline-delimited, over stdin/stdout.
//
//   node /abs/path/to/mcp-server.mjs      (env: BALDE_API_KEY required, BALDE_BASE_URL optional)
//
// stdout carries ONLY protocol messages; never write logs there.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { mcpTools, executeTool } from './tools.mjs';

// Self-source local credentials: when this server runs as a Claude Desktop .mcpb on a machine that
// has the Balde app installed, the extension's user_config key can be left BLANK (Desktop stores
// keys encrypted, so an installer can't write one) — we read the app's launcher instead, which the
// local server keeps current with the machine key + port. That makes the Desktop extension a
// zero-config, one-click install: no key to paste, no encrypted blob to forge. No-op when creds are
// already in the env (the Code/Codex launcher sets them) or when the launcher is absent (a remote
// connection, where user_config supplies the key normally).
function selfSourceLocalCreds() {
  if (process.env.BALDE_API_KEY && process.env.BALDE_BASE_URL) return;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return;
  const launcher = join(localAppData, 'Balde', 'balde-mcp.cmd');
  if (!existsSync(launcher)) return;
  let cmd = '';
  try { cmd = readFileSync(launcher, 'utf8'); } catch { return; }
  const read = (key) => (cmd.match(new RegExp(`set "${key}=([^"]*)"`)) || [])[1] || '';
  if (!process.env.BALDE_API_KEY) { const k = read('BALDE_API_KEY'); if (k) process.env.BALDE_API_KEY = k; }
  if (!process.env.BALDE_BASE_URL) { const u = read('BALDE_BASE_URL'); if (u) process.env.BALDE_BASE_URL = u; }
}
selfSourceLocalCreds();

const SERVER_INFO = { name: 'balde-knowledge', version: '1.8.5' };
const DEFAULT_PROTOCOL = '2025-06-18';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}
function rpcError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      result(id, {
        protocolVersion: (params && params.protocolVersion) || DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      });
      return;

    case 'notifications/initialized':
    case 'initialized':
      return; // notification — no response

    case 'ping':
      if (!isNotification) result(id, {});
      return;

    case 'tools/list':
      result(id, { tools: mcpTools() });
      return;

    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      try {
        const value = await executeTool(name, args);
        result(id, { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
      } catch (err) {
        // Tool-execution failures are reported as isError content, not JSON-RPC errors.
        result(id, { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
      }
      return;
    }

    default:
      if (!isNotification) rpcError(id, -32601, `Method not found: ${method}`);
      return;
  }
}

function dispatch(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const items = Array.isArray(msg) ? msg : [msg]; // tolerate JSON-RPC batches
  for (const item of items) {
    Promise.resolve(handle(item)).catch((err) => {
      if (item && item.id != null) rpcError(item.id, -32603, `Internal error: ${err.message}`);
    });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) dispatch(line);
  }
});
process.stdin.on('end', () => process.exit(0));
