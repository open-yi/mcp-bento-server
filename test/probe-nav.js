/**
 * probe bento navigation/selection APIs to find how to activate a slide.
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = 'http://127.0.0.1:3900/';
const DBG_PORT = 9225;

function getJson(url) { return new Promise((res, rej) => { http.get(url, r => { let b=''; r.on('data',c=>b+=c); r.on('end',()=>{try{res(JSON.parse(b));}catch(e){rej(e);}}); }).on('error', rej); }); }

async function main() {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG_PORT}`, '--disable-gpu', '--no-first-run',
    '--user-data-dir=' + process.env.TEMP + '/bento-cdp-' + Date.now(), PAGE], { stdio: 'ignore' });
  let ws;
  try {
    let tabs;
    for (let i=0;i<50;i++){ try{ tabs = await getJson(`http://127.0.0.1:${DBG_PORT}/json`); if(tabs.length) break; }catch(e){} await new Promise(r=>setTimeout(r,200)); }
    const tab = tabs.find(t=>t.type==='page');
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
    let id=0;
    const send=(method,params={})=>new Promise(resolve=>{const my=++id;const h=ev=>{const m=JSON.parse(ev.data);if(m.id===my){ws.removeEventListener('message',h);resolve(m.result);}};ws.addEventListener('message',h);ws.send(JSON.stringify({id:my,method,params}));});
    const evalJS=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});return r.result&&r.result.value!==undefined?r.result.value:(r.exceptionDetails?('EXC:'+r.exceptionDetails.text):r.result&&r.result.type);};

    let ready=false;
    for(let i=0;i<30;i++){ if(await evalJS('typeof window.bento!=="undefined"')){ready=true;break;} await new Promise(r=>setTimeout(r,500)); }
    console.log('bento ready:', ready);

    // 1. selection object — what does it expose?
    console.log('\n[selection]', await evalJS('JSON.stringify(Object.keys(window.bento.selection||{}))'));
    console.log('[selection value]', await evalJS('JSON.stringify(window.bento.selection).slice(0,200)'));
    // 2. any methods that smell like slide navigation on bento / editor
    console.log('\n[bento methods]', await evalJS('JSON.stringify(Object.keys(window.bento))'));
    // search deeper: editor internal object (common names: editor, store, deck, view, app, ui)
    const probe = `(() => {
      const out = {};
      const names = ['editor','app','store','ui','viewer','slideNav','navigate','gotoSlide','setSlide','activeSlide','currentSlide','goTo','select','deck'];
      for (const n of names) {
        try { out[n] = typeof window.bento[n]; } catch(e) { out[n] = 'err'; }
      }
      return JSON.stringify(out);
    })()`;
    console.log('\n[bento nav-ish props]', await evalJS(probe));
    // 3. DOM: what element tracks the current slide? look for data attributes / class names on the canvas
    console.log('\n[dom classes]', await evalJS(`JSON.stringify([...new Set([...document.querySelectorAll('[class]')].map(e=>e.className).filter(c=>typeof c==='string'&&c.length<60))].slice(0,30))`));
  } finally { ws&&ws.close(); chrome.kill(); }
}
main().catch(e=>{console.error('FAIL',e);process.exit(1);});
