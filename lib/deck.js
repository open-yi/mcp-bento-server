/**
 * deck.js — read/write the `#bento-doc` JSON block inside a `.bento.html` file.
 *
 * A Bento deck is a self-contained HTML file whose document lives in ONE
 * plaintext block near the top:
 *
 *   <script type="application/bento+json" id="bento-doc">
 *   { "format": "bento/slides", ... }
 *   </script>
 *
 * We only ever touch that block; everything else in the file stays untouched.
 * Per the official agent guide, every `<` inside the JSON must be escaped as
 * `\u003c` so the block can never contain a literal `</script>`.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DOC_RE = /(<script\s+type="application\/bento\+json"\s+id="bento-doc">)([\s\S]*?)(<\/script>)/i;

/** Find the #bento-doc block in an HTML string. Returns {before, json, after} or null. */
function splitDocBlock(html) {
  const m = html.match(DOC_RE);
  if (!m) return null;
  return { before: m[1], json: m[2], after: m[3] };
}

/** Escape every `<` as \u003c (required inside the JSON block). */
function escapeDocJson(json) {
  return json.replace(/</g, '\\u003c');
}

/** Unescape \u003c back to `<` for parsing. */
function unescapeDocJson(json) {
  return json.replace(/\\u003c/g, '<');
}

/** Read the document object from a `.bento.html` file on disk. */
function readDeck(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const block = splitDocBlock(html);
  if (!block) throw new Error(`No #bento-doc block found in ${filePath}`);
  const raw = block.json.trim();
  if (!raw) throw new Error(`#bento-doc block is empty in ${filePath} (open it in a browser once to mint a deck, or use "new" to create one)`);
  return JSON.parse(unescapeDocJson(raw));
}

/** Write a document object into the #bento-doc block of a `.bento.html` file. */
function writeDeck(filePath, doc) {
  const html = fs.readFileSync(filePath, 'utf8');
  const block = splitDocBlock(html);
  if (!block) throw new Error(`No #bento-doc block found in ${filePath}`);
  const json = escapeDocJson(JSON.stringify(doc, null, 2));
  const out = html.slice(0, html.indexOf(block.before)) + block.before + '\n' + json + '\n' + block.after +
    html.slice(html.indexOf(block.before) + block.before.length + block.json.length + block.after.length);
  fs.writeFileSync(filePath, out, 'utf8');
}

/**
 * Apply a patch of operations to a document object (mutates and returns it).
 * Supported ops:
 *   createElements: [{ slideId, element }]
 *   updateElements: [{ slideId, id, set }]
 *   deleteElements: [{ slideId, id }]
 *   addSlides:      [ slide ]
 *   updateSlides:   [{ id, set }]
 *   deleteSlides:   [ id ]
 *   duplicateSlide: { id, newId? }
 *   setTheme:       { ...theme fields }
 *   setTitle:       string
 */
