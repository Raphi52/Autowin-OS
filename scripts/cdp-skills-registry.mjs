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
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

await evaluate(`(() => {
  const target = [...document.querySelectorAll('button')].find((button) =>
    /^skills$/i.test((button.textContent || '').trim()))
  if (!target) throw new Error('Navigation Skills introuvable')
  target.click()
})()`)
await wait(1500)

const labels = await evaluate(`[...document.querySelectorAll('.control-source-filter button')]
  .map((button) => button.textContent?.trim()).filter(Boolean)`)
const counts = {}
for (const label of labels) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.control-source-filter button')].find((item) =>
      item.textContent?.trim() === ${JSON.stringify(label)})
    if (!button) throw new Error('Filtre introuvable: ' + ${JSON.stringify(label)})
    button.click()
  })()`)
  await wait(100)
  counts[label] = await evaluate(`document.querySelector('.control-source-filter')
    ?.closest('.hermes-controls')?.querySelectorAll('.control-row').length ?? 0`)
}
const expectedSource = process.env.AUTOWIN_EXPECT_SKILL_SOURCE
await evaluate(`(() => {
  const expected = ${JSON.stringify(process.env.AUTOWIN_EXPECT_SKILL_SOURCE || '')}
  const button = expected
    ? [...document.querySelectorAll('.control-source-filter button')].find((item) => item.textContent?.trim() === expected)
    : document.querySelector('.control-source-filter button')
  button?.click()
})()`)
await wait(150)
const screenshot = await send('Page.captureScreenshot', { format: 'png' })
mkdirSync('C:/Amitel/Autowin OS/artifacts', { recursive: true })
const output = process.env.AUTOWIN_SKILLS_SCREENSHOT || 'C:/Amitel/Autowin OS/artifacts/skills-multisource-green.png'
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
console.log(JSON.stringify({ counts, output }, null, 2))
socket.close()
if (!counts.Codex || !counts.Claude || !counts['Hermes local'] || !counts['Hermes intégré']) {
  process.exitCode = 1
}
if (expectedSource && counts[expectedSource] !== 1) process.exitCode = 1
