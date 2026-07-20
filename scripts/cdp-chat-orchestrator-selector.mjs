import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const port = Number(process.argv[2] || 9273)
const output =
  process.argv[3] ||
  'C:/Amitel/Autowin OS/Audit/evidence/chat-orchestrator-selector-post-action.png'
const traceOutput = output.replace(/\.png$/i, '.json')
const inspectOnly = process.argv.includes('--inspect-only')
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error(`Fenêtre Electron introuvable sur ${port}`)
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
let nextId = 0
const pending = new Map()
const pageEvents = []
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data)
  const callback = pending.get(message.id)
  if (!callback) {
    if (message.method?.startsWith('Page.'))
      pageEvents.push({ method: message.method, at: Date.now() })
    return
  }
  pending.delete(message.id)
  message.error
    ? callback.reject(new Error(message.error.message))
    : callback.resolve(message.result)
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.text || 'Évaluation DOM en échec')
  return result.result?.value
}
await send('Page.enable')

if (inspectOnly) {
  const inspected = await evaluate(`(async () => ({
    hasSelector: Boolean(document.querySelector('[data-testid="chat-orchestrator-model"]')),
    activeTitle: document.querySelector('.conv-item.active .conv-label')?.textContent?.trim() ?? null,
    conversationIds: (await window.api.conversations()).map((conversation) => conversation.id),
    href: location.href
  }))()`)
  socket.close()
  console.log(JSON.stringify({ port, inspected }))
  process.exit(0)
}

const preparation = await evaluate(`(async () => {
  const waitFor = async (predicate, timeout = 120000) => {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const value = await predicate()
      if (value) return value
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Délai de fixture dépassé')
  }
  const conversationsBefore = await window.api.conversations()
  const convBefore = conversationsBefore.find((conversation) => conversation.id === 'conv-6')
  if (!convBefore) throw new Error('conv-6 absente')
  if (document.querySelector('.conv-item.active .conv-label')?.textContent?.trim() !== convBefore.title) {
    const row = [...document.querySelectorAll('.conv-item')].find(
      (item) => item.querySelector('.conv-label')?.textContent?.trim() === convBefore.title
    )
    row?.querySelector('.conv-pick')?.click()
    await waitFor(() =>
      document.querySelector('.conv-item.active .conv-label')?.textContent?.trim() === convBefore.title
    )
  }
  await waitFor(() => document.querySelector('.chat-layout')?.dataset.activeConversationId === 'conv-6')
  return {
    preparedAt: Date.now(),
    conversationId: convBefore.id,
    activeId: document.querySelector('.chat-layout')?.dataset.activeConversationId,
    activeTitle: document.querySelector('.conv-item.active .conv-label')?.textContent?.trim()
  }
})()`)
if (preparation.conversationId !== 'conv-6' || preparation.activeId !== 'conv-6') {
  throw new Error(`Préparation conv-6 incomplète: ${JSON.stringify(preparation)}`)
}
pageEvents.length = 0
const measurementStartedAt = Date.now()

