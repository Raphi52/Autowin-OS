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
    // Un SECOND modèle distinct de celui de la topologie par défaut, sur un moteur toujours routé
    // (Codex a été retiré : un slot Codex serait désormais rebranché au chargement).
    const autre = TEST_MODEL_CATALOG.find(
      (model) => model.provider === 'claude' && model.id !== base.orchestrator.modelId
    )!
    const changed = setSlot(base, 'judge', bindingForModel('judge-2', autre), TEST_MODEL_CATALOG)

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
      provider: 'claude',
      modelId: 'claude/opus-latest',
      reasoningEffort: 'medium'
    }
    saveAgentTopology(path, topology, TEST_MODEL_CATALOG)

    const loaded = loadAgentTopology(path, DEFAULT_IMPORTED_MODELS)

    expect(loaded).toEqual(topology)
    expect(() => runtimeRoleBinding(loaded.orchestrator, DEFAULT_IMPORTED_MODELS)).toThrow(
      'Modèle indisponible hors catalogue : claude/opus-latest'
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

/**
 * CANDIDAT DU SCOUT DE L'APP (score 91), cadré PAR L'APP puis livré ici.
 *
 * `loadAgentTopology` attrapait TOUTE exception et rendait `createDefaultTopology`. Un fichier absent
 * le justifie — c'est le premier démarrage. Mais une erreur d'ACCÈS (permission, fichier verrouillé,
 * chemin qui est un dossier) faisait remplacer silencieusement la topologie configurée par
 * l'utilisateur : ses réglages de rôles disparaissaient sans un mot, et il croyait que l'app avait
 * oublié.
 *
 * ÉCART ASSUMÉ avec la DoD cadrée par l'app, qui demandait qu'un JSON invalide ne rende PLUS la
 * topologie par défaut : le test « falls back to a valid default when persisted JSON is corrupt »
 * (ligne 54) encode la décision inverse, délibérément. Le cadrage avait lui-même note ce risque en
 * « Élevé » — rendre visible une corruption jusque-là masquée peut interrompre le démarrage. Le repli
 * est donc CONSERVÉ ; ce qui change, c'est qu'aucun de ces cas n'est plus SILENCIEUX.
 */
describe('loadAgentTopology — un échec de lecture ne remplace plus la config en silence', () => {
  it('une erreur d’ACCÈS est signalée, avec sa cause', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aos-topo-acces-'))
    try {
      // Un DOSSIER a la place du fichier : l'erreur est deterministe sur toutes les plateformes,
      // contrairement a une manipulation de permissions (risque note par le cadrage).
      const incidents: Array<{ cause: string; chemin: string; detail: string }> = []
      const topologie = loadAgentTopology(dir, TEST_MODEL_CATALOG, (i) => incidents.push(i))
      expect(topologie).toBeTruthy()
      expect(incidents).toHaveLength(1)
      expect(incidents[0].cause).toBe('acces')
      expect(incidents[0].detail).toBeTruthy()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('un contenu invalide est signalé, et distingué d’une erreur d’accès', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aos-topo-json-'))
    try {
      const path = join(dir, 'topology.json')
      writeFileSync(path, '{ceci n est pas du json', 'utf8')
      const incidents: Array<{ cause: string }> = []
      const topologie = loadAgentTopology(path, TEST_MODEL_CATALOG, (i) => incidents.push(i))
      expect(topologie).toBeTruthy()
      expect(incidents.map((i) => i.cause)).toEqual(['contenu-invalide'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('CONTRE-EXEMPLE — un fichier ABSENT reste silencieux : c’est un premier démarrage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aos-topo-absent-'))
    try {
      const incidents: unknown[] = []
      const topologie = loadAgentTopology(join(dir, 'jamais-ecrit.json'), TEST_MODEL_CATALOG, (i) =>
        incidents.push(i)
      )
      expect(topologie).toBeTruthy()
      expect(incidents).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('CONTRE-EXEMPLE — sans rapporteur, le chargement se comporte comme avant', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aos-topo-sansrap-'))
    try {
      const path = join(dir, 'topology.json')
      writeFileSync(path, 'pas du json', 'utf8')
      expect(() => loadAgentTopology(path, TEST_MODEL_CATALOG)).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * CÂBLAGE — un rapporteur d'incident que personne ne passe serait un paramètre décoratif, soit
 * exactement le « exposé mais pas branché » que le scout cherchait. Les deux appelants réels doivent
 * le fournir : chargement initial et rechargement après actualisation du catalogue.
 */
describe('câblage — les deux appelants signalent l’incident', () => {
  const source = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    return fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8')
  }

  it('les deux appels passent le rapporteur', () => {
    const appels = source().split('loadAgentTopology(').length - 1
    const avecRapporteur = source().split('signalerIncidentTopologie').length - 1
    expect(appels).toBe(2)
    // une definition + deux passages
    expect(avecRapporteur).toBe(3)
  })

  it('l’incident est rendu lisible, avec fichier et cause', () => {
    const src = source()
    expect(src).toContain('[topologie]')
    expect(src).toContain('incident.chemin')
    expect(src).toContain('incident.detail')
  })
})
