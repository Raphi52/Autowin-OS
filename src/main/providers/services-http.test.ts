import { describe, expect, it } from 'vitest'
import { ROUTED_PROVIDERS } from './routed-providers'
import { ProviderRegistry } from './registry'
import { adaptateursServicesHttp, modelesServicesHttp, SERVICES_HTTP } from './services-http'

describe('services HTTP servis sans CLI (conv-1499)', () => {
  it('chaque service est un moteur routé et s’enregistre au registre', () => {
    const registre = new ProviderRegistry()
    for (const a of adaptateursServicesHttp()) registre.register(a)
    for (const s of SERVICES_HTTP) {
      expect(ROUTED_PROVIDERS).toContain(s.id)
      expect(registre.get(s.id)?.id).toBe(s.id)
    }
    expect(ROUTED_PROVIDERS.slice(0, 2)).toEqual(['claude', 'codex'])
  })

  it('aucun service par clé d’API : abonnements seulement (conv-1522)', () => {
    expect(SERVICES_HTTP).toEqual([])
    const cles = { GEMINI_API_KEY: 'k', XAI_API_KEY: 'k', MISTRAL_API_KEY: 'k', NVIDIA_API_KEY: 'k' }
    expect(modelesServicesHttp(cles)).toEqual([])
    expect(ROUTED_PROVIDERS.some((p) => p.startsWith('api-'))).toBe(false)
  })
})
