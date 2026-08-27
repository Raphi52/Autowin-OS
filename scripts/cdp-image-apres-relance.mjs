/**
 * PREUVE E2E : une image jointe SURVIT-ELLE a un redemarrage de l'app ?
 *
 * En deux phases, separees par une relance de `npm run dev` :
 *   phase `poser`    — conversation neuve, image jointe, phrase neutre.
 *   phase `demander` — apres relance : rouvrir la conversation la plus recente et demander les
 *                      couleurs, SANS rejoindre l'image.
 *
 * Le fil est alors rehydrate depuis le disque : le renderer n'a plus le binaire, seul le store l'a.
 * C'est exactement le chemin que ce run met a l'epreuve.
 */
import { writeFileSync, readFileSync } from 'node:fs'

const PHASE = process.argv[2]
const IMAGE = process.argv[3]
const OUT = process.argv[4] ?? '.'
const ORDRE = process.argv[5] ?? 'magenta,cyan,vert,orange'
if (!['poser', 'demander'].includes(PHASE)) throw new Error('phase attendue : poser | demander')

const list = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result?.value
}
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${file}`, Buffer.from(r.data, 'base64'))
  console.log('[shot]', file)
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms))
const jusqua = async (label, predicat, capMs = 300000) => {
  const debut = Date.now()
  for (;;) {
    if (await ev(predicat)) return true
    if (Date.now() - debut > capMs) throw new Error(`TIMEOUT ${label} (${capMs} ms)`)
    await tick(1500)
  }
}
const occupe = `[...document.querySelectorAll('button')].some(b => /■ Stop|Arrêt…/.test(b.textContent))`
const auRepos = `!(${occupe})`
const bullesAgent = `[...document.querySelectorAll('.msg')].filter(m => m.className.includes('assistant')).length`
const taper = (texte) => `(() => {
  const ta = document.querySelector('.composer textarea')
  if (!ta) return 'PAS DE TEXTAREA'
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  set.call(ta, ${JSON.stringify(texte)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`
const envoyer = `(() => {
  document.querySelector('.composer textarea')
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  return 'ok'
})()`
const dernierTexteAgent = `(() => {
  const b = [...document.querySelectorAll('.msg')].filter(m => m.className.includes('assistant'))
  return (b.at(-1)?.innerText ?? '').slice(0, 4000)
})()`
const attendreFinDeTour = async (label, avant) =>
  jusqua(`${label} termine`, `(() => {
    if (${occupe}) return false
    const b = [...document.querySelectorAll('.msg')].filter(m => m.className.includes('assistant'))
    if (b.length <= ${avant}) return false
    const t = (b.at(-1)?.innerText ?? '').trim()
    return t.length > 8 && !/reflexion|réflexion|REMIS EN FILE|ORIENTÉ/i.test(t)
  })()`)

/*
 * MARQUEUR UNIQUE partage par les deux phases.
 *
 * Mesure du 2026-08-27 : la phase `demander` cliquait le PREMIER `.conv-pick` du panneau, qui n'est
 * pas la conversation posee — la question est partie dans un fil `/salvage` sans rapport, et l'echec
 * mesure etait celui du harnais. Le panneau contient d'ailleurs plusieurs conversations au MEME
 * premier message (les runs precedents) : seul un marqueur unique les separe.
 */
const FICHIER_MARQUEUR = OUT + '/marqueur-relance.txt'
const marqueur =
  PHASE === 'poser'
    ? `repere-${Date.now().toString(36)}`
    : readFileSync(FICHIER_MARQUEUR, 'utf8').trim()
console.log('[marqueur]', marqueur)

/*
 * ATTENDRE que l'UI soit MONTEE avant tout geste.
 *
 * Mesure du 2026-08-27 : lance des que CDP repond, le script trouvait « BOUTON NOUVEAU INTROUVABLE »
 * puis un composer null. Une relance d'app rend CDP disponible bien avant que React ait monte le
 * chat — l'echec mesure etait alors celui du harnais, pas du produit.
 */
await jusqua(
  'UI du chat montee',
  `!!document.querySelector('.composer textarea') &&
   [...document.querySelectorAll('button')].some((b) => b.className.includes('conv-new-row'))`,
  120000
)

await jusqua('chat au repos', auRepos, 600000)

if (PHASE === 'poser') {
  if (!IMAGE) throw new Error('phase poser : chemin image requis')
  console.log('[reset]', await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.className.includes('conv-new-row'))
    if (!b) return 'BOUTON NOUVEAU INTROUVABLE'
    b.click()
    return 'ok'
  })()`))
  await jusqua('fil vide', `document.querySelectorAll('.msg').length === 0`, 20000)
  await send('DOM.enable')
  const { root } = await send('DOM.getDocument')
  const { nodeId } = await send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.attachment-input'
  })
  if (!nodeId) throw new Error("input de piece jointe introuvable")
  await send('DOM.setFileInputFiles', { nodeId, files: [IMAGE] })
  await jusqua(
    'vignette de piece jointe',
    `document.querySelectorAll('.attachment-list.pending .attachment-chip').length > 0`,
    15000
  )
  const avant = await ev(bullesAgent)
  await ev(
    taper(
      `Voici une image (repere ${marqueur}). Ne la decris pas maintenant, garde-la simplement en tete.`
    )
  )
  await jusqua('composer pret', auRepos, 60000)
  await ev(envoyer)
  await attendreFinDeTour('tour 1', avant)
  console.log('=== REPONSE TOUR 1 ===\n' + (await ev(dernierTexteAgent)))
  await shot('relance-tour1.png')
  writeFileSync(FICHIER_MARQUEUR, marqueur)
  console.log('PHASE POSER OK — relancer l app, puis phase demander.')
  process.exit(0)
}

