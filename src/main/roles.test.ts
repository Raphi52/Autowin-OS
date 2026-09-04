import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RoleModelConfig, ALL_ROLES, type Role } from './roles'
import { loadRoleBindings, saveRoleBindings } from './role-store'
import { legacyAppDataRoot } from './app-data'
import { TEST_MODEL_CATALOG } from './models.fixture'
import {
  bindingForModel,
  createDefaultTopology,
  setSlot
} from './topology'

describe('RoleModelConfig', () => {
  it('a des defauts presents pour les 4 roles', () => {
    const cfg = new RoleModelConfig()
    for (const role of ALL_ROLES) {
      const binding = cfg.getBinding(role)
      expect(binding).toBeDefined()
      expect(typeof binding.provider).toBe('string')
      expect(binding.provider.length).toBeGreaterThan(0)
    }
  })

  it('utilise les defauts attendus — Claude sur les QUATRE rôles, aucun moteur retiré', () => {
    // Scout était le dernier rôle câblé par défaut sur un moteur retiré : une installation neuve
    // routait donc encore vers du mort.
    const cfg = new RoleModelConfig()
    expect(cfg.getBinding('orchestrator').provider).toBe('claude')
    expect(cfg.getBinding('subagent').provider).toBe('claude')
    expect(cfg.getBinding('judge').provider).toBe('claude')
    expect(cfg.getBinding('scout').provider).toBe('claude')
  })

  it('permet un override via le constructeur', () => {
    const cfg = new RoleModelConfig({ scout: { provider: 'claude', model: 'haiku' } })
    expect(cfg.getBinding('scout')).toEqual({
      provider: 'claude',
      model: 'haiku',
      reasoningEffort: 'high'
    })
    // les autres roles restent aux defauts
    expect(cfg.getBinding('orchestrator').provider).toBe('claude')
  })

  it('permet un override via setBinding, de facon chainable', () => {
    const cfg = new RoleModelConfig()
    const result = cfg
      .setBinding('judge', { provider: 'codex', model: 'gpt-5' })
      .setBinding('scout', { provider: 'claude' })
    expect(result).toBe(cfg) // chainable : retourne this
    // Moteur retiré : le binding n'est plus complété (aucun effort par défaut inventé pour lui).
    expect(cfg.getBinding('judge')).toEqual({ provider: 'codex', model: 'gpt-5' })
    expect(cfg.getBinding('scout')).toEqual({
      provider: 'claude',
      model: 'claude-fable-5',
      reasoningEffort: 'high'
    })
  })

  it('all() renvoie un snapshot des 4 roles', () => {
    const cfg = new RoleModelConfig()
    const snapshot = cfg.all()
    expect(Object.keys(snapshot).sort()).toEqual([...ALL_ROLES].sort())
    for (const role of ALL_ROLES) {
      expect(snapshot[role]).toEqual(cfg.getBinding(role))
    }
  })

  it('all() renvoie une copie independante (mutation externe sans effet)', () => {
    const cfg = new RoleModelConfig()
    const snapshot = cfg.all()
    snapshot.orchestrator = { provider: 'mutated' }
    expect(cfg.getBinding('orchestrator').provider).toBe('claude')
  })

  it('rend explicites le modele et effort effectivement transmis sur une installation neuve', () => {
    const cfg = new RoleModelConfig()
    expect(cfg.getBinding('orchestrator')).toEqual({
      provider: 'claude',
      model: 'claude-fable-5',
      reasoningEffort: 'high'
    })
  })

  it('normalise un role provider-only vers la selection canonique de son adaptateur', () => {
    const cfg = new RoleModelConfig({ orchestrator: { provider: 'claude' } })
    expect(cfg.getBinding('orchestrator')).toEqual({
      provider: 'claude',
      model: 'claude-fable-5',
      reasoningEffort: 'high'
    })
  })

  it('un provider retiré n’est PAS normalisé vers un modèle mort', () => {
    const cfg = new RoleModelConfig({ orchestrator: { provider: 'codex' } })
    expect(cfg.getBinding('orchestrator')).toEqual({ provider: 'codex' })
  })

  it('controle negatif : getBinding leve sur un role invalide (garde runtime)', () => {
    const cfg = new RoleModelConfig()
    // Contournement du typage pour simuler un appel JS non type / une valeur corrompue.
    expect(() => cfg.getBinding('bogus' as Role)).toThrow()
  })
})

