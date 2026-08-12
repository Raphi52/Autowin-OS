import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const port = process.env.AUTOWIN_CDP_PORT || '9223'
const artifactRoot = 'C:/Amitel/Autowin OS/artifacts/dogfood-one-prompt'
const registryPath = process.env.AUTOWIN_DOGFOOD_REGISTRY || `${artifactRoot}/campaign.json`
const mode = process.argv[2] ?? 'run'
const campaignId = process.env.AUTOWIN_DOGFOOD_ID || `dogfood-${Date.now()}`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const allViews = [
  ['chat', 'Chat'],
  ['agent-studio', 'Agent Studio'],
  ['knowledge', 'Knowledge'],
  ['observatory', 'Observatory'],
  ['task-manager', 'Task Manager'],
  ['worktrees', 'Worktrees'],
  ['tickets', 'Tickets'],
  ['settings', 'Settings']
]
// Le slug historique de ce script diverge du catalogue de l'application : `APP_DESTINATIONS`
// (src/shared/navigation.ts) déclare `worktree` au singulier. Demander la vue par son vrai nom
// échouait donc en « Vue(s) dogfood inconnue(s) ». On accepte les deux plutôt que de renommer,
// pour ne pas invalider les registres de campagne déjà écrits sur disque.
const VIEW_ALIASES = { worktree: 'worktrees' }
const canonicalView = (value) => VIEW_ALIASES[value] ?? value
const requestedViews = new Set(
  (process.env.AUTOWIN_DOGFOOD_VIEWS || '')
    .split(',')
    .map((value) => canonicalView(value.trim()))
    .filter(Boolean)
)
const views = requestedViews.size ? allViews.filter(([slug]) => requestedViews.has(slug)) : allViews
if (requestedViews.size && views.length !== requestedViews.size) {
  const known = new Set(allViews.map(([slug]) => slug))
  const unknown = [...requestedViews].filter((slug) => !known.has(slug))
  throw new Error(`Vue(s) dogfood inconnue(s): ${unknown.join(', ')}`)
}

mkdirSync(artifactRoot, { recursive: true })

const discoverTargets = async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json`, {
      signal: AbortSignal.timeout(3_000)
    })
    return await response.json()
  } catch {
    const activePort = readFileSync(
      'C:/Amitel/Autowin OS/.autowin-data/autowin-os/DevToolsActivePort',
      'utf8'
    )
      .trim()
      .split(/\r?\n/)
    const browserSocket = new WebSocket(`ws://127.0.0.1:${activePort[0]}${activePort[1]}`)
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
      webSocketDebuggerUrl: `ws://127.0.0.1:${activePort[0]}/devtools/page/${target.targetId}`
    }))
  }
}

