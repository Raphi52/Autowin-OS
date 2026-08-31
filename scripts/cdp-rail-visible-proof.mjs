/**
 * Preuve hors-modele des DEUX regressions de fond du 2026-08-31 : « je ne vois plus le menu de
 * gauche » sur l'Accueil, et « j'ai perdu mon ancien fond d'ecran 2d sur les vues ».
 *
 * Pourquoi pas un test unitaire : happy-dom ne calcule AUCUN ordre de peinture — un test de rendu
 * passait au vert pendant que l'utilisateur ne voyait plus son menu. Et pourquoi pas une capture
 * seule : elle montre une image, elle ne dit pas QUI la recouvre. On interroge donc l'INVARIANT
 * falsifiable, dans le vrai renderer : le z-index CALCULE du decor, et le fond que porte le body.
 *
 * LIMITE MESUREE, a ne pas se raconter autrement (sabotage du 2026-08-31) : elementFromPoint ne
 * detecte PAS ce recouvrement. Avec le decor remis a z-index 0, le menu redevenait invisible a
 * l'oeil, et la sonde repondait quand meme « le pixel du menu appartient au menu » -- parce que le
 * decor porte pointer-events:none, et que elementFromPoint fait du hit-testing : elle mesure ce qui
 * est CLIQUABLE, pas ce qui est VU. Elle est conservee (elle attraperait un fond qui volerait les
 * clics, l'autre panne possible), mais le controle qui MORD sur la regression signalee est celui du
 * z-index calcule, plus bas dans ce fichier.
 *
 *   node scripts/cdp-rail-visible-proof.mjs --port 9223
 */
const value = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const port = Number(value('--port', '9223'))

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((item) => item.type === 'page')
if (!page) throw new Error(`Aucune page CDP sur le port ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
let id = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const call = pending.get(message.id)
  if (call) {
    pending.delete(message.id)
    message.error ? call.reject(new Error(JSON.stringify(message.error))) : call.resolve(message.result)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const messageId = ++id
    pending.set(messageId, { resolve, reject })
    socket.send(JSON.stringify({ id: messageId, method, params }))
  })

const evaluate = async (expression) => {
  const { result } = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  return result.value
}

await send('Runtime.enable')

/*
 * ON VA D'ABORD SUR L'ACCUEIL, et ce n'est pas un detail de confort : le decor n'est monte QUE la
 * (App.tsx). Mesurer depuis une autre vue rend `decorMonte: false` et ne prouve RIEN du cas
 * signale — c'est exactement le faux vert que ce script doit refuser.
 */
const alleAccueil = await evaluate(`(() => {
  const cible = [...document.querySelectorAll('button, a, [role="tab"]')]
    .find((n) => /accueil/i.test(n.textContent || '') || /accueil/i.test(n.getAttribute('aria-label') || ''))
  if (!cible) return 'aucun bouton Accueil trouve'
  cible.click()
  return 'clic emis'
})()`)
console.log('navigation:', alleAccueil)
// Laisse React remonter la vue et le decor s'instancier.
await new Promise((r) => setTimeout(r, 1200)) // sleep-ok: attente de remontage React apres un clic reel, pas un polling

const mesure = await evaluate(`(() => {
  const rail = document.querySelector('.rail')
  if (!rail) return { erreur: 'aucun .rail dans le DOM' }
  const boite = rail.getBoundingClientRect()
  // Le CENTRE du rail : c'est le pixel que l'utilisateur regarde quand il cherche son menu.
  const x = Math.round(boite.left + boite.width / 2)
  const y = Math.round(boite.top + boite.height / 2)
  const dessus = document.elementFromPoint(x, y)
  const decor = document.querySelector('.decor-de-fond')
  return {
    onglet: document.querySelector('.nav-item.is-active, [aria-current="page"]')?.textContent?.trim() ?? '(inconnu)',
    railLargeur: Math.round(boite.width),
    // .rail lui-meme ou l'un de ses descendants = le menu est bien au-dessus.
    pixelDuMenuAppartientAuMenu: Boolean(dessus && rail.contains(dessus)),
    elementAuPixel: dessus ? (dessus.className || dessus.tagName) : null,
    decorMonte: Boolean(decor),
    decorZIndex: decor ? getComputedStyle(decor).zIndex : null,
    fondBody: getComputedStyle(document.body).backgroundImage.slice(0, 120)
  }
})()`)

console.log(JSON.stringify(mesure, null, 2))
socket.close()

const echecs = []
if (mesure.erreur) echecs.push(mesure.erreur)
if (!mesure.pixelDuMenuAppartientAuMenu)
  echecs.push(`le pixel du menu est occupe par « ${mesure.elementAuPixel} » — le menu est recouvert`)
if (!mesure.decorMonte)
  echecs.push('decor NON monte : la mesure ne prouve pas le cas de l Accueil (faux vert refuse)')
if (mesure.decorMonte && Number(mesure.decorZIndex) >= 0)
  echecs.push(`decor a z-index ${mesure.decorZIndex} : il repasserait devant le menu statique`)
if (!/autowin-galaxy-bg-hq/.test(mesure.fondBody))
  echecs.push('le body ne porte plus le fond 2D')

if (echecs.length) {
  console.error('\nECHEC :\n- ' + echecs.join('\n- '))
  process.exit(1)
}
console.log('\nOK — menu au-dessus du decor, et fond 2D present sur le body.')
