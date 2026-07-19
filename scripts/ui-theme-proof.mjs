import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const port = process.env.AUTOWIN_CDP_PORT
const outputDir = resolve(process.env.AUTOWIN_UI_PROOF_DIR || 'artifacts/ui-theme-proof')
const fingerprint = process.env.AUTOWIN_UI_FINGERPRINT || 'unbound'
const negativeControl = process.argv.includes('--negative-control')
const skipScreenshots = process.env.AUTOWIN_UI_SKIP_SCREENSHOTS === '1'
if (!port) throw new Error('AUTOWIN_CDP_PORT est requis.')

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error('Fenêtre Autowin introuvable via CDP.')

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
  socket.onopen = resolveOpen
  socket.onerror = reject
})
const send = (method, params = {}, timeoutMs = 15000) =>
  new Promise((resolveSend, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result?.value
}
const poll = async (expression, label, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await evaluate(expression)
    if (last?.ok) return last
    await wait(100)
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`)
}

await send('Page.enable')
await send('Runtime.enable')
mkdirSync(outputDir, { recursive: true })

const views = [
  { route: 'chat', nav: 'Chat', title: 'Conversations', root: '.chat-layout' },
  { route: 'memory', nav: 'Memory', title: 'Memory', root: '.graph-observatory' },
  { route: 'observatory', nav: 'Observatory', title: 'Observatory', root: '.observatory-view' },
  { route: 'agents', nav: 'Models', title: 'Models', root: '.agents-topology' },
  {
    route: 'capabilities',
    nav: 'Skills · Hooks · Tools',
    title: 'Skills · Hooks · Tools',
    root: '.capability-cockpit'
  },
  { route: 'behaviour', nav: 'Behaviour', title: 'Behaviour', root: '.behaviour-view' }
]
const themes = [
  { id: 'galaxy', aria: 'Mode glass', shellClass: 'theme-galaxy' },
  { id: 'noir', aria: 'Mode dark', shellClass: 'theme-serious' }
]

const manifest = []
try {
  for (const theme of themes) {
    const clickedTheme = await evaluate(
      `(() => { const button = document.querySelector('.app-theme-switch button[aria-label=${JSON.stringify(theme.aria)}]'); if (!button) return false; button.click(); return true })()`
    )
    if (!clickedTheme) throw new Error(`Bouton de thème absent: ${theme.aria}`)
    for (const view of views) {
      const clickedView = await evaluate(
        `(() => { const button = [...document.querySelectorAll('.nav-item')].find((item) => item.querySelector('span:last-child')?.textContent?.trim() === ${JSON.stringify(view.nav)}); if (!button) return false; button.click(); return true })()`
      )
      if (!clickedView) throw new Error(`Navigation absente: ${view.nav}`)
      const expectedTheme =
        negativeControl && theme.id === 'galaxy' && view.route === 'memory'
          ? 'theme-serious'
          : theme.shellClass
      const state = await poll(
        `(async () => {
        await document.fonts.ready;
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const shell = document.querySelector('.shell');
        const activeNav = [...document.querySelectorAll('.nav-item')].find((item) => item.classList.contains('active'));
        const activeSlots = [...document.querySelectorAll('.view-slot.is-active')];
        const slot = activeSlots[0];
        const root = slot?.querySelector(${JSON.stringify(view.root)});
        const title = slot?.querySelector('.module-header h1')?.textContent?.trim();
        const themeButton = document.querySelector('.app-theme-switch button[aria-label=${JSON.stringify(theme.aria)}]');
        const actual = {
          shellClass: [...(shell?.classList ?? [])].find((name) => name.startsWith('theme-')),
          activeNav: activeNav?.querySelector('span:last-child')?.textContent?.trim(),
          activeSlots: activeSlots.length,
          root: Boolean(root), title,
          themePressed: themeButton?.getAttribute('aria-pressed')
        };
        return { ok: actual.shellClass === ${JSON.stringify(expectedTheme)} && actual.activeNav === ${JSON.stringify(view.nav)} && actual.activeSlots === 1 && actual.root && actual.title === ${JSON.stringify(view.title)} && actual.themePressed === 'true', actual };
      })()`,
        `${theme.id}/${view.route}`
      )
      const badgeText = `route=${view.route} | title=${view.title} | theme=${theme.shellClass} | fp=${fingerprint.slice(0, 12)}`
      await evaluate(
        `(() => { const badge = document.createElement('div'); badge.id = 'autowin-proof-badge'; badge.textContent = ${JSON.stringify(badgeText)}; Object.assign(badge.style, { position:'fixed', right:'10px', bottom:'10px', zIndex:'2147483647', padding:'5px 8px', border:'1px solid #fff', background:'#000', color:'#fff', font:'10px monospace' }); document.body.appendChild(badge); return true })()`
      )
      const name = `${theme.id}-${view.route}.png`
      const pngPath = join(outputDir, name)
      let png
      if (!skipScreenshots) {
        const capture = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
        png = Buffer.from(capture.data, 'base64')
        writeFileSync(pngPath, png)
      }
      const metadata = {
        route: view.route,
        title: view.title,
        theme: theme.shellClass,
        fingerprint,
        port: Number(port),
        targetUrl: page.url,
        timestamp: new Date().toISOString(),
        state: state.actual,
        png: png ? basename(pngPath) : null,
        pngSha256: png ? sha256(png) : null
      }
      writeFileSync(`${pngPath}.json`, JSON.stringify(metadata, null, 2))
      manifest.push(metadata)
      await evaluate(`document.querySelector('#autowin-proof-badge')?.remove()`)
    }
  }
  writeFileSync(
    join(outputDir, 'manifest.json'),
    JSON.stringify({ fingerprint, count: manifest.length, captures: manifest }, null, 2)
  )
  if (manifest.length !== 12) throw new Error(`Preuve incomplète: ${manifest.length}/12`)
  console.log(
    JSON.stringify({ status: 'verified', count: manifest.length, outputDir, fingerprint })
  )
} finally {
  socket.close()
}
