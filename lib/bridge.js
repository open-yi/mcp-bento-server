/* mcp-bento-server bridge — injected into the served editor page at runtime.
 * (Never written to disk; the .bento.html file on disk stays pristine.)
 *
 * 1. Tells the server the browser tab is online.
 * 2. Subscribes to SSE; on `doc-updated` it reloads the page so the editor
 *    re-reads the latest #bento-doc (live preview for the human).
 * 3. On `validate-request` it runs window.bento.validate() and posts the
 *    structured report back, so a non-vision agent can self-check quality.
 */
(function () {
  var ORIGIN = location.origin;

  function post(msg) {
    try {
      fetch(ORIGIN + '/api/browser-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
      }).catch(function () {});
    } catch (e) {}
  }

  // Report the API surface once window.bento has booted (it loads async).
  function reportReady() {
    post({ type: 'hello', bentoKeys: window.bento ? Object.keys(window.bento) : [] });
  }

  // Track the hash of the last server doc we applied, so we can tell whether
  // the user has since edited locally (and must NOT be clobbered).
  var lastApplied = null;
  var docHash = function (d) { try { return JSON.stringify(d); } catch (e) { return '?'; } };

  // Pull the latest document from the server ONLY when the tab is not carrying
  // local user edits (page load / server restart). If the user has edited the
  // deck manually in the browser, we leave it alone.
  function syncDoc() {
    if (!window.bento || typeof window.bento.loadDoc !== 'function') {
      setTimeout(syncDoc, 300);
      return;
    }
    fetch(ORIGIN + '/api/read').then(function (r) { return r.json(); }).then(function (res) {
      if (!res || !res.doc) return;
      var next = JSON.stringify(res.doc);
      var cur = docHash(window.bento.doc);
      if (cur === next) return;              // already in sync
      if (lastApplied && cur !== lastApplied) return; // user edited locally — don't clobber
      applyDoc(next, readActive());
      lastDoc = res.doc;
    }).catch(function () { setTimeout(syncDoc, 1500); });
  }

  if (window.bento) { reportReady(); syncDoc(); }
  else {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (window.bento || tries > 20) {
        clearInterval(iv);
        reportReady();
        if (window.bento) syncDoc();
      }
    }, 500);
  }

  // Auto-run validate once the deck has booted (agent gets fresh results).
  function tryValidate() {
    if (window.bento && typeof window.bento.validate === 'function') {
      try {
        post({ type: 'validate', data: window.bento.validate() });
      } catch (e) {}
    } else if (typeof window.bento !== 'undefined') {
      // Some shells expose validate lazily; retry briefly.
      setTimeout(tryValidate, 500);
    }
  }
  if (document.readyState === 'complete') tryValidate();
  else window.addEventListener('load', tryValidate);

  // SSE: apply new documents in place (no page reload, no save prompt);
  // run validate on demand.
  var es = new EventSource(ORIGIN + '/events');
  es.onopen = function () { post({ type: 'sse-open' }); reportReady(); syncDoc(); };
  es.onerror = function () { post({ type: 'sse-error' }); };
  // Track the currently active slide so we can restore it after every
  // loadDoc (Bento resets the editor to slide 1 when a new doc is loaded).
  var currentActive = 0;
  function readActive() {
    try {
      var a = document.querySelectorAll('.ed-thumb.active');
      if (a.length) return Number(a[0].querySelector('.ed-thumb-num').textContent) - 1;
    } catch (e) {}
    return currentActive;
  }
  // Click the nth slide thumbnail so the editor activates that slide.
  // `done` fires once the target thumb has the active state (used to reveal
  // the canvas again after loadDoc).
  function activateSlide(index, done) {
    currentActive = index;
    var tries = 0;
    var iv = setInterval(function () {
      var thumbs = document.querySelectorAll('.ed-thumb');
      tries++;
      if (thumbs.length > 0) {
        clearInterval(iv);
        var target = thumbs[index] || thumbs[thumbs.length - 1];
        if (target && !target.classList.contains('active')) {
          try { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {}
          var t2 = 0;
          var iv2 = setInterval(function () {
            t2++;
            if (target.classList.contains('active') || t2 > 10) {
              clearInterval(iv2);
              if (done) done();
            }
          }, 60);
        } else if (done) { done(); }
      } else if (tries > 20) { clearInterval(iv); if (done) done(); }
    }, 100);
  }

  // Apply a new document in place. loadDoc swaps the data synchronously and
  // the editor re-renders; we then restore the target slide. No artificial
  // hiding — the content simply updates on the current slide.
  function applyDoc(docStr, targetIndex) {
    try {
      window.bento.loadDoc(docStr);
      lastApplied = docStr;
      currentActive = targetIndex;
    } catch (e) { return; }
    activateSlide(targetIndex);
  }


  // ── DOM patch path: update text/style in place without loadDoc ──────
  // Bento renders elements with left/top inline styles matching doc x/y, and
  // text inside .bento-text-inner. For pure text/style edits we patch the DOM
  // directly and sync the in-memory doc — no loadDoc, no sidebar rebuild, no
  // flicker. Structural changes (add/remove elements, charts) still loadDoc.
  var lastDoc = null;

  // Compare docs; return a list of DOM ops (add/update/remove) when the change
  // is text-only (patchable without loadDoc), or null for structural changes
  // (add/remove slides, charts, shapes...) that must reload.
  function domOps(oldDoc, newDoc) {
    if (!oldDoc || !oldDoc.slides || !newDoc || !newDoc.slides) return null;
    if (oldDoc.slides.length !== newDoc.slides.length) return null;
    var ops = [];
    for (var i = 0; i < newDoc.slides.length; i++) {
      var os = oldDoc.slides[i], ns = newDoc.slides[i];
      if (!os || !ns || os.id !== ns.id) return null;
      var om = {}, nm = {};
      (os.elements || []).forEach(function (e) { om[e.id] = e; });
      (ns.elements || []).forEach(function (e) { nm[e.id] = e; });
      for (var id in om) {
        if (!(id in nm)) {
          if (om[id].type !== 'text') return null;
          ops.push({ op: 'remove', slideId: ns.id, id: id });
        }
      }
      for (var id2 in nm) {
        var o = om[id2], n = nm[id2];
        if (!o) {
          if (n.type !== 'text') return null;
          ops.push({ op: 'add', slideId: ns.id, el: n });
        } else if (JSON.stringify(o) !== JSON.stringify(n)) {
          if (o.type !== 'text' || n.type !== 'text') return null;
          ops.push({ op: 'update', slideId: ns.id, id: id2, el: n });
        }
      }
    }
    return ops.length ? ops : null;
  }

  function textInnerStyle(el) {
    var css = 'font-size:' + (el.fontSize || 24) + 'px;';
    css += 'font-family:' + (el.fontFamily || 'system-ui, sans-serif') + ';';
    css += 'font-weight:' + (el.fontWeight || 400) + ';';
    css += 'color:' + (el.color || '#F2F0EA') + ';';
    css += 'width:100%;';
    if (el.lineHeight) css += 'line-height:' + el.lineHeight + ';';
    return css;
  }

  function applyDomOps(ops, newDoc) {
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      var slide = document.querySelector('.bento-slide[data-slide-id="' + op.slideId + '"]');
      if (!slide) continue;
      if (op.op === 'add') {
        var div = document.createElement('div');
        div.className = 'bento-el bento-el-text';
        div.setAttribute('data-el-id', op.el.id);
        div.setAttribute('data-flip-id', op.el.id);
        div.style.cssText = 'left:' + op.el.x + 'px;top:' + op.el.y + 'px;width:' + op.el.w + 'px;height:' + op.el.h + 'px;display:flex;flex-direction:column;';
        var inner = document.createElement('div');
        inner.className = 'bento-text-inner';
        inner.setAttribute('dir', 'auto');
        inner.style.cssText = textInnerStyle(op.el);
        inner.innerHTML = op.el.html || '';
        div.appendChild(inner);
        slide.appendChild(div);
      } else if (op.op === 'remove') {
        var el = slide.querySelector('[data-el-id="' + op.id + '"]');
        if (el) el.remove();
      } else if (op.op === 'update') {
        var el2 = slide.querySelector('[data-el-id="' + op.id + '"]');
        if (!el2) continue;
        el2.style.left = op.el.x + 'px';
        el2.style.top = op.el.y + 'px';
        el2.style.width = op.el.w + 'px';
        el2.style.height = op.el.h + 'px';
        var inner2 = el2.querySelector('.bento-text-inner');
        if (inner2) {
          inner2.innerHTML = op.el.html || '';
          inner2.style.cssText = textInnerStyle(op.el);
        }
      }
    }
    // sync the in-memory document so slide switching re-renders the same data
    if (window.bento) window.bento.doc = newDoc;
  }

  var lastDoc = null;

  function textOnlyDiff(oldDoc, newDoc) {
    if (!oldDoc || !oldDoc.slides || !newDoc || !newDoc.slides) return null;
    if (oldDoc.slides.length !== newDoc.slides.length) return null;
    var changed = [];
    for (var i = 0; i < newDoc.slides.length; i++) {
      var os = oldDoc.slides[i], ns = newDoc.slides[i];
      if (!os || !ns || os.id !== ns.id) return null;
      var oe = os.elements || [], ne = ns.elements || [];
      if (oe.length !== ne.length) return null;
      var om = {}; oe.forEach(function (e) { om[e.id] = e; });
      var nm = {}; ne.forEach(function (e) { nm[e.id] = e; });
      for (var id in nm) {
        var o = om[id], n = nm[id];
        if (!o) return null;
        if (JSON.stringify(o) !== JSON.stringify(n)) {
          if (o.type !== 'text' || n.type !== 'text') return null; // structural
          changed.push({ slideIndex: i, id: id, next: n });
        }
      }
    }
    return changed;
  }

  function applyTextPatch(changed) {
    var els = [].slice.call(document.querySelectorAll('.bento-el-text'));
    for (var c = 0; c < changed.length; c++) {
      var n = changed[c].next;
      var target = null;
      for (var i = 0; i < els.length; i++) {
        var st = els[i].style;
        if (parseInt(st.left, 10) === n.x && parseInt(st.top, 10) === n.y) { target = els[i]; break; }
      }
      if (!target) continue;
      var inner = target.querySelector('.bento-text-inner');
      if (!inner) continue;
      inner.innerHTML = n.html || '';
      inner.style.fontSize = n.fontSize ? n.fontSize + 'px' : '';
      inner.style.fontWeight = n.fontWeight || '';
      inner.style.color = n.color || '';
      inner.style.fontFamily = n.fontFamily || '';
      inner.style.lineHeight = n.lineHeight || '';
    }
    // sync the in-memory document so later operations see the same data
    if (window.bento && window.bento.doc) {
      for (var c2 = 0; c2 < changed.length; c2++) {
        var s = window.bento.doc.slides[changed[c2].slideIndex];
        if (!s) continue;
        for (var k = 0; k < s.elements.length; k++) {
          if (s.elements[k].id === changed[c2].id) Object.assign(s.elements[k], changed[c2].next);
        }
      }
    }
  }

  es.addEventListener('doc-updated', function (ev) {
    var msg = {};
    try { msg = JSON.parse(ev.data || '{}'); } catch (e) {}
    if (window.bento && typeof window.bento.loadDoc === 'function' && msg.doc) {
      try {
        // loadDoc expects a JSON *string* (object form silently no-ops)
        var applied = JSON.stringify(msg.doc);
        var cur = docHash(window.bento.doc);
        var targetIndex = typeof msg.active === 'number' ? msg.active : readActive();
        if (applied === cur) {
          // content unchanged — just move the active slide, no reload flicker
          activateSlide(targetIndex);
          post({ type: 'loaddoc-skip', reason: 'unchanged', slides: msg.doc.slides.length });
        } else {
          var ops = domOps(lastDoc, msg.doc);
          if (ops) {
            // text-only change → patch the DOM in place (no flicker)
            applyDomOps(ops, msg.doc);
            lastDoc = msg.doc;
            lastApplied = applied;
            activateSlide(targetIndex);
            post({ type: 'loaddoc-ok', mode: 'dom-patch', slides: msg.doc.slides.length });
          } else {
            applyDoc(applied, targetIndex);
            lastDoc = msg.doc;
            post({ type: 'loaddoc-ok', mode: 'loaddoc', slides: msg.doc.slides.length });
          }
        }
        return;
      } catch (e) {
        post({ type: 'loaddoc-error', error: String(e) });
        /* fall through to reload */
      }
    } else {
      post({ type: 'loaddoc-skip', hasBento: !!window.bento, hasFn: !!(window.bento && typeof window.bento.loadDoc === 'function'), hasDoc: !!msg.doc });
    }
    location.reload();
  });
  es.addEventListener('validate-request', function (ev) {
    if (window.bento && typeof window.bento.validate === 'function') {
      try { post({ type: 'validate', data: window.bento.validate() }); } catch (e) {}
    } else {
      setTimeout(function () {
        try { post({ type: 'validate', data: window.bento.validate() }); } catch (e) {}
      }, 1000);
    }
  });
  es.addEventListener('measure-request', function (ev) {
    var msg = {};
    try { msg = JSON.parse(ev.data || '{}'); } catch (e) {}
    var run = function () {
      if (window.bento && typeof window.bento.measure === 'function') {
        try { post({ type: 'measure', data: window.bento.measure(msg.spec) }); } catch (e) {}
      }
    };
    if (window.bento) run(); else setTimeout(run, 1000);
  });
})();
