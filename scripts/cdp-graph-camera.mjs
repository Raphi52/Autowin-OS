import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const port = Number(arg('--port', '9292'))
const outputDir = arg('--out-dir', 'C:/Amitel/Autowin OS/Audit/graph-camera')
mkdirSync(outputDir, { recursive: true })

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((item) => item.type === 'page')
if (!page) throw new Error(`Aucune page CDP sur ${port}`)
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
let id = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const call = pending.get(message.id)
  if (!call) return
  pending.delete(message.id)
  message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result)
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const callId = ++id
    pending.set(callId, { resolve, reject })
    socket.send(JSON.stringify({ id: callId, method, params }))
  })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  return result.result.value
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const click = async (selector) =>
  evaluate(`(() => {
  const target = document.querySelector(${JSON.stringify(selector)})
  target?.click()
  return Boolean(target)
})()`)
const snapshot = async (name) => {
  const state = await evaluate(`(() => ({
    distance: Number(document.querySelector('.graph-canvas')?.dataset.cameraDistance),
    activeTheme: document.querySelector('.theme-filter.is-active[data-theme-id]')?.dataset.themeId ?? null,
    activeTag: document.querySelector('.theme-cluster-label.is-active')?.dataset.themeId ?? null,
    visibleTags: [...document.querySelectorAll('.theme-cluster-label')].filter((item) => getComputedStyle(item).display !== 'none').length,
    settingsOpen: Boolean(document.querySelector('.graph-settings-popover')),
    graphWidth: Math.round(document.querySelector('.graph-canvas')?.getBoundingClientRect().width ?? 0)
  }))()`)
  if (name === '01-open-memory' || name === '10-black') {
    const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(join(outputDir, `${name}.png`), Buffer.from(image.data, 'base64'))
  }
  return { name, ...state }
}

const memoryOpened = await evaluate(`(() => {
  const target = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Memory'))
  target?.click()
  return Boolean(target)
})()`)
if (!memoryOpened) throw new Error('Navigation Memory introuvable')
await wait(4000)
const states = [await snapshot('01-open-memory')]
if (!Number.isFinite(states[0].distance))
  throw new Error('Télémétrie caméra absente après ouverture Memory')

await click('.theme-cluster-label:not(.is-active)')
await wait(500)
states.push(await snapshot('02-floating-tag'))
await click('.theme-cluster-label.is-active')
await wait(500)
states.push(await snapshot('03-floating-tag-off'))

await click('.theme-filter[data-theme-id]')
await wait(500)
states.push(await snapshot('04-sidebar-filter'))
await click('.theme-filter.is-active[data-theme-id]')
await wait(500)
states.push(await snapshot('05-sidebar-filter-off'))

await click('.graph-settings-button')
await wait(400)
states.push(await snapshot('06-settings-open'))
await click('.graph-settings-button')
await wait(400)
states.push(await snapshot('07-settings-closed'))

await evaluate(`(() => {
  const separator = document.querySelector('.column-resizer--theme')
  separator?.focus()
  separator?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
})()`)
await wait(500)
states.push(await snapshot('08-column-resized'))

await click('[aria-label="Modules violet bleu"]')
await wait(700)
states.push(await snapshot('09-galaxy'))
await click('[aria-label="Modules noirs"]')
await wait(700)
states.push(await snapshot('10-black'))

const baseline = states[0].distance
const failures = states.filter(
  (state) =>
    !Number.isFinite(state.distance) ||
    Math.abs(state.distance - baseline) > Math.max(1, baseline * 0.01)
)
const result = { port, baseline, states, failures: failures.map((state) => state.name) }
writeFileSync(join(outputDir, 'result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
socket.close()
if (!Number.isFinite(baseline) || failures.length > 0) process.exit(1)