describe('défauts de rôle par alias de famille (catalogue découvert)', () => {
  const claude = (model: string) => ({
    id: `claude/${model}`,
    provider: 'claude',
    model,
    label: model,
    reasoningEfforts: ['high' as const],
    defaultReasoningEffort: 'high' as const
  })
  const codex = (model: string, priority?: number) => ({
    id: `codex/${model}`,
    provider: 'codex',
    model,
    label: model,
    reasoningEfforts: ['medium' as const],
    defaultReasoningEffort: 'medium' as const,
    ...(priority !== undefined ? { priority, visibility: 'list' } : {})
  })

  it('un binding provider-only résout le plus frais de la famille via le catalogue', () => {
    const catalog = [claude('claude-fable-5'), claude('claude-fable-6'), claude('claude-opus-4-6')]
    const cfg = new RoleModelConfig({ orchestrator: { provider: 'claude' } }, catalog)
    expect(cfg.getBinding('orchestrator').model).toBe('claude-fable-6')
  })

  it('un provider RETIRÉ n’a plus de défaut : son binding ressort inchangé, jamais complété', () => {
    // Garde du retrait : compléter ce binding le ferait pointer vers un modèle mort et donnerait
    // l'illusion d'un moteur encore utilisable.
    const catalog = [codex('gpt-5.6-terra', 2), codex('gpt-5.7-sol', 1)]
    const cfg = new RoleModelConfig({ scout: { provider: 'codex' } }, catalog)
    expect(cfg.getBinding('scout').model).toBeUndefined()
  })

  it('sans catalogue → fallback figé historique (0 régression)', () => {
    const cfg = new RoleModelConfig({ orchestrator: { provider: 'claude' } })
    expect(cfg.getBinding('orchestrator').model).toBe('claude-fable-5')
  })

  it('alias insoluble (famille absente du catalogue) → fallback figé, jamais inventé', () => {
    const catalog = [claude('claude-opus-4-6')]
    // claude/fable-latest insoluble : aucun fable → fallback claude-fable-5.
    const cfg = new RoleModelConfig({ orchestrator: { provider: 'claude' } }, catalog)
    expect(cfg.getBinding('orchestrator').model).toBe('claude-fable-5')
  })

  it('un modèle EXPLICITE du binding reste prioritaire sur la résolution alias', () => {
    const catalog = [claude('claude-fable-5'), claude('claude-fable-6')]
    const cfg = new RoleModelConfig(
      { orchestrator: { provider: 'claude', model: 'claude-fable-5' } },
      catalog
    )
    expect(cfg.getBinding('orchestrator').model).toBe('claude-fable-5')
  })

  it('setCatalog alimente les normalisations ULTÉRIEURES sans toucher les bindings existants', () => {
    const cfg = new RoleModelConfig({ judge: { provider: 'claude' } })
    expect(cfg.getBinding('judge').model).toBe('claude-fable-5')
    cfg.setCatalog([claude('claude-fable-6')])
    // Binding existant intact (déjà normalisé → modèle explicite).
    expect(cfg.getBinding('judge').model).toBe('claude-fable-5')
    // Normalisation ultérieure provider-only → résolue via le catalogue injecté.
    cfg.setBinding('judge', { provider: 'claude' })
    expect(cfg.getBinding('judge').model).toBe('claude-fable-6')
    expect(cfg.getCatalog()?.length).toBe(1)
  })
})

