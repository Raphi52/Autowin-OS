import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { withDeviceMetricsOverride } from './cdp-device-metrics.mjs'

const port = process.env.AUTOWIN_CDP_PORT || '9286'
const output = resolve(
  process.env.AUTOWIN_CONVERSATION_SCOPE_SCREENSHOT ||
    'Audit/workspaces/019f8f55-fb3a-71a0-a270-0ba72f8fd800/conversation-source-scope-workspace/conversation-source-scope.png'
)
const proofOutput = output.replace(/\.png$/i, '.json')
const proofExecutablePath = process.env.AUTOWIN_PROOF_EXECUTABLE
if (!proofExecutablePath) {
  throw new Error('AUTOWIN_PROOF_EXECUTABLE doit identifier le binaire Electron testé')
}
const proofExecutable = {
  path: realpathSync(proofExecutablePath),
  sha256: createHash('sha256').update(readFileSync(proofExecutablePath)).digest('hex')
}
const startedAt = Date.now()
const titleA = `Preuve portée conversation A · ${startedAt}`
const titleB = `Preuve portée conversation B · ${startedAt}`
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((target) => target.type === 'page')
if (!page) throw new Error(`Fenêtre Autowin introuvable sur ${port}`)

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
await new Promise((resolveOpen, reject) => {
  const timeout = setTimeout(() => reject(new Error('Connexion CDP expirée')), 5000)
  socket.addEventListener(
    'open',
    () => {
      clearTimeout(timeout)
      resolveOpen()
    },
    { once: true }
  )
  socket.addEventListener('error', reject, { once: true })
})
const send = (method, params = {}, timeoutMs = 20000) =>
  new Promise((resolveSend, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP ${method} expiré`))
    }, timeoutMs)
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout)
        resolveSend(value)
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
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'Erreur DOM')
  }
  return result.result?.value
}
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))

try {
  await withDeviceMetricsOverride(
    send,
    {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    },
    async () => {
  const ids = await evaluate(`(async () => {
    const specs = [
      { title: ${JSON.stringify(titleA)}, variant: 'a' },
      { title: ${JSON.stringify(titleB)}, variant: 'b' }
    ]
    const all = await window.api.conversations()
    const ids = {}
    for (const spec of specs) {
      const conversation =
        all.find((item) => item.title === spec.title) ??
        (await window.api.conversationsCreate({
          title: spec.title,
          category: 'codex',
          provider: 'codex'
        }))
      await window.api.seedConversationScopeTest(conversation.id, spec.variant)
      ids[spec.variant] = conversation.id
    }
    // Contrôle négatif : cet ancien réglage Worktree ne doit plus influencer Projet.
    localStorage.setItem('autowin:sc-repo', 'C:/depot-historique-incorrect')
    localStorage.setItem('autowin.chat.runsPaneWidth', '520')
    return ids
  })()`)

  await send('Page.reload', { ignoreCache: true })
  await wait(900)
  await evaluate(`(() => {
    const continueButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.trim() === 'Continuer quand même'
    )
    continueButton?.click()
    const chat = [...document.querySelectorAll('button')].find((button) =>
      /^chat$/i.test(button.textContent?.trim() ?? '')
    )
    chat?.click()
  })()`)
  await wait(400)

  const selectConversation = async (title) => {
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('.conv-item')].find((item) =>
        item.textContent?.includes(${JSON.stringify(title)})
      )
      const button = row?.querySelector('.conv-pick')
      if (!button) throw new Error('Conversation de preuve introuvable: ' + ${JSON.stringify(title)})
      button.click()
    })()`)
    await wait(250)
  }
  const openSourceControl = async () => {
    await evaluate(`(() => {
      const workflows = document.querySelector('button[title="Workflows (RUN.md)"]')
      if (!workflows) throw new Error('Bouton Workflows introuvable')
      if (!document.querySelector('.runs-pane')) workflows.click()
    })()`)
    await wait(200)
    await evaluate(`(() => {
      const tab = [...document.querySelectorAll('.workflow-section-tabs button')].find(
        (button) => button.textContent?.trim() === 'Source control'
      )
      if (!tab) throw new Error('Onglet Source control introuvable')
      tab.click()
    })()`)
    await wait(350)
  }
  const paneState = () =>
    evaluate(`(() => {
      const pane = document.querySelector('[data-testid="source-control-pane"]')
      if (!pane) throw new Error('Panneau Source control absent')
      const rect = pane.getBoundingClientRect()
      return {
        activeConversationId:
          document.querySelector('[data-testid="chat-view"]')?.getAttribute('data-active-conversation-id') ?? '',
        activeTab:
          [...pane.querySelectorAll('.sc-repo-btn')].find((button) =>
            button.classList.contains('is-active')
          )?.textContent?.trim() ?? '',
        files: [...pane.querySelectorAll('[data-testid="sc-file"]')].map((item) =>
          item.querySelector('.sc-fn')?.textContent?.trim()
        ),
        brainQueries: [...pane.querySelectorAll('[data-testid="sc-brain-trace"]')].map((item) =>
          item.querySelector('p')?.textContent?.trim()
        ),
        brainTurns: [...pane.querySelectorAll('[data-testid="sc-brain-trace"]')].map((item) =>
          item.querySelector('footer span')?.textContent?.trim()
        ),
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          display: getComputedStyle(pane).display,
          visibility: getComputedStyle(pane).visibility
        },
        text: pane.textContent ?? ''
      }
    })()`)
  const waitForPaneLoaded = async (timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const loaded = await evaluate(
        `Boolean(document.querySelector('[data-testid="source-control-pane"]')) &&
         !document.querySelector('[data-testid="sc-loading"]')`
      )
      if (loaded) return
      await wait(100)
    }
    throw new Error('Chargement du panneau Source control expiré')
  }

  await selectConversation(titleA)
  await openSourceControl()
  await waitForPaneLoaded()
  const projectA = await paneState()
  await evaluate(`document.querySelector('[data-testid="sc-repo-brain"]').click()`)
  await waitForPaneLoaded()
  const brainA = await paneState()

  await selectConversation(titleB)
  await evaluate(`document.querySelector('[data-testid="sc-repo-project"]').click()`)
  await waitForPaneLoaded()
  const projectB = await paneState()
  await evaluate(`document.querySelector('[data-testid="sc-repo-brain"]').click()`)
  await waitForPaneLoaded()
  const brainB = await paneState()

  const expectedA = 'src/renderer/src/components/SourceControlPane.tsx'
  const expectedB = 'src/renderer/src/components/SourceControlPane.css'
  const checks = {
    projectAExact: JSON.stringify(projectA.files) === JSON.stringify([expectedA]),
    projectBExact: JSON.stringify(projectB.files) === JSON.stringify([expectedB]),
    brainAExact:
      brainA.brainQueries.length >= 1 &&
      brainA.brainQueries.every((query) => query === 'fixture brain conversation A'),
    brainBExact:
      brainB.brainQueries.length >= 1 &&
      brainB.brainQueries.every((query) => query === 'fixture brain conversation B'),
    brainTurnsLinked:
      brainA.brainTurns.every((turn) => turn === 'Tour fixture-') &&
      brainB.brainTurns.every((turn) => turn === 'Tour fixture-'),
    activeA: projectA.activeConversationId === ids.a && brainA.activeConversationId === ids.a,
    activeB: projectB.activeConversationId === ids.b && brainB.activeConversationId === ids.b,
    noCrossLeak:
      !projectA.text.includes(expectedB) &&
      !projectB.text.includes(expectedA) &&
      !brainA.text.includes('fixture brain conversation B') &&
      !brainB.text.includes('fixture brain conversation A')
  }
  if (Object.values(checks).some((value) => !value)) {
    throw new Error(
      `Preuve d'isolation rouge: ${JSON.stringify({ checks, projectA, brainA, projectB, brainB })}`
    )
  }

  const capture = await send(
    'Page.captureScreenshot',
    {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, brainB.bounds.x - 8),
        y: Math.max(0, brainB.bounds.y - 8),
        width: brainB.bounds.width + 16,
        height: brainB.bounds.height + 16,
        scale: 1
      }
    },
    60_000
  )
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, Buffer.from(capture.data, 'base64'))
  const proof = {
    schema: 'autowin.conversation-source-scope-proof/v1',
    startedAt,
    completedAt: Date.now(),
    port,
    ids,
    checks,
    projectA,
    brainA,
    projectB,
    brainB,
    screenshot: output,
    executable: proofExecutable
  }
  writeFileSync(proofOutput, `${JSON.stringify(proof, null, 2)}\n`, 'utf8')
      console.log(JSON.stringify({ proofOutput, output, checks }))
    }
  )
} finally {
  socket.close()
}
