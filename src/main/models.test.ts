import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DEFAULT_IMPORTED_MODELS,
  DiskModelCatalogCache,
  discoverImportedModels,
  type ImportedModel,
  type ModelCatalogCache
} from './models'
import { appendClaudeSelectionArgs } from './providers/claude'

const noCodexAuth = (): null => null

describe('catalogue Agents dynamique', () => {
  it('persiste uniquement le catalogue des providers rafra\u00eechissables', () => {
    const directory = mkdtempSync(join(tmpdir(), 'autowin-models-'))
    const path = join(directory, 'catalog.json')
    try {
      const cache = new DiskModelCatalogCache(path)
      cache.save(DEFAULT_IMPORTED_MODELS)

      expect(existsSync(path)).toBe(true)
      expect(cache.load().map((model) => model.provider)).toEqual([
        'codex',
        'claude',
        'claude',
        'claude'
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('offline fallback reuses the latest cache without rewriting it', async () => {
    const cached: ImportedModel[] = [
      {
        id: 'codex/gpt-5.9-nova',
        provider: 'codex',
        model: 'gpt-5.9-nova',
        label: 'GPT 5.9 Nova',
        reasoningEfforts: ['medium'],
        defaultReasoningEffort: 'medium'
      },
      {
        id: 'claude/claude-opus-4-9',
        provider: 'claude',
        model: 'claude-opus-4-9',
        label: 'Claude Opus 4.9',
        reasoningEfforts: ['high'],
        defaultReasoningEffort: 'high'
      }
    ]
    const saved: ImportedModel[][] = [cached]
    const cache: ModelCatalogCache = {
      load: () => saved.at(-1) ?? [],
      save: vi.fn((models: ImportedModel[]) => saved.push(models))
    }
    const online = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('chatgpt.com')) {
        return Response.json({
          models: [{ slug: 'gpt-5.10-terra', supported_reasoning_levels: [{ effort: 'medium' }] }]
        })
      }
      return Response.json({ data: [{ id: 'claude-opus-4-10' }] })
    })

    const refreshed = await discoverImportedModels(online as unknown as typeof fetch, () => ({
      accessToken: 'token-test',
      refreshToken: 'refresh-test',
      obtainedAt: Date.now()
    }), cache)
    const unavailable = vi.fn(async () => {
      throw new Error('hors ligne')
    })
    const save = cache.save as ReturnType<typeof vi.fn>
    save.mockClear()
    const fallback = await discoverImportedModels(
      unavailable as unknown as typeof fetch,
      () => ({ accessToken: 'token-test', refreshToken: 'refresh-test', obtainedAt: Date.now() }),
      cache
    )

    expect(fallback).toEqual(refreshed)
    expect(save).not.toHaveBeenCalled()
    expect(fallback).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'codex/latest', model: 'gpt-5.10-terra' }),
        expect.objectContaining({ id: 'claude/latest', model: 'claude-opus-4-10' }),
        expect.objectContaining({ id: 'kimi/kimi-code/kimi-for-coding' })
      ])
    )
  })

  it('sans cache Codex ni accès réseau, retourne exactement le seed Terra', async () => {
    const cache: ModelCatalogCache = { load: () => [], save: vi.fn() }

    const models = await discoverImportedModels(
      vi.fn(async () => {
        throw new Error('hors ligne')
      }) as unknown as typeof fetch,
      () => ({ accessToken: 'token-test', refreshToken: 'refresh-test', obtainedAt: Date.now() }),
      cache
    )

    expect(models.filter((model) => model.provider === 'codex' && !model.id.endsWith('/latest'))).toEqual([
      DEFAULT_IMPORTED_MODELS[0]
    ])
  })

  it('actualise le cache et fait pointer latest vers la version la plus r\u00e9cente', async () => {
    const cache: ModelCatalogCache = { load: () => [], save: vi.fn() }
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('chatgpt.com'))
        return Response.json({
          models: [
            { slug: 'gpt-5.6-terra', supported_reasoning_levels: [{ effort: 'medium' }] },
            { slug: 'gpt-5.10-terra', supported_reasoning_levels: [{ effort: 'medium' }] }
          ]
        })
      return Response.json({ data: [{ id: 'claude-opus-4-8' }, { id: 'claude-opus-4-10' }] })
    })

    const models = await discoverImportedModels(
      fetchFn as unknown as typeof fetch,
      () => ({
        accessToken: 'token-test',
        refreshToken: 'refresh-test',
        obtainedAt: Date.now()
      }),
      cache
    )

    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'codex/latest', model: 'gpt-5.10-terra' }),
        expect.objectContaining({ id: 'claude/latest', model: 'claude-opus-4-10' })
      ])
    )
    expect(cache.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'codex', model: 'gpt-5.10-terra' }),
        expect.objectContaining({ provider: 'claude', model: 'claude-opus-4-10' })
      ])
    )
  })

  it('ne modifie ni l’ordre des modèles Claude du bridge ni l’entrée Kimi', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('chatgpt.com')) {
        return Response.json({
          models: [{ slug: 'gpt-5.10-terra', supported_reasoning_levels: [{ effort: 'medium' }] }]
        })
      }
      return Response.json({ data: [{ id: 'claude-fable-5' }, { id: 'claude-opus-4-8' }] })
    })

    const models = await discoverImportedModels(fetchFn as unknown as typeof fetch, () => ({
      accessToken: 'token-test',
      refreshToken: 'refresh-test',
      obtainedAt: Date.now()
    }))

    expect(models.filter((model) => !model.id.endsWith('/latest')).map((model) => model.model)).toEqual([
      'gpt-5.10-terra',
      'claude-fable-5',
      'claude-opus-4-8',
      'kimi-code/kimi-for-coding'
    ])
    expect(models.at(-1)).toEqual(DEFAULT_IMPORTED_MODELS.at(-1))
  })

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

    const models = await discoverImportedModels(fetchFn as unknown as typeof fetch, noCodexAuth)

    expect(
      models.filter((model) => !model.id.endsWith('/latest')).map((model) => model.model)
    ).toEqual(['gpt-5.6-terra', 'claude-fable-5', 'claude-opus-4-8', 'kimi-code/kimi-for-coding'])
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

    const models = await discoverImportedModels(fetchFn as unknown as typeof fetch, noCodexAuth)

    expect(models.some((model) => model.model === 'gpt-5.6-terra')).toBe(true)
    expect(models.some((model) => model.model === 'claude-fable-5')).toBe(true)
  })

  it('importe tous les modèles réellement exposés par le compte ChatGPT', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('chatgpt.com/backend-api/codex/models')) {
        return Response.json({
          models: [
            {
              slug: 'gpt-5.6-sol',
              display_name: 'GPT-5.6-Sol',
              supported_reasoning_levels: [{ effort: 'low' }, { effort: 'ultra' }],
              default_reasoning_level: 'low'
            },
            {
              slug: 'gpt-5.4-mini',
              display_name: 'GPT-5.4-Mini',
              visibility: 'hide',
              supported_reasoning_levels: [{ effort: 'medium' }],
              default_reasoning_level: 'medium'
            },
            { slug: '../intrus', display_name: 'Intrus' }
          ]
        })
      }
      return Response.json({ data: [{ id: 'claude-fable-5' }] })
    })

    const models = await discoverImportedModels(fetchFn as unknown as typeof fetch, () => ({
      accessToken: 'token-test',
      refreshToken: 'refresh-test',
      obtainedAt: Date.now()
    }))

    expect(
      models.filter((model) => !model.id.endsWith('/latest')).map((model) => model.model)
    ).toEqual(['gpt-5.6-sol', 'gpt-5.4-mini', 'claude-fable-5', 'kimi-code/kimi-for-coding'])
    expect(models[0]).toMatchObject({
      id: 'codex/gpt-5.6-sol',
      label: 'GPT-5.6-Sol · ChatGPT',
      reasoningEfforts: ['low', 'ultra'],
      defaultReasoningEffort: 'low'
    })
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
