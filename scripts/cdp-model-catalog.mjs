import { assertModelCatalogProof } from './cdp-proof-validation.mjs'
import { cheminArtefact, ecrireSousDepot } from './racine-depot.mjs'
import { attendreDansLaPage } from './cdp-attente.mjs'
import { urlCiblesCdp } from './cdp-port.mjs'

const targets = await (await fetch(urlCiblesCdp())).json()
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error('Fenêtre Autowin introuvable via CDP')

const socket = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data)
  const callback = pending.get(message.id)
  if (!callback) return
  pending.delete(message.id)
  message.error
    ? callback.reject(new Error(message.error.message))
    : callback.resolve(message.result)
}
await new Promise((resolve) => {
  socket.onopen = resolve
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.exceptionDetails) throw new Error('Évaluation DOM en échec')
  return result.result?.value
}

// Ouvrir Agent Studio par sa PASTILLE, pas par un texte de bouton.
//
// Mesure du 2026-09-06 : la sonde cherchait le premier bouton dont le texte matche
// /models|agents/i. Elle tombait sur un TITRE DE CONVERSATION de la barre laterale
// (« le fil de sous agents est encore dans grap… ») et ouvrait un fil de chat. Le catalogue
// n'etait donc jamais affiche, et la sonde accusait le produit d'un catalogue vide alors que
// `window.api.models()` rend bien 29 modeles. Un testid ne se laisse pas voler par du contenu.
await evaluate(`(() => {
  const nav = document.querySelector('[data-testid="nav-agent-studio"]')
  if (!nav) throw new Error('Navigation Agent Studio introuvable')
  nav.click()
})()`)
await attendreDansLaPage(
  evaluate,
  `Boolean(document.querySelector('[data-testid="agent-studio-view"]'))`
)
await evaluate(`(() => {
  const onglet = [...document.querySelectorAll('button')].find((button) =>
    /topolog/i.test(button.textContent || ''))
  if (!onglet) throw new Error('Onglet « Modèles & topologie » introuvable')
  onglet.click()
})()`)
// Le catalogue est charge de facon asynchrone (window.api.models) : on l'ATTEND.
await attendreDansLaPage(evaluate, `document.querySelectorAll('.topology-model').length > 0`)
const labels = await evaluate(`[
  ...document.querySelectorAll('.topology-model strong')
].map((element) => element.textContent?.trim()).filter(Boolean)`)
const spacing = await evaluate(`(() => {
  const library = document.querySelector('.topology-library')
  const card = document.querySelector('.topology-model')
  if (!library || !card) return null
  const libraryRect = library.getBoundingClientRect()
  const cardRect = card.getBoundingClientRect()
  return {
    libraryRight: libraryRect.right,
    cardRight: cardRect.right,
    rightGap: libraryRect.right - cardRect.right,
    paddingRight: getComputedStyle(library).paddingRight,
    scrollbarGutter: getComputedStyle(library).scrollbarGutter
  }
})()`)
assertModelCatalogProof({ labels })
const screenshot = await send('Page.captureScreenshot', { format: 'png' })
const output = cheminArtefact('model-catalog.png')
ecrireSousDepot(output, Buffer.from(screenshot.data, 'base64'))
console.log(JSON.stringify({ labels, spacing, output }, null, 2))
socket.close()
