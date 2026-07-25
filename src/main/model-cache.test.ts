import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadModelCache, mergeDiscoveryWithCache, saveModelCache } from './model-cache'
import { DEFAULT_IMPORTED_MODELS, type ImportedModel, type ModelDiscovery } from './models'

const liveCodexModel: ImportedModel = {
  id: 'codex/gpt-5.6-sol',
  provider: 'codex',
  model: 'gpt-5.6-sol',
  label: 'GPT-5.6-Sol · ChatGPT',
  reasoningEfforts: ['low', 'high'],
  defaultReasoningEffort: 'low'
}

const cachedClaudeModel: ImportedModel = {
  id: 'claude/claude-opus-4-8',
  provider: 'claude',
  model: 'claude-opus-4-8',
  label: 'Claude Opus 4.8 · CLI',
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultReasoningEffort: 'high'
}

describe('cache disque des modèles découverts', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'autowin-models-cache-'))
    path = join(dir, 'models-cache.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('save puis load restitue la liste à l’identique', () => {
    saveModelCache([liveCodexModel, cachedClaudeModel], path)
    expect(loadModelCache(path)).toEqual([liveCodexModel, cachedClaudeModel])
    // Le payload versionné est bien du JSON lisible.
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    expect(raw.version).toBe(1)
    expect(typeof raw.savedAt).toBe('string')
  })

  it('retourne undefined si le fichier est absent, corrompu ou invalide', () => {
    expect(loadModelCache(path)).toBeUndefined()
    writeFileSync(path, '{pas du json', 'utf8')
    expect(loadModelCache(path)).toBeUndefined()
    // Une entrée invalide (effort inconnu) invalide le cache ENTIER — pas de nom douteux.
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        savedAt: 'x',
        models: [{ ...liveCodexModel, reasoningEfforts: ['warp-speed'] }]
      }),
      'utf8'
    )
    expect(loadModelCache(path)).toBeUndefined()
  })
})

describe('fusion découverte × cache', () => {
  const seedCodex = DEFAULT_IMPORTED_MODELS[0]
  const seedClaude = DEFAULT_IMPORTED_MODELS.filter((m) => m.provider === 'claude')
  const seedKimi = DEFAULT_IMPORTED_MODELS.filter((m) => m.provider === 'kimi')

  it('une voie live fait autorité sur le cache', () => {
    const discovery: ModelDiscovery = {
      models: [liveCodexModel, ...seedClaude, ...seedKimi],
      live: { codex: true, claude: false }
    }
    const merged = mergeDiscoveryWithCache(discovery, [seedCodex, cachedClaudeModel])
    expect(merged.filter((m) => m.provider === 'codex')).toEqual([liveCodexModel])
    // claude en repli → dernière liste connue du cache, pas le seed.
    expect(merged.filter((m) => m.provider === 'claude')).toEqual([cachedClaudeModel])
    // kimi (aucune voie de listing) → toujours le seed vérifié.
    expect(merged.filter((m) => m.provider === 'kimi')).toEqual(seedKimi)
  })

  it('sans cache, une voie en repli garde son seed vérifié', () => {
    const discovery: ModelDiscovery = {
      models: [seedCodex, ...seedClaude, ...seedKimi],
      live: { codex: false, claude: false }
    }
    expect(mergeDiscoveryWithCache(discovery, undefined)).toEqual(discovery.models)
  })
})
