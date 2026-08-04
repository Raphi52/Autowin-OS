import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { withDeviceMetricsOverride } from './cdp-device-metrics.mjs'

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const port = Number(argument('--port', '9261'))
const canaryPort = Number(argument('--canary-port', '9262'))
const productFingerprint = argument('--fingerprint', 'unbound')
const output = resolve(argument('--out', 'Audit/headless-instances/chat-html/proof/chat-html.png'))
const narrowOutput = output.replace(/\.png$/i, '-narrow.png')
const proofOutput = output.replace(/\.png$/i, '.json')
mkdirSync(dirname(output), { recursive: true })

let networkCanaryHits = 0
const networkCanaryHitsByType = { image: 0, metaRefresh: 0, link: 0 }
let canaryHealthHits = 0
const canaryServer = createServer((request, response) => {
  const requestUrl = request.url ?? ''
  if (requestUrl.includes('autowin-html-render-network-canary')) {
    networkCanaryHits += 1
    networkCanaryHitsByType.image += 1
  } else if (requestUrl.includes('autowin-html-render-meta-refresh-canary')) {
    networkCanaryHits += 1
    networkCanaryHitsByType.metaRefresh += 1
  } else if (requestUrl.includes('autowin-html-render-link-canary')) {
    networkCanaryHits += 1
    networkCanaryHitsByType.link += 1
  } else canaryHealthHits += 1
  response.writeHead(204).end()
})
await new Promise((resolveListen, rejectListen) => {
  canaryServer.once('error', rejectListen)
  canaryServer.listen(canaryPort, '127.0.0.1', resolveListen)
})
const canaryHealth = (await fetch(`http://127.0.0.1:${canaryPort}/health`)).status === 204

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
async function waitForPage() {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = pages.find((candidate) => candidate.type === 'page')
      if (page) return page
    } catch {
      // Electron démarre encore.
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
const capture = async (path) => {
  const screenshot = await evaluate(`window.api.captureTestPage()`)
  writeFileSync(path, Buffer.from(screenshot, 'base64'))
}

await send('Runtime.enable')
await send('Page.enable')
await evaluate(`document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()`)
await waitFor(
  `!document.querySelector('[data-testid="first-run-wizard"]')`,
  'fermeture du first-run'
)
const seeded = await evaluate(`window.api.seedArtifactPreviewsTest(true)`)
await send('Page.reload', { ignoreCache: true })
await waitFor(`document.readyState === 'complete'`, 'rechargement')
await sleep(1_200)
await evaluate(`document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()`)
await evaluate(`document.querySelector('[data-testid="nav-chat"]')?.click()`)
await waitFor(
  `(() => {
    const target = [...document.querySelectorAll('.conv-item')]
      .find((item) => item.querySelector('.conv-label')?.textContent === 'HTML rendu · fixture')
    target?.querySelector('.conv-pick')?.click()
    return Boolean(target)
  })()`,
  'conversation HTML'
)
await waitFor(
  `Boolean(document.querySelector('[data-testid="html-render-preview"] iframe'))`,
  'surface HTML'
)

const evaluateIframe = async (expression) => {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    const target = targets.find(
      (candidate) => candidate.type === 'iframe' && candidate.url.startsWith('data:text/html')
    )
    if (target?.webSocketDebuggerUrl) {
      const targetSocket = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((resolveOpen, rejectOpen) => {
        targetSocket.onopen = resolveOpen
        targetSocket.onerror = rejectOpen
      })
      const value = await new Promise((resolveValue, rejectValue) => {
        targetSocket.onmessage = (event) => {
          const message = JSON.parse(event.data)
          if (message.id !== 1) return
          if (message.error || message.result?.exceptionDetails)
            rejectValue(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)))
          else resolveValue(message.result?.result?.value)
        }
        targetSocket.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression, awaitPromise: true, returnByValue: true }
          })
        )
      })
      targetSocket.close()
      return value
    }
    await sleep(150)
  }
  throw new Error('Target CDP du document HTML introuvable')
}
const frameProof = await evaluateIframe(
  `({ ready: document.readyState, title: document.querySelector('h1')?.textContent, bodyText: document.body?.innerText, csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content, forbiddenScript: document.documentElement.dataset.forbiddenScript, metaRefreshPresent: Boolean(document.querySelector('meta[http-equiv="refresh"]')), navigationCanaryHref: document.querySelector('#network-navigation-canary')?.getAttribute('href') ?? null })`
)
const interactionProof = await evaluateIframe(
  `(() => { document.querySelector('summary')?.click(); return document.querySelector('#native-interaction')?.open })()`
)
const linkNavigationProof = await evaluateIframe(
  `(() => { document.querySelector('#network-navigation-canary')?.click(); return true })()`
)
await sleep(500)
const frameTargetsAfterNavigationCanaries = await (
  await fetch(`http://127.0.0.1:${port}/json`)
).json()
const frameUrlAfterNavigationCanaries =
  frameTargetsAfterNavigationCanaries.find((candidate) => candidate.type === 'iframe')?.url ?? null
