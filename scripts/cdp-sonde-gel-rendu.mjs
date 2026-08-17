/**
 * SONDE — le thread renderer se fige-t-il pendant un tour qui streame, et si oui À CAUSE DE QUOI ?
 *
 * Observation faite le 2026-08-17 pendant la sonde du bloc de clôture : l'échantillonneur de
 * défilement (un `setInterval` de 400 ms) n'a rien produit entre 6,7 s et 28,8 s. Un intervalle qui
 * saute 22 s signifie que la boucle d'événements du renderer était occupée — mais « occupée » n'est
 * pas une cause. Cette sonde MESURE, sans rien conclure d'avance :
 *
 *   · le retard réel de chaque tick d'un intervalle de 200 ms (le gel, en ms et en nombre de sauts) ;
 *   · les tâches longues du navigateur (PerformanceObserver `longtask`), avec leur durée ;
 *   · le nombre de deltas reçus, pour rapporter le gel au VOLUME de re-rendu.
 *
 * Usage : node scripts/cdp-sonde-gel-rendu.mjs [--port 9223] [--garder]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] : defaut
}
const port = arg('--port', '9223')
const sortie = resolve(arg('--out', 'Audit/cdp/sonde-gel-rendu.json'))
const garder = process.argv.includes('--garder')
const PROMPT = arg(
  '--prompt',
  'Liste les 30 premiers fichiers du dossier scripts, un par ligne, et pour chacun une phrase sur ce que son nom laisse deviner.'
)
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

const avant = await ev(`(async () => (await window.api.conversations()).map((c) => c.id))()`)
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((n) => (n.textContent ?? '').trim() === 'Nouveau')
  b.click()
  return 'ok'
})()`)
await sleep(900)

// INSTRUMENTATION : retard des ticks, tâches longues, volume de deltas.
await ev(`(() => {
  const t0 = Date.now()
  window.__gel = { t0, retards: [], longues: [], deltas: 0 }
  window.__gelOff = window.api.onPilotEvent((e) => {
    if (e.kind === 'delta') window.__gel.deltas += 1
  })
  let attendu = t0 + 200
  window.__gelTimer = setInterval(() => {
    const maintenant = Date.now()
    window.__gel.retards.push({ t: maintenant - t0, retard: maintenant - attendu })
    attendu = maintenant + 200
  }, 200)
  window.__gelObs = new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries())
      window.__gel.longues.push({
        t: Math.round(entree.startTime),
        duree: Math.round(entree.duration)
      })
  })
  try {
    window.__gelObs.observe({ entryTypes: ['longtask'] })
  } catch (erreur) {
    window.__gel.longtaskIndisponible = String(erreur)
  }
  return 'instrumenté'
})()`)

await ev(`(() => {
  const ta = document.querySelector('.composer textarea')
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  set.call(ta, ${json(PROMPT)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'tapé'
})()`)
await ev(`document.querySelector('.composer .composer-send:not(:disabled)').click()`)

for (let i = 0; i < 90; i++) {
  await sleep(2000)
  const busy = await ev(
    `[...document.querySelectorAll('.composer button')].some((b) => /Stop|Arrêt/u.test(b.textContent ?? ''))`
  )
  if (!busy && i > 1) break
}
await sleep(2000)

const mesure = await ev(`(() => {
  clearInterval(window.__gelTimer)
  window.__gelObs?.disconnect()
  window.__gelOff?.()
  return window.__gel
})()`)

const retards = mesure.retards.map((r) => r.retard)
const gels = mesure.retards.filter((r) => r.retard > 1000)
const longues = [...mesure.longues].sort((a, b) => b.duree - a.duree)
const rapport = {
  deltas: mesure.deltas,
  ticks: mesure.retards.length,
  retardMax: retards.length ? Math.max(...retards) : null,
  gelsAuDessusDeUneSeconde: gels,
  longtaskIndisponible: mesure.longtaskIndisponible ?? null,
  taches: { nombre: mesure.longues.length, plusLongues: longues.slice(0, 15) },
  cumulTachesLongues: mesure.longues.reduce((total, t) => total + t.duree, 0)
}
writeFileSync(sortie, JSON.stringify({ ...rapport, brut: mesure }, null, 2))
console.log(JSON.stringify(rapport, null, 2))
console.log(`\n→ ${sortie}`)

if (!garder) {
  const convId = await ev(`(async () => {
    const apres = await window.api.conversations()
    return apres.filter((c) => !${json(avant)}.includes(c.id)).at(0)?.id ?? null
  })()`)
  if (convId) await ev(`window.api.conversationsRemove(${json(convId)})`).catch(() => {})
}
ws.close()
process.exit(0)
