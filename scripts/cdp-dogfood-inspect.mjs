import { readFileSync, writeFileSync } from 'node:fs'

const port = process.env.AUTOWIN_CDP_PORT || '9223'
const discoverTargets = async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json`, {
      signal: AbortSignal.timeout(3_000)
    })
    return await response.json()
  } catch {
    const [activePort, browserPath] = readFileSync(
      'C:/Amitel/Autowin OS/.autowin-data/autowin-os/DevToolsActivePort',
      'utf8'
    )
      .trim()
      .split(/\r?\n/)
    const browserSocket = new WebSocket(`ws://127.0.0.1:${activePort}${browserPath}`)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP browser expiré')), 5_000)
      browserSocket.onopen = () => {
        clearTimeout(timeout)
        resolve()
      }
      browserSocket.onerror = reject
    })
    const targets = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Target.getTargets expiré')), 5_000)
      browserSocket.onmessage = ({ data }) => {
        const message = JSON.parse(data)
        if (message.id !== 1) return
        clearTimeout(timeout)
        resolve(message.result.targetInfos)
      }
      browserSocket.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }))
    })
    browserSocket.close()
    return targets.map((target) => ({
      ...target,
      webSocketDebuggerUrl: `ws://127.0.0.1:${activePort}/devtools/page/${target.targetId}`
    }))
  }
}

const targets = await discoverTargets()
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
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
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
const action = process.argv[2]
const retryWorktreeId = action?.startsWith('retry:') ? action.slice('retry:'.length) : undefined
const sendConversationId = action?.startsWith('send:') ? action.slice('send:'.length) : undefined
const inspectConversationId = action?.startsWith('conversation:')
  ? action.slice('conversation:'.length)
  : undefined
const telemetryConversationId = action?.startsWith('telemetry:')
  ? action.slice('telemetry:'.length)
  : undefined
const verifySettings = action === 'verify-settings'
const verifyAgentStudio = action === 'verify-agent-studio'
const verifyWorktrees = action === 'verify-worktrees'
const inspectWorktreeActivity = action === 'activity'
const cancelConversationId =
  action &&
  !retryWorktreeId &&
  !sendConversationId &&
  !inspectConversationId &&
  !telemetryConversationId &&
  !verifySettings &&
  !verifyAgentStudio &&
  !verifyWorktrees &&
  !inspectWorktreeActivity
    ? action
    : undefined

