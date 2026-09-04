/**
 * BANC DE MESURE DU LAG DE LA VUE KNOWLEDGE — la baseline que `heal` exige avant tout correctif.
 *
 * Pourquoi ce banc et pas les instruments en place : `gels.jsonl` ne parle qu'a partir d'UN bloc de
 * 1 000 ms, et la mesure par vue (`VueMesuree`) ne voit que les rendus React. Or le lag de cette vue
 * est fait de callbacks d'animation courts rejoues 60 fois par seconde : les deux instruments sont
 * aveugles par construction, et la vue n'apparait donc JAMAIS dans le journal (0 ligne sur 972,
 * mesure du 2026-09-04).
 *
 * Ce banc mesure ce qui compte pour l'utilisateur : le NOMBRE D'IMAGES par seconde, au repos puis
 * pendant un survol simule du nuage de noeuds. Lecture seule : il n'ecrit rien dans l'application.
 */
const port = process.env.AUTOWIN_CDP_PORT || '9224'
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) throw new Error('Fenêtre Autowin introuvable via CDP')
const socket = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
socket.onmessage = ({ data }) => {
  const m = JSON.parse(data)
  const cb = pending.get(m.id)
  if (!cb) return
  pending.delete(m.id)
  m.error ? cb.reject(new Error(m.error.message)) : cb.resolve(m.result)
}
await new Promise((r) => (socket.onopen = r))
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description ?? 'évaluation en échec')
  return r.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const contexte = await evaluate(`(() => {
  const canvas = document.querySelector('[data-testid="knowledge-view"] canvas')
  if (!canvas) return { pret: false }
  const r = canvas.getBoundingClientRect()
  return {
    pret: true,
    etiquettesThemes: document.querySelectorAll('.theme-cluster-label').length,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height }
  }
})()`)
if (!contexte?.pret) throw new Error('Vue Knowledge non affichée : ouvre-la avant de mesurer')

/** Compte les images sur une fenetre donnee — la mesure que l'utilisateur RESSENT. */
const compterImages = async (ms) => {
  const promesse = evaluate(`new Promise((resolve) => {
    let images = 0
    let pire = 0
    let precedent = performance.now()
    const debut = precedent
    const tick = (t) => {
      const ecart = t - precedent
      precedent = t
      if (images > 0 && ecart > pire) pire = ecart
      images += 1
      if (t - debut < ${ms}) requestAnimationFrame(tick)
      else resolve({ images, secondes: (t - debut) / 1000, pireEcartMs: Math.round(pire) })
    }
    requestAnimationFrame(tick)
  })`)
  return promesse
}

const repos = await compterImages(3000)

// Survol : on balaye le nuage de noeuds au CENTRE du canvas, la ou les points sont denses.
const { rect } = contexte
const mesureSurvol = compterImages(3000)
const debut = Date.now()
while (Date.now() - debut < 2900) {
  const t = (Date.now() - debut) / 2900
  const x = rect.x + rect.w * (0.42 + 0.16 * Math.sin(t * 12))
  const y = rect.y + rect.h * (0.5 + 0.14 * Math.cos(t * 15))
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await wait(16)
}
const survol = await mesureSurvol

const fps = (m) => Math.round((m.images / m.secondes) * 10) / 10
console.log(
  JSON.stringify(
    {
      etiquettesThemesSuiviesChaqueImage: contexte.etiquettesThemes,
      repos: { fps: fps(repos), pireEcartMs: repos.pireEcartMs },
      pendantSurvol: { fps: fps(survol), pireEcartMs: survol.pireEcartMs }
    },
    null,
    2
  )
)
socket.close()
