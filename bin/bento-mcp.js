#!/usr/bin/env node
/**
 * mcp-bento-server — CLI entry point.
 *
 *   bento-mcp serve [--port 3900]         start the local server (foreground)
 *   bento-mcp start / stop / status       manage the background server
 *   bento-mcp open <file>                 open a .bento.html deck
 *   bento-mcp new [--title T] [--out F]   create a new deck
 *   bento-mcp read                        dump the document JSON
 *   bento-mcp slides                      list slides
 *   bento-mcp get <slide-id>              dump one slide
 *   bento-mcp describe                    plain-text summary of the deck
 *   bento-mcp patch <json>                apply an ops patch
 *   bento-mcp add-slide <json>            add a slide
 *   bento-mcp update-slide <id> <json>    update a slide (fields to set)
 *   bento-mcp delete-slide <id>           delete a slide
 *   bento-mcp duplicate-slide <id>        duplicate a slide (keeps element ids)
 *   bento-mcp set-theme <json>            set theme fields
 *   bento-mcp set-title <text>            set deck title
 *   bento-mcp save                        write the doc back to the file
 *   bento-mcp export-json [--out F]       export document JSON
 *   bento-mcp import-json <file>          import document JSON
 *   bento-mcp validate                    programmatic self-check (via browser)
 *   bento-mcp measure <json>              measure text size (via browser)
 *   bento-mcp install-skill               install the skill into all three harnesses
 *   bento-mcp mcp                         run as an MCP stdio server
 */
'use strict';

const fs = require('fs');
const { api, ensureServer, serverUp, startBackgroundServer, PORT } = require('../lib/client');

// ------------------------------------------------------------- output helpers

function out(data) { process.stdout.write(JSON.stringify(data, null, 2) + '\n'); }
function err(msg) { process.stderr.write(msg + '\n'); process.exit(1); }

// ------------------------------------------------------------- commands

function describeDoc(doc) {
  const lines = [`Deck: ${doc.title}`, `Size: ${doc.size.width}x${doc.size.height} · ${doc.slides.length} slide(s)`];
  doc.slides.forEach((s, i) => {
    const els = (s.elements || []).map(e => `${e.type}:${e.id}`).join(', ');
    const titleEl = (s.elements || []).find(e => e.type === 'text' && (e.html || '').length < 60);
    const head = s.stateOf ? ` (state of ${s.stateOf})` : '';
    lines.push(`\n[${i + 1}] ${s.id}${head} — ${titleEl ? titleEl.html : '(no title text)'}`);
    if (s.notes) lines.push(`    notes: ${String(s.notes).slice(0, 120)}`);
    if (els) lines.push(`    elements: ${els}`);
    if (s.transition === 'morph') lines.push('    transition: morph');
  });
  return lines.join('\n');
}

