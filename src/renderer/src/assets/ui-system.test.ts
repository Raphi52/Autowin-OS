import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Autowin UI contract', () => {
  const css = readFileSync(new URL('./ui-system.css', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

  it('covers every active module root with the shared frame', () => {
    for (const root of ['.chat-layout', '.graph-observatory', '.observatory-view', '.agents-topology', '.capability-cockpit', '.behaviour-view']) {
      expect(css).toContain(root)
    }
  })

  it('loads the UI contract after legacy view and theme styles', () => {
    expect(app.indexOf("import './assets/ui-system.css'")).toBeGreaterThan(app.indexOf("import './assets/theme-modes.css'"))
  })

  it('does not wrap the capabilities module outside the shared frame root', () => {
    expect(app).not.toContain('className="capabilities-view"')
  })
})
