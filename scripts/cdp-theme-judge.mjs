import { mkdirSync, writeFileSync } from 'node:fs'

const port = process.env.AUTOWIN_CDP_PORT || '9227'
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
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result
    ?.value
const capture = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png' })
  const output = `C:/Amitel/Autowin OS/artifacts/theme-judge-${name}.png`
  writeFileSync(output, Buffer.from(result.data, 'base64'))
  return output
}

mkdirSync('C:/Amitel/Autowin OS/artifacts', { recursive: true })
await send('Page.enable')
await send('Runtime.enable')
const views = [
  { label: 'Chat', id: 'chat' },
  { label: 'Observatory', id: 'observatory' },
  { label: 'Models', id: 'models' },
  { label: 'Skills · Hooks · Tools', id: 'skills-hooks-tools' },
  { label: 'Behaviour', id: 'behaviour' },
  { label: 'Memory', id: 'memory' }
]
const output = {}
for (const view of views) {
  const clicked = await evaluate(
    `(() => { const item = [...document.querySelectorAll('.nav-item')].find((candidate) => candidate.querySelector('span:last-child')?.textContent?.trim() === ${JSON.stringify(view.label)}); if (!item) return false; item.click(); return true })()`
  )
  if (!clicked) throw new Error(`Navigation introuvable : ${view.label}`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  output[`Dark:${view.label}`] = await capture(`dark-${view.id}`)
}
output.themeControl = await evaluate(
  `({shellClass:[...document.querySelector('.shell').classList].find((name)=>name.startsWith('theme-')), buttons:document.querySelectorAll('.app-theme-switch').length, memoryLocalControl:document.querySelectorAll('.theme-sidebar .view-mode-switch').length})`
)
console.log(JSON.stringify(output, null, 2))
socket.close()
