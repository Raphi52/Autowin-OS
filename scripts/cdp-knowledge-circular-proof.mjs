import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { withDeviceMetricsOverride } from './cdp-device-metrics.mjs'

const root = 'C:\\Amitel\\Autowin OS'
const helper = join(root, 'scripts', 'autowin-headless.ps1')
const executable = join(root, 'dist', 'win-unpacked', 'autowin-os.exe')
const instanceId = `knowledge-circular-${Date.now()}`
const port = 9274
const runStamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const artifactsRoot = join(
  root,
  'Audit',
  'workspaces',
  '019fb386-13d6-7bd0-92e5-f033e2d79241',
  'knowledge-circular-workspace',
  'artifacts',
  runStamp
)
const fixtureRoot = join(root, 'Audit', 'headless-instances', instanceId, 'brain-fixture')
const targetSources = [
  join(root, 'src', 'main', 'viz', 'fs-brains.ts'),
  join(root, 'src', 'renderer', 'src', 'components', 'GraphView.tsx'),
  join(root, 'src', 'renderer', 'src', 'components', 'GraphView.css'),
  join(root, 'src', 'renderer', 'src', 'components', 'graph-camera.ts'),
  join(root, 'src', 'renderer', 'src', 'components', 'graph-settings.ts'),
  join(root, 'src', 'renderer', 'src', 'components', 'graph-tree-layout.ts'),
  join(root, 'src', 'renderer', 'src', 'components', 'graph-view-model.ts')
]

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

function note(title, frontmatter = '') {
  return `---\ntype: knowledge\nthemes: [theme/knowledge]\n${frontmatter}---\n\n# ${title}\n\nFixture ${runStamp}.\n`
}

rmSync(fixtureRoot, { recursive: true, force: true })
for (const folder of ['projects/alpha', 'projects/beta', 'knowledge/decisions', 'governance']) {
  mkdirSync(join(fixtureRoot, folder), { recursive: true })
}
writeFileSync(
  join(fixtureRoot, 'projects', 'alpha', 'current.md'),
  note(
    'Décision actuelle',
    'supersedes: [[projects/alpha/old.md]]\ncontradicts: [knowledge/decisions/alternative.md]\n'
  )
)
writeFileSync(join(fixtureRoot, 'projects', 'alpha', 'old.md'), note('Décision remplacée'))
writeFileSync(
  join(fixtureRoot, 'knowledge', 'decisions', 'alternative.md'),
  note('Décision contradictoire')
)
for (let index = 0; index < 18; index += 1) {
  const family = index % 2 === 0 ? 'alpha' : 'beta'
  writeFileSync(
    join(fixtureRoot, 'projects', family, `note-${String(index).padStart(2, '0')}.md`),
    note(`Note ${index}`)
  )
}
writeFileSync(join(fixtureRoot, 'governance', 'schema.md'), note('Schéma de gouvernance'))