const targets = await discoverTargets()
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error(`Fenêtre Autowin introuvable via CDP sur ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const rendererEvents = []
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data)
  const callback = pending.get(message.id)
  if (callback) {
    pending.delete(message.id)
    message.error
      ? callback.reject(new Error(message.error.message))
      : callback.resolve(message.result)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    rendererEvents.push({
      ts: new Date().toISOString(),
      type: 'exception',
      text: message.params?.exceptionDetails?.text ?? 'Renderer exception'
    })
  }
  if (message.method === 'Log.entryAdded') {
    const entry = message.params?.entry
    if (entry?.level === 'error' || entry?.level === 'warning') {
      rendererEvents.push({
        ts: new Date().toISOString(),
        type: entry.level,
        text: entry.text,
        source: entry.source
      })
    }
  }
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

await send('Runtime.enable')
await send('Log.enable')

const save = (campaign) => {
  campaign.updatedAt = new Date().toISOString()
  campaign.rendererEvents = rendererEvents.slice(-200)
  campaign.cost = campaign.entries.reduce(
    (total, entry) => ({
      knownUsd: total.knownUsd + (entry.telemetry?.cost?.knownUsd ?? 0),
      calls: total.calls + (entry.telemetry?.cost?.calls ?? 0),
      unpricedCalls: total.unpricedCalls + (entry.telemetry?.cost?.unpricedCalls ?? 0),
      inputTokens: total.inputTokens + (entry.telemetry?.cost?.inputTokens ?? 0),
      outputTokens: total.outputTokens + (entry.telemetry?.cost?.outputTokens ?? 0)
    }),
    { knownUsd: 0, calls: 0, unpricedCalls: 0, inputTokens: 0, outputTokens: 0 }
  )
  writeFileSync(registryPath, JSON.stringify(campaign, null, 2), 'utf8')
}

const screenshot = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const path = `${artifactRoot}/${name}.png`
  writeFileSync(path, Buffer.from(result.data, 'base64'))
  return path
}

const clickChat = async () => {
  const clicked = await evaluate(`(() => {
    const button = document.querySelector('[data-testid="nav-chat"]')
    button?.click()
    return Boolean(button)
  })()`)
  if (!clicked) throw new Error('Navigation Chat introuvable')
  await sleep(250)
}

const setInput = async (selector, value) =>
  evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!input) return false
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)

const selectConversation = async (title) => {
  await clickChat()
  const searchSelector = 'input[placeholder*="Rechercher"]'
  if (!(await setInput(searchSelector, title)))
    throw new Error('Recherche de conversations absente')
  await sleep(300)
  const clicked = await evaluate(`(() => {
    const item = [...document.querySelectorAll('.conv-item')].find(
      (candidate) => candidate.querySelector('.conv-label')?.textContent?.trim() === ${JSON.stringify(title)}
    )
    item?.querySelector('.conv-pick')?.click()
    return Boolean(item)
  })()`)
  await setInput(searchSelector, '')
  if (!clicked) throw new Error(`Conversation UI introuvable: ${title}`)
  await sleep(350)
}

const typeAndSend = async (prompt) => {
  if (!(await setInput('.composer textarea', prompt))) throw new Error('Composer absent')
  await sleep(100)
  // Sur une app fraîchement démarrée, « Nouveau » ne crée PAS encore la conversation : elle
  // n'existe qu'à la persistance du premier message, donc `activeConversationId` est nul et exiger
  // sa présence ici rendait la campagne INDÉMARRABLE (« Conversation active absente avant envoi »,
  // mesuré le 2026-08-12 sur une app relancée). Le harnais ne fonctionnait qu'en héritant d'une
  // conversation déjà ouverte par un usage antérieur. On envoie donc sans exiger l'identifiant ;
  // sa création est vérifiée juste après, par la sentinelle, qui est la vraie preuve.
  const targetConversationId = await evaluate(
    `window.api.appState().then((state) => state.activeConversationId ?? null)`
  )
  const clicked = await evaluate(`(() => {
    const button = document.querySelector('.composer .composer-send:not(:disabled)')
    button?.click()
    return Boolean(button)
  })()`)
  if (!clicked) throw new Error('Bouton Envoyer indisponible')
  // Sans conversation préexistante, l'acceptation se prouve par l'apparition de la conversation
  // portant la sentinelle — c'est le rôle de l'appelant. Attendre ici sur un id nul bouclerait 10 s
  // pour rien à chaque envoi.
  if (!targetConversationId) return
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await sleep(100)
    const accepted = await evaluate(`(async () => {
      const conversation = await window.api.conversation(${JSON.stringify(targetConversationId)})
      const persisted = conversation?.messages?.some(
        (message) => message.role === 'user' && message.content === ${JSON.stringify(prompt)}
      ) ?? false
      if (persisted) return 'persisted'
      const state = await window.api.appState()
      const queued = state.activeConversationId === ${JSON.stringify(targetConversationId)} &&
        [...document.querySelectorAll('.directive-queue-text')].some(
          (item) => item.textContent?.trim() === ${JSON.stringify(prompt)}
        )
      return queued ? 'queued' : null
    })()`)
    if (accepted) return
  }
  throw new Error(`Message ni persisté ni mis en file dans ${targetConversationId}`)
}

const startConversation = async (prompt, sentinel) => {
  await clickChat()
  const previousId = await evaluate(
    `window.api.appState().then((state) => state.activeConversationId ?? null)`
  )
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === 'Nouveau'
    )
    button?.click()
    return Boolean(button)
  })()`)
  if (!clicked) throw new Error('Bouton Nouveau introuvable')
  await sleep(250)
  await typeAndSend(prompt)
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(250)
    const result = await evaluate(`(async () => {
      const state = await window.api.appState()
      if (!state.activeConversationId || state.activeConversationId === ${JSON.stringify(previousId)}) return null
      const conversation = await window.api.conversation(state.activeConversationId)
      return conversation?.messages?.some(
        (message) => message.role === 'user' && message.content?.includes(${JSON.stringify(sentinel)})
      ) ? { id: conversation.id, title: conversation.title } : null
    })()`)
    if (result) return result
  }
  throw new Error(`Conversation non créée pour ${sentinel}`)
}

