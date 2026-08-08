/**
 * verify readonly player mode: open the file and check the UI state.
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = process.argv[2];
const DBG_PORT = 9224;

function getJson(url) { return new Promise((res, rej) => { http.get(url, r => { let b=''; r.on('data',c=>b+=c); r.on('end',()=>{try{res(JSON.parse(b));}catch(e){rej(e);}}); }).on('error', rej); }); }

async function main() {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG_PORT}`, '--disable-gpu', '--no-first-run',
    '--user-data-dir=' + process.env.TEMP + '/bento-cdp-' + Date.now(), FILE], { stdio: 'ignore' });
  let ws;
  try {
    let tabs;
    for (let i=0;i<50;i++){ try{ tabs = await getJson(`http://127.0.0.1:${DBG_PORT}/json`); if(tabs.length) break; }catch(e){} await new Promise(r=>setTimeout(r,200)); }
    const tab = tabs.find(t=>t.type==='page');
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
    let id=0;
    const send=(method,params={})=>new Promise(resolve=>{const my=++id;const h=ev=>{const m=JSON.parse(ev.data);if(m.id===my){ws.removeEventListener('message',h);resolve(m.result);}};ws.addEventListener('message',h);ws.send(JSON.stringify({id:my,method,params}));});
    const evalJS=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});return r.result&&r.result.value!==undefined?r.result.value:r.exceptionDetails?('EXC:'+r.exceptionDetails.text):r.result&&r.result.type;};

    let ready=false;
    for(let i=0;i<30;i++){ if(await evalJS('typeof window.bento!=="undefined"')){ready=true;break;} await new Promise(r=>setTimeout(r,500)); }
    console.log('bento ready:', ready);
    console.log('readonly doc flag:', await evalJS('window.bento.doc ? window.bento.doc.readonly : "(no doc)"'));
    // editor UI heuristics: count elements that look like editor chrome (toolbar/panel)
    console.log('editor toolbar present:', await evalJS('!!document.querySelector(\'[data-bento-editor], .bento-editor, [class*="toolbar"], [class*="inspector"]\')'));
    console.log('presentation chrome present:', await evalJS('!!document.querySelector(\'[class*="present"], [class*="slide-num"], [class*="progress"]\')'));
    console.log('slides in doc:', await evalJS('window.bento.doc ? window.bento.doc.slides.length : "?"'));
  } finally { ws&&ws.close(); chrome.kill(); }
}
main().catch(e=>{console.error('FAIL',e);process.exit(1);});
