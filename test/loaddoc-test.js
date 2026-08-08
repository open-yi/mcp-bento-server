/**
 * loaddoc-test.js — probe window.bento.loadDoc behaviour in a real Chrome.
 * Spawns headless Chrome, opens the local editor page, and tries several
 * call forms, reporting what window.bento.doc looks like after each.
 *
 * Usage: node test/loaddoc-test.js   (start `bento-mcp serve` first)
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = 'http://127.0.0.1:3900/';
const DBG_PORT = 9223;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let b = '';
      res.on('data', c => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function waitForDebugger() {
  for (let i = 0; i < 50; i++) {
    try { const l = await getJson(`http://127.0.0.1:${DBG_PORT}/json`); if (l.length) return l; } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('chrome debugger not ready');
}

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${DBG_PORT}`, '--disable-gpu', '--no-first-run',
    '--user-data-dir=' + process.env.TEMP + '/bento-cdp-profile-' + Date.now(),
    PAGE
  ], { stdio: 'ignore' });

  let ws;
  try {
    const tabs = await waitForDebugger();
    const tab = tabs.find(t => t.type === 'page');
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const send = (method, params = {}) => new Promise((resolve) => {
      const myId = ++id;
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === myId) { ws.removeEventListener('message', onMsg); resolve(m.result); }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });

    // wait for window.bento
    let ready = false;
    for (let i = 0; i < 30; i++) {
      const r = await send('Runtime.evaluate', { expression: 'typeof window.bento !== "undefined"', returnByValue: true });
      if (r.result.value) { ready = true; break; }
      await new Promise(r2 => setTimeout(r2, 500));
    }
    console.log('window.bento ready:', ready);

    const evalJS = async (label, expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      const v = r.result && r.result.value !== undefined ? r.result.value : (r.exceptionDetails ? 'EXC: ' + r.exceptionDetails.text : r.result && r.result.type);
      console.log(`\n[${label}]\n${JSON.stringify(v, null, 1).slice(0, 500)}`);
    };

    await evalJS('bento keys', 'Object.keys(window.bento)');
    await evalJS('doc before', 'window.bento.doc ? window.bento.doc.title : "(doc is undefined)"');
    await evalJS('loadDoc(object)', '(function(){ try { window.bento.loadDoc({format:"bento/slides",version:1,title:"OBJ TEST",size:{width:1280,height:720},theme:{background:"#101418",color:"#F2F0EA",accent:"#FF9E8A",fontFamily:"system-ui,sans-serif"},slides:[{id:"s1",elements:[{id:"t1",type:"text",x:96,y:260,w:1088,h:160,html:"OBJ",fontSize:88,color:"#F2F0EA"}]}]}); return "no-throw"; } catch(e){ return "THROW: "+e.message; } })()');
    await evalJS('doc after object', 'window.bento.doc ? window.bento.doc.title : "(doc is undefined)"');
    await evalJS('loadDoc(string)', '(function(){ try { window.bento.loadDoc(JSON.stringify({format:"bento/slides",version:1,title:"STR TEST",size:{width:1280,height:720},theme:{background:"#101418",color:"#F2F0EA",accent:"#FF9E8A",fontFamily:"system-ui,sans-serif"},slides:[{id:"s1",elements:[{id:"t1",type:"text",x:96,y:260,w:1088,h:160,html:"STR",fontSize:88,color:"#F2F0EA"}]}]})); return "no-throw"; } catch(e){ return "THROW: "+e.message; } })()');
    await evalJS('doc after string', 'window.bento.doc ? window.bento.doc.title : "(doc is undefined)"');
    await evalJS('serialize', 'typeof window.bento.serialize === "function" ? (window.bento.serialize().slice ? window.bento.serialize().slice(0,120) : typeof window.bento.serialize()) : "no serialize"');
  } finally {
    ws && ws.close();
    chrome.kill();
  }
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