const frameStayedOnDataUrl = frameUrlAfterNavigationCanaries?.startsWith('data:text/html') ?? false
const centerPreview = async () => {
  await evaluate(
    `document.querySelector('[data-testid="html-render-preview"]')?.scrollIntoView({ block: 'center', behavior: 'instant' })`
  )
  await sleep(500)
}

const inspect = async () =>
  evaluate(`(() => {
    const preview = document.querySelector('[data-testid="html-render-preview"]')
    const frame = preview?.querySelector('iframe')
    const chat = document.querySelector('.chat-scroll')
    if (!preview || !frame || !chat) return null
    const rect = preview.getBoundingClientRect()
    return {
      previewWidth: Math.round(rect.width),
      viewportWidth: window.innerWidth,
      sandbox: frame.getAttribute('sandbox'),
      parentCannotReadFrame: frame.contentDocument === null,
      isolatedDocumentUrl: frame.getAttribute('src')?.startsWith('data:text/html'),
      previewOverflow: preview.scrollWidth > preview.clientWidth,
      chatOverflow: chat.scrollWidth > chat.clientWidth
    }
  })()`)

// Un premier reflow amorce la composition OOPIF ; la capture suivante porte la largeur mesurée.
// Le bail restaure le viewport même si une inspection ou une capture jette : sans lui, un échec en
// milieu de mesure laissait la fenêtre figée à 1280 pour tout ce qui passait après.
let narrow
let wide
await withDeviceMetricsOverride(
  send,
  { width: 759, height: 900, deviceScaleFactor: 1, mobile: false },
  async () => {
    await centerPreview()
    await send('Emulation.setDeviceMetricsOverride', {
      width: 760,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    })
    await centerPreview()
    narrow = await inspect()
    await capture(narrowOutput)
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    })
    await centerPreview()
    wide = await inspect()
    await capture(output)
  }
)

const cleanedConversationIds = await evaluate(`(async () => {
  const fixtures = (await window.api.conversations())
    .filter((conversation) => conversation.title === 'HTML rendu · fixture')
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
  narrowOutput,
  wide,
  narrow,
  frameProof,
  interactionProof,
  linkNavigationProof,
  frameStayedOnDataUrl,
  canaryHealth,
  canaryHealthHits,
  networkCanaryHits,
  networkCanaryHitsByType,
  cleanedConversationIds,
  runtimeErrors: runtimeErrors.length
}
writeFileSync(proofOutput, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result))
socket.close()
await new Promise((resolveClose) => canaryServer.close(resolveClose))

if (
  !wide ||
  !narrow ||
  wide.sandbox !== '' ||
  !wide.parentCannotReadFrame ||
  !wide.isolatedDocumentUrl ||
  wide.previewOverflow ||
  wide.chatOverflow ||
  narrow.previewOverflow ||
  narrow.chatOverflow ||
  !frameProof.title ||
  frameProof.forbiddenScript !== undefined ||
  frameProof.metaRefreshPresent ||
  frameProof.navigationCanaryHref !== null ||
  !canaryHealth ||
  canaryHealthHits !== 1 ||
  networkCanaryHits !== 0 ||
  !frameProof.csp?.includes("default-src 'none'") ||
  !frameProof.csp?.includes("connect-src 'none'") ||
  interactionProof !== true ||
  linkNavigationProof !== true ||
  !frameStayedOnDataUrl ||
  runtimeErrors.length
)
  process.exit(1)
