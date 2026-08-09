import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TEST_MODEL_CATALOG } from './models.fixture'
import { DEFAULT_IMPORTED_MODELS, type ImportedModel } from './models'
import { createDefaultTopology, setSlot, bindingForModel } from './topology'
import { loadAgentTopology, saveAgentTopology } from './topology-disk'
import { runtimeRoleBinding, runtimeRoleSlots } from './runtime-topology'

const directories: string[] = []

const FABRIC_MODEL: ImportedModel = {
  id: 'fabric/node-gpu-01/qwen3-32b',
  provider: 'fabric:node-gpu-01:qwen3-32b',
  model: 'qwen3-32b',
  label: 'Qwen3 32B · node-gpu-01',
  reasoningEfforts: ['none'],
  defaultReasoningEffort: 'none',
  compute: {
    kind: 'fabric',
    nodeId: 'node-gpu-01',
    resourceId: 'qwen3-32b',
    mode: 'local-tools',
    policyRef: 'policy:local-app-control-v1',
    manifestDigest: 'b'.repeat(64),
    fallback: { kind: 'none' }
  }
}

function temporaryFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'autowin-topology-'))
  directories.push(directory)
  return join(directory, 'agent-topology.json')
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('agent topology disk persistence', () => {
  it('round-trips the validated topology atomically', () => {
    const path = temporaryFile()
    const base = createDefaultTopology(TEST_MODEL_CATALOG)
    const codex = TEST_MODEL_CATALOG.find((model) => model.provider === 'codex')!
    const changed = setSlot(base, 'judge', bindingForModel('judge-2', codex), TEST_MODEL_CATALOG)

    saveAgentTopology(path, changed, TEST_MODEL_CATALOG)

    expect(loadAgentTopology(path, TEST_MODEL_CATALOG)).toEqual(changed)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(changed)
  })

  it('falls back to a valid default when persisted JSON is corrupt', () => {
    const path = temporaryFile()
    writeFileSync(path, '{broken', 'utf8')

    expect(loadAgentTopology(path, TEST_MODEL_CATALOG)).toEqual(
      createDefaultTopology(TEST_MODEL_CATALOG)
    )
  })

  it('conserve les bindings configurés quand leur catalogue dynamique est momentanément absent', () => {
    const path = temporaryFile()
    const configured = createDefaultTopology(TEST_MODEL_CATALOG)
    const codex = TEST_MODEL_CATALOG.find((model) => model.provider === 'codex')!
    configured.orchestrator = bindingForModel('orchestrator', codex)
    configured.subagents = [bindingForModel('subagent-1', codex)]
    configured.panels.judge = []
    writeFileSync(path, JSON.stringify(configured), 'utf8')

    const loaded = loadAgentTopology(path, DEFAULT_IMPORTED_MODELS)

    expect(loaded).toEqual(configured)
    expect(loaded.orchestrator.provider).not.toBe('kimi')
    expect(loaded.panels.judge).toEqual([])
    expect(runtimeRoleBinding(runtimeRoleSlots(loaded).judge, DEFAULT_IMPORTED_MODELS)).toEqual({
      provider: 'codex',
      model: codex.model,
      reasoningEffort: codex.defaultReasoningEffort
    })
  })

  it('round-trip un binding Fabric connu sans lui imposer le namespace du provider', () => {
    const path = temporaryFile()
    const topology = createDefaultTopology([FABRIC_MODEL])

    saveAgentTopology(path, topology, [FABRIC_MODEL])

    expect(loadAgentTopology(path, [FABRIC_MODEL])).toEqual(topology)
  })

  it('conserve et résout le transport Fabric depuis le pin compute hors catalogue', () => {
    const path = temporaryFile()
    const topology = createDefaultTopology([FABRIC_MODEL])
    writeFileSync(path, JSON.stringify(topology), 'utf8')

    const loaded = loadAgentTopology(path, DEFAULT_IMPORTED_MODELS)

    expect(loaded).toEqual(topology)
    expect(runtimeRoleBinding(loaded.orchestrator, DEFAULT_IMPORTED_MODELS).model).toBe('qwen3-32b')
  })

  it('conserve un alias dynamique hors catalogue mais interdit son faux transport', () => {
    const path = temporaryFile()
    const topology = createDefaultTopology(TEST_MODEL_CATALOG)
    topology.orchestrator = {
      slotId: 'orchestrator',
      provider: 'codex',
      modelId: 'codex/flagship',
      reasoningEffort: 'medium'
    }
    saveAgentTopology(path, topology, TEST_MODEL_CATALOG)

    const loaded = loadAgentTopology(path, DEFAULT_IMPORTED_MODELS)

    expect(loaded).toEqual(topology)
    expect(() => runtimeRoleBinding(loaded.orchestrator, DEFAULT_IMPORTED_MODELS)).toThrow(
      'Modèle indisponible hors catalogue : codex/flagship'
    )
  })

  it('charge une topologie legacy sans Terrain sans réinitialiser ses autres panels', () => {
    const path = temporaryFile()
    const current = createDefaultTopology(TEST_MODEL_CATALOG)
    const legacy = {
      ...current,
      panels: {
        scout: current.panels.scout,
        frame: current.panels.frame,
        judge: current.panels.judge
      }
    }
    writeFileSync(path, JSON.stringify(legacy), 'utf8')

    const loaded = loadAgentTopology(path, TEST_MODEL_CATALOG)

    expect(loaded.panels.terrain).toEqual([])
    expect(loaded.panels.scout).toEqual(legacy.panels.scout)
    expect(loaded.panels.frame).toEqual(legacy.panels.frame)
    expect(loaded.panels.judge).toEqual(legacy.panels.judge)
  })

  it('rejects an unbounded panel before persistence', () => {
    const path = temporaryFile()
    const base = createDefaultTopology(TEST_MODEL_CATALOG)
    const model = TEST_MODEL_CATALOG[0]
    const oversized = {
      ...base,
      subagents: Array.from({ length: 17 }, (_, index) =>
        bindingForModel(`subagent-${index + 1}`, model)
      )
    }

    expect(() => saveAgentTopology(path, oversized, TEST_MODEL_CATALOG)).toThrow('16 slots maximum')
  })
})
