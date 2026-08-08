/**
 * client.js — shared HTTP API client for the local Bento server.
 * Used by both the CLI (bin/bento-mcp.js) and the MCP server (lib/mcp.js).
 * Auto-starts the background server process when needed.
 */
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.BENTO_PORT || 3900);
const SERVER_MAIN = path.join(__dirname, 'server-main.js');

function api(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: HOST, port: PORT, path: p, method, headers: data ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let out = '';
      res.on('data', c => (out += c));
      res.on('end', () => {
        try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('bad response: ' + out.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function serverUp() {
  try {
    const s = await api('GET', '/api/status');
    return s && s.ok;
  } catch (e) { return false; }
}

function startBackgroundServer() {
  const child = spawn(process.execPath, [SERVER_MAIN, String(PORT)], {
    detached: true, stdio: 'ignore', env: { ...process.env, BENTO_PORT: String(PORT) }
  });
  child.unref();
}

const PREVIEW_URL = `http://${HOST}:${PORT}/`;

/** Open the live-preview page in the default browser (Windows + POSIX). */
function openBrowser(url = PREVIEW_URL) {
  const { execSync } = require('child_process');
  try {
    if (process.platform === 'win32') {
      execSync(`start "" "${url}"`, { shell: 'cmd.exe', windowsHide: false });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    }
  } catch (e) { /* non-fatal */ }
}

/** Open the browser only when no tab is connected yet (avoid popping a new tab
 * on every command). Call after open/new/serve. */
async function maybeOpenBrowser() {
  try {
    const s = await api('GET', '/api/status');
    if (s && !s.browserConnected) openBrowser();
  } catch (e) { /* ignore */ }
}

module.exports = { api, ensureServer, serverUp, startBackgroundServer, maybeOpenBrowser, openBrowser, HOST, PORT, PREVIEW_URL };

/** Ensure the background server is up; returns true when ready. */
async function ensureServer() {
  if (await serverUp()) return true;
  startBackgroundServer();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (await serverUp()) return true;
  }
  throw new Error('Failed to start local server on port ' + PORT);
}
