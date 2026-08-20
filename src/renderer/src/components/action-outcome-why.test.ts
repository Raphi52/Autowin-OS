/**
 * LE POURQUOI COMPLET, demande le 20/08 : « quand je clique sur une action avec erreur je veux que
 * ca deplie le pourquoi ».
 *
 * La pastille est BORNEE a une ligne — elle tronque a 120 caracteres et ne garde que le PREMIER
 * motif de gate. Sur conv-1334, l'utilisateur voyait « bloqué par le gate — Statut "red" : la
 * clôture a été refusée en amont. · » : le second motif (la DoD non tenue), qui dit ce qu'il aurait
 * fallu produire, etait purement absent de l'ecran. Le resume porte donc desormais le texte INTEGRAL
 * a cote de sa forme courte.
 */
import { describe, expect, it } from 'vitest'
import { groupOutcomeSummary, orchestrateOutcomeSummary } from './action-outcome-summary'

describe('résumé d’action — le pourquoi complet', () => {
  it('un gate bloqué garde TOUS ses motifs, non tronqués', () => {
    const resume = orchestrateOutcomeSummary({
      name: 'orchestrate',
      ok: false,
      data: {
        gateBlocked: true,
        gateReasons: [
          'Statut "red" : la clôture a été refusée en amont.',
          'DoD non tenue : « Mutation demandee produite avec une preuve executable ».'
        ]
      }
    })
    expect(resume?.state).toBe('failed')
    expect(resume?.why).toEqual([
      'Statut "red" : la clôture a été refusée en amont.',
      'DoD non tenue : « Mutation demandee produite avec une preuve executable ».'
    ])
  })

  it('un échec porte sa raison ENTIÈRE, là où la pastille la coupe', () => {
    const raison = `Bloqué — cible non nommée. ${'détail '.repeat(40)}fin`
    const resume = orchestrateOutcomeSummary({ name: 'orchestrate', ok: false, data: raison })
    expect(resume?.label.length).toBeLessThan(130)
    expect(resume?.why).toEqual([raison])
  })

  it('une vérification en échec explique son exit code', () => {
    const resume = groupOutcomeSummary([
      { name: 'verify', ok: false, data: { command: 'npx vitest run', exitCode: 1, ok: false } }
    ])
    expect(resume?.why?.join(' ')).toContain('exit 1')
  })

  it('un succès n’a rien à déplier', () => {
    const resume = groupOutcomeSummary([
      { name: 'verify', ok: true, data: { command: 'npx vitest run', exitCode: 0, ok: true } }
    ])
    expect(resume?.state).toBe('ok')
    expect(resume?.why).toBeUndefined()
  })
})
