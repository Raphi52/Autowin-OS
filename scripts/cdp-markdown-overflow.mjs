import { attendreDansLaPage } from './cdp-attente.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cheminArtefact } from './racine-depot.mjs'
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
  const result = await send('Runtime.evaluate', { expression, returnByValue: true })
  /*
   * L'ERREUR DE LA PAGE, PAS UN LIBELLE GENERIQUE.
   *
   * « Évaluation DOM en échec » ne dit ni quoi, ni ou : mesure du 2026-09-06, il a fallu relire la
   * sonde ligne a ligne pour deviner laquelle des trois evaluations avait leve. La page nomme
   * pourtant sa cause (« Fil de chat introuvable »…) — on la relaie telle quelle, avec le debut de
   * l'expression fautive. Une sonde qui cache son motif coute un aller-retour a chaque rouge.
   */
  if (result.exceptionDetails) {
    const motif =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      'cause non renseignee'
    throw new Error(`Évaluation DOM en échec : ${motif}
--- expression ---
${expression.slice(0, 200)}`)
  }
  return result.result?.value
}

const longPath =
  'file:knowledge/domain/rigapplication-documentation/reference/20-host-plugins/' +
  'chargement-plugins-et-configuration-registre-sans-aucun-espace-dans-le-chemin.md'
/*
 * ON NAVIGUE PAR LA PASTILLE, PAS PAR LE LIBELLE.
 *
 * La sonde cherchait un bouton dont le texte vaut EXACTEMENT « chat ». L'entree de navigation
 * porte une icone : son texte est « 💬Chat », que ce motif ne reconnait pas. Mesure du 2026-09-06 :
 * ZERO bouton correspondant, le clic ne partait jamais, et la sonde echouait plus loin sur « Fil de
 * chat introuvable » — en laissant croire a un defaut du produit. Un identifiant de test ne depend
 * ni du libelle ni de l'icone.
 */
await evaluate(`document.querySelector('[data-testid="nav-chat"]')?.click()`)
// Le fil de chat est monte de facon asynchrone : on l'ATTEND au lieu de dormir 500 ms.
await attendreDansLaPage(evaluate, `Boolean(document.querySelector('.chat-scroll'))`)
const metrics = await evaluate(`(() => {
  const scroll = document.querySelector('.chat-scroll')
  if (!scroll) throw new Error('Fil de chat introuvable')
  const fixture = document.createElement('div')
  fixture.id = 'markdown-overflow-fixture'
  fixture.className = 'msg assistant fade-in'
  fixture.innerHTML = '<div class="msg-meta"><span class="msg-role">Test Markdown</span></div>' +
    '<div class="msg-turn"><div class="msg-body"><div class="md"><code>' +
    ${JSON.stringify(Array(8).fill(longPath).join(', '))} +
    '</code></div></div></div>'
  scroll.appendChild(fixture)
  fixture.scrollIntoView({ block: 'center' })
  const body = fixture.querySelector('.msg-body')
  return {
    bodyClientWidth: body.clientWidth,
    bodyScrollWidth: body.scrollWidth,
    fits: body.scrollWidth <= body.clientWidth
  }
})()`)
// La fixture doit etre PEINTE avant la capture : on attend qu'elle soit dans le document.
await attendreDansLaPage(
  evaluate,
  `Boolean(document.getElementById('markdown-overflow-fixture'))`,
  2000
)
const screenshot = await send('Page.captureScreenshot', { format: 'png' })
mkdirSync(cheminArtefact(), { recursive: true })
const output = cheminArtefact('markdown-overflow-green.png')
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
console.log(JSON.stringify({ metrics, output }, null, 2))
socket.close()
if (!metrics.fits) process.exitCode = 1
