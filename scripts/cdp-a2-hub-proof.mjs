import { writeFileSync } from 'node:fs'

const value = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const port = Number(value('--port', '9240'))
const width = Number(value('--width', '340'))
const output = value('--out', `a2-hub-${width}.png`)
const jsonOutput = value('--json-out', output.replace(/\.png$/i, '.json'))
const runId = value('--run-id', `a2hub-${Date.now()}`)
if (![340, 420].includes(width)) throw new Error(`Largeur A2 non autorisée : ${width}`)

const fixture = {
  status: {
    available: true,
    workspacePath: 'C:\\Amitel\\Autowin OS',
    repoId: 'a2-proof'
  },
  activity: [
    {
      agentId: 'proof-working',
      agentName: 'Builder',
      role: 'build',
      task: 'Sécuriser la reprise automatique',
      worktreePath: 'C:\\AppData\\autowin-os\\worktrees\\a2-proof\\agent__proof-working',
      state: 'working',
      verdict: 'running',
      publication: 'not-requested',
      files: [{ path: 'src/main/orchestrator.ts', kind: 'mod' }],
      startedAtMs: 1
    },
    {
      agentId: 'proof-ready',
      agentName: 'Agent récupéré',
      role: 'build',
      task: 'Tentative conservée',
      worktreePath: 'C:\\AppData\\autowin-os\\worktrees\\a2-proof\\agent__proof-ready',
      state: 'ready',
      verdict: 'red',
      publication: 'not-requested',
      recovered: true,
      files: [{ path: 'src/shared/worktree-activity-model.ts', kind: 'mod' }],
      startedAtMs: 2,
      endedAtMs: 3
    },
    {
      agentId: 'proof-conflict',
      agentName: 'Integrator',
      role: 'build',
      task: 'Ranger les changements vérifiés',
      worktreePath: 'C:\\AppData\\autowin-os\\worktrees\\a2-proof\\agent__proof-conflict',
      state: 'conflict',
      verdict: 'green',
      publication: 'blocked',
      conflictFile: 'src/main/os.ts',
      files: [{ path: 'src/main/os.ts', kind: 'mod' }],
      startedAtMs: 4,
      endedAtMs: 5
    },
    {
      agentId: 'proof-merged',
      agentName: 'Cleaner',
      role: 'clean',
      task: 'Nettoyer les résidus',
      worktreePath: 'C:\\AppData\\autowin-os\\worktrees\\a2-proof\\agent__proof-merged',
      state: 'merged',
      verdict: 'green',
      publication: 'complete',
      files: [{ path: 'scripts/verify-a2-hub.ps1', kind: 'add' }],
      startedAtMs: 6,
      endedAtMs: 7
    },
    {
      agentId: 'proof-published-residue',
      agentName: 'Publisher',
      role: 'build',
      task: 'Protéger une nouveauté arrivée après le retour',
      worktreePath: 'C:\\AppData\\autowin-os\\worktrees\\a2-proof\\agent__proof-published-residue',
      state: 'ready',
      verdict: 'green',
      publication: 'published',
      attentionReason: 'post-publish-change',
      publishedSha: 'a'.repeat(40),
      files: [{ path: 'notes-plus-recentes.tmp', kind: 'mod' }],
      startedAtMs: 8,
      endedAtMs: 9
    }
  ]
}

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((candidate) => candidate.type === 'page')
if (!page) throw new Error(`Aucune page CDP sur ${port}`)
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
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
  new Promise((resolve, reject) => {
    const id = ++sequence
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Délai CDP dépassé : ${method}`))
    }, 30_000)
    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timeout)
        resolve(result)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    })
    socket.send(JSON.stringify({ id, method, params }))
  })

await send('Runtime.enable')
const setup = await send('Runtime.evaluate', {
  expression: `(async () => {
    await window.api.setWorktreeFixture(${JSON.stringify(fixture)})
    document.querySelector('[data-testid="first-run-wizard"] .frw-primary')?.click()
    document.querySelector('[data-testid="nav-chat"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 120))
    if (!document.querySelector('.runs-pane')) document.querySelector('.workflow-toggle')?.click()
    await new Promise((resolve) => setTimeout(resolve, 120))
    const sourceControl = [...document.querySelectorAll('.runs-pane .conv-head button')]
      .find((button) => button.textContent?.trim() === 'Source control')
    sourceControl?.click()
    await new Promise((resolve) => setTimeout(resolve, 160))
    const worktree = document.querySelector('[data-testid="sc-view-worktree"]')
    worktree?.click()
    await new Promise((resolve) => setTimeout(resolve, 220))
    const pane = document.querySelector('.runs-pane')
    if (pane) {
      pane.style.width = '${width}px'
      pane.style.maxWidth = 'none'
    }
    await new Promise((resolve) => setTimeout(resolve, 120))
    const hub = document.querySelector('[data-testid="wt-view"]')
    const rect = pane?.getBoundingClientRect()
    const hubRect = hub?.getBoundingClientRect()
    const states = [...document.querySelectorAll('[data-testid="wt-agent-office"]')]
      .map((office) => office.getAttribute('data-state'))
    return {
      paneFound: Boolean(pane),
      hubFound: Boolean(hub),
      paneWidth: rect?.width ?? 0,
      hubWidth: hubRect?.width ?? 0,
      overflow: hub ? hub.scrollWidth - hub.clientWidth : 999,
      states,
      recovered: Boolean(document.querySelector('[data-recovered="true"]')),
      workspace: document.querySelector('[data-testid="wt-main-office"]')?.textContent ?? '',
      inbox: document.querySelector('[data-testid="wt-inbox"]')?.textContent ?? '',
      publishedResidue: [...document.querySelectorAll('[data-testid="wt-agent-office"]')]
        .find((office) => office.textContent?.includes('notes-plus-recentes.tmp'))?.textContent ?? '',
      clip: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
    }
  })()`,
  awaitPromise: true,
  returnByValue: true
})
const proof = setup.result.value
if (
  !proof?.paneFound ||
  !proof?.hubFound ||
  Math.abs(proof.paneWidth - width) > 1 ||
  proof.overflow > 1 ||
  !['working', 'ready', 'conflict', 'merged'].every((state) => proof.states.includes(state)) ||
  !proof.recovered ||
  !proof.workspace.includes('C:\\Amitel\\Autowin OS') ||
  !proof.inbox.includes('Changements entrants') ||
  !proof.publishedResidue.includes('déjà dans ton workspace') ||
  !proof.publishedResidue.includes('plus récent reste protégé')
) {
  throw new Error(`Preuve A2 invalide : ${JSON.stringify(proof)}`)
}

const screenshot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { ...proof.clip, scale: 1 },
  captureBeyondViewport: true
})
writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
const result = {
  runId,
  capturedAt: new Date().toISOString(),
  port,
  width,
  output,
  ...proof
}
writeFileSync(jsonOutput, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
socket.close()
console.log(JSON.stringify(result))
