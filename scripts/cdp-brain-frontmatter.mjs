import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const port = Number(arg('--port', '9252'))
const output = arg('--output', 'C:/Amitel/Autowin OS/artifacts/brain-frontmatter-green.png')
const deadline = Date.now() + 10_000
let pages
do {
  try {
    pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
} while (!pages && Date.now() < deadline)
if (!pages) throw new Error(`Endpoint CDP indisponible sur ${port}`)
const page = pages.find((item) => item.type === 'page')
if (!page) throw new Error(`Aucune page CDP sur ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await Promise.race([
  new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  }),
  new Promise((_, reject) => setTimeout(() => reject(new Error('Connexion CDP expirée')), 5000))
])
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
  Promise.race([
    new Promise((resolve, reject) => {
      const callId = ++id
      pending.set(callId, { resolve, reject })
      socket.send(JSON.stringify({ id: callId, method, params }))
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Commande CDP expirée: ${method}`)), 15_000)
    )
  ])
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) throw new Error('Évaluation DOM en échec')
  return result.result.value
}

await send('Page.bringToFront')
await new Promise((resolve) => setTimeout(resolve, 300))

const sources = JSON.stringify([
  'file:knowledge/domain/rigapplication-documentation/reference/80-services-batch/catalogue-services.md',
  'file:knowledge/domain/rigapplication-documentation/reference/80-services-batch/amimessage-bus.md',
  'file:knowledge/domain/rigapplication-documentation/reference/70-edi-integrations/architecture.md'
])
const metrics = await evaluate(`(() => {
  document.querySelector('#brain-frontmatter-fixture')?.remove()
  const fixture = document.createElement('section')
  fixture.id = 'brain-frontmatter-fixture'
  fixture.style.cssText = 'position:fixed;inset:70px 56px auto 56px;z-index:99999;background:#05090e;border:1px solid #263444;border-radius:12px;overflow:hidden'
  fixture.innerHTML = '<div class="brain-markdown"><dl class="brain-markdown__meta" aria-label="Métadonnées de la note">' +
    '<div><dt>sources</dt><dd>${sources.replaceAll("'", "\\'")}</dd></div>' +
    '<div><dt>reviewed_by</dt><dd>["codecgpt-5.6-terra"]</dd></div>' +
    '<div><dt>reviewed_at</dt><dd>2026-07-16</dd></div>' +
    '</dl></div>'
  document.body.appendChild(fixture)
  const source = fixture.querySelector('dt')
  const sourceChip = source.parentElement
  const lineHeight = Number.parseFloat(getComputedStyle(source).lineHeight) || source.clientHeight
  return {
    label: source.textContent,
    sourceLabelLines: Math.round((source.getBoundingClientRect().height / lineHeight) * 100) / 100,
    sourceChipFits: sourceChip.scrollWidth <= sourceChip.clientWidth,
    supersedesVisible: [...fixture.querySelectorAll('dt')].some((item) => item.textContent === 'supersedes')
  }
})()`)
const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
console.log(JSON.stringify({ metrics, output }))
socket.close()
if (metrics.sourceLabelLines > 1.1 || !metrics.sourceChipFits || metrics.supersedesVisible)
  process.exitCode = 1
