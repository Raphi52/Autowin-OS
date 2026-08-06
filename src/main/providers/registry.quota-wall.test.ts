import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderRegistry } from './registry'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './types'

/**
 * UN QUOTA ÉPUISÉ DOIT FERMER LA PORTE, PAS SEULEMENT ÊTRE BIEN NOMMÉ.
 *
 * Dépouillement des 1894 runs rouges le 2026-08-06 : **852 d'entre eux (70 % des échecs réels) ont pour
 * unique cause le mur de quota codex** — « You've hit your usage limit … try again at Aug 8th ».
 *
 * Le correctif du 2026-08-04 (`9cb3be8`) avait ajouté la SIGNATURE `usage-limit-reached` pour cesser de
 * relancer à l'intérieur d'un tour. Mais rien n'empêchait de LANCER un run neuf vers le même provider
 * mort : 285 runs ont heurté le mur APRÈS ce correctif, le dernier le 2026-08-05 à 16:29. Le message de
 * ce commit annonçait « bloque enfin le provider » — le code ne le faisait pas.
 *
 * Le registre est « le seul point par lequel l'app envoie un tour » : le disjoncteur y couvre d'un coup
 * le chat, les phases, le fan-out, le juge et la réparation.
 */

class FauxProvider implements ProviderAdapter {
  appels = 0
  /** Erreur à lever au prochain appel ; `undefined` = réussir. */
  erreur: Error | undefined

  constructor(readonly id: string) {}

  async auth(): Promise<boolean> {
    return true
  }

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    void options
    this.appels += 1
    if (this.erreur) throw this.erreur
    return { text: 'ok', provider: this.id, systemInjected: false }
  }
}

/** Le refus tel que le provider l'écrit vraiment, relevé dans les journaux de production. */
const MUR_DE_QUOTA = new Error(
  'codex exec échec exit-code=1 last-event={"type":"turn.failed","error":{"message":' +
    '"You\'ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more ' +
    'credits or try again at Aug 8th, 2026 7:20 AM."}}'
)

/** Un rate-limit PASSAGER : même HTTP 429, mais il se rétablit en secondes. */
const RATE_LIMIT = new Error('codex responses HTTP 429 — rate limit exceeded, retry after 20s')

const UN_TOUR = [{ role: 'user' as const, content: 'travaille' }]

describe('disjoncteur de quota provider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T10:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('après un mur de quota, l’appel suivant est REFUSÉ sans toucher l’adaptateur', async () => {
    const codex = new FauxProvider('codex')
    const registry = new ProviderRegistry().register(codex)

    codex.erreur = MUR_DE_QUOTA
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow()
    expect(codex.appels).toBe(1)

    // Le mur est maintenant connu : le second appel ne doit PAS repartir vers le provider.
    codex.erreur = undefined
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow(/quota/i)
    expect(codex.appels).toBe(1) // toujours 1 : rien n'a été lancé
  })

  it('le refus DIT pourquoi et jusqu’à quand — sinon il est indiscernable d’une panne', async () => {
    const codex = new FauxProvider('codex')
    const registry = new ProviderRegistry().register(codex)
    codex.erreur = MUR_DE_QUOTA
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow()

    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow(/codex/)
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow(/quota/i)
  })

  it('un rate-limit PASSAGER n’ouvre PAS le disjoncteur — discriminant', async () => {
    const codex = new FauxProvider('codex')
    const registry = new ProviderRegistry().register(codex)

    codex.erreur = RATE_LIMIT
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow()

    // Bloquer là-dessus transformerait une attente de 20 s en panne de provider pour tout le run.
    codex.erreur = undefined
    await expect(registry.send('codex', UN_TOUR)).resolves.toMatchObject({ text: 'ok' })
    expect(codex.appels).toBe(2)
  })

  it('le mur d’un provider ne ferme pas la porte des AUTRES — discriminant', async () => {
    const codex = new FauxProvider('codex')
    const claude = new FauxProvider('claude')
    const registry = new ProviderRegistry().register(codex).register(claude)

    codex.erreur = MUR_DE_QUOTA
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow()

    await expect(registry.send('claude', UN_TOUR)).resolves.toMatchObject({ text: 'ok' })
    expect(claude.appels).toBe(1)
  })

  it('le blocage EXPIRE : une sonde repasse, le quota rétabli n’est pas verrouillé des jours', async () => {
    const codex = new FauxProvider('codex')
    const registry = new ProviderRegistry().register(codex)

    codex.erreur = MUR_DE_QUOTA
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow()
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow(/quota/i)

    // La date de reset annoncée n'est PAS analysée : un format mal lu bloquerait un provider sain
    // pendant des jours. Fenêtre bornée, donc auto-cicatrisante.
    vi.setSystemTime(new Date('2026-08-06T11:00:00Z'))
    codex.erreur = undefined
    await expect(registry.send('codex', UN_TOUR)).resolves.toMatchObject({ text: 'ok' })
    expect(codex.appels).toBe(2)
  })
})
