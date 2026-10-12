import { describe, expect, it } from 'vitest'
import {
  FRONTIERE_DEMANDE_RECUE,
  FRONTIERE_GESTE_AGENT,
  evenementDemandeRecue,
  evenementGesteAgent,
  gesteDeLaLigne
} from './chat-turn-trace'
import { allegerTracePourGraphe } from './trace-allegee'

const AT = Date.parse('2026-10-12T09:05:00.000Z')

describe('evenementDemandeRecue — la demande entre dans la trace dès son envoi', () => {
  it('est un message de l’utilisateur, accompli, daté de l’envoi, sans fournisseur', () => {
    const event = evenementDemandeRecue({
      conversationId: 'conv-1',
      turnId: 'tour-1',
      sequence: 7,
      at: AT,
      contenu: 'refais le graphe'
    })

    expect(event).toMatchObject({
      id: 'tour-1:demande-recue',
      turnId: 'tour-1',
      sequence: 7,
      timestamp: '2026-10-12T09:05:00.000Z',
      type: 'message',
      status: 'completed',
      actor: { id: 'user', kind: 'human' },
      channel: 'user',
      observation: { boundary: FRONTIERE_DEMANDE_RECUE }
    })
    // Sans fournisseur : l'arbre ne le prend pas pour un appel au modèle.
    expect(event.provider).toBeUndefined()
    expect(event.payloads).toEqual([
      { kind: 'user-message', content: 'UTILISATEUR: refais le graphe' }
    ])
  })

  it('ne garde que le segment UTILISATEUR d’un message composé, borné', () => {
    const event = evenementDemandeRecue({
      conversationId: 'conv-1',
      turnId: 'tour-2',
      sequence: 1,
      at: AT,
      contenu: `ÉTAT DE L'APP:\n{"secret":"x"}\n\nUTILISATEUR: ${'a'.repeat(5000)}`
    })
    expect(event.payloads[0].content.startsWith('UTILISATEUR: aaa')).toBe(true)
    expect(event.payloads[0].content).not.toContain('secret')
    expect(event.payloads[0].content.length).toBeLessThanOrEqual(2000)
  })

  it('reste lisible dans la trace allégée que reçoit le graphe', () => {
    const [allegee] = allegerTracePourGraphe([
      evenementDemandeRecue({
        conversationId: 'conv-1',
        turnId: 'tour-3',
        sequence: 1,
        at: AT,
        contenu: 'trie mes mails'
      })
    ])
    expect(allegee.payloads[0].content).toBe('UTILISATEUR: trie mes mails')
  })
})

describe('evenementGesteAgent — un geste fini de l’agent, sans contenu', () => {
  it('lit la ligne d’état, écrit nom, issue et durée, horodaté au début du geste', () => {
    const geste = gesteDeLaLigne('Bash échoué - 12,5 s')
    expect(geste).toEqual({ nom: 'Bash', ok: false, dureeMs: 12500 })

    const event = evenementGesteAgent({
      conversationId: 'conv-1',
      turnId: 'tour-1',
      id: 'tour-1:geste:a',
      sequence: 9,
      finAt: AT,
      geste: geste!
    })

    expect(event).toMatchObject({
      type: 'tool-call',
      status: 'failed',
      timestamp: '2026-10-12T09:04:47.500Z',
      actor: { id: 'orchestrator', kind: 'agent' },
      payloads: [{ kind: 'tool-call', name: 'Bash', content: '' }],
      observation: { boundary: FRONTIERE_GESTE_AGENT, fidelity: 'derived' },
      metrics: { durationMs: 12500 }
    })
    expect(event.parentId).toBeUndefined()
  })

  it('ignore un début de geste et les commandes d’Autowin déjà tracées', () => {
    expect(gesteDeLaLigne('Read · D:\\depot\\x.ts')).toBeUndefined()
    expect(gesteDeLaLigne('mcp__autowin__verify terminé - 5 s')).toBeUndefined()
  })
})
