import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { withDeviceMetricsOverride } from './cdp-device-metrics.mjs'

const root = 'C:\\Amitel\\Autowin OS'
const helper = join(root, 'scripts', 'autowin-headless.ps1')
const freshnessCheck = join(root, 'scripts', 'assert-ui-package-fresh.ps1')
const executable = join(root, 'dist', 'win-unpacked', 'autowin-os.exe')
const instanceId = 'perfect-memory-proof'
const port = 9267
const artifactsRoot = join(
  root,
  'Audit',
  'workspaces',
  '019f884e-ab2c-7932-aaed-e715595a4c11',
  'perfect-memory-system-workspace',
  'artifacts'
)
const screenshotPath = join(artifactsRoot, 'memory-live-proof.png')
const scoreScreenshotPath = join(artifactsRoot, 'memory-score-channels-proof.png')
const reportPath = join(artifactsRoot, 'memory-live-proof.json')
const fixtureRoot = join(root, 'Audit', 'headless-instances', instanceId, 'brain-fixture')
const fixtureKnowledge = join(fixtureRoot, 'knowledge', 'domain')
const baselineNotePath = join(fixtureKnowledge, 'memory-proof-baseline.md')
const dynamicNotePath = join(fixtureKnowledge, 'memory-refresh-dynamic-7f3a2c.md')
const indexedMirrorPath = join(
  fixtureRoot,
  'knowledge',
  'decisions',
  'amitel-brain-architecture.md'
)
const markerQuery = 'preuve memoire dynamique 7f3a2c'
const dynamicTitle = 'Preuve mémoire dynamique 7f3a2c'
const indexedQuery = 'architecture Amitel Brain'
const indexedTitle = 'Décision — Amitel Brain : cerveau collaboratif partagé'

const baselineNote = `---
type: domain
scope: autowin-os
themes: [theme/autowin-os]
---

# Socle de preuve Memory

Cette fiche fixe amorce le cache du vault isolé avant la mutation observée.
`

const dynamicNote = `---
type: domain
scope: autowin-os
themes: [theme/autowin-os]
related: knowledge/domain/memory-proof-baseline
---

# ${dynamicTitle}

Marqueur recherché : ${markerQuery}.

[[knowledge/domain/memory-proof-baseline]]
`

const indexedMirrorNote = `---
type: decision
scope: global
tags: [brain, rag, architecture]
---

# ${indexedTitle}

Architecture du cerveau Amitel Brain, miroir local de lecture pour la preuve des scores signés.
`

const control = (action) =>
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helper,
      '-Action',
      action,
      '-InstanceId',
      instanceId,
      '-Port',
      String(port),
      '-Executable',
      executable
    ],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, AMITEL_BRAIN_ROOT: fixtureRoot }
    }
  )

