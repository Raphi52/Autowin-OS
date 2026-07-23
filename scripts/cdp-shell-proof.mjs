// Preuve : conteneur opaque + top-menu bordé + onglet sélectionné visible, sur routing ET diagnostic.
import { writeFileSync } from 'node:fs'
const targets = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = targets.find((t) => t.type === 'page')
const socket = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0; const pending = new Map()
socket.onmessage = ({ data }) => { const m = JSON.parse(data); const cb = pending.get(m.id); if (cb) { pending.delete(m.id); m.error ? cb.reject(new Error(m.error.message)) : cb.resolve(m.result) } }
await new Promise((r) => (socket.onopen = r))
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++nextId; pending.set(id, { resolve: res, reject: rej }); socket.send(JSON.stringify({ id, method, params })) })
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result?.value }
const click = (re) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>${re}.test(x.textContent||''));if(!b)throw new Error('introuvable '+${re});b.click();return true})()`
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); const o = `C:/Amitel/Autowin OS/artifacts/${name}.png`; writeFileSync(o, Buffer.from(s.data, 'base64')); return o }

// ROUTING
await ev(click('/agent studio/i')); await new Promise(r=>setTimeout(r,700))
await ev(click('/routage|omniroute/i')); await new Promise(r=>setTimeout(r,900))
const routing = await ev(`(()=>{const rv=document.querySelector('.router-view');const tabs=document.querySelector('.domain-tabs');const act=document.querySelector('.domain-tabs button.is-active');return {routerBg:rv?getComputedStyle(rv).backgroundColor:null,routerBorder:rv?getComputedStyle(rv).borderTopWidth:null,tabsBorder:tabs?getComputedStyle(tabs).borderTopWidth:null,tabsRadius:tabs?getComputedStyle(tabs).borderRadius:null,activeBg:act?getComputedStyle(act).backgroundColor:null,activeBorder:act?getComputedStyle(act).borderTopColor:null,activeLabel:act?act.textContent.trim():null}})()`)
const routingPng = await shot('shell-routing')

// SETTINGS > DIAGNOSTIC
await ev(click('/settings/i')); await new Promise(r=>setTimeout(r,700))
await ev(click('/diagnostic|préflight|preflight/i')); await new Promise(r=>setTimeout(r,900))
const diag = await ev(`(()=>{const p=document.querySelector('.settings-preflight');return {present:!!p,bg:p?getComputedStyle(p).backgroundColor:null,border:p?getComputedStyle(p).borderTopWidth:null,fills:p?p.getBoundingClientRect().height:null}})()`)
const diagPng = await shot('shell-diagnostic')

console.log(JSON.stringify({ routing, routingPng, diag, diagPng }, null, 2))
socket.close()
