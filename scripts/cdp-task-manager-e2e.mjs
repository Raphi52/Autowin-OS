import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, normalize, resolve } from 'node:path'

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const port = Number(argument('--port', '9240'))
const instanceRoot = resolve(
  argument('--instance-root', 'Audit/headless-instances/task-manager-e2e')
)
const executable = resolve(argument('--exe', 'dist/win-unpacked/autowin-os.exe'))
const outputDir = resolve(argument('--out-dir', join(instanceRoot, 'proof')))
const runId = `TASK-E2E-${Date.now()}`
const capturedAt = new Date(Date.now() - 100).toISOString()
const sentinel = `sentinel-${runId}`
const screenshotPath = join(outputDir, `${runId}.png`)
const proofPath = join(outputDir, `${runId}.json`)
const taskName = `Task ${runId}`
const canonicalStoreRoot = join(instanceRoot, 'user-data', 'app-data', 'autowin-os')
const relayIdentity = normalize(canonicalStoreRoot).replaceAll('\\', '/').toLowerCase()
const relayTaskSuffix = createHash('sha256')
  .update(relayIdentity, 'utf8')
  .digest('hex')
  .slice(0, 16)
const relayTaskName = `Autowin OS - Prompt Relay - ${relayTaskSuffix}`
mkdirSync(outputDir, { recursive: true })

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

async function pages() {
  try {
    return await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  } catch {
    return []
  }
}

async function waitForPage(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const page = (await pages()).find((candidate) => candidate.type === 'page')
    if (page) return page
    await sleep(100)
  }
  throw new Error(`Aucune page CDP sur ${port}`)
}

