// @vitest-environment happy-dom
/**
 * LE FIL PRIVÉ, DU RÉSUMÉ AU PARTAGE (D6 de `grill/agent-hq-japon-town.md`, conv-1429, lot 3).
 *
 * Un fil marqué privé garde son tanuki chez les collègues, mais sans titre. La marque part du
 * résumé `os:conversations`, entre dans l'agent du Quartier, part dans l'instantané envoyé au
 * processus principal, et `presence.json` l'écrit SANS titre. Démarquer le fil doit rendre le titre :
 * une marque qui ne se retire pas cacherait le fil pour toujours.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentAPublier } from '../../../shared/quartier-presence'
import { presenceAEcrire } from '../../../main/quartier-presence'
import {
  agentAPublier,
  agentsEnScene,
  appliquerEvenement,
  appliquerResumes,
  type AgentQuartier,
  type ResumeFil
} from './agents-quartier'

const T0 = 1_800_000_000_000
const vide: ReadonlyMap<string, AgentQuartier> = new Map()
const REGLAGE = { nom: 'Poste A', partager: true }

describe('appliquerResumes : la marque « privé » suit le résumé', () => {
  it.each<[string, ResumeFil]>([
    ['un tour en cours', { id: 'a', title: 'Secret', hasStreamingTurn: true, prive: true }],
    [
      'une question ouverte',
      { id: 'a', title: 'Secret', updatedAt: T0, lastAssistantAsksUser: true, prive: true }
    ],
    [
      'un tour fini',
      { id: 'a', title: 'Secret', updatedAt: T0, lastAssistantStatus: 'completed', prive: true }
    ]
  ])('fil privé avec %s : le tanuki est là, marqué privé', (_cas, resume) => {
    const a = appliquerResumes(vide, [resume], T0 + 1_000).get('a')
    expect(a?.prive).toBe(true)
  })

  it('un fil non marqué n’a pas la marque (pas même `false`)', () => {
    const a = appliquerResumes(vide, [{ id: 'a', title: 'T', hasStreamingTurn: true }], T0)
    expect(a.get('a')).not.toHaveProperty('prive')
  })

  it('démarquer le fil retire la marque, même pour un tanuki déjà au travail', () => {
    const prive = appliquerResumes(
      vide,
      [{ id: 'a', title: 'T', hasStreamingTurn: true, prive: true }],
      T0
    )
    const auTravail = appliquerEvenement(
      prive,
      { kind: 'command', conversationId: 'a', actionId: 'x', name: 'Read' },
      T0 + 1_000
    )
    expect(auTravail.get('a')?.prive).toBe(true)
    const demarque = appliquerResumes(
      auTravail,
      [{ id: 'a', title: 'T', hasStreamingTurn: true }],
      T0 + 2_000
    )
    expect(demarque.get('a')).not.toHaveProperty('prive')
  })

  it('un tanuki né d’un événement, avant tout résumé, n’a aucun titre à divulguer', () => {
    const a = appliquerEvenement(vide, { kind: 'delta', conversationId: 'a' }, T0).get('a')
    expect(a?.titre).toBe('')
  })
})

describe('du résumé à presence.json : le fil privé part sans titre', () => {
  it('privé : tanuki présent, sans titre ; public : titre gardé', () => {
    const carte = appliquerResumes(
      vide,
      [
        { id: 'conv-1', title: 'Contrat confidentiel', hasStreamingTurn: true, prive: true },
        { id: 'conv-2', title: 'Corrige le bouton', hasStreamingTurn: true }
      ],
      T0
    )
    const instantane = agentsEnScene(carte).map(agentAPublier)
    const presence = presenceAEcrire(instantane, REGLAGE, 'poste-a')
    const parId = new Map(presence.agents.map((a) => [a.id, a]))
    expect(parId.get('conv-1')).toBeDefined()
    expect(parId.get('conv-1')).not.toHaveProperty('titre')
    expect(parId.get('conv-2')?.titre).toBe('Corrige le bouton')
    expect(JSON.stringify(presence)).not.toContain('Contrat confidentiel')
  })
})

describe('le registre vivant envoie la marque au processus principal', () => {
  let envoyer: ReturnType<typeof vi.fn<(agents: AgentAPublier[]) => Promise<void>>>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(T0))
    envoyer = vi.fn(async () => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as unknown as { api?: unknown }).api
  })

  it('l’instantané porte `prive: true`, et presence.json n’a pas le titre', async () => {
    ;(window as unknown as { api: unknown }).api = {
      conversations: vi.fn(async () => [
        { id: 'conv-1', title: 'Contrat confidentiel', hasStreamingTurn: true, prive: true }
      ]),
      onPilotEvent: () => () => undefined,
      quartierPresence: envoyer
    }
    vi.resetModules()
    const m = await import('./agents-quartier')
    m.demarrerAgentsQuartier()
    await vi.advanceTimersByTimeAsync(m.ENVOI_PRESENCE_MS + 10)

    expect(envoyer).toHaveBeenCalledTimes(1)
    const [envoye] = envoyer.mock.calls[0]
    expect(envoye).toEqual([expect.objectContaining({ id: 'conv-1', prive: true })])
    const presence = presenceAEcrire(envoye, REGLAGE, 'poste-a')
    expect(presence.agents).toHaveLength(1)
    expect(presence.agents[0]).not.toHaveProperty('titre')
  })
})
