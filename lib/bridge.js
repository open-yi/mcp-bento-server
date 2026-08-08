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
  function activateSlide(index) {
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
        }
      } else if (tries > 20) { clearInterval(iv); }
    }, 150);
  }

  // Apply a new document in place, data-driven and flicker-free.
  // Preferred: window.bento.updateDoc (custom build) — replaces the document
  // content in place, keeps the current slide & selection, re-renders only the
  // affected canvas views (no "reset to slide 1" flash). Falls back to
  // loadDoc + activateSlide on the stock build.
  function applyDoc(docStr, targetIndex) {
    if (window.bento && typeof window.bento.updateDoc === 'function') {
      try {
        window.bento.updateDoc(docStr);
        lastApplied = docStr;
        currentActive = targetIndex;
        return true;
      } catch (e) { /* fall through to loadDoc */ }
    }
    try {
      window.bento.loadDoc(docStr);
      lastApplied = docStr;
      currentActive = targetIndex;
      activateSlide(targetIndex);
      return true;
    } catch (e) { return false; }
  }

  es.addEventListener('doc-updated', function (ev) {
    var msg = {};
    try { msg = JSON.parse(ev.data || '{}'); } catch (e) {}
    if (window.bento && typeof window.bento.loadDoc === 'function' && msg.doc) {
      try {
        // loadDoc expects a JSON *string* (object form silently no-ops)
        var applied = JSON.stringify(msg.doc);
        currentActive = readActive();           // remember where the user is
        applyDoc(applied, currentActive);
        // with updateDoc the current slide is preserved automatically; only
        // switch when the agent explicitly asked for a different slide
        if (typeof msg.active === 'number') activateSlide(msg.active);
        post({ type: 'loaddoc-ok', slides: msg.doc.slides ? msg.doc.slides.length : '?' });
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
  es.addEventListener('present-exit', function () {
    if (window.bento && typeof window.bento.presentExit === 'function') {
      try { window.bento.presentExit(); } catch (e) {}
    }
  });
  // Render a text snapshot of the CURRENT slide's real layout (positions,
  // sizes, styles, text, plus overflow/overlap warnings) so a non-vision agent
  // can "see" what was actually rendered — not the JSON it wrote.
  function snapshotView() {
    var out = [];
    var slides = document.querySelectorAll('.ed-stage-scale .bento-slide, .bento-slide');
    var active = document.querySelector('.ed-thumb.active');
    var activeNum = active ? Number(active.querySelector('.ed-thumb-num').textContent) : 1;
    var doc = window.bento && window.bento.doc;
    if (!doc) return out;
    var current = doc.slides[activeNum - 1];
    if (!current) return out;
    out.push('slide ' + activeNum + ' (' + doc.size.width + 'x' + doc.size.height + (current.background ? ', bg ' + current.background : '') + ')');
    // map real rendered elements on the active slide
    var container = document.querySelector('.ed-stage-scale .bento-slide');
    if (container) {
      var els = container.querySelectorAll('.bento-el');
      var warns = [];
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var id = el.getAttribute('data-el-id') || '?';
        var st = el.style;
        var x = parseInt(st.left) || 0, y = parseInt(st.top) || 0, w = parseInt(st.width) || 0, h = parseInt(st.height) || 0;
        var isText = el.classList.contains('bento-el-text');
        var info = [];
        if (isText) {
          var inner = el.querySelector('.bento-text-inner');
          if (inner) {
            var txt = (inner.textContent || '').replace(/\s+/g, ' ').slice(0, 60);
            var fs = parseInt(inner.style.fontSize) || 24;
            var lineH = parseFloat(inner.style.lineHeight) || 1.2;
            var measured = Math.ceil(txt.length > 0 ? fs * lineH : 0);
            var maxLines = Math.max(1, Math.floor(h / (fs * lineH)));
            var estLines = Math.ceil((inner.scrollHeight) / (fs * lineH)) || 1;
            if (inner.scrollHeight > h + 4) warns.push(id + ': text overflows (' + inner.scrollHeight + 'px > ' + h + 'px box)');
            info.push('"' + txt + '"');
            info.push(fs + 'px ' + (inner.style.fontWeight === 'bold' || parseInt(inner.style.fontWeight) >= 700 ? 'bold' : ''));
            if (inner.style.color) info.push(inner.style.color);
          }
        } else {
          info.push(el.className.replace('bento-el ', '').slice(0, 30));
        }
        out.push('  ' + id + ': ' + info.join(' ') + ' @(' + x + ',' + y + ') ' + w + 'x' + h);
      }
      // overlap check (same slide, rect intersection)
      var rects = [];
      for (var j = 0; j < els.length; j++) {
        var e2 = els[j];
        rects.push({ id: e2.getAttribute('data-el-id'), x: parseInt(e2.style.left) || 0, y: parseInt(e2.style.top) || 0, w: parseInt(e2.style.width) || 0, h: parseInt(e2.style.height) || 0 });
      }
      for (var a = 0; a < rects.length; a++) for (var b = a + 1; b < rects.length; b++) {
        var r1 = rects[a], r2 = rects[b];
        if (r1.x < r2.x + r2.w && r2.x < r1.x + r1.w && r1.y < r2.y + r2.h && r2.y < r1.y + r1.h) {
          warns.push(r1.id + ' overlaps ' + r2.id);
        }
      }
      for (var k = 0; k < warns.length; k++) out.push('  ⚠ ' + warns[k]);
    } else {
      out.push('  (no slide rendered — open the deck first)');
    }
    return out.join('\n');
  }
  es.addEventListener('view-request', function () {
    try { post({ type: 'view', data: snapshotView() }); } catch (e) { post({ type: 'view', data: 'view error: ' + e.message }); }
  });
  es.addEventListener('present-step', function (ev) {
    var msg = {};
    try { msg = JSON.parse(ev.data || '{}'); } catch (e) {}
    if (window.bento && typeof window.bento.presentStep === 'function') {
      try { window.bento.presentStep(msg.dir); } catch (e) {}
    }
  });
  es.addEventListener('present', function (ev) {
    var msg = {};
    try { msg = JSON.parse(ev.data || '{}'); } catch (e) {}
    if (window.bento && typeof window.bento.present === 'function') {
      try { window.bento.present(msg.fullscreen); } catch (e) {}
    } else {
      try { location.hash = 'present'; location.reload(); } catch (e) {}
    }
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
