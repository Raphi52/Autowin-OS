import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_IMPORTED_MODELS, discoverImportedModels, findModel } from './models'
import { appendClaudeSelectionArgs } from './providers/claude'

const noCodexAuth = (): null => null
const noCodexModels = async (): Promise<[]> => []

describe('catalogue Agents dynamique', () => {
  it('expose Kimi Code compte comme modèle sélectionnable, sans API key', () => {
    expect(DEFAULT_IMPORTED_MODELS).toContainEqual(
      expect.objectContaining({
        id: 'kimi/kimi-code/kimi-for-coding',
        provider: 'kimi',
        model: 'kimi-code/kimi-for-coding'
      })
    )
  })

  it('importe Fable et tous les modèles Claude réellement exposés', async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        data: [{ id: 'claude-fable-5' }, { id: 'claude-opus-4-8' }, { id: 'intrus-non-claude' }]
      })
    )

    const models = await discoverImportedModels(
      fetchFn as unknown as typeof fetch,
      noCodexAuth,
      undefined,
      noCodexModels
    )

    expect(models.map((model) => model.model)).toEqual([
      'gpt-5.6-terra',
      'claude-fable-5',
      'claude-opus-4-8',
      'kimi-code/kimi-for-coding'
    ])
    expect(models.find((model) => model.model === 'claude-fable-5')?.reasoningEfforts).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max'
    ])
    expect(models.find((model) => model.model === 'claude-fable-5')?.label).toBe(
      'Claude Fable 5 · CLI'
    )
    expect(models.find((model) => model.model === 'claude-opus-4-8')?.label).toBe(
      'Claude Opus 4.8 · CLI'
    )
  })

  it('retombe sur le catalogue vérifié si le bridge est indisponible', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('bridge hors ligne')
    })

    const models = await discoverImportedModels(
      fetchFn as unknown as typeof fetch,
      noCodexAuth,
      undefined,
      noCodexModels
    )

    expect(models.some((model) => model.model === 'gpt-5.6-terra')).toBe(true)
    expect(models.some((model) => model.model === 'claude-fable-5')).toBe(true)
    expect(models.some((model) => model.model === 'claude-opus-4-6')).toBe(true)
  })

  it('importe tous les modèles réellement exposés par le compte ChatGPT', async () => {
    const fetchFn = vi.fn(async () => Response.json({ data: [{ id: 'claude-fable-5' }] }))
    const listCodexModels = vi.fn(async () => [
      {
        id: 'gpt-5.6-sol',
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6-Sol',
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'ultra' }],
        defaultReasoningEffort: 'low'
      },
      {
        id: 'gpt-5.4-mini',
        model: 'gpt-5.4-mini',
        displayName: 'GPT-5.4-Mini',
        hidden: true,
        isDefault: false,
        supportedReasoningEfforts: [{ reasoningEffort: 'medium' }],
        defaultReasoningEffort: 'medium'
      },
      {
        id: '../intrus',
        model: '../intrus',
        displayName: 'Intrus',
        hidden: false,
        isDefault: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: 'medium'
      }
    ])

    const models = await discoverImportedModels(
      fetchFn as unknown as typeof fetch,
      noCodexAuth,
      undefined,
      listCodexModels
    )

    expect(models.map((model) => model.model)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.4-mini',
      'claude-fable-5',
      'kimi-code/kimi-for-coding'
    ])
    // 'ultra' est filtré (400 sur /responses) → seul 'low' reste. Non-régression du fix HTTP 400.
    expect(models[0]).toMatchObject({
      id: 'codex/gpt-5.6-sol',
      label: 'GPT-5.6-Sol · ChatGPT',
      reasoningEfforts: ['low'],
      defaultReasoningEffort: 'low'
    })
    // priority/visibility (contrat flagship) sont portés quand le listing les expose.
    expect(models[1]).toMatchObject({ visibility: 'hide' })
  })
})