const conversationTelemetry = async (entry) =>
  evaluate(`(async () => {
    const id = ${JSON.stringify(entry.conversationId)}
    const [conversation, calls, traces, runs, activity, costByModel] = await Promise.all([
      window.api.conversation(id),
      window.api.promptCalls(id),
      window.api.causalTrace(id),
      window.api.conversationRuns(id),
      window.api.conversationActivity(id),
      window.api.costBreakdown('model', id)
    ])
    const messages = conversation?.messages ?? []
    const last = messages.at(-1)
    const callsFailed = calls.filter((call) => call.status === 'failed')
    const actionFailures = activity.filter((item) => item.ok === false || item.status === 'failed')
    return {
      title: conversation?.title ?? null,
      messageCount: messages.length,
      lastRole: last?.role ?? null,
      lastStatus: last?.status ?? null,
      lastError: last?.error ?? null,
      lastText: last?.content?.slice(0, 500) ?? null,
      calls: calls.length,
      callsFailed: callsFailed.length,
      lastCallStatus: calls.at(-1)?.status ?? null,
      lastProvider: calls.at(-1)?.provider ?? null,
      lastModel: calls.at(-1)?.model ?? null,
      traces: traces.length,
      traceKinds: [...new Set(traces.slice(-50).map((trace) => trace.kind))],
      runs: runs.map((run) => ({ path: run.path, status: run.summary.status, defects: run.summary.defauts })),
      activity: activity.length,
      actionFailures: actionFailures.length,
      cost: {
        knownUsd: costByModel.reduce((sum, row) => sum + row.costUsd, 0),
        calls: costByModel.reduce((sum, row) => sum + row.calls, 0),
        unpricedCalls: costByModel.reduce((sum, row) => sum + row.unpricedCalls, 0),
        inputTokens: costByModel.reduce((sum, row) => sum + row.inputTokens, 0),
        outputTokens: costByModel.reduce((sum, row) => sum + row.outputTokens, 0),
        byModel: costByModel.map((row) => ({
          model: row.key,
          calls: row.calls,
          knownUsd: row.costUsd,
          unpricedCalls: row.unpricedCalls,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens
        }))
      },
      recentFailures: actionFailures.slice(-5).map((item) => ({
        name: item.name ?? item.kind ?? null,
        status: item.status ?? null,
        error: item.error ?? item.output ?? null
      }))
    }
  })()`)

const isTurnFinished = (telemetry, minimumMessages) =>
  telemetry.messageCount >= minimumMessages &&
  telemetry.lastRole === 'assistant' &&
  ['completed', 'failed', 'cancelled', 'interrupted'].includes(telemetry.lastStatus)

let campaign
if (mode === 'stop-repair') {
  campaign = JSON.parse(readFileSync(registryPath, 'utf8'))
  await selectConversation(campaign.repair.title)
  const stopped = await evaluate(`(() => {
    const button = document.querySelector('[data-testid="composer-stop"]')
    button?.click()
    return Boolean(button)
  })()`)
  await sleep(750)
  campaign.repair.telemetry = await conversationTelemetry(campaign.repair)
  campaign.repair.stoppedAt = new Date().toISOString()
  save(campaign)
  console.log(
    JSON.stringify({ event: 'repair-stop', stopped, telemetry: campaign.repair.telemetry })
  )
  socket.close()
  process.exit(stopped ? 0 : 1)
}

if (mode === 'repair-followup') {
  campaign = JSON.parse(readFileSync(registryPath, 'utf8'))
  await selectConversation(campaign.repair.title)
  const prompt =
    `Le tour précédent a figé après l'échec du premier orchestrate. N'utilise plus orchestrate pour ` +
    `amorcer ce correctif : il dépend précisément du composant cassé. Utilise la voie locale la plus ` +
    `étroite disponible pour corriger uniquement beginAsync dans run-worktree-coordinator.ts et son test. ` +
    `La séquence attendue est : describeAsync → construire le context → Object.assign(tracked, context) → ` +
    `persist → prepareAsync. Aujourd'hui persist arrive avant describeAsync et sérialise trois chaînes vides. ` +
    `Ne relâche pas isRecord. Si edit_file retombe sur le même gate, prouve explicitement que l'auto-réparation ` +
    `est circulaire au lieu de rester streaming.`
  await typeAndSend(prompt)
  campaign.repair.followupPrompt = prompt
  campaign.repair.followupSentAt = new Date().toISOString()
  save(campaign)
  console.log(JSON.stringify({ event: 'repair-followup-sent' }))
  socket.close()
  process.exit(0)
}

if (mode === 'repair') {
  campaign = JSON.parse(readFileSync(registryPath, 'utf8'))
  const sentinel = `${campaign.id}-repair-worktree-manifest`
  const prompt =
    `[${sentinel}] Corrige de bout en bout le défaut d'infrastructure qui vient de faire échouer les huit ` +
    `chantiers dogfood : chaque orchestrate termine par « Manifeste de bureau invalide: run-... » avant ` +
    `toute modification. Les traces pointent WorktreeRunStateStore.save et RunWorktreeCoordinator.persist. ` +
    `Reproduis le défaut avec un test rouge, localise le champ invalide réel, corrige sans contourner la ` +
    `validation, rejoue les tests ciblés, puis prouve la réparation avec un vrai orchestrate lancé depuis ` +
    `l'application. Ne t'arrête pas à un diagnostic et ne déclare rien réussi sans runId et preuve hors modèle.`
  const started = await startConversation(prompt, sentinel)
  campaign.repair = {
    label: 'Infrastructure worktree manifest',
    sentinel,
    conversationId: started.id,
    title: started.title,
    prompt,
    sentAt: new Date().toISOString(),
    telemetry: null
  }
  save(campaign)
  console.log(JSON.stringify({ event: 'repair-launched', ...started }))
  socket.close()
  process.exit(0)
}

