/**
 * Pilote le renderer via CDP (remote debugging) — marche SANS focus ni souris
 * (session RDP détachée incluse). Usage : node scripts/cdp-drive.mjs
 * Étapes : ouvrir Workflows → onglet Activité → screenshot → ouvrir 1re session
 * → screenshot détail → habitudes → screenshot.
 */
import { writeFileSync } from 'node:fs'

const list = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = list.find((t) => t.type === 'page')
if (!page) throw new Error('pas de page CDP')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(m.error.message)) : res(m.result)
  }
}
await new Promise((r) => (ws.onopen = r))
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id
    pending.set(i, { res, rej })
    ws.send(JSON.stringify({ id: i, method, params }))
  })

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true
  })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result?.value
}
const clickByText = (text) =>
  evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}))
    if (!b) return 'INTROUVABLE: ' + ${JSON.stringify(text)}
    b.click(); return 'clicked'
  })()`)
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(file, Buffer.from(r.data, 'base64'))
  console.log('[shot]', file)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('[cdp] connecté à', page.url)
console.log('[1]', await clickByText('workflows'))
await sleep(400)
console.log('[2]', await clickByText('activité'))
await sleep(1200) // sessions + ledger chargés
await shot('C:/Amitel/Autowin OS/act-sessions.png')
// ouvrir la 1re session de la liste (cartes .run-row dans le panneau activité)
console.log(
  '[3]',
  await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.runs-pane .run-row')]
    if (!cards.length) return 'AUCUNE CARTE'
    cards[0].click(); return 'clicked ' + cards.length + ' cartes'
  })()`)
)
await sleep(2500) // parse du transcript + chargement vignettes
await shot('C:/Amitel/Autowin OS/act-detail.png')
console.log('[4]', await clickByText('← sessions'))
await sleep(300)
console.log('[5]', await clickByText('habitudes'))
await sleep(4000) // agrégat ~20 sessions
await shot('C:/Amitel/Autowin OS/act-habits.png')
ws.close()
console.log('[done]')
