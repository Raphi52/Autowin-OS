import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const port = process.env.AUTOWIN_CDP_PORT || '9291'
const appData = process.env.AUTOWIN_WIRE_APPDATA
const output =
  process.env.AUTOWIN_WIRE_REPORT || 'C:/Amitel/Autowin OS/artifacts/wire-all-packaged-report.json'
const screenshotOutput = output.replace(/\.json$/i, '.png')
if (!appData) throw new Error('AUTOWIN_WIRE_APPDATA requis pour la fixture isolée')

const checkpoint = {
  runId: 'wire-proof-source',
  task: 'preuve checkpoint packagée',
  conversationId: 'wire-proof-conversation',
  phaseOutputs: [{ phase: 'frame', text: 'source immutable' }],
  startedAt: Date.now() - 2_000,
  updatedAt: Date.now() - 1_000
}
const runStateRoot = join(appData, 'autowin-os', 'run-state')
mkdirSync(runStateRoot, { recursive: true })
rmSync(join(runStateRoot, 'wire-proof-branch.json'), { force: true })
writeFileSync(join(runStateRoot, `${checkpoint.runId}.json`), JSON.stringify(checkpoint), 'utf8')

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((target) => target.type === 'page')
if (!page) throw new Error(`Fenêtre Autowin introuvable sur ${port}`)
const socket = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const runtimeErrors = []
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data)
  if (!message.id) {
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push({
        source: 'exception',
        text:
          message.params?.exceptionDetails?.exception?.description ??
          message.params?.exceptionDetails?.text ??
          'Exception renderer'
      })
    }
    if (
      message.method === 'Runtime.consoleAPICalled' &&
      ['error', 'assert'].includes(message.params?.type)
    ) {
      runtimeErrors.push({
        source: `console.${message.params.type}`,
        text: (message.params?.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ')
      })
    }
    if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
      runtimeErrors.push({ source: 'log', text: message.params.entry.text })
    }
    return
  }
  const callback = pending.get(message.id)
  if (!callback) return
  pending.delete(message.id)
  message.error
    ? callback.reject(new Error(message.error.message))
    : callback.resolve(message.result)
}
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Connexion CDP expirée')), 5_000)
  socket.onopen = () => {
    clearTimeout(timeout)
    resolve()
  }
  socket.onerror = reject
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(
      () => {
        pending.delete(id)
        reject(new Error(`CDP ${method} expiré`))
      },
      ['Runtime.evaluate', 'Page.captureScreenshot'].includes(method) ? 60_000 : 20_000
    )
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
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? 'Erreur DOM')
  return result.result?.value
}
const checks = []
const executablePath = process.env.AUTOWIN_WIRE_EXECUTABLE
const executableSha256 = executablePath
  ? createHash('sha256').update(readFileSync(executablePath)).digest('hex')
  : null
const writeProofReport = ({ passed, screenshot = null, failure = null }) => {
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(
    output,
    JSON.stringify(
      {
        schema: 'autowin.wire-all-proof/v1',
        runStamp: new Date().toISOString(),
        target: { port, executablePath, executableSha256 },
        checks,
        runtimeErrors,
        passed,
        screenshot,
        failure
      },
      null,
      2
    ),
    'utf8'
  )
}
const check = (id, ok, evidence) => {
  checks.push({ id, ok: Boolean(ok), evidence })
  if (!ok) {
    writeProofReport({ passed: false, failure: { id, evidence } })
    throw new Error(`${id}: ${JSON.stringify(evidence)}`)
  }
  console.log(`[wire-proof] ${id}`)
}
const rejected = async (expression) =>
  evaluate(`(async () => {
    try { await (${expression}); return { rejected: false } }
    catch (error) { return { rejected: true, message: String(error?.message ?? error) } }
  })()`)

await send('Runtime.enable')
await send('Log.enable')
await send('Page.reload', { ignoreCache: true })
await new Promise((resolve) => setTimeout(resolve, 900))

