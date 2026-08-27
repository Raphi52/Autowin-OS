/**
 * PREUVE E2E : une image jointe au tour 1 est-elle encore lisible au tour 2 ?
 *
 * Discriminant : l'image est une planche de 4 bandes horizontales dont l'ORDRE est arbitraire
 * (magenta, cyan, vert-lime, orange). Une reponse inventee ne peut pas retomber par hasard sur
 * l'ordre exact ; c'est ce qui separe une lecture d'une reconstruction.
 *
 * Tour 1 : image + phrase neutre (controle — ce chemin marchait DEJA avant le correctif).
 * Tour 2 : question sur l'image, SANS la rejoindre (le cas qui echouait).
 */
import { writeFileSync } from 'node:fs'

const IMAGE = process.argv[2]
if (!IMAGE) throw new Error('usage: node cdp-image-tour-precedent.mjs <chemin image>')
const OUT = process.argv[3] ?? '.'

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

/** Attend une condition plutot que de dormir une duree devinee. */
const jusqua = async (label, predicat, capMs = 240000) => {
  const debut = Date.now()
  for (;;) {
    if (await ev(predicat)) return true
    if (Date.now() - debut > capMs) throw new Error(`TIMEOUT ${label} (${capMs} ms)`)
    await tick(1500)
  }
}

const compterMessages = `[...document.querySelectorAll('.msg')].filter(m => m.className.includes('assistant')).length`
const dernierTexteAgent = `(() => {
  const bulles = [...document.querySelectorAll('.msg')].filter(m => !m.className.includes('user'))
  return (bulles.at(-1)?.innerText ?? '').slice(0, 4000)
})()`
/**
 * Le tour est-il REELLEMENT termine ?
 *
 * Mesure du 2026-08-27 : un predicat base sur le seul compteur de bulles a lu « reflexion... »
 * comme une reponse finale, et a envoye le tour 2 pendant le tour 1 — l'app l'a alors remis en
 * file (« ECHEC — REMIS EN FILE »). On exige donc une DERNIERE bulle assistant posee : composer
 * reactive, aucun streaming, et un texte qui n'est plus un marqueur d'attente.
 */
/**
 * OCCUPE ? Le seul temoin fiable est le bouton STOP — il n'est RENDU que pendant un tour.
 *
 * Deux pistes essayees et refutees le 2026-08-27 : le textarea reste ACTIF pendant un tour (c'est
 * voulu — il sert a envoyer des directives en cours de tour), et le bouton Envoyer n'est desactive
 * que sur composer vide. Resultat : trois runs ont envoye le tour 2 DANS le tour 1, que l'app a
 * traite en directive (« REMIS EN FILE », « ORIENTE ») au lieu d'un nouveau tour. Le bouton Stop,
 * lui, apparait et disparait avec le tour : c'est le seul etat qui distingue les deux.
 */
const occupe = `[...document.querySelectorAll('button')].some(b => /■ Stop|Arrêt…/.test(b.textContent))`
const pretAEnvoyer = `!(${occupe})`

const taper = (texte) => `(() => {
  const ta = document.querySelector('.composer textarea')
  if (!ta) return 'PAS DE TEXTAREA'
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  set.call(ta, ${JSON.stringify(texte)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`

const envoyer = `(() => {
  const ta = document.querySelector('.composer textarea')
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  return 'ok'
})()`

/** Attend la fin d'un tour : bouton Stop disparu, et une nouvelle bulle assistant posee. */
const attendreFinDeTour = async (label, avant) =>
  jusqua(`${label} termine`, `(() => {
    if (${occupe}) return false
    const bulles = [...document.querySelectorAll('.msg')].filter(m => m.className.includes('assistant'))
    if (bulles.length <= ${avant}) return false
    const t = (bulles.at(-1)?.innerText ?? '').trim()
    return t.length > 8 && !/reflexion|réflexion|REMIS EN FILE|ORIENTÉ/i.test(t)
  })()`)

// ---------------------------------------------------------------- tour 1 : image + phrase neutre
/*
 * CONVERSATION NEUVE a chaque run — non negociable.
 *
 * Mesure du 2026-08-27 : un run precedent avait laisse un message EN FILE ; il a ete traite comme
 * « tour 1 » du run suivant, qui a donc mesure la reponse a une autre question. Un fil reutilise
 * porte aussi d'anciennes images, ce qui rendrait un succes inattribuable a l'image du run.
 */
