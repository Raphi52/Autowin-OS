import { describe, expect, it } from 'vitest'
import { outilsDuChat } from '../chat/chat-mcp'
import { AppCommandBus, CATALOG } from './commands'
import { MOTIF_MAX_ARRET_FIL } from '../conversations/arreter-un-fil'

/*
 * conv-1625 (2026-11-05) : conv-1613 a payé 402 $ en boucle et l'agent qui l'a vue ne pouvait pas
 * la couper. Verrouillé ici : `arreter_un_fil` coupe le tour ET le run d'un AUTRE fil (le geste du
 * bouton Arrêter), refuse le fil de l'appelant, et dit quand rien ne tournait.
 */
function bus(opts: { tours?: boolean; enVol?: string[] } = {}) {
  const depot = process.cwd()
  const fils = ['conv-A', 'conv-B'].map((id) => ({
    id,
    projectPath: depot,
    updatedAt: Date.now(),
    messages: []
  }))
  const os = {
    executionWorkspace: depot,
    conversations: { get: (id: string) => fils.find((f) => f.id === id), list: () => fils },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 })
  }
  const evenements: unknown[] = []
  const b = new AppCommandBus(os as never, (e: unknown) => evenements.push(e))
  b.conversationExiste = (id) => fils.some((f) => f.id === id)
  const toursCoupes: Array<[string, string]> = []
  if (opts.tours !== false)
    b.toursDeChat = {
      abort: (id: string, motif: string) => {
        toursCoupes.push([id, motif])
        return (opts.enVol ?? []).includes(id)
      },
      abortAndWait: async () => false
    }
  return { b, toursCoupes, evenements }
}

describe('arreter_un_fil par le bus', () => {
  it('coupe le tour ET le run du fil nommé, avec un motif qui dit qui a coupé', async () => {
    const { b, toursCoupes, evenements } = bus({ enVol: ['conv-B'] })
    const run = b.registerOrchestration('conv-B')
    const r = await b.exec(
      'arreter_un_fil',
      { conversationId: 'conv-B', motif: 'boucle de réparation sans fin' },
      'conv-A'
    )
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ fil: 'conv-B', tourCoupe: true, runCoupe: true })
    expect(run.signal.aborted).toBe(true)
    expect(String(run.signal.reason)).toBe(
      'arret demande par conv-A (arreter_un_fil) : boucle de réparation sans fin'
    )
    expect(toursCoupes).toEqual([['conv-B', String(run.signal.reason)]])
    expect(evenements).toContainEqual({ type: 'refresh', scope: 'chat' })
  })

  it('rien ne tournait : le dit, sans prétendre avoir coupé', async () => {
    const { b, evenements } = bus()
    const r = await b.exec('arreter_un_fil', { conversationId: 'conv-B', motif: 'x' }, 'conv-A')
    expect(r.data).toMatchObject({ tourCoupe: false, runCoupe: false })
    expect((r.data as { detail: string }).detail).toMatch(/Rien ne tournait dans conv-B/)
    expect(evenements).not.toContainEqual({ type: 'refresh', scope: 'chat' })
  })

  it('tours non câblés : le run est coupé, le tour est dit non vérifié', async () => {
    const { b } = bus({ tours: false })
    const r = await b.exec('arreter_un_fil', { conversationId: 'conv-B', motif: 'x' }, 'conv-A')
    expect((r.data as { detail: string }).detail).toMatch(/n'a pas pu être vérifié/)
  })

  it('refuse son propre fil, un fil inconnu, un appel hors fil, un motif absent ou trop long', async () => {
    const { b } = bus({ enVol: ['conv-A', 'conv-B'] })
    const run = b.registerOrchestration('conv-A')
    const propre = await b.exec(
      'arreter_un_fil',
      { conversationId: 'conv-A', motif: 'x' },
      'conv-A'
    )
    expect(propre.error).toMatch(/ton propre fil/)
    expect(run.signal.aborted).toBe(false)
    const inconnu = await b.exec(
      'arreter_un_fil',
      { conversationId: 'conv-Z', motif: 'x' },
      'conv-A'
    )
    expect(inconnu.error).toMatch(/inconnu, archivé ou supprimé/)
    const horsFil = await b.exec('arreter_un_fil', { conversationId: 'conv-B', motif: 'x' })
    expect(horsFil.error).toMatch(/aucun fil d'origine/)
    const sansMotif = await b.exec('arreter_un_fil', { conversationId: 'conv-B' }, 'conv-A')
    expect(sansMotif.error).toMatch(/motif absent/)
    const long = await b.exec(
      'arreter_un_fil',
      { conversationId: 'conv-B', motif: 'm'.repeat(MOTIF_MAX_ARRET_FIL + 1) },
      'conv-A'
    )
    expect(long.error).toMatch(/limite est 300/)
  })

  it('servi aux agents du chat, motif et fil obligatoires', () => {
    expect(outilsDuChat(CATALOG)).toContain('arreter_un_fil')
    const spec = CATALOG.find((c) => c.name === 'arreter_un_fil')
    expect(Object.keys(spec?.args ?? {}).sort()).toEqual(['conversationId', 'motif'])
    expect(spec?.argsFacultatifs ?? []).toEqual([])
    expect(spec?.annotations?.destructiveHint).toBe(true)
  })
})
