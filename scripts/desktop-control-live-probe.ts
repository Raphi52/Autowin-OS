import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app, BrowserWindow } from 'electron'
import { WindowsDesktopController } from '../src/main/desktop-control'
import { captureElectronDesktop } from '../src/main/electron-desktop-capture'

app.commandLine.appendSwitch('disable-logging')

const evidenceDir = resolve(
  process.argv[2] ?? 'Audit/workspaces/codex-current/autowin-pc-control-workspace/evidence'
)
const temporaryDir = mkdtempSync(join(tmpdir(), 'autowin-desktop-probe-'))
const readyPath = join(temporaryDir, 'ready.txt')
const armPath = join(temporaryDir, 'arm.txt')
const armedPath = join(temporaryDir, 'armed.txt')
const resultPath = join(temporaryDir, 'result.txt')
const marker = `AUTOWIN_DESKTOP_PROBE_${Date.now()}`
const quoted = (value: string): string => value.replaceAll("'", "''")
const formScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = [System.Windows.Forms.Form]::new()
$form.Text = 'Autowin desktop control probe'
$form.StartPosition = 'CenterScreen'
$form.Size = [System.Drawing.Size]::new(820, 260)
$form.TopMost = $true
$box = [System.Windows.Forms.TextBox]::new()
$box.Dock = 'Fill'
$box.Multiline = $true
$box.Font = [System.Drawing.Font]::new('Consolas', 18)
$form.Controls.Add($box)
$script:moved = $false
$script:clicked = $false
$script:wheelDelta = 0
$box.Add_MouseMove({ $script:moved = $true })
$box.Add_MouseClick({ $script:clicked = $true })
$box.Add_MouseWheel({ $script:wheelDelta += $_.Delta })
$timer = [System.Windows.Forms.Timer]::new()
$timer.Interval = 50
$timer.Add_Tick({
  if (Test-Path -LiteralPath '${quoted(armPath)}') {
    $script:moved = $false
    $script:clicked = $false
    $script:wheelDelta = 0
    [System.IO.File]::WriteAllText('${quoted(armedPath)}', 'armed')
    $timer.Stop()
  }
})
$timer.Start()
$form.Add_Shown({
  $form.Activate()
  $box.Focus()
  [System.IO.File]::WriteAllText('${quoted(readyPath)}', 'ready')
})
$form.Add_FormClosed({
  $result = @{
    text = $box.Text
    moved = $script:moved
    clicked = $script:clicked
    wheelDelta = $script:wheelDelta
  } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText('${quoted(resultPath)}', $result)
})
[System.Windows.Forms.Application]::Run($form)
`

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timeout en attendant ${path}`)
    await delay(50)
  }
}

async function main(): Promise<void> {
  await app.whenReady()
  // Le produit dispose toujours d'une BrowserWindow. Le probe reproduit ce contexte afin que le
  // service Chromium de capture soit initialise comme dans Autowin, sans afficher une seconde fenetre.
  const electronHarness = new BrowserWindow({ show: false, width: 1, height: 1 })
  await electronHarness.loadURL('data:text/html,<title>Autowin desktop probe harness</title>')
  mkdirSync(evidenceDir, { recursive: true })
  const encoded = Buffer.from(formScript, 'utf16le').toString('base64')
  const form = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-STA', '-EncodedCommand', encoded],
    { windowsHide: false, stdio: 'ignore' }
  )

  try {
    await waitForFile(readyPath, 10_000)
    await delay(350)
    const forceForegroundWindow = process.env.AUTOWIN_PC_PROBE_FOREGROUND === '1'
    const controller = new WindowsDesktopController({
      capture: () => captureElectronDesktop({ forceForegroundWindow })
    })
    const observed = await controller.observe()
    const captureBytes = Buffer.from(observed.attachment.content, 'base64')
    writeFileSync(armPath, 'arm')
    await waitForFile(armedPath, 5_000)
    const omitPointer = process.env.AUTOWIN_PC_PROBE_SKIP_POINTER === '1'
    const action = await controller.act([
      ...(!omitPointer
        ? ([
            { type: 'move', x: 450, y: 500 },
            { type: 'click', x: 500, y: 500, button: 'left', clicks: 1 }
          ] as const)
        : []),
      { type: 'type', text: marker },
      ...(!omitPointer ? ([{ type: 'scroll', delta: 120, x: 500, y: 500 }] as const) : []),
      { type: 'wait', ms: 200 },
      { type: 'key', keys: ['ALT', 'F4'] }
    ])
    await waitForFile(resultPath, 10_000)
    const received = JSON.parse(readFileSync(resultPath, 'utf8')) as {
      text?: unknown
      moved?: unknown
      clicked?: unknown
      wheelDelta?: unknown
    }
    if (
      received.text !== marker ||
      received.moved !== true ||
      received.clicked !== true ||
      received.wheelDelta !== 120
    ) {
      throw new Error(`Effets desktop incomplets: ${JSON.stringify(received)}`)
    }
    const proof = {
      capturedAt: new Date().toISOString(),
      width: observed.data.width,
      height: observed.data.height,
      sourceWidth: observed.data.sourceWidth,
      sourceHeight: observed.data.sourceHeight,
      scope: observed.data.scope,
      captureBytes: captureBytes.length,
      captureSha256: createHash('sha256').update(captureBytes).digest('hex'),
      actionsExecuted: action.executed,
      typedMarkerVerified: true,
      pointerMoveVerified: true,
      clickVerified: true,
      scrollVerified: true
    }
    writeFileSync(
      join(evidenceDir, `desktop-live-${observed.data.scope}-proof.json`),
      `${JSON.stringify(proof, null, 2)}\n`
    )
    process.stdout.write(`${JSON.stringify(proof)}\n`)
  } finally {
    if (!form.killed) form.kill()
    electronHarness.destroy()
    rmSync(temporaryDir, { recursive: true, force: true })
  }
}

void main().then(
  () => app.exit(0),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    app.exit(1)
  }
)
