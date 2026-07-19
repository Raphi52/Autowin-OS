import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Autowin UI contract', () => {
  const css = readFileSync(new URL('./ui-system.css', import.meta.url), 'utf8')
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
})
