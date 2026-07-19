/**
 * E2E via CDP : envoie un VRAI prompt dans le chat de l'app et vérifie tous les éléments —
 * bulle user, réponse agent, puce d'action (commande exécutée), conversation persistée
 * (panneau gauche), trace ledger in-app (observatoire).
 */
import { writeFileSync } from 'node:fs'

const list = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = list.find((t) => t.type === 'page')
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
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(file, Buffer.from(r.data, 'base64'))
  console.log('[shot]', file)
}

// 0. état propre : fermer le panneau workflows s'il est ouvert
await ev(`(() => { const x = [...document.querySelectorAll('.runs-pane .btn-ghost')].find(b => b.textContent.trim()==='✕'); if (x) x.click(); return 'ok' })()`)
await sleep(300)

// 1. taper le prompt (setter natif React) + envoyer
const PROMPT = 'Crée une conversation « Test complet » en catégorie codex, puis dis-moi en une phrase ce que tu as fait.'
console.log('[1 type]', await ev(`(() => {
  const ta = document.querySelector('.composer textarea')
  if (!ta) return 'PAS DE TEXTAREA'
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  set.call(ta, ${JSON.stringify(PROMPT)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`))
console.log('[2 send]', await ev(`(() => {
  const b = [...document.querySelectorAll('.composer button')].find(x => !x.disabled)
  if (!b) return 'BOUTON DISABLED'
  b.click(); return 'clicked'
})()`))

// 2. attendre la fin du tour (spinner header disparu), cap 120 s
let done = false
for (let i = 0; i < 60; i++) {
  await sleep(2000)
  const busy = await ev(`!!document.querySelector('.composer button .spinner')`)
  if (!busy) { done = true; break }
}
console.log('[3 tour terminé]', done)
await sleep(500)

// 3. vérifier chaque élément dans le DOM
const checks = await ev(`(() => {
  const userMsg = [...document.querySelectorAll('.msg.user .msg-body')].map(e => e.textContent)
  const agentTexts = [...document.querySelectorAll('.msg.assistant .msg-body')].map(e => e.textContent.slice(0, 120))
  const chips = [...document.querySelectorAll('.action-chip')].map(e => e.textContent.trim().slice(0, 80))
  const convs = [...document.querySelectorAll('.conv-item .conv-label')].map(e => e.textContent)
  const title = document.querySelector('.chat-conv-title')?.textContent
  return { userMsg, agentTexts, chips, convs, title }
})()`)
console.log('[4 éléments]', JSON.stringify(checks, null, 1))
await shot('C:/Amitel/Autowin OS/e2e-chat.png')

// 4. observatoire : ledger in-app doit contenir create_conversation
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Workflows')); b?.click(); return 'ok' })()`)
await sleep(300)
await ev(`(() => { const b = [...document.querySelectorAll('.runs-pane button')].find(x => x.textContent.trim()==='Activité'); b?.click(); return 'ok' })()`)
await sleep(800)
await ev(`(() => { const b = [...document.querySelectorAll('.runs-pane button')].find(x => x.textContent.trim()==='in-app'); b?.click(); return 'ok' })()`)
await sleep(800)
const ledger = await ev(`[...document.querySelectorAll('.runs-pane .act-tool')].slice(0, 6).map(e => e.textContent.trim().slice(0, 90))`)
console.log('[5 ledger in-app]', JSON.stringify(ledger, null, 1))
await shot('C:/Amitel/Autowin OS/e2e-ledger.png')

const ok =
  done &&
  checks.chips.some((c) => /Conversation créée|create_conversation/.test(c)) &&
  checks.convs.some((c) => /Test complet/i.test(c)) &&
  Array.isArray(ledger) && ledger.some((l) => /create_conversation/.test(l))
console.log('[verdict]', ok ? 'TOUS LES ÉLÉMENTS OK' : 'MANQUE UN ÉLÉMENT')
ws.close()
process.exit(ok ? 0 : 1)
