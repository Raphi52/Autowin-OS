import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { withDeviceMetricsOverride } from './cdp-device-metrics.mjs'
import { assertWorkflowRequestGraphProof } from './cdp-proof-validation.mjs'
import { cheminArtefact } from './racine-depot.mjs'
import { agirJusqua } from './cdp-attente.mjs'

const port = process.env.AUTOWIN_CDP_PORT || '9251'
const output =
  process.env.AUTOWIN_WORKFLOW_GRAPH_SCREENSHOT || cheminArtefact('workflow-execution-graph.png')
const proofOutput = output.replace(/\.png$/i, '.json')
const proofStamp = `request-graph-${Date.now()}`
const previousMarker = `${proofStamp}-previous`
const currentMarker = `${proofStamp}-current`
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

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Connexion WebSocket CDP expirée')), 5000)
  socket.onopen = resolve
  socket.onerror = reject
  socket.addEventListener('open', () => clearTimeout(timeout), { once: true })
})

const send = (method, params = {}, timeoutMs = 20000) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP ${method} expiré`))
    }, timeoutMs)
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

const previousWidth = await evaluate(`localStorage.getItem('autowin.chat.runsPaneWidth')`)

try {
  await withDeviceMetricsOverride(
    send,
    {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false
    },
    async () => {
      await evaluate(`localStorage.setItem('autowin.chat.runsPaneWidth', '280')`)
      await send('Page.reload', { ignoreCache: true })
      await new Promise((resolve) => setTimeout(resolve, 700))
      const fixture = await evaluate(`(async () => {
  const title = "Preuve graphe d'exécution"
  const existing = (await window.api.conversations()).find((item) => item.title === title)
  const conversation = existing ?? await window.api.conversationsCreate({
    title, category: 'codex', provider: 'codex'
  })
  const previous = await window.api.pilotChat([
    { role: 'user', content: '[[autowin-fixture-durable-stream]] ${previousMarker}' }
  ], conversation.id)
  if (!previous.ok) throw new Error(previous.error || 'Ancienne fixture pilot en échec')
  const current = await window.api.pilotChat([
    { role: 'user', content: '[[autowin-fixture-durable-stream]] ${currentMarker}' }
  ], conversation.id)
  if (!current.ok) throw new Error(current.error || 'Fixture pilot courante en échec')
  return { conversationId: conversation.id, expectedTurnId: current.turnId }
})()`)
      const conversationId = fixture.conversationId
      const expectedTurnId = fixture.expectedTurnId

      await send('Page.reload', { ignoreCache: true })
      await new Promise((resolve) => setTimeout(resolve, 900))
      await evaluate(`(() => {
  const continueButton = [...document.querySelectorAll('button')].find((button) =>
    button.textContent?.trim() === 'Continuer quand même'
  )
  continueButton?.click()
})()`)
      /*
       * PAR LE REPERE, ET EN ATTENDANT L'ETAT.
       *
       * Mesure du 2026-09-06 : ce bloc cherchait la vue Chat par son TEXTE, avec /^chat$/i. Le
       * libelle rendu est « 💬Chat » (emoji colle au mot) : aucun bouton ne correspondait, la vue
       * ne changeait pas, et la sonde levait « Conversation de preuve introuvable » — en accusant
       * la fixture alors qu'elle avait ete SEMEE sans erreur. Une vue se designe par son repere
       * (garde scripts/navigation-sondes.test.mjs), et une liste asynchrone s'ATTEND.
       */
      const surChat = await agirJusqua(
        evaluate,
        `Boolean(document.querySelector('.conv-item'))`,
        () =>
          evaluate(`(() => {
  document.querySelector('[data-testid="nav-chat"]')?.click()
  return true
})()`),
        20000
      )
      if (!surChat) throw new Error("La liste des conversations n'est pas montee apres 20 s")
      const filChoisi = await agirJusqua(
        evaluate,
        `Boolean(document.querySelector('.chat-scroll'))`,
        () =>
          evaluate(`(() => {
  const row = [...document.querySelectorAll('.conv-item')].find((item) =>
    item.textContent?.includes("Preuve graphe d'exécution"))
  row?.querySelector('.conv-pick')?.click()
  return true
})()`),
        20000
      )
      if (!filChoisi) throw new Error('Conversation de preuve introuvable dans la liste')
      await new Promise((resolve) => setTimeout(resolve, 250))
      /*
       * BLOCAGE CONNU — CE CONTROLE N'EXISTE PLUS (mesure du 2026-09-06).
       *
       * Le bouton title="Workflows (RUN.md)" a disparu de l'interface : le panneau de droite a ete
       * BORNE a la conversation et sa vue globale sortie dans l'Observatory (commit 79e9c13e). Sur
       * une instance isolee, un fil sans orchestration n'affiche donc aucun panneau a ouvrir — les
       * boutons rendus disent eux-memes « aucun run a ouvrir ».
       *
       * Cette sonde n'est PAS branchee sur build:desktop pour cette raison, et sa navigation a
       * quand meme ete reparee ci-dessus (repere au lieu du texte, attente d'etat) : ces defauts-la
       * la faisaient tomber AVANT d'atteindre ce point, et masquaient la vraie cause. Pour la
       * reveiller il faut soit viser le nouveau chemin d'acces au panneau, soit semer un vrai run.
       */
      await evaluate(`(() => {
  const workflows = document.querySelector('button[title="Workflows (RUN.md)"]')
  if (!workflows) throw new Error('Bouton Workflows introuvable')
  workflows.click()
})()`)
      await new Promise((resolve) => setTimeout(resolve, 200))
      await evaluate(`(() => {
  const graph = [...document.querySelectorAll('.workflow-section-tabs button')].find(
    (button) => button.textContent?.trim() === 'Graphe'
  )
  if (!graph) throw new Error('Onglet Graphe introuvable')
  graph.click()
})()`)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await evaluate(`(() => {
  const first = document.querySelector('[data-execution-node]')
  if (!first) throw new Error("Nœud d'exécution introuvable")
  first.focus()
})()`)
      await send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9
      })
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9
      })
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        text: '\r',
        unmodifiedText: '\r'
      })
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13
      })
      await new Promise((resolve) => setTimeout(resolve, 200))

      const state = await evaluate(`(() => {
  const pane = document.querySelector('.runs-pane')
  const graph = document.querySelector('.workflow-execution-graph')
  const appRoot = document.getElementById('root')
  const paneRect = pane?.getBoundingClientRect()
  const graphRect = graph?.getBoundingClientRect()
  const appRect = appRoot?.getBoundingClientRect()
  const paneStyle = pane ? getComputedStyle(pane) : null
  const keyboardNode = document.activeElement?.closest?.('[data-execution-node]')
  const identityNodes = [...(graph?.querySelectorAll('[data-execution-kind="agent"]') ?? [])]
  const edgeElement = document.elementFromPoint(window.innerWidth - 2, Math.floor(window.innerHeight / 2))
  const edgeBackground = edgeElement ? getComputedStyle(edgeElement).backgroundColor : null
  return {
    expectedTurnId: ${JSON.stringify(expectedTurnId)},
    graphTurnId: graph?.getAttribute('data-turn-id') ?? null,
    conversationId: graph?.getAttribute('data-conversation-id') ?? null,
    nodeCount: graph?.querySelectorAll('[data-execution-node]').length ?? 0,
    requestRootCount: graph?.querySelectorAll('[data-execution-kind="request"]').length ?? 0,
    previousTurnLeaks: graph?.textContent?.includes(${JSON.stringify(previousMarker)}) ? 1 : 0,
    currentMarkerVisible: graph?.textContent?.includes(${JSON.stringify(currentMarker)}) ?? false,
    identityCount: identityNodes.filter((node) =>
      Boolean(node.getAttribute('data-execution-agent')) &&
      Boolean(node.getAttribute('data-execution-provider')) &&
      Boolean(node.getAttribute('data-execution-model'))
    ).length,
    edgeCount: graph?.querySelectorAll('[data-execution-edge]').length ?? 0,
    detailVisible: Boolean(graph?.querySelector('.workflow-execution-detail')),
    keyboardNodeId: keyboardNode?.getAttribute('data-execution-node') ?? null,
    keyboardSelected: keyboardNode?.getAttribute('aria-selected') === 'true',
    overflow: pane ? pane.scrollWidth > pane.clientWidth + 1 : null,
    paneVisible: Boolean(
      paneRect && paneRect.left >= 0 && paneRect.right <= window.innerWidth && paneRect.width > 0
    ),
    narrowWidth: Boolean(paneRect && paneRect.width >= 279 && paneRect.width <= 281),
    whiteBorder: Boolean(
      !appRect ||
      appRect.right < window.innerWidth - 1 ||
      appRect.bottom < window.innerHeight - 1 ||
      edgeBackground === 'rgb(255, 255, 255)'
    ),
    edgeBackground,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    paneRect: paneRect
      ? { left: paneRect.left, right: paneRect.right, top: paneRect.top, width: paneRect.width }
      : null,
    graphRect: graphRect
      ? { left: graphRect.left, right: graphRect.right, top: graphRect.top, width: graphRect.width }
      : null,
    paneStyle: paneStyle
      ? { position: paneStyle.position, zIndex: paneStyle.zIndex, display: paneStyle.display }
      : null,
    wizardVisible: [...document.querySelectorAll('button')].some((button) =>
      button.textContent?.trim() === 'Continuer quand même'
    ),
    error: graph?.querySelector('[role="alert"]')?.textContent?.trim() ?? null
  }
})()`)

      if (state.conversationId !== conversationId || !state.currentMarkerVisible) {
        throw new Error(`Preuve du graphe insuffisante: ${JSON.stringify(state)}`)
      }
      assertWorkflowRequestGraphProof(state)

      const screenshot = await send(
        'Page.captureScreenshot',
        { format: 'png', fromSurface: true },
        40000
      )
      mkdirSync(dirname(output), { recursive: true })
      writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
      writeFileSync(proofOutput, `${JSON.stringify({ state, output }, null, 2)}\n`)
      console.log(JSON.stringify({ state, output, proofOutput }))
    },
    async () => {
      await evaluate(
        previousWidth === null
          ? `localStorage.removeItem('autowin.chat.runsPaneWidth')`
          : `localStorage.setItem('autowin.chat.runsPaneWidth', ${JSON.stringify(previousWidth)})`
      )
    }
  )
} finally {
  socket.close()
}
