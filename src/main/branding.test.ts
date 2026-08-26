import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const ALLOWED_LEGACY_FILE = 'src/shared/app-identity.ts'
// `.autowin-data` : depuis le stockage portable, les DONNÉES de l'app vivent dans le dépôt. Ce
// balayage cherche des traces de branding dans le CODE ; y inclure des conversations reviendrait à
// faire échouer le test sur ce qu'un modèle a écrit un jour, et non sur ce que le projet contient.
// `artifacts` : y vivent des COPIES completes du depot (worktrees de dogfood). Le balayage y
// retrouvait `src/shared/app-identity.ts` — le seul fichier ou ces constantes sont LEGITIMES —
// mais sous un chemin prefixe, donc hors de `ALLOWED_LEGACY_FILE` : 6 faux positifs sur 7, pour
// du code parfaitement conforme. Un garde qui crie sur des copies finit par n'etre plus lu.
const EXCLUDED = new Set([
  'node_modules',
  'out',
  'dist',
  'Audit',
  '.git',
  '.autowin-data',
  'artifacts',
  // Les worktrees des sessions Claude sont des COPIES du depot posees DANS l'arbre. Les scanner
  // faisait remonter 12 fausses violations le 2026-08-26 — le fichier de compatibilite legitime,
  // vu douze fois a travers quatre copies. Un garde qui accuse des copies de lui-meme n'accuse rien.
  '.claude'
])
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.mjs',
  '.ps1',
  '.md',
  '.json',
  '.yml',
  '.yaml',
  '.html',
  '.out'
])
const forbidden = new RegExp(
  [['agentic', 'os'].join('[- _]?'), ['Agentic', 'OS'].join(''), ['AGENTIC', 'OS'].join('_')].join(
    '|'
  ),
  'i'
)

function activeTextFiles(): string[] {
  const result: string[] = []
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDED.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        const dot = entry.name.lastIndexOf('.')
        const extension = dot >= 0 ? entry.name.slice(dot) : ''
        if (TEXT_EXTENSIONS.has(extension) && statSync(path).size <= 1_000_000) result.push(path)
      }
    }
  }
  visit(ROOT)
  return result
}

