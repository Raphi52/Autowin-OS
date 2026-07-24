import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_IMPORTED_MODELS, discoverImportedModels } from './models'
import { appendClaudeSelectionArgs } from './providers/claude'

const noCodexAuth = (): null => null

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

    const models = await discoverImportedModels(fetchFn as unknown as typeof fetch, noCodexAuth)

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
