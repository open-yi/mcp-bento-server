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

  // Pull the latest document from the server and apply it in place.
  // Called on page load and on every SSE (re)connect — so a server restart
  // heals the tab automatically, no manual refresh.
  function syncDoc() {
    if (!window.bento || typeof window.bento.loadDoc !== 'function') {
      setTimeout(syncDoc, 300);
      return;
    }
    fetch(ORIGIN + '/api/read').then(function (r) { return r.json(); }).then(function (res) {
      if (!res || !res.doc) return;
      var cur = null;
      try { cur = JSON.stringify(window.bento.doc); } catch (e) {}
      var next = JSON.stringify(res.doc);
      if (cur === next) return; // already in sync — no undo-stack pollution
      try { window.bento.loadDoc(next); } catch (e) {}
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
  es.addEventListener('doc-updated', function (ev) {
    var msg = {};
    try { msg = JSON.parse(ev.data || '{}'); } catch (e) {}
    if (window.bento && typeof window.bento.loadDoc === 'function' && msg.doc) {
      try {
        // loadDoc expects a JSON *string* (object form silently no-ops)
        window.bento.loadDoc(JSON.stringify(msg.doc));
        var after = window.bento.doc;
        post({ type: 'loaddoc-ok', slides: msg.doc.slides ? msg.doc.slides.length : '?', title: after ? after.title : '(no doc)', s1html: after && after.slides && after.slides[0] && after.slides[0].elements ? after.slides[0].elements[0].html : '(n/a)' });
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
