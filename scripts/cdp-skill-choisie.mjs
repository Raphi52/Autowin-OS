/**
 * PREUVE E2E (conv-1034, 2026-10-21) : le modèle du chat charge-t-il DE LUI-MÊME une skill dont la
 * demande correspond au déclencheur, sans que l'utilisateur la nomme ?
 *
 * Discriminant : la demande décrit le MOMENT de la skill `residus` (code mort, fichiers inutiles)
 * sans jamais écrire son nom. Seul l'appel à `skill_charger` (action « Skill chargée » dans le fil)
 * prouve le choix ; une réponse qui « parle de résidus » ne prouve rien.
 *
 * Usage : node scripts/avec-instance-headless.mjs --code-dev -- node scripts/cdp-skill-choisie.mjs
 *          [--demande=<texte>] [--capture-jointe] [--sortie=<dossier>]
 * `--capture-jointe` : capture l'écran d'accueil de l'instance et la JOINT au message (cas « regarde
 * cette capture et dis-moi ce qui cloche », skill `look`). `--sortie` reçoit cette capture et celle
 * du fil après le tour.
 * Sortie 0 = « Skill chargée » visible dans le fil ; 1 = absent.
 */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { urlCiblesCdp } from './cdp-port.mjs'

const option = (nom) =>
  process.argv.find((a) => a.startsWith(`--${nom}=`))?.slice(`--${nom}=`.length)
const DEMANDE =
  option('demande') ??
  "Est-ce qu'il reste du code mort ou des fichiers inutiles autour de src/shared/skill-aliases.ts ? " +
    'Réponds en 6 lignes maximum, sans rien modifier.'
const CAPTURE_JOINTE = process.argv.includes('--capture-jointe')
const SORTIE = resolve(option('sortie') ?? '.')

const list = await (await fetch(urlCiblesCdp())).json()
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
const tick = (ms) => new Promise((r) => setTimeout(r, ms))
const jusqua = async (label, predicat, capMs = 240000) => {
  const debut = Date.now()
  for (;;) {
    if (await ev(predicat)) return true
    if (Date.now() - debut > capMs) throw new Error(`TIMEOUT ${label} (${capMs} ms)`)
    await tick(1500)
  }
}

// Même témoin d'occupation que cdp-image-tour-precedent.mjs : le bouton Stop n'existe que pendant un tour.
// Le bouton d'arrêt porte aria-label « Arrêter la réponse » / « Arrêter ce tour » (ChatView.tsx) ;
// son texte n'est plus « ■ Stop » (mesuré le 2026-10-21 : l'ancien témoin ne voyait jamais le tour).
const occupe = `[...document.querySelectorAll('button')].some(b => /^Arrêter/u.test(b.getAttribute('aria-label') ?? '') || /■ Stop|Arrêt…/u.test(b.textContent))`
const compterAssistant = `[...document.querySelectorAll('.msg')].filter(m => m.className.includes('assistant')).length`

await jusqua('chat au repos', `!(${occupe})`, 600000)
const capturer = async (fichier) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const chemin = join(SORTIE, fichier)
  writeFileSync(chemin, Buffer.from(r.data, 'base64'))
  console.log('[capture]', chemin)
  return chemin
}
// La capture à joindre est prise AVANT de passer sur le chat : c'est l'écran d'accueil de l'instance.
const captureAJoindre = CAPTURE_JOINTE ? await capturer('capture-jointe.png') : undefined
/*
 * Une instance neuve (profil vide) ne s'ouvre pas forcément sur le chat : on attend la ligne
 * « Nouveau fil », et sinon on laisse une capture et les libellés visibles pour savoir où elle est.
 */
// Mesuré le 2026-10-21 : l'instance neuve s'ouvre sur « Accueil » — on passe sur l'onglet Chat.
console.log(
  '[onglet Chat]',
  await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /^\\W*Chat$/u.test(x.textContent.trim()))
  if (!b) return 'ONGLET CHAT INTROUVABLE'
  b.click()
  return 'ok'
})()`)
)
try {
  await jusqua('ligne « Nouveau fil »', `!!document.querySelector('.conv-new-row')`, 90000)
} catch (e) {
  await capturer('sonde-skill-ecran.png')
  console.log(
    '[écran]',
    await ev(
      `[...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean).slice(0, 40).join(' | ')`
    )
  )
  throw e
}
console.log(
  '[nouveau fil]',
  await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.className.includes('conv-new-row'))
  if (!b) return 'BOUTON NOUVEAU INTROUVABLE'
  b.click()
  return 'ok'
})()`)
)
await jusqua('fil vide', `document.querySelectorAll('.msg').length === 0`, 20000)
if (captureAJoindre) {
  // Même chemin que cdp-image-tour-precedent.mjs : le fichier entre par l'input caché du composer.
  await send('DOM.enable')
  const { root } = await send('DOM.getDocument')
  const { nodeId } = await send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.attachment-input'
  })
  if (!nodeId) throw new Error("input de pièce jointe introuvable ('.attachment-input')")
  await send('DOM.setFileInputFiles', { nodeId, files: [captureAJoindre] })
  await jusqua(
    'vignette de pièce jointe',
    `document.querySelectorAll('.attachment-list.pending .attachment-chip').length > 0`,
    15000
  )
  console.log('[pièce jointe] capture posée dans le composer')
}
const avant = await ev(compterAssistant)
console.log(
  '[saisie]',
  await ev(`(() => {
  const ta = document.querySelector('.composer textarea')
  if (!ta) return 'PAS DE TEXTAREA'
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  set.call(ta, ${JSON.stringify(DEMANDE)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`)
)
console.log(
  '[envoi]',
  await ev(`(() => {
  document.querySelector('.composer textarea')
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  return 'ok'
})()`)
)
await jusqua('début du tour', occupe, 60000)
await jusqua(
  'fin du tour',
  `(() => {
  if (${occupe}) return false
  const bulles = [...document.querySelectorAll('.msg')].filter(m => m.className.includes('assistant'))
  if (bulles.length <= ${avant}) return false
  const t = (bulles.at(-1)?.innerText ?? '').trim()
  return t.length > 8 && !/^Raisonnement\\s+\\d+\\s*s$|reflexion|réflexion|REMIS EN FILE|ORIENTÉ/iu.test(t)
})()`,
  600000
)
const fil = await ev(
  `document.querySelector('.msg')?.closest('main, .chat, body')?.textContent ?? document.body.textContent`
)
const reponse = await ev(`(() => {
  const bulles = [...document.querySelectorAll('.msg')].filter(m => !m.className.includes('user'))
  return (bulles.at(-1)?.innerText ?? '').slice(0, 3000)
})()`)
console.log('\n=== RÉPONSE ===\n' + reponse + '\n')
await capturer('fil-apres-tour.png')
// Le critère est le LIBELLÉ que voit l'utilisateur, pas le nom de la commande : « skill_charger »
// brut dans le fil était justement le défaut (CMD_LABEL, ChatView.parts.tsx).
const charge = /Skills? chargées?/u.test(fil)
console.log(`[verdict] « Skill chargée » visible dans le fil : ${charge ? 'OUI' : 'NON'}`)
console.log(
  `[contrôle] nom brut « skill_charger » visible : ${/skill_charger/u.test(fil) ? 'OUI' : 'NON'}`
)
ws.close()
process.exit(charge ? 0 : 1)
