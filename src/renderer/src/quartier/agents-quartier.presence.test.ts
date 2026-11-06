// @vitest-environment happy-dom
/**
 * L'envoi de l'instantané des tanukis au processus principal (plan « Village commun ») :
 * regroupé sur 2 s, et seulement quand il change — un tour envoie des dizaines d'événements par
 * seconde, et la plupart ne changent ni la phase ni le poste d'un tanuki.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentAPublier } from '../../../shared/quartier-presence'
import type { AgentQuartier } from './agents-quartier'

type Module = typeof import('./agents-quartier')

let envoyer: ReturnType<typeof vi.fn<(agents: AgentAPublier[]) => Promise<void>>>

async function charger(): Promise<Module> {
  vi.resetModules()
  return import('./agents-quartier')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-02T08:00:00Z'))
  envoyer = vi.fn(async () => undefined)
  ;(window as unknown as { api: unknown }).api = { quartierPresence: envoyer }
})

afterEach(() => {
  vi.useRealTimers()
  delete (window as unknown as { api?: unknown }).api
})

describe('agentAPublier', () => {
  it('rend id, titre, phase, poste et date, et ne marque privé qu’un fil privé', async () => {
    const { agentAPublier } = await charger()
    const a: AgentQuartier = {
      id: 'conv-1',
      titre: 'Corrige le bouton',
      phase: 'travail',
      metier: 'lire',
      actions: ['x'],
      depuis: 42,
      vuLe: 43
    }
    expect(agentAPublier(a)).toEqual({
      id: 'conv-1',
      titre: 'Corrige le bouton',
      phase: 'travail',
      metier: 'lire',
      depuis: 42
    })
    expect(agentAPublier({ ...a, prive: true })).toMatchObject({ prive: true })
  })
})

describe('l’instantané part au processus principal', () => {
  it('regroupé sur 2 s : une rafale d’événements fait un seul envoi', async () => {
    const m = await charger()
    m.recevoirEvenementPilote({
      kind: 'command',
      conversationId: 'conv-1',
      name: 'Read',
      actionId: 'a'
    })
    m.recevoirEvenementPilote({ kind: 'result', conversationId: 'conv-1', actionId: 'a' })
    m.recevoirEvenementPilote({
      kind: 'command',
      conversationId: 'conv-2',
      name: 'Grep',
      actionId: 'b'
    })
    vi.advanceTimersByTime(m.ENVOI_PRESENCE_MS - 1)
    expect(envoyer).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(envoyer).toHaveBeenCalledTimes(1)
    const [liste] = envoyer.mock.calls[0]
    expect(liste.map((a) => [a.id, a.phase])).toEqual([
      ['conv-2', 'travail'],
      ['conv-1', 'reflexion']
    ])
  })

  it('un instantané inchangé ne repart pas ; un changement repart', async () => {
    const m = await charger()
    m.recevoirEvenementPilote({
      kind: 'command',
      conversationId: 'conv-1',
      name: 'Read',
      actionId: 'a'
    })
    vi.advanceTimersByTime(m.ENVOI_PRESENCE_MS)
    expect(envoyer).toHaveBeenCalledTimes(1)
    // Un morceau de texte ne change ni la phase ni le poste.
    m.recevoirEvenementPilote({ kind: 'delta', conversationId: 'conv-1' })
    vi.advanceTimersByTime(m.ENVOI_PRESENCE_MS)
    expect(envoyer).toHaveBeenCalledTimes(1)
    m.recevoirEvenementPilote({ kind: 'done', conversationId: 'conv-1' })
    vi.advanceTimersByTime(m.ENVOI_PRESENCE_MS)
    expect(envoyer).toHaveBeenCalledTimes(2)
    expect(envoyer.mock.calls[1][0][0].phase).toBe('fini')
  })

  it('sans pont (preload d’avant redémarrage), rien ne part et rien ne casse', async () => {
    ;(window as unknown as { api: unknown }).api = {}
    const m = await charger()
    expect(() =>
      m.recevoirEvenementPilote({ kind: 'command', conversationId: 'conv-1', name: 'Read' })
    ).not.toThrow()
    vi.advanceTimersByTime(m.ENVOI_PRESENCE_MS)
    expect(envoyer).not.toHaveBeenCalled()
  })
})
