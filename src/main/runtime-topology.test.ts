import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TEST_MODEL_CATALOG } from './models.fixture'
import { DEFAULT_IMPORTED_MODELS } from './models'
import { bindingForModel, createDefaultTopology } from './topology'
import { sourceProcessPrincipal } from './source-process-principal.test-helpers'
import {
  assertRuntimeBindingAvailable,
  assertRuntimeTopologyAvailable,
  runtimeRoleBinding,
  runtimeRoleSlots,
  topologyWithRuntimeRole
} from './runtime-topology'

function indexSource(): string {
  return readFileSync(new URL('./index.ts', import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
}

describe('bindings runtime issus d’Agent Studio', () => {
  it('remplace un ancien juge invisible par le sous-agent encore présent dans la topologie', () => {
    const topology = createDefaultTopology(TEST_MODEL_CATALOG)
    const worker = TEST_MODEL_CATALOG.find((model) => model.provider === 'codex')!
    topology.subagents = [bindingForModel('subagent-1', worker)]
    topology.panels.judge = []

    expect(runtimeRoleSlots(topology).judge).toEqual(topology.subagents[0])
  })

  it('conserve le premier slot Judge quand Agent Studio en configure un', () => {
    const topology = createDefaultTopology(TEST_MODEL_CATALOG)

    expect(runtimeRoleSlots(topology).judge).toEqual(topology.panels.judge[0])
  })

  it('retombe sur l’orchestrateur si aucun sous-agent ni juge ne sont configurés', () => {
    const topology = createDefaultTopology(TEST_MODEL_CATALOG)
    topology.subagents = []
    topology.panels.judge = []

    expect(runtimeRoleSlots(topology).judge).toEqual(topology.orchestrator)
  })

  it('bloque un modèle concret absent du catalogue au lieu de le transmettre au provider', () => {
    const codex = TEST_MODEL_CATALOG.find((model) => model.provider === 'codex')!
    const slot = bindingForModel('subagent-1', codex)

    // La projection reste affichable pendant une découverte dynamique, mais ne constitue pas une
    // autorisation d'exécution : seule la readiness ci-dessous ouvre le dispatch.
    expect(runtimeRoleBinding(slot, DEFAULT_IMPORTED_MODELS).model).toBe(codex.model)
    const topology = createDefaultTopology(TEST_MODEL_CATALOG)
    topology.subagents = [slot]
    const withoutCodex = TEST_MODEL_CATALOG.filter((model) => model.provider !== 'codex')
    expect(() => assertRuntimeTopologyAvailable(topology, withoutCodex)).toThrow(
      `Modèle indisponible hors catalogue : ${codex.id}`
    )
  })

  it('valide modèle et effort d’un override ponctuel contre le catalogue', () => {
    expect(() =>
      assertRuntimeBindingAvailable(
        { provider: 'claude', model: 'claude-fable-5', reasoningEffort: 'high' },
        TEST_MODEL_CATALOG
      )
    ).not.toThrow()
    expect(() =>
      assertRuntimeBindingAvailable(
        { provider: 'claude', model: 'modele-fantome', reasoningEffort: 'high' },
        TEST_MODEL_CATALOG
      )
    ).toThrow('hors catalogue')
    expect(() =>
      assertRuntimeBindingAvailable(
        { provider: 'claude', model: 'claude-fable-5', reasoningEffort: 'ultra' },
        TEST_MODEL_CATALOG
      )
    ).toThrow('Effort indisponible')
  })

  it('refuse un alias dynamique non résolu plutôt que de l’inventer comme transport', () => {
    const slot = {
      slotId: 'orchestrator',
      provider: 'codex',
      modelId: 'codex/flagship',
      reasoningEffort: 'medium' as const
    }

    expect(() => runtimeRoleBinding(slot, DEFAULT_IMPORTED_MODELS)).toThrow(
      'Modèle indisponible hors catalogue : codex/flagship'
    )
    expect(runtimeRoleBinding(slot, TEST_MODEL_CATALOG).model).toBe('gpt-5.6-terra')
  })

  it('ne laisse pas un profil réappliquer son ancien snapshot de rôles après la topologie', () => {
    // Le canal a quitté `index.ts` pour `ipc/profiles.ts` le 2026-09-02 : on lit la ZONE du
    // process principal, et on borne par le canal SUIVANT quel qu'il soit — un voisin nommé
    // déménage, la garde ne doit pas dépendre de lui.
    const source = sourceProcessPrincipal()
    const start = source.indexOf("ipcMain.handle('os:profiles:apply'")
    const suivant = source.indexOf('ipcMain.handle(', start + 1)
    const end = suivant < 0 ? source.length : suivant
    const handler = source.slice(start, end)

    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    // La topologie du profil est APPLIQUÉE (persistée + rôles resynchronisés) ...
    expect(handler).toMatch(/appliquerTopologie\(migrateTopologyShape\(profile\.topology\)/)
    // ... et l'application resynchronise bien les rôles runtime, là où elle est câblée.
    expect(source).toContain('syncRuntimeTopology(agentTopology)')
    // ... mais l'ancien instantané de rôles du profil, lui, n'est JAMAIS réappliqué.
    expect(handler).not.toContain('profile.roles')
  })

  it('persiste un changement public d’orchestrateur dans la topologie canonique', () => {
    const topology = createDefaultTopology(TEST_MODEL_CATALOG)
    topology.subagents = []
    topology.panels.judge = []
    const claude = TEST_MODEL_CATALOG.find((model) => model.provider === 'claude')!

    const next = topologyWithRuntimeRole(
      topology,
      'orchestrator',
      { provider: claude.provider, model: claude.model, reasoningEffort: 'low' },
      TEST_MODEL_CATALOG
    )

    expect(next.orchestrator).toMatchObject({
      provider: 'claude',
      modelId: claude.id,
      reasoningEffort: 'low'
    })
    expect(runtimeRoleSlots(next).judge).toEqual(next.orchestrator)
  })

  it('fait passer l’API setRole par agent-topology.json au lieu de roles.json seul', () => {
    const source = indexSource()
    const start = source.indexOf("ipcMain.handle(\n    'os:setRole'")
    const end = source.indexOf("ipcMain.handle('os:models:list'", start)
    const handler = source.slice(start, end)

    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(handler).toContain('topologyWithRuntimeRole')
    expect(handler).toContain('saveAgentTopology')
    expect(handler).toContain('syncRuntimeTopology(agentTopology)')
    expect(handler).not.toContain('os.setRole(role')
  })

  it('projette le cache de topologie avant une découverte de modèles vide ou en échec', () => {
    const source = indexSource()

    expect(source).toMatch(
      /\nsyncRuntimeTopology\(agentTopology\)\nconst agentModelsReady = modelCatalog\.refresh\(true\)/
    )
  })

  it('ne sert pas les rôles avant la fin de la readiness modèles', () => {
    const source = indexSource()
    const start = source.indexOf("ipcMain.handle('os:roles'")
    const end = source.indexOf("ipcMain.handle('os:orchestrationBudget:get'", start)
    const handler = source.slice(start, end)

    expect(handler).toContain('await agentModelsReady')
    expect(handler).toContain('return os.roles.all()')
  })
})
