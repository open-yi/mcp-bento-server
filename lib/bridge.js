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
      try {
        currentActive = readActive();
        window.bento.loadDoc(next);
        lastApplied = next;
        activateSlide(currentActive);
      } catch (e) {}
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

  es.addEventListener('doc-updated', function (ev) {
    var msg = {};
    try { msg = JSON.parse(ev.data || '{}'); } catch (e) {}
    if (window.bento && typeof window.bento.loadDoc === 'function' && msg.doc) {
      try {
        // loadDoc expects a JSON *string* (object form silently no-ops)
        var applied = JSON.stringify(msg.doc);
        currentActive = readActive();           // remember where the user is
        window.bento.loadDoc(applied);
        lastApplied = applied;
        activateSlide(typeof msg.active === 'number' ? msg.active : currentActive);
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