function applyPatch(doc, ops) {
  if (!doc.slides || !Array.isArray(doc.slides)) throw new Error('document has no slides array');

  const byId = (id) => doc.slides.find(s => s.id === id);

  if (ops.setTitle) doc.title = ops.setTitle;

  // full-document replacement (used by import-json)
  if (ops.setDoc) {
    const d = ops.setDoc;
    if (!d.format || !d.size || !d.theme || !Array.isArray(d.slides)) {
      throw new Error('setDoc must be a full document: {format, size, theme, slides}' + ' (format:' + !!d.format + ' size:' + !!d.size + ' theme:' + !!d.theme + ' slides:' + Array.isArray(d.slides) + ')');
    }
    for (const k of Object.keys(doc)) delete doc[k];
    Object.assign(doc, JSON.parse(JSON.stringify(d)));
    return doc;
  }

  if (ops.setTheme) {
    doc.theme = Object.assign({}, doc.theme || {}, ops.setTheme);
    if (!doc.theme.fontFamily) doc.theme.fontFamily = 'system-ui, sans-serif';
  }

  if (ops.addSlides) {
    for (const s of ops.addSlides) {
      if (!s.id) s.id = 's' + (doc.slides.length + 1);
      if (!s.elements) s.elements = [];
      // new slides inherit the theme background so presenting never shows black
      if (!s.background && doc.theme && doc.theme.background) s.background = doc.theme.background;
      doc.slides.push(s);
    }
  }

  if (ops.updateSlides) {
    for (const u of ops.updateSlides) {
      const s = byId(u.id);
      if (!s) throw new Error('slide not found: ' + u.id);
      Object.assign(s, u.set);
    }
  }

  if (ops.deleteSlides) {
    for (const id of ops.deleteSlides) {
      const i = doc.slides.findIndex(s => s.id === id);
      if (i === -1) throw new Error('slide not found: ' + id);
      doc.slides.splice(i, 1);
    }
  }

  if (ops.duplicateSlide) {
    const src = byId(ops.duplicateSlide.id);
    if (!src) throw new Error('slide not found: ' + ops.duplicateSlide.id);
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = ops.duplicateSlide.newId || (src.id + '-copy');
    // element ids stay the same so morph pairs with the original
    doc.slides.splice(doc.slides.indexOf(src) + 1, 0, copy);
  }

  if (ops.createElements) {
    for (const c of ops.createElements) {
      const s = byId(c.slideId);
      if (!s) throw new Error('slide not found: ' + c.slideId);
      if (!s.elements) s.elements = [];
      if (!c.element.id) c.element.id = 'el' + (s.elements.length + 1);
      s.elements.push(c.element);
    }
  }

  if (ops.updateElements) {
    for (const u of ops.updateElements) {
      const s = byId(u.slideId);
      if (!s) throw new Error('slide not found: ' + u.slideId);
      const el = (s.elements || []).find(e => e.id === u.id);
      if (!el) continue; // tolerate stale ids in batches — skip, don't fail
      Object.assign(el, u.set);
    }
  }

  if (ops.deleteElements) {
    for (const d of ops.deleteElements) {
      const s = byId(d.slideId);
      if (!s) throw new Error('slide not found: ' + d.slideId);
      if (!s.elements) continue;
      const i = s.elements.findIndex(e => e.id === d.id);
      if (i === -1) throw new Error('element not found: ' + d.id);
      s.elements.splice(i, 1);
    }
  }

  return doc;
}

/** Minimum valid document (size + theme incl. fontFamily are required to boot). */
function minimalDoc(title = 'Untitled deck') {
  return {
    format: 'bento/slides',
    version: 1,
    title,
    size: { width: 1280, height: 720 },
    theme: {
      background: '#101418',
      color: '#F2F0EA',
      accent: '#FF9E8A',
      fontFamily: 'system-ui, sans-serif'
    },
    slides: [
      {
        id: 's1',
        background: '#101418',
        transition: 'none',
        notes: '',
        elements: [
          {
            id: 't1', type: 'text', x: 96, y: 260, w: 1088, h: 160,
            rotation: 0, opacity: 1,
            html: title,
            fontSize: 88, fontFamily: 'system-ui, sans-serif',
            fontWeight: 800, color: '#F2F0EA',
            align: 'left', valign: 'top', lineHeight: 1.1
          }
        ]
      }
    ]
  };
}

/** Create a new deck file from the bundled official template, injecting a minimal doc. */
function newDeck(filePath, title = 'Untitled deck') {
  const tpl = path.join(__dirname, '..', 'assets', 'Bento_Slides.bento.html');
  fs.copyFileSync(tpl, filePath);
  writeDeck(filePath, minimalDoc(title));
  return readDeck(filePath);
}

module.exports = { readDeck, writeDeck, newDeck, minimalDoc, applyPatch, escapeDocJson, unescapeDocJson, splitDocBlock };
