import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('collapsed navigation rail', () => {
  it('keeps the application menu background opaque black', () => {
    const themeModes = readFileSync(new URL('./theme-modes.css', import.meta.url), 'utf8')
    const railRule = themeModes.match(/\.theme-serious \.rail\s*\{([^}]*)\}/s)?.[1] ?? ''

    expect(railRule).toMatch(/background:\s*#000\s*;/)
    expect(railRule).not.toMatch(/background:\s*rgba\(/)
  })

  it('renders Autowin OS as one uniform brand string', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(app).toMatch(/<span className="brand-name">\s*Autowin OS\s*<\/span>/s)
    expect(app).not.toContain('<b>OS</b>')
    expect(css).not.toContain('.brand b')
  })

  it('marks an isolated automation window so it cannot be mistaken for the user app', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(app).toContain("new URLSearchParams(window.location.search).get('instance') === 'test'")
    expect(app).toContain("data-automation-instance={testInstance ? 'test' : 'user'}")
    expect(app).toContain('INSTANCE DE TEST')
    expect(css).toContain('.test-instance-banner')
  })

  it('keeps the test marker above full-screen image and model-question overlays', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    const chatCss = readFileSync(new URL('../components/ChatView.css', import.meta.url), 'utf8')
    const questionCss = readFileSync(
      new URL('../components/ModelQuestionPopup.css', import.meta.url),
      'utf8'
    )
    const markerZ = Number(css.match(/\.test-instance-banner\s*{[^}]*z-index:\s*(\d+)/s)?.[1])
    const imageZ = Number(chatCss.match(/\.image-lightbox\s*{[^}]*z-index:\s*(\d+)/s)?.[1])
    const questionZ = Number(
      questionCss.match(/\.model-question-layer\s*{[^}]*z-index:\s*(\d+)/s)?.[1]
    )
    expect(markerZ).toBeGreaterThan(Math.max(imageZ, questionZ))
  })

  it('uses the selected Segoe UI Variable face for the Autowin OS brand title', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(css).toMatch(
      /\.brand-name\s*{[^}]*font-family:\s*'Segoe UI Variable Display',\s*'Segoe UI',\s*sans-serif/s
    )
    expect(css).toMatch(/\.brand-name\s*{[^}]*color:\s*#fff/s)
    expect(css).toMatch(
      /\.brand-name\s*{[^}]*text-shadow:\s*0 0 5px rgba\(255, 255, 255, 0\.78\),\s*0 0 10px rgba\(54, 230, 255, 0\.34\)/s
    )
  })

  it('hides labels without hiding the navigation icons', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(css).toContain('.rail.is-collapsed .nav-item > span:not(.space-toy-icon)')
    expect(css).not.toMatch(/\.rail\.is-collapsed \.nav-item > span,?\s*\n/)
  })

  it('keeps the collapsed controls square and reduces the gap before content', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.rail\.is-collapsed\s*{[^}]*width:\s*54px[^}]*padding-inline:\s*9px/s)
    // Géométrie verrouillée : 33px + margin-inline 0 3px, sinon l'icône ne peut pas
    // se décaler de 3px vers la gauche dans un rail de 54px (voir le test suivant).
    // `width` est ancré sur une frontière pour qu'un `max-width: 36px` ne le satisfasse pas.
    const collapsedNavItem =
      css.match(/\.rail\.is-collapsed \.nav-item\s*{([^}]*)}/s)?.[1] ?? ''
    expect(collapsedNavItem).toMatch(/(?:^|[;{\s])width:\s*33px\s*;/)
    expect(collapsedNavItem).toMatch(/(?:^|[;{\s])margin-inline:\s*0 3px\s*;/)
    expect(collapsedNavItem).toMatch(/(?:^|[;{\s])height:\s*36px\s*;/)
    expect(css).toMatch(
      /\.shell:has\(\.rail\.is-collapsed\) \.main\s*{[^}]*padding-left:\s*var\(--s2\)/s
    )
    expect(css).toMatch(/\.rail\.is-collapsed \.nav\s*{[^}]*overflow-x:\s*hidden/s)
    expect(css).not.toMatch(/(?:^|\n)\.nav\s*{[^}]*overflow-x:\s*hidden/s)
  })

  it('shifts navigation icons three pixels left only when the rail is collapsed', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(css).toMatch(
      /\.rail\.is-collapsed \.space-toy-icon\s*{[^}]*transform:\s*translateX\(-3px\)/s
    )
    expect(css).not.toMatch(/(?:^|\n)\.space-toy-icon\s*{[^}]*translateX\(-3px\)/s)
  })
})

describe('nappe de bruit organique (or/anthracite)', () => {
  const theme = () => readFileSync(new URL('./theme.css', import.meta.url), 'utf8')

  it('anime la nappe de fond sur une durée très lente (>= 120s)', () => {
    const before = theme().match(/body::before\s*{([^}]*)}/s)?.[1] ?? ''
    // Entrée qui doit faire échouer si la correction est fausse :
    // `animation: autowin-nappe 12s ...` (nappe rapide) ou aucune animation du tout.
    const duration = Number(before.match(/animation:\s*autowin-nappe\s+(\d+)s/)?.[1])
    expect(Number.isFinite(duration)).toBe(true)
    expect(duration).toBeGreaterThanOrEqual(120)
    expect(before).toMatch(/animation:\s*autowin-nappe\s+\d+s[^;]*\binfinite\b[^;]*\balternate\b/)
  })

  it('mêle or et anthracite dans la nappe, en plus du grain existant', () => {
    const before = theme().match(/body::before\s*{([^}]*)}/s)?.[1] ?? ''
    expect(before).toMatch(/var\(--gold\)/)
    expect(before).toMatch(/#1b1d22/i) // anthracite
    expect(before).toMatch(/feTurbulence/) // le grain d'origine n'est pas perdu
    expect(before).toMatch(/radial-gradient/)
  })

  it('déclare les keyframes de dérive et respecte prefers-reduced-motion', () => {
    const css = theme()
    const frames = css.match(/@keyframes autowin-nappe\s*{([\s\S]*?)\n}/)?.[1] ?? ''
    expect(frames).toMatch(/from\s*{/)
    expect(frames).toMatch(/to\s*{/)
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{[^}]*body::before\s*{[^}]*animation:\s*none/s
    )
  })
})
