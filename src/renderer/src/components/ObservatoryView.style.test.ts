import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Observatory title typography', () => {
  it('uses the selected sans-serif display font only inside the Observatory header', () => {
    const css = readFileSync(new URL('./ObservatoryView.css', import.meta.url), 'utf8')

    expect(css).toMatch(
      /\.observatory-head \.module-header > h1\s*{[^}]*font-family:\s*'Segoe UI Variable Display',\s*'Segoe UI',\s*ui-sans-serif,\s*system-ui,\s*sans-serif/s
    )
  })
})
