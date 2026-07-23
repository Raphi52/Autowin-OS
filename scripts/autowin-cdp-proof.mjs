import { writeFileSync } from 'node:fs'

const value = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const port = Number(value('--port', '9240'))
const output = value('--out', `C:/Amitel/Autowin OS/Audit/headless-instances/proof-${port}.png`)
const jsonOutput = value('--json-out', output.replace(/\.png$/i, '') + '.json')
const section = value('--section', '')
const theme = value('--theme', '')
const hoverTheme = value('--hover-theme', '')
const verifyBehaviourFilters = process.argv.includes('--verify-behaviour-filters')
const verifyCanonicalNavigation = process.argv.includes('--verify-navigation')
const skipDialogs = process.argv.includes('--skip-dialogs')
const skipScreenshot = process.argv.includes('--skip-screenshot')
const collapseRail = process.argv.includes('--collapse-rail')
const canonicalDestinations = [
  {
    id: 'chat',
    navSelector: '[data-testid="nav-chat"]',
    viewSelector: '[data-testid="chat-view"]',
    expectedText: 'Conversations'
  },
  {
    id: 'agent-studio',
    navSelector: '[data-testid="nav-agent-studio"]',
    viewSelector: '[data-testid="agent-studio-view"]',
    expectedText: 'Modèles & topologie'
  },
  {
    id: 'knowledge',
    navSelector: '[data-testid="nav-knowledge"]',
    viewSelector: '[data-testid="knowledge-view"]',
    expectedText: 'Memory'
  },
  {
    id: 'observatory',
    navSelector: '[data-testid="nav-observatory"]',
    viewSelector: '[data-testid="observatory-view"]',
    expectedText: 'Observatory'
  },
  {
    id: 'worktree',
    navSelector: '[data-testid="nav-worktree"]',
    viewSelector: '.worktree-tab[data-active="true"]',
    expectedText: 'Aucune copie en cours',
    nestedSelector: '[data-testid="wt-view"]'
  },
  {
    id: 'settings',
    navSelector: '[data-testid="nav-settings"]',
    viewSelector: '[data-testid="settings-view"]',
    expectedText: 'Skills · Hooks · Tools'
  }
]
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((item) => item.type === 'page')
if (!page) throw new Error(`Aucune page CDP sur le port ${port}`)
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
let id = 0
const pending = new Map()
const runtimeIssues = []
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const call = pending.get(message.id)
  if (!call) {
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeIssues.push({ method: message.method, params: message.params })
    }
    if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
      runtimeIssues.push({ method: message.method, params: message.params })
    }
    return
  }
  pending.delete(message.id)
  message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result)
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const callId = ++id
    const timeout = setTimeout(() => {
      pending.delete(callId)
      reject(new Error(`Délai CDP dépassé : ${method}`))
    }, 15_000)
    pending.set(callId, {
      resolve: (result) => {
        clearTimeout(timeout)
        resolve(result)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    })
    socket.send(JSON.stringify({ id: callId, method, params }))
  })
