import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'

const port = process.env.AUTOWIN_CDP_PORT || '9223'
const sharedGraphPath =
  process.env.AMITEL_GRAPHIFY_PATH ||
  '\\\\ged2\\rig\\Projets IA\\Amitel Brain\\projects\\autowin-os\\graphify-out\\graph.json'
const sharedGraphResolvedPath = realpathSync(sharedGraphPath)
const sharedGraphSha256 = createHash('sha256').update(readFileSync(sharedGraphPath)).digest('hex')
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error(`Fenêtre Autowin introuvable via CDP sur ${port}`)

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
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
  return response.result?.value
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const sentinel = `amitel-graphify-e2e-${Date.now()}`
const prompt =
  `[[${sentinel}]] Explique en une phrase comment AgentPilot utilise Amitel Brain et Graphify. ` +
  `Réponds en commençant par CONNEXION_OK.`

await evaluate(`(() => {
  const chat = [...document.querySelectorAll('.nav-item')].find((item) =>
    item.querySelector('span:last-child')?.textContent?.trim() === 'Chat')
  chat?.click()
  return Boolean(chat)
})()`)
await sleep(250)

const assistantCountBefore = await evaluate(
  `document.querySelectorAll('.msg.assistant .msg-body').length`
)
const typed = await evaluate(`(() => {
  const textarea = document.querySelector('.composer textarea')
  if (!textarea) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, ${JSON.stringify(prompt)})
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
if (!typed) throw new Error('Composer Autowin introuvable')
const clicked = await evaluate(`(() => {
  const button = document.querySelector('.composer .composer-send:not(:disabled)')
  button?.click()
  return Boolean(button)
})()`)
if (!clicked) throw new Error('Envoi Autowin indisponible')

let completed = false
for (let attempt = 0; attempt < 90; attempt += 1) {
  await sleep(2_000)
  const state = await evaluate(`(() => ({
    busy: document.querySelector('.composer-send')?.getAttribute('aria-label') !== 'Envoyer le message',
    userVisible: [...document.querySelectorAll('.msg.user .msg-body')].some((node) =>
      node.textContent?.includes(${JSON.stringify(sentinel)})),
    assistantCount: document.querySelectorAll('.msg.assistant .msg-body').length
  }))()`)
  if (!state.busy && state.userVisible && state.assistantCount > assistantCountBefore) {
    completed = true
    break
  }
}

const proof = await evaluate(`(async () => {
  const calls = await window.api.promptCalls()
  const call = [...calls].reverse().find((candidate) =>
    candidate.messages?.some((message) => message.content?.includes(${JSON.stringify(sentinel)})))
  const brains = await window.api.listBrains()
  const system = call?.system ?? ''
  return {
    completed: ${JSON.stringify(completed)},
    promptCallFound: Boolean(call),
    promptStatus: call?.status ?? null,
    providerCallCompleted: call?.status === 'completed',
    brainSignatureVerified: system.includes('[AMITEL BRAIN SIGNATURE VERIFIED]'),
    brainMarker: system.includes('[AMITEL BRAIN REFERENCE DATA'),
    brainSource: /knowledge[\\/]/i.test(system),
    graphifyMarker: system.includes('[GRAPHIFY CODE EVIDENCE'),
    graphifySource: /src[\\/]main[\\/](agent-pilot|amitel-context)/i.test(system),
    graphifyProvenance: system.includes(${JSON.stringify(
      `source_graph: ${sharedGraphResolvedPath}`
    )}),
    graphifyChecksum: system.includes(${JSON.stringify(`source_sha256: ${sharedGraphSha256}`)}),
    graphDiscovered: brains.some((brain) =>
      brain.id === 'autowin-os' || /projects[\\/]autowin-os[\\/]graphify-out/i.test(brain.path)),
    provider: call?.provider ?? null,
    model: call?.model ?? null,
    assistantVisible: [...document.querySelectorAll('.msg.assistant .msg-body')]
      .slice(-1)[0]?.textContent?.slice(0, 160) ?? null,
    responseConfirmed: ([...document.querySelectorAll('.msg.assistant .msg-body')]
      .slice(-1)[0]?.textContent ?? '').trimStart().startsWith('CONNEXION_OK')
  }
})()`)

const screenshot = await send('Page.captureScreenshot', { format: 'png' })
const output = 'C:/Amitel/Autowin OS/artifacts/amitel-graphify-e2e.png'
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
const ok = Object.entries(proof)
  .filter(([key]) =>
    [
      'completed',
      'promptCallFound',
      'providerCallCompleted',
      'brainSignatureVerified',
      'brainMarker',
      'brainSource',
      'graphifyMarker',
      'graphifySource',
      'graphifyProvenance',
      'graphifyChecksum',
      'graphDiscovered',
      'responseConfirmed'
    ].includes(key)
  )
  .every(([, value]) => value === true)
const result = {
  sentinel,
  proof,
  graph: {
    source: sharedGraphPath,
    resolvedSource: sharedGraphResolvedPath,
    sha256: sharedGraphSha256
  },
  screenshot: output,
  verdict: ok ? 'PASS' : 'FAIL'
}
writeFileSync(
  'C:/Amitel/Autowin OS/artifacts/amitel-graphify-e2e.json',
  JSON.stringify(result, null, 2),
  'utf8'
)
console.log(JSON.stringify(result, null, 2))
socket.close()
process.exit(ok ? 0 : 1)
