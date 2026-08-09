import { describe, expect, it } from 'vitest'
import { formatOrchestrationOutcome, runLabelFromPath } from './orchestration-outcome'

/**
 * Le fil doit rapporter ce que l'orchestration a VRAIMENT produit.
 *
 * Défaut mesuré sur conv-76 (2026-07-29) : 18 appels de sous-agents, 10,05 $, et le fil disait
 * « Workflow Autowin exécuté. » — alors que statut, validité, blocage de gate, coût et chemin du RUN
 * étaient tous disponibles. Ces cas figent le contraire : jamais de succès prétendu, toujours les faits.
 */
describe('formatOrchestrationOutcome — jamais un faux succès', () => {
  it('retire les consignes de clôture périmées du worker après une livraison réussie', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      result:
        'Tests ciblés 11/11 verts.\n📍 Maintenant — RUN open, non commité.\n⏳ Reste à faire — lancer judge et publier.'
    })

    expect(text).toContain('Tests ciblés 11/11 verts.')
    expect(text).not.toContain('RUN open')
    expect(text).not.toContain('lancer judge')
    expect(text).not.toContain('non commité')
  })

  it('un gate BLOQUÉ est annoncé comme tel, même si l’appel a « réussi »', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'failed',
      gateBlocked: true,
      valid: false,
      costUsd: 10.05
    })
    expect(text).toContain('BLOQUÉ')
    expect(text).not.toContain('✅')
  })

  it('un juge qui REFUSE le livrable est dit explicitement', () => {
    const text = formatOrchestrationOutcome(true, { status: 'succeeded', valid: false, costUsd: 2 })
    expect(text).toContain('REFUSÉ')
    expect(text).not.toContain('✅')
  })

  it('un vrai succès porte statut, coût et run', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      costUsd: 10.05,
      runPath: 'C:/Users/x/.claude/runs/sess-1/audit-cout-workspace/RUN.md',
      result: 'Trois fichiers modifiés, tests verts.'
    })
    expect(text).toContain('✅')
    expect(text).toContain('statut succeeded')
    expect(text).toContain('coût 10.05 $')
    expect(text).toContain('run « audit-cout »')
    expect(text).toContain('Trois fichiers modifiés')
  })

  it('un coût inconnu ne devient jamais un faux 0.00 $', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      costUsd: 0,
      knownCostUsd: null,
      unpricedCalls: 3
    })
    expect(text).toContain('coût non exposé')
    expect(text).toContain('3 appels non chiffrés')
    expect(text).not.toContain('0.00 $')
  })

  it('une réutilisation de run en cours est signalée (aucun nouveau run)', () => {
    const text = formatOrchestrationOutcome(true, { status: 'running', reused: true })
    expect(text).toContain('réutilisé')
  })

  it('un échec rapporte sa RAISON', () => {
    expect(formatOrchestrationOutcome(false, undefined, 'budget dépassé')).toContain(
      'budget dépassé'
    )
    expect(formatOrchestrationOutcome(false, { error: 'gate rouge' })).toContain('gate rouge')
  })

  it('un échec sans raison le DIT, au lieu de rester vide', () => {
    expect(formatOrchestrationOutcome(false, undefined)).toContain('non rapportée')
  })

  it('données absentes → un en-tête, jamais de champ inventé', () => {
    const text = formatOrchestrationOutcome(true, {})
    expect(text).toBe('✅ Workflow terminé')
  })

  it('ignore les valeurs de mauvais type au lieu de les afficher', () => {
    const text = formatOrchestrationOutcome(true, { costUsd: 'beaucoup', status: 42 })
    expect(text).toBe('✅ Workflow terminé')
  })

  it('borne un résultat très long', () => {
    const text = formatOrchestrationOutcome(true, { result: 'x'.repeat(9_000) })
    expect(text).toContain('[tronqué]')
    expect(text.length).toBeLessThan(5_000)
  })
})

describe('runLabelFromPath — nommer le run lisiblement', () => {
  it('extrait le sujet du workspace', () => {
    expect(runLabelFromPath('C:/runs/sess/tiers-findings-workspace/RUN.md')).toBe('tiers-findings')
  })

  it('tolère les séparateurs Windows', () => {
    expect(runLabelFromPath('C:\\runs\\sess\\audit-workspace\\RUN.md')).toBe('audit')
  })

  it('sans workspace, retombe sur le dossier parent', () => {
    expect(runLabelFromPath('C:/runs/sess/quelque-chose/RUN.md')).toBe('quelque-chose')
  })

  it('chemin absent → rien', () => {
    expect(runLabelFromPath(undefined)).toBeUndefined()
  })
})
