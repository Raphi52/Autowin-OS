import { describe, expect, it } from 'vitest'
import { applyWorkflowProfile, type WorkflowBaseConfig } from './workflow-profile-apply'
import type { WorkflowProfile } from './workflow-profiles'

const base: WorkflowBaseConfig = {
  roles: {
    subagent: { provider: 'claude', model: 'gros', reasoningEffort: 'high' },
    judge: { provider: 'codex', model: 'juge' }
  },
  phases: ['frame', 'build'],
  allocation: { judgeMembers: 3, maxGreedyNodes: 8 }
}

/**
 * Un profil est un ENSEMBLE D'ÉCARTS. S'il réécrivait toute la configuration, on ne saurait jamais
 * à quoi attribuer un écart de résultat entre deux workflows — la comparaison perdrait son sens.
 */
describe('appliquer un workflow', () => {
  it('sans profil, rien ne change', () => {
    const effectif = applyWorkflowProfile(base)
    expect(effectif.roles).toEqual(base.roles)
    expect(effectif.phases).toEqual(['frame', 'build'])
    expect(effectif.profileId).toBeUndefined()
  })

  it('un écart de modèle ne perd PAS le provider ni l’effort non mentionnés', () => {
    const effectif = applyWorkflowProfile(base, {
      id: 'p',
      name: 'P',
      roles: { subagent: { model: 'petit' } }
    })
    expect(effectif.roles.subagent).toEqual({
      provider: 'claude',
      model: 'petit',
      reasoningEffort: 'high'
    })
    expect(effectif.roles.judge).toEqual(base.roles.judge) // rôle non mentionné : intact
  })

  it('les phases se REMPLACENT — une liste partielle n’aurait pas de sens', () => {
    const effectif = applyWorkflowProfile(base, { id: 'p', name: 'P', phases: ['build'] })
    expect(effectif.phases).toEqual(['build'])
  })

  it('l’allocation se FUSIONNE clé par clé — on peut n’imposer que le jury', () => {
    const effectif = applyWorkflowProfile(base, {
      id: 'p',
      name: 'P',
      allocation: { judgeMembers: 1 }
    })
    expect(effectif.allocation).toMatchObject({ judgeMembers: 1, maxGreedyNodes: 8 })
  })

  it('un écart de rôle inapplicable garde la base au lieu de tout faire échouer', () => {
    const bancal = {
      id: 'p',
      name: 'P',
      roles: { scout: { model: 'sans-provider' } }
    } as unknown as WorkflowProfile
    const effectif = applyWorkflowProfile(base, bancal)
    expect(effectif.roles.scout).toBeUndefined()
    expect(effectif.roles.subagent).toEqual(base.roles.subagent)
  })
})

describe('consignes effectives', () => {
  it('la consigne de PHASE prime sur la consigne globale', () => {
    const effectif = applyWorkflowProfile(base, {
      id: 'p',
      name: 'P',
      instructions: { mode: 'append', text: 'partout', perPhase: { build: 'au build' } }
    })
    expect(effectif.instructionFor('build')).toEqual({ mode: 'append', text: 'au build' })
    expect(effectif.instructionFor('frame')).toEqual({ mode: 'append', text: 'partout' })
  })

  it('le mode voyage avec la consigne — ajouter et remplacer ne se confondent pas', () => {
    const effectif = applyWorkflowProfile(base, {
      id: 'p',
      name: 'P',
      instructions: { mode: 'replace', perPhase: { build: 'ma méthode' } }
    })
    expect(effectif.instructionFor('build')?.mode).toBe('replace')
    expect(effectif.instructionFor('frame')).toBeUndefined() // rien pour cette phase
  })

  it('sans consignes, aucune phase n’en reçoit', () => {
    const effectif = applyWorkflowProfile(base, { id: 'p', name: 'P' })
    expect(effectif.instructionFor('build')).toBeUndefined()
  })
})
