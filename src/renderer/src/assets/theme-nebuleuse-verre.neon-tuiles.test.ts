import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { HOME_WIDGET_IDS } from '../components/home-layout'

/**
 * LES TUILES DE L'ACCUEIL EN TUBES NEON (conv-317, 2026-10-17) — bloc NEON-TUILES de
 * theme-nebuleuse-verre.css. Demande : « /draft le style des widgets pour qu'il colle plus au fond
 * d'ecran », puis « implemente 3 + degrade different pour chaque widget ».
 *
 * Ce que le test tient :
 *  - CHAQUE widget de l'Accueil a SA paire de couleurs, et deux widgets n'ont jamais le meme degrade ;
 *  - le tube est un degrade en `border-box` sous une encre opaque (>= 0,68, le seuil de lisibilite des
 *    tuiles, HomeView.css.lisibilite-tuiles.test.ts) ;
 *  - le neon RECOUVRE le cadre a chanfrein des tuiles : il vient apres lui, la coupe est levee, et les
 *    regles de tuile tenue / au clavier remettent le bord a transparent (sinon il couvrirait le tube) ;
 *  - le titre est une enseigne qui gresille, chaque tuile avec son decalage.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : retirer le bloc NEON-TUILES, donner a deux widgets la meme
 * paire, ou remettre `border-color: var(--line-strong)` dans la regle de la tuile tenue du bloc.
 */
const css = readFileSync(new URL('./theme-nebuleuse-verre.css', import.meta.url), 'utf8')
const racine = postcss.parse(css)
const PREFIXE = ":root[data-theme='nebuleuse-verre']"

/** Les declarations de la DERNIERE regle portant exactement ce selecteur, et son rang dans le fichier. */
function derniere(selecteur: string): { decls: Record<string, string>; rang: number } {
  let trouvee: { decls: Record<string, string>; rang: number } | null = null
  let rang = 0
  racine.walkRules((regle) => {
    rang += 1
    if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
    const decls: Record<string, string> = {}
    regle.walkDecls((d) => {
      decls[d.prop] = d.value.replace(/\s+/g, ' ').trim()
    })
    trouvee = { decls, rang }
  })
  expect(trouvee, `regle ${selecteur} absente`).not.toBeNull()
  return trouvee as unknown as { decls: Record<string, string>; rang: number }
}

describe('Accueil Holographique : une tuile = un tube neon a son degrade', () => {
  it('donne a chaque widget sa propre paire, jamais la meme deux fois', () => {
    const paires = HOME_WIDGET_IDS.map((id) => {
      const { decls } = derniere(`${PREFIXE} .home-tile[data-widget='${id}']`)
      expect(decls['--nv-neon-a'], id).toMatch(/^#[0-9a-f]{6}$/)
      expect(decls['--nv-neon-b'], id).toMatch(/^#[0-9a-f]{6}$/)
      expect(decls['--nv-neon-a'], `${id} : un degrade a deux couleurs`).not.toBe(decls['--nv-neon-b'])
      return `${decls['--nv-neon-a']} -> ${decls['--nv-neon-b']}`
    })
    expect(new Set(paires).size).toBe(HOME_WIDGET_IDS.length)
  })

  it('peint le tube en degrade sous une encre opaque, sans la coupe du chanfrein', () => {
    const { decls } = derniere(`${PREFIXE} .home-tile .home-tile__panel`)
    expect(decls['clip-path']).toBe('none')
    expect(decls.border).toBe('1.5px solid transparent')
    expect(decls.background).toContain(
      'linear-gradient(var(--nv-neon-encre), var(--nv-neon-encre)) padding-box'
    )
    expect(decls.background).toMatch(
      /linear-gradient\(135deg, var\(--nv-neon-tube-a\), var\(--nv-neon-tube-b\)\) border-box$/
    )
    // La lumiere de la souris (conv-191) reste la premiere couche.
    expect(decls.background).toMatch(/^radial-gradient\( circle var\(--nv-lumiere-rayon\)/)
    expect(decls['--nv-neon-tube-a']).toContain('var(--ch-contour)')

    const encre = derniere(`${PREFIXE} .home-tile`).decls['--nv-neon-encre']
    const alpha = Number(encre.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1] ?? 1)
    expect(alpha).toBeGreaterThanOrEqual(0.68)
  })

  it('recouvre le cadre a chanfrein des tuiles : apres lui, bord transparent tenue ou au clavier', () => {
    const chanfrein = derniere(`${PREFIXE} :is(.home-tile__panel, .home-view__masthead)`)
    const neon = derniere(`${PREFIXE} .home-tile .home-tile__panel`)
    expect(neon.rang).toBeGreaterThan(chanfrein.rang)
    for (const etat of [".home-tile[data-held='true']", '.home-tile:focus-visible']) {
      const regle = derniere(`${PREFIXE} ${etat} .home-tile__panel`)
      expect(regle.decls['border-color'], etat).toBe('transparent')
      expect(regle.decls['box-shadow'], etat).toContain('var(--nv-neon-halo-a)')
    }
  })

  it('fait du titre une enseigne de la couleur de depart, qui gresille avec son decalage', () => {
    const { decls } = derniere(`${PREFIXE} .home-tile .home-tile__label h2`)
    expect(decls.color).toContain('var(--nv-neon-a)')
    expect(decls['text-shadow']).toContain('var(--nv-neon-a)')
    expect(decls.animation).toMatch(/^nv-neon-gresille /)
    expect(decls['animation-delay']).toBe('var(--nv-neon-decalage)')
    expect(css).toMatch(/@keyframes nv-neon-gresille \{/)
    // Le gabarit de l'etiquette (24 px, WIDGET_LABEL_HEIGHT) n'est pas touche par le neon.
    expect(css.match(/NEON-TUILES:DEBUT[\s\S]*NEON-TUILES:FIN/)?.[0]).not.toMatch(/height\s*:/)
  })
})
