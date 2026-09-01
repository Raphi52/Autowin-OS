import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('chat wallpaper', () => {
  it('keeps the root layout free of backdrop blur', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    const layout = css.match(/\.chat-layout\s*{([^}]*)}/s)?.[1]
    expect(layout).toBeDefined()
    expect(layout).not.toContain('backdrop-filter')
  })
})

describe('chat message scrolling', () => {
  it('does not pin user messages to the top of the conversation', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    const userMessage = css.match(/\.msg\.user\s*{([^}]*)}/s)?.[1]

    expect(userMessage).toBeDefined()
    expect(userMessage).not.toMatch(/position:\s*sticky/)
    expect(userMessage).not.toMatch(/top:\s*0/)
  })
})

describe('chat message image attachments', () => {
  it('keeps image thumbnails proportional and contained in their message', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    const thumbnail = css.match(/\.attachment-thumb\s*{([^}]*)}/s)?.[1]

    expect(thumbnail).toBeDefined()
    expect(thumbnail).toMatch(/max-width:\s*100%/)
    expect(thumbnail).toMatch(/object-fit:\s*contain/)
    expect(css).not.toMatch(/\.attachment-chip button\s*{[^}]*width:\s*17px/s)
  })
})

describe('chat top bar surface', () => {
  it('uses the page surface through a transparent header while keeping its separator', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    expect(css).toMatch(
      /\.cosmic-outline \.chat-head\s*{[^}]*border-bottom:\s*1px solid rgba\(212, 225, 239, 0\.18\)[^}]*background:\s*transparent/s
    )
  })
})

describe('workflow sidebar header', () => {
  /**
   * L'en-tete ne porte NI titre NI rangee de pilules : depuis le 2026-09-01 elle porte les trois
   * onglets (Graph / Runs / Logs) a gauche et les actions a droite, sur UNE seule ligne. Ce test
   * remplace celui qui figeait un titre et INTERDISAIT toute regle `.workflow-section-` : les deux
   * exigences ont ete revoquees par l'utilisateur. Ce qu'il garde : la barre reste a hauteur fixe,
   * les actions restent fixes, et le CSS du titre supprime ne survit pas au balisage retire.
   */
  it('keeps a fixed-height header with the three tabs, fixed actions, and no dead title rule', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')

    expect(css).toMatch(
      /\.workflow-panel-head\s*{[^}]*display:\s*flex;[^}]*min-width:\s*0;[^}]*height:\s*34px/s
    )
    // Le titre a ete retire du balisage : sa regle ne doit pas survivre en CSS mort.
    expect(css).not.toMatch(/\.workflow-panel-title/)
    expect(css).toMatch(/\.workflow-panel-actions\s*{[^}]*width:\s*56px;[^}]*flex:\s*none/s)
    // Les onglets, eux, ont bien leur traitement : souligne actif, aucun fond opaque.
    expect(css).toMatch(/\.workflow-section-tab\.is-active\s*{[^}]*border-bottom-color:\s*#d4a94f/s)
    expect(css).toMatch(/\.workflow-section-tabs\s*{[^}]*display:\s*flex/s)
  })
})

describe('workflow header toggle', () => {
  it('uses the approved linear-tab treatment without changing the workflow label', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    const source = readFileSync(new URL('./ChatView.tsx', import.meta.url), 'utf8')

    expect(source).toMatch(/workflow-toggle\$\{showRuns \? ' is-active' : ''\}/)
    expect(source).toContain('Détails{openRunsCount > 0')
    expect(css).toMatch(
      /\.workflow-toggle\s*{[^}]*position:\s*relative;[^}]*border:\s*0;[^}]*background:\s*transparent/s
    )
    expect(css).toMatch(
      /\.workflow-toggle\.is-active::after\s*{[^}]*height:\s*2px;[^}]*linear-gradient\(90deg,\s*#ff3cac,\s*#ffd45a\)/s
    )
  })
})

