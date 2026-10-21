import { describe, expect, it } from 'vitest'
import { grilleCleanEnDefaut, lireGrilleClean } from './grille-clean'

/*
 * La ligne lue est celle qu'impose la consigne CLEAN (`phase-briefs.ts`, réflexe 5) :
 * `Grille : N ✅ · K ❌ restants · S sans objet`. Ces textes sont écrits comme un modèle les rend :
 * en gras, entre accents graves, au singulier, avec un tableau de critères au-dessus.
 */
const SORTIE_AVEC_RESTANT = `## Grille qualité
| Critère | Verdict | Preuve |
|---|---|---|
| Conception | ✅ | src/main/a.ts:12 lu |
| Tests | ❌ restant | src/main/a.ts:40 — aucun test ne rougit si on retire la garde |
| Erreurs | ❌ restant | src/main/a.ts:55 — catch vide |
| Sécurité | sans objet | aucune entrée externe |

**Grille : 9 ✅ · 2 ❌ restants · 1 sans objet**`

describe('lireGrilleClean — la ligne de bilan de la grille', () => {
  it('lit le nombre de ❌ restants et nomme les critères en défaut', () => {
    expect(lireGrilleClean(SORTIE_AVEC_RESTANT)).toEqual({
      restants: 2,
      criteres: ['Tests', 'Erreurs']
    })
  })

  it('zéro ❌ restant est lu comme zéro, pas comme une absence', () => {
    expect(lireGrilleClean('`Grille : 12 ✅ · 0 ❌ restant · 0 sans objet`')).toEqual({
      restants: 0,
      criteres: []
    })
  })

  it('le gabarit de la consigne (lettres, pas chiffres) ne compte pas comme une grille', () => {
    expect(
      lireGrilleClean('Termine par `Grille : N ✅ · K ❌ restants · S sans objet`.')
    ).toBeUndefined()
  })

  it('aucune ligne de grille → aucune lecture', () => {
    expect(lireGrilleClean('Résidus retirés, preuve rejouée : EXIT=0.')).toBeUndefined()
  })

  it('la DERNIÈRE ligne gagne : une grille refaite après correction remplace la première', () => {
    const texte =
      'Grille : 10 ✅ · 2 ❌ restants · 0 sans objet\n…corrections…\nGrille : 12 ✅ · 0 ❌ restants · 0 sans objet'
    expect(lireGrilleClean(texte)?.restants).toBe(0)
  })
})

describe('grilleCleanEnDefaut — quelle grille fait foi pour la clôture', () => {
  it('le DERNIER clean fait foi', () => {
    const phases = [
      { phase: 'build', text: 'vert' },
      { phase: 'clean', text: SORTIE_AVEC_RESTANT },
      { phase: 'build', text: 'réparation' },
      { phase: 'clean', text: 'Grille : 12 ✅ · 0 ❌ restants · 0 sans objet' }
    ]
    expect(grilleCleanEnDefaut(phases)).toBeUndefined()
    expect(grilleCleanEnDefaut(phases.slice(0, 2))).toEqual({
      restants: 2,
      criteres: ['Tests', 'Erreurs']
    })
  })

  it('un build joué APRÈS le dernier clean rend sa grille périmée : elle ne bloque plus', () => {
    const phases = [
      { phase: 'clean', text: SORTIE_AVEC_RESTANT },
      { phase: 'build', text: 'corrigé' }
    ]
    expect(grilleCleanEnDefaut(phases)).toBeUndefined()
  })

  it('clean joué SANS build avant lui → ne bloque pas : la réparation ne rejouerait que clean', () => {
    expect(grilleCleanEnDefaut([{ phase: 'clean', text: SORTIE_AVEC_RESTANT }])).toBeUndefined()
  })

  it('pas de clean joué → rien à lire', () => {
    expect(
      grilleCleanEnDefaut([{ phase: 'build', text: 'Grille : 1 ✅ · 3 ❌ restants' }])
    ).toBeUndefined()
  })
})
