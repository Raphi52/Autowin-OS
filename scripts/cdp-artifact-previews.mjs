import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const port = Number(argument('--port', '9257'))
const productFingerprint = argument('--fingerprint', 'unbound')
const output = resolve(
  argument('--out', 'Audit/headless-instances/artifact-previews/artifact-previews.png')
)
const topOutput = output.replace(/\.png$/i, '-top.png')
const proofOutput = output.replace(/\.png$/i, '.json')
mkdirSync(dirname(output), { recursive: true })

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
async function waitForPage() {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = pages.find((candidate) => candidate.type === 'page')
      if (page) return page
    } catch {
      // L'instance Electron est encore en train de démarrer.
    }
    await sleep(150)
  }
  throw new Error(`Fenêtre Electron introuvable sur le port ${port}`)
}

const page = await waitForPage()
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolveOpen, rejectOpen) => {
  socket.onopen = resolveOpen
  socket.onerror = rejectOpen
})
let sequence = 0
const pending = new Map()
const runtimeErrors = []
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const call = pending.get(message.id)
  if (!call) {
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params)
    return
  }
  pending.delete(message.id)
  message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result)
}
const send = (method, params = {}) =>
  new Promise((resolveCall, rejectCall) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectCall(new Error(`Timeout CDP: ${method}`))
    }, 45_000)
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolveCall(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        rejectCall(error)
      }
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails)
    throw new Error(`Erreur renderer: ${JSON.stringify(result.exceptionDetails).slice(0, 800)}`)
  return result.result?.value
}
const waitFor = async (expression, label, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await evaluate(expression)
    if (value) return value
    await sleep(150)
  }
  throw new Error(`Délai dépassé: ${label}`)
}

await send('Runtime.enable')
await evaluate(`document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()`)
await waitFor(
  `!document.querySelector('[data-testid="first-run-wizard"]')`,
  'fermeture du first-run'
)
const seeded = await evaluate(`window.api.seedArtifactPreviewsTest()`)
await send('Page.reload', { ignoreCache: true })
await waitFor(`document.readyState === 'complete'`, 'rechargement')
await sleep(1_500)
await evaluate(`document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()`)
await waitFor(
  `!document.querySelector('[data-testid="first-run-wizard"]')`,
  'fermeture du first-run après rechargement'
)
await evaluate(`document.querySelector('[data-testid="nav-chat"]')?.click()`)
await waitFor(
  `(() => {
    const target = [...document.querySelectorAll('.conv-item')]
      .find((item) => item.querySelector('.conv-label')?.textContent === 'Galerie · artefacts modèles')
    target?.querySelector('.conv-pick')?.click()
    return Boolean(target)
  })()`,
  'conversation de galerie'
)
await waitFor(
  `document.querySelectorAll('.artifact-preview').length === 5`,
  'montage des cartes artefact'
)
await evaluate(`(async () => {
  const scroll = document.querySelector('.chat-scroll')
  if (!scroll) return false
  await new Promise((resolve) => setTimeout(resolve, 500))
  for (const card of document.querySelectorAll('.artifact-preview')) {
    card.scrollIntoView({ block: 'center', behavior: 'instant' })
    await new Promise((resolve) => setTimeout(resolve, 650))
  }
  return true
})()`)
const proof = await waitFor(
  `(() => {
    const cards = [...document.querySelectorAll('.artifact-preview')]
    const kinds = cards.map((card) => card.getAttribute('data-artifact-kind'))
    const loaded = !document.body.textContent.includes('Chargement de l’aperçu')
    const diagram = document.querySelector('.artifact-diagram svg')
    const image = document.querySelector('.artifact-preview__image')
    const markdown = document.querySelector('.artifact-preview .brain-markdown h2')
    const table = document.querySelector('.artifact-preview table')
    const model3d = document.querySelector('.artifact-model3d canvas')
    if (cards.length !== 5 || !loaded || !diagram || !image || !markdown || !table || !model3d)
      return null
    return {
      cardCount: cards.length,
      kinds,
      diagramSecurity: document.querySelector('.artifact-diagram')?.dataset.diagramSecurity,
      diagramNodes: diagram.querySelectorAll('g.node').length,
      imageDataUrl: image.getAttribute('src')?.startsWith('data:image/svg+xml;base64,'),
      markdownTitle: markdown.textContent,
      tableText: table.textContent,
      model3dCanvas: true,
      loadingCards: document.querySelectorAll('.artifact-preview [role="status"]').length,
      blockedCards: document.querySelectorAll('.artifact-preview__blocked').length
    }
  })()`,
  'rendus d’artefacts'
)
await evaluate(`window.api.setZoomFactor(0.7)`)
await sleep(300)
const topScreenshot = await evaluate(`(async () => {
  document.querySelector('.chat-scroll')?.scrollTo({ top: 0, behavior: 'instant' })
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  return window.api.captureTestPage()
})()`)
writeFileSync(topOutput, Buffer.from(topScreenshot, 'base64'))
const visual = await evaluate(`(() => {
  const scroll = document.querySelector('.chat-scroll')
  scroll?.scrollTo({ top: scroll.scrollHeight, behavior: 'instant' })
  return {
    scrollHeight: scroll?.scrollHeight,
    clientHeight: scroll?.clientHeight,
    cardRects: [...document.querySelectorAll('.artifact-preview')].map((card) => {
      const rect = card.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, height: rect.height }
    })
  }
})()`)
await sleep(300)
const screenshot = await evaluate(`(async () => {
  document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return window.api.captureTestPage()
})()`)
writeFileSync(output, Buffer.from(screenshot, 'base64'))
const cleanedConversationIds = await evaluate(`(async () => {
  const fixtures = (await window.api.conversations())
    .filter((conversation) => conversation.title === 'Galerie · artefacts modèles')
    .map((conversation) => conversation.id)
  for (const id of fixtures) await window.api.conversationsRemove(id)
  return fixtures
})()`)

const result = {
  capturedAt: new Date().toISOString(),
  productFingerprint,
  port,
  seeded,
  output,
  topOutput,
  proof,
  visual,
  cleanedConversationIds,
  runtimeErrors: runtimeErrors.length
}
writeFileSync(proofOutput, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result))
socket.close()

if (
  proof.cardCount !== 5 ||
  proof.diagramSecurity !== 'strict' ||
  !proof.imageDataUrl ||
  !proof.model3dCanvas ||
  proof.markdownTitle !== 'Livraison vérifiée' ||
  proof.loadingCards !== 0 ||
  proof.blockedCards !== 0 ||
  runtimeErrors.length
)
  process.exit(1)
