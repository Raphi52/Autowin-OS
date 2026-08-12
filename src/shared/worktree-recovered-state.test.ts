import { describe, expect, it } from 'vitest'
import { etatBureauRecupere } from './worktree-activity-model'
import { requiresAttention } from './worktree-activity-model'
import type { WorktreeAgentActivity } from './worktree-activity-model'

/**
 * UN RUN INTERROMPU N'EST PAS UN BUREAU BLOQUÉ.
 *
 * Mesuré le 2026-08-12 sur les données réelles : la vue Worktrees annonce 146 bureaux « bloqués »,
 * mais la ventilation des 218 enregistrements donne 118 `interrupted / blocked` — des runs qui
 * tournaient quand l'application s'est arrêtée (redémarrages, dont les miens aujourd'hui) — 50
 * rouges qui n'avaient rien à publier, et SEPT seulement qui retiennent du travail vert.
 *
 * Deux blocs identiques de `run-worktree-coordinator` posaient `state: 'blocked'` avec
 * `attentionReason: 'merge-failed'` PAR DÉFAUT, alors qu'aucune fusion n'avait été tentée. Le
 * signal réel — 7 bureaux à traiter — était noyé d'un facteur 20 dans un bruit d'étiquettes.
 */
const bureau = (patch: Partial<WorktreeAgentActivity>): WorktreeAgentActivity =>
  ({
    runId: 'run-1',
    agentName: 'Agent',
    isMutation: true,
    startedAtMs: 1,
    state: 'blocked',
    files: [],
    ...patch
  }) as WorktreeAgentActivity

describe('état d’un bureau récupéré au démarrage', () => {
  it('nomme « interrompu » un run qui tournait quand l’app s’est arrêtée', () => {
    expect(etatBureauRecupere({ verdict: 'running' })).toEqual({ state: 'interrupted' })
  })

  it('nomme « interrompu » un run déjà persisté comme tel', () => {
    expect(etatBureauRecupere({ verdict: 'interrupted' })).toEqual({ state: 'interrupted' })
  })

  it('n’invente pas « merge-failed » quand aucune fusion n’a été tentée', () => {
    expect(etatBureauRecupere({ verdict: 'running' }).attentionReason).toBeUndefined()
  })

  it('garde le défaut « merge-failed » pour une copie anormale sans raison enregistrée', () => {
    // Une copie dont le processus a disparu SANS manifeste reste une anomalie : le défaut
    // historique tient. On ne l'a retiré que pour l'arrêt de l'application, où il mentait.
    expect(etatBureauRecupere({ verdict: 'unknown' })).toEqual({
      state: 'blocked',
      attentionReason: 'merge-failed'
    })
  })

  it('conserve la raison réelle quand elle est enregistrée', () => {
    expect(etatBureauRecupere({ verdict: 'green', attentionReason: 'base-dirty' })).toEqual({
      state: 'blocked',
      attentionReason: 'base-dirty'
    })
  })

  it('garde « bloqué · merge-failed » pour un vrai échec de fusion', () => {
    expect(etatBureauRecupere({ verdict: 'green', attentionReason: 'merge-failed' })).toEqual({
      state: 'blocked',
      attentionReason: 'merge-failed'
    })
  })
})

describe('attention humaine', () => {
  it('n’appelle PAS l’utilisateur pour un run interrompu', () => {
    expect(requiresAttention(bureau({ state: 'interrupted' }))).toBe(false)
  })

  it('continue d’appeler l’utilisateur pour un conflit', () => {
    expect(requiresAttention(bureau({ state: 'conflict' }))).toBe(true)
  })

  it('continue d’appeler l’utilisateur pour un vrai blocage', () => {
    expect(requiresAttention(bureau({ state: 'blocked', attentionReason: 'merge-failed' }))).toBe(
      true
    )
  })
})
