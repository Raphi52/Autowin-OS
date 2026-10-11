import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import type { DemandeFermeture, ResultatFermeture } from './hdesk-tv'

/*
 * LOT 1 du RUN outils-agent-1-2-4-6-7 (conv-222) : l'outil Autowin `bureau_cache_fermer`.
 * Le pont d'outils (lot 2) ne sert que des commandes DÉCLARÉES au catalogue : sans cette
 * déclaration, il n'y aurait rien à servir.
 *
 * Deux promesses : la conversation vient du FIL COURANT, jamais du modèle (le script refuse le
 * bureau d'un autre fil, encore faut-il ne pas lui mentir sur le fil) ; et un outil non câblé
 * le DIT au lieu de prétendre avoir fermé.
 */
const os = {
  conversations: { get: () => undefined, list: () => [] },
  listBrains: () => [],
  executionWorkspace: process.cwd()
} as unknown as ConstructorParameters<typeof AppCommandBus>[0]

const busAvec = (
  rendu: ResultatFermeture = { ok: true, code: 0, ferme: true, forces: [], survivants: [] }
): { bus: AppCommandBus; appels: DemandeFermeture[] } => {
  const bus = new AppCommandBus(os, () => undefined)
  const appels: DemandeFermeture[] = []
  bus.fermerBureauCache = async (d) => {
    appels.push(d)
    return rendu
  }
  return { bus, appels }
}

describe('bureau_cache_fermer', () => {
  it('est déclaré au catalogue comme un geste destructif, sans argument de conversation', () => {
    const spec = new AppCommandBus(os, () => undefined)
      .catalog()
      .find((c) => c.name === 'bureau_cache_fermer')
    expect(spec).toBeDefined()
    expect(spec?.annotations?.destructiveHint).toBe(true)
    expect(spec?.annotations?.readOnlyHint).toBe(false)
    expect(Object.keys(spec?.args ?? {})).not.toContain('conversationId')
  })

  it('sans identifiant, ferme le bureau du fil courant (chat-<fil>)', async () => {
    const { bus, appels } = busAvec()
    const r = await bus.exec('bureau_cache_fermer', {}, 'conv-222')
    expect(r.ok).toBe(true)
    expect(appels).toEqual([{ id: 'chat-conv-222', conversationId: 'conv-222' }])
    expect(r.data).toMatchObject({ ferme: true, id: 'chat-conv-222' })
  })

  it('transmet un identifiant et un délai, mais garde le fil courant', async () => {
    const { bus, appels } = busAvec()
    await bus.exec(
      'bureau_cache_fermer',
      { id: 'run-abc', delaiDouxSecondes: '3', conversationId: 'conv-pirate' },
      'conv-222'
    )
    expect(appels).toEqual([{ id: 'run-abc', conversationId: 'conv-222', delaiDouxSecondes: 3 }])
  })

  it('rend le refus du script (autre conversation) sans le maquiller', async () => {
    const { bus } = busAvec({
      ok: false,
      code: 5,
      ferme: false,
      conversationOccupante: 'conv-b',
      erreur: "Bureau 'x' d'une autre conversation (conv-b)"
    })
    const r = await bus.exec('bureau_cache_fermer', { id: 'x' }, 'conv-222')
    expect(r.data).toMatchObject({ ferme: false, code: 5 })
    expect(String((r.data as { detail?: string }).detail)).toMatch(/autre conversation/)
  })

  it('refuse sans conversation courante, et dit quand il n est pas câblé', async () => {
    const { bus, appels } = busAvec()
    const sansFil = await bus.exec('bureau_cache_fermer', {})
    expect(sansFil.data).toMatchObject({ ferme: false })
    expect(appels).toEqual([])

    const nonCable = new AppCommandBus(os, () => undefined)
    const r = await nonCable.exec('bureau_cache_fermer', {}, 'conv-222')
    expect(r.data).toMatchObject({ ferme: false })
    expect(String((r.data as { detail?: string }).detail)).toMatch(/indisponible/i)
  })
})
