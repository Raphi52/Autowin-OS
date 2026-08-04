import { writeFileSync } from 'node:fs'

const value = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const port = Number(value('--port', '9251'))
const screenshotPath = value(
  '--out',
  `C:/Amitel/Autowin OS/Audit/headless-instances/auto-kaizen-proof-${port}.png`
)
const jsonPath = value('--json-out', screenshotPath.replace(/\.png$/i, '.json'))
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((candidate) => candidate.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error(`Aucune page CDP sur le port ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let sequence = 0
const pending = new Map()
const exceptions = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params)
  if (!message.id) return
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(message.error.message))
  else waiter.resolve(message.result)
})

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
await evaluate(`new Promise((resolve, reject) => {
  const deadline = Date.now() + 15000;
  const poll = () => {
    if (window.api?.conversationsCreate && window.api?.pilotChat) return resolve(true);
    if (Date.now() > deadline) return reject(new Error('window.api indisponible'));
    setTimeout(poll, 50);
  };
  poll();
})`)

await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes('Continuer quand même'));
  button?.click();
  return Boolean(button);
})()`)

const source = await evaluate(`window.api.conversationsCreate({
  title: 'Preuve Auto-Kaizen',
  category: 'codex',
  provider: 'codex',
  authorityMode: 'auto'
})`)
await evaluate(`window.api.pilotChat(
  [{ role: 'user', content: '[[autowin-fixture-auto-kaizen-error]]' }],
  ${JSON.stringify(source.id)}
)`)

const proof = await evaluate(`new Promise((resolve, reject) => {
  const sourceId = ${JSON.stringify(source.id)};
  const deadline = Date.now() + 15000;
  const poll = async () => {
    const conversations = await window.api.conversations();
    const analysis = conversations.find((item) => item.title.startsWith('Auto-Kaizen —'));
    const fix = conversations.find((item) => item.title.startsWith('Correction Auto-Kaizen —'));
    const sourceConversation = await window.api.conversation(sourceId);
    const sourceText = sourceConversation?.messages?.map((message) => message.content).join('\\n') || '';
    if (analysis && fix && sourceText.includes('Correctif vérifié')) {
      return resolve({ sourceId, analysisId: analysis.id, fixId: fix.id, sourceText });
    }
    if (Date.now() > deadline) return reject(new Error('Auto-Kaizen incomplet après 15 s'));
    setTimeout(poll, 100);
  };
  poll();
})`)

await evaluate(`(() => {
  const title = 'Preuve Auto-Kaizen';
  const item = [...document.querySelectorAll('.conv-item')]
    .find((candidate) => candidate.querySelector('.conv-label')?.textContent === title);
  item?.querySelector('.conv-pick')?.click();
  return Boolean(item);
})()`)
await new Promise((resolve) => setTimeout(resolve, 500))
const visible = await evaluate(`({
  hasSource: document.body.innerText.includes('Preuve Auto-Kaizen'),
  hasLaunch: document.body.innerText.includes('Auto-Kaizen') && document.body.innerText.includes('lancé dans'),
  hasFix: document.body.innerText.includes('Correctif vérifié')
})`)
const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))

const result = {
  ok: Boolean(visible.hasSource && visible.hasLaunch && visible.hasFix && exceptions.length === 0),
  sourceId: proof.sourceId,
  analysisId: proof.analysisId,
  fixId: proof.fixId,
  visible,
  exceptionCount: exceptions.length,
  screenshotPath
}
writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
socket.close()
if (!result.ok) {
  process.stderr.write(`${JSON.stringify(result)}\n`)
  process.exit(1)
}
process.stdout.write(`${JSON.stringify(result)}\n`)