const proof = await evaluate(`(async () => {
  const waitFor = async (predicate, timeout = 120000) => {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const value = await predicate()
      if (value) return value
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Délai de fixture dépassé')
  }
  const activeId = () => document.querySelector('.chat-layout')?.dataset.activeConversationId ?? null
  const activeTab = () => document.querySelector('.nav-item.active')?.textContent?.trim() ?? null
  const hrefBefore = location.href
  const measure = { activeIds: [], tabs: [], historyCalls: [], reloadCalls: 0 }
  const sample = (phase) => {
    measure.activeIds.push({ phase, value: activeId(), at: Date.now() })
    measure.tabs.push({ phase, value: activeTab(), at: Date.now() })
  }
  const originalPushState = history.pushState.bind(history)
  const originalReplaceState = history.replaceState.bind(history)
  history.pushState = (...args) => { measure.historyCalls.push({ kind: 'pushState', at: Date.now() }); return originalPushState(...args) }
  history.replaceState = (...args) => { measure.historyCalls.push({ kind: 'replaceState', at: Date.now() }); return originalReplaceState(...args) }
  window.addEventListener('beforeunload', () => { measure.reloadCalls += 1 })
  const observer = new MutationObserver(() => sample('mutation'))
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-active-conversation-id'] })
  const conversationsBefore = await window.api.conversations()
  const convBefore = conversationsBefore.find((conversation) => conversation.id === 'conv-6')
  if (!convBefore || activeId() !== 'conv-6') throw new Error('Mesure démarrée sans conv-6 déjà active')
  sample('measure-start')
  const activeTitle = document.querySelector('.conv-item.active .conv-label')?.textContent?.trim()
  const select = document.querySelector('[data-testid="chat-orchestrator-model"]')
  if (!(select instanceof HTMLSelectElement)) throw new Error('Sélecteur orchestrateur absent')
  const rolesBefore = await window.api.roles()
  const callsBefore = await window.api.promptCalls('conv-6')
  const oldMessages = JSON.parse(JSON.stringify(convBefore.messages))
  const oldPanels = {
    workflowsVisible: Boolean(document.querySelector('.runs-pane')),
    decisionsVisible: Boolean(document.querySelector('.decision-strip'))
  }
  const options = [...select.options].filter((option) => option.value && !option.disabled)
  const target = options.find((option) => option.value !== select.value)
  if (!target) throw new Error('Aucun second modèle sélectionnable dans le catalogue dynamique')
  const [targetProvider, targetModel] = target.value.split('\\u0000')
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  setter?.call(select, target.value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await waitFor(async () => {
    const roles = await window.api.roles()
    return roles.orchestrator?.provider === targetProvider && roles.orchestrator?.model === targetModel
  })
  await waitFor(() => !select.disabled)
  sample('selection-complete')
  const identityAfterSwitch = document.querySelector('[data-testid="chat-runtime-identity"]')?.textContent?.trim()
  const convAfterSwitch = (await window.api.conversations()).find((conversation) => conversation.id === 'conv-6')
  const continuityAfterSwitch =
    JSON.stringify(convAfterSwitch?.messages) === JSON.stringify(oldMessages) &&
    document.querySelector('.conv-item.active .conv-label')?.textContent?.trim() === activeTitle &&
    Boolean(document.querySelector('.runs-pane')) === oldPanels.workflowsVisible &&
    Boolean(document.querySelector('.decision-strip')) === oldPanels.decisionsVisible
  if (!continuityAfterSwitch) throw new Error('Continuité UI rompue pendant le changement de modèle')
  const prompt = 'TRACE-ORCHESTRATOR-' + Date.now() + ' — réponds uniquement TRACE-OK.'
  const textarea = document.querySelector('.composer textarea')
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Compositeur absent')
  const textSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  textSetter?.call(textarea, prompt)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 50))
  const sendButton = document.querySelector('.composer-send')
  if (!(sendButton instanceof HTMLButtonElement) || sendButton.disabled)
    throw new Error('Envoi indisponible')
  sendButton.click()
  const busyProof = await waitFor(() =>
    select.disabled && select.getAttribute('aria-describedby')
      ? {
          disabled: select.disabled,
          explanation: document.getElementById('chat-orchestrator-model-help')?.textContent?.trim(),
          stopVisible: document.querySelector('.composer-send')?.textContent?.includes('Stop') === true
        }
      : null
  )
  sample('turn-busy')
  await waitFor(() => !select.disabled, 180000)
  sample('turn-complete')
  const conversationsAfter = await window.api.conversations()
  const convAfter = conversationsAfter.find((conversation) => conversation.id === 'conv-6')
  const callsAfter = await window.api.promptCalls('conv-6')
  const promptTrace = callsAfter.findLast((call) =>
    call.messages?.some((message) => message.content?.includes(prompt))
  )
  const oldMessagesPreserved = oldMessages.every(
    (message, index) => JSON.stringify(convAfter?.messages[index]) === JSON.stringify(message)
  )
  observer.disconnect()
  const result = {
    conversationIdBefore: convBefore.id,
    conversationIdAfter: convAfter?.id,
    oldMessageCount: oldMessages.length,
    messageCountAfter: convAfter?.messages.length,
    oldMessagesPreserved,
    activeTitleBefore: activeTitle,
    activeTitleAfter: document.querySelector('.conv-item.active .conv-label')?.textContent?.trim(),
    oldPanels,
    panelsAfter: {
      workflowsVisible: Boolean(document.querySelector('.runs-pane')),
      decisionsVisible: Boolean(document.querySelector('.decision-strip'))
    },
    rolesBefore: rolesBefore.orchestrator,
    rolesAfter: (await window.api.roles()).orchestrator,
    selected: { provider: targetProvider, model: targetModel, label: target.textContent?.trim() },
    identityAfterSwitch,
    busyProof,
    reenabled: !select.disabled,
    prompt,
    promptCallsBefore: callsBefore.length,
    promptCallsAfter: callsAfter.length,
    promptTrace: promptTrace
      ? { conversationId: promptTrace.conversationId, provider: promptTrace.provider, model: promptTrace.model }
      : null
  }
  result.measurement = {
    ...measure,
    hrefBefore,
    hrefAfter: location.href,
    conversationIdsBefore: conversationsBefore.map((conversation) => conversation.id),
    conversationIdsAfter: conversationsAfter.map((conversation) => conversation.id),
    activeIdAfter: activeId()
  }
  return result
})()`)

proof.preparation = preparation
proof.measurement.startedAt = measurementStartedAt
proof.measurement.pageEvents = pageEvents.slice()

if (
  proof.conversationIdBefore !== 'conv-6' ||
  proof.conversationIdAfter !== 'conv-6' ||
  proof.measurement.activeIdAfter !== 'conv-6' ||
  proof.measurement.activeIds.some((sample) => sample.value !== 'conv-6') ||
  new Set(proof.measurement.tabs.map((sample) => sample.value)).size !== 1 ||
  proof.measurement.historyCalls.length !== 0 ||
  proof.measurement.reloadCalls !== 0 ||
  proof.measurement.pageEvents.some((event) =>
    ['Page.frameNavigated', 'Page.loadEventFired', 'Page.frameStartedLoading'].includes(
      event.method
    )
  ) ||
  JSON.stringify(proof.measurement.conversationIdsBefore) !==
    JSON.stringify(proof.measurement.conversationIdsAfter) ||
  !proof.oldMessagesPreserved ||
  proof.activeTitleBefore !== proof.activeTitleAfter ||
  JSON.stringify(proof.oldPanels) !== JSON.stringify(proof.panelsAfter) ||
  !proof.busyProof?.disabled ||
  !proof.busyProof?.stopVisible ||
  !proof.reenabled ||
  proof.promptTrace?.conversationId !== 'conv-6' ||
  proof.promptTrace?.provider !== proof.selected.provider ||
  proof.promptTrace?.model !== proof.selected.model
) {
  throw new Error(`Preuve de continuité incomplète: ${JSON.stringify(proof)}`)
}
mkdirSync(dirname(output), { recursive: true })
const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
writeFileSync(traceOutput, JSON.stringify({ port, output, proof }, null, 2))
socket.close()
console.log(JSON.stringify({ port, output, traceOutput, proof }, null, 2))
