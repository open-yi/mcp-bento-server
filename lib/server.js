/**
 * server.js — local HTTP + SSE server.
 *
 * Responsibilities:
 *  - Serve the bundled Bento editor page on http://127.0.0.1:3900/, injecting
 *    the current document into the `#bento-doc` block and a small bridge
 *    script before `</body>` (dynamic injection — the file on disk stays clean).
 *  - Broadcast `doc-updated` over SSE so an open browser tab auto-reloads and
 *    shows the latest edits (the human's live preview).
 *  - Expose a tiny JSON API for the CLI: open / read / patch / save / validate.
 *  - Collect programmatic self-check results (validate/measure) posted back by
 *    the bridge, so a non-vision agent can verify quality without screenshots.
 *
 * Zero runtime dependencies — Node built-ins only.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const deck = require('./deck');

const ASSET = path.join(__dirname, '..', 'assets', 'Bento_Slides.bento.html');
const BRIDGE = path.join(__dirname, 'bridge.js');

const DOC_RE = /(<script\s+type="application\/bento\+json"\s+id="bento-doc">)([\s\S]*?)(<\/script>)/i;

class BentoServer {
  constructor({ port = 3900, host = '127.0.0.1' } = {}) {
    this.port = port;
    this.host = host;
    this.doc = null;            // active document (in-memory working copy)
    this.deckFile = null;       // active .bento.html path
    this.validateResult = null; // last programmatic self-check result
    this.measureResult = null;   // last measure result
    this.browserConnected = false;
    this.bentoKeys = null;      // window.bento API surface reported by the tab
    this.browserEvents = [];    // diagnostic trail from the tab (sse/loaddoc)
    this.sseClients = new Set();
    this.server = null;
  }

  // ---------------------------------------------------------------- helpers

  _json(res, code, data) {
    const body = JSON.stringify(data);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
  }

  _broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) client.write(payload);
  }

  _browserTabHtml() {
    let html = fs.readFileSync(ASSET, 'utf8');
    // inject current doc into the #bento-doc block
    if (this.doc) {
      const block = html.match(DOC_RE);
      if (block) {
        const json = deck.escapeDocJson(JSON.stringify(this.doc, null, 2));
        html = html.slice(0, html.indexOf(block[0])) + block[1] + '\n' + json + '\n' + block[3] +
          html.slice(html.indexOf(block[0]) + block[0].length);
      }
    }
    // inject bridge script before </body>
    const bridge = fs.readFileSync(BRIDGE, 'utf8');
    const marker = html.lastIndexOf('</body>');
    if (marker !== -1) {
      html = html.slice(0, marker) + `<script>${bridge}</script>` + html.slice(marker);
    }
    return html;
  }

  // ---------------------------------------------------------------- document ops

  _broadcastDoc() {
    // push the full document so the browser can loadDoc() in place — no reload
    this._broadcast('doc-updated', { file: this.deckFile, doc: this.doc });
  }

  open(filePath) {
    this.doc = deck.readDeck(filePath);
    this.deckFile = filePath;
    this._broadcastDoc();
    return this._summary();
  }

  newDeck(filePath, title) {
    this.doc = deck.newDeck(filePath, title);
    this.deckFile = filePath;
    this._broadcastDoc();
    return this._summary();
  }

  read() {
    if (!this.doc) throw new Error('No deck open. Use open <file> or new first.');
    return { file: this.deckFile, doc: this.doc };
  }

  patch(ops) {
    if (!this.doc) throw new Error('No deck open. Use open <file> or new first.');
    this.doc = deck.applyPatch(this.doc, ops);
    if (this.deckFile) deck.writeDeck(this.deckFile, this.doc);
    this._broadcastDoc();
    return this._summary();
  }

  save() {
    if (!this.doc || !this.deckFile) throw new Error('Nothing to save.');
    deck.writeDeck(this.deckFile, this.doc);
    return { ok: true, file: this.deckFile };
  }

  // Ask the browser tab (if connected) to run window.bento.validate() and post
  // the result back. Falls back to the last cached result; times out gracefully.
  async runValidate(timeoutMs = 8000) {
    if (!this.browserConnected) {
      return { ok: false, error: 'No browser tab connected. Open http://127.0.0.1:' + this.port + '/ in a browser first.', cached: this.validateResult };
    }
    this._broadcast('validate-request', { id: Date.now() });
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (this.validateResult && this.validateResult._ts >= t0) break;
      await new Promise(r => setTimeout(r, 150));
    }
    return this.validateResult
      ? { ok: true, result: this.validateResult }
      : { ok: false, error: 'validate timed out (no result posted back).', cached: this.validateResult };
  }

  // Ask the browser tab to run window.bento.measure(spec) and post the result
  // back. Times out gracefully when no tab is connected.
  async runMeasure(spec, timeoutMs = 8000) {
    if (!this.browserConnected) {
      return { ok: false, error: 'No browser tab connected. Open http://127.0.0.1:' + this.port + '/ in a browser first.' };
    }
    this._broadcast('measure-request', { id: Date.now(), spec });
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (this.measureResult && this.measureResult._ts >= t0) break;
      await new Promise(r => setTimeout(r, 150));
    }
    return this.measureResult
      ? { ok: true, result: this.measureResult }
      : { ok: false, error: 'measure timed out (no result posted back).' };
  }

  status() {
    return {
      ok: true,
      port: this.port,
      browserConnected: this.browserConnected,
      bentoKeys: this.bentoKeys,
      browserEvents: this.browserEvents.slice(-10),
      deckFile: this.deckFile,
      slides: this.doc ? this.doc.slides.length : 0,
      title: this.doc ? this.doc.title : null
    };
  }

  _summary() {
    return {
      ok: true,
      file: this.deckFile,
      title: this.doc ? this.doc.title : null,
      slides: this.doc ? this.doc.slides.length : 0,
      elements: this.doc ? this.doc.slides.reduce((n, s) => n + (s.elements ? s.elements.length : 0), 0) : 0
    };
  }

  // ---------------------------------------------------------------- HTTP routing

  _handleApi(req, res, url) {
    const p = url.pathname;

    // browser bridge posts results back
    if (p === '/api/browser-result' && req.method === 'POST') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try {
          const msg = JSON.parse(body);
          if (msg.type === 'hello') {
            this.browserConnected = true;
            this.bentoKeys = msg.bentoKeys || null;
          }
          if (msg.type === 'sse-open' || msg.type === 'sse-error' || msg.type === 'loaddoc-ok' || msg.type === 'loaddoc-error' || msg.type === 'loaddoc-skip') {
            this.browserEvents.push({ type: msg.type, ...msg, _ts: Date.now() });
            if (this.browserEvents.length > 50) this.browserEvents.shift();
          }
          else if (msg.type === 'validate') {
            this.validateResult = { ...msg.data, _ts: Date.now() };
          }
          else if (msg.type === 'measure') {
            this.measureResult = { ...msg.data, _ts: Date.now() };
          }
          this._json(res, 200, { ok: true });
        } catch (e) {
          this._json(res, 400, { ok: false, error: String(e) });
        }
      });
      return true;
    }

    // CLI JSON API
    const send = (fn) => {
      try { this._json(res, 200, fn()); }
      catch (e) { this._json(res, 500, { ok: false, error: e.message }); }
      return true;
    };
    const readBody = (cb) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => { try { cb(JSON.parse(body || '{}')); } catch (e) { this._json(res, 400, { ok: false, error: 'bad json: ' + e.message }); } });
      return true;
    };

    switch (p) {
      case '/api/status': return send(() => this.status());
      case '/api/read': return send(() => this.read());
      case '/api/save': return send(() => this.save());
      case '/api/open': return readBody(b => send(() => this.open(b.file)));
      case '/api/new': return readBody(b => send(() => this.newDeck(b.file, b.title)));
      case '/api/patch': return readBody(b => send(() => this.patch(b.ops)));
      case '/api/validate': return (async () => {
        try { this._json(res, 200, await this.runValidate()); }
        catch (e) { this._json(res, 500, { ok: false, error: e.message }); }
      })();
      case '/api/measure': return readBody(b => (async () => {
        try { this._json(res, 200, await this.runMeasure(b.spec)); }
        catch (e) { this._json(res, 500, { ok: false, error: e.message }); }
      })());
      case '/api/stop': return send(() => {
        setTimeout(() => { try { this.server && this.server.close(); } catch (e) {} }, 50);
        return { ok: true };
      });
      default: return false;
    }
  }

  start() {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${this.host}:${this.port}`);
      // SSE stream for the browser tab (checked BEFORE the /api/ prefix)
      if (url.pathname === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        res.write(': connected\n\n');
        this.sseClients.add(res);
        req.on('close', () => this.sseClients.delete(res));
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (this._handleApi(req, res, url)) return;
        return this._json(res, 404, { ok: false, error: 'unknown api' });
      }
      // everything else → the editor page
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this._browserTabHtml());
    });
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener('error', reject);
        resolve(this);
      });
    });
  }

  stop() {
    if (this.server) this.server.close();
    this.server = null;
  }
}

module.exports = { BentoServer };
