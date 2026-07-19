import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8')

describe('single Dark theme contract', () => {
  const app = read('./App.tsx')
  const shellCss = read('./assets/app-shell.css')
  const modesCss = read('./assets/theme-modes.css')
  const systemCss = read('./assets/ui-system.css')
  const topologyCss = read('./components/AgentsTopologyView.css')

  it('renders one fixed serious shell without a Glass control or persisted choice', () => {
    expect(app).toContain('className="shell cosmic-outline theme-serious"')
    expect(app).not.toMatch(/Mode glass|setVisualMode|visual-mode\.v1|ThemeIcon|GraphVisualMode/)
    expect(app.match(/visualMode/g)).toHaveLength(1)
    expect(app).toContain(
      '<GraphView visualMode="serious" onCleanMemory={openBrainwashConversation} />'
    )
  })

  it('removes global Galaxy branches and theme switch styling', () => {
    for (const css of [shellCss, modesCss, systemCss, topologyCss]) {
      expect(css).not.toMatch(/theme-galaxy|app-theme-switch|theme-switch-option/)
    }
  })
})
