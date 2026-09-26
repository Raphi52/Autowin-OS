/**
 * SONDE — le fil SUIT-IL le bas pendant un tour, et que se passe-t-il au clic sur ∞ (mode auto) ?
 *
 * Defaut vecu le 2026-09-12 : « quand tu finis ton tour et que je click sur le bouton Auto pour
 * envoyer le preprompt, ca envoie le prompt mais je le vois pas car ca scroll pas le chat ».
 * Six reproductions en happy-dom sont restees VERTES : la mise en page n'y existe pas. Cette sonde
 * mesure donc l'application REELLE (instance isolee, fixture gratuite) et rend la trace du
 * defilement image par image, avant / pendant / apres le clic.
 *
 * Usage : node scripts/avec-instance-headless.mjs -- node scripts/cdp-sonde-scroll-mode-auto.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { portCdp } from './cdp-port.mjs'

const port = portCdp()
const sortie = resolve('Audit/cdp/sonde-scroll-mode-auto.json')
mkdirSync(dirname(sortie), { recursive: true })
const cibles = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = cibles.find((c) => c.type === 'page')
if (!page) throw new Error(`Fenetre Autowin introuvable sur ${port}`)
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pend = new Map()
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data)
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
    if (txt.includes('[SONDE2]')) journal.push({ t: Date.now(), txt })
    return
  }
  const cb = pend.get(m.id)
  if (!cb) return
  pend.delete(m.id)
  m.error ? cb.reject(new Error(m.error.message)) : cb.resolve(m.result)
}
const journal = []
await new Promise((r) => { ws.onopen = r })
const rpc = (method, params = {}) =>
  new Promise((ok, ko) => { const i = ++id; pend.set(i, { resolve: ok, reject: ko }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expression) => {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
await rpc('Runtime.enable')
const json = (v) => JSON.stringify(v)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PROMPT = '[[autowin-fixture-durable-stream]] cloture'

// 1. Interface montee, onglet Chat.
{
  const echeance = Date.now() + 40_000
  for (;;) {
    const monte = await ev(`Boolean(document.querySelector('[data-testid="nav-chat"]') && window.api)`).catch(() => false)
    if (monte) break
    if (Date.now() >= echeance) throw new Error("L'interface n'est pas montee apres 40 s")
    await sleep(300)
  }
  await ev(`(() => { document.querySelector('[data-testid="nav-chat"]').click(); return true })()`)
  await sleep(800)
}

// 2. Fil neuf par l'UI.
await ev(`(() => { document.querySelector('.conv-new-row').click(); return 'ok' })()`)
await sleep(900)

// 3. Echantillonnage du defilement, en continu.
await ev(`(() => {
  window.__t0 = Date.now()
  window.__ech = []
  window.__marques = []
  window.__timer = setInterval(() => {
    const s = document.querySelector('.chat-scroll')
    if (!s) return
    window.__ech.push({
      t: Date.now() - window.__t0,
      top: Math.round(s.scrollTop),
      h: Math.round(s.scrollHeight),
      bas: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight),
      badge: Boolean(document.querySelector('.chat-jump-latest'))
    })
  }, 150)
  return 'arme'
})()`)

// 4. Trois tours de fixture pour que le fil DEPASSE largement la fenetre.
const occupe = () => ev(`[...document.querySelectorAll('.composer button')].some((b) => /Stop|Arr/u.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))`)
const envoyer = async (texte, marque) => {
  await ev(`(() => {
    const ta = document.querySelector('.composer textarea')
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    set.call(ta, ${json(texte)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return 'tape'
  })()`)
  await ev(`(() => { window.__marques.push({ t: Date.now() - window.__t0, quoi: ${json(marque)} }); document.querySelector('.composer .composer-send:not(:disabled)').click(); return 'envoye' })()`)
  const echeance = Date.now() + 60_000
  while (Date.now() < echeance) { if (!(await occupe())) break; await sleep(400) }
  await sleep(1200)
}
for (let i = 0; i < 3; i++) await envoyer(PROMPT, `envoi-${i}`)
await ev(`(() => { window.__marques.push({ t: Date.now() - window.__t0, quoi: 'tour-fini' }); return 'ok' })()`)

// 6. LE GESTE MESURE : clic sur ∞ alors que le fil est immobile et le tour termine.
const avantClic = await ev(`(() => { const s = document.querySelector('.chat-scroll'); return { top: Math.round(s.scrollTop), h: s.scrollHeight, bas: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight) } })()`)
journal.length = 0
const clic = await ev(`(() => {
  window.__marques.push({ t: Date.now() - window.__t0, quoi: 'clic-auto' })
  const b = document.querySelector('[data-testid="composer-auto-toggle"]')
  if (!b) return { ok: false, boutons: [...document.querySelectorAll('.composer button')].map((x) => x.getAttribute('aria-label') || x.className) }
  b.click()
  return { ok: true }
})()`)
console.log('clic', JSON.stringify(clic))
await sleep(6000)
const apresClic = await ev(`(() => { const s = document.querySelector('.chat-scroll'); return { top: Math.round(s.scrollTop), h: s.scrollHeight, bas: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight), badge: Boolean(document.querySelector('.chat-jump-latest')) } })()`)
const trace = await ev(`(() => { clearInterval(window.__timer); return { ech: window.__ech, marques: window.__marques } })()`)
writeFileSync(sortie, JSON.stringify({ avantClic, apresClic, ...trace, journal }, null, 2))
console.log('--- sondes autour du clic ---')
for (const l of journal.slice(-80)) console.log(l.txt)
console.log(JSON.stringify({ avantClic, apresClic, marques: trace.marques }, null, 2))
console.log('echantillons', trace.ech.length, '->', sortie)
ws.close()
