// Preuve visuelle du bloc `frame` (feature binding multi-modèles) dans la vue Models.
// Prérequis : app lancée avec --remote-debugging-port=9223. Navigue vers Models, inspecte le
// DOM du bloc frame + les marqueurs, capture un PNG.
import { writeFileSync } from 'node:fs'

const targets = await (await fetch('http://127.0.0.1:9223/json')).json()
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
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (res.exceptionDetails) throw new Error(`DOM eval: ${res.exceptionDetails.text ?? 'échec'}`)
  return res.result?.value
}

// Navigue vers la vue Models/Agents.
await evaluate(`(() => {
  const t = [...document.querySelectorAll('button')].find((b) => /models|agents/i.test(b.textContent || ''))
  if (!t) throw new Error('Navigation Models introuvable')
  t.click()
})()`)
await new Promise((r) => setTimeout(r, 1500))

// Inspecte le bloc frame + tous les blocs panel + la note runtime.
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

const screenshot = await send('Page.captureScreenshot', { format: 'png' })
const output = 'C:/Amitel/Autowin OS/artifacts/frame-block-proof.png'
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
console.log(JSON.stringify({ ...dom, output }, null, 2))
socket.close()