function parseJsonArg(arg, label) {
  try { return JSON.parse(arg); }
  catch (e) { err(`Invalid JSON for ${label}: ${e.message}`); }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args.shift();

  switch (cmd) {
    // ---------------- server lifecycle ----------------
    case 'serve': {
      const { BentoServer } = require('../lib/server');
      const port = PORT;
      const srv = new BentoServer({ port, host: HOST });
      await srv.start();
      process.stdout.write(`Bento server listening on http://${HOST}:${port}/  (open this in your browser)\n`);
      process.stdout.write(`API base: http://${HOST}:${port}/api/\n`);
      // keep alive
      setInterval(() => {}, 1 << 30);
      break;
    }
    case 'start': {
      if (await serverUp()) { out({ ok: true, message: 'already running', port: PORT }); break; }
      startBackgroundServer();
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (await serverUp()) { out({ ok: true, port: PORT }); break; }
        if (i === 29) err('start failed');
      }
      break;
    }
    case 'stop': {
      try { await api('GET', '/api/stop'); out({ ok: true }); }
      catch (e) { out({ ok: false, error: 'not running' }); }
      break;
    }
    case 'status': {
      const s = await api('GET', '/api/status').catch(() => null);
      if (s) out(s); else out({ ok: false, running: false, message: 'server not running (start with: bento-mcp start)' });
      break;
    }

    // ---------------- document ops ----------------
    case 'open': {
      const file = args[0];
      if (!file) err('usage: bento-mcp open <file.bento.html>');
      await ensureServer();
      out(await api('POST', '/api/open', { file }));
      break;
    }
    case 'new': {
      let title = 'Untitled deck', file = null;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--title') title = args[++i];
        else if (args[i] === '--out') file = args[++i];
      }
      if (!file) err('usage: bento-mcp new --title "..." --out <file.bento.html>');
      await ensureServer();
      out(await api('POST', '/api/new', { file, title }));
      break;
    }
    case 'read': {
      await ensureServer();
      out(await api('GET', '/api/read'));
      break;
    }
    case 'slides': {
      await ensureServer();
      const { doc } = await api('GET', '/api/read');
      out(doc.slides.map(s => ({ id: s.id, stateOf: s.stateOf || null, elements: (s.elements || []).length, transition: s.transition })));
      break;
    }
    case 'get': {
      const id = args[0];
      if (!id) err('usage: bento-mcp get <slide-id>');
      await ensureServer();
      const { doc } = await api('GET', '/api/read');
      const s = doc.slides.find(x => x.id === id);
      if (!s) err('slide not found: ' + id);
      out(s);
      break;
    }
    case 'describe': {
      await ensureServer();
      const { doc } = await api('GET', '/api/read');
      process.stdout.write(describeDoc(doc) + '\n');
      break;
    }
    case 'patch': {
      const json = args[0];
      if (!json) err('usage: bento-mcp patch \'{"createElements":[...]}\' (or - for stdin)');
      const ops = json === '-' ? JSON.parse(fs.readFileSync(0, 'utf8')) : parseJsonArg(json, 'patch');
      await ensureServer();
      out(await api('POST', '/api/patch', { ops }));
      break;
    }
    case 'add-slide': {
      const slide = parseJsonArg(args[0], 'slide');
      await ensureServer();
      out(await api('POST', '/api/patch', { ops: { addSlides: [slide] } }));
      break;
    }
    case 'update-slide': {
      const id = args[0], set = parseJsonArg(args[1], 'set');
      await ensureServer();
      out(await api('POST', '/api/patch', { ops: { updateSlides: [{ id, set }] } }));
      break;
    }
    case 'delete-slide': {
      await ensureServer();
      out(await api('POST', '/api/patch', { ops: { deleteSlides: [args[0]] } }));
      break;
    }
    case 'duplicate-slide': {
      await ensureServer();
      out(await api('POST', '/api/patch', { ops: { duplicateSlide: { id: args[0] } } }));
      break;
    }
    case 'set-theme': {
      const set = parseJsonArg(args[0], 'theme');
      await ensureServer();
      out(await api('POST', '/api/patch', { ops: { setTheme: set } }));
      break;
    }
    case 'set-title': {
      await ensureServer();
      out(await api('POST', '/api/patch', { ops: { setTitle: args.join(' ') } }));
      break;
    }
    case 'save': {
      await ensureServer();
      out(await api('GET', '/api/save'));
      break;
    }
    case 'export-json': {
      await ensureServer();
      const { doc } = await api('GET', '/api/read');
      const oi = args.indexOf('--out');
      if (oi !== -1) { fs.writeFileSync(args[oi + 1], JSON.stringify(doc, null, 2)); out({ ok: true, file: args[oi + 1] }); }
      else process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
      break;
    }
    case 'import-json': {
      const file = args[0];
      if (!file) err('usage: bento-mcp import-json <doc.json>');
      await ensureServer();
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      out(await api('POST', '/api/patch', { ops: { setDoc: doc } }));
      break;
    }
    case 'validate': {
      await ensureServer();
      out(await api('GET', '/api/validate'));
      break;
    }
    case 'measure': {
      const spec = parseJsonArg(args[0], 'spec');
      await ensureServer();
      out(await api('POST', '/api/measure', { spec }));
      break;
    }

    // ---------------- distribution ----------------
    case 'install-skill': {
      const { installSkill } = require('../lib/install-skill');
      out(await installSkill());
      break;
    }
    case 'mcp': {
      const { serveMCP } = require('../lib/mcp');
      await serveMCP();
      break;
    }
    default:
      err('Unknown command: ' + (cmd || '') + '\nRun "bento-mcp" with no args to see usage, or check the README.');
  }
}

main().catch(e => err(e.stack || String(e)));
