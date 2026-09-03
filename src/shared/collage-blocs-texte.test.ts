import { describe, expect, it } from 'vitest'
import { separationEntreBlocsTexte } from './collage-blocs-texte'

/**
 * CE QUE CES TESTS PROUVENT : une fence qui OUVRE un bloc `html-render` ne peut plus atterrir en
 * milieu de ligne quand le fournisseur recolle deux blocs de texte séparés par un appel d'outil.
 *
 * ENTRÉE QUI LES FAIT ÉCHOUER SI LA CORRECTION EST FAUSSE : les DEUX morceaux réellement mesurés
 * dans le journal du tour de conv-8 (delta `0:0:ordered:4`, 2026-09-03). Une accumulation par
 * simple `+=` produit « branchée.```html-render » et le premier test tombe rouge.
 */
const AVANT_MESURE =
  "J'interroge le cerveau par le canal de l'app (pas par un script) pour confirmer que la " +
  'session en cours est bien branchée.'
const APRES_MESURE = '```html-render\n<!doctype html><meta charset="utf-8">\n<style>\n'

describe('separationEntreBlocsTexte', () => {
  it('la fence mesurée le 2026-09-03 se retrouve en DÉBUT de ligne', () => {
    const recolle = AVANT_MESURE + separationEntreBlocsTexte(AVANT_MESURE, APRES_MESURE) + APRES_MESURE
    const ligneDeLaFence = recolle.split('\n').find((l) => l.includes('```html-render'))
    expect(ligneDeLaFence).toBe('```html-render')
  })

  it('ne touche à rien quand le texte accumulé finit déjà par un saut de ligne', () => {
    expect(separationEntreBlocsTexte('Voici :\n', APRES_MESURE)).toBe('')
  })

  it('ne coupe pas une phrase qui se POURSUIT d’un bloc à l’autre', () => {
    expect(separationEntreBlocsTexte('je lance la vérification', ' ciblée sur le fichier')).toBe('')
  })

  it('sépare deux phrases soudées sans espace (défaut des 6 occurrences mesurées)', () => {
    expect(separationEntreBlocsTexte('je lance la vérification ciblée.', 'Maintenant le côté écriture')).toBe('\n\n')
  })

  it('ne coupe pas devant un CHIFFRE — « version 1. » + « 2.3 » n’est pas une phrase neuve', () => {
    expect(separationEntreBlocsTexte('version 1.', '2.3')).toBe('')
  })

  it('n’insère RIEN à l’intérieur d’une fence déjà ouverte : ``` y est du contenu', () => {
    const dansUneFence = 'Voici :\n```html-render\n<p>a</p>'
    expect(separationEntreBlocsTexte(dansUneFence, '```')).toBe('')
  })

  it('un côté vide ne produit aucune séparation', () => {
    expect(separationEntreBlocsTexte('', APRES_MESURE)).toBe('')
    expect(separationEntreBlocsTexte(AVANT_MESURE, '')).toBe('')
  })
})
