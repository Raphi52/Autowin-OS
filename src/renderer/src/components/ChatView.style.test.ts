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
    // Le souligne actif est rattache au jeton or (plus jamais #d4a94f en dur) :
    // il suit ainsi les huit themes au lieu de rester fige en sombre.
    expect(css).toMatch(
      /\.workflow-section-tab\.is-active\s*{[^}]*border-bottom-color:\s*var\(--gold-doux\)/s
    )
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
    /*
     * LE DEGRADE ROSE -> OR PASSE PAR DEUX JETONS, PLUS PAR DEUX HEX EN DUR.
     *
     * `#ff3cac` et `#ffd45a` etaient figes ici : le soulignement gardait donc les teintes de NUIT
     * sur une page claire. Ce test verrouillait ces deux hex, ce qui EMPECHAIT la reparation.
     *
     * Ce qui compte n'a jamais ete « ces deux codes-la », c'est « du rose vers l'or, dans cet
     * ordre ». On l'exige donc en deux temps, sans rien relacher : le degrade appelle les deux
     * jetons dans le bon ordre, ET theme.css leur donne bien la teinte de nuit d'origine. Entree
     * qui doit faire echouer : inverser les deux, ou changer une valeur dans theme.css.
     */
    expect(css).toMatch(
      /\.workflow-toggle\.is-active::after\s*{[^}]*height:\s*2px;[^}]*linear-gradient\(\s*90deg,\s*var\(--chat-wf-trait-rose\),\s*var\(--chat-wf-trait-or\)\s*\)/s
    )
    const theme = readFileSync(new URL('../assets/theme.css', import.meta.url), 'utf8')
    expect(theme).toMatch(/--chat-wf-trait-rose:\s*#ff3cac;/)
    expect(theme).toMatch(/--chat-wf-trait-or:\s*#ffd45a;/)
    // OR ET ROSE RATTACHES, JAMAIS ALTERES (decision produit du 2026-09-06) : en theme clair les
    // deux bouts partent vers la famille rose et la famille or, jamais vers un gris.
    const modes = readFileSync(new URL('../assets/theme-modes.css', import.meta.url), 'utf8')
    expect(modes).toMatch(/--chat-wf-trait-rose:\s*var\(--rose\w*\);/)
    expect(modes).toMatch(/--chat-wf-trait-or:\s*var\(--gold[\w-]*\);/)
  })
})

describe('minimal conversation status lights', () => {
  it('keeps the Native-style dot compact and reserves animation for running work', () => {
    const theme = readFileSync(new URL('../assets/theme.css', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    /*
     * LA TEINTE DE LA PASTILLE PASSE PAR UN JETON. Les cinq couleurs de `.conversation-state`
     * etaient ecrites en dur : les pastilles restaient donc en teintes de nuit sur une page
     * claire. Ce test verrouillait ces hex, ce qui empechait la reparation. On verrouille
     * desormais le JETON dans la regle, et sa valeur de nuit dans theme.css -- la geometrie et
     * le `currentColor`, eux, sont exiges exactement comme avant.
     */
    expect(css).toMatch(
      /\.conversation-state\s*{[^}]*width:\s*7px;[^}]*height:\s*7px;[^}]*background:\s*currentColor;[^}]*color:\s*var\(--chat-etat-defaut\);[^}]*box-shadow:/s
    )
    expect(theme).toMatch(/--chat-etat-defaut:\s*#38bdf8;/)
    // L'etat EN COURS n'est plus un pseudo-element anime : il rend le composant <Spinner/>
    // (.aw-atom), le MEME atome que partout ailleurs dans l'app. La pastille etait le dernier
    // endroit a recopier un atome CSS a bordures, d'ou un indicateur qui ne ressemblait a aucun
    // autre. On verrouille donc la SOURCE UNIQUE, pas la copie.
    const tsx = readFileSync(new URL('./ChatView.tsx', import.meta.url), 'utf8')
    expect(tsx).toMatch(/conversationState\.key === 'running' \? \(\s*<Spinner/s)
    expect(theme).toMatch(/\.aw-atom__rot\s*\{[^}]*animation:\s*aw-atom-spin/s)
    expect(css).toMatch(/\.conversation-state\.is-failed\s*{[^}]*color:\s*var\(--chat-etat-echec\)/s)
    expect(css).toMatch(
      /\.conversation-state\.is-interrupted\s*{[^}]*color:\s*var\(--chat-etat-interrompu\)/s
    )
    expect(theme).toMatch(/--chat-etat-echec:\s*#ff4057;/)
    expect(theme).toMatch(/--chat-etat-interrompu:\s*#ffb020;/)
    // La question en attente porte un JAUNE qui lui est propre : la confondre avec l'ambre des
    // tours interrompus reviendrait a ne rien signaler de nouveau.
    expect(css).toMatch(
      /\.conversation-state\.is-asking\s*{[^}]*color:\s*var\(--chat-etat-question\)/s
    )
    expect(theme).toMatch(/--chat-etat-question:\s*#facc15;/)
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
    /*
     * CE QUE CE CAS EXIGE VRAIMENT — et ce qu'il exigeait a tort.
     *
     * Il imposait `color: #d8f5e8`, une couleur ECRITE EN DUR. Elle etait juste tant que le fond
     * etait noir, et elle est devenue le defaut le jour ou l'application a eu des themes clairs :
     * un vert quasi blanc sur une page blanche, donc une preuve illisible. Un test qui verrouille
     * une valeur en dur EMPECHE de reparer ce genre de defaut au lieu de le prevenir.
     *
     * On exige donc la PROPRIETE qui compte : la couleur vient d'un jeton de theme, jamais d'un
     * quasi-blanc fige. Entree qui doit faire echouer : reecrire une couleur claire en dur.
     */
    expect(success).toMatch(/color:\s*var\(--text/)
    expect(success).not.toMatch(/color:\s*#[cdef][0-9a-f]{5}/i)
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