describe('minimal conversation status lights', () => {
  it('keeps the Native-style dot compact and reserves animation for running work', () => {
    const theme = readFileSync(new URL('../assets/theme.css', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    expect(css).toMatch(
      /\.conversation-state\s*{[^}]*width:\s*7px;[^}]*height:\s*7px;[^}]*background:\s*currentColor;[^}]*color:\s*#38bdf8;[^}]*box-shadow:/s
    )
    // L'etat EN COURS n'est plus un pseudo-element anime : il rend le composant <Spinner/>
    // (.aw-atom), le MEME atome que partout ailleurs dans l'app. La pastille etait le dernier
    // endroit a recopier un atome CSS a bordures, d'ou un indicateur qui ne ressemblait a aucun
    // autre. On verrouille donc la SOURCE UNIQUE, pas la copie.
    const tsx = readFileSync(new URL('./ChatView.tsx', import.meta.url), 'utf8')
    expect(tsx).toMatch(/conversationState\.key === 'running' \? \(\s*<Spinner/s)
    expect(theme).toMatch(/\.aw-atom__rot\s*\{[^}]*animation:\s*aw-atom-spin/s)
    expect(css).toMatch(/\.conversation-state\.is-failed\s*{[^}]*color:\s*#ff4057/s)
    expect(css).toMatch(/\.conversation-state\.is-interrupted\s*{[^}]*color:\s*#ffb020/s)
    // La question en attente porte un JAUNE qui lui est propre : la confondre avec l'ambre des
    // tours interrompus reviendrait a ne rien signaler de nouveau.
    expect(css).toMatch(/\.conversation-state\.is-asking\s*{[^}]*color:\s*#facc15/s)
    // PLUS DE reduced-motion SUR LE SPINNER — decision du 2026-08-28, verrouillee par
    // assets/spinner-motion.test.ts : le spinner est un indicateur d'ETAT, pas un effet
    // decoratif. Fige, il affirme faussement que rien ne tourne. Reintroduire l'assertion
    // inverse ici ferait echouer ce test-la : les deux ne peuvent pas etre vrais ensemble.
  })
})

describe('model final summary', () => {
  it('uses a scoped gold frame without backdrop blur', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    const summary = css.match(/\.md-final-summary\s*{([^}]*)}/s)?.[1]

    expect(summary).toBeDefined()
    expect(summary).toMatch(/border:\s*1px solid rgba\(229, 184, 91,/)
    expect(summary).toContain('background: linear-gradient(')
    expect(summary).not.toContain('backdrop-filter')
  })
})

describe('chat action outcome', () => {
  it('keeps a successful orchestration label readable over its success background', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    const success = css.match(/\.activity-outcome\.st-ok\s*{([^}]*)}/s)?.[1]

    expect(success).toBeDefined()
    expect(success).toMatch(/background:\s*color-mix\([^;]+12%,\s*transparent\)/)
    expect(success).toMatch(/color:\s*#d8f5e8/)
  })
})

describe('chat image containment', () => {
  it('keeps thumbnails inside their chip and lightbox images inside the viewport', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    const thumb = css.match(/\.attachment-thumb\s*{([^}]*)}/s)?.[1]
    const thumbButton = css.match(/\.attachment-chip \.attachment-thumb-button\s*{([^}]*)}/s)?.[1]
    const lightboxImage = css.match(/\.image-lightbox-content img\s*{([^}]*)}/s)?.[1]

    expect(thumb).toContain('max-width: 100%')
    expect(thumb).toContain('max-height: 100%')
    expect(thumb).toContain('object-fit: contain')
    expect(thumbButton).toMatch(/width:\s*34px/)
    expect(thumbButton).toMatch(/height:\s*34px/)
    expect(thumbButton).toContain('overflow: hidden')
    expect(lightboxImage).toContain('max-width: min(calc(100vw - 64px), 1800px)')
    expect(lightboxImage).toContain('max-height: calc(100vh - 64px)')
    expect(lightboxImage).toContain('object-fit: contain')
  })
})
