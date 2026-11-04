import { describe, expect, it } from 'vitest'
import {
  chargerModelesGroq,
  filtrerModelesGroq,
  lancementGroq,
  MESSAGE_CLE_GROQ_MANQUANTE
} from './groq-free-models'

describe('modèles gratuits Groq servis par Codex (conv-1499)', () => {
  it('garde Kimi/Qwen/gpt-oss actifs, refuse audio, garde-fous et inactifs', () => {
    const brut = [
      { id: 'moonshotai/kimi-k2-instruct', active: true },
      { id: 'qwen/qwen3-32b', active: true },
      { id: 'openai/gpt-oss-120b' },
      { id: 'whisper-large-v3', active: true },
      { id: 'meta-llama/llama-guard-4-12b', active: true },
      { id: 'qwen/qwen-old', active: false },
      null
    ]
    expect(filtrerModelesGroq(brut).map((m) => m.id)).toEqual([
      'moonshotai/kimi-k2-instruct',
      'qwen/qwen3-32b',
      'openai/gpt-oss-120b'
    ])
  })

  it('sans clé : aucun appel réseau, aucun modèle', async () => {
    let appels = 0
    const f = (async () => {
      appels++
      return new Response('{}')
    }) as typeof fetch
    expect(await chargerModelesGroq(f, {})).toEqual([])
    expect(appels).toBe(0)
  })

  it('avec clé : envoie la clé en en-tête et filtre la réponse', async () => {
    let auth = ''
    const f = (async (_u: unknown, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>).Authorization
      return new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3-32b' }, { id: 'whisper-x' }] }))
    }) as typeof fetch
    expect((await chargerModelesGroq(f, { GROQ_API_KEY: 'gsk-faux' })).map((m) => m.id)).toEqual([
      'qwen/qwen3-32b'
    ])
    expect(auth).toBe('Bearer gsk-faux')
  })

  it('lancement : null hors Groq, erreur nommée sans clé, id nu + réglages sinon', () => {
    expect(lancementGroq('gpt-6-luna', {})).toBeNull()
    expect(() => lancementGroq('groq/qwen/qwen3-32b', {})).toThrow(MESSAGE_CLE_GROQ_MANQUANTE)
    const r = lancementGroq('groq/qwen/qwen3-32b', { GROQ_API_KEY: 'gsk-secret' })
    expect(r?.model).toBe('qwen/qwen3-32b')
    expect(r?.config).toContain('model_providers.groq.wire_api="responses"')
    expect(r?.config.join(' ')).not.toContain('gsk-secret')
  })
})
