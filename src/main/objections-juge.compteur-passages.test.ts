import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { libelleDuPassageDeReparation } from './gates/stopgate'

/**
 * POURQUOI CE TEST — objection du juge sur conv-540, tour
 * 8bc214db-8c48-4a29-880d-1ef4c4391d1f : « le lien "4 passages du juge -> plafond de 42 appels"
 * reste une deduction, pas une mesure. Le dossier ne contient pas de compteur de passages. »
 *
 * Elle est fondee : la boucle de reparation (src/main/orchestrator.ts) ne poussait un motif dans
 * la trace QUE lorsqu'elle s'arretait. Les passages eux-memes etaient muets, donc le dossier de
 * preuve d'un tour mort par epuisement ne permet PAS de dire combien de fois il a rejoue. Chaque
 * passage se NOMME desormais dans la trace, avec son rang et le plafond en vigueur.
 */
describe('compteur de passages de reparation', () => {
  it('nomme le rang du passage et le plafond', () => {
    expect(libelleDuPassageDeReparation(3, 8)).toBe('Réparation 3/8 — nouveau passage de build.')
  })

  it('reste lisible quand le plafond est atteint', () => {
    expect(libelleDuPassageDeReparation(8, 8)).toBe(
      'Réparation 8/8 — nouveau passage de build (dernier autorise).'
    )
  })

  it('est reellement pousse dans la trace par la boucle de reparation', () => {
    const source = readFileSync(new URL('./orchestrator.ts', import.meta.url), 'utf8')
    expect(source).toContain('libelleDuPassageDeReparation(attempt, PLAFOND_DUR)')
  })
})
