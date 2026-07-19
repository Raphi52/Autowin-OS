import { writeFileSync } from 'node:fs'

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
  message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result)
}
await new Promise((resolve) => { socket.onopen = resolve })
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error('Évaluation DOM en échec')
  return result.result?.value
}

await evaluate(`(() => {
  const target = [...document.querySelectorAll('button.nav-item')].find((button) => button.textContent?.trim() === 'Hooks')
  if (!target) throw new Error('Navigation Hooks introuvable')
  target.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 1_500))
await evaluate(`(() => {
  const select = [...document.querySelectorAll('select')].find((element) =>
    [...element.options].some((option) => option.value === 'codex'))
  if (!select) throw new Error('Sélecteur Codex introuvable')
  select.value = 'codex'
  select.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await new Promise((resolve) => setTimeout(resolve, 1_500))
const state = await evaluate(`({
  selectors: [...document.querySelectorAll('select')].map((select) => ({ value: select.value, options: [...select.options].map((option) => option.textContent?.trim()) })),
  text: document.body.innerText
})`)
const screenshot = await send('Page.captureScreenshot', { format: 'png' })
const output = 'C:/Amitel/Autowin OS/artifacts/hooks-codex.png'
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
console.log(JSON.stringify({ state, output }, null, 2))
socket.close()
