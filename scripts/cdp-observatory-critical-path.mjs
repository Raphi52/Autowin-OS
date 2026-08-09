import { writeFileSync } from 'node:fs'
import { withDeviceMetricsOverride } from './cdp-device-metrics.mjs'

const port = process.env.AUTOWIN_CDP_PORT || '9248'
const output =
  process.env.AUTOWIN_OBSERVATORY_SCREENSHOT ||
  'C:/Amitel/Autowin OS/artifacts/observatory-critical-path.png'
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
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP ${method} expiré`))
    }, 20000)
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

console.log('[cdp] connecté')
await send('Page.reload', { ignoreCache: true })
await withDeviceMetricsOverride(
  send,
  {
    width: 900,
    height: 670,
    deviceScaleFactor: 1,
    mobile: false
  },
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 700))
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const wizard = await evaluate(`(() => {
    const overlay = document.querySelector('.frw-overlay')
    if (!overlay) return { dismissed: true }
    const continueButton = [...overlay.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Continuer quand même'
    )
    if (!continueButton) return { dismissed: false }
    const rect = continueButton.getBoundingClientRect()
    return { dismissed: false, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
      if (wizard.dismissed) break
      if (wizard.x != null && wizard.y != null) {
        await send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: wizard.x,
          y: wizard.y,
          button: 'left',
          clickCount: 1
        })
        await send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: wizard.x,
          y: wizard.y,
          button: 'left',
          clickCount: 1
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
    await evaluate(`(async () => {
  const existing = (await window.api.conversations()).find((item) => item.title === 'Preuve chemin critique')
  const conversation = existing ?? await window.api.conversationsCreate({
    title: 'Preuve chemin critique', category: 'codex', provider: 'codex'
  })
  const traces = await window.api.causalTrace(conversation.id)
  if (
    !traces.some((trace) => trace.authority?.mutates === false) ||
    !traces.some((trace) => trace.id?.includes('fixture-decision-open'))
  ) {
    const result = await window.api.pilotChat([
      { role: 'user', content: '[[autowin-fixture-durable-stream]] observatory-critical-path' }
    ], conversation.id)
    if (!result.ok) throw new Error(result.error || 'Fixture pilot en échec')
  }
  return conversation.id
})()`)
    console.log('[cdp] fixture créée')
    await evaluate(`(() => {
  const target = [...document.querySelectorAll('button')].find((button) =>
    /observatory|observatoire/i.test(button.textContent ?? ''))
  if (!target) throw new Error('Navigation Observatory introuvable')
  target.click()
})()`)
    console.log('[cdp] Observatory ouvert')
    await new Promise((resolve) => setTimeout(resolve, 900))
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const dismissed = await evaluate(`(() => {
    const overlay = document.querySelector('.frw-overlay')
    if (!overlay) return true
    const actions = overlay.querySelectorAll('.frw-actions button')
    actions[actions.length - 1]?.click()
    return false
  })()`)
      if (dismissed) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await evaluate(`(() => {
  const target = [...document.querySelectorAll('.observatory-conversations button')].find(
    (button) => button.textContent?.includes('Preuve chemin critique')
  )
  if (!target) throw new Error('Conversation fixture introuvable dans Observatory')
  target.click()
})()`)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await evaluate(`(() => {
  const target = [...document.querySelectorAll('button')].find((button) =>
    button.textContent?.trim() === 'Chemin critique')
  if (!target) throw new Error('Bascule Chemin critique introuvable')
  target.click()
})()`)
    await new Promise((resolve) => setTimeout(resolve, 350))
    await evaluate(`(() => {
  const first = document.querySelector('.observatory-causal-tree .observatory-causal-node-wrap > button')
  if (!first) throw new Error('Nœud causal cliquable introuvable')
  first.click()
})()`)
    await new Promise((resolve) => setTimeout(resolve, 200))
    await evaluate(`(() => {
  const stream = document.querySelector('.observatory-stream')
  if (stream) stream.scrollTop = 0
})()`)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const state = await evaluate(`(() => ({
  title: document.querySelector('.observatory-causal-path > header')?.textContent?.trim(),
  toolbarZones: document.querySelectorAll('.observatory-toolbar > [data-toolbar-zone]').length,
  nodes: document.querySelectorAll('.observatory-causal-node-wrap > button').length,
  critical: document.querySelectorAll('.observatory-causal-node-wrap > button.is-critical').length,
  bottlenecks: document.querySelectorAll('.observatory-causal-node-wrap > button.is-bottleneck').length,
  detailVisible: Boolean(document.querySelector('.observatory-causal-detail')),
  causalNodeVisible: (() => {
    const stream = document.querySelector('.observatory-stream')
    const element = document.querySelector('.observatory-causal-node-wrap > button')
    if (!stream || !element) return false
    const viewport = stream.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < viewport.bottom
  })(),
  causalDetailVisible: (() => {
    const stream = document.querySelector('.observatory-stream')
    const element = document.querySelector('.observatory-causal-detail')
    if (!stream || !element) return false
    const viewport = stream.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < viewport.bottom
  })(),
  blockingDialogs: [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
    .filter((element) => getComputedStyle(element).visibility !== 'hidden')
    .map((element) => element.className),
  blockingActions: [...document.querySelectorAll('[role="dialog"][aria-modal="true"] button')]
    .map((element) => element.textContent?.trim()),
  errors: document.querySelector('.observatory-source-errors')?.textContent?.trim() ?? null,
  geometry: ['.observatory-view', '.observatory-toolbar', '.observatory-flightdeck', '.observatory-rail', '.observatory-stream']
    .map((selector) => {
      const element = document.querySelector(selector)
      return {
        selector,
        clientWidth: element?.clientWidth ?? 0,
        scrollWidth: element?.scrollWidth ?? 0,
        overflow: element ? element.scrollWidth - element.clientWidth : 999
      }
    })
}))()`)
    if (
      !state.title ||
      state.toolbarZones !== 3 ||
      state.nodes < 2 ||
      (state.critical < 1 && !/goulot non calculable/i.test(state.title)) ||
      !state.detailVisible ||
      !state.causalNodeVisible ||
      state.blockingDialogs.length > 0 ||
      Boolean(state.errors) ||
      state.geometry.some((item) => item.overflow > 1)
    )
      throw new Error(`Preuve causale insuffisante: ${JSON.stringify(state)}`)
    await send('Page.bringToFront')
    await evaluate(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
    )
    const screenshot = await evaluate('window.api.captureTestPage()')
    writeFileSync(output, Buffer.from(screenshot, 'base64'))
    await evaluate(`(() => {
  const target = [...document.querySelectorAll('button')].find((button) =>
    button.textContent?.trim() === 'Chronologie'
  )
  if (!target) throw new Error('Bascule Chronologie introuvable')
  target.click()
})()`)
    await new Promise((resolve) => setTimeout(resolve, 250))
    const beforeLive = await evaluate(`document.querySelectorAll('.observatory-event').length`)
    await evaluate(`(async () => {
  const conversation = (await window.api.conversations()).find(
    (item) => item.title === 'Preuve chemin critique'
  )
  if (!conversation) throw new Error('Conversation fixture live introuvable')
  const result = await window.api.pilotChat([
    { role: 'user', content: '[[autowin-fixture-durable-stream]] observatory-live' }
  ], conversation.id)
  if (!result.ok) throw new Error(result.error || 'Fixture live en echec')
})()`)
    let liveEvents = beforeLive
    for (let attempt = 0; attempt < 40 && liveEvents <= beforeLive; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      liveEvents = await evaluate(`document.querySelectorAll('.observatory-event').length`)
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const stable = await evaluate(`(() => ({
    events: document.querySelectorAll('.observatory-event').length,
    loading: document.querySelector('.observatory-stream')?.textContent?.includes('Lecture des traces') ?? true
  }))()`)
      if (!stable.loading && stable.events >= liveEvents) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await evaluate(`(() => {
  const stream = document.querySelector('.observatory-stream')
  if (stream) stream.scrollTop = 0
})()`)
    const eventLayout = await evaluate(`(() => {
  const stream = document.querySelector('.observatory-stream')
  const event = document.querySelector('.observatory-event')
  if (!stream || !event) return { visible: false }
  const viewport = stream.getBoundingClientRect()
  const rect = event.getBoundingClientRect()
  return {
    visible: rect.bottom > viewport.top && rect.top < viewport.bottom,
    viewport: { top: viewport.top, bottom: viewport.bottom, height: viewport.height },
    event: { top: rect.top, bottom: rect.bottom, height: rect.height },
    summaries: [...document.querySelectorAll('.observatory-authority-ledger, .observatory-decision-ledger')]
      .map((element) => ({ tag: element.tagName, open: element.open, height: element.getBoundingClientRect().height }))
  }
})()`)
    const eventVisible = eventLayout.visible
    if (!eventVisible)
      throw new Error(`Aucun evenement chronologique visible: ${JSON.stringify(eventLayout)}`)
    const timelineOutput = output.replace(/\.png$/i, '-timeline.png')
    await send('Page.bringToFront')
    await evaluate(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
    )
    const timelineScreenshot = await evaluate('window.api.captureTestPage()')
    writeFileSync(timelineOutput, Buffer.from(timelineScreenshot, 'base64'))
    await evaluate(`(() => {
  const events = [...document.querySelectorAll('.observatory-event')].slice(0, 2)
  if (events.length < 2) throw new Error('Événements A/B insuffisants')
  for (const event of events)
    event.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
})()`)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const timelineState = await evaluate(`(() => ({
  events: document.querySelectorAll('.observatory-event').length,
  authority: document.querySelector('[data-testid="observatory-authority-ledger"]')?.textContent?.trim() ?? null,
  comparisonRows: document.querySelectorAll('.observatory-diff tbody tr').length,
  comparisonText: document.querySelector('.observatory-diff')?.textContent?.trim() ?? null,
  decisions: document.querySelector('[data-testid="observatory-decision-ledger"]')?.textContent?.trim() ?? null,
  geometry: ['.observatory-view', '.observatory-toolbar', '.observatory-flightdeck', '.observatory-rail', '.observatory-stream']
    .map((selector) => {
      const element = document.querySelector(selector)
      return {
        selector,
        clientWidth: element?.clientWidth ?? 0,
        scrollWidth: element?.scrollWidth ?? 0,
        overflow: element ? element.scrollWidth - element.clientWidth : 999
      }
    })
}))()`)
    if (
      timelineState.events < 2 ||
      liveEvents <= beforeLive ||
      !timelineState.authority ||
      !/Mode|Risque|Décision/.test(timelineState.authority) ||
      !/Mutationnon/.test(timelineState.authority) ||
      !/get_stateautorisée/.test(timelineState.authority) ||
      timelineState.comparisonRows < 1 ||
      !/Comparaison causale A\/B/.test(timelineState.comparisonText ?? '') ||
      !/Signal attendu/.test(timelineState.decisions ?? '') ||
      !/ouverte/.test(timelineState.decisions ?? '') ||
      timelineState.geometry.some((item) => item.overflow > 1)
    )
      throw new Error(`Preuve chronologique insuffisante: ${JSON.stringify(timelineState)}`)
    const comparisonOutput = output.replace(/\.png$/i, '-comparison.png')
    await send('Page.bringToFront')
    await evaluate(`(() => {
  const stream = document.querySelector('.observatory-stream')
  const comparison = document.querySelector('.observatory-diff')
  if (stream && comparison) {
    const desired = comparison.getBoundingClientRect().top - stream.getBoundingClientRect().top + stream.scrollTop - 8
    stream.scrollTop = Math.min(desired, stream.scrollHeight - stream.clientHeight)
  }
})()`)
    await evaluate(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
    )
    const comparisonVisible = await evaluate(`(() => {
  const stream = document.querySelector('.observatory-stream')
  const element = document.querySelector('.observatory-diff')
  if (!stream || !element) return false
  const viewport = stream.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  return rect.bottom > viewport.top && rect.top < viewport.bottom
})()`)
    if (!comparisonVisible) throw new Error('Comparaison A/B hors du viewport')
    const comparisonScreenshot = await evaluate('window.api.captureTestPage()')
    writeFileSync(comparisonOutput, Buffer.from(comparisonScreenshot, 'base64'))

    const ledgersOutput = output.replace(/\.png$/i, '-ledgers.png')
    const authorityOutput = output.replace(/\.png$/i, '-authority.png')
    await evaluate(`(() => {
  const stream = document.querySelector('.observatory-stream')
  const authority = document.querySelector('[data-testid="observatory-authority-ledger"]')
  const decisions = document.querySelector('[data-testid="observatory-decision-ledger"]')
  if (authority) authority.open = true
  if (decisions) decisions.open = true
  if (stream && authority) {
    const desired = authority.getBoundingClientRect().top - stream.getBoundingClientRect().top + stream.scrollTop - 8
    stream.scrollTop = Math.min(desired, stream.scrollHeight - stream.clientHeight)
  }
})()`)
    await evaluate(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
    )
    const authorityVisible = await evaluate(`(() => {
  const stream = document.querySelector('.observatory-stream')
  const element = document.querySelector('[data-testid="observatory-authority-ledger"] article')
  if (!stream || !element) return false
  const viewport = stream.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  return rect.bottom > viewport.top && rect.top < viewport.bottom
})()`)
    if (!authorityVisible) throw new Error('Registre d autorite hors du viewport')
    const authorityScreenshot = await evaluate('window.api.captureTestPage()')
    writeFileSync(authorityOutput, Buffer.from(authorityScreenshot, 'base64'))
    await evaluate(`(() => {
  const stream = document.querySelector('.observatory-stream')
  const decisions = document.querySelector('[data-testid="observatory-decision-ledger"]')
  if (stream && decisions) {
    const desired = decisions.getBoundingClientRect().top - stream.getBoundingClientRect().top + stream.scrollTop - 8
    stream.scrollTop = Math.min(desired, stream.scrollHeight - stream.clientHeight)
  }
})()`)
    await evaluate(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
    )
    const ledgerVisible = await evaluate(`(() => {
  const stream = document.querySelector('.observatory-stream')
  const element = document.querySelector('[data-testid="observatory-decision-ledger"] article')
  if (!stream || !element) return false
  const viewport = stream.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  return rect.bottom > viewport.top && rect.top < viewport.bottom
})()`)
    if (!ledgerVisible) throw new Error('Registre de decisions hors du viewport')
    const ledgersScreenshot = await evaluate('window.api.captureTestPage()')
    writeFileSync(ledgersOutput, Buffer.from(ledgersScreenshot, 'base64'))
    console.log(
      JSON.stringify({
        state,
        timelineState,
        beforeLive,
        liveEvents,
        eventVisible,
        comparisonVisible,
        authorityVisible,
        ledgerVisible,
        output,
        timelineOutput,
        comparisonOutput,
        authorityOutput,
        ledgersOutput
      })
    )
  }
)
socket.close()