if (theme) {
  if (theme !== 'dark') throw new Error(`Mode visuel supprimé : ${theme}`)
  const verified = await send('Runtime.evaluate', {
    expression: `(() => ({
      dark: document.querySelector('.shell')?.classList.contains('theme-serious') === true,
      controls: document.querySelectorAll('.app-theme-switch').length
    }))()`,
    returnByValue: true
  })
  if (!verified.result.value?.dark || verified.result.value?.controls !== 0)
    throw new Error('Le thème Dark unique n’est pas actif')
}
if (hoverTheme) {
  const hovered = await send('Runtime.evaluate', {
    expression: `(() => {
      const target = document.querySelector(${JSON.stringify(`[aria-label="${hoverTheme}"]`)})
      if (!target) return null
      const rect = target.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()`,
    returnByValue: true
  })
  if (!hovered.result.value) throw new Error(`Option visuelle introuvable : ${hoverTheme}`)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: hovered.result.value.x,
    y: hovered.result.value.y
  })
  await new Promise((resolve) => setTimeout(resolve, 200))
}
if (collapseRail) {
  await send('Runtime.evaluate', {
    expression: `(() => {
      const rail = document.querySelector('.rail')
      const toggle = document.querySelector('.rail-toggle')
      if (!rail?.classList.contains('is-collapsed')) toggle?.click()
    })()`,
    returnByValue: true
  })
  await new Promise((resolve) => setTimeout(resolve, 150))
  const collapsed = await send('Runtime.evaluate', {
    expression: `(() => {
      const icons = [...document.querySelectorAll('.nav-item .space-toy-icon')]
      return {
        collapsed: document.querySelector('.rail')?.classList.contains('is-collapsed') ?? false,
        iconCount: icons.length,
        visibleIconCount: icons.filter((icon) => getComputedStyle(icon).display !== 'none').length
      }
    })()`,
    returnByValue: true
  })
  if (!collapsed.result.value?.collapsed) throw new Error('La barre latérale ne s’est pas repliée')
  console.log(JSON.stringify({ rail: collapsed.result.value }))
}
let navigationProof
if (verifyCanonicalNavigation) {
  await send('Runtime.enable')
  await send('Log.enable')
  runtimeIssues.length = 0
  const verification = await send('Runtime.evaluate', {
    expression: `(async () => {
      const destinations = ${JSON.stringify(canonicalDestinations)}
      const wizard = document.querySelector('[data-testid="first-run-wizard"]')
      wizard?.querySelector('.frw-primary')?.click()
      await new Promise((resolve) => setTimeout(resolve, 200))
      const wizardDismissed = !document.querySelector('[data-testid="first-run-wizard"]')
      const proof = []
      for (const destination of destinations) {
        const target = document.querySelector(destination.navSelector)
        target?.click()
        await new Promise((resolve) => setTimeout(resolve, 200))
        const activeTarget = document.querySelector(destination.navSelector)
        const view = document.querySelector(destination.viewSelector)
        const state = await window.api.appState()
        const renderedText = view?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
        proof.push({
          id: destination.id,
          found: Boolean(target),
          active: activeTarget?.classList.contains('active') === true,
          viewFound: Boolean(view),
          contentVerified: renderedText.includes(destination.expectedText),
          stateVerified: state?.tab === destination.id,
          nestedVerified: destination.nestedSelector
            ? Boolean(view?.querySelector(destination.nestedSelector))
            : true,
          expectedText: destination.expectedText,
          renderedText: renderedText.slice(0, 500)
        })
      }
      return { wizardDismissed, destinations: proof }
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  navigationProof = verification.result.value
  if (
    !navigationProof?.wizardDismissed ||
    !Array.isArray(navigationProof.destinations) ||
    navigationProof.destinations.length !== canonicalDestinations.length ||
    navigationProof.destinations.some(
      (destination) =>
        !destination.found ||
        !destination.active ||
        !destination.viewFound ||
        !destination.contentVerified ||
        !destination.stateVerified ||
        !destination.nestedVerified
    )
  ) {
    throw new Error(`Navigation canonique invalide : ${JSON.stringify(navigationProof)}`)
  }
  await new Promise((resolve) => setTimeout(resolve, 100))
  if (runtimeIssues.length > 0) {
    throw new Error(`Erreurs renderer pendant la navigation : ${JSON.stringify(runtimeIssues)}`)
  }
}
if (section) {
  const navigation = await send('Runtime.evaluate', {
    expression: `(() => {
      const target = [...document.querySelectorAll('button')].find((button) =>
        button.textContent?.trim().includes(${JSON.stringify(section)})
      )
      target?.click()
      return Boolean(target)
    })()`,
    returnByValue: true
  })
  if (!navigation.result.value) throw new Error(`Section introuvable : ${section}`)
  await new Promise((resolve) => setTimeout(resolve, 500))
}
let behaviourFilters
if (verifyBehaviourFilters) {
  const verification = await send('Runtime.evaluate', {
    expression: `(async () => {
      const wait = () => new Promise((resolve) => setTimeout(resolve, 150))
      const button = (label) => [...document.querySelectorAll('.behaviour-toolbar button')]
        .find((item) => item.textContent?.trim() === label)
      button('Claude')?.click()
      await wait()
      const activePath = document.querySelector('.behaviour-files button.active')?.dataset.path ?? null
      const readerPath = document.querySelector('.behaviour-reader header p')?.getAttribute('title') ?? null
      const input = document.querySelector('.behaviour-toolbar input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '__aucun_fichier__')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      await wait()
      const emptyConsistent = !document.querySelector('.behaviour-files button.active')
        && !document.querySelector('.behaviour-reader header')
      setter?.call(input, '')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      button('Tous')?.click()
      await wait()
      return { sameVisibleFile: Boolean(activePath) && activePath === readerPath, emptyConsistent }
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  behaviourFilters = verification.result.value
}
const inspected = await send('Runtime.evaluate', {
  expression: `({ title: document.title, bodyCharacters: document.body?.innerText.length ?? 0, url: location.href })`,
  returnByValue: true
})
const dialogs = skipDialogs
  ? { result: { value: { suppressed: true } } }
  : await send('Runtime.evaluate', {
      expression: `(async () => {
    const [workspace, diagnostics] = await Promise.all([
      window.api.chooseBehaviourWorkspace(),
      window.api.authorizeDiagnostics()
    ])
    return { workspace, diagnostics, suppressed: workspace === null && diagnostics === null }
  })()`,
      awaitPromise: true,
      returnByValue: true
    })
if (!skipScreenshot) {
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
}
socket.close()
const result = {
  port,
  screenshot: skipScreenshot ? null : output,
  json: jsonOutput,
  ...inspected.result.value,
  nativeDialogs: dialogs.result.value,
  rendererIssues: runtimeIssues,
  ...(navigationProof ? { navigation: navigationProof } : {}),
  ...(behaviourFilters ? { behaviourFilters } : {})
}
writeFileSync(jsonOutput, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result))
if (
  !result.url ||
  result.bodyCharacters <= 0 ||
  !result.nativeDialogs?.suppressed ||
  (verifyCanonicalNavigation &&
    (!result.navigation?.wizardDismissed ||
      result.navigation?.destinations?.length !== canonicalDestinations.length)) ||
  (verifyBehaviourFilters &&
    (!result.behaviourFilters?.sameVisibleFile || !result.behaviourFilters?.emptyConsistent))
)
  process.exit(1)
