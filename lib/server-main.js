/**
 * server-main.js — standalone entry for the background server process.
 * Usage: node server-main.js [port]
 */
'use strict';

const { BentoServer } = require('./server');

const port = Number(process.argv[2] || process.env.BENTO_PORT || 3900);
const host = '127.0.0.1';

const srv = new BentoServer({ port, host });
srv.start().then(() => {
  process.stdout.write(`[bento-mcp] server on http://${host}:${port}/\n`);
}).catch(e => {
  process.stderr.write('[bento-mcp] failed to start: ' + e.message + '\n');
  process.exit(1);
});
