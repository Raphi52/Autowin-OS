import { mkdirSync, writeFileSync } from 'node:fs'

const port = process.env.AUTOWIN_CDP_PORT || '9226'
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error('Fenetre Autowin introuvable via CDP')
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Evaluation DOM en echec')
  return result.result?.value
}
if (process.env.AUTOWIN_LOOP_SEEDED === '1') {
  await evaluate(`(() => {
    localStorage.setItem('autowin-os.skill-loop.v1', JSON.stringify({
      passes: 1, stopOnFailure: true, carryOutput: true,
      steps: [
        { id: 'understand', skill: 'autowin:frame', capabilities: ['autowin:graphify'], prompt: 'Cartographier les injections et produire des critères mesurables.' },
        { id: 'implement', skill: 'autowin:build', capabilities: ['autowin:see'], prompt: 'Retirer les injections redondantes et vérifier le comportement observé.' },
        { id: 'cleanup', skill: 'autowin:clean', capabilities: [], prompt: 'Retirer les résidus attribuables et rejouer les preuves.' },
        { id: 'audit', skill: 'autowin:judge', capabilities: [], prompt: 'Auditer la fidélité et l’effet réel du livrable.' }
      ]
    }))
    location.reload()
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 1500))
}
await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) =>
    (item.textContent || '').trim() === 'Loop Builder')
  if (!button) throw new Error('Navigation Loop Builder introuvable')
  button.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 1200))
if (process.env.AUTOWIN_LOOP_SEEDED === '1') {
  await evaluate(`(() => {
    const first = document.querySelector('.semantic-card')
    first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }))
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const moved = await evaluate(`document.querySelector('.semantic-card select')?.value === 'autowin:build'`)
  await evaluate(`(() => {
    const second = document.querySelectorAll('.semantic-card')[1]
    second?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))
    window.__loopKeyboardReordered = ${moved ? 'true' : 'false'}
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 100))
}
const summary = await evaluate(`({
  title: document.querySelector('.semantic-loop h1')?.textContent,
  columns: document.querySelectorAll('.semantic-columns > *').length,
  capabilities: document.querySelectorAll('.capability-list button').length,
  hasPromptPanel: Boolean(document.querySelector('.live-output')),
  oldSettings: document.querySelectorAll('.loop-settings, input[type="checkbox"]').length
  ,cards: document.querySelectorAll('.semantic-card').length
  ,attachedCapabilities: document.querySelectorAll('.attached-capabilities button').length
  ,qualityGates: [...document.querySelectorAll('.semantic-card small')].filter((node) => node.textContent?.includes('VALIDATION')).length
  ,promptLength: document.querySelector('.live-prompt')?.textContent?.length ?? 0
  ,keyboardReordered: window.__loopKeyboardReordered === true
  ,semanticOrderRestored: document.querySelector('.semantic-card select')?.value === 'autowin:frame'
})`)
const screenshot = await send('Page.captureScreenshot', { format: 'png' })
mkdirSync('C:/Amitel/Autowin OS/artifacts', { recursive: true })
const output = 'C:/Amitel/Autowin OS/artifacts/loop-builder-semantic-rail.png'
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
console.log(JSON.stringify({ ...summary, output }, null, 2))
socket.close()
if (summary.title !== 'Loop Builder' || summary.columns !== 3 || !summary.hasPromptPanel || summary.oldSettings !== 0) process.exitCode = 1
if (process.env.AUTOWIN_LOOP_SEEDED === '1' && (summary.cards !== 4 || summary.attachedCapabilities !== 2 || summary.qualityGates !== 2 || summary.promptLength < 200 || !summary.keyboardReordered || !summary.semanticOrderRestored)) process.exitCode = 1
