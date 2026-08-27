/**
 * PREUVE E2E : la connaissance TRAVERSE-T-ELLE les conversations ?
 *
 * Rejoue le test que l'utilisateur a fait lui-meme le 2026-08-27 : une image est jointe dans une
 * conversation, la question est posee depuis une AUTRE, neuve. Avant le correctif, l'agent lisait le
 * fil cible et n'y trouvait que du texte : l'image y etait mentionnee, jamais atteignable.
 *
 * Discriminant : on demande la 3e bande EN PARTANT DU BAS. Repondre juste exige d'avoir vu les
 * pixels ET compte dans le bon sens — deux facons de se tromper, une seule de reussir.
 */
import { writeFileSync, readFileSync } from 'node:fs'

const CONV = process.argv[2]
const OUT = process.argv[3] ?? '.'
const ATTENDU = (process.argv[4] ?? 'magenta').toLowerCase()
if (!CONV) throw new Error('usage: node cdp-omniscience-inter-conversation.mjs <conv-id> <out> <couleur attendue>')

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
 * (marqueur inutile ici : la conversation cible est nommee explicitement.)
 *
 * Mesure du 2026-08-27 : la phase `demander` cliquait le PREMIER `.conv-pick` du panneau, qui n'est
 * pas la conversation posee — la question est partie dans un fil `/salvage` sans rapport, et l'echec
 * mesure etait celui du harnais. Le panneau contient d'ailleurs plusieurs conversations au MEME
 * premier message (les runs precedents) : seul un marqueur unique les separe.
 */


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

console.log('[reset]', await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.className.includes('conv-new-row'))
  if (!b) return 'BOUTON NOUVEAU INTROUVABLE'
  b.click()
  return 'ok'
})()`))
await jusqua('fil vide', `document.querySelectorAll('.msg').length === 0`, 20000)

const avant = await ev(bullesAgent)
const QUESTION =
  `Dans la conversation ${CONV} j'ai joint une image. Quelle est la couleur de la 3e bande EN ` +
  `PARTANT DU BAS ? Ouvre ce qu'il faut pour la VOIR, ne devine pas. Termine par une ligne ` +
  `'COULEUR: <nom>'. Si l'image ne t'est pas atteignable, ecris exactement AUCUNE IMAGE.`
await ev(taper(QUESTION))
await jusqua('composer pret', auRepos, 60000)
await ev(envoyer)
await attendreFinDeTour('question inter-conversation', avant)
const reponse = await ev(dernierTexteAgent)
console.log('\n=== REPONSE ===\n' + reponse + '\n')
await shot('omniscience-reponse.png')

const SYNONYMES = {
  magenta: ['magenta', 'rose', 'fuchsia'],
  cyan: ['cyan', 'bleu ciel', 'azur', 'turquoise'],
  vert: ['vert', 'lime', 'chartreuse', 'citron'],
  orange: ['orange']
}
const n = reponse.toLowerCase()
const ligne = (n.split('couleur:').at(-1) ?? n).slice(0, 120)
const attendus = SYNONYMES[ATTENDU]
if (!attendus) throw new Error('couleur attendue inconnue : ' + ATTENDU)
const juste = attendus.some((mot) => ligne.includes(mot))
// Un piege explicite : nommer une AUTRE bande, c'est avoir compte a l'envers ou devine.
const autres = Object.entries(SYNONYMES)
  .filter(([cle]) => cle !== ATTENDU)
  .filter(([, mots]) => mots.some((mot) => ligne.includes(mot)))
  .map(([cle]) => cle)
const verdict = { attendu: ATTENDU, ligne: ligne.trim(), juste, autresCouleursCitees: autres, avoue: n.includes('aucune image') }
console.log('=== VERDICT ===')
console.log(JSON.stringify(verdict, null, 2))
writeFileSync(OUT + '/verdict-omniscience.json', JSON.stringify({ verdict, reponse }, null, 2))
if (verdict.avoue) {
  console.log('ECHEC : la connaissance ne traverse pas — image inatteignable depuis une autre conversation.')
  process.exit(2)
}
if (!juste || autres.length > 0) {
  console.log('ECHEC : mauvaise bande — vue de travers ou devinee.')
  process.exit(3)
}
console.log('SUCCES : image d une AUTRE conversation vue et comptee dans le bon sens.')
process.exit(0)
