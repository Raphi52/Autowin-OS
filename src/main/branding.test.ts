import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const ALLOWED_LEGACY_FILE = 'src/shared/app-identity.ts'
const EXCLUDED = new Set(['node_modules', 'out', 'dist', 'Audit', '.git'])
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
    const builder = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')
    const main = readFileSync(join(ROOT, 'src/main/index.ts'), 'utf8')
    expect(builder).toContain('appId: com.amitel.autowin-os')
    expect(builder).toContain('productName: Autowin OS')
    expect(builder).toContain('executableName: autowin-os')
    expect(main.indexOf("app.setPath('userData'")).toBeGreaterThanOrEqual(0)
    expect(main.indexOf("app.setPath('userData'")).toBeLessThan(
      main.indexOf("app.getPath('userData')")
    )
    expect(main).toMatch(
      /resolveAutomationInstanceMode\(\s*process\.argv,\s*process\.env,\s*app\.isPackaged\s*\)/
    )
    expect(main).toContain('const isolatedTestInstance = automationInstanceMode.isolated')
    expect(main).toContain("resolveAutowinAppDataBase(app.getPath('appData'), app.isPackaged)")
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
