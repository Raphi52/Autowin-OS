import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RoleModelConfig, ALL_ROLES, type Role } from './roles'
import { loadRoleBindings, saveRoleBindings } from './role-store'
import { legacyAppDataRoot } from './app-data'
import { DEFAULT_IMPORTED_MODELS } from './models'
import {
  bindingForModel,
  createDefaultTopology,
  removeSlot,
  resolveTopology,
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

  it('utilise les defauts raisonnables attendus (claude partout sauf scout->codex)', () => {
    const cfg = new RoleModelConfig()
    expect(cfg.getBinding('orchestrator').provider).toBe('claude')
    expect(cfg.getBinding('subagent').provider).toBe('claude')
    expect(cfg.getBinding('judge').provider).toBe('claude')
    expect(cfg.getBinding('scout').provider).toBe('codex')
  })

  it('permet un override via le constructeur', () => {
    const cfg = new RoleModelConfig({ scout: { provider: 'claude', model: 'haiku' } })
    expect(cfg.getBinding('scout')).toEqual({ provider: 'claude', model: 'haiku' })
    // les autres roles restent aux defauts
    expect(cfg.getBinding('orchestrator').provider).toBe('claude')
  })

  it('permet un override via setBinding, de facon chainable', () => {
    const cfg = new RoleModelConfig()
    const result = cfg
      .setBinding('judge', { provider: 'codex', model: 'gpt-5' })
      .setBinding('scout', { provider: 'claude' })
    expect(result).toBe(cfg) // chainable : retourne this
    expect(cfg.getBinding('judge')).toEqual({ provider: 'codex', model: 'gpt-5' })
    expect(cfg.getBinding('scout')).toEqual({ provider: 'claude' })
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

  it('le model optionnel est absent (undefined) quand non fourni, jamais invente', () => {
    const cfg = new RoleModelConfig()
    expect(cfg.getBinding('orchestrator').model).toBeUndefined()
  })

  it('controle negatif : getBinding leve sur un role invalide (garde runtime)', () => {
    const cfg = new RoleModelConfig()
    // Contournement du typage pour simuler un appel JS non type / une valeur corrompue.
    expect(() => cfg.getBinding('bogus' as Role)).toThrow()
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
})

describe('AgentTopology', () => {
  it('stores model and effort independently for Scout and Judge slots', () => {
    const base = createDefaultTopology(DEFAULT_IMPORTED_MODELS)
    const codex = DEFAULT_IMPORTED_MODELS.find((model) => model.provider === 'codex')!
    const claude = DEFAULT_IMPORTED_MODELS.find((model) => model.provider === 'claude')!
    const withScout = setSlot(
      base,
      'scout',
      { ...bindingForModel('exploration', codex), reasoningEffort: 'high' },
      DEFAULT_IMPORTED_MODELS
    )
    const topology = setSlot(
      withScout,
      'judge',
      bindingForModel('security', claude),
      DEFAULT_IMPORTED_MODELS
    )

    expect(resolveTopology(topology, DEFAULT_IMPORTED_MODELS).scout).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: 'exploration',
          model: codex.model,
          reasoningEffort: 'high'
        })
      ])
    )
    expect(resolveTopology(topology, DEFAULT_IMPORTED_MODELS).judge).toEqual(
      expect.arrayContaining([expect.objectContaining({ slotId: 'security', model: claude.model })])
    )
  })

  it('rejects unknown models and unsupported effort levels', () => {
    const base = createDefaultTopology(DEFAULT_IMPORTED_MODELS)
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
        DEFAULT_IMPORTED_MODELS
      )
    ).toThrow('Modèle inconnu')

    const claude = DEFAULT_IMPORTED_MODELS.find((model) => model.provider === 'claude')!
    expect(() =>
      setSlot(
        base,
        'judge',
        { ...bindingForModel('security', claude), reasoningEffort: 'ultra' },
        DEFAULT_IMPORTED_MODELS
      )
    ).toThrow('Effort')
  })

  it('creates and removes independent slots without mutating the source topology', () => {
    const base = createDefaultTopology(DEFAULT_IMPORTED_MODELS)
    const codex = DEFAULT_IMPORTED_MODELS.find((model) => model.provider === 'codex')!
    const added = setSlot(
      base,
      'scout',
      bindingForModel('contracts', codex),
      DEFAULT_IMPORTED_MODELS
    )
    const removed = removeSlot(added, 'scout', 'contracts')

    expect(base.panels.scout.some((slot) => slot.slotId === 'contracts')).toBe(false)
    expect(added.panels.scout.some((slot) => slot.slotId === 'contracts')).toBe(true)
    expect(removed.panels.scout.some((slot) => slot.slotId === 'contracts')).toBe(false)
  })
})
