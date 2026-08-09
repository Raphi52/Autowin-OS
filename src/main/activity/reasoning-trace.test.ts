import { describe, expect, it } from 'vitest'
import { reasoningToTraceEvent, MAX_REASONING } from './reasoning-trace'

/**
 * MANQUE CONSTATE LE 2026-08-07 : le raisonnement du modele est emis
 * (`agent-pilot.ts:543`, `emit({ kind: 'reasoning', … })`) et affiche dans le fil de chat, mais
 * `src/main/index.ts` ne traitait PAS cet evenement (seul `reasoningEffort`, le reglage, y figure) et
 * `pilot-events.ts:19` le documente comme « affiche, jamais persiste ». Observatory ne pouvait donc
 * jamais montrer POURQUOI le modele a fait ce qu'il a fait.
 *
 * Le raisonnement est emis PAR FRAGMENT. Un evenement causal par fragment inonderait la trace — un
 * seul tour en produirait des centaines et rendrait la chronologie illisible. Il est donc ACCUMULE
 * sur le tour et ecrit une seule fois, sur le meme patron que `streamedSpoken`.
 */

const base = {
  id: 'conv1:turn1:reasoning',
  conversationId: 'conv1',
  turnId: 'turn1',
  timestamp: '2026-08-07T10:00:00.000Z',
  sequence: 3
}

describe('reasoningToTraceEvent', () => {
  it('produit un evenement valide portant une charge `reasoning`', () => {
    const event = reasoningToTraceEvent({ ...base, text: 'j’ai pesé A contre B' })
    expect(event.payloads[0].kind).toBe('reasoning')
    expect(event.payloads[0].content).toBe('j’ai pesé A contre B')
  })

  it('attribue le raisonnement a l’AGENT, sur le canal assistant', () => {
    const event = reasoningToTraceEvent({ ...base, text: 'réflexion' })
    expect(event.actor.kind).toBe('agent')
    expect(event.channel).toBe('assistant')
  })

  it('n’est PAS de type model-response — une deliberation n’est pas une reponse remise', () => {
    const event = reasoningToTraceEvent({ ...base, text: 'réflexion' })
    expect(event.type).not.toBe('model-response')
  })

  it('borne un raisonnement enorme, le DIT, et degrade la fidelite declaree', () => {
    const event = reasoningToTraceEvent({ ...base, text: 'y'.repeat(MAX_REASONING + 5_000) })
    expect(event.payloads[0].content.length).toBeLessThan(MAX_REASONING + 5_000)
    expect(event.payloads[0].content).toMatch(/tronqu/i)
    expect(event.observation.fidelity).toBe('derived')
    expect(event.observation.limitation).toBeTruthy()
  })

  it('declare `exact` quand le raisonnement passe entier', () => {
    const event = reasoningToTraceEvent({ ...base, text: 'court' })
    expect(event.observation.fidelity).toBe('exact')
  })

  it('chaine au parent causal', () => {
    const event = reasoningToTraceEvent({ ...base, parentId: 'conv1:turn1:msg', text: 'x' })
    expect(event.parentId).toBe('conv1:turn1:msg')
  })
})
