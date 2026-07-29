import { mkdirSync, writeFileSync } from 'node:fs'

const port = process.env.AUTOWIN_CDP_PORT || '9223'
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
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

await evaluate(`(() => {
  const settings = document.querySelector('[data-testid="nav-settings"]')
  if (!settings) throw new Error('Navigation Settings introuvable')
  settings.click()
})()`)
await wait(400)
await evaluate(`(() => {
  const capabilities = [...document.querySelectorAll('[data-testid="settings-view"] .domain-tabs button')]
    .find((button) => /Skills.*Hooks.*Tools/i.test(button.textContent || ''))
  if (!capabilities) throw new Error('Section Skills · Hooks · Tools introuvable')
  capabilities.click()
})()`)
await wait(400)
await evaluate(`(() => {
  const hooks = [...document.querySelectorAll('.capability-cockpit .cockpit-tabs [role="tab"]')]
    .find((button) => /^Hooks(?:\\s|·|$)/i.test((button.textContent || '').trim()))
  if (!hooks) throw new Error('Onglet Hooks introuvable')
  hooks.click()
})()`)
await wait(400)
await evaluate(`(() => {
  const codex = [...document.querySelectorAll('.capability-cockpit .cockpit-sources button')]
    .find((button) => /^Codex$/i.test(button.querySelector('b')?.textContent?.trim() || ''))
  if (!codex) throw new Error('Source Hooks Codex introuvable')
  codex.click()
})()`)
await wait(700)

const state = await evaluate(`({
  selectedTab: document.querySelector('.capability-cockpit .cockpit-tabs [aria-selected="true"]')?.textContent?.trim(),
  selectedSource: document.querySelector('.capability-cockpit .cockpit-sources button.is-active b')?.textContent?.trim(),
  hookCount: document.querySelectorAll('.capability-cockpit .control-list .control-row').length,
  text: document.querySelector('.capability-cockpit')?.innerText
})`)
if (!state.selectedTab?.startsWith('Hooks') || state.selectedSource !== 'Codex') {
  throw new Error(`État Hooks inattendu: ${JSON.stringify(state)}`)
}

const screenshot = await send('Page.captureScreenshot', { format: 'png' })
mkdirSync('C:/Amitel/Autowin OS/artifacts', { recursive: true })
const output = process.env.AUTOWIN_HOOKS_SCREENSHOT || 'C:/Amitel/Autowin OS/artifacts/hooks-codex.png'
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
console.log(JSON.stringify({ state, output }, null, 2))
socket.close()