async function connect() {
  const page = await waitForPage()
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolveOpen, reject) => {
    socket.onopen = resolveOpen
    socket.onerror = reject
  })
  let sequence = 0
  const pending = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id)
    message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result)
  }
  const send = (method, params = {}) =>
    new Promise((resolveCall, reject) => {
      const id = ++sequence
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Délai CDP dépassé: ${method}`))
      }, 20_000)
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout)
          resolveCall(value)
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
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) {
      throw new Error(`Erreur renderer: ${JSON.stringify(result.exceptionDetails).slice(0, 600)}`)
    }
    return result.result?.value
  }
  return { socket, send, evaluate }
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await check()
    if (latest) return latest
    await sleep(200)
  }
  throw new Error(`${label} non observé dans le délai (${JSON.stringify(latest)})`)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}

function latestMtime(root) {
  let latest = 0
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'out', 'Audit'].includes(entry.name)) continue
      const child = join(path, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile()) latest = Math.max(latest, statSync(child).mtimeMs)
    }
  }
  visit(join(root, 'src'))
  visit(join(root, 'resources'))
  for (const file of ['package.json', 'electron.vite.config.ts', 'electron-builder.yml']) {
    latest = Math.max(latest, statSync(join(root, file)).mtimeMs)
  }
  return latest
}

function relaySettings() {
  const script = [
    `$task=Get-ScheduledTask -TaskName ${JSON.stringify(relayTaskName)} -ErrorAction Stop`,
    `[ordered]@{wakeToRun=[bool]$task.Settings.WakeToRun;startWhenAvailable=[bool]$task.Settings.StartWhenAvailable;multipleInstances=[string]$task.Settings.MultipleInstances;arguments=[string]$task.Actions[0].Arguments}|ConvertTo-Json -Compress`
  ].join(';')
  return JSON.parse(
    execFileSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    ).trim()
  )
}

const initial = await connect()
try {
  await initial.evaluate(`(() => {
    document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()
    document.querySelector('[data-testid="nav-task-manager"]')?.click()
    return true
  })()`)
  await waitFor(
    () =>
      initial.evaluate(
        `(() => {
          const button = [...document.querySelectorAll('[data-testid="task-manager-view"] button')]
            .find((candidate) => candidate.textContent?.includes('Nouvelle tâche'))
          return Boolean(button && !button.disabled)
        })()`
      ),
    10_000,
    'vue Task Manager'
  )
  await initial.evaluate(`(() => {
    const button = [...document.querySelectorAll('[data-testid="task-manager-view"] button')]
      .find((candidate) => candidate.textContent?.includes('Nouvelle tâche'))
    button?.click()
    return Boolean(button)
  })()`)

  // Marge suffisante pour relire Task Scheduler AVANT que l'occurrence one-shot ne se termine
  // et que le scheduler désarme légitimement le relais.
  const due = new Date(Date.now() + 90_000)
  const date = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(
    due.getDate()
  ).padStart(2, '0')}`
  const time = `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(
    2,
    '0'
  )}`
  const prompt = `[[autowin-fixture-durable-stream]] ${sentinel}`

  const formFilled = await initial.evaluate(`(() => {
    const root = document.querySelector('[data-testid="task-manager-view"]')
    const setInput = (selector, value) => {
      const element = root?.querySelector(selector)
      if (!element) return false
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
      return true
    }
    return {
      title: setInput('input[name="title"]', ${JSON.stringify(taskName)}),
      prompt: setInput('textarea[name="prompt"]', ${JSON.stringify(prompt)}),
      mode: setInput('select', 'windows'),
      date: setInput('input[type="date"]', ${JSON.stringify(date)}),
      time: setInput('input[type="time"]', ${JSON.stringify(time)})
    }
  })()`)
  if (Object.values(formFilled).some((value) => value !== true)) {
    throw new Error(`Formulaire Task Manager incomplet: ${JSON.stringify(formFilled)}`)
  }
  await initial.evaluate(`(() => {
    const button = [...document.querySelectorAll('[data-testid="task-manager-view"] button')]
      .find((candidate) => candidate.textContent === 'Créer la tâche')
    button?.click()
    return Boolean(button)
  })()`)

  const created = await waitFor(
    () =>
      initial.evaluate(`(async () => {
        const snapshot = await window.api.taskManagerSnapshot()
        const task = snapshot.tasks.find((candidate) => candidate.title === ${JSON.stringify(taskName)})
        return task ? { task, relayAvailable: snapshot.scheduler.relayAvailable } : null
      })()`),
    20_000,
    'création de la tâche'
  )
  if (!created.relayAvailable) throw new Error('Relais Windows non disponible après création')
  const relay = await waitFor(
    async () => {
      try {
        return relaySettings()
      } catch {
        return null
      }
    },
    20_000,
    'enregistrement du relais Windows'
  )
  if (
    !relay.arguments.includes(`--remote-debugging-port=${port}`) ||
    !relay.arguments.includes(`--user-data-dir=${join(instanceRoot, 'user-data')}`) ||
    relay.arguments.includes(`"--remote-debugging-port=${port} --user-data-dir=`)
  ) {
    throw new Error(`Arguments techniques du relais fusionnés ou incomplets: ${relay.arguments}`)
  }

  const completed = await waitFor(
    () =>
      initial.evaluate(`(async () => {
        const snapshot = await window.api.taskManagerSnapshot()
        const task = snapshot.tasks.find((candidate) => candidate.id === ${JSON.stringify(created.task.id)})
        const occurrence = snapshot.occurrences.find((candidate) =>
          candidate.taskId === ${JSON.stringify(created.task.id)} && candidate.status === 'completed')
        return occurrence ? { task, occurrence } : null
      })()`),
    120_000,
    'occurrence planifiée terminée'
  )

  const taskStorePath = join(canonicalStoreRoot, 'scheduled-tasks.json')
  const conversationStorePath = join(canonicalStoreRoot, 'conversations.json')
  const taskStore = readJson(taskStorePath)
  const conversations = readJson(conversationStorePath)
  const conversation = conversations.find(
    (candidate) => candidate.id === completed.occurrence.conversationId
  )
  if (!conversation) throw new Error('Conversation dédiée absente du store')
  const persistedUsers = conversation.messages.filter(
    (message) => message.role === 'user' && message.content.includes(sentinel)
  )
  const persistedAssistants = conversation.messages.filter(
    (message) =>
      message.role === 'assistant' &&
      message.turnId === completed.occurrence.turnId &&
      ['completed', 'failed', 'cancelled'].includes(message.status)
  )
  const actionCount = persistedAssistants
    .flatMap((message) => message.parts ?? [])
    .filter((part) => part.kind === 'action').length
  const occurrenceMatches = taskStore.occurrences.filter(
    (candidate) => candidate.id === completed.occurrence.id
  )

  await initial.evaluate(`(() => {
    document.querySelector('[data-testid="nav-chat"]')?.click()
    return true
  })()`)
  await waitFor(
    () =>
      initial.evaluate(`(() => {
        const labels = [...document.querySelectorAll('.conv-item')]
        const target = labels.find((item) => item.querySelector('.conv-label')?.textContent === ${JSON.stringify(conversation.title)})
        if (target && !target.classList.contains('active')) target.querySelector('.conv-pick')?.click()
        const users = [...document.querySelectorAll('.msg.user .msg-body')]
          .filter((message) => message.textContent?.includes(${JSON.stringify(sentinel)})).length
        const assistants = [...document.querySelectorAll('.msg.assistant')]
          .filter((message) => message.textContent?.includes('progressivement')).length
        return users === 1 && assistants === 1 ? true : null
      })()`),
    15_000,
    'tour Chat visible avant fermeture'
  )
  await sleep(500)
  const visibleScreenshot = await initial.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(screenshotPath, Buffer.from(visibleScreenshot.data, 'base64'))

  await initial.evaluate('window.close()')
  initial.socket.close()
  await waitFor(
    async () => ((await pages()).some((candidate) => candidate.type === 'page') ? null : true),
    10_000,
    'fermeture renderer'
  )

  const instanceState = readJson(join(instanceRoot, 'instance.json'))
  let processSurvivedWindowClose = true
  try {
    process.kill(instanceState.pid, 0)
  } catch {
    processSurvivedWindowClose = false
  }
  if (!processSurvivedWindowClose)
    throw new Error('Le process principal est mort après window.close()')

  const child = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${join(instanceRoot, 'user-data')}`,
      '--isolated-test-instance',
      '--headless-test-instance'
    ],
    { detached: true, stdio: 'ignore', windowsHide: true }
  )
  child.unref()

  const reopened = await connect()
  await reopened.evaluate(`(() => {
    document.querySelector('[data-testid="nav-chat"]')?.click()
    return true
  })()`)
  const wizardDeadline = Date.now() + 8_000
  while (Date.now() < wizardDeadline) {
    await reopened.evaluate(
      `document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()`
    )
    await sleep(250)
  }
  await waitFor(
    () => reopened.evaluate(`!document.querySelector('[data-testid="first-run-wizard"]')`),
    10_000,
    'fermeture de l’assistant de démarrage'
  )
  const rendered = await waitFor(
    () =>
      reopened.evaluate(`(() => {
        const labels = [...document.querySelectorAll('.conv-item')]
        const target = labels.find((item) => item.querySelector('.conv-label')?.textContent === ${JSON.stringify(conversation.title)})
        if (target && !target.classList.contains('active')) target.querySelector('.conv-pick')?.click()
        const users = [...document.querySelectorAll('.msg.user .msg-body')]
          .filter((message) => message.textContent?.includes(${JSON.stringify(sentinel)})).length
        const assistants = [...document.querySelectorAll('.msg.assistant')]
          .filter((message) => message.textContent?.includes('progressivement')).length
        return users === 1 && assistants === 1 ? { users, assistants } : null
      })()`),
    15_000,
    'tour Chat restauré dans le DOM'
  )
  await sleep(500)
  reopened.socket.close()

  const packagePath = resolve('dist/win-unpacked/resources/app.asar')
  const packageFresh =
    existsSync(packagePath) && statSync(packagePath).mtimeMs >= latestMtime(resolve('.'))
  const proof = {
    runId,
    capturedAt,
    sentinel,
    occurrenceId: completed.occurrence.id,
    executableSha256: instanceState.executableSha256,
    packageFresh,
    relay: {
      wakeToRun: relay.wakeToRun,
      startWhenAvailable: relay.startWhenAvailable,
      multipleInstances: relay.multipleInstances
    },
    observed: {
      processSurvivedWindowClose,
      appRestartRoundTrip: true,
      persistedUserMessageCount: persistedUsers.length,
      persistedAssistantTurnCount: persistedAssistants.length,
      renderedUserMessageCount: rendered.users,
      renderedAssistantTurnCount: rendered.assistants,
      occurrenceClaimCount: occurrenceMatches.length,
      occurrenceExecutionCount: occurrenceMatches.filter(
        (candidate) => candidate.status === 'completed'
      ).length,
      assistantActionCount: actionCount,
      assistantStatus: persistedAssistants[0]?.status
    },
    artifacts: [basename(screenshotPath), basename(proofPath)]
  }
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ proofPath, screenshotPath, proof })}\n`)
} catch (error) {
  initial.socket.close()
  throw error
}
