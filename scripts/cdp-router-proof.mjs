// Preuve visuelle : la vue Router (Agent Studio → Routage OmniRoute) n'est plus « full transparente ».
import { writeFileSync } from 'node:fs'
const targets = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = targets.find((t) => t.type === 'page')
if (!page) throw new Error('Fenêtre Autowin introuvable')
const socket = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0; const pending = new Map()
socket.onmessage = ({ data }) => { const m = JSON.parse(data); const cb = pending.get(m.id); if (cb) { pending.delete(m.id); m.error ? cb.reject(new Error(m.error.message)) : cb.resolve(m.result) } }
await new Promise((r) => (socket.onopen = r))
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++nextId; pending.set(id, { resolve: res, reject: rej }); socket.send(JSON.stringify({ id, method, params })) })
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result?.value }
const clickText = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test(x.textContent||'')); if(!b) throw new Error('bouton introuvable: '+${re}); b.click(); return b.textContent.trim() })()`
// 1) Agent Studio dans la sidebar
await ev(clickText('/agent studio/i'))
await new Promise((r) => setTimeout(r, 800))
// 2) onglet Routage OmniRoute
await ev(clickText('/routage|omniroute/i'))
await new Promise((r) => setTimeout(r, 1000))
const info = await ev(`(() => {
  const rv = document.querySelector('.router-view')
  if (!rv) return { present: false }
  const cs = getComputedStyle(rv)
  const cards = [...document.querySelectorAll('.router-view .surface-panel, .router-view .surface-card')].slice(0,3).map(c=>getComputedStyle(c).backgroundColor)
  return { present: true, rootBg: cs.backgroundColor, rootBorder: cs.borderTopWidth, cardBgs: cards }
})()`)
const shot = await send('Page.captureScreenshot', { format: 'png' })
const output = 'C:/Amitel/Autowin OS/artifacts/router-proof.png'
writeFileSync(output, Buffer.from(shot.data, 'base64'))
console.log(JSON.stringify({ ...info, output }, null, 2))
socket.close()