console.log('[wire-proof] fixture:start')
const fixture = await evaluate(`(async () => {
  const existing = (await window.api.conversations()).find((item) =>
    ['Preuve chemin critique', 'Preuve wire-all'].includes(item.title)
  )
  const conversation = existing ?? await window.api.conversationsCreate({
    title: 'Preuve wire-all', category: 'codex', provider: 'codex'
  })
  if ((await window.api.causalTrace(conversation.id)).length < 2) {
    const result = await window.api.pilotChat([
      { role: 'user', content: '[[autowin-fixture-durable-stream]] wire-all-packaged' }
    ], conversation.id)
    if (!result.ok) throw new Error(result.error || 'Fixture conversation en échec')
  }
  return conversation
})()`)
console.log('[wire-proof] fixture:ready')

await evaluate("window.api.appCommand('navigate', { tab: 'chat' })")
await new Promise((resolve) => setTimeout(resolve, 600))
await evaluate(`(() => {
  const label = [...document.querySelectorAll('.conv-label')].find(
    (item) => item.textContent?.trim() === '${fixture.title}'
  )
  label?.closest('.conv-item')?.querySelector('.conv-pick')?.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 350))

const scopedEvents = await evaluate(`new Promise(async (resolve) => {
  const seen = []
  const stop = window.api.onAppEvent((event) => seen.push(event))
  await window.api.isolatedTestConversationReadCount(true)
  await window.api.emitIsolatedTestAppEvent({ type: 'refresh', scope: 'chat', convId: 'foreign-conversation' })
  await new Promise((done) => setTimeout(done, 80))
  const foreignReads = await window.api.isolatedTestConversationReadCount(true)
  await window.api.emitIsolatedTestAppEvent({ type: 'refresh', scope: 'chat', convId: '${fixture.id}' })
  await new Promise((done) => setTimeout(done, 80))
  const targetReads = await window.api.isolatedTestConversationReadCount(true)
  stop()
  resolve({ seen, foreignReads, targetReads })
})`)
check(
  '01-resume-refresh-scoped',
  scopedEvents.seen.length === 2 && scopedEvents.foreignReads === 0 && scopedEvents.targetReads > 0,
  scopedEvents
)

const providers = await evaluate('window.api.providerStatus()')
const gemini = providers.find((provider) => provider.provider === 'gemini')
check(
  '02-gemini-router-status',
  Boolean(gemini && ['ok', 'ko', 'absent', 'standby', 'unknown'].includes(gemini.status)),
  gemini ?? providers
)

const orchestrationEvents = await evaluate(`new Promise(async (resolve) => {
  const seen = []
  const stop = window.api.onAppEvent((event) => seen.push(event.type))
  await window.api.emitIsolatedTestAppEvent({ type: 'orchestrate-start', convId: '${fixture.id}', task: 'preuve' })
  await window.api.emitIsolatedTestAppEvent({ type: 'orchestrate-step', convId: '${fixture.id}', step: { step: 'exec', text: 'étape directe', status: 'completed' } })
  await new Promise((done) => setTimeout(done, 80))
  const visibleBeforeEnd = document.body.textContent?.includes('étape directe') ?? false
  await window.api.emitIsolatedTestAppEvent({ type: 'orchestrate-end', convId: '${fixture.id}', status: 'green' })
  setTimeout(() => { stop(); resolve({ seen, visibleBeforeEnd }) }, 80)
})`)
check(
  '03-direct-steps-live',
  orchestrationEvents.visibleBeforeEnd &&
    orchestrationEvents.seen.join('>') === 'orchestrate-start>orchestrate-step>orchestrate-end',
  orchestrationEvents
)

const toolGate = await evaluate(`(async () => {
  const before = await window.api.capabilityControls('tools')
  const navigate = before.find((item) => item.id === 'navigate' || item.name === 'navigate')
  const previous = navigate?.enabled !== false
  const events = []
  const stop = window.api.onAppEvent((event) => events.push(event))
  await window.api.setCapabilityTool('navigate', false)
  const result = await window.api.appCommand('navigate', { tab: 'settings' })
  await window.api.setCapabilityTool('navigate', previous)
  stop()
  return { result, events, previous, navigate }
})()`)
check(
  '04-disabled-tool-fail-closed',
  toolGate.result?.ok === false && !toolGate.events.some((event) => event.type === 'navigate'),
  toolGate
)

const skills = await evaluate(`Promise.all([
  window.api.skills(), window.api.capabilityControls('skills'), window.api.behaviourComposition()
])`)
check(
  '05-skill-registry-runtime-source',
  Array.isArray(skills[0]) && Array.isArray(skills[1]) && skills[2]?.orchestrated?.systemPrompt,
  { registry: skills[0].length, controls: skills[1].length, composed: Boolean(skills[2]) }
)

const activity = await evaluate(`window.api.conversationActivity('${fixture.id}')`)
check('06-conversation-activity-filter', activity.length > 0, { count: activity.length })

const installedFabric = await evaluate('window.api.installIsolatedFabricFixture()')
const fabric = await evaluate('window.api.fabricNodes()')
const fabricModels = await evaluate('window.api.models()')
const fabricChat = await evaluate('window.api.sendIsolatedFabricFixture(false)')
const fabricExecution = await rejected('window.api.sendIsolatedFabricFixture(true)')
const missingFabric = await rejected("window.api.refreshFabricNode('wire-missing-node')")
const fabricNode = fabric.find((node) => node.nodeId === 'wire-node')
check(
  '07-fabric-product-positive-and-fail-closed',
  installedFabric?.model?.id === 'fabric/wire-node/wire-resource' &&
    fabricNode?.trust === 'paired' &&
    fabricNode?.availability === 'online' &&
    fabricNode?.resources?.some((resource) => resource.modes?.includes('local-tools')) &&
    fabricModels.some((model) => model.id === 'fabric/wire-node/wire-resource') &&
    fabricChat?.text === 'fixture-ok' &&
    fabricChat?.provider === 'fabric:wire-node:wire-resource' &&
    fabricExecution.rejected &&
    missingFabric.rejected,
  {
    installed: installedFabric,
    node: fabricNode,
    catalogued: fabricModels.some((model) => model.id === 'fabric/wire-node/wire-resource'),
    positive: fabricChat,
    executionNegative: fabricExecution,
    missingNegative: missingFabric
  }
)

const sessions = await evaluate('window.api.activitySessions()')
const outsideImage = await rejected(
  "window.api.activityImage({ id: 'forged', project: 'forged' }, 'C:/Windows/System32/secret.png')"
)
check('08-transcript-image-preload-bounds', Array.isArray(sessions) && outsideImage.rejected, {
  sessions: sessions.length,
  negative: outsideImage
})

const plugins = await evaluate("window.api.capabilityControls('plugins')")
check('09-plugins-registry-view', Array.isArray(plugins), { count: plugins.length })

const initialBehaviour = await evaluate('window.api.behaviourComposition()')
const behaviourWorkspace = await evaluate('window.api.installIsolatedBehaviourFixture()')
const behaviour = await evaluate(
  'window.api.behaviourComposition(' + JSON.stringify(behaviourWorkspace) + ')'
)
const outsideWorkspace = await rejected("window.api.behaviourComposition('C:/Windows/System32')")
check(
  '10-behaviour-approved-workspace',
  behaviour?.inspection?.workspace === behaviourWorkspace &&
    behaviour?.inspection?.files?.some(
      (file) =>
        file.label === 'AGENTS.md' && file.excerpt?.includes('INSTRUCTION_WORKSPACE_WIRE_ACTIVE')
    ) &&
    !initialBehaviour?.inspection?.files?.some((file) =>
      file.excerpt?.includes('INSTRUCTION_WORKSPACE_WIRE_ACTIVE')
    ) &&
    outsideWorkspace.rejected,
  {
    workspace: behaviour?.inspection?.workspace,
    files: behaviour?.inspection?.files,
    negative: outsideWorkspace
  }
)

const checkpoints = await evaluate('window.api.checkpointForks()')
const sourceBefore = readFileSync(join(runStateRoot, `${checkpoint.runId}.json`), 'utf8')
const fork = await evaluate(
  `window.api.createCheckpointFork('wire-proof-source', 'wire-proof-branch')`
)
const checkpointsAfterFork = await evaluate('window.api.checkpointForks()')
const persistedBranch = checkpointsAfterFork.find((item) => item.id === 'wire-proof-branch')
const sourceAfter = readFileSync(join(runStateRoot, `${checkpoint.runId}.json`), 'utf8')
check(
  '11-persistent-checkpoint-fork',
  checkpoints.some((item) => item.id === checkpoint.runId) &&
    persistedBranch?.state?.forkedFrom?.runId === checkpoint.runId &&
    persistedBranch?.state?.turnId === undefined &&
    fork?.ancestor?.runId === checkpoint.runId &&
    sourceBefore === sourceAfter,
  {
    checkpoints: checkpoints.length,
    checkpointsAfterFork: checkpointsAfterFork.length,
    branchTurnId: persistedBranch?.state?.turnId ?? null,
    forkedFrom: persistedBranch?.state?.forkedFrom,
    ancestor: fork?.ancestor,
    sourceUnchanged: sourceBefore === sourceAfter
  }
)

const shadow = await evaluate(
  "window.api.shadowRouteRecommendation('orchestrator', { provider: 'codex', model: 'gpt-5' })"
)
check(
  '12-shadow-route-explainable-readonly',
  ['recommendation', 'insufficient-data'].includes(shadow?.status) &&
    !('applied' in shadow) &&
    (shadow.status === 'insufficient-data' || typeof shadow.explanation === 'string'),
  shadow
)

await evaluate(`(() => {
  const target = [...document.querySelectorAll('button')].find((button) =>
    /observatory|observatoire/i.test(button.textContent ?? '')
  )
  target?.click()
})()`)
await evaluate('window.api.recheckPreflight(true).catch(() => null)')
await new Promise((resolve) => setTimeout(resolve, 250))
let wizardSeen = false
let consecutiveWizardFreeReads = 0
for (let attempt = 0; attempt < 60; attempt += 1) {
  const wizard = await evaluate(`(() => {
    const overlay = document.querySelector('.frw-overlay')
    if (!overlay) return { seen: false }
    const action = [...overlay.querySelectorAll('.frw-actions button')].find((button) =>
      /continuer quand même|terminer/i.test(button.textContent ?? '')
    )
    action?.click()
    return { seen: true, clicked: Boolean(action) }
  })()`)
  wizardSeen ||= wizard.seen
  consecutiveWizardFreeReads = wizard.seen ? 0 : consecutiveWizardFreeReads + 1
  if (consecutiveWizardFreeReads >= 8 && (wizardSeen || attempt >= 20)) break
  await new Promise((resolve) => setTimeout(resolve, 100))
}
await new Promise((resolve) => setTimeout(resolve, 400))
const blockingDialogs = await evaluate(
  "[...document.querySelectorAll('.frw-overlay, [role=dialog][aria-modal=true]')].map((item) => item.className)"
)
await new Promise((resolve) => setTimeout(resolve, 300))
const blockingDialogsStable = await evaluate(
  "[...document.querySelectorAll('.frw-overlay, [role=dialog][aria-modal=true]')].map((item) => item.className)"
)
check('ui-no-blocking-dialog', blockingDialogs.length === 0 && blockingDialogsStable.length === 0, {
  wizardSeen,
  consecutiveWizardFreeReads,
  first: blockingDialogs,
  stable: blockingDialogsStable
})

// Une première capture force la recomposition d'une fenêtre Electron cachée. Elle est jetée :
// la seconde doit refléter le DOM validé, et non la surface antérieure au retrait du wizard.
await evaluate('window.api.captureTestPage()')
await new Promise((resolve) => setTimeout(resolve, 500))
const screenshot = await evaluate('window.api.captureTestPage()')
const blockingDialogsAfterCapture = await evaluate(
  "[...document.querySelectorAll('.frw-overlay, [role=dialog][aria-modal=true]')].map((item) => item.className)"
)
check(
  'ui-stable-after-capture',
  blockingDialogsAfterCapture.length === 0,
  blockingDialogsAfterCapture
)
check('runtime-no-errors', runtimeErrors.length === 0, runtimeErrors)
mkdirSync(dirname(output), { recursive: true })
writeFileSync(screenshotOutput, Buffer.from(screenshot, 'base64'))
const passed = checks.every((item) => item.ok)
writeProofReport({ passed, screenshot: screenshotOutput })
console.log(
  JSON.stringify({
    output,
    screenshot: screenshotOutput,
    passed,
    checks: checks.length
  })
)
socket.close()
