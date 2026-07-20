import { writeFileSync } from 'node:fs'

const port = process.env.AUTOWIN_CDP_PORT || '9248'
const output =
  process.env.AUTOWIN_OBSERVATORY_SCREENSHOT ||
  'C:/Amitel/Autowin OS/artifacts/observatory-critical-path.png'
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((target) => target.type === 'page')
if (!page) throw new Error(`Fenêtre Autowin introuvable sur ${port}`)
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
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Connexion WebSocket CDP expirée')), 5000)
  socket.onopen = resolve
  socket.onerror = reject
  socket.addEventListener('open', () => clearTimeout(timeout), { once: true })
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP ${method} expiré`))
    }, 20000)
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? 'Erreur DOM')
  return result.result?.value
}

console.log('[cdp] connecté')
await send('Page.reload', { ignoreCache: true })
await new Promise((resolve) => setTimeout(resolve, 700))
await evaluate(`(async () => {
  const existing = (await window.api.conversations()).find((item) => item.title === 'Preuve chemin critique')
  const conversation = existing ?? await window.api.conversationsCreate({
    title: 'Preuve chemin critique', category: 'codex', provider: 'codex'
  })
  const traces = await window.api.causalTrace(conversation.id)
  if (traces.length < 2) {
    const result = await window.api.pilotChat([
      { role: 'user', content: '[[autowin-fixture-durable-stream]] observatory-critical-path' }
    ], conversation.id)
    if (!result.ok) throw new Error(result.error || 'Fixture pilot en échec')
  }
  return conversation.id
})()`)
console.log('[cdp] fixture créée')
await evaluate(`(() => {
  const target = [...document.querySelectorAll('button')].find((button) =>
    /observatory|observatoire/i.test(button.textContent ?? ''))
  if (!target) throw new Error('Navigation Observatory introuvable')
  target.click()
})()`)
console.log('[cdp] Observatory ouvert')
await new Promise((resolve) => setTimeout(resolve, 900))
await evaluate(`(() => {
  const target = [...document.querySelectorAll('button')].find((button) =>
    button.textContent?.trim() === 'Chemin critique')
  if (!target) throw new Error('Bascule Chemin critique introuvable')
  target.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 350))
await evaluate(`(() => {
  const first = document.querySelector('.observatory-causal-tree .observatory-causal-node-wrap > button')
  if (!first) throw new Error('Nœud causal cliquable introuvable')
  first.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 200))
await evaluate(`(() => {
  for (const element of document.querySelectorAll('*')) {
    if (element.scrollLeft) element.scrollLeft = 0
  }
  const stream = document.querySelector('.observatory-stream')
  if (stream) stream.scrollTop = 0
})()`)
await new Promise((resolve) => setTimeout(resolve, 1500))
const state = await evaluate(`(() => ({
  title: document.querySelector('.observatory-causal-path > header')?.textContent?.trim(),
  nodes: document.querySelectorAll('.observatory-causal-node-wrap > button').length,
  critical: document.querySelectorAll('.observatory-causal-node-wrap > button.is-critical').length,
  bottlenecks: document.querySelectorAll('.observatory-causal-node-wrap > button.is-bottleneck').length,
  detailVisible: Boolean(document.querySelector('.observatory-causal-detail')),
  errors: document.querySelector('.observatory-source-errors')?.textContent?.trim() ?? null
}))()`)
if (!state.title || state.nodes < 2 || state.critical < 1 || !state.detailVisible)
  throw new Error(`Preuve causale insuffisante: ${JSON.stringify(state)}`)
const screenshot = await evaluate('window.api.captureTestPage()')
writeFileSync(output, Buffer.from(screenshot, 'base64'))
console.log(JSON.stringify({ state, output }))
socket.close()
