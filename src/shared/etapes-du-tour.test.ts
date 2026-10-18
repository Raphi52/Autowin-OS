import { describe, expect, it } from 'vitest'
import { estLigneDEtape, etapesDuJournal, ligneDEtape } from './etapes-du-tour'

describe('ligne d’étape — le contrat entre le processus principal et le fil', () => {
  it('s’écrit lisiblement et se relit à l’identique', () => {
    const ligne = ligneDEtape('3', 'in_progress', '  Écrire   le test ')
    expect(ligne).toBe('Étape #3 en cours · Écrire le test')
    expect(estLigneDEtape(ligne)).toBe(true)
    expect(etapesDuJournal([ligne])).toEqual([
      { id: '3', sujet: 'Écrire le test', statut: 'in_progress' }
    ])
  })

  it('tient dans une ligne du journal des actions (300 caractères) même avec un long sujet', () => {
    const ligne = ligneDEtape('12', 'completed', 'x'.repeat(1000))
    expect(ligne.length).toBeLessThanOrEqual(300)
    expect(ligne.endsWith('…')).toBe(true)
  })

  it('ne prend pas une action pour une étape', () => {
    expect(estLigneDEtape('Bash · npm test')).toBe(false)
    expect(estLigneDEtape('Read terminé - 1 s')).toBe(false)
  })

  it('rejoue les changements : place de première apparition, sujet gardé, supprimée retirée', () => {
    expect(
      etapesDuJournal([
        'Étape #1 à faire · Lire',
        'Bash · npm test',
        'Étape #2 à faire · Écrire',
        'Étape #3 à faire · Jeter',
        'Étape #1 en cours',
        'Étape #3 supprimée',
        'Étape #1 terminée · Lire le code'
      ])
    ).toEqual([
      { id: '1', sujet: 'Lire le code', statut: 'completed' },
      { id: '2', sujet: 'Écrire', statut: 'pending' }
    ])
  })
})
