// Drives a running app (--remote-debugging-port=9333) and checks the below-text feature.
// Usage: node scripts/smoke-test.mjs <output-dir>   (Node >= 22)
import fs from 'fs'; import path from 'path'; import assert from 'assert';
const out = path.resolve(process.argv[2]); fs.mkdirSync(out, { recursive: true });
const sl = ms => new Promise(r => setTimeout(r, ms));
let t; for (let k = 0; k < 60 && !t; k++) { try { t = (await (await fetch('http://127.0.0.1:9333/json')).json()).find(x => x.type === 'page'); } catch {} if (!t) await sl(1000); }
assert(t, 'app did not start'); await sl(5000);
setTimeout(() => { console.error('TIMEOUT'); process.exit(2); }, 120000).unref();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r); let i = 0; const exc = [];
const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pend.get(m.id)(m.result); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') exc.push(m.params.exceptionDetails.exception?.description); };
const c = (method, params = {}) => new Promise(r => { const id = ++i; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async x => { const r = await c('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (!r || r.exceptionDetails) throw new Error(x + ' -> ' + r?.exceptionDetails?.exception?.description); return r.result.value; };
const shot = async n => fs.writeFileSync(path.join(out, n + '.png'), Buffer.from((await c('Page.captureScreenshot')).data, 'base64'));
const pos = q => ev(`(()=>{const r=(${q}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const click = async (p, n = 1) => { for (let k = 1; k <= n; k++) for (const type of ['mousePressed', 'mouseReleased']) await c('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: k }); await sl(1000); };
const hot = async () => { for (const type of ['rawKeyDown', 'keyUp']) await c('Input.dispatchKeyEvent', { type, key: 'B', code: 'KeyB', windowsVirtualKeyCode: 66, modifiers: 2 | 8 }); await sl(1000); };
const fill = async v => { assert(await ev(`!!document.querySelector('.bootbox textarea')`), 'dialog missing'); await ev(`(()=>{const a=document.querySelector('.bootbox textarea');a.focus();a.select();return 1})()`); if (v) await c('Input.insertText', { text: v }); else for (const type of ['rawKeyDown', 'keyUp']) await c('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await click(await pos(`document.querySelector('.bootbox .btn-primary')`)); await sl(1500); };
const menu = async a => { await ev(`(()=>{const f=m=>{for(const x of m.items){if(x.accelerator==='${a}')return x;const r=x.submenu&&f(x.submenu);if(r)return r}};f(require('electron').remote.Menu.getApplicationMenu()).click();return 1})()`); await sl(1500); };
const sel = id => ev(`minder.select(minder.getNodeById('${id}'),true);minder.focus();1`);
const data = id => ev(`minder.getNodeById('${id}').getData('belowtext')||null`);
const y = id => ev(`minder.getNodeById('${id}').getLayoutBox().cy`);
const eq = (a, b, l) => { assert.deepStrictEqual(a, b, l); console.log('PASS', l); };
const file = path.join(out, 'work.km');
fs.writeFileSync(file, JSON.stringify({ root: { data: { id: 'r', text: 'Root' }, children: [{ data: { id: 'a', text: 'Branch A' }, children: [{ data: { id: 'a1', text: 'Node A1' }, children: [] }, { data: { id: 'a2', text: 'Node A2' }, children: [] }] }, { data: { id: 'b', text: 'Branch B' }, children: [] }, { data: { id: 'c', text: 'Branch C' }, children: [] }] }, template: 'default', theme: 'fresh-blue' }));
const open = async () => { await ev(`require('./lib/file').openKm(${JSON.stringify(file)});1`); await sl(2500); };
await c('Runtime.enable'); await c('Page.enable'); await open();
const gap = async () => (await y('a2')) - (await y('a1')); const g0 = await gap();
await sel('a1'); await hot(); await fill('Below one');
eq(await data('a1'), 'Below one', 'Ctrl+Shift+B adds text'); assert(await gap() > g0); console.log('PASS following node moves down');
await menu('CmdOrCtrl+Z'); eq(await data('a1'), null, 'undo add'); await menu('CmdOrCtrl+Y'); eq(await data('a1'), 'Below one', 'redo add');
const BTN = `[...document.querySelectorAll('.hotbox .button')].find(b=>/^(Below text|线下文字)/.test(b.textContent))`;
const rightClick = async id => { await sel(id); const p = await pos(`minder.getNodeById('${id}').getRenderer('TextRenderer').getRenderShape().node`); for (const type of ['mousePressed', 'mouseReleased']) await c('Input.dispatchMouseEvent', { type, ...p, button: 'right', clickCount: 1 }); await sl(1000); };
await rightClick('a1'); assert(await ev(`!!(${BTN})`), 'context menu button missing');
eq(await ev(`${BTN}.querySelector('.label').textContent`), '线下文字', 'fresh install uses Chinese UI');
await click(await pos(BTN)); eq(await ev(`document.querySelector('.bootbox textarea').value`), 'Below one', 'context menu opens dialog with current text');
eq(await ev(`[...document.querySelectorAll('.bootbox .modal-footer .btn')].map(b=>b.textContent.trim())`), ['取消', '确定'], 'dialog buttons are Chinese');
const near = await ev(`(()=>{const n=minder.getNodeById('a1').getRenderContainer().node.getBoundingClientRect(),d=document.querySelector('.bootbox .modal-dialog').getBoundingClientRect();return{below:Math.round(d.top-n.bottom),above:Math.round(n.top-d.bottom),inView:d.left>=0&&d.top>=0&&d.right<=innerWidth&&d.bottom<=innerHeight}})()`);
assert(near.inView && ((near.below >= 0 && near.below <= 20) || (near.above >= 0 && near.above <= 20)), 'dialog not next to node: ' + JSON.stringify(near)); console.log('PASS dialog opens next to the node', JSON.stringify(near));
await fill('Edited\nline two');
eq(await data('a1'), 'Edited\nline two', 'context menu edits, multi-line');
await rightClick('a1'); await hot();
eq(await ev(`document.querySelectorAll('.bootbox').length`), 1, 'shortcut while context menu is open opens one dialog');
await ev(`document.querySelector('.bootbox [data-bb-handler=cancel]').click();1`); await sl(1000);
eq(await data('a1'), 'Edited\nline two', 'cancel keeps text');
await menu('CmdOrCtrl+Z'); eq(await data('a1'), 'Below one', 'undo edit'); await menu('CmdOrCtrl+Y');
for (const id of ['a', 'b', 'c']) { await sel(id); await hot(); await fill('L1 note ' + id); }
for (const id of ['a', 'b', 'c']) {
  const d = await ev(`(()=>{const n=minder.getNodeById('${id}'),p=n.getConnection().node,e=p.getPointAtLength(p.getTotalLength());const s=p.getScreenCTM(),o=document.getElementById('node_outline'+n.getRenderer('OutlineRenderer').getRenderShape().node.id.slice(12))||n.getRenderer('OutlineRenderer').getRenderShape().node,r=o.getBoundingClientRect();return Math.abs(e.matrixTransform(s).y-(r.y+r.height/2))})()`);
  assert(d < 2, `level-1 connector off by ${d} on ${id}`); console.log('PASS level-1 connector aligned', id, d.toFixed(2));
}
await shot('features');
await menu('CmdOrCtrl+S'); eq(JSON.parse(fs.readFileSync(file)).root.children[0].children[0].data.belowtext, 'Edited\nline two', 'saved to .km');
await c('Page.reload'); await sl(6000); await open(); eq(await data('a1'), 'Edited\nline two', 'reopened'); await shot('reopened');
await sel('a1'); await hot(); await fill(''); eq(await data('a1'), null, 'clear deletes');
await menu('CmdOrCtrl+Z'); eq(await data('a1'), 'Edited\nline two', 'undo delete');
eq(exc, [], 'no renderer exceptions'); console.log('ALL PASS'); process.exit(0);
