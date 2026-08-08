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
    this.viewResult = null;      // last rendered layout snapshot
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

  _broadcastDoc(activeSlideId) {
    // push the full document so the browser can loadDoc() in place — no reload
    let active = null;
    if (activeSlideId && this.doc && Array.isArray(this.doc.slides)) {
      const i = this.doc.slides.findIndex(s => s && s.id === activeSlideId);
      active = i >= 0 ? i : null;
    }
    this._broadcast('doc-updated', { file: this.deckFile, doc: this.doc, active });
  }

  open(filePath) {
    this.doc = deck.readDeck(filePath);
    this.deckFile = filePath;
    this._broadcastDoc();
    return this._summary();
  }

  newDeck(filePath, title, templateName) {
    const { makeDoc } = require('./templates');
    const doc = makeDoc(templateName || 'blank', title || 'Untitled deck');
    const tpl = path.join(__dirname, '..', 'assets', 'Bento_Slides.bento.html');
    fs.copyFileSync(tpl, filePath);
    deck.writeDeck(filePath, doc);
    this.doc = deck.readDeck(filePath);
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
    const hadSetDoc = !!ops.setDoc && Array.isArray(ops.setDoc.slides) && ops.setDoc.slides.length > 1;
    const beforeDoc = JSON.parse(JSON.stringify(this.doc));
    this.doc = deck.applyPatch(this.doc, ops);
    if (this.deckFile) deck.writeDeck(this.deckFile, this.doc);
    // which slide should the browser activate? agent can say, else infer from
    // the ops — editing any slide jumps the browser there automatically
    const activeId = ops.activeSlideId
      || (ops.addSlides && ops.addSlides[0] && ops.addSlides[0].id)
      || (ops.duplicateSlide && (ops.duplicateSlide.newId || ops.duplicateSlide.id))
      || (ops.createElements && ops.createElements[0] && ops.createElements[0].slideId)
      || (ops.updateElements && ops.updateElements[0] && ops.updateElements[0].slideId)
      || (ops.deleteElements && ops.deleteElements[0] && ops.deleteElements[0].slideId);
    // collect elements to reveal progressively
    const newElements = [];
    if (ops.createElements && Array.isArray(ops.createElements)) {
      for (const c of ops.createElements) newElements.push({ slideId: c.slideId, element: c.element });
    }
    if (ops.addSlides && Array.isArray(ops.addSlides)) {
      for (const sl of ops.addSlides) {
        for (const e of (sl.elements || [])) newElements.push({ slideId: sl.id, element: e });
      }
    }
    this._progressiveGen = (this._progressiveGen || 0) + 1;
    const gen = this._progressiveGen;
    if (hadSetDoc) {
      // progressive preview: reveal the deck page by page for a live feel
      this._progressiveImport(ops.setDoc, gen);
    } else if (ops.stream && ops.updateElements && ops.updateElements.length) {
      // typing effect: reveal updated text word/chunk by chunk
      this._streamTextUpdates(ops.updateElements, gen, 100);
    } else if (newElements.length > 1 || (ops.updateElements && ops.updateElements.length > 1)) {
      // element-by-element reveal so the user watches the page change live
      this._streamElementReveal(beforeDoc, newElements, ops.updateElements || [], gen, 100, activeId ? this.doc.slides.findIndex(s => s.id === activeId) : null);
    } else {
      this._broadcastDoc(activeId);
    }
    return this._summary();
  }

  // Reveal multiple new/updated elements one at a time (~100ms each) so the
  // user sees the page being built, instead of a whole batch appearing at once.
  async _streamElementReveal(beforeDoc, newElements, updates, gen, stepMs = 100, activeIndex = null) {
    const total = Math.max(newElements.length, updates.length);
    for (let i = 1; i <= total; i++) {
      if (gen !== this._progressiveGen) return;
      const partial = JSON.parse(JSON.stringify(beforeDoc));
      for (let j = 0; j < i && j < newElements.length; j++) {
        const c = newElements[j];
        const slide = partial.slides.find(s => s.id === c.slideId);
        if (!slide) continue;
        if (!slide.elements) slide.elements = [];
        if (!slide.elements.find(e => e.id === c.element.id)) {
          slide.elements.push(JSON.parse(JSON.stringify(c.element)));
        }
      }
      for (let j = 0; j < i && j < updates.length; j++) {
        const u = updates[j];
        const slide = partial.slides.find(s => s.id === u.slideId);
        const el = slide && slide.elements.find(e => e.id === u.id);
        if (el) Object.assign(el, JSON.parse(JSON.stringify(u.set)));
      }
      this._broadcast('doc-updated', { file: this.deckFile, doc: partial, active: activeIndex });
      await new Promise(r => setTimeout(r, stepMs));
    }
    if (gen === this._progressiveGen) this._broadcast('doc-updated', { file: this.deckFile, doc: this.doc, active: activeIndex });
  }

  // Broadcast an incremental text reveal for a typing feel. Each step pushes the
  // full doc with the text element's html truncated to the next chunk. The file
  // was already written with the full text; this is preview only.
  async _streamTextUpdates(updates, gen, chunkMs = 120) {
    const slideIdx = (id) => this.doc.slides.findIndex(s => s.id === id);
    const buildDoc = (progress) => {
      const partial = JSON.parse(JSON.stringify(this.doc));
      for (const u of updates) {
        const si = slideIdx(u.slideId);
        if (si < 0) continue;
        const el = (partial.slides[si].elements || []).find(e => e.id === u.id);
        if (!el || typeof u.set.html !== 'string') continue;
        el.html = progress[u.slideId + ':' + u.id] || '';
      }
      return partial;
    };
    // build chunk lists: split on words for latin, chars otherwise
    const chunks = {};
    let maxLen = 0;
    for (const u of updates) {
      const html = String(u.set.html || '');
      const words = html.split(/(\s+)/); // keep spaces
      const merged = [];
      let acc = '';
      for (const w of words) {
        acc += w;
        if (acc.length >= 6 || /\s$/.test(w)) { merged.push(acc); acc = ''; }
      }
      if (acc) merged.push(acc);
      const list = merged.length ? merged : [html];
      chunks[u.slideId + ':' + u.id] = list;
      maxLen = Math.max(maxLen, list.length);
    }
    let progress = {};
    for (let i = 0; i < maxLen; i++) {
      if (gen !== this._progressiveGen) return;
      for (const u of updates) {
        const key = u.slideId + ':' + u.id;
        const list = chunks[key];
        if (list && i < list.length) progress[key] = (progress[key] || '') + list[i];
      }
      this._broadcast('doc-updated', { file: this.deckFile, doc: buildDoc(progress) });
      await new Promise(r => setTimeout(r, chunkMs));
    }
    // final: full doc (guarantees the last chunk lands exactly)
    if (gen === this._progressiveGen) this._broadcast('doc-updated', { file: this.deckFile, doc: this.doc });
  }

  // Reveal a full document incrementally (one slide at a time) over SSE, so the
  // browser shows the deck "growing" instead of replacing everything at once.
  // Only a preview — the file was already written with the full document.
  async _progressiveImport(doc, gen, stepMs = 400) {
    const slides = doc.slides || [];
    for (let i = 1; i <= slides.length; i++) {
      if (gen !== this._progressiveGen) return; // superseded by a newer edit
      const partial = JSON.parse(JSON.stringify(doc));
      partial.slides = slides.slice(0, i);
      this._broadcast('doc-updated', { file: this.deckFile, doc: partial, active: i - 1 });
      await new Promise(r => setTimeout(r, stepMs));
    }
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
      browserConnected: this.sseClients.size > 0, // live: an open tab keeps an SSE connection
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
          else if (msg.type === 'view') {
            this.viewResult = { text: msg.data, _ts: Date.now() };
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
      case '/api/user-edit': return readBody(b => {
        // reverse sync: user's manual edits in the browser flow back to the
        // server so agent read/patch always see the latest. NO broadcast back
        // (that would overwrite the user's in-progress edit).
        if (b.doc && b.doc.format) {
          this.doc = b.doc;
          if (this.deckFile) {
            try { deck.writeDeck(this.deckFile, this.doc); } catch (e) {}
          }
          this.userEditedAt = Date.now();
        }
        return true;
      });
      case '/api/status': return send(() => this.status());
      case '/api/read': return send(() => this.read());
      case '/api/save': return send(() => this.save());
      case '/api/open': return readBody(b => send(() => this.open(b.file)));
      case '/api/new': return readBody(b => send(() => this.newDeck(b.file, b.title, b.template)));
      case '/api/patch': return readBody(b => send(() => this.patch(b.ops)));
      case '/api/present-exit': return (() => {
        this._broadcast('present-exit', {});
        this._json(res, 200, { ok: true });
        return true;
      })();
      case '/api/present-step': return (() => {
        try {
          let body = '';
          req.on('data', c => (body += c));
          req.on('end', () => {
            try {
              const b = JSON.parse(body || '{}');
              this._broadcast('present-step', { dir: Number(b.dir) || 0 });
              this._json(res, 200, { ok: true });
            } catch (e) { this._json(res, 400, { ok: false, error: String(e) }); }
          });
        } catch (e) { this._json(res, 500, { ok: false, error: String(e) }); }
        return true;
      })();
      case '/api/present': return (() => {
        try {
          let body = '';
          req.on('data', c => (body += c));
          req.on('end', () => {
            try {
              const b = JSON.parse(body || '{}');
              this._broadcast('present', { fullscreen: !!b.fullscreen });
              this._json(res, 200, { ok: true });
            } catch (e) { this._json(res, 400, { ok: false, error: String(e) }); }
          });
        } catch (e) { this._json(res, 500, { ok: false, error: String(e) }); }
        return true;
      })();
      case '/api/view': return (async () => {
        try {
          if (!this.browserConnected) { this._json(res, 200, { ok: false, error: 'No browser tab connected. Open http://127.0.0.1:' + this.port + '/ in a browser first.' }); return; }
          this._broadcast('view-request', { id: Date.now() });
          const t0 = Date.now();
          let result = null;
          while (Date.now() - t0 < 8000) {
            if (this.viewResult && this.viewResult._ts >= t0) { result = this.viewResult; break; }
            await new Promise(r => setTimeout(r, 150));
          }
          this._json(res, 200, result ? { ok: true, view: result } : { ok: false, error: 'view timed out' });
        } catch (e) { this._json(res, 500, { ok: false, error: e.message }); }
      })();
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
