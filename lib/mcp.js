/**
 * mcp.js — Model Context Protocol (stdio) server.
 *
 * Exposes the same operations as the CLI as MCP tools so any MCP-capable
 * client (Claude Code, opencode, ...) can drive Bento decks natively:
 *
 *   {"command": ["bento-mcp", "mcp"]}
 *
 * Tools talk to the local HTTP server (shared document state, browser bridge
 * for validate/measure); the server process is auto-started when needed.
 *
 * Protocol: JSON-RPC 2.0 over stdio (MCP 2024-11-05), Node built-ins only.
 */
'use strict';

const readline = require('readline');
const { api, ensureServer } = require('./client');

const TOOLS = [
  { name: 'bento_open_deck', description: 'Open a .bento.html deck file; the browser tab (if open) reloads to show it.', inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Path to the .bento.html file' } }, required: ['file'] } },
  { name: 'bento_new_deck', description: 'Create a new deck file from the bundled official template with a minimal document.', inputSchema: { type: 'object', properties: { file: { type: 'string' }, title: { type: 'string' } }, required: ['file'] } },
  { name: 'bento_save_deck', description: 'Write the current document back into the .bento.html file on disk.', inputSchema: { type: 'object', properties: {} } },
  { name: 'bento_read_doc', description: 'Return the whole document JSON (slides, theme, size, elements).', inputSchema: { type: 'object', properties: {} } },
  { name: 'bento_list_slides', description: 'List slides with id, element count and transition.', inputSchema: { type: 'object', properties: {} } },
  { name: 'bento_get_slide', description: 'Return one slide by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'bento_describe', description: 'Plain-text summary of the deck (what each slide says, which elements it has).', inputSchema: { type: 'object', properties: {} } },
  { name: 'bento_patch_elements', description: 'Apply an ops patch: {createElements:[{slideId,element}], updateElements:[{slideId,id,set}], deleteElements:[{slideId,id}], addSlides:[slide], updateSlides:[{id,set}], deleteSlides:[id], duplicateSlide:{id}, setTheme:{...}, setTitle:"..."}. Live browser preview refreshes automatically.', inputSchema: { type: 'object', properties: { ops: { type: 'object' } }, required: ['ops'] } },
  { name: 'bento_add_slide', description: 'Add a slide object ({id?, elements:[...], transition?, notes?}).', inputSchema: { type: 'object', properties: { slide: { type: 'object' } }, required: ['slide'] } },
  { name: 'bento_update_slide', description: 'Update fields of a slide by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, set: { type: 'object' } }, required: ['id', 'set'] } },
  { name: 'bento_delete_slide', description: 'Delete a slide by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'bento_duplicate_slide', description: 'Duplicate a slide; element ids are kept so morph pairs with the original.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'bento_set_theme', description: 'Set theme fields (background, color, accent, fontFamily).', inputSchema: { type: 'object', properties: { theme: { type: 'object' } }, required: ['theme'] } },
  { name: 'bento_validate', description: 'Programmatic self-check via the browser tab: text overflow, off-canvas elements, broken links, duplicate ids, chart config. Returns a structured findings report.', inputSchema: { type: 'object', properties: {} } },
  { name: 'bento_measure', description: 'Measure rendered text size before placing it: {html, w, fontSize, lineHeight} → {height, width, lines}.', inputSchema: { type: 'object', properties: { spec: { type: 'object' } }, required: ['spec'] } },
  { name: 'bento_status', description: 'Server status: browser connected, current deck file, slide count.', inputSchema: { type: 'object', properties: {} } }
];

function resultOf(x) {
  return { content: [{ type: 'text', text: typeof x === 'string' ? x : JSON.stringify(x, null, 2) }] };
}
function errorOf(e) {
  return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true };
}

const SLIDE_SUMMARY = (doc) => doc.slides.map(s => ({ id: s.id, stateOf: s.stateOf || null, elements: (s.elements || []).length, transition: s.transition }));

function describeDoc(doc) {
  const lines = [`Deck: ${doc.title}`, `Size: ${doc.size.width}x${doc.size.height} · ${doc.slides.length} slide(s)`];
  doc.slides.forEach((s, i) => {
    const els = (s.elements || []).map(e => `${e.type}:${e.id}`).join(', ');
    const titleEl = (s.elements || []).find(e => e.type === 'text' && (e.html || '').length < 60);
    lines.push(`\n[${i + 1}] ${s.id}${s.stateOf ? ' (state of ' + s.stateOf + ')' : ''} — ${titleEl ? titleEl.html : '(no title text)'}`);
    if (s.notes) lines.push(`    notes: ${String(s.notes).slice(0, 120)}`);
    if (els) lines.push(`    elements: ${els}`);
    if (s.transition === 'morph') lines.push('    transition: morph');
  });
  return lines.join('\n');
}

async function callTool(name, args) {
  await ensureServer();
  switch (name) {
    case 'bento_open_deck': return resultOf(await api('POST', '/api/open', { file: args.file }));
    case 'bento_new_deck': return resultOf(await api('POST', '/api/new', { file: args.file, title: args.title || 'Untitled deck' }));
    case 'bento_save_deck': return resultOf(await api('GET', '/api/save'));
    case 'bento_read_doc': return resultOf(await api('GET', '/api/read'));
    case 'bento_list_slides': {
      const { doc } = await api('GET', '/api/read');
      return resultOf(SLIDE_SUMMARY(doc));
    }
    case 'bento_get_slide': {
      const { doc } = await api('GET', '/api/read');
      const s = doc.slides.find(x => x.id === args.id);
      if (!s) throw new Error('slide not found: ' + args.id);
      return resultOf(s);
    }
    case 'bento_describe': {
      const { doc } = await api('GET', '/api/read');
      return resultOf(describeDoc(doc));
    }
    case 'bento_patch_elements': return resultOf(await api('POST', '/api/patch', { ops: args.ops }));
    case 'bento_add_slide': return resultOf(await api('POST', '/api/patch', { ops: { addSlides: [args.slide] } }));
    case 'bento_update_slide': return resultOf(await api('POST', '/api/patch', { ops: { updateSlides: [{ id: args.id, set: args.set }] } }));
    case 'bento_delete_slide': return resultOf(await api('POST', '/api/patch', { ops: { deleteSlides: [args.id] } }));
    case 'bento_duplicate_slide': return resultOf(await api('POST', '/api/patch', { ops: { duplicateSlide: { id: args.id } } }));
    case 'bento_set_theme': return resultOf(await api('POST', '/api/patch', { ops: { setTheme: args.theme } }));
    case 'bento_validate': return resultOf(await api('GET', '/api/validate'));
    case 'bento_measure': return resultOf(await api('POST', '/api/measure', { spec: args.spec }));
    case 'bento_status': return resultOf(await api('GET', '/api/status'));
    default: throw new Error('unknown tool: ' + name);
  }
}

async function serveMCP() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let nextId = 1;
  let inflight = 0;
  let stdinDone = false;
  const maybeExit = () => { if (stdinDone && inflight === 0) setTimeout(() => process.exit(0), 50); };

  const dispatch = async (msg) => {
    if (msg.method === 'initialize') {
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-bento-server', version: require('../package.json').version }
      };
    }
    if (msg.method === 'notifications/initialized') return null;
    if (msg.method === 'ping') return {};
    if (msg.method === 'tools/list') return { tools: TOOLS };
    if (msg.method === 'tools/call') return callTool(msg.params.name, msg.params.arguments || {});
    throw new Error('unsupported method: ' + msg.method);
  };

  rl.on('line', async (line) => {
    line = line.trim();
    if (!line) return;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { return; }
    inflight++;
    try {
      const result = await dispatch(msg);
      if (result !== null) {
        const resp = { jsonrpc: '2.0', id: msg.id ?? nextId++, result };
        process.stdout.write(JSON.stringify(resp) + '\n');
      }
    } catch (e) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? nextId++, error: { code: -32603, message: e.message } }) + '\n');
    } finally {
      inflight--;
      maybeExit();
    }
  });

  rl.on('close', () => { stdinDone = true; maybeExit(); });
}

module.exports = { serveMCP };

// run as a standalone MCP stdio server when invoked directly
if (require.main === module) serveMCP();
