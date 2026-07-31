// Preuve visuelle des quatre panels composés dans Agent Studio.
// Prérequis : app lancée avec --remote-debugging-port=9223. Navigue vers Agent Studio, inspecte le
// DOM des panels composés + les marqueurs, capture un PNG.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { withDeviceMetricsOverride } from './cdp-device-metrics.mjs'
import { assertFrameBlockProof, assertTerrainPanelProof } from './cdp-proof-validation.mjs'

const port = process.env.AUTOWIN_CDP_PORT || '9223'
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
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (res.exceptionDetails) throw new Error(`DOM eval: ${res.exceptionDetails.text ?? 'échec'}`)
  return res.result?.value
}

let proof
await withDeviceMetricsOverride(
  send,
  { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
  async () => {
    // Une instance de preuve utilise un profil neuf : fermer le wizard de session pour qu'il ne
    // masque pas la grille que la capture doit attester.
    await evaluate(`(() => {
      document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()
    })()`)

    // Le libellé visible est « Agent Studio » (sans s à Agent) : le test-id reste l'ancre stable.
    await evaluate(`(() => {
      const t = document.querySelector('[data-testid="nav-agent-studio"]')
      if (!t) throw new Error('Navigation Agent Studio introuvable')
      t.click()
    })()`)
    await new Promise((r) => setTimeout(r, 1500))

    // Inspecte les quatre panels + la note runtime.
    const dom = await evaluate(`(() => {
      const panels = [...document.querySelectorAll('.topology-panel')].map((p) => ({
        target: p.getAttribute('data-target'),
        title: p.querySelector('h3')?.textContent?.trim(),
        slots: p.querySelectorAll('.topology-slot').length
      }))
      const frame = panels.find((p) => p.target === 'frame') || null
      const frameEl = document.querySelector('.topology-panel[data-target="frame"]')
      const frameBorder = frameEl ? getComputedStyle(frameEl).borderTopColor : null
      const note = document.querySelector('.topology-runtime-limit span')?.textContent?.trim() || null
      const authorityNote = document.querySelector('.topology-authority-note')?.textContent?.trim() || null
      return { panels, frame, frameBorder, note, authorityNote }
    })()`)
    assertFrameBlockProof(dom)
    assertTerrainPanelProof(dom)

    const screenshot = await send('Page.captureScreenshot', { format: 'png' })
    const output = resolve(
      process.env.AUTOWIN_CDP_PROOF_OUTPUT || 'artifacts/terrain-topology-proof.png'
    )
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
    proof = { ...dom, output }
  }
)
console.log(JSON.stringify(proof, null, 2))
socket.close()
