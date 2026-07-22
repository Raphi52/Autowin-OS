import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Observatory visual contracts', () => {
  it('uses the selected sans-serif display font only inside the Observatory header', () => {
    const css = readFileSync(new URL('./ObservatoryView.css', import.meta.url), 'utf8')

    expect(css).toMatch(
      /\.observatory-head \.module-header > h1\s*{[^}]*font-family:\s*'Segoe UI Variable Display',\s*'Segoe UI',\s*ui-sans-serif,\s*system-ui,\s*sans-serif/s
    )
  })

  it('keeps the six Observatory metric cards on one row when space is available', () => {
    const css = readFileSync(new URL('./ObservatoryView.css', import.meta.url), 'utf8')
    const metricsRule = css.match(/\.observatory-metrics\s*{[^}]*}/s)?.[0]

    expect(metricsRule).toMatch(/grid-template-columns:\s*repeat\(6,\s*minmax\(82px,\s*1fr\)\)/)
  })
})