if (mode === 'run') {
  campaign = {
    id: campaignId,
    createdAt: new Date().toISOString(),
    phase: 'scout',
    views: views.map(([slug]) => slug),
    entries: [],
    observations: [],
    rendererEvents: []
  }
  for (const [slug, label] of views) {
    const sentinel = `${campaign.id}-${slug}`
    const prompt =
      `[${sentinel}] scout des améliorations de la vue ${label}. ` +
      `Inspecte la vue réellement branchée, ses parcours de bout en bout, ses états vides/chargement/erreur ` +
      `et tout ce qui empêche Autowin d'atteindre « 1 prompt = 1 réussite ». ` +
      `Retourne des chantiers concrets, priorisés et vérifiables. N'implémente rien à ce tour.`
    const started = await startConversation(prompt, sentinel)
    const entry = {
      slug,
      label,
      sentinel,
      conversationId: started.id,
      title: started.title,
      scoutPrompt: prompt,
      scoutSentAt: new Date().toISOString(),
      followupSentAt: null,
      completedAt: null,
      telemetry: null
    }
    campaign.entries.push(entry)
    save(campaign)
    console.log(JSON.stringify({ event: 'scout-launched', label, ...started }))
    await sleep(1_000)
  }
  await screenshot(`${campaign.id}-scouts-launched`)
} else {
  campaign = JSON.parse(readFileSync(registryPath, 'utf8'))
}

if (mode === 'repair-status') {
  campaign.repair.telemetry = await conversationTelemetry(campaign.repair)
  save(campaign)
  console.log(JSON.stringify(campaign.repair, null, 2))
  socket.close()
  process.exit(0)
}

if (mode !== 'status') {
  const deadline = Date.now() + Number(process.env.AUTOWIN_DOGFOOD_MAX_MS || 14_400_000)
  let lastSummary = ''
  while (Date.now() < deadline) {
    let finished = 0
    for (const entry of campaign.entries) {
      const telemetry = await conversationTelemetry(entry)
      entry.telemetry = telemetry
      if (!entry.followupSentAt && isTurnFinished(telemetry, 2)) {
        if (telemetry.lastStatus === 'completed') {
          await selectConversation(entry.title)
          const followup =
            `Fais tout. Mène les chantiers retenus pour la vue ${entry.label} de bout en bout. ` +
            `Utilise l'application réelle, vérifie chaque résultat, corrige les régressions et surveille les traces, ` +
            `les sous-agents, les runs et les erreurs. Ne déclare pas réussi ce qui n'a pas une preuve hors modèle.`
          await typeAndSend(followup)
          entry.followupSentAt = new Date().toISOString()
          entry.followupPrompt = followup
          console.log(JSON.stringify({ event: 'followup-launched', label: entry.label }))
        } else {
          entry.completedAt = entry.completedAt ?? new Date().toISOString()
          entry.outcome = `scout-${telemetry.lastStatus}`
        }
      } else if (entry.followupSentAt && !entry.completedAt && isTurnFinished(telemetry, 4)) {
        entry.completedAt = new Date().toISOString()
        entry.outcome = telemetry.lastStatus
      }
      if (entry.completedAt) finished += 1
    }

    const summary = campaign.entries
      .map(
        (entry) =>
          `${entry.label}:${entry.completedAt ? entry.outcome : entry.followupSentAt ? 'build' : 'scout'}`
      )
      .join('|')
    if (summary !== lastSummary) {
      campaign.observations.push({ ts: new Date().toISOString(), summary })
      console.log(
        JSON.stringify({ event: 'status', finished, total: campaign.entries.length, summary })
      )
      lastSummary = summary
    }
    save(campaign)
    if (finished === campaign.entries.length) {
      campaign.phase = 'completed'
      await screenshot(`${campaign.id}-completed`)
      save(campaign)
      break
    }
    await sleep(5_000)
  }
  if (campaign.phase !== 'completed') campaign.phase = 'monitoring-timeout'
}

for (const entry of campaign.entries) entry.telemetry = await conversationTelemetry(entry)
save(campaign)
console.log(JSON.stringify(campaign, null, 2))
socket.close()
