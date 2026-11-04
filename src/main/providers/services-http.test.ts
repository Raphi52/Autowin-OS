import { describe, expect, it } from 'vitest'
import { ROUTED_PROVIDERS } from '../routed-providers'
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

  it('catalogue : un service avec clé apparaît, sous son propre moteur', () => {
    const m = modelesServicesHttp({ GROQ_API_KEY: 'k' })
    expect(m.length).toBeGreaterThan(0)
    expect(m.every((x) => x.provider === 'api-groq' && x.id === `api-groq/${x.model}`)).toBe(true)
  })

  it('catalogue : sans clé, rien ; Ollama seulement sur activation explicite', () => {
    expect(modelesServicesHttp({})).toEqual([])
    expect(modelesServicesHttp({ AUTOWIN_OLLAMA: '1' }).map((x) => x.provider)).toContain(
      'api-ollama'
    )
  })
})
