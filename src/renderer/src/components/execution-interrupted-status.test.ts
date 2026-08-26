import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { settleStrandedExecutionStatus, statusLabel } from './execution-interrupted-status'

/**
 * VUE GRAPHE — « je vois encore des choses en cours dedans mais je suis quasi sûr que ça a juste
 * buggé » (conv-1056).
 *
 * `persistOrchestrationPhaseStart` écrit un événement de trace `status: 'running'` au DÉMARRAGE
 * d'une phase. Si l'app meurt avant l'événement terminal, ce `running` reste sur disque à vie : le
 * graphe le relit et affiche « en cours » pour l'éternité. Aucune surface ne le réconciliait.
 */
describe('un nœud d’étape ne reste jamais « en cours » hors run vivant', () => {
  const events = [
    { id: 'a', status: 'running' },
    { id: 'b', status: 'pending' },
    { id: 'c', status: 'completed' },
    { id: 'd', status: 'failed' },
    { id: 'e', status: undefined }
  ]

  it('un run VIVANT garde ses étapes « en cours » (on ne ment pas dans l’autre sens)', () => {
    const settled = settleStrandedExecutionStatus(events, { live: true })
    expect(settled).toBe(events)
    expect(settled.map((event) => event.status)).toEqual([
      'running',
      'pending',
      'completed',
      'failed',
      undefined
    ])
  })

  it('hors run vivant, running/pending deviennent « interrupted »', () => {
    expect(settleStrandedExecutionStatus(events, { live: false }).map((e) => e.status)).toEqual([
      'interrupted',
      'interrupted',
      'completed',
      'failed',
      undefined
    ])
  })

  it('ne touche à AUCUN statut déjà terminal', () => {
    const terminal = [
      { id: 'c', status: 'completed' },
      { id: 'd', status: 'cancelled' }
    ]
    expect(settleStrandedExecutionStatus(terminal, { live: false })).toBe(terminal)
  })

  it('rend la MÊME référence quand rien ne change (pas de rendu React inutile)', () => {
    const rien = [{ id: 'x', status: 'completed' }]
    expect(settleStrandedExecutionStatus(rien, { live: false })).toBe(rien)
    expect(settleStrandedExecutionStatus([], { live: false })).toEqual([])
  })

  it('préserve les autres champs de l’événement', () => {
    const [settled] = settleStrandedExecutionStatus(
      [{ id: 'a', status: 'running', label: 'exec', kind: 'handoff' }],
      { live: false }
    )
    expect(settled).toEqual({ id: 'a', status: 'interrupted', label: 'exec', kind: 'handoff' })
  })
})

describe('le libellé du statut dit « interrompu », pas « terminé »', () => {
  it('interrupted → interrompu', () => {
    // Sans cette branche, un statut réconcilié tombait dans le défaut « terminé » : le graphe
    // annonçait une étape RÉUSSIE alors qu'elle n'a jamais fini.
    expect(statusLabel('interrupted')).toBe('interrompu')
  })

  it('les libellés existants sont inchangés', () => {
    expect(statusLabel('running')).toBe('en cours')
    expect(statusLabel('pending')).toBe('en attente')
    expect(statusLabel('failed')).toBe('échec')
    expect(statusLabel('cancelled')).toBe('annulé')
    expect(statusLabel('completed')).toBe('terminé')
    expect(statusLabel(undefined)).toBe('terminé')
  })
})

describe('câblage — le graphe consulte la réconciliation, et il la peint', () => {
  const source = readFileSync(join(__dirname, 'WorkflowExecutionGraph.tsx'), 'utf8')
  const css = readFileSync(join(__dirname, 'WorkflowExecutionGraph.css'), 'utf8')

  it('les nœuds rendus passent par settleStrandedExecutionStatus', () => {
    // FAIBLESSE MESUREE le 2026-08-26 : cette assertion ne verifiait QUE la presence de l'appel.
    // Sabotage joue — debrancher la CONSOMMATION (`buildCausalPath(events)` au lieu de
    // `buildCausalPath(settledEvents)`) laissait le test VERT. Un garde qui voit l'appel mais pas
    // son usage ne detecte pas « expose mais pas integre » : exactement ce qu'il existe pour
    // empecher. On exige desormais que le resultat ALIMENTE le graphe.
    const normalise = source.replace(/\s+/g, ' ')
    expect(normalise).toContain('settleStrandedExecutionStatus(events, { live })')
    // Trois faits SIMPLES plutot qu'une regex qui enjambe : la premiere version butait sur la
    // parenthese de `() =>` et echouait sur du code CORRECT — un garde faux dans l'autre sens.
    expect(normalise).toContain('const settledEvents = useMemo(')
    expect(
      normalise,
      'le resultat de la reconciliation doit ALIMENTER le graphe, pas rester inutilise'
    ).toContain('buildCausalPath(settledEvents)')
  })

  it('un nœud interrompu a sa propre classe, distincte de « terminé »', () => {
    expect(css).toContain('.workflow-execution-node.is-interrupted')
  })
})
