import { describe, expect, it } from 'vitest'
import { battementDOrchestration } from './verify-battement'

/**
 * LE TROU NOIR DE 23 MINUTES, mesure le 2026-09-07 (conv-42).
 *
 * Un run d'orchestration a tourne de 09:45 a 10:08 sans qu'une ligne n'arrive dans le fil ;
 * l'utilisateur l'a signale comme un « arret ». Rien, a l'ecran, ne distinguait un sous-agent qui
 * TRAVAILLE d'une app morte. Ces cas figent ce qui manquait : une ligne produite a partir du TEMPS,
 * sans dependre d'un fragment envoye par le modele.
 */
const ESC = String.fromCharCode(27)

describe('battement d une orchestration', () => {
  it('dit le temps ecoule meme quand aucun fait n est encore connu', () => {
    expect(battementDOrchestration(undefined, 95_000)).toBe('1 min 35 s · travail en cours…')
  })

  it('rappelle le dernier fait connu a cote du temps', () => {
    expect(battementDOrchestration('phase build', 45_000)).toBe('45 s · phase build')
  })

  it('depouille les codes de terminal et tient sur une ligne', () => {
    const brut = `${ESC}[33mphase${ESC}[0m   build ${'x'.repeat(400)}`
    const ligne = battementDOrchestration(brut, 60_000)
    expect(ligne.includes(ESC)).toBe(false)
    expect(ligne.length).toBeLessThanOrEqual(140)
  })
})
