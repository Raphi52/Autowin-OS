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

  it('renders one fixed serious shell without a global Glass control', () => {
    // Le THÈME GLOBAL reste unique (dark) : aucun sélecteur de thème au niveau App.
    // Le mode visuel du GRAPHE Memory (sombre/galaxy) est un réglage LOCAL à GraphView,
    // persisté par graph-settings — il ne remonte pas dans App.
    expect(app).toContain('className="shell cosmic-outline theme-serious"')
    expect(app).not.toMatch(/Mode glass|setVisualMode|visual-mode\.v1|ThemeIcon|GraphVisualMode/)
    expect(app).not.toMatch(/visualMode/)
    expect(app).toContain('<GraphView onCleanMemory={openBrainwashConversation} />')
  })

  it('removes global Galaxy branches and theme switch styling', () => {
    for (const css of [shellCss, modesCss, systemCss, topologyCss]) {
      expect(css).not.toMatch(/theme-galaxy|app-theme-switch|theme-switch-option/)
    }
  })
})
