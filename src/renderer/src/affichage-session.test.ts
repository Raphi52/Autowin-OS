import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { appliquerAffichage } from './affichage-session'

/**
 * L'AFFICHAGE SELON LA CONNEXION (conv-1442) — côté interface.
 *
 * À DISTANCE, RIEN NE SE COUPE : la première version coupait le décor 3D en connexion Windows App
 * (« je veux pas que ça me cache mon accueil », 2026-11-03), la suivante figeait toutes les
 * animations hors de l'Accueil — retirée à son tour : « sur rdp ça m'a enlevé toutes mes animations
 * […] remet tout » (conv-1538, 2026-11-04). Vérifié sur les sources, comme
 * `decor-fond-empilement.contract.test.ts` : le banc ne calcule ni animation ni rendu WebGL.
 */
const source = (chemin: string): string => readFileSync(new URL(chemin, import.meta.url), 'utf8')

describe('affichage selon la connexion — interface', () => {
  it('pose puis retire les attributs lus par la feuille de style', () => {
    // Ce test tourne sans page web (environnement node) : un faux élément suffit, la fonction ne
    // touche que ses attributs.
    const attributs = new Map<string, string>()
    const racine = {
      setAttribute: (nom: string, valeur: string) => void attributs.set(nom, valeur),
      removeAttribute: (nom: string) => void attributs.delete(nom),
      getAttribute: (nom: string) => attributs.get(nom) ?? null,
      hasAttribute: (nom: string) => attributs.has(nom)
    } as unknown as Element
    appliquerAffichage(racine, { distante: true, telephone: true })
    expect(racine.getAttribute('data-session')).toBe('distante')
    expect(racine.getAttribute('data-ecran')).toBe('telephone')

    appliquerAffichage(racine, { distante: false, telephone: false })
    expect(racine.hasAttribute('data-session')).toBe(false)
    expect(racine.hasAttribute('data-ecran')).toBe(false)
  })

  it('le décor 3D de l’Accueil ne dépend pas de la connexion', () => {
    const app = source('./App.tsx')
    // Le décor est monté sur le seul critère de l'Accueil (decor-veille.ts), jamais sur la session.
    expect(app).toMatch(/\{decorMonte && \(\s*<BarriereErreur zone="decor">/)
    expect(app).not.toMatch(/decorMonte && !affichage/)
  })

  it('une fenêtre réduite en largeur prend la mise en page téléphone, en direct', () => {
    // La fenêtre étroite est lue à la largeur CSS courante (matchMedia), jamais au seul téléphone.
    const hook = source('./affichage-session.ts')
    expect(hook).toMatch(/REQUETE_FENETRE_ETROITE\s*=\s*`\(max-width: \$\{LARGEUR_FENETRE_ETROITE\}px\)`/)
    expect(hook).toMatch(/addEventListener\('change', suivre\)/)
    expect(hook).toMatch(/telephone: true \}/)
  })

  it('à distance, aucune règle ne fige les animations ni les transitions', () => {
    const css = source('./assets/affichage-session.css')
    // Aucune règle ne vise la session distante : seul l'écran de téléphone change la page.
    expect(css).not.toMatch(/^:root\[data-session=/m)
    expect(css).not.toMatch(/animation-duration|transition-duration|animation-iteration-count/)
  })
})
