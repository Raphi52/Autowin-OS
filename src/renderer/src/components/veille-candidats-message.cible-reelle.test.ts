/**
 * LA CIBLE DU SCOUT, LUE SUR SES VRAIES PHRASES (conv-1333, 2026-10-30).
 *
 * Rejeu du panneau sur les scouts réels depuis le 22/10 : 4 cibles déclarées sur 5 cochaient des
 * lignes que le scout n'avait jamais nommées, parce que TOUT nombre de la section valait un numéro
 * de ligne. Sur conv-1332, le scout recommandait les lignes 1 et 2 ; « 13 % », « 05/09 » et « 10 500 »
 * cochaient en plus les lignes 5, 9, 10 et 13. En mode auto, ces lignes partaient sans personne.
 *
 * Les textes ci-dessous sont recopiés des fils : ce sont eux qui font tomber une mauvaise lecture.
 */
import { describe, expect, it } from 'vitest'
import { selectionAutoDepuisScout, type CandidatAffiche } from './veille-candidats-message'

const lignes = (n: number): CandidatAffiche[] =>
  Array.from({ length: n }, (_, i) => ({
    titre: `Piste numéro ${i + 1} du tableau`,
    num: `${i + 1}`
  }))

const numeros = (texte: string, n = 14): number[] =>
  [...(selectionAutoDepuisScout(lignes(n), texte) ?? [])].map((i) => i + 1).sort((a, b) => a - b)

describe('la cible du scout désigne ses lignes, ses chiffres ne désignent rien', () => {
  it('conv-1332 : « 13 % », « 05/09 » et « 10 500 » ne cochent aucune ligne', () => {
    const texte = [
      '## Cible',
      "En tête : **désigner un élément d'Autowin d'un Alt+clic au lieu de le décrire** (ligne 1). C'est votre habitude la plus fréquente : 13 % des messages tapés à la main en octobre.",
      'La reprise automatique après quota (ligne 2) arrive juste derrière. Elle attend d’abord votre choix, car elle revient sur une décision écrite du 05/09.',
      '',
      'Les chiffres viennent de `saisies-utilisateur.jsonl` : environ 10 500 saisies depuis le 1er septembre, dont 1 223 à 1 434 tapées à la main sur 30 jours.',
      '',
      '| # | Score | Type | What | Why | How |'
    ].join('\n')
    expect(numeros(texte)).toEqual([1, 2])
  })

  it('conv-1199 : « Piste 1 : remplacer les 3 taches » ne coche pas la ligne 3', () => {
    const texte = [
      '## Cible',
      '**Piste 1 : remplacer les 3 taches floues de la « lave » des boutons par de fines bandes de couleur.** C’est la piste la plus fidèle à votre image.',
      '',
      '**Corrections après la deuxième relecture :**',
      '- **Piste 2 :** la lumière qui suit la souris est **éteinte sur votre poste**.'
    ].join('\n')
    expect(numeros(texte, 6)).toEqual([1])
  })

  it('conv-1086 : « remplace 4 commandes » ne coche pas la ligne 4', () => {
    const texte = [
      '## Cible',
      '**Ligne 2 — « À qui est ce fichier ? »** Autowin sait déjà quelle conversation a modifié quel fichier. Il remplace 4 commandes git tapées à la main.'
    ].join('\n')
    expect(numeros(texte, 8)).toEqual([2])
  })

  it('conv-1097 : la section longue ne déclare que sa ligne', () => {
    const texte = [
      '## Cible',
      'Ligne 1 : le choix du workflow. Il tourne sur Haiku depuis aujourd’hui.',
      '',
      '**Où part l’argent :**',
      '- Sur 30 jours : chat 2 419 $, étapes 710 $, contrôle final 170 $.',
      '- Sur 7 jours : 1 469 $ au total, dont 98 % de cache.'
    ].join('\n')
    expect(numeros(texte)).toEqual([1])
  })

  it('conv-1196 : les « Row » anglais comptent', () => {
    const texte = [
      '## Cible',
      '**Row 1: fix the frozen run count first.** Once the main window is closed.',
      '**Then build row 2, pointing the mascot at a window.**'
    ].join('\n')
    expect(numeros(texte)).toEqual([1, 2])
  })

  it('une liste de lignes après le mot garde toutes ses lignes', () => {
    expect(numeros('## Cible\nLes lignes 2, 5 et 7 d’abord.')).toEqual([2, 5, 7])
  })

  it('la forme courte reste lue : `CIBLES: 1, 3`, `CIBLE: #2`, `CIBLE: 2 — 13 % des cas`', () => {
    expect(numeros('CIBLES: 1, 3')).toEqual([1, 3])
    expect(numeros('CIBLE: #2')).toEqual([2])
    expect(numeros('CIBLE: 2 — le plus court, 13 % des cas')).toEqual([2])
  })

  it('une section qui ouvre sur un pourcentage ne désigne pas la ligne 13', () => {
    expect(
      selectionAutoDepuisScout(lignes(14), '## Cible\n13 % des messages sont concernés.')
    ).toBeNull()
  })
})