let socket
try {
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', freshnessCheck],
    { cwd: root, encoding: 'utf8', windowsHide: true }
  )
  try {
    control('Stop')
  } catch {
    // An absent prior proof instance is the normal case.
  }
  mkdirSync(fixtureKnowledge, { recursive: true })
  mkdirSync(dirname(indexedMirrorPath), { recursive: true })
  rmSync(dynamicNotePath, { force: true })
  writeFileSync(baselineNotePath, baselineNote, 'utf8')
  writeFileSync(indexedMirrorPath, indexedMirrorNote, 'utf8')
  control('Start')
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = pages.find((item) => item.type === 'page')
  if (!page) throw new Error('Page Electron introuvable')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let nextId = 0
  const pending = new Map()
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    const call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id)
    message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result)
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression, awaitPromise = false) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, timeout = 30000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Timeout: ${expression}`)
  }
  const setSearch = (query) =>
    evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Rechercher un thème ou une fiche"]')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(query)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
  const resultVisible = (title) =>
    `[...document.querySelectorAll('.node-search-result')].some(
      (item) => item.textContent?.includes(${JSON.stringify(title)})
    )`
  const clickRefresh = async () => {
    const clicked = await evaluate(`(() => {
      const button = document.querySelector('.graph-refresh')
      button?.click()
      return Boolean(button)
    })()`)
    if (!clicked) throw new Error('Bouton de rafraîchissement introuvable')
    await waitFor(`document.querySelector('.graph-refresh')?.disabled === false`, 45000)
  }
  const welcomeButtonVisible = `[...document.querySelectorAll('button')].some(
    (item) => item.textContent?.trim() === 'Continuer quand même'
  )`
  const dismissVisibleWelcome = async () => {
    if (!(await evaluate(welcomeButtonVisible))) return false
    const clicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(
        (item) => item.textContent?.trim() === 'Continuer quand même'
      )
      button?.click()
      return Boolean(button)
    })()`)
    if (!clicked)
      throw new Error('La modale de bienvenue était visible mais son bouton est introuvable')
    await waitFor(`!(${welcomeButtonVisible})`, 10000)
    return true
  }
  const settleWelcome = async (appearanceWindowMs = 20000) => {
    const deadline = Date.now() + appearanceWindowMs
    while (Date.now() < deadline) {
      if (await dismissVisibleWelcome()) return true
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    // Si aucune modale n'apparaît pendant toute la fenêtre, l'absence est stable plutôt que
    // déduite d'un contrôle instantané qui pourrait gagner la course contre le preflight.
    return false
  }

  await withDeviceMetricsOverride(
    send,
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    async () => {
      await waitFor(
        `document.readyState === 'complete' && document.body.innerText.includes('Knowledge')`
      )
      let welcomeModalDismissed = await settleWelcome()
      const navigated = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(
      (item) => item.textContent?.trim().includes('Knowledge')
    )
    button?.click()
    return Boolean(button)
  })()`)
      if (!navigated) throw new Error('Navigation Knowledge introuvable')
      await waitFor(`Boolean(document.querySelector('.graph-observatory select')?.value)`, 45000)
      welcomeModalDismissed = (await dismissVisibleWelcome()) || welcomeModalDismissed

      if (!(await setSearch(markerQuery))) throw new Error('Recherche Memory introuvable')
      await new Promise((resolve) => setTimeout(resolve, 500))
      const beforeInsertAbsent = !(await evaluate(resultVisible(dynamicTitle)))
      if (!beforeInsertAbsent)
        throw new Error('Le contrôle négatif initial contient déjà la fiche dynamique')

      writeFileSync(dynamicNotePath, dynamicNote, 'utf8')
      await new Promise((resolve) => setTimeout(resolve, 500))
      const insertWithoutRefreshAbsent = !(await evaluate(resultVisible(dynamicTitle)))
      if (!insertWithoutRefreshAbsent) {
        throw new Error(
          'La mutation est visible avant Actualiser : le contrôle du cache est invalide'
        )
      }

      await clickRefresh()
      welcomeModalDismissed = (await dismissVisibleWelcome()) || welcomeModalDismissed
      await waitFor(resultVisible(dynamicTitle), 45000)
      const afterInsertRefreshVisible = await evaluate(resultVisible(dynamicTitle))
      const observed = await evaluate(`(() => {
    const result = [...document.querySelectorAll('.node-search-result')].find(
      (item) => item.textContent?.includes(${JSON.stringify(dynamicTitle)})
    )
    return {
      result: result?.querySelector('span')?.textContent?.trim(),
      metadata: result?.querySelector('small')?.textContent?.trim(),
      refreshEnabled: document.querySelector('.graph-refresh')?.disabled === false,
      error: document.querySelector('.graph-error')?.textContent?.trim() ?? '',
      welcomeModalVisible: [...document.querySelectorAll('button')].some(
        (item) => item.textContent?.trim() === 'Continuer quand même'
      )
    }
  })()`)
      const scoreLabels = ['dense', 'lexical', 'graphe', 'fusion', 'pertinence locale']
      const missingScoreLabels = scoreLabels.filter((label) => !observed.metadata?.includes(label))
      if (missingScoreLabels.length > 0) {
        throw new Error(
          `Canaux de score absents (${missingScoreLabels.join(', ')}): ${JSON.stringify(observed)}`
        )
      }
      if (!observed.metadata?.includes('relation')) {
        throw new Error(`Relations typées absentes: ${JSON.stringify(observed)}`)
      }
      welcomeModalDismissed = (await dismissVisibleWelcome()) || welcomeModalDismissed
      observed.welcomeModalVisible = await evaluate(welcomeButtonVisible)
      if (observed.welcomeModalVisible)
        throw new Error('La modale de bienvenue masque encore la preuve')

      mkdirSync(dirname(screenshotPath), { recursive: true })
      const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
      writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))

      rmSync(dynamicNotePath, { force: true })
      await new Promise((resolve) => setTimeout(resolve, 500))
      const deleteWithoutRefreshVisible = await evaluate(resultVisible(dynamicTitle))
      if (!deleteWithoutRefreshVisible) {
        throw new Error(
          'La suppression est visible avant Actualiser : le contrôle du cache est invalide'
        )
      }
      await clickRefresh()
      await new Promise((resolve) => setTimeout(resolve, 500))
      const afterDeleteRefreshAbsent = !(await evaluate(resultVisible(dynamicTitle)))
      if (!afterDeleteRefreshAbsent)
        throw new Error('La fiche supprimée reste visible après Actualiser')

      if (!(await setSearch(indexedQuery)))
        throw new Error('Recherche de scores Memory introuvable')
      await waitFor(resultVisible(indexedTitle), 45000)
      const scoreObserved = await evaluate(`(() => {
    const result = [...document.querySelectorAll('.node-search-result')].find(
      (item) => item.textContent?.includes(${JSON.stringify(indexedTitle)})
    )
    return {
      result: result?.querySelector('span')?.textContent?.trim(),
      metadata: result?.querySelector('small')?.textContent?.trim()
    }
  })()`)
      const numericScoreLabels = ['dense', 'lexical', 'graphe', 'fusion'].filter(
        (label) => !new RegExp(`${label} -?\\d+,\\d{3}`).test(scoreObserved.metadata ?? '')
      )
      if (numericScoreLabels.length > 0) {
        throw new Error(
          `Scores signés non numériques (${numericScoreLabels.join(', ')}): ${JSON.stringify(scoreObserved)}`
        )
      }
      const scoreScreenshot = await send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true
      })
      writeFileSync(scoreScreenshotPath, Buffer.from(scoreScreenshot.data, 'base64'))

      const proof = {
        status: 'valid',
        capturedAt: new Date().toISOString(),
        packageFresh: true,
        executable,
        executableSha256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
        fixtureRoot,
        welcomeGate: {
          appearanceWindowMs: 20000,
          dismissed: welcomeModalDismissed,
          visibleAtCapture: false
        },
        observations: {
          beforeInsertAbsent,
          insertWithoutRefreshAbsent,
          afterInsertRefreshVisible,
          deleteWithoutRefreshVisible,
          afterDeleteRefreshAbsent
        },
        ...observed,
        signedScores: scoreObserved,
        screenshot: screenshotPath,
        screenshotStage: 'after-insert-refresh',
        scoreScreenshot: scoreScreenshotPath,
        scoreScreenshotStage: 'signed-live-retrieval'
      }
      writeFileSync(reportPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8')
      console.log(JSON.stringify(proof))
    }
  )
} finally {
  socket?.close()
  try {
    control('Stop')
  } catch {
    // The helper identity gate remains authoritative; report the original proof error.
  }
  rmSync(dynamicNotePath, { force: true })
}
