/**
 * client.js — shared HTTP API client for the local Bento server.
 * Used by both the CLI (bin/bento-mcp.js) and the MCP server (lib/mcp.js).
 * Auto-starts the background server process when needed.
 */
'use strict';

const http = require('http');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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

const PREVIEW_URL = 'http://' + HOST + ':' + PORT + '/';

// ── cross-platform browser auto-open ─────────────────────────────
// Resolves the user's DEFAULT browser (no hardcoded guesses) and opens it.
// Works from interactive terminals (Windows / macOS / Linux desktop). From a
// Windows service session (e.g. pi-web on Session 0) it launches via a
// scheduled task in the user's interactive session. Degrades gracefully to a
// manual hint. Never blocks or throws.

function winUserSids() {
  try {
    const out = execSync('reg query HKU', { encoding: 'utf8', windowsHide: true });
    return out.split(/\r?\n/).map(l => l.trim()).filter(l => /^S-1-5-21-/.test(l) && /-500$/.test(l));
  } catch (e) { return []; }
}

function winDefaultBrowserExe() {
  const progIdFrom = (root) => {
    try {
      const r = execSync('reg query "' + root + '\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId', { encoding: 'utf8', windowsHide: true });
      const m = r.match(/REG_SZ\s+(\S+)/);
      if (m) {
        const cmd = execSync('reg query "HKCR\\' + m[1] + '\\shell\\open\\command" /ve', { encoding: 'utf8', windowsHide: true });
        const exe = cmd.match(/"([^"]+\.exe)"/i);
        if (exe && fs.existsSync(exe[1])) return exe[1];
      }
    } catch (e) {}
    return null;
  };
  // interactive user first, then HKU profile SIDs (works from a service session)
  const fromHkcu = progIdFrom('HKCU');
  if (fromHkcu) return fromHkcu;
  for (const sid of winUserSids()) {
    const fromHku = progIdFrom('HKU\\' + sid);
    if (fromHku) return fromHku;
  }
  return null;
}

function winLaunchAsUser(exe, url) {
  try {
    const task = 'bento-open-browser';
    execSync('schtasks /create /tn "' + task + '" /tr "\"' + exe + '\" ' + url + '" /sc once /st 23:59 /ru Administrator /it /f', { stdio: 'ignore', windowsHide: true });
    execSync('schtasks /run /tn "' + task + '"', { stdio: 'ignore', windowsHide: true });
    return true;
  } catch (e) { return false; }
}

function linuxDefaultBrowser() {
  // 1) $BROWSER is the classic env override
  if (process.env.BROWSER && process.env.BROWSER.trim()) return process.env.BROWSER.trim().split(/\s+/)[0];
  // 2) ask xdg-settings for the DE's default (e.g. firefox.desktop) and read its Exec
  try {
    const desktop = execSync('xdg-settings get default-web-browser', { encoding: 'utf8', windowsHide: true }).trim();
    if (desktop && desktop !== 'xdg-settings') {
      const dirs = ['/usr/share/applications/', '/usr/local/share/applications/', process.env.HOME + '/.local/share/applications/'];
      for (const dir of dirs) {
        const f = dir + desktop;
        if (fs.existsSync(f)) {
          const content = fs.readFileSync(f, 'utf8');
          const m = content.match(/^Exec=(.+)$/m);
          if (m) return m[1].trim().split(/\s+/)[0]; // strip "%u" args etc.
        }
      }
    }
  } catch (e) {}
  // 3) common locations (deb / rpm / snap / flatpak)
  const common = [
    '/usr/bin/firefox', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/firefox',
    '/snap/bin/chromium', '/var/lib/flatpak/exports/bin/org.mozilla.firefox'
  ];
  for (const c of common) if (fs.existsSync(c)) return c;
  return null;
}

function openBrowser(url) {
  url = url || PREVIEW_URL;
  const p = process.platform;
  const run = (cmd, args) => {
    try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); return true; }
    catch (e) { return false; }
  };
  // interactive desktop vs service session. SESSIONNAME is set in interactive
  // terminals; fall back to the current process SessionId (0 = service).
  let interactive = !!process.env.SESSIONNAME;
  if (!interactive && p === 'win32') {
    try {
      const out = execSync('powershell -NoProfile -Command "(Get-Process -Id $PID).SessionId"', { encoding: 'utf8', windowsHide: true });
      interactive = parseInt(out.trim(), 10) !== 0;
    } catch (e) {}
  }

  if (p === 'win32') {
    const exe = winDefaultBrowserExe();
    if (exe) {
      if (interactive) {
        if (run(exe, [url])) return true;           // user's desktop session
      } else {
        if (winLaunchAsUser(exe, url)) return true; // service → user session task
      }
    }
    // fallbacks (shell forwards to the desktop default browser)
    try { execSync('explorer "' + url + '"', { windowsHide: true }); return true; } catch (e) {}
    try { execSync('start "" "' + url + '"', { shell: 'cmd.exe' }); return true; } catch (e) {}
    return false;
  }
  if (p === 'darwin') return run('open', [url]); // macOS `open` uses the default browser
  // linux / other: resolve the default browser first, then fall back to launchers
  const linuxExe = linuxDefaultBrowser();
  if (linuxExe && run(linuxExe, [url])) return true;
  const fallbacks = [['xdg-open', [url]], ['gio', ['open', url]], ['sensible-browser', [url]]];
  for (const fb of fallbacks) if (run(fb[0], fb[1])) return true;
  return false;
}

/** Try to open the browser when no tab is connected; wait briefly for the
 *  SSE socket to confirm, then degrade to a manual hint. */
async function maybeOpenBrowser() {
  try {
    const s = await api('GET', '/api/status');
    if (!s || s.browserConnected) return; // already watching
    const opened = openBrowser();
    if (!opened) {
      process.stderr.write('\n[bento-mcp] no browser found to auto-open — open ' + PREVIEW_URL + ' manually.\n');
      return;
    }
    // confirm via the socket (up to ~5s)
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 200));
      const st = await api('GET', '/api/status').catch(() => null);
      if (st && st.browserConnected) return; // connected — success
    }
    process.stderr.write('\n[bento-mcp] preview opened but not connected yet — if you don\'t see it, open ' + PREVIEW_URL + ' manually.\n');
  } catch (e) { /* non-fatal */ }
}

module.exports = { api, ensureServer, serverUp, startBackgroundServer, maybeOpenBrowser, openBrowser, HOST, PORT, PREVIEW_URL };
