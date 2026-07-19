import { mkdirSync, writeFileSync } from 'node:fs'

const targets = await (await fetch('http://127.0.0.1:9223/json')).json()
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
  if (result.exceptionDetails) throw new Error('Évaluation DOM en échec')
  return result.result?.value
}

const longPath =
  'file:knowledge/domain/rigapplication-documentation/reference/20-host-plugins/' +
  'chargement-plugins-et-configuration-registre-sans-aucun-espace-dans-le-chemin.md'
await evaluate(`(() => {
  const chat = [...document.querySelectorAll('button')].find((button) =>
    /^chat$/i.test((button.textContent || '').trim()))
  chat?.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 500))
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
await new Promise((resolve) => setTimeout(resolve, 300))
const screenshot = await send('Page.captureScreenshot', { format: 'png' })
mkdirSync('C:/Amitel/Autowin OS/artifacts', { recursive: true })
const output = 'C:/Amitel/Autowin OS/artifacts/markdown-overflow-green.png'
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
console.log(JSON.stringify({ metrics, output }, null, 2))
socket.close()
if (!metrics.fits) process.exitCode = 1
