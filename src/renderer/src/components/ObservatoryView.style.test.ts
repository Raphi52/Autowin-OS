import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Observatory visual contracts', () => {
  it('ne redéfinit PAS la police du titre : elle suit celle de toutes les vues', () => {
    // Ce test exigeait l'INVERSE : que le titre d'Observatory soit en `'Segoe UI Variable Display',
    // …, sans-serif`, alors que `--module-title-font` vaut `--display` = `Georgia, serif` partout
    // ailleurs. Il epinglait donc une divergence, SANS enoncer de raison — aucun commentaire, aucune
    // trace de decision. L'utilisateur a explicitement demande que la police soit la meme d'un onglet
    // a l'autre : c'est cette instruction, datee et attribuable, qui tranche contre une assertion
    // muette. Si un motif de densite justifiait le sans-serif, il devra revenir avec son motif ecrit.
    const css = readFileSync(new URL('./ObservatoryView.css', import.meta.url), 'utf8')

    expect(css).not.toMatch(/\.module-header\s*>?\s*h1\s*{[^}]*font-family/s)
  })

  it('porte le liseré rose→doré du haut, à l’identique des autres vues', () => {
    // Test venu d'une session CONCURRENTE, conservé avec son intention : « empêcher les deux vues de
    // dériver l'une de l'autre, ce que deux copies manuelles font toujours ». Il cherchait le liseré
    // DANS la règle `.observatory-view`, où cette session-là venait de le recopier depuis
    // `TaskManagerView.css`. Entre-temps le liseré a été SORTI dans `.view-page`, consommé par les
    // sept vues : la copie n'existe plus, donc l'intention est mieux servie qu'elle ne le demandait —
    // il n'y a plus deux formes à comparer, il n'y en a qu'une. Le test vérifie désormais cette
    // source unique, et qu'Observatory la consomme au lieu de redécrire un cadre en propre.
    const cadre = readFileSync(new URL('./ViewPage.css', import.meta.url), 'utf8')
    const observatory = readFileSync(new URL('./ObservatoryView.css', import.meta.url), 'utf8')
    const liseré =
      /linear-gradient\(\s*90deg,\s*var\(--rose\),\s*transparent 42%,\s*color-mix\(in srgb, var\(--gold\) 70%, transparent\)\s*\)/s

    // MERGE de deux tournures concurrentes du meme test, vers le sur-ensemble de leurs intentions.
    // 3ᵉ formulation de ce lisere, et la meilleure : il est devenu un TOKEN declare sur `.shell`, que
    // chaque vue COMPOSE avec son propre fond. Ce test epinglait le litteral dans `.view-page` ; il
    // suit desormais la source reelle, sinon il interdirait l'amelioration qu'il pretend proteger.
    // Ce qu'on garantit reste le meme : UNE definition, et Observatory la consomme.
    // Deux exigences viennent de l'autre tournure, plus strictes et conservees : la VIRGULE apres le
    // token (elle prouve une COMPOSITION, pas un remplacement), et le bord verifie dans la regle
    // `.view-page` elle-meme plutot que n'importe ou dans la feuille.
    const regleCadre = cadre.match(/\.view-page\s*{[^}]*}/s)?.[0]
    expect(cadre.match(/\.shell\s*{[^}]*}/s)?.[0]).toMatch(liseré)
    expect(regleCadre).toMatch(/background:\s*var\(--lisere-haut\),/)
    expect(regleCadre).toMatch(/border: 1px solid color-mix\(in srgb, var\(--rose\) 34%/)
    // Et Observatory ne repart pas en solo : aucun cadre redécrit dans sa propre règle.
    const regleObservatory = observatory.match(/\.observatory-view\s*{[^}]*}/s)?.[0]
    expect(regleObservatory).not.toMatch(liseré)
    expect(regleObservatory).not.toMatch(/border:/)
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
    // La surface de Models est CONSERVEE, mais desormais composee avec le lisere partage : la regle
    // s'ecrit `var(--lisere-haut), var(--surface-panel)`. L'assertion d'origine exigeait
    // `var(--surface-panel)` SEUL, ce qui interdisait toute couche par-dessus — et c'est cette
    // exigence qui a fait disparaitre le lisere d'Observatory. L'intention (« meme surface que
    // Models ») est intacte ; seule la forme exacte de la declaration est assouplie.
    expect(viewRule).toMatch(/background:\s*var\(--lisere-haut\),\s*var\(--surface-panel\)/)
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
  const readCss = (): string =>
    readFileSync(new URL('./ObservatoryView.css', import.meta.url), 'utf8')
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

  it('habille les boutons TRANSCRIPTS comme les autres listes du panneau', () => {
    // Vu le 2026-08-07 dans l'app : les entrees TRANSCRIPTS s'affichaient en PAVES CLAIRS, police
    // systeme, dans une vue sombre — parce que `.observatory-transcripts button` avait ete oublie de
    // la regle partagee des listes. Un bouton sans regle retombe sur le style par defaut du
    // navigateur : c'est invisible en test unitaire, et criant a l'ecran.
    const css = readFileSync(new URL('./ObservatoryView.css', import.meta.url), 'utf8')
    const listeRule = css.match(/[^}]*\.observatory-diagnostics button\s*{[^}]*}/s)?.[0]

    expect(listeRule).toMatch(/\.observatory-transcripts button/)
    expect(listeRule).toMatch(/background:\s*var\(--surface-card\)/)

    // Le theme serious a sa PROPRE liste de surcharges : l'oubli s'y repetait a l'identique.
    const seriousRule = css.match(
      /[^}]*\.theme-serious \.observatory-view \.observatory-diagnostics button,[^}]*{[^}]*}/s
    )?.[0]
    expect(seriousRule).toMatch(
      /\.theme-serious \.observatory-view \.observatory-transcripts button/
    )
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
