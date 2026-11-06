import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dureeRateLimitMs,
  getModelQuotaSnapshot,
  invalidateModelQuotaCache,
  noterQuotaServiceHttp,
  parseRateLimitHeadersHttp,
  resetQuotasServicesHttpForTests
} from './model-quotas'
import type { ImportedModel } from './models'

// Le quota d'un service direct ne vient QUE de ses en-têtes x-ratelimit-*.
afterEach(() => {
  resetQuotasServicesHttpForTests()
  invalidateModelQuotaCache()
})

const NOW = Date.parse('2026-11-04T10:00:00Z')

describe('dureeRateLimitMs', () => {
  it('lit les formats OpenAI et les secondes nues', () => {
    expect(dureeRateLimitMs('1m30.5s')).toBe(90_500)
    expect(dureeRateLimitMs('6ms')).toBe(6)
    expect(dureeRateLimitMs('2')).toBe(2_000)
  })
  it('refuse un texte qui n’est pas une durée', () => {
    expect(dureeRateLimitMs('demain')).toBeUndefined()
    expect(dureeRateLimitMs('1m bientôt')).toBeUndefined()
    expect(dureeRateLimitMs(null)).toBeUndefined()
  })
})

describe('parseRateLimitHeadersHttp', () => {
  it('rend une fenêtre par genre publié, avec le pourcentage restant réel', () => {
    const fenetres = parseRateLimitHeadersHttp(
      new Headers({
        'x-ratelimit-limit-requests': '1000',
        'x-ratelimit-remaining-requests': '250',
        'x-ratelimit-reset-requests': '1m'
      }),
      NOW
    )
    expect(fenetres).toEqual([
      {
        id: 'requests',
        label: 'Requêtes',
        usedPercent: 75,
        remainingPercent: 25,
        resetsAt: '2026-11-04T10:01:00.000Z'
      }
    ])
  })
  it('n’invente rien sans en-tête, ni avec une limite sans reste', () => {
    expect(parseRateLimitHeadersHttp(new Headers(), NOW)).toEqual([])
    expect(
      parseRateLimitHeadersHttp(new Headers({ 'x-ratelimit-limit-tokens': '100' }), NOW)
    ).toEqual([])
  })
})

describe('snapshot avec un service direct', () => {
  const models = [
    { id: 'api-gemini/qwen', provider: 'api-gemini', model: 'qwen', label: 'qwen' },
    { id: 'api-mistral/m', provider: 'api-mistral', model: 'm', label: 'm' }
  ] as unknown as ImportedModel[]
  const options = {
    home: mkdtempSync(join(tmpdir(), 'autowin-quota-http-')),
    fetchFn: vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch,
    now: NOW
  }

  it('montre le quota publié, et « non exposé » pour le service muet', async () => {
    noterQuotaServiceHttp(
      'api-gemini',
      new Headers({ 'x-ratelimit-limit-tokens': '200', 'x-ratelimit-remaining-tokens': '50' }),
      NOW
    )
    const snap = await getModelQuotaSnapshot(models, { ...options, force: true })
    const gemini = snap.models.find((m) => m.provider === 'api-gemini')!
    expect(gemini.status).toBe('available')
    expect(gemini.windows[0]).toMatchObject({ id: 'tokens', remainingPercent: 25 })
    const mistral = snap.models.find((m) => m.provider === 'api-mistral')!
    expect(mistral).toMatchObject({
      status: 'unavailable',
      source: 'Quota non exposé',
      windows: []
    })
  })

  it('une mesure notée après le relevé apparaît sans attendre la fin du cache', async () => {
    await getModelQuotaSnapshot(models, { ...options, force: true })
    noterQuotaServiceHttp(
      'api-mistral',
      new Headers({ 'x-ratelimit-limit-requests': '10', 'x-ratelimit-remaining-requests': '9' }),
      NOW
    )
    const snap = await getModelQuotaSnapshot(models, options)
    expect(snap.models.find((m) => m.provider === 'api-mistral')?.status).toBe('available')
  })

  it('une réponse sans en-tête ne remplace pas une mesure tenue', async () => {
    noterQuotaServiceHttp(
      'api-mistral',
      new Headers({ 'x-ratelimit-limit-requests': '10', 'x-ratelimit-remaining-requests': '9' }),
      NOW
    )
    noterQuotaServiceHttp('api-mistral', new Headers(), NOW)
    const snap = await getModelQuotaSnapshot(models, { ...options, force: true })
    expect(snap.models.find((m) => m.provider === 'api-mistral')?.windows[0]).toMatchObject({
      id: 'requests',
      remainingPercent: 90
    })
  })
})
