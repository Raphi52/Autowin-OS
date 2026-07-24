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

  const ALL_KINDS = [
    'message',
    'injection',
    'decision',
    'tool-call',
    'tool-result',
    'model-response',
    'handoff',
    'verdict',
    'gate',
    'retry',
    'cancellation',
    'error',
    'boundary',
    'response-displayed'
  ] as const
  const readCss = (): string => readFileSync(new URL('./ObservatoryView.css', import.meta.url), 'utf8')
  const barColor = (css: string, kind: string): string | undefined => {
    const rule = css.match(new RegExp(`\\.observatory-event\\.is-${kind}\\s*{[^}]*}`, 's'))?.[0]
    return rule?.match(/box-shadow:\s*inset 3px 0 (#[0-9a-fA-F]{6})/)?.[1]?.toLowerCase()
  }

  it('donne une barre de couleur dédiée à CHAQUE type d’action', () => {
    const css = readCss()
    for (const kind of ALL_KINDS) {
      expect(barColor(css, kind), `is-${kind} devrait avoir une barre de couleur`).toMatch(
        /^#[0-9a-f]{6}$/
      )
    }
  })

  it('rend TOOL et TOOL RESULT distincts mais de la même famille', () => {
    const css = readCss()
    const tool = barColor(css, 'tool-call')
    const toolResult = barColor(css, 'tool-result')
    expect(tool).toBeTruthy()
    expect(toolResult).toBeTruthy()
    expect(tool).not.toBe(toolResult)
  })

  it('n’utilise ni l’or de sélection ni le cyan de comparaison comme accent de type', () => {
    const css = readCss()
    for (const kind of ALL_KINDS.filter((k) => k !== 'error')) {
      const bar = barColor(css, kind)
      expect(bar, `is-${kind} ne doit pas réutiliser l’or de sélection`).not.toBe('#e9bd4e')
      expect(bar, `is-${kind} ne doit pas réutiliser le cyan de comparaison`).not.toBe('#59dcff')
    }
  })

  it('conserve le rouge d’erreur existant (pas de régression)', () => {
    expect(barColor(readCss(), 'error')).toBe('#ff6078')
  })

  it('uses the Models gold selection in the critical-path view', () => {
    const css = readFileSync(new URL('./ObservatoryView.css', import.meta.url), 'utf8')
    const selectedCausalRule = css.match(
      /\.theme-serious \.observatory-view \.observatory-causal-node-wrap > button\.is-selected\s*{[^}]*}/s
    )?.[0]

    expect(selectedCausalRule).toMatch(/outline:\s*1px solid rgba\(225,\s*193,\s*103,\s*0\.88\)/)
  })

  it('keeps the RAG badge out of the 12px causal icon column', () => {
    const css = readCss()
    const badgeRule = css.match(/\.observatory-rag-node-badge\s*{[^}]*}/s)?.[0]

    expect(badgeRule).toMatch(/grid-column:\s*2\s*\/\s*-1/)
    expect(badgeRule).toMatch(/justify-self:\s*start/)
    expect(badgeRule).toMatch(/white-space:\s*nowrap/)
  })
})