describe('role-store Autowin OS', () => {
  let appDataRoot: string
  const originalAppData = process.env.APPDATA
  const bindings = {
    orchestrator: { provider: 'claude' },
    subagent: { provider: 'claude' },
    judge: { provider: 'claude' },
    scout: { provider: 'codex' }
  }

  beforeEach(() => {
    appDataRoot = mkdtempSync(join(tmpdir(), 'autowin-role-store-'))
    process.env.APPDATA = appDataRoot
  })

  afterEach(() => {
    if (originalAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = originalAppData
    rmSync(appDataRoot, { recursive: true, force: true })
  })

  it('saves roles.json in the autowin-os folder', () => {
    saveRoleBindings(bindings)

    expect(existsSync(join(appDataRoot, 'autowin-os', 'roles.json'))).toBe(true)
    expect(existsSync(join(legacyAppDataRoot(appDataRoot), 'roles.json'))).toBe(false)
  })

  it('migrates the legacy file without deleting it', () => {
    const legacyPath = join(legacyAppDataRoot(appDataRoot), 'roles.json')
    mkdirSync(legacyAppDataRoot(appDataRoot), { recursive: true })
    writeFileSync(legacyPath, JSON.stringify(bindings), 'utf8')

    expect(loadRoleBindings()).toEqual(bindings)
    expect(JSON.parse(readFileSync(join(appDataRoot, 'autowin-os', 'roles.json'), 'utf8'))).toEqual(
      bindings
    )
    expect(existsSync(legacyPath)).toBe(true)
  })

  it('récupère roles.json si un crash laisse seulement sa dernière version valide', () => {
    saveRoleBindings(bindings)
    const path = join(appDataRoot, 'autowin-os', 'roles.json')
    renameSync(path, `${path}.bak`)

    expect(loadRoleBindings()).toEqual(bindings)
  })

  it('écarte les bindings persistés mal formés au lieu de les injecter au runtime', () => {
    const path = join(appDataRoot, 'autowin-os', 'roles.json')
    mkdirSync(join(appDataRoot, 'autowin-os'), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({
        orchestrator: { provider: 'claude', model: 'fable', reasoningEffort: 'high' },
        subagent: { provider: 'claude', phaseModel: { phaseFantome: { model: 'fable' } } },
        judge: { provider: 42, model: ['gemini-2.5-pro'] },
        scout: { provider: 'codex', model: 'gpt', reasoningEffort: 'impossible' },
        roleFantome: { provider: 'gemini' }
      }),
      'utf8'
    )

    expect(loadRoleBindings()).toBeUndefined()
  })

  it('récupère le snapshot précédent si un binding devient structurellement invalide', () => {
    saveRoleBindings(bindings)
    saveRoleBindings(bindings)
    const path = join(appDataRoot, 'autowin-os', 'roles.json')
    writeFileSync(path, JSON.stringify({ judge: { provider: 42 } }), 'utf8')

    expect(loadRoleBindings()).toEqual(bindings)
  })
})

describe('AgentTopology', () => {
  it('pins a Fabric slot to its verified resource, manifest digest and explicit fallback', () => {
    const fabricModel = {
      id: 'fabric/node-gpu-01/qwen3-32b',
      provider: 'fabric:node-gpu-01:qwen3-32b',
      model: 'qwen3-32b',
      label: 'Qwen3 32B · node-gpu-01',
      reasoningEfforts: ['none' as const],
      defaultReasoningEffort: 'none' as const,
      compute: {
        kind: 'fabric' as const,
        nodeId: 'node-gpu-01',
        resourceId: 'qwen3-32b',
        mode: 'local-tools' as const,
        policyRef: 'policy:local-app-control-v1',
        manifestDigest: 'b'.repeat(64),
        fallback: { kind: 'none' as const }
      }
    }

    const binding = bindingForModel('orchestrator', fabricModel)
    const topology = createDefaultTopology([fabricModel])

    expect(binding.compute).toEqual(fabricModel.compute)
    expect(topology.orchestrator.compute).toEqual(fabricModel.compute)
  })

  it('stores model and effort independently for Scout and Judge slots', () => {
    const base = createDefaultTopology(TEST_MODEL_CATALOG)
    const codex = TEST_MODEL_CATALOG.find((model) => model.provider === 'codex')!
    const claude = TEST_MODEL_CATALOG.find((model) => model.provider === 'claude')!
    const withScout = setSlot(
      base,
      'scout',
      { ...bindingForModel('exploration', codex), reasoningEffort: 'high' },
      TEST_MODEL_CATALOG
    )
    const topology = setSlot(
      withScout,
      'judge',
      bindingForModel('security', claude),
      TEST_MODEL_CATALOG
    )

    expect(topology.panels.scout).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: 'exploration',
          modelId: codex.id,
          reasoningEffort: 'high'
        })
      ])
    )
    expect(topology.panels.judge).toEqual(
      expect.arrayContaining([expect.objectContaining({ slotId: 'security', modelId: claude.id })])
    )
  })

  it('rejects unknown models and unsupported effort levels', () => {
    const base = createDefaultTopology(TEST_MODEL_CATALOG)
    expect(() =>
      setSlot(
        base,
        'scout',
        {
          slotId: 'exploration',
          provider: 'codex',
          modelId: 'codex/unknown',
          reasoningEffort: 'low'
        },
        TEST_MODEL_CATALOG
      )
    ).toThrow('Modèle inconnu')

    const claude = TEST_MODEL_CATALOG.find((model) => model.provider === 'claude')!
    expect(() =>
      setSlot(
        base,
        'judge',
        { ...bindingForModel('security', claude), reasoningEffort: 'ultra' },
        TEST_MODEL_CATALOG
      )
    ).toThrow('Effort')
  })

  it('creates independent slots without mutating the source topology', () => {
    const base = createDefaultTopology(TEST_MODEL_CATALOG)
    const codex = TEST_MODEL_CATALOG.find((model) => model.provider === 'codex')!
    const added = setSlot(
      base,
      'scout',
      bindingForModel('contracts', codex),
      TEST_MODEL_CATALOG
    )
    expect(base.panels.scout.some((slot) => slot.slotId === 'contracts')).toBe(false)
    expect(added.panels.scout.some((slot) => slot.slotId === 'contracts')).toBe(true)
  })
})
