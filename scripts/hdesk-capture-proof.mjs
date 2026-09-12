/**
 * Juge la capture d'une instance Autowin lancée dans un BUREAU WINDOWS ISOLÉ.
 * Compare les DEUX chemins de Page.captureScreenshot :
 *   - fromSurface: true  -> passe par la SURFACE de la fenêtre (compositeur d'écran)
 *   - fromSurface: false -> passe par la VUE du renderer
 * Dans un bureau non affiché il n'y a aucun compositeur : c'est cette comparaison qui dit
 * lequel des deux chemins reste utilisable, et donc si le chantier « bureau isolé » tient.
 *
 * Usage : node scripts/hdesk-capture-proof.mjs <port>
 */
import { writeFileSync } from 'node:fs'

const port = Number(process.argv[2] ?? 9251)
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((p) => p.type === 'page') ?? pages[0]
if (!page) throw new Error(`Aucune page CDP sur le port ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', () => reject(new Error('connexion CDP impossible')), { once: true })
})

let prochainId = 1
const attentes = new Map()
socket.addEventListener('message', (evt) => {
  const message = JSON.parse(evt.data)
  const attente = attentes.get(message.id)
  if (!attente) return
  attentes.delete(message.id)
  if (message.error) attente.reject(new Error(message.error.message))
  else attente.resolve(message.result)
})
const envoyer = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = prochainId++
    attentes.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
    // Le symptôme redouté n'est pas seulement une image VIDE : c'est aussi une capture qui ne
    // répond JAMAIS (electron#35953). Sans ce délai, la preuve pendrait au lieu de conclure.
    setTimeout(() => {
      if (attentes.delete(id)) reject(new Error(`${method} n'a jamais répondu (15 s)`))
    }, 15_000)
  })

/** Une capture n'est une preuve que si elle porte des pixels VARIÉS : un aplat est un échec. */
function juger(base64) {
  const octets = Buffer.from(base64, 'base64')
  return { octets: octets.length, distinct: new Set(octets.subarray(0, 65_536)).size }
}

const resultats = {}
for (const fromSurface of [false, true]) {
  const cle = `fromSurface_${fromSurface}`
  try {
    const shot = await envoyer('Page.captureScreenshot', { format: 'png', fromSurface })
    const verdict = juger(shot.data)
    resultats[cle] = { ok: verdict.octets > 1000 && verdict.distinct > 8, ...verdict }
    writeFileSync(`Audit/hdesk-proof/capture-${cle}.png`, Buffer.from(shot.data, 'base64'))
  } catch (erreur) {
    resultats[cle] = { ok: false, erreur: erreur.message }
  }
}
socket.close()
console.log(JSON.stringify(resultats, null, 2))
process.exit(resultats.fromSurface_false.ok ? 0 : 1)
