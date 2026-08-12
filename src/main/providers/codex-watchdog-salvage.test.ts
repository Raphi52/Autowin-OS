import { describe, expect, it } from 'vitest'
import { salvageOnWatchdogTrip } from './codex'
import type { ExecutionEvidence } from './types'

/**
 * UN WATCHDOG QUI TUE NE DOIT PAS JETER CE QUI A DÉJÀ ÉTÉ PRODUIT.
 *
 * Mesuré sur la campagne du 2026-08-12, conv-1122 (vue Agent Studio) : un appel subagent a tourné
 * 1 286 s — 21 minutes — puis s'est tu 5 minutes, et le watchdog l'a tué sur inactivité. Le seuil
 * est correct (5 minutes de silence TOTAL, c'est beaucoup) mais l'adaptateur `reject()` alors que
 * `finalText`, `executionEvidence`, `usage` et le raisonnement sont DÉJÀ accumulés en mémoire :
 * 21 minutes de travail parties à la poubelle, le run rouge, rien de récupérable.
 *
 * On récupère quand il y a de la matière, et on le DIT dans le texte : le juge doit voir que le
 * tour a été interrompu, pas croire à une livraison complète.
 */
const preuve: ExecutionEvidence = {
  type: 'file_change',
  kind: 'mutation',
  status: 'completed',
  ok: true,
  summary: 'Écriture de AgentStudioView.tsx',
  path: 'C:/base/src/renderer/src/components/AgentStudioView.tsx'
}

describe('récupération sur coupure du watchdog', () => {
  it('rend le texte déjà produit au lieu de tout perdre', () => {
    const issue = salvageOnWatchdogTrip('inactivity', {
      finalText: 'Chantiers P1 et P2 livrés, tests ciblés verts.',
      executionEvidence: [preuve]
    })
    expect(issue.kind).toBe('salvaged')
    if (issue.kind !== 'salvaged') return
    expect(issue.result.text).toContain('Chantiers P1 et P2 livrés')
    expect(issue.result.executionEvidence).toHaveLength(1)
  })

  it('marque explicitement l’interruption pour ne pas la faire passer pour une livraison', () => {
    const issue = salvageOnWatchdogTrip('inactivity', {
      finalText: 'Travail partiel.',
      executionEvidence: [preuve]
    })
    if (issue.kind !== 'salvaged') throw new Error('attendu salvaged')
    expect(issue.result.text).toMatch(/interrompu|watchdog/i)
    expect(issue.result.text).toMatch(/aucune sortie|inactivit/i)
  })

  it('récupère aussi quand seules des preuves existent, sans texte final', () => {
    const issue = salvageOnWatchdogTrip('inactivity', {
      finalText: '   ',
      executionEvidence: [preuve]
    })
    expect(issue.kind).toBe('salvaged')
  })

  it('échoue franchement quand il n’y a RIEN à récupérer', () => {
    const issue = salvageOnWatchdogTrip('inactivity', { finalText: '', executionEvidence: [] })
    expect(issue.kind).toBe('failed')
    if (issue.kind !== 'failed') return
    expect(issue.error.message).toContain('figé')
  })

  it('distingue la coupure sur durée max de la coupure sur silence', () => {
    const issue = salvageOnWatchdogTrip('total', { finalText: 'partiel', executionEvidence: [] })
    if (issue.kind !== 'salvaged') throw new Error('attendu salvaged')
    expect(issue.result.text).toMatch(/durée max/i)
  })
})
