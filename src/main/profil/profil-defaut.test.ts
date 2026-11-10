import { describe, expect, it } from 'vitest'
import type { ImportedModel } from '../modeles/models'
import { assertTopology } from '../topologie/topology'
import type { AutowinProfile } from './profile-store'
import { ID_DU_PROFIL_DEFAUT, avecProfilDefaut, profilParDefaut } from './profil-defaut'
import type { Role, RoleBinding } from './roles'

const claude = (model: string, efforts: ImportedModel['reasoningEfforts']): ImportedModel => ({
  id: `claude/${model}`,
  provider: 'claude',
  model,
  label: model,
  reasoningEfforts: efforts,
  defaultReasoningEffort: efforts[0]
})

const roles = {} as Record<Role, RoleBinding>
const CATALOGUE = [
  claude('claude-fable-5-2', ['high', 'low', 'medium', 'max']),
  claude('claude-haiku-5-5', ['medium', 'low', 'max'])
]

describe('profil « Défaut » fourni avec l’application', () => {
  it('pose Fable 5.2 moyen en orchestrateur, Haiku 5.5 max en sous-agent et en petites tâches', () => {
    const defaut = profilParDefaut(CATALOGUE, roles)
    expect(defaut?.profile.name).toBe('Défaut')
    expect(defaut?.profile.topology.orchestrator).toMatchObject({
      modelId: 'claude/claude-fable-5-2',
      reasoningEffort: 'medium'
    })
    expect(defaut?.profile.topology.subagents).toEqual([
      {
        slotId: 'subagent-1',
        provider: 'claude',
        modelId: 'claude/claude-haiku-5-5',
        reasoningEffort: 'max'
      }
    ])
    expect(defaut?.petitesTaches).toEqual({
      provider: 'claude',
      model: 'claude-haiku-5-5',
      reasoningEffort: 'max'
    })
    // La topologie proposée doit passer la validation qui garde l'application d'un profil.
    expect(() => assertTopology(defaut!.profile.topology, CATALOGUE)).not.toThrow()
  })

  it('un effort que le modèle ne propose pas retombe sur son effort par défaut', () => {
    const defaut = profilParDefaut(
      [claude('claude-fable-5-2', ['high']), claude('claude-haiku-5-5', ['low'])],
      roles
    )
    expect(defaut?.profile.topology.orchestrator.reasoningEffort).toBe('high')
    expect(defaut?.petitesTaches.reasoningEffort).toBe('low')
  })

  it('sans modèle Claude au catalogue, le profil n’est pas proposé', () => {
    const codex: ImportedModel = {
      ...claude('gpt', ['medium']),
      id: 'codex/gpt',
      provider: 'codex'
    }
    expect(profilParDefaut([codex], roles)).toBeNull()
    expect(avecProfilDefaut([], null)).toEqual([])
  })

  it('arrive en tête de liste et ne se laisse pas doubler par un profil du même identifiant', () => {
    const defaut = profilParDefaut(CATALOGUE, roles)
    const enregistres = [
      { id: 'equipe-abc', name: 'Équipe' },
      { id: ID_DU_PROFIL_DEFAUT, name: 'Faux défaut' }
    ] as AutowinProfile[]
    expect(avecProfilDefaut(enregistres, defaut).map((p) => p.name)).toEqual(['Défaut', 'Équipe'])
  })
})