describe('identite Autowin OS', () => {
  it('conserve des sources textuelles sans octet NUL brut', () => {
    const violations = activeTextFiles()
      .filter((path) => readFileSync(path).includes(0))
      .map((path) => relative(ROOT, path).replaceAll('\\', '/'))

    expect(violations).toEqual([])
  })

  it('contains no legacy branding outside the single compatibility module', () => {
    const violations = activeTextFiles().flatMap((path) => {
      const rel = relative(ROOT, path).replaceAll('\\', '/')
      if (rel === ALLOWED_LEGACY_FILE) return []
      const lines = readFileSync(path, 'utf8').split(/\r?\n/)
      return lines.flatMap((line, index) =>
        forbidden.test(line) ? [`${rel}:${index + 1}: ${line.trim()}`] : []
      )
    })
    expect(violations).toEqual([])
  })

  it('packages and initializes the canonical Autowin OS identity', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version: string
      author: string
      homepage?: string
    }
    const builder = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')
    const prettierIgnore = readFileSync(join(ROOT, '.prettierignore'), 'utf8')
    const main = readFileSync(join(ROOT, 'src/main/index.ts'), 'utf8')
    const appShell = readFileSync(join(ROOT, 'src/renderer/src/App.tsx'), 'utf8')
    expect(builder).toContain('appId: com.amitel.autowin-os')
    expect(builder).toContain('productName: Autowin OS')
    expect(builder).toContain('executableName: autowin-os')
    expect(builder).toContain('maintainer: Amitel')
    expect(builder).toContain("  - '!.autowin-data/**'")
    expect(prettierIgnore.split(/\r?\n/)).toContain('.autowin-data')
    expect(builder).not.toMatch(/example\.com|electronjs\.org/)
    expect(manifest.author).toBe('Amitel')
    expect(manifest.homepage).toBeUndefined()
    expect(appShell).toContain("import packageManifest from '../../../package.json'")
    expect(appShell).toContain(
      '{`v${packageManifest.version} · build ${buildNumber} · ${buildSha}`}'
    )
    expect(appShell).not.toContain('v0 · MVP')
    expect(main.indexOf("app.setPath('userData'")).toBeGreaterThanOrEqual(0)
    expect(main.indexOf("app.setPath('userData'")).toBeLessThan(
      main.indexOf("app.getPath('userData')")
    )
    expect(main).toMatch(
      /resolveAutomationInstanceMode\(\s*process\.argv,\s*process\.env,\s*app\.isPackaged\s*\)/
    )
    expect(main).toContain('const isolatedTestInstance = automationInstanceMode.isolated')
    expect(main).toContain("query: isolatedTestInstance ? { instance: 'test' } : undefined")
    // STOCKAGE PORTABLE : la racine n'est plus `%APPDATA%` mais le dossier de l'app. Cette assertion
    // verrouillait l'ancienne source ; elle verrouille désormais la nouvelle, et surtout le PIÈGE du
    // packagé — viser `app.getAppPath()` y pointerait dans l'asar, où aucune écriture n'est possible.
    expect(main).toContain(
      "portableAppDataBase(app.getAppPath(), dirname(app.getPath('exe')), app.isPackaged)"
    )
    expect(main).not.toContain("resolveAutowinAppDataBase(app.getPath('appData')")
  })

  it('aligne le headless et la preuve CDP sur le binaire et le preload canoniques', () => {
    const headless = readFileSync(join(ROOT, 'scripts/autowin-headless.ps1'), 'utf8')
    const proof = readFileSync(join(ROOT, 'scripts/autowin-cdp-proof.mjs'), 'utf8')
    const chat = readFileSync(join(ROOT, 'src/renderer/src/components/ChatView.tsx'), 'utf8')
    const observatory = readFileSync(
      join(ROOT, 'src/renderer/src/components/ObservatoryView.tsx'),
      'utf8'
    )

    expect(headless).toContain(
      "[string]$Executable = 'C:\\Amitel\\Autowin OS\\dist\\win-unpacked\\autowin-os.exe'"
    )
    expect(headless).not.toContain('observatoire-final')
    expect(proof).toContain('window.api.authorizeDiagnostics()')
    expect(proof).not.toContain('authorizeHermesDiagnostics')
    expect(proof).toContain("process.argv.includes('--verify-navigation')")
    expect(proof).toContain('wizardDismissed')
    expect(proof).toContain('Délai CDP dépassé')
    expect(proof).toContain('writeFileSync(jsonOutput')
    expect(chat).toContain('data-testid="chat-view"')
    expect(observatory).toContain('data-testid="observatory-view"')
    for (const id of ['chat', 'agent-studio', 'knowledge', 'observatory', 'settings']) {
      expect(proof).toContain(`[data-testid="nav-${id}"]`)
      expect(proof).toContain(`[data-testid="${id}-view"]`)
    }
  })

  it('uses the transparent Autowin logo in the app shell while preserving packaging identity', () => {
    const appShell = readFileSync(join(ROOT, 'src/renderer/src/App.tsx'), 'utf8')
    const theme = readFileSync(join(ROOT, 'src/renderer/src/assets/theme.css'), 'utf8')
    const main = readFileSync(join(ROOT, 'src/main/index.ts'), 'utf8')
    const runtimeIcon = readFileSync(join(ROOT, 'resources/icon.png'))
    const packagingIcon = readFileSync(join(ROOT, 'build/icon.png'))

    expect(appShell).toContain("import autowinLogo from './assets/autowin-logo-transparent.png'")
    expect(appShell).toContain('className="brand-logo"')
    expect(appShell).not.toContain('className="brand-dot"')
    expect(packagingIcon).toEqual(runtimeIcon)
    expect(readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')).toContain(
      'icon: build/icon.ico'
    )
    expect(theme).toContain("url('./autowin-galaxy-bg-hq.png')")
    const galaxyBackground = readFileSync(
      join(ROOT, 'src/renderer/src/assets/autowin-galaxy-bg-hq.png')
    )
    expect(galaxyBackground.readUInt32BE(16)).toBe(3840)
    expect(galaxyBackground.readUInt32BE(20)).toBe(2160)
    expect(main).not.toContain("process.platform === 'linux' ? { icon } : {}")
    expect(main).toContain("icon: process.env['AUTOWIN_OS_DEV'] === '1' ? devIcon : icon")
    expect(main).toMatch(/titleBarOverlay:\s*\{[\s\S]*?color:\s*'#00000000'/)
    expect(readFileSync(join(ROOT, 'src/renderer/src/assets/cosmic-outline.css'), 'utf8')).toMatch(
      /\.cosmic-outline \.chat-layout\s*\{[\s\S]*?background:\s*var\(--surface-page\)/
    )
  })
})
