import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ModelResolver,
  mergeWithPersisted,
  resolveFamilyAlias,
  savePersistedCatalog
} from './model-resolver'
import { DEFAULT_IMPORTED_MODELS, type ImportedModel } from './models'

const claude = (model: string): ImportedModel => ({
  id: `claude/${model}`,
  provider: 'claude',
  model,
  label: model,
  reasoningEfforts: ['low', 'high'],
  defaultReasoningEffort: 'high'
})

const CATALOG: ImportedModel[] = [
  claude('claude-opus-4-6'),
  claude('claude-opus-4-5'),
  claude('claude-sonnet-4-5-20250929'),
  claude('claude-sonnet-4-5-20251101'),
  claude('claude-haiku-4-5-20251001'),
  {
    id: 'codex/gpt-5.6-terra',
    provider: 'codex',
    model: 'gpt-5.6-terra',
    label: 'terra',
    reasoningEfforts: ['medium'],
    defaultReasoningEffort: 'medium'
  }
]

const tempDirs: string[] = []
function tempCatalogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-model-catalog-'))
  tempDirs.push(dir)
  return join(dir, 'model-catalog.json')
}
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('resolveFamilyAlias', () => {
  it('résout opus-latest vers le plus récent de la famille', () => {
    expect(resolveFamilyAlias(CATALOG, 'opus-latest')?.model).toBe('claude-opus-4-6')
  })
  it('départage deux snapshots par la date', () => {
    expect(resolveFamilyAlias(CATALOG, 'claude/sonnet-latest')?.model).toBe(
      'claude-sonnet-4-5-20251101'
    )
  })
  it('respecte le préfixe provider', () => {
    expect(resolveFamilyAlias(CATALOG, 'codex/gpt-latest')?.model).toBe('gpt-5.6-terra')
    expect(resolveFamilyAlias(CATALOG, 'codex/opus-latest')).toBeUndefined()
  })
  it("n'invente jamais : famille absente du catalogue → undefined", () => {
    expect(resolveFamilyAlias(CATALOG, 'kimi-latest')).toBeUndefined()
    expect(resolveFamilyAlias(CATALOG, 'inconnu-latest')).toBeUndefined()
    expect(resolveFamilyAlias(CATALOG, 'pas-un-alias')).toBeUndefined()
  })
})

describe('mergeWithPersisted', () => {
  it('préfère le persisté quand la discovery est retombée sur le seed', () => {
    const seedClaude = DEFAULT_IMPORTED_MODELS.filter((m) => m.provider === 'claude')
    const persisted = [claude('claude-opus-4-6'), claude('claude-sonnet-4-5-20251101')]
    const merged = mergeWithPersisted(seedClaude, persisted)
    expect(merged.map((m) => m.model)).toEqual(persisted.map((m) => m.model))
  })
  it('préfère la discovery fraîche quand elle est réelle (non-seed)', () => {
    const fresh = [claude('claude-opus-4-7')]
    const merged = mergeWithPersisted(fresh, [claude('claude-opus-4-6')])
    expect(merged.map((m) => m.model)).toEqual(['claude-opus-4-7'])
  })
  it('sans persisté → discovery telle quelle', () => {
    expect(mergeWithPersisted(CATALOG, undefined)).toEqual(CATALOG)
  })
})

describe('ModelResolver', () => {
  it('refresh() persiste le catalogue et resolveAlias() le consomme', async () => {
    const path = tempCatalogPath()
    const resolver = new ModelResolver({ discover: async () => CATALOG, catalogPath: path })
    await resolver.refresh()
    expect(resolver.resolveAlias('opus-latest')).toBe('claude-opus-4-6')
    expect(resolver.resolveAlias('claude/claude-haiku-4-5-20251001')).toBe(
      'claude-haiku-4-5-20251001'
    )
    expect(resolver.resolveAlias('nimporte-quoi')).toBeUndefined()
    const persisted = JSON.parse(readFileSync(path, 'utf8'))
    expect(persisted.models).toHaveLength(CATALOG.length)
  })

  it('fallback : discovery en seed + catalogue persisté riche → persisté', async () => {
    const path = tempCatalogPath()
    savePersistedCatalog(CATALOG, path)
    const resolver = new ModelResolver({
      discover: async () => DEFAULT_IMPORTED_MODELS,
      catalogPath: path
    })
    // Avant tout refresh : le persisté est déjà l'état initial.
    expect(resolver.resolveAlias('sonnet-latest')).toBe('claude-sonnet-4-5-20251101')
    await resolver.refresh()
    // Après un refresh retombé sur le seed : le persisté riche survit.
    expect(resolver.resolveAlias('sonnet-latest')).toBe('claude-sonnet-4-5-20251101')
    expect(resolver.resolveAlias('opus-latest')).toBe('claude-opus-4-6')
  })

  it("un nouveau modèle apparu au catalogue déplace la résolution sans changement de code", async () => {
    const path = tempCatalogPath()
    let live: ImportedModel[] = CATALOG
    const resolver = new ModelResolver({ discover: async () => live, catalogPath: path })
    await resolver.refresh()
    expect(resolver.resolveAlias('opus-latest')).toBe('claude-opus-4-6')
    live = [...CATALOG, claude('claude-opus-4-7')]
    await resolver.refresh()
    expect(resolver.resolveAlias('opus-latest')).toBe('claude-opus-4-7')
  })

  it('échec API dur (discover jette) : la dernière liste persistée reste servie', async () => {
    const path = tempCatalogPath()
    savePersistedCatalog(CATALOG, path)
    const resolver = new ModelResolver({
      discover: async () => {
        throw new Error('API down')
      },
      catalogPath: path
    })
    await expect(resolver.refresh()).rejects.toThrow('API down')
    expect(resolver.resolveAlias('opus-latest')).toBe('claude-opus-4-6')
    expect(resolver.resolveAlias('sonnet-latest')).toBe('claude-sonnet-4-5-20251101')
  })

  it('sans persisté ni réseau : état initial = seed vérifié, jamais vide', () => {
    const resolver = new ModelResolver({
      discover: async () => DEFAULT_IMPORTED_MODELS,
      catalogPath: tempCatalogPath()
    })
    expect(resolver.getModels()).toEqual(DEFAULT_IMPORTED_MODELS)
    expect(resolver.resolveAlias('fable-latest')).toBe('claude-fable-5')
  })
})