// -------------------------------------------------------------------- phase demander (post-relance)
/*
 * ATTENDRE que le panneau soit CHARGE avant de cliquer.
 *
 * Mesure du 2026-08-27 : lance des que CDP repond, le script trouvait un panneau encore vide (ou
 * partiel) et concluait « INTROUVABLE » — un echec du harnais, pas du produit. Une relance d'app se
 * termine cote CDP bien avant que la liste des conversations soit hydratee.
 */
await jusqua(
  'conversation du marqueur presente dans le panneau',
  `[...document.querySelectorAll('.conv-pick')].some((c) => (c.textContent || '').includes(${JSON.stringify(marqueur)}))`,
  90000
)

const rouvert = await ev(`(() => {
  const cible = [...document.querySelectorAll('.conv-pick')]
    .find((c) => (c.textContent || '').includes(${JSON.stringify(marqueur)}))
  if (!cible) return 'INTROUVABLE'
  cible.click()
  return (cible.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70)
})()`)
console.log('[rouvrir]', rouvert)
if (rouvert === 'INTROUVABLE')
  throw new Error(`conversation du marqueur ${marqueur} absente du panneau — rien n'a ete envoye`)
// Le fil doit etre REHYDRATE depuis le disque : c'est la condition meme du test.
await jusqua('fil rehydrate', `document.querySelectorAll('.msg').length >= 2`, 30000)
await shot('relance-fil-rouvert.png')

const avant = await ev(bullesAgent)
const QUESTION =
  "L'image que je t'ai envoyee plus tot dans CETTE conversation (avant le redemarrage de l'app) : " +
  "ouvre-la si besoin, puis donne de HAUT en BAS les 4 couleurs de ses 4 bandes. Termine par une " +
  "ligne 'COULEURS: a, b, c, d'. Si aucune image ne t'est parvenue, ecris exactement AUCUNE IMAGE."
await ev(taper(QUESTION))
await jusqua('composer pret', auRepos, 300000)
await ev(envoyer)
await attendreFinDeTour('question apres relance', avant)
const reponse = await ev(dernierTexteAgent)
console.log('\n=== REPONSE APRES RELANCE ===\n' + reponse + '\n')
await shot('relance-reponse.png')

const MOTIFS = {
  magenta: ['magenta', 'rose', 'fuchsia'],
  cyan: ['cyan', 'bleu ciel', 'azur', 'turquoise'],
  vert: ['vert', 'lime', 'chartreuse', 'citron'],
  orange: ['orange']
}
const n = reponse.toLowerCase()
let curseur = -1
let ordreRespecte = true
const trouvees = []
for (const cle of ORDRE.split(',').map((x) => x.trim())) {
  if (!MOTIFS[cle]) throw new Error('couleur inconnue : ' + cle)
  const pos = Math.min(
    ...MOTIFS[cle].map((m) => (n.indexOf(m) < 0 ? Number.POSITIVE_INFINITY : n.indexOf(m)))
  )
  trouvees.push({
    bande: cle,
    trouve: Number.isFinite(pos),
    position: Number.isFinite(pos) ? pos : null
  })
  if (!Number.isFinite(pos)) ordreRespecte = false
  else if (pos < curseur) ordreRespecte = false
  else curseur = pos
}
const verdict = {
  ordreAttendu: ORDRE,
  toutesTrouvees: trouvees.every((t) => t.trouve),
  ordreRespecte,
  avoue: n.includes('aucune image'),
  trouvees
}
console.log('=== VERDICT ===')
console.log(JSON.stringify(verdict, null, 2))
writeFileSync(OUT + '/verdict-relance.json', JSON.stringify({ verdict, reponse }, null, 2))
if (verdict.avoue) {
  console.log('ECHEC : aucune image apres relance.')
  process.exit(2)
}
if (!verdict.toutesTrouvees || !verdict.ordreRespecte) {
  console.log('ECHEC : couleurs absentes ou ordre faux.')
  process.exit(3)
}
console.log('SUCCES : image retrouvee APRES relance de l app, ordre des 4 bandes exact.')
process.exit(0)
