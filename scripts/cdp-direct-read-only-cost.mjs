import { mkdirSync, writeFileSync } from 'node:fs'

const port = process.env.AUTOWIN_CDP_PORT || '9223'
const artifactRoot = 'C:/Amitel/Autowin OS/artifacts/autowin-live-monitor'
const prompt =
  'Analyse package.json puis réponds exactement PREUVE_WATCHDOG_OK. Ne modifie aucun fichier.'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

mkdirSync(artifactRoot, { recursive: true })

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error(`Fenêtre Autowin introuvable via CDP sur ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 0
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data)
  const callback = pending.get(message.id)
  if (!callback) return
  pending.delete(message.id)
  message.error
    ? callback.reject(new Error(message.error.message))
    : callback.resolve(message.result)
}
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP ${method} expiré`))
    }, 30_000)
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    })
    socket.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ?? response.exceptionDetails.text
    )
  }
  return response.result?.value
}

const waitFor = async (probe, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe()
    if (value) return value
    await sleep(250)
  }
  throw new Error(`Délai dépassé: ${label}`)
}

await waitFor(
  () => evaluate(`Boolean(window.api && document.querySelector('[data-testid="nav-chat"]'))`),
  90_000,
  'renderer prêt'
)
await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === 'Continuer quand même'
  )
  button?.click()
  return Boolean(button)
})()`)
await sleep(250)
await evaluate(`document.querySelector('[data-testid="nav-chat"]')?.click()`)
await sleep(300)

const previousId = await evaluate(
  `window.api.appState().then((state) => state.activeConversationId ?? null)`
)
const newClicked = await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === 'Nouveau'
  )
  button?.click()
  return Boolean(button)
})()`)
if (!newClicked) throw new Error('Bouton Nouveau introuvable')
await sleep(250)

const typed = await evaluate(`(() => {
  const input = document.querySelector('.composer textarea')
  if (!input) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(input, ${JSON.stringify(prompt)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
if (!typed) throw new Error('Composer introuvable')
await sleep(100)

const sent = await evaluate(`(() => {
  const button = document.querySelector('.composer .composer-send:not(:disabled)')
  button?.click()
  return Boolean(button)
})()`)
if (!sent) throw new Error('Bouton Envoyer indisponible')

const conversationId = await waitFor(
  () =>
    evaluate(`(async () => {
      const state = await window.api.appState()
      if (!state.activeConversationId || state.activeConversationId === ${JSON.stringify(previousId)}) return null
      const conversation = await window.api.conversation(state.activeConversationId)
      return conversation?.messages?.some(
        (message) => message.role === 'user' && message.content === ${JSON.stringify(prompt)}
      ) ? state.activeConversationId : null
    })()`),
  20_000,
  'conversation persistée'
)

const terminal = await waitFor(
  () =>
    evaluate(`(async () => {
      const conversation = await window.api.conversation(${JSON.stringify(conversationId)})
      const last = conversation?.messages?.at(-1)
      return last?.role === 'assistant' && ['completed', 'failed', 'cancelled', 'interrupted'].includes(last.status)
        ? { status: last.status, text: last.content, error: last.error ?? null }
        : null
    })()`),
  180_000,
  'réponse terminale'
)

const telemetry = await evaluate(`(async () => {
  const id = ${JSON.stringify(conversationId)}
  const [calls, runs, activity, costByModel, state] = await Promise.all([
    window.api.promptCalls(id),
    window.api.conversationRuns(id),
    window.api.conversationActivity(id),
    window.api.costBreakdown('model', id),
    window.api.appState()
  ])
  return {
    calls: calls.map((call) => ({
      status: call.status,
      provider: call.provider,
      model: call.model,
      resolvedModel: call.resolvedModel,
      systemChars: call.system?.length ?? 0,
      systemPrefix: call.system?.slice(0, 120) ?? '',
      directReadOnlySystem: /LECTURE SEULE/i.test(call.system ?? ''),
      inputTokens: call.usage?.inputTokens ?? 0,
      outputTokens: call.usage?.outputTokens ?? 0,
      costUsd: call.usage?.costUsd ?? null,
      durationMs: call.durationMs ?? null
    })),
    runCount: runs.length,
    orchestrateActions: activity.filter((item) => item.name === 'orchestrate').length,
    costByModel,
    runtimeBinding: state.roles?.orchestrator ?? null
  }
})()`)

const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
const screenshotPath = `${artifactRoot}/direct-read-only-cost.png`
writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))

const report = {
  observedAt: new Date().toISOString(),
  conversationId,
  prompt,
  terminal,
  ...telemetry,
  screenshotPath
}
report.valid =
  terminal.status === 'completed' &&
  terminal.text.trim() === 'PREUVE_WATCHDOG_OK' &&
  report.calls.length === 1 &&
  report.calls[0].systemChars < 1_200 &&
  report.calls[0].directReadOnlySystem === true &&
  report.runCount === 0 &&
  report.orchestrateActions === 0

const reportPath = `${artifactRoot}/direct-read-only-cost.json`
writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify(report, null, 2))
socket.close()
process.exit(report.valid ? 0 : 1)
