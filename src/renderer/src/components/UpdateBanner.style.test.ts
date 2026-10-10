import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./UpdateBanner.css', import.meta.url), 'utf8')
const component = readFileSync(new URL('./UpdateBanner.tsx', import.meta.url), 'utf8')

const chatCss = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')

/** Corps de la PREMIÈRE règle dont la liste de sélecteurs contient exactement `selecteur`. */
const regle = (feuille: string, selecteur: string): string | null => {
  for (const m of feuille.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    // Virgules de PREMIER niveau seulement : `:is(:disabled, :not(…))` en contient aussi.
    const selecteurs: string[] = []
    let profondeur = 0
    let courant = ''
    for (const c of m[1].replace(/\/\*[\s\S]*?\*\//g, '')) {
      if (c === '(') profondeur++
      if (c === ')') profondeur--
      if (c === ',' && profondeur === 0) {
        selecteurs.push(courant.trim())
        courant = ''
      } else courant += c
    }
    selecteurs.push(courant.trim())
    if (selecteurs.includes(selecteur)) return m[2]
  }
  return null
}

describe('boutons de mise à jour — même gueule que Détails (conv-181)', () => {
  // Demande du 2026-10-10 : « fais en sorte que ces boutons aient la même gueule que le bouton
  // Détails ». L'ancien cadre « Or royal » (bord doré droit, 37 px) est remplacé par la capsule.
  it('« Fusionner » et « Faire réparer » portent le balisage de la capsule de Détails', () => {
    expect(component).toContain('rail-update-btn capsule-bouton')
    expect(component).toContain('rail-update-repair capsule-bouton')
    expect(component.match(/className="thinking-capsule"/g)).toHaveLength(2)
    expect(component).toContain('thinking-capsule-icone rail-update-icon')
    // Le nombre de commits va dans la pastille sombre, comme les compteurs de Détails.
    expect(component).toContain('thinking-duree rail-update-count')
    // L'emoji en couleur jurait dans le rond dégradé : la clé est dessinée.
    expect(component).not.toContain('🔧')
  })

  it('les règles de la capsule de Détails dessinent aussi `.capsule-bouton`', () => {
    for (const s of [
      '.capsule-bouton .thinking-capsule',
      '.capsule-bouton .thinking-capsule::before',
      '.capsule-bouton .thinking-capsule-icone',
      '.capsule-bouton .thinking-label',
      '.capsule-bouton .thinking-duree'
    ]) {
      expect(regle(chatCss, s), s).not.toBeNull()
    }
    // Au repos : l'aspect de Détails fermé (même règle que `.thinking-block.is-done`).
    expect(
      regle(
        chatCss,
        '.capsule-bouton:is(:disabled, :not(:hover, :focus-visible)) .thinking-capsule'
      )
    ).toBe(
      regle(
        chatCss,
        '.thinking-block.is-done > summary:not(:focus-visible) .thinking-capsule:not(:hover)'
      )
    )
    // Pas de chevron : un bouton d'action ne déplie rien.
    expect(chatCss).not.toContain('.capsule-bouton .thinking-capsule::after')
  })

  it('les capsules éteintes s’allument au survol et au focus, comme « Fusionner » (conv-192)', () => {
    // « je veux que ça les allume quand je les hover comme le bouton Fusionner » : images lues /
    // envoyées, Détails, Raisonnement, Actions. Chaque règle « éteinte » doit céder au survol de la
    // capsule et au focus clavier de l'en-tête ; aucune ne doit s'appliquer sans condition.
    const sansCommentaires = chatCss.replace(/\/\*[\s\S]*?\*\//g, '')
    const eteintes = [...sansCommentaires.matchAll(/([^{}]+)\{/g)]
      .flatMap((m) => m[1].split(/,(?![^(]*\))/).map((s) => s.trim()))
      .filter((s) => s.startsWith('.thinking-block.is-done > summary'))
    expect(eteintes.length).toBe(6)
    for (const s of eteintes) {
      expect(s, s).toMatch(/^\.thinking-block\.is-done > summary:not\(:focus-visible\) \.thinking-capsule:not\(:hover\)/)
    }
  })

  it('laisse de l’air entre le bord dégradé et le contenu du bouton « Fusionner » (conv-192)', () => {
    // Constat du 2026-10-10 : « il est trop petit le cadre ». À 0.25em de marge (2,75 px à 11 px),
    // le bord de 2 px laissait moins d'1 px autour du rond de l'icône et de la pastille « +1 ».
    const corps = regle(css, '.rail-update-btn.capsule-bouton .thinking-capsule') ?? ''
    const marge = corps.match(/^\s*padding\s*:\s*([\d.]+)em\s*;/m)
    expect(marge, 'une marge uniforme en em').not.toBeNull()
    expect(corps).not.toMatch(/padding-(top|right|bottom|left)\s*:/)
    const airPx = Number(marge?.[1]) * 11 - 2
    expect(airPx).toBeGreaterThanOrEqual(2)
  })

  it('laisse au bouton « Faire réparer » le même air que « Fusionner », replié excepté (conv-192)', () => {
    const corps = regle(css, '.rail-update-repair.capsule-bouton .thinking-capsule') ?? ''
    for (const prop of ['padding-block', 'padding-left']) {
      const m = corps.match(new RegExp(`^\\s*${prop}\\s*:\\s*([\\d.]+)em\\s*;`, 'm'))
      expect(m, prop).not.toBeNull()
      expect(Number(m?.[1]) * 11 - 2, prop).toBeGreaterThanOrEqual(2)
    }
    // Replié, la règle du rond (0.25em, comme Fusionner replié) doit venir APRÈS : même priorité.
    const sans = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(sans.indexOf('.rail-update-repair.is-glyph .thinking-capsule')).toBeGreaterThan(
      sans.indexOf('.rail-update-repair.capsule-bouton .thinking-capsule')
    )
  })

  it('laisse le même air sous le bord des capsules d’en-tête : images, Détails, Raisonnement, Actions (conv-192)', () => {
    // « pareil pour image read / Image sent / Détails / Raisonnement et Actions » : toutes passent
    // par `.thinking-block > summary .thinking-capsule`, en-tête à 12 px.
    const regles = [...chatCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => m[1].trim() === '.thinking-block > summary .thinking-capsule')
      .map((m) => m[2])
    const derniere = (prop: string): number | null => {
      let valeur: number | null = null
      for (const corps of regles)
        for (const m of corps.matchAll(new RegExp(`^\\s*${prop}\\s*:\\s*([\\d.]+)em\\s*;`, 'gm')))
          valeur = Number(m[1])
      return valeur
    }
    for (const prop of ['padding-block', 'padding-left']) {
      const em = derniere(prop)
      expect(em, prop).not.toBeNull()
      expect(Number(em) * 12 - 2, prop).toBeGreaterThanOrEqual(2)
    }
  })

  it('donne à l’œil la hauteur de la capsule « Fusionner », déplié comme replié (conv-192)', () => {
    // L'œil est un rond JUMEAU de la capsule voisine. Hauteur de la capsule = rond de son icône
    // (1.6em) + marge haute et basse. Les 23 px fixes ne suivaient pas la marge passée à 0.4em.
    // TOUTES les règles qui citent le sélecteur, pas seulement la première : `.rail-update-who`
    // figure d'abord dans la règle de taille de police, puis dans la sienne.
    const toutes = (selecteur: string): string[] => {
      const corps: string[] = []
      for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const liste = m[1].split(/,(?![^(]*\))/).map((s) => s.trim())
        if (liste.includes(selecteur)) corps.push(m[2])
      }
      return corps
    }
    /** Dernière valeur en em de `prop` posée sur ce sélecteur exact (la cascade garde la dernière). */
    const em = (selecteur: string, prop: string): number => {
      let valeur = NaN
      for (const corps of toutes(selecteur))
        for (const m of corps.matchAll(new RegExp(`^\\s*${prop}\\s*:\\s*([\\d.]+)em\\s*;`, 'gm')))
          valeur = Number(m[1])
      return valeur
    }
    const marge = em('.rail-update-btn.capsule-bouton .thinking-capsule', 'padding')
    const margeRepliee = em('.rail.is-collapsed .rail-update-btn .thinking-capsule', 'padding')
    expect(marge).toBeGreaterThan(0)
    expect(margeRepliee).toBeGreaterThan(0)
    for (const prop of ['width', 'height']) {
      expect(em('.rail-update-who', prop), prop).toBeCloseTo(1.6 + 2 * marge)
      expect(em('.rail.is-collapsed .rail-update-who', prop), `replié ${prop}`).toBeCloseTo(
        1.6 + 2 * margeRepliee
      )
    }
    // Même taille de police que la capsule (même règle), sinon les em ne mesurent pas la même chose.
    const police = (s: string) => toutes(s).find((c) => /font-size\s*:/.test(c))
    expect(police('.rail-update-who')).toBeDefined()
    expect(police('.rail-update-who')).toBe(police('.rail-update-btn.capsule-bouton'))
  })

  it('ne redessine plus de cadre propre par-dessus la capsule', () => {
    const bouton = regle(css, '.rail-update-btn') ?? ''
    const reparer = regle(css, '.rail-update-repair') ?? ''
    for (const corps of [bouton, reparer]) {
      expect(corps).not.toMatch(/\b(border|background|padding|min-height)\s*:/)
    }
  })

  it('pose la liste flottante des commits sur un fond OPAQUE (rail replié)', () => {
    // Constat utilisateur du 2026-09-29 : la liste s'ouvrait par-dessus le rail sur
    // `--surface-raised` = `--bg-2` = rgba(0,0,0,.42) — on lisait l'œil, « Actives » et les
    // pastilles du rail À TRAVERS le texte. `--bg-0` est opaque dans tous les thèmes.
    const bloc = css.match(/\.rail-update-incoming\.is-floating\s*\{([^}]*)\}/)?.[1] ?? ''
    const fonds = [...bloc.matchAll(/^\s*background\s*:\s*([^;]+);/gm)].map((m) => m[1].trim())
    expect(fonds).toEqual(['var(--bg-0)'])
  })

  it('fait passer le menu DEVANT la liste des conversations tant que la liste flottante est ouverte', () => {
    // Constat utilisateur du 2026-10-10 (conv-208) : « quand je click sur l'oeil dans la left barre
    // le popup est caché ». Le menu est sa propre couche (flou de fond partout, coins coupés en
    // Nébuleuse verre) : le `z-index: 40` de la liste ne compte QU'À L'INTÉRIEUR du menu, et le
    // panneau des conversations, peint après lui, la recouvrait (0 point sur 15 au premier plan,
    // mesuré par elementFromPoint sur l'instance cachée). C'est donc le MENU qui doit monter.
    const corps = regle(css, '.rail:has(.rail-update-incoming.is-floating)') ?? ''
    const z = Number(corps.match(/z-index\s*:\s*(\d+)/)?.[1])
    // Au-dessus du séparateur des panneaux (4) et du panneau Détails en fenêtre étroite (25) ;
    // en dessous des menus et modales plein écran de la vue (60 et plus).
    expect(z).toBeGreaterThan(25)
    expect(z).toBeLessThan(60)
  })

  it('utilise une icône vectorielle fine plutôt qu’un glyphe texte', () => {
    expect(component).toContain('<svg')
    expect(component).not.toContain('⟳')
  })

  it('dessine deux flèches épaisses avec des arcs nettement séparés', () => {
    expect(component).toContain('strokeWidth="2.4"')
    expect(component).toContain('M4.5 9A8 8 0 0 1 18 5.5')
    expect(component).toContain('M19.5 15A8 8 0 0 1 6 18.5')
    expect(component).not.toContain('M20 7v5h-5')
  })
})
