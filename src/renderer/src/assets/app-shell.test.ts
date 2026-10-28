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

  // conv-929 (2026-10-13) : « fais en sorte que le logo rond tourne ». La machine de l'utilisateur
  // a `prefers-reduced-motion: reduce` ACTIF (voir theme.css) : une rotation coupée dans ce cas ne
  // tournerait jamais chez lui. Entrée qui doit faire échouer : aucune animation sur .brand-logo,
  // une rotation incomplète (< 360deg) ou une neutralisation sous prefers-reduced-motion.
  it('fait tourner le logo rond en continu, même avec les animations réduites', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    const logo = css.match(/(?:^|\n)\.brand-logo\s*{([^}]*)}/s)?.[1] ?? ''
    const name = logo.match(
      /animation:\s*([\w-]+)\s+\d+(?:\.\d+)?s[^;]*\blinear\b[^;]*\binfinite\b/
    )?.[1]
    expect(name).toBeTruthy()
    // conv-929 : 8 s par tour jugé « trop lent » par l'utilisateur.
    const duree = Number(logo.match(/animation:\s*[\w-]+\s+(\d+(?:\.\d+)?)s/)?.[1])
    expect(duree).toBeLessThanOrEqual(4)
    const frames = css.match(new RegExp(`@keyframes ${name}\\s*{([\\s\\S]*?)\\n}`))?.[1] ?? ''
    expect(frames).toMatch(/to\s*{\s*transform:\s*rotate\(360deg\)/)
    expect(css).not.toMatch(/prefers-reduced-motion[^@]*\.brand-logo/s)
  })

  it('hides labels without hiding the navigation icons', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(css).toContain('.rail.is-collapsed .nav-item > span:not(.space-toy-icon)')
    expect(css).not.toMatch(/\.rail\.is-collapsed \.nav-item > span,?\s*\n/)
  })

  it('keeps the collapsed controls square and reduces the gap before content', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    // 54 - 2 x 8 px - 2 x 1 px de bord (cadre Nébuleuse) = 36 px : la piste tient un item rond.
    expect(css).toMatch(/\.rail\.is-collapsed\s*{[^}]*width:\s*54px[^}]*padding-inline:\s*8px/s)
    // conv-198 : replié, l'item est un CARRÉ centré — un bord en capsule (999px) y dessine un
    // rond, pas un ovale. L'ancien 33 x 36 collé à gauche donnait un ovale décentré.
    // `width` est ancré sur une frontière pour qu'un `max-width: 36px` ne le satisfasse pas.
    // conv-1165 : 36 px FIXE débordait la piste sous 100 % de zoom (35,78 px à 90 %, bord du cadre
    // arrondi à 1,11 px) et `.nav` rognait le rond à droite. Il est donc BORNÉ à la piste
    // (`min(36px, 100%)`) et gardé rond par `aspect-ratio: 1` — une hauteur fixe en px annulerait ce
    // ratio et rendrait un ovale dès que la largeur cède.
    // conv-1178 : l'anneau de focus (Nébuleuse : 2 px + 2 px d'écart) se dessine HORS du rond et
    // `.nav` le rognait à gauche et à droite. Le rond cède 2 × `--rail-anneau` (≥ 4 px) sur la
    // piste, et la même marge haut/bas garde le pas des icônes.
    const collapsedNavItem =
      css.match(/\.rail\.is-collapsed \.nav-item\s*{([^}]*)}/s)?.[1] ?? ''
    const anneau = Number(collapsedNavItem.match(/--rail-anneau:\s*(\d+(?:\.\d+)?)px\s*;/)?.[1])
    expect(anneau).toBeGreaterThanOrEqual(4)
    expect(collapsedNavItem).toMatch(
      /(?:^|[;{\s])width:\s*calc\(\s*min\(\s*36px\s*,\s*100%\s*\)\s*-\s*2\s*\*\s*var\(--rail-anneau\)\s*\)\s*;/
    )
    expect(collapsedNavItem).toMatch(/(?:^|[;{\s])margin-block:\s*var\(--rail-anneau\)\s*;/)
    expect(collapsedNavItem).toMatch(/(?:^|[;{\s])aspect-ratio:\s*1\s*;/)
    expect(collapsedNavItem).not.toMatch(/(?:^|[;{\s])height:\s*\d+px/)
    expect(collapsedNavItem).toMatch(/(?:^|[;{\s])margin-inline:\s*auto\s*;/)
    expect(css).toMatch(
      /\.shell:has\(\.rail\.is-collapsed\) \.main\s*{[^}]*padding-left:\s*var\(--s2\)/s
    )
    expect(css).toMatch(/\.rail\.is-collapsed \.nav\s*{[^}]*overflow-x:\s*hidden/s)
    expect(css).not.toMatch(/(?:^|\n)\.nav\s*{[^}]*overflow-x:\s*hidden/s)
  })

  // conv-1208 : menu DÉPLIÉ, l'anneau de focus (Nébuleuse : 2 px + 2 px d'écart) dépassait de 4 px
  // de chaque côté de la capsule ouverte, qui remplit `.nav` ; `overflow-y: auto` le rognait à
  // gauche et à droite. `.nav` garde ≥ 4 px de marge intérieure, rendus par une marge négative
  // égale pour que les items ne bougent pas. Entrée qui doit échouer : la marge retirée, ou une
  // marge intérieure sans la marge négative (les items rétréciraient de 8 px).
  it('leaves room inside the menu for the focus ring of the open tab', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    const nav = css.match(/(?:^|\n)\.nav\s*{([^}]*)}/s)?.[1] ?? ''
    const anneau = Number(nav.match(/--nav-anneau:\s*(\d+(?:\.\d+)?)px\s*;/)?.[1])
    expect(anneau).toBeGreaterThanOrEqual(4)
    expect(nav).toMatch(/(?:^|[;{\s])padding:\s*var\(--nav-anneau\)\s*;/)
    expect(nav).toMatch(/(?:^|[;{\s])margin:\s*calc\(\s*-1\s*\*\s*var\(--nav-anneau\)\s*\)\s*;/)
  })

  // conv-198 : l'ancien translateX(-3px) mettait l'icône 3 px à gauche du centre de son rond.
  // Centrée par la flexbox seule, elle tombe au milieu du rond et sous le bouton de repli.
  it('never shifts the navigation icons off the centre of their round item', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(css).not.toMatch(/\.space-toy-icon\s*{[^}]*transform:\s*translate/s)
  })

  // conv-198 : un émoji (23,35 px à 17 px) déborde sa case de 18 px. Sans centrage de la piste,
  // il ne déborde qu'à droite : 2,7 px à droite du rond, alors que les icônes SVG restent centrées.
  it('centres the overflowing emoji glyph in its box when the rail is collapsed', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(css).toMatch(
      /\.rail\.is-collapsed \.space-toy-icon\s*{[^}]*place-content:\s*center\s*;/s
    )
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

// conv-981 : le nouveau theme s'ouvre en cercle PAR-DESSUS l'ancien. Une regle non qualifiee qui masque
// l'ancienne vue (`::view-transition-old(root) { opacity: 0 }`, travail de conv-987 sur le passage de
// vue) s'appliquerait aussi au theme : le cercle s'ouvrirait sur du vide. La regle qualifiee du cercle
// fixe donc l'opacite de l'ancien theme, et sa specificite l'emporte sur la regle non qualifiee.
describe('changement de theme en cercle', () => {
  it("garde l'ancien theme visible sous le cercle, meme si l'ancienne vue est masquee ailleurs", () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    )
    const regles = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, selecteurs]) =>
      selecteurs
        .split(',')
        .some((s) => s.trim() === ':root.theme-en-transition::view-transition-old(root)')
    )
    expect(regles.length).toBeGreaterThan(0)
    expect(regles.some(([, , corps]) => /(^|;|\s)opacity:\s*1\s*;/.test(corps))).toBe(true)
  })
})