let socket
try {
  const packageTime = statSync(executable).mtimeMs
  const staleTarget = targetSources.find((source) => statSync(source).mtimeMs > packageTime)
  if (staleTarget) throw new Error(`Package périmé pour la surface Knowledge : ${staleTarget}`)
  try {
    control('Stop')
  } catch {
    // Une instance précédente absente est le cas normal.
  }
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
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
    return response.result.value
  }
  const waitFor = async (expression, timeout = 45000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    throw new Error(`Timeout: ${expression}`)
  }
  const screenshot = async (name) => {
    const captured = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    const path = join(artifactsRoot, `${name}.png`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, Buffer.from(captured.data, 'base64'))
    return path
  }
  const settleRender = () =>
    evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      setTimeout(resolve, 250)
    })))`)
  const dismissWelcome = () =>
    evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(
        (item) => item.textContent?.trim() === 'Continuer quand même'
      )
      button?.click()
      return Boolean(button)
    })()`)

  await withDeviceMetricsOverride(
    send,
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    async () => {
      await waitFor(
        `document.readyState === 'complete' && document.body.innerText.includes('Knowledge')`
      )
      await dismissWelcome()
      const navigated = await evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find(
          (item) => item.textContent?.trim().includes('Knowledge')
        )
        button?.click()
        return Boolean(button)
      })()`)
      if (!navigated) throw new Error('Navigation Knowledge introuvable')
      await waitFor(`Boolean(document.querySelector('.graph-observatory select')?.value)`)
      await waitFor(`document.querySelector('.graph-refresh')?.disabled === false`)

      const panelAbsentBeforeToggle = await evaluate(
        `!document.querySelector('[aria-label="Relations à vérifier"]')`
      )
      const treeActivated = await evaluate(`(() => {
        const button = document.querySelector('.graph-layout-switch')
        button?.click()
        return Boolean(button)
      })()`)
      if (!treeActivated) throw new Error('Bascule arborescence introuvable')
      await waitFor(`document.querySelector('.graph-layout-switch')?.dataset.layoutMode === 'tree'`)
      await waitFor(`document.querySelector('.graph-canvas')?.dataset.treeZoomTier === 'overview'`)

      await evaluate(`document.querySelector('.graph-settings-button')?.click()`)
      await waitFor(`Boolean(document.querySelector('.graph-settings-popover'))`)
      const settingsText = await evaluate(
        `document.querySelector('.graph-settings-popover')?.textContent ?? ''`
      )
      const gestureHint = await evaluate(`document.querySelector('.graph-hint')?.textContent ?? ''`)
      const healthEnabled = await evaluate(`(() => {
        const label = [...document.querySelectorAll('.toggle-row')].find(
          (item) => item.textContent?.includes('Relations à vérifier')
        )
        label?.querySelector('input')?.click()
        return Boolean(label)
      })()`)
      if (!healthEnabled) throw new Error('Lentille de santé introuvable')
      await evaluate(`document.querySelector('.graph-settings-button')?.click()`)
      await waitFor(`Boolean(document.querySelector('.graph-health-issue'))`)

      const overview = await screenshot('01-overview-health')
      const branchBefore = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll('.tree-branch-controls button')]
        const button = buttons.sort(
          (left, right) => Number(right.dataset.treeLeaves) - Number(left.dataset.treeLeaves)
        )[0]
        return button ? {
          title: button.textContent,
          pressed: button.getAttribute('aria-pressed'),
          leaves: Number(button.dataset.treeLeaves),
          visibleNodes: Number(document.querySelector('.graph-canvas')?.dataset.treeVisibleNodes)
        } : null
      })()`)
      if (!branchBefore) throw new Error('Contrôle de branche accessible introuvable')
      await evaluate(`(() => {
        const buttons = [...document.querySelectorAll('.tree-branch-controls button')]
        buttons.sort((left, right) => Number(right.dataset.treeLeaves) - Number(left.dataset.treeLeaves))[0]?.click()
      })()`)
      await waitFor(
        `[...document.querySelectorAll('.tree-branch-controls button')].some(
          (button) => Number(button.dataset.treeLeaves) === ${branchBefore.leaves}
            && button.getAttribute('aria-pressed') === 'true'
        ) && Number(document.querySelector('.graph-canvas')?.dataset.treeVisibleNodes) < ${branchBefore.visibleNodes}`
      )
      await settleRender()
      const collapsedVisibleNodes = await evaluate(
        `Number(document.querySelector('.graph-canvas')?.dataset.treeVisibleNodes)`
      )
      const collapsed = await screenshot('02-collapsed-branch')
      await evaluate(`(() => {
        const button = [...document.querySelectorAll('.tree-branch-controls button')].find(
          (item) => Number(item.dataset.treeLeaves) === ${branchBefore.leaves}
        )
        button?.click()
      })()`)
      await waitFor(
        `[...document.querySelectorAll('.tree-branch-controls button')].some(
          (button) => Number(button.dataset.treeLeaves) === ${branchBefore.leaves}
            && button.getAttribute('aria-pressed') === 'false'
        ) && Number(document.querySelector('.graph-canvas')?.dataset.treeVisibleNodes) === ${branchBefore.visibleNodes}`
      )
      await settleRender()
      const restoredVisibleNodes = await evaluate(
        `Number(document.querySelector('.graph-canvas')?.dataset.treeVisibleNodes)`
      )

      const issueCount = await evaluate(`document.querySelectorAll('.graph-health-issue').length`)
      await evaluate(`document.querySelector('.graph-health-issue button')?.click()`)
      await waitFor(`Boolean(document.querySelector('.selected-node'))`)
      await waitFor(`document.querySelector('.graph-canvas')?.dataset.cameraSample === 'measured'
        && Number(document.querySelector('.graph-canvas')?.dataset.cameraZ) > 0
        && document.querySelector('.graph-canvas')?.dataset.treeZoomTier === 'notes'`)
      await settleRender()
      const focus = await screenshot('03-focused-note')

      const observed = await evaluate(`(() => ({
        layoutMode: document.querySelector('.graph-layout-switch')?.dataset.layoutMode,
        zoomTier: document.querySelector('.graph-canvas')?.dataset.treeZoomTier,
        zoomDistance: Number(document.querySelector('.graph-canvas')?.dataset.treeZoomDistance),
        cameraZ: Number(document.querySelector('.graph-canvas')?.dataset.cameraZ),
        cameraSample: document.querySelector('.graph-canvas')?.dataset.cameraSample,
        visibleNodes: Number(document.querySelector('.graph-canvas')?.dataset.treeVisibleNodes),
        healthIssues: document.querySelectorAll('.graph-health-issue').length,
        selected: document.querySelector('.selected-node strong')?.textContent,
        gesture: document.querySelector('.graph-hint')?.textContent,
        branchControls: document.querySelectorAll('.tree-branch-controls button').length
      }))()`)
      const inactiveSettings = [
        'Épaisseur des liens',
        'Flèches de direction',
        'Espacement des nœuds'
      ]
      const leakedSettings = inactiveSettings.filter((label) => settingsText.includes(label))
      const failures = [
        !panelAbsentBeforeToggle && 'health-negative-control',
        leakedSettings.length > 0 && `inactive-settings:${leakedSettings.join(',')}`,
        (!gestureHint.includes('déplacer') || gestureHint.includes('pivoter')) && 'gesture-hint',
        issueCount < 2 && 'explicit-health-relations',
        branchBefore.pressed !== 'false' && 'branch-negative-control',
        !(collapsedVisibleNodes < branchBefore.visibleNodes) && 'branch-collapse-no-effect',
        restoredVisibleNodes !== branchBefore.visibleNodes && 'branch-restore-no-effect',
        observed.layoutMode !== 'tree' && 'tree-mode',
        observed.zoomTier !== 'notes' && 'semantic-zoom',
        !(observed.cameraZ > 0) && 'planar-focus',
        observed.cameraSample !== 'measured' && 'camera-not-measured',
        observed.branchControls < 2 && 'branch-controls'
      ].filter(Boolean)
      const report = {
        status: failures.length === 0 ? 'valid' : 'invalid',
        capturedAt: new Date().toISOString(),
        runStamp,
        fixtureRoot,
        controls: {
          panelAbsentBeforeToggle,
          branchBefore,
          collapsedVisibleNodes,
          restoredVisibleNodes
        },
        observed,
        screenshots: { overview, collapsed, focus },
        failures
      }
      mkdirSync(artifactsRoot, { recursive: true })
      writeFileSync(join(artifactsRoot, 'result.json'), `${JSON.stringify(report, null, 2)}\n`)
      console.log(JSON.stringify(report))
      if (failures.length > 0) process.exitCode = 1
    }
  )
} finally {
  socket?.close()
  try {
    control('Stop')
  } catch {
    // L'erreur de preuve initiale reste prioritaire.
  }
}
