import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Autowin UI contract', () => {
  const css = readFileSync(new URL('./ui-system.css', import.meta.url), 'utf8')
  const themeModes = readFileSync(new URL('./theme-modes.css', import.meta.url), 'utf8')
  const cosmicOutline = readFileSync(new URL('./cosmic-outline.css', import.meta.url), 'utf8')
  const component = (name: string): string =>
    readFileSync(new URL(`../components/${name}`, import.meta.url), 'utf8')

  it('defines only reusable color and container primitives', () => {
    for (const token of [
      '--surface-page',
      '--surface-panel',
      '--surface-card',
      '--surface-inset',
      '--container-border',
      '--container-radius-page',
      '--container-radius-panel',
      '--container-shadow'
    ]) {
      expect(css).toContain(token)
    }
    expect(css).not.toMatch(/\.(graph|observatory|topology|cockpit|behaviour|chat|conv|runs)-/)
    expect(css).not.toMatch(/\b!important\b/)
    expect(css).not.toMatch(/^\s*(grid-template|width|height|overflow|position)\s*:/m)
  })

  it('uses ModuleHeader in every active product view', () => {
    for (const file of [
      'ChatView.tsx',
      'GraphView.tsx',
      'ObservatoryView.tsx',
      'AgentsTopologyView.tsx',
      'HermesControlsView.tsx',
      'BehaviourView.tsx'
    ]) {
      expect(component(file), file).toContain("import { ModuleHeader } from './ModuleHeader'")
      expect(component(file), file).toContain('<ModuleHeader')
    }
  })

  it('keeps Noir opaque and routes shared cosmic surfaces through semantic tokens', () => {
    expect(themeModes).toMatch(/\.theme-serious \.main\s*\{\s*background:\s*#000;/)
    expect(themeModes).toMatch(/\.theme-serious \.rail\s*\{[\s\S]*?background:\s*#000;/)
    for (const token of ['var(--surface-page)', 'var(--surface-panel)', 'var(--surface-card)', 'var(--surface-inset)']) {
      expect(cosmicOutline).toContain(token)
    }
  })

  it('centralizes module title typography without view-level overrides', () => {
    for (const token of [
      '--module-title-font: var(--display)',
      '--module-title-color: var(--text)',
      '--module-title-size: 22px',
      '--module-eyebrow-color: var(--text-faint)',
      '--module-eyebrow-size: 9px'
    ]) {
      expect(css).toContain(token)
    }

    const forbiddenOverrides: Array<[string, RegExp]> = [
      ['ObservatoryView.css', /\.observatory-head > div:first-child > span|\.observatory-head h1/],
      ['HermesControlsView.css', /\.cockpit-header > div:first-child > span|\.cockpit-header h1/],
      ['BehaviourView.css', /\.behaviour-view > header span|\.behaviour-view h1/],
      ['AgentsTopologyView.css', /\.topology-toolbar span/]
    ]

    for (const [file, selector] of forbiddenOverrides) {
      expect(component(file), file).not.toMatch(selector)
    }
  })
})
