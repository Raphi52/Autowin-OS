import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const port = Number(arg('--port', '9294'))
const outputDir = arg(
  '--out-dir',
  'C:/Amitel/Autowin OS/Audit/workspaces/codex-current/theme-node-sidebar-workspace/evidence'
)
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
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data)
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
const waitFor = async (expression, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await evaluate(expression)
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Condition non satisfaite: ${expression}`)
}
const screenshot = async (name) => {
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const path = join(outputDir, `${name}.png`)
  writeFileSync(path, Buffer.from(image.data, 'base64'))
  return path
}

await evaluate(`(() => {
  const target = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Memory'))
  target?.click()
  return Boolean(target)
})()`)
await waitFor(`document.querySelectorAll('.theme-filter[data-theme-id]').length > 0`)
await waitFor(
  `[...document.querySelectorAll('.theme-filter[data-theme-id]')]
  .some((button) => Number(button.querySelector('small')?.textContent ?? 0) > 0)`,
  15000
)
const selectedThemeId = await evaluate(`(() => {
  const target = [...document.querySelectorAll('.theme-filter[data-theme-id]')]
    .sort((left, right) => Number(right.querySelector('small')?.textContent ?? 0) - Number(left.querySelector('small')?.textContent ?? 0))[0]
  target?.click()
  return target?.dataset.themeId ?? null
})()`)
if (!selectedThemeId) throw new Error('Aucun thème non vide disponible')
await waitFor(
  `document.querySelector('.theme-filter.is-active[data-theme-id]')?.dataset.themeId === ${JSON.stringify(selectedThemeId)}`
)
await waitFor(
  `document.querySelectorAll('.theme-nodes-panel .node-links button').length > 0`,
  15000
)

const themeState = await evaluate(`(() => {
  const labels = [...document.querySelectorAll('.theme-nodes-panel .node-links button strong')]
    .map((item) => item.textContent?.trim()).filter(Boolean)
  return {
    labels,
    count: Number(document.querySelector('.theme-nodes-panel__heading strong')?.textContent ?? -1),
    nodePanelVisible: Boolean(document.querySelector('.node-panel'))
  }
})()`)
const themeScreenshot = await screenshot('01-theme-node-list')

await evaluate(`document.querySelector('.theme-nodes-panel .node-links button')?.click()`)
await waitFor(`Boolean(document.querySelector('.node-panel'))`)
const nodeState = await evaluate(`({
  themePanelVisible: Boolean(document.querySelector('.theme-nodes-panel')),
  nodePanelVisible: Boolean(document.querySelector('.node-panel')),
  selectedName: document.querySelector('.node-content h2')?.textContent?.trim() ?? null
})`)
const nodeScreenshot = await screenshot('02-node-detail')

const nextThemeId = await evaluate(`(() => {
  const target = [...document.querySelectorAll('.theme-filter[data-theme-id]:not(.is-active)')]
    .find((button) => Number(button.querySelector('small')?.textContent ?? 0) > 0)
  target?.click()
  return target?.dataset.themeId ?? null
})()`)
if (!nextThemeId) throw new Error('Aucun second thème non vide disponible')
await waitFor(`Boolean(document.querySelector('.theme-nodes-panel'))`)
const themeAfterDetailState = await evaluate(`({
  themePanelVisible: Boolean(document.querySelector('.theme-nodes-panel')),
  nodePanelVisible: Boolean(document.querySelector('.node-panel')),
  activeThemeIds: [...document.querySelectorAll('.theme-filter.is-active[data-theme-id]')]
    .map((item) => item.dataset.themeId)
})`)
const themeAfterDetailScreenshot = await screenshot('03-theme-after-node-detail')

const sorted = [...themeState.labels].sort((left, right) =>
  left.localeCompare(right, 'fr', { sensitivity: 'base' })
)
const failures = []
if (themeState.labels.length === 0 || themeState.count !== themeState.labels.length)
  failures.push('liste thématique vide ou compteur incohérent')
if (JSON.stringify(themeState.labels) !== JSON.stringify(sorted))
  failures.push('ordre non alphabétique')
if (themeState.nodePanelVisible) failures.push('détail visible avant sélection')
if (nodeState.themePanelVisible || !nodeState.nodePanelVisible || !nodeState.selectedName)
  failures.push('la sélection ne remplace pas la liste par le détail')
if (
  !themeAfterDetailState.themePanelVisible ||
  themeAfterDetailState.nodePanelVisible ||
  !themeAfterDetailState.activeThemeIds.includes(nextThemeId)
)
  failures.push('un thème sélectionné depuis le détail ne remplace pas le détail par la liste')

const result = {
  themeState,
  nodeState,
  themeAfterDetailState,
  screenshots: [themeScreenshot, nodeScreenshot, themeAfterDetailScreenshot],
  failures
}
writeFileSync(join(outputDir, 'result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
socket.close()
if (failures.length > 0) process.exit(1)