if (sendConversationId) {
  const prompt = process.argv.slice(3).join(' ').trim()
  if (!prompt) throw new Error('Prompt manquant pour send:<conversationId>')
  const chatOpened = await evaluate(`(() => {
    const button = document.querySelector('[data-testid="nav-chat"]')
    button?.click()
    return Boolean(button)
  })()`)
  if (!chatOpened) throw new Error('Navigation Chat introuvable')
  await sleep(250)
  const selected = await evaluate(`(async () => {
    const conversation = await window.api.conversation(${JSON.stringify(sendConversationId)})
    const item = [...document.querySelectorAll('.conv-item')].find(
      (candidate) => candidate.querySelector('.conv-label')?.textContent?.trim() === conversation?.title
    )
    item?.querySelector('.conv-pick')?.click()
    return Boolean(item)
  })()`)
  if (!selected) throw new Error(`Conversation UI introuvable: ${sendConversationId}`)
  await sleep(350)
  const typed = await evaluate(`(() => {
    const input = document.querySelector('.composer textarea')
    if (!(input instanceof HTMLTextAreaElement)) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(prompt)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  if (!typed) throw new Error('Zone de saisie introuvable')
  await sleep(100)
  const sent = await evaluate(`(() => {
    const button = document.querySelector('.composer .composer-send:not(:disabled)')
    if (!(button instanceof HTMLButtonElement)) return false
    button.click()
    return true
  })()`)
  console.log(
    JSON.stringify({ chatOpened, selected, typed, sent, conversationId: sendConversationId }, null, 2)
  )
  socket.close()
  process.exit(sent ? 0 : 1)
}

if (inspectConversationId) {
  const conversation = await evaluate(
    `window.api.conversation(${JSON.stringify(inspectConversationId)})`
  )
  console.log(JSON.stringify(conversation, null, 2))
  socket.close()
  process.exit(0)
}

if (telemetryConversationId) {
  const telemetry = await evaluate(`(async () => {
    const id = ${JSON.stringify(telemetryConversationId)}
    const [conversation, calls, traces, runs, activity] = await Promise.all([
      window.api.conversation(id),
      window.api.promptCalls(id),
      window.api.causalTrace(id),
      window.api.conversationRuns(id),
      window.api.conversationActivity(id)
    ])
    return {
      lastMessage: conversation?.messages?.at(-1) ?? null,
      calls: calls.map((call) => ({
        id: call.id,
        status: call.status,
        provider: call.provider,
        model: call.model,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        error: call.error
      })),
      traceTail: traces.slice(-12),
      runs: runs.map((run) => ({ path: run.path, summary: run.summary })),
      activityTail: activity.slice(-12)
    }
  })()`)
  console.log(JSON.stringify(telemetry, null, 2))
  socket.close()
  process.exit(0)
}

if (verifySettings) {
  const opened = await evaluate(`(() => {
    const button = document.querySelector('[data-testid="nav-settings"]')
    button?.click()
    return Boolean(button)
  })()`)
  if (!opened) throw new Error('Navigation Settings introuvable')
  await sleep(350)
  const diagnosticOpened = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === 'Diagnostic'
    )
    button?.click()
    return Boolean(button)
  })()`)
  if (!diagnosticOpened) throw new Error('Section Diagnostic introuvable')
  await sleep(500)
  const snapshot = await evaluate(`(() => {
    const view = document.querySelector('[data-testid="settings-view"]')
    return {
      visible: Boolean(view),
      text: view?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      repairButtons: [...(view?.querySelectorAll('[data-testid^="settings-repair-"]') ?? [])].map(
        (button) => ({ text: button.textContent?.trim(), testid: button.getAttribute('data-testid') })
      ),
      alert: view?.querySelector('[role="alert"]')?.textContent?.trim() ?? null
    }
  })()`)
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const screenshotPath =
    'C:/Amitel/Autowin OS/artifacts/dogfood-one-prompt/settings-diagnostic-published.png'
  writeFileSync(screenshotPath, Buffer.from(image.data, 'base64'))
  console.log(JSON.stringify({ opened, diagnosticOpened, screenshotPath, snapshot }, null, 2))
  socket.close()
  process.exit(snapshot?.visible ? 0 : 1)
}

if (verifyAgentStudio) {
  const opened = await evaluate(`(() => {
    const button = document.querySelector('[data-testid="nav-agent-studio"]')
    button?.click()
    return Boolean(button)
  })()`)
  if (!opened) throw new Error('Navigation Agent Studio introuvable')
  await sleep(500)
  const topology = await evaluate(`(() => {
    const view = document.querySelector('[data-testid="agent-studio-view"]')
    return {
      visible: Boolean(view),
      activeTab: view?.querySelector('.domain-tabs .is-active')?.textContent?.trim() ?? null,
      title: view?.querySelector('.agents-topology h1, .agents-topology h2')?.textContent?.trim() ?? null,
      state: view?.querySelector('.topology-state')?.textContent?.trim() ?? null,
      panels: [...(view?.querySelectorAll('.topology-panel h3') ?? [])].map((item) => item.textContent?.trim())
    }
  })()`)
  const routingOpened = await evaluate(`(() => {
    const button = [...document.querySelectorAll('[aria-label="Sections Agent Studio"] button')].find(
      (candidate) => candidate.textContent?.trim() === 'Routage'
    )
    button?.click()
    return Boolean(button)
  })()`)
  if (!routingOpened) throw new Error('Section Routage introuvable')
  await sleep(700)
  const routing = await evaluate(`(() => {
    const view = document.querySelector('[data-testid="agent-studio-view"]')
    return {
      visible: Boolean(view?.querySelector('.router-view')),
      activeTab: view?.querySelector('.domain-tabs .is-active')?.textContent?.trim() ?? null,
      title: view?.querySelector('.router-view h1, .router-view h2')?.textContent?.trim() ?? null,
      catalogError: view?.querySelector('[data-testid="router-catalog-error"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      empty: [...(view?.querySelectorAll('.router-empty') ?? [])].map((item) => item.textContent?.trim()),
      providers: [...(view?.querySelectorAll('.router-provider') ?? [])].map((item) => ({
        provider: item.getAttribute('data-provider'),
        status: item.getAttribute('data-status')
      }))
    }
  })()`)
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const screenshotPath =
    'C:/Amitel/Autowin OS/artifacts/dogfood-one-prompt/agent-studio-p1-published.png'
  writeFileSync(screenshotPath, Buffer.from(image.data, 'base64'))
  console.log(JSON.stringify({ opened, topology, routingOpened, routing, screenshotPath }, null, 2))
  socket.close()
  process.exit(topology?.visible && routing?.visible ? 0 : 1)
}

