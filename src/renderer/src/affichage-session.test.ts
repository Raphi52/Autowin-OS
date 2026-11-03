import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { appliquerAffichage } from './affichage-session'

/**
 * L'AFFICHAGE SELON LA CONNEXION (conv-1442) — côté interface.
 *
 * L'ACCUEIL RESTE ENTIER À DISTANCE : la première version coupait le décor 3D en connexion Windows
 * App, ce qui vidait l'Accueil. Demande de l'utilisateur (2026-11-03) : « je veux pas que ça me
 * cache mon accueil ». Vérifié sur les sources, comme `decor-fond-empilement.contract.test.ts` :
 * jsdom ne calcule ni sélecteur `:not()` complexe appliqué à une animation, ni rendu WebGL.
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
    // La case de l'Accueil porte la classe que la feuille de style exempte.
    expect(app).toMatch(/className=\{`view-slot vue-accueil\$\{tab === 'accueil'/)
  })

  it('les animations coupées à distance épargnent l’Accueil', () => {
    const css = source('./assets/affichage-session.css')
    const selecteurs = [...css.matchAll(/^:root\[data-session='distante'\] \*:not\(([^)]*)\)/gm)]
    expect(selecteurs.length).toBe(3)
    for (const [, exceptions] of selecteurs) {
      expect(exceptions).toContain('.vue-accueil')
      expect(exceptions).toContain('.vue-accueil *')
    }
  })
})
