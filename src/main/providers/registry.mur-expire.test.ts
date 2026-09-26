import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderRegistry } from './registry'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './types'

/**
 * LE DISJONCTEUR DE QUOTA SE LÈVE À L'HEURE QUE LE REFUS ANNONCE.
 *
 * Jusqu'au 2026-09-16, `quotaWalls` n'était JAMAIS vidée : seul un redémarrage rouvrait la porte,
 * et le message de refus le disait lui-même. Mesuré dans
 * `.autowin-data/autowin-os/causal-trace/conv-539.jsonl` : deux appels refusés le 2026-09-15 à
 * 13h31 UTC (15h31 à Paris) sur un mur qui annonçait « resets 3:20pm (Europe/Paris) » — onze
 * minutes APRÈS son propre retour. La reprise automatique programmée par
 * `deciderRepriseProgrammee` à cette heure-là partait donc dans le vide, et comme elle ne rejoue
 * jamais deux fois la même échéance, l'attente redevenait manuelle.
 *
 * Ce test exerce le VRAI registre de bout en bout : aucune recopie de la règle.
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

/** Le refus LITTÉRAL relevé dans les traces du 2026-09-15 (14 occurrences pour cette heure-là). */
const REFUS_REEL = new Error('Claude session limit · resets 3:20pm (Europe/Paris)')
/** Un refus MUET sur l'heure : celui-ci doit garder l'ancien comportement (mur jusqu'au redémarrage). */
const REFUS_SANS_HEURE = new Error("Claude: you've hit your usage limit for this plan")
const UN_TOUR = [{ role: 'user' as const, content: 'travaille' }]

describe('mur de quota — levée automatique à l’heure annoncée', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 15h05 à Paris (UTC+2 en septembre) : quinze minutes avant le retour annoncé.
    vi.setSystemTime(new Date('2026-09-15T13:05:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('refuse sans appeler le provider AVANT l’heure, puis le rappelle APRÈS — sans redémarrage', async () => {
    const claude = new FauxProvider('claude')
    const registry = new ProviderRegistry().register(claude)

    claude.erreur = REFUS_REEL
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/session limit/i)
    expect(claude.appels).toBe(1)

    // 15h19 : le mur tient, et il tient SANS toucher au provider (le quota ne se sonde pas).
    vi.setSystemTime(new Date('2026-09-15T13:19:00Z'))
    claude.erreur = undefined
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/quota épuisé/i)
    expect(claude.appels).toBe(1)

    // 15h31 — l'instant EXACT des deux refus réellement enregistrés. La porte doit être rouverte.
    vi.setSystemTime(new Date('2026-09-15T13:31:00Z'))
    const rendu = await registry.send('claude', UN_TOUR)
    expect(rendu.text).toBe('ok')
    expect(claude.appels).toBe(2)
  })

  it('annonce l’heure de réouverture au lieu de promettre le redémarrage', async () => {
    const claude = new FauxProvider('claude')
    const registry = new ProviderRegistry().register(claude)
    claude.erreur = REFUS_REEL
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow()
    claude.erreur = undefined
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(
      /se rouvre d'elle-même à \d{2}:\d{2}/
    )
  })

  it('un refus qui n’annonce aucune heure garde le mur — et promet toujours le redémarrage', async () => {
    const claude = new FauxProvider('claude')
    const registry = new ProviderRegistry().register(claude)
    claude.erreur = REFUS_SANS_HEURE
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow()
    claude.erreur = undefined

    // Des JOURS plus tard : sans heure annoncée, on ne devine rien, le mur tient.
    vi.setSystemTime(new Date('2026-09-20T10:00:00Z'))
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/Relancer l'app/)
    expect(claude.appels).toBe(1)
  })
})