if (verifyWorktrees) {
  const opened = await evaluate(`(() => {
    const button = document.querySelector('[data-testid="nav-worktree"]')
    button?.click()
    return Boolean(button)
  })()`)
  if (!opened) throw new Error('Navigation Worktrees introuvable')
  await sleep(50)
  const initial = await evaluate(`(() => ({
    loading: document.querySelector('[data-testid="worktree-map-loading"]')?.textContent?.trim() ?? null,
    loadingRole: document.querySelector('[data-testid="worktree-map-loading"]')?.getAttribute('role') ?? null,
    statsHidden: document.querySelector('.wtmap-stats')?.hasAttribute('hidden') ?? null
  }))()`)
  let settled = null
  for (let attempt = 0; attempt < 30; attempt += 1) {
    settled = await evaluate(`(() => {
      const view = document.querySelector('[data-testid="worktree-map"]')
      const error = document.querySelector('[data-testid="worktree-map-error"]')
      return {
        visible: Boolean(view),
        title: document.querySelector('.module-header h1')?.textContent?.trim() ?? null,
        map: Boolean(document.querySelector('svg.wtmap-plan')),
        error: error?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
        retry: Boolean(document.querySelector('[data-testid="worktree-map-retry"]')),
        pick: Boolean(document.querySelector('[data-testid="worktree-map-error-pick"]')),
        loading: Boolean(document.querySelector('[data-testid="worktree-map-loading"]'))
      }
    })()`)
    if (settled?.map || settled?.error) break
    await sleep(500)
  }
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const screenshotPath =
    'C:/Amitel/Autowin OS/artifacts/dogfood-one-prompt/worktrees-states-published.png'
  writeFileSync(screenshotPath, Buffer.from(image.data, 'base64'))
  console.log(JSON.stringify({ opened, initial, settled, screenshotPath }, null, 2))
  socket.close()
  process.exit(settled?.visible && (settled?.map || settled?.error) ? 0 : 1)
}

const response = await send('Runtime.evaluate', {
  expression: retryWorktreeId
    ? `window.api.retryWorktreeRecovery(${JSON.stringify(retryWorktreeId)})`
    : inspectWorktreeActivity
      ? 'window.api.getWorktreeActivity()'
    : cancelConversationId
      ? `window.api.cancelOrchestration(${JSON.stringify(cancelConversationId)})`
      : `(async () => {
    const state = await window.api.appState()
    const conversations = await window.api.conversations()
    const active = conversations.find((conversation) => conversation.id === state.activeConversationId)
    return {
      title: document.title,
      nav: [...document.querySelectorAll('.nav-item')].map((item) => item.textContent?.trim()),
      headings: [...document.querySelectorAll('h1,h2')].map((item) => item.textContent?.trim()).filter(Boolean),
      buttons: [...document.querySelectorAll('button')].map((item) => ({
        text: item.textContent?.trim(),
        aria: item.getAttribute('aria-label'),
        testid: item.getAttribute('data-testid'),
        disabled: item.disabled
      })).filter((item) => item.text || item.aria || item.testid).slice(0, 120),
      composer: Boolean(document.querySelector('.composer textarea')),
      activeConversationId: state.activeConversationId,
      activeTitle: active?.title ?? null,
      conversationCount: conversations.length,
      busy: document.querySelector('.composer-send')?.getAttribute('aria-label') !== 'Envoyer le message'
    }
  })()`,
  returnByValue: true,
  awaitPromise: true
})
if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
console.log(JSON.stringify(response.result?.value, null, 2))
socket.close()
