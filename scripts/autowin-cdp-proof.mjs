import { writeFileSync } from 'node:fs'

const value = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const port = Number(value('--port', '9240'))
const output = value('--out', `C:/Amitel/Autowin OS/Audit/headless-instances/proof-${port}.png`)
const section = value('--section', '')
const theme = value('--theme', '')
const hoverTheme = value('--hover-theme', '')
const verifyBehaviourFilters = process.argv.includes('--verify-behaviour-filters')
const skipDialogs = process.argv.includes('--skip-dialogs')
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((item) => item.type === 'page')
if (!page) throw new Error(`Aucune page CDP sur le port ${port}`)
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let id = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const call = pending.get(message.id)
  if (!call) return
  pending.delete(message.id)
  message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result)
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const callId = ++id
  pending.set(callId, { resolve, reject })
  socket.send(JSON.stringify({ id: callId, method, params }))
})
if (theme) {
  const themeLabel = theme === 'transparent' ? 'Mode glass' : 'Mode dark'
  const switched = await send('Runtime.evaluate', {
    expression: `(() => {
      const target = document.querySelector(${JSON.stringify(`[aria-label="${themeLabel}"]`)})
      target?.click()
      return Boolean(target)
    })()`,
    returnByValue: true
  })
  if (!switched.result.value) throw new Error(`Mode visuel introuvable : ${theme}`)
  await new Promise((resolve) => setTimeout(resolve, 250))
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
const dialogs = skipDialogs ? { result: { value: { suppressed: true } } } : await send('Runtime.evaluate', {
  expression: `(async () => {
    const [workspace, diagnostics] = await Promise.all([
      window.api.chooseBehaviourWorkspace(),
      window.api.authorizeHermesDiagnostics()
    ])
    return { workspace, diagnostics, suppressed: workspace === null && diagnostics === null }
  })()`,
  awaitPromise: true,
  returnByValue: true
})
const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
socket.close()
const result = {
  port,
  screenshot: output,
  ...inspected.result.value,
  nativeDialogs: dialogs.result.value,
  ...(behaviourFilters ? { behaviourFilters } : {})
}
console.log(JSON.stringify(result))
if (
  !result.url ||
  result.bodyCharacters <= 0 ||
  !result.nativeDialogs?.suppressed ||
  (verifyBehaviourFilters &&
    (!result.behaviourFilters?.sameVisibleFile || !result.behaviourFilters?.emptyConsistent))
) process.exit(1)