await jusqua('chat au repos (avant reset)', pretAEnvoyer, 600000)
console.log('[reset]', await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.className.includes('conv-new-row'))
  if (!b) return 'BOUTON NOUVEAU INTROUVABLE'
  b.click()
  return 'ok'
})()`))
await jusqua('fil vide', `document.querySelectorAll('.msg').length === 0`, 20000)

// Partir d'un chat AU REPOS : lancer le tour 1 pendant un tour en cours le transformerait en
// directive, et le protocole (2 tours distincts) serait perdu avant d'avoir commence.
await jusqua('chat au repos', pretAEnvoyer, 600000)
await send('DOM.enable')
const { root } = await send('DOM.getDocument')
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '.attachment-input' })
if (!nodeId) throw new Error("input de piece jointe introuvable ('.attachment-input')")
await send('DOM.setFileInputFiles', { nodeId, files: [IMAGE] })
console.log('[tour1] image posee dans le composer')

// La vignette doit apparaitre : sans elle, le fichier n'est pas entre dans l'etat React.
await jusqua('vignette de piece jointe', `document.querySelectorAll('.attachment-list.pending .attachment-chip').length > 0`, 15000)
await shot('tour1-avant-envoi.png')

const avant = await ev(compterMessages)
console.log('[tour1 type]', await ev(taper("Voici une image. Ne la decris pas maintenant, garde-la simplement en tete.")))
await jusqua('composer pret (tour 1)', pretAEnvoyer, 60000)
console.log('[tour1 send]', await ev(envoyer))
await attendreFinDeTour('tour 1', avant)
const reponse1 = await ev(dernierTexteAgent)
console.log('\n=== REPONSE TOUR 1 ===\n' + reponse1 + '\n')
await shot('tour1-reponse.png')

// -------------------------------------------- tour 2 : question sur l'image, SANS la rejoindre
const avant2 = await ev(compterMessages)
/*
 * La question AUTORISE explicitement l'ouverture du fichier.
 *
 * Le provider Claude ne pousse pas l'image en bloc `image` : il la materialise en FICHIER et en
 * donne le chemin dans le prompt. Une consigne « reponds uniquement par les 4 noms » interdit donc
 * de fait le `Read` qui la rend visible — deux runs ont ainsi rendu « AUCUNE IMAGE » alors que la
 * trace de prompt montrait le chemin bien present. Ce qui est teste ici est le TRANSPORT de l'image
 * du tour 1 vers le tour 2, pas la frugalite en outils.
 */
const QUESTION =
  "L'image que je t'ai envoyee au message PRECEDENT (pas dans ce message-ci) : ouvre-la si tu as " +
  "besoin de la lire, puis donne de HAUT en BAS les 4 couleurs de ses 4 bandes. Termine par une " +
  "ligne 'COULEURS: a, b, c, d'. Si aucune image du tour precedent ne t'est parvenue, ecris " +
  "exactement AUCUNE IMAGE."
console.log('[tour2 type]', await ev(taper(QUESTION)))
await jusqua('composer pret (tour 2)', pretAEnvoyer, 300000)
console.log('[tour2 send]', await ev(envoyer))
await attendreFinDeTour('tour 2', avant2)
const reponse2 = await ev(dernierTexteAgent)
console.log('\n=== REPONSE TOUR 2 ===\n' + reponse2 + '\n')
await shot('tour2-reponse.png')

// ---------------------------------------------------------------------------------- verdict
const n = reponse2.toLowerCase()
/*
 * L'ordre attendu est un PARAMETRE, pas une constante.
 *
 * Mesure du 2026-08-27 : onze runs avaient laisse des dossiers temporaires contenant la MEME image,
 * et le modele pouvait y relire les bonnes couleurs meme quand la piece jointe n'etait plus
 * transmise — un sabotage inattaquable devenait ininterpretable. Une image d'ordre DIFFERENT par
 * run rend un residu incapable de repondre a la place du run courant.
 */
const MOTIFS = {
  magenta: ['magenta', 'rose', 'fuchsia'],
  cyan: ['cyan', 'bleu ciel', 'azur', 'turquoise'],
  vert: ['vert', 'lime', 'chartreuse', 'citron'],
  orange: ['orange']
}
const ordreAttendu = (process.argv[4] ?? 'magenta,cyan,vert,orange')
  .split(',')
  .map((cle) => cle.trim())
  .map((cle) => {
    if (!MOTIFS[cle]) throw new Error(`couleur inconnue dans l'ordre attendu : ${cle}`)
    return { nom: cle, motifs: MOTIFS[cle] }
  })
console.log('[ordre attendu]', ordreAttendu.map((b) => b.nom).join(' > '))
let curseur = -1
let ordreRespecte = true
const trouvees = []
for (const bande of ordreAttendu) {
  const pos = Math.min(
    ...bande.motifs.map((m) => (n.indexOf(m) < 0 ? Number.POSITIVE_INFINITY : n.indexOf(m)))
  )
  trouvees.push({ bande: bande.nom, trouve: Number.isFinite(pos), position: pos })
  if (!Number.isFinite(pos)) ordreRespecte = false
  else if (pos < curseur) ordreRespecte = false
  else curseur = pos
}
const avoue = n.includes('aucune image')
const verdict = { toutesTrouvees: trouvees.every((t) => t.trouve), ordreRespecte, avoue, trouvees }
console.log('=== VERDICT ===')
console.log(JSON.stringify(verdict, null, 2))
writeFileSync(`${OUT}/verdict.json`, JSON.stringify({ verdict, reponse1, reponse2 }, null, 2))

if (avoue) {
  console.log('ECHEC : le modele declare ne pas voir l image au tour 2.')
  process.exit(2)
}
if (!verdict.toutesTrouvees || !ordreRespecte) {
  console.log('ECHEC : les 4 couleurs ne sont pas toutes la, ou pas dans l ordre haut->bas.')
  process.exit(3)
}
console.log('SUCCES : image du tour 1 lue au tour 2, ordre des 4 bandes exact.')
process.exit(0)
