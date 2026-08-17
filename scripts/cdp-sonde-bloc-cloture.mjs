/**
 * SONDE — le bloc de clôture apparaît-il DANS LE FIL LIVE, ou seulement après un nouveau message ?
 *
 * Tranche entre deux hypothèses, par la mesure et non par l'intuition :
 *   A. DÉFILEMENT — le bloc est rendu mais hors champ (l'utilisateur n'est plus collé au bas du fil).
 *   B. CIBLE DU PATCH — les événements arrivant après le basculement `done` n'atteignent plus le fil.
 *
 * Piège évité (déjà vécu) : une sonde qui lit `document.body.innerText` n'est PAS scopée à la
 * conversation mesurée — elle peut trouver le bloc d'un fil affiché avant. Ici on vérifie d'abord que
 * le titre affiché EST celui de la sonde, puis on ne lit que les bulles du fil actif.
 *
 * Usage : node scripts/cdp-sonde-bloc-cloture.mjs [--port 9223] [--garder]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] : defaut
}
const port = arg('--port', '9223')
const sortie = resolve(arg('--out', 'Audit/cdp/sonde-bloc-cloture.json'))
const garder = process.argv.includes('--garder')
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

const titre = `Sonde bloc-cloture ${Date.now()}`
// Prompt LONG par défaut : le fil doit DÉPASSER la fenêtre, sinon l'hypothèse « défilement » n'est
// même pas exerçable (une première sonde a rendu « rien à défiler », donc rien à conclure).
const PROMPT = arg(
  '--prompt',
  'Liste les 30 premiers fichiers du dossier scripts, un par ligne, et pour chacun une phrase sur ce que son nom laisse deviner.'
)

// JOURNAL DES ÉVÉNEMENTS PILOTE — vérité terrain sur l'ORDRE (texte tardif après `done` ?).
await ev(`(() => {
  window.__sonde = { events: [], t0: Date.now() }
  window.__sondeOff = window.api.onPilotEvent((e) => {
    window.__sonde.events.push({
      t: Date.now() - window.__sonde.t0,
      kind: e.kind,
      conversationId: e.conversationId,
      streamId: e.streamId,
      iteration: e.iteration,
      len: typeof e.text === 'string' ? e.text.length : undefined,
      bloc: typeof e.text === 'string' ? /✅ Fait|📍 Maintenant/u.test(e.text) : false
    })
  })
  return 'armé'
})()`)

// FIL NEUF PAR L'UI : le bouton « Nouveau » crée ET affiche le fil — c'est le seul moyen sûr d'avoir
// le fil mesuré à l'écran (créer par l'API laisse l'affichage sur un AUTRE fil, et la liste replie ses
// catégories : la sonde mesurerait alors une conversation qu'elle n'a pas produite).
const avant = await ev(
  `(async () => (await window.api.conversations()).map((c) => c.id))()`
)
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((n) => (n.textContent ?? '').trim() === 'Nouveau')
  if (!b) throw new Error('bouton Nouveau introuvable')
  b.click()
  return 'ok'
})()`)
await sleep(900)
const titreAffiche = await ev(`document.querySelector('.chat-conv-title')?.textContent ?? null`)
if (!/Nouvelle conversation|Sans titre/u.test(String(titreAffiche ?? '')))
  throw new Error(`fil neuf non affiché (titre affiché = ${titreAffiche})`)

// ENVOI PAR LE COMPOSER — le vrai chemin utilisateur, pas `pilotChat` en direct.
await ev(`(() => {
  const ta = document.querySelector('.composer textarea')
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  set.call(ta, ${json(PROMPT)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'tapé'
})()`)
// ÉCHANTILLONNAGE DU DÉFILEMENT pendant le tour : dire QUAND le suivi du bas décroche, au lieu de
// constater seulement l'état final. Le badge « ↓ Dernière réponse » est la trace visible du décrochage.
await ev(`(() => {
  const scroll = document.querySelector('.chat-scroll')
  window.__sondeScroll = []
  window.__sondeScrollTimer = setInterval(() => {
    window.__sondeScroll.push({
      t: Date.now() - window.__sonde.t0,
      top: Math.round(scroll.scrollTop),
      h: Math.round(scroll.scrollHeight),
      bas: Math.round(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight),
      badge: Boolean(document.querySelector('.chat-jump-latest'))
    })
  }, 400)
  return 'échantillonnage armé'
})()`)
await ev(`document.querySelector('.composer .composer-send:not(:disabled)').click()`)

const lireEtat = () => ev(`(() => {
  const scroll = document.querySelector('.chat-scroll') ?? document.querySelector('.msgs')?.parentElement
  const bulles = [...document.querySelectorAll('.msg.assistant .msg-body')].map((n) => n.innerText)
  const dom = bulles.join('\\n---\\n')
  const usagers = [...document.querySelectorAll('.msg.user .msg-body')].map((n) => n.innerText)
  return {
    // SCOPE : le fil affiché est bien celui de la sonde (un seul message utilisateur, le nôtre).
    filDeLaSonde: usagers.length === 1 && usagers[0].includes(${json(PROMPT.slice(0, 40))}),
    titre: document.querySelector('.chat-conv-title')?.textContent ?? null,
    busy: [...document.querySelectorAll('.composer button')].some((b) => /Stop|Arrêt/u.test(b.textContent ?? '')),
    bulles: bulles.length,
    domLen: dom.length,
    domFin: dom.slice(-400),
    blocDansDom: /✅ Fait/u.test(dom),
    etatDansDom: /📍 Maintenant/u.test(dom),
    // PRÉSENT ≠ VISIBLE : le bloc peut être rendu sous le bas de la fenêtre de défilement.
    blocVisible: (() => {
      if (!scroll) return null
      const cadre = scroll.getBoundingClientRect()
      const porteur = [...scroll.querySelectorAll('.msg.assistant .msg-body')].find((n) =>
        /✅ Fait/u.test(n.innerText)
      )
      if (!porteur) return false
      const r = porteur.getBoundingClientRect()
      return r.top < cadre.bottom && r.bottom > cadre.top
    })(),
    defilable: scroll ? scroll.scrollHeight - scroll.clientHeight > 40 : null,
    scroll: scroll
      ? {
          scrollTop: Math.round(scroll.scrollTop),
          scrollHeight: Math.round(scroll.scrollHeight),
          clientHeight: Math.round(scroll.clientHeight),
          distanceDuBas: Math.round(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight)
        }
      : null,
    badge: document.querySelector('.chat-jump-latest')?.textContent ?? null
  }
})()`)

let etatFinTour = null
for (let i = 0; i < 90; i++) {
  await sleep(2000)
  const etat = await lireEtat()
  if (!etat.busy && etat.bulles > 0) {
    etatFinTour = etat
    break
  }
}
if (!etatFinTour) throw new Error('le tour ne se termine pas (cap 180 s)')

// Laisser passer d'éventuels événements tardifs, puis relire SANS rien faire d'autre.
await sleep(4000)
const etatApres = await lireEtat()

if (!etatApres.filDeLaSonde)
  throw new Error('le fil affiché n’est pas celui de la sonde — mesure invalide')

const convId = await ev(`(async () => {
  const apres = await window.api.conversations()
  const neufs = apres.filter((c) => !${json(avant)}.includes(c.id))
  return neufs.at(0)?.id ?? null
})()`)
if (!convId) throw new Error('fil de la sonde introuvable après le tour')
const persiste = await ev(`window.api.conversation(${json(convId)})`)
const dernier = [...(persiste?.messages ?? [])].reverse().find((m) => m.role === 'assistant')
const contenuPersiste = dernier?.content ?? ''
const partsPersistees = (dernier?.parts ?? []).map((p) => ({
  kind: p.kind,
  streamId: p.streamId,
  len: typeof p.text === 'string' ? p.text.length : undefined,
  bloc: typeof p.text === 'string' ? /✅ Fait/u.test(p.text) : false
}))
const events = await ev(`window.__sonde.events.filter((e) => e.conversationId === ${json(convId)})`)
const echantillons = await ev(
  `(() => { clearInterval(window.__sondeScrollTimer); return window.__sondeScroll })()`
)
await ev(`(() => { window.__sondeOff?.(); return 'désarmé' })()`)

const rapport = {
  convId,
  titre,
  etatFinTour,
  etatApres,
  persiste: {
    len: contenuPersiste.length,
    bloc: /✅ Fait/u.test(contenuPersiste),
    etat: /📍 Maintenant/u.test(contenuPersiste),
    fin: contenuPersiste.slice(-400),
    parts: partsPersistees
  },
  events,
  echantillons,
  diagnostic: {
    blocPersiste: /✅ Fait/u.test(contenuPersiste),
    blocRenduDansLeFilActif: etatApres.blocDansDom,
    horsChamp: etatApres.blocDansDom && (etatApres.scroll?.distanceDuBas ?? 0) > 40
  }
}
writeFileSync(sortie, JSON.stringify(rapport, null, 2))
console.log(JSON.stringify(rapport.diagnostic, null, 2))
console.log(`\nDOM fin : ${JSON.stringify(etatApres.domFin.slice(-200))}`)
console.log(`Persisté fin : ${JSON.stringify(rapport.persiste.fin.slice(-200))}`)
console.log(`Scroll : ${JSON.stringify(etatApres.scroll)}`)
console.log(`Événements : ${events.map((e) => `${e.t}ms ${e.kind}${e.bloc ? '(BLOC)' : ''}`).join(' | ')}`)
console.log(`\n→ ${sortie}`)

if (convId && !garder) await ev(`window.api.conversationsRemove(${json(convId)})`).catch(() => {})
ws.close()
process.exit(0)
