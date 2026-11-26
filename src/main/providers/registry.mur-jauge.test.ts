import { describe, expect, it } from 'vitest'
import { ProviderRegistry } from './registry'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './types'
import type { ModelQuotaWindow } from '../../shared/model-quotas'

/**
 * LE MUR D'UN COMPTE TOMBE QUAND SA JAUGE MESURE DU QUOTA DISPONIBLE.
 *
 * Constaté le 2026-11-26 : l'utilisateur a remis à zéro le quota de son compte pro. La barre de
 * quota, qui lit les en-têtes d'un vrai appel à l'API avec la session de ce compte, montrait les
 * jauges pleines ; le tour suivant échouait pourtant en 1 ms sur « quota épuisé jusqu'au mardi
 * 1 décembre », sans avoir appelé Claude : le mur, posé par le refus d'avant, ne tombait qu'à
 * l'heure annoncée ou au redémarrage. Une mesure faite de toute façon pour la jauge vaut preuve :
 * on la relit, on ne sonde rien de plus.
 */
class FauxProvider implements ProviderAdapter {
  appels = 0
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

/** Le refus LITTÉRAL du tour du 2026-11-26 (journal de tour du fil). */
const REFUS_HEBDO = (): Error =>
  new Error(
    "Claude a interrompu l'appel : You've hit your weekly limit · resets Dec 1, 1am (Europe/Paris)"
  )
const UN_TOUR = [{ role: 'user' as const, content: 'travaille' }]

const fenetre = (id: string, usedPercent: number, modelFamily?: string): ModelQuotaWindow => ({
  id,
  label: id,
  usedPercent,
  remainingPercent: 100 - usedPercent,
  ...(modelFamily ? { modelFamily } : {})
})

const JAUGES_PLEINES = [fenetre('five-hour', 0), fenetre('seven-day', 2)]

/** Un registre dont le compte actif « pro » vient d'être muré par le refus hebdomadaire. */
async function registreMure(): Promise<{ registry: ProviderRegistry; claude: FauxProvider }> {
  const claude = new FauxProvider('claude')
  const registry = new ProviderRegistry(undefined, undefined, () => 'pro').register(claude)
  claude.erreur = REFUS_HEBDO()
  await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/weekly limit/)
  claude.erreur = undefined
  return { registry, claude }
}

describe('mur de quota — levé par la jauge du compte', () => {
  it('une jauge du compte sous 100 % rouvre la porte, sans redémarrage ni attente', async () => {
    const { registry, claude } = await registreMure()
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/quota épuisé/)
    expect(claude.appels).toBe(1)

    expect(registry.leverMurSiQuotaMesure('claude', 'pro', JAUGES_PLEINES)).toBe(true)

    const rendu = await registry.send('claude', UN_TOUR)
    expect(rendu.text).toBe('ok')
    expect(claude.appels).toBe(2)
  })

  it('une jauge encore à 100 % garde le mur — la mesure dit toujours « épuisé »', async () => {
    const { registry, claude } = await registreMure()
    const epuise = [fenetre('five-hour', 12), fenetre('seven-day', 100)]
    expect(registry.leverMurSiQuotaMesure('claude', 'pro', epuise)).toBe(false)
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/quota épuisé/)
    expect(claude.appels).toBe(1)
  })

  it('une jauge mesurée AVANT le refus ne lève pas le mur qu’il vient de poser', async () => {
    const avantLeRefus = Date.now() - 1
    const { registry, claude } = await registreMure()
    expect(registry.leverMurSiQuotaMesure('claude', 'pro', JAUGES_PLEINES, avantLeRefus)).toBe(
      false
    )
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/quota épuisé/)
    expect(claude.appels).toBe(1)
  })

  it('la jauge d’un AUTRE compte ne lève pas ce mur : deux abonnements, deux quotas', async () => {
    const { registry, claude } = await registreMure()
    expect(registry.leverMurSiQuotaMesure('claude', 'perso', JAUGES_PLEINES)).toBe(false)
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/quota épuisé/)
    expect(claude.appels).toBe(1)
  })

  it('sans fenêtre du compte entier, rien n’est prouvé : une limite de modèle seule ne lève rien', async () => {
    const { registry, claude } = await registreMure()
    expect(registry.leverMurSiQuotaMesure('claude', 'pro', [])).toBe(false)
    expect(
      registry.leverMurSiQuotaMesure('claude', 'pro', [fenetre('seven-day-opus', 0, 'opus')])
    ).toBe(false)
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/quota épuisé/)
    expect(claude.appels).toBe(1)
  })
})
