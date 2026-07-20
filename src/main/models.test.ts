import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_IMPORTED_MODELS,
  discoverImportedModels,
  discoverOmniRouteModels,
  labelOmniRouteModel
} from './models'
import { appendClaudeSelectionArgs } from './providers/claude'

const noCodexAuth = (): null => null

describe('catalogue Agents dynamique', () => {
  it('affiche des noms OmniRoute propres sans altérer les ids techniques', () => {
    expect(labelOmniRouteModel('auto')).toBe('Sélection automatique')
    expect(labelOmniRouteModel('auto/coding')).toBe('Automatique · Code')
    expect(labelOmniRouteModel('auto/best-coding')).toBe('Meilleur modèle · Code')
    expect(labelOmniRouteModel('auto/best-reasoning')).toBe('Meilleur modèle · Raisonnement')
    expect(labelOmniRouteModel('custom:priority-chain')).toBe('Chaîne prioritaire personnalisée')
    expect(labelOmniRouteModel('claude-opus-4-6')).toBe('Claude Opus 4.6')
    expect(labelOmniRouteModel('gpt-5.6-sol')).toBe('GPT-5.6 Sol')
    expect(labelOmniRouteModel('cc/claude-opus-4-8')).toBe('Claude Opus 4.8')
    expect(labelOmniRouteModel('claude/claude-sonnet-4-6')).toBe('Claude Sonnet 4.6')
    expect(labelOmniRouteModel('cx/gpt-5.6-terra-ultra')).toBe('GPT-5.6 Terra · Ultra')
    expect(labelOmniRouteModel('tllm/GPT_5_4')).toBe('GPT-5.4')
    expect(labelOmniRouteModel('aug/gemini-3.1-pro')).toBe('Gemini 3.1 Pro')
    expect(labelOmniRouteModel('no-think/cc/claude-opus-4-8')).toBe(
      'Claude Opus 4.8 · Sans raisonnement'
    )
  })

  it('importe uniquement les modèles réellement exposés par OmniRoute', async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer gateway-token')
      return Response.json({
        object: 'list',
        data: [
          { id: 'auto', owned_by: 'combo' },
          { id: 'auto/coding', owned_by: 'combo' },
          { id: 'custom:priority-chain' },
          { id: '../intrus' },
          { id: '' },
          { nope: 'missing-id' }
        ]
      })
    })
    const models = await discoverOmniRouteModels(fetchFn as typeof fetch, {
      get: () => 'gateway-token'
    })
    expect(models.map((model) => model.id)).toEqual([
      'omniroute/auto',
      'omniroute/auto/coding',
      'omniroute/custom:priority-chain'
    ])
    expect(models[1]).toEqual(
      expect.objectContaining({
        provider: 'omniroute',
        model: 'auto/coding',
        label: 'Automatique · Code',
        reasoningEfforts: ['none']
      })
    )
  })

  it('expose les vrais paliers d’effort quand OmniRoute publie effort_tiers', async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        object: 'list',
        data: [
          {
            id: 'cc/claude-opus-4-8',
            owned_by: 'claude',
            capabilities: { effort_tiers: ['none', 'low', 'medium', 'high', 'xhigh'] }
          },
          { id: 'auto/claude-opus', owned_by: 'combo' }
        ]
      })
    )
    const models = await discoverOmniRouteModels(fetchFn as typeof fetch, {
      get: () => 'gateway-token'
    })
    // Modèle fixe : les 5 paliers réels + défaut 'high'.
    expect(models.find((model) => model.model === 'cc/claude-opus-4-8')).toEqual(
      expect.objectContaining({
        reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
        defaultReasoningEffort: 'high'
      })
    )
    // Route combo sans effort_tiers : fallback 'none' (effort géré par OmniRoute).
    expect(models.find((model) => model.model === 'auto/claude-opus')).toEqual(
      expect.objectContaining({ reasoningEfforts: ['none'], defaultReasoningEffort: 'none' })
    )
  })

  it('déduplique les alias OmniRoute qui produisent le même modèle visible', async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        object: 'list',
        data: [
          { id: 'cc/claude-opus-4-8' },
          { id: 'claude/claude-opus-4-8' },
          { id: 'cx/gpt-5.6-terra-ultra' }
        ]
      })
    )

    const models = await discoverOmniRouteModels(fetchFn as typeof fetch, {
      get: () => 'gateway-token'
    })

    expect(models.map((model) => model.label)).toEqual(['Claude Opus 4.8', 'GPT-5.6 Terra · Ultra'])
  })

  it('does not invent OmniRoute models when auth or schema is unavailable', async () => {
    const fetchFn = vi.fn(async () => Response.json({ object: 'list', data: 'hostile' }))
    expect(await discoverOmniRouteModels(fetchFn as typeof fetch, { get: () => null })).toEqual([])
    expect(await discoverOmniRouteModels(fetchFn as typeof fetch, { get: () => 'token' })).toEqual(
      []
    )
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
