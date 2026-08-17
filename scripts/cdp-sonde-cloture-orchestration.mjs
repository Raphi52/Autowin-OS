/**
 * SONDE — un texte de clôture porté UNIQUEMENT par l'événement `done` atteint-il le fil LIVE ?
 *
 * Cas rapporté le 2026-08-17 (conv-1276, tour « finis ça une bonne fois pour toutes ») : l'utilisateur
 * n'a vu que la ligne « ⛔ Workflow BLOQUÉ par le gate », et tout le reste de la réponse n'est apparu
 * qu'après l'envoi du message suivant. Le message persisté porte une seule part de texte, de flux
 * `<turnId>:closing` — celle que `src/main/index.ts` écrit dans le STORE à la réception du `done`.
 *
 * Distinct du défaut de défilement corrigé le même jour : ici la question est si le texte ARRIVE au
 * fil live, pas s'il est visible à l'écran.
 *
 * La fixture `[[autowin-fixture-auto-kaizen-error]]` a exactement la bonne forme — aucun delta, un
 * `done` porteur de texte — et elle est déterministe : aucun appel de modèle, aucun coût.
 *
 * Usage : node scripts/cdp-sonde-cloture-orchestration.mjs [--port 9223] [--garder]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] : defaut
}
const port = arg('--port', '9223')
const sortie = resolve(arg('--out', 'Audit/cdp/sonde-cloture-orchestration.json'))
const garder = process.argv.includes('--garder')
const PROMPT = '[[autowin-fixture-auto-kaizen-error]] sonde cloture live'
const ATTENDU = 'Erreur structurée de fixture transmise à Auto-Kaizen.'
mkdirSync(dirname(sortie), { recursive: true })

const cibles = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = cibles.find((c) => c.type === 'page')
if (!page) throw new Error(`Fenêtre Autowin introuvable sur ${port}`)
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pend = new Map()
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data)
  const cb = pend.get(m.id)
  if (!cb) return
  pend.delete(m.id)
  m.error ? cb.reject(new Error(m.error.message)) : cb.resolve(m.result)
}
await new Promise((r) => {
  ws.onopen = r
})
const rpc = (method, params = {}) =>
  new Promise((ok, ko) => {
    const i = ++id
    pend.set(i, { resolve: ok, reject: ko })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev = async (expression) => {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
const json = (v) => JSON.stringify(v)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Journal des événements reçus par le RENDERER : dire si un delta porte le texte de clôture, ou si
// seul le `done` l'apporte (auquel cas le réducteur le jette — mesuré, `done` → `{kind:'done'}`).
await ev(`(() => {
  window.__cl = { events: [], t0: Date.now() }
  window.__clOff = window.api.onPilotEvent((e) => {
    window.__cl.events.push({
      t: Date.now() - window.__cl.t0,
      kind: e.kind,
      streamId: e.streamId,
      porteLeTexte: typeof e.text === 'string' && e.text.includes(${json(ATTENDU)})
    })
  })
  return 'armé'
})()`)

// Une instance NEUVE ouvre son assistant de démarrage, qui désactive le composer : sans ce passage,
// la sonde tape son prompt dans le vide et conclut « le tour ne se termine pas ».
for (let i = 0; i < 20; i++) {
  const reste = await ev(`(() => {
    document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()
    return Boolean(document.querySelector('[data-testid="first-run-wizard"]'))
  })()`)
  if (!reste) break
  await sleep(250)
}

const avant = await ev(`(async () => (await window.api.conversations()).map((c) => c.id))()`)
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((n) => (n.textContent ?? '').trim() === 'Nouveau')
  b.click()
  return 'ok'
})()`)
await sleep(900)
await ev(`(() => {
  const ta = document.querySelector('.composer textarea')
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  set.call(ta, ${json(PROMPT)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'tapé'
})()`)
await ev(`document.querySelector('.composer .composer-send:not(:disabled)').click()`)

const lire = () => ev(`(() => {
  const usagers = [...document.querySelectorAll('.msg.user .msg-body')].map((n) => n.innerText)
  const bulles = [...document.querySelectorAll('.msg.assistant .msg-body')].map((n) => n.innerText)
  return {
    // SCOPE : on ne lit que le fil de la sonde (un seul message utilisateur, le nôtre).
    filDeLaSonde: usagers.length === 1 && usagers[0].includes('autowin-fixture-auto-kaizen-error'),
    busy: [...document.querySelectorAll('.composer button')].some((b) => /Stop|Arrêt/u.test(b.textContent ?? '')),
    bulles: bulles.length,
    texteLive: bulles.join('\\n---\\n'),
    clotureDansLeFilLive: bulles.some((b) => b.includes(${json(ATTENDU)}))
  }
})()`)

let etat = null
for (let i = 0; i < 45; i++) {
  await sleep(1000)
  const lu = await lire()
  if (!lu.busy && lu.bulles > 0) {
    etat = lu
    break
  }
}
if (!etat) throw new Error('le tour ne se termine pas (cap 45 s)')
await sleep(3000)
const apres = await lire()
if (!apres.filDeLaSonde) throw new Error('fil affiché ≠ fil de la sonde — mesure invalide')

const convId = await ev(`(async () => {
  const liste = await window.api.conversations()
  return liste.filter((c) => !${json(avant)}.includes(c.id)).at(0)?.id ?? null
})()`)
const persiste = await ev(`window.api.conversation(${json(convId)})`)
const dernier = [...(persiste?.messages ?? [])].reverse().find((m) => m.role === 'assistant')
const events = await ev(`(() => { window.__clOff?.(); return window.__cl.events })()`)

const rapport = {
  convId,
  clotureDansLeFilLive: apres.clotureDansLeFilLive,
  clotureDansLePersiste: (dernier?.content ?? '').includes(ATTENDU),
  partsPersistees: (dernier?.parts ?? []).map((p) => ({
    kind: p.kind,
    streamId: p.streamId,
    porteLeTexte: typeof p.text === 'string' && p.text.includes(ATTENDU)
  })),
  evenementsPortantLeTexte: events.filter((e) => e.porteLeTexte),
  texteLive: apres.texteLive.slice(0, 400)
}
writeFileSync(sortie, JSON.stringify({ ...rapport, events }, null, 2))
console.log(JSON.stringify(rapport, null, 2))
console.log(`\n→ ${sortie}`)

if (convId && !garder) await ev(`window.api.conversationsRemove(${json(convId)})`).catch(() => {})
ws.close()
// Le défaut EST l'écart entre les deux : persisté sans être livré au fil live.
process.exit(rapport.clotureDansLeFilLive ? 0 : 1)