describe('cache disque du dernier catalogue vu', () => {
  const tempDirs: string[] = []
  const makeCachePath = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'autowin-models-'))
    tempDirs.push(dir)
    return join(dir, 'model-catalog.json')
  }
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  const liveClaudeFetch = vi.fn(async () =>
    Response.json({ data: [{ id: 'claude-fable-5' }, { id: 'claude-opus-4-8' }] })
  )
  const deadFetch = vi.fn(async () => {
    throw new Error('API KO')
  })

  it('écrit le cache à chaque listing réussi, puis le relit quand l’API est KO', async () => {
    const cachePath = makeCachePath()

    const live = await discoverImportedModels(
      liveClaudeFetch as unknown as typeof fetch,
      noCodexAuth,
      cachePath,
      noCodexModels
    )
    expect(live.some((m) => m.model === 'claude-opus-4-8')).toBe(true)
    const written = JSON.parse(readFileSync(cachePath, 'utf8'))
    expect(written).toMatchObject({ version: 1, discoveredAt: expect.any(Number) })
    expect(written.claude.map((m: { model: string }) => m.model)).toEqual([
      'claude-fable-5',
      'claude-opus-4-8'
    ])

    // API KO → dernier catalogue vu (cache), PAS le seed figé (qui n'a pas opus-4-8).
    const offline = await discoverImportedModels(
      deadFetch as unknown as typeof fetch,
      noCodexAuth,
      cachePath,
      noCodexModels
    )
    expect(offline.some((m) => m.model === 'claude-opus-4-8')).toBe(true)
    expect(offline.some((m) => m.model === 'claude-opus-4-6')).toBe(false)
    // Le repli n'a pas ré-écrit le cache avec le seed.
    expect(JSON.parse(readFileSync(cachePath, 'utf8')).claude).toHaveLength(2)
  })

  it('API KO sans cache → seed vérifié, sans inventer de noms', async () => {
    const offline = await discoverImportedModels(
      deadFetch as unknown as typeof fetch,
      noCodexAuth,
      makeCachePath(),
      noCodexModels
    )
    expect(offline.some((m) => m.model === 'gpt-5.6-terra')).toBe(true)
    expect(offline.some((m) => m.model === 'claude-fable-5')).toBe(true)
    expect(offline.some((m) => m.model === 'claude-opus-4-8')).toBe(false)
  })
})

describe('résolution des alias par famille via findModel', () => {
  it('id concret prioritaire, alias résolu au runtime, alias insoluble → undefined', () => {
    const catalog = DEFAULT_IMPORTED_MODELS
    expect(findModel(catalog, 'claude/claude-opus-4-6')?.model).toBe('claude-opus-4-6')
    expect(findModel(catalog, 'claude/opus-latest')?.model).toBe('claude-opus-4-6')
    expect(findModel(catalog, 'claude/fable-latest')?.model).toBe('claude-fable-5')
    expect(findModel(catalog, 'codex/flagship')?.model).toBe('gpt-5.6-terra')
    expect(findModel(catalog, 'claude/sonnet-latest')).toBeUndefined()
    expect(findModel(catalog, 'claude/inexistant')).toBeUndefined()
  })
})

describe('sélection Claude depuis Agents', () => {
  it('transmet le modèle Fable et l’effort au CLI', () => {
    const args: string[] = []

    appendClaudeSelectionArgs(args, {
      model: 'claude-fable-5',
      reasoningEffort: 'xhigh'
    })

    expect(args).toEqual(['--model', 'claude-fable-5', '--effort', 'xhigh'])
  })

  it('n’invente pas de flag effort pour none', () => {
    const args: string[] = []

    appendClaudeSelectionArgs(args, { model: 'claude-haiku-4-5-20251001', reasoningEffort: 'none' })

    expect(args).toEqual(['--model', 'claude-haiku-4-5-20251001'])
  })
})
