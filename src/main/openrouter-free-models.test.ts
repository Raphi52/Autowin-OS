import { describe, expect, it } from 'vitest'
import {
  chargerModelesGratuits,
  environnementClaudeOpenRouter,
  filtrerModelesGratuits,
  lancementOpenRouter,
  MESSAGE_CLE_OPENROUTER_MANQUANTE,
  quotaJournalierOpenRouter
} from './openrouter-free-models'

const outils = ['tools', 'temperature']
const brut = [
  { id: 'deepseek/deepseek-chat:free', supported_parameters: outils },
  { id: 'deepseek/deepseek-chat', supported_parameters: outils },
  { id: 'google/gemini-2.5-flash:free', supported_parameters: outils },
  { id: 'moonshotai/kimi-k2:free', supported_parameters: outils },
  { id: 'meta/llama:free', supported_parameters: ['temperature'] },
  { id: 'qwen/qwen3-coder:free', supported_parameters: outils },
  null
]

describe('modèles gratuits OpenRouter (conv-1471)', () => {
  it('garde les :free avec outils, refuse payants et sans outils (Gemini/Kimi admis)', () => {
    expect(filtrerModelesGratuits(brut).map((m) => m.id)).toEqual([
      'deepseek/deepseek-chat:free',
      'google/gemini-2.5-flash:free',
      'moonshotai/kimi-k2:free',
      'qwen/qwen3-coder:free'
    ])
  })

  it('rejette un cache disque corrompu', () => {
    expect(filtrerModelesGratuits('corrompu')).toEqual([])
  })

  it('lit le catalogue live et filtre', async () => {
    const fetchFn = (async () => ({ ok: true, json: async () => ({ data: brut }) })) as never
    expect(await chargerModelesGratuits(fetchFn)).toHaveLength(4)
    const ko = (async () => ({ ok: false, status: 503 })) as never
    await expect(chargerModelesGratuits(ko)).rejects.toThrow('503')
  })

  it('pointe Claude Code sur OpenRouter seulement avec une clé', () => {
    expect(environnementClaudeOpenRouter('qwen/qwen3-coder:free', {})).toBeNull()
    const env = environnementClaudeOpenRouter('qwen/qwen3-coder:free', {
      OPENROUTER_API_KEY: ' k '
    })
    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      ANTHROPIC_AUTH_TOKEN: 'k',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: 'qwen/qwen3-coder:free'
    })
  })
})

describe('lancementOpenRouter (conv-1471)', () => {
  it('refuse sans clé avec un message qui nomme OPENROUTER_API_KEY', () => {
    expect(() => lancementOpenRouter('openrouter/x/y:free', {})).toThrow(
      MESSAGE_CLE_OPENROUTER_MANQUANTE
    )
    expect(MESSAGE_CLE_OPENROUTER_MANQUANTE).toContain('OPENROUTER_API_KEY')
  })

  it('pointe le CLI sur OpenRouter avec une clé, sans le préfixe du catalogue', () => {
    const r = lancementOpenRouter('openrouter/x/y:free', { OPENROUTER_API_KEY: 'sk-faux' })
    expect(r?.model).toBe('x/y:free')
    expect(r?.env.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api')
    expect(r?.env.ANTHROPIC_MODEL).toBe('x/y:free')
  })

  it('ignore un modèle hors OpenRouter, même sans clé', () => {
    expect(lancementOpenRouter('opus', {})).toBeNull()
    expect(lancementOpenRouter(undefined, {})).toBeNull()
  })
})

// conv-1496 : modèles qui refusent, et quota journalier partagé des modèles gratuits.
describe('OpenRouter — exclusions et quota journalier', () => {
  it('retire du catalogue les modèles exclus par la sonde', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ data: brut }))) as unknown as typeof fetch
    const ids = (
      await chargerModelesGratuits(fetchFn, new Set(['deepseek/deepseek-chat:free']))
    ).map((m) => m.id)
    expect(ids).not.toContain('deepseek/deepseek-chat:free')
    expect(ids.length).toBeGreaterThan(0)
  })

  it('lit free_model_daily_requests et date la remise à zéro à minuit UTC', async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ data: { free_model_daily_requests: { used: 17, limit: 50 } } })
      )) as unknown as typeof fetch
    const jour = await quotaJournalierOpenRouter(fetchFn, 'cle', Date.parse('2026-11-04T09:00:00Z'))
    expect(jour).toEqual({ used: 17, limit: 50, resetsAt: '2026-11-05T00:00:00.000Z' })
  })

  it('sans clé ni plafond exposé : une erreur, jamais une fausse barre', async () => {
    expect(await quotaJournalierOpenRouter(fetch, '')).toHaveProperty('erreur')
    const vide = (async () => new Response('{"data":{}}')) as unknown as typeof fetch
    expect(await quotaJournalierOpenRouter(vide, 'cle')).toHaveProperty('erreur')
  })
})
