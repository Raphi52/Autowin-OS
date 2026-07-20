import { writeFileSync } from 'node:fs'

const port = process.env.AUTOWIN_CDP_PORT || '9247'
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
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
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? 'Évaluation DOM en échec')
  return result.result?.value
}
if (process.argv.includes('--reload')) {
  await send('Page.reload', { ignoreCache: true })
  await new Promise((resolve) => setTimeout(resolve, 800))
}
await evaluate(`(() => {
  const target = [...document.querySelectorAll('button')].find((button) => /observatory|observatoire|harnais/i.test(button.textContent ?? ''))
  if (!target) throw new Error('Navigation Observatoire introuvable')
  target.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 800))
if (process.argv.includes('--unlock')) {
  const unlockState = await evaluate(`(() => {
    const target = [...document.querySelectorAll('button')].find((button) => /déverrouiller hermes/i.test(button.textContent ?? ''))
    if (target) { target.click(); return 'requested' }
    return document.querySelector('.observatory-hermes-diagnostics') ? 'already-available' : 'unavailable'
  })()`)
  if (unlockState === 'unavailable') throw new Error('Diagnostic Hermes global introuvable')
  console.log(`Hermes diagnostics: ${unlockState}`)
  socket.close()
  process.exit(0)
}
await evaluate(`(() => {
  const panel = document.querySelector('.observatory-hermes-diagnostics')
  if (panel) {
    panel.open = true
    const first = panel.querySelector('div > details')
    if (first) first.open = true
  }
  if (!document.querySelector('.observatory-rag-summary')) throw new Error('Résumé RAG introuvable')
})()`)
await new Promise((resolve) => setTimeout(resolve, 300))
const state = await evaluate(
  `({ text: document.body.innerText, hermesMetric: document.querySelector('[data-metric="hermes"]')?.innerText, proof: document.querySelector('.observatory-hermes-proof')?.innerText })`
)
const screenshot = await send('Page.captureScreenshot', { format: 'png' })
const output =
  process.env.AUTOWIN_RAG_SCREENSHOT ||
  'C:/Amitel/Autowin OS/artifacts/hermes-trace-observatory.png'
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
console.log(JSON.stringify({ state, output }, null, 2))
socket.close()
