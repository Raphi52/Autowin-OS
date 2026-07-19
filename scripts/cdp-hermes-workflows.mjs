import { writeFileSync } from 'node:fs'

const targets = await (await fetch('http://127.0.0.1:9247/json')).json()
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Évaluation DOM en échec')
  return result.result?.value
}
await evaluate(`(() => [...document.querySelectorAll('button.nav-item')].find((node) => node.textContent?.trim() === 'Chat')?.click())()`)
await new Promise((resolve) => setTimeout(resolve, 800))
await evaluate(`(() => [...document.querySelectorAll('button')].find((node) => node.textContent?.trim().startsWith('hey'))?.click())()`)
await new Promise((resolve) => setTimeout(resolve, 300))
await evaluate(`(() => {
  const workflows = document.querySelector('button[title="Workflows (RUN.md)"]')
  if (workflows && !document.querySelector('.runs-pane')) workflows.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 500))
await evaluate(`(() => {
  const activity = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'Activité')
  if (!activity) throw new Error('Onglet Activité introuvable: ' + [...document.querySelectorAll('button')].map((node) => node.textContent?.trim()).join(' | '))
  activity.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 800))
await evaluate(`(() => {
  const trace = document.querySelector('.hermes-preflight')
  if (!trace) throw new Error('Bloc Hermes observé introuvable: ' + document.querySelector('.runs-pane')?.innerText)
  trace.open = true
  const first = trace.querySelector('.prompt-envelope')
  if (first) first.open = true
})()`)
await new Promise((resolve) => setTimeout(resolve, 300))
const state = await evaluate(`({ summary: document.querySelector('.hermes-preflight > summary')?.textContent, visible: Boolean(document.querySelector('.hermes-preflight .prompt-envelope[open]')), text: document.querySelector('.hermes-preflight')?.innerText })`)
const screenshot = await send('Page.captureScreenshot', { format: 'png' })
const output = 'C:/Amitel/Autowin OS/artifacts/hermes-trace-workflows.png'
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
console.log(JSON.stringify({ state, output }, null, 2))
socket.close()
