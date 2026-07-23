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

  it('uses the same serious-theme surface and selection palette as Models', () => {
    const css = readFileSync(new URL('./ObservatoryView.css', import.meta.url), 'utf8')
    const viewRule = css.match(/\.theme-serious \.observatory-view\s*{[^}]*}/s)?.[0]
    const selectedRule = css.match(
      /\.theme-serious \.observatory-view \.observatory-conversations > button\.is-active,[\s\S]*?\.theme-serious \.observatory-view \.observatory-event\.is-selected\s*{[^}]*}/
    )?.[0]

    expect(viewRule).toMatch(/--surface-selected:\s*rgba\(225,\s*193,\s*103,\s*0\.1\)/)
    expect(viewRule).toMatch(/background:\s*var\(--surface-panel\)/)
    expect(selectedRule).toMatch(/border-color:\s*rgba\(225,\s*193,\s*103,\s*0\.88\)/)
    expect(selectedRule).toMatch(/background:\s*var\(--surface-selected\)/)
  })

  it('keeps every serious-theme palette override scoped to Observatory', () => {
    const css = readFileSync(new URL('./ObservatoryView.css', import.meta.url), 'utf8')

    expect(css).toContain('.theme-serious .observatory-view .rag-trace-card')
    expect(css).toContain('.theme-serious .observatory-view .brain-nav-card')
    expect(css).not.toMatch(
      /\.theme-serious \.(?:rag-trace-card|brain-nav-card|brain-nav-candidates)/
    )
  })

  it('uses the Models gold selection in the critical-path view', () => {
    const css = readFileSync(new URL('./ObservatoryView.css', import.meta.url), 'utf8')
    const selectedCausalRule = css.match(
      /\.theme-serious \.observatory-view \.observatory-causal-node-wrap > button\.is-selected\s*{[^}]*}/s
    )?.[0]

    expect(selectedCausalRule).toMatch(/outline:\s*1px solid rgba\(225,\s*193,\s*103,\s*0\.88\)/)
  })
})
