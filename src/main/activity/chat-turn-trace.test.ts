import { describe, expect, it } from 'vitest'
import {
  FRONTIERE_DEMANDE_RECUE,
  FRONTIERE_GESTE_AGENT,
  evenementDemandeRecue,
  evenementGesteAgent,
  gesteDeLaLigne
} from './chat-turn-trace'
import { allegerTracePourGraphe } from './trace-allegee'
import { demandeHumaineEntiere } from '../../shared/balise-message-utilisateur'

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
      {
        kind: 'user-message',
        content: 'UTILISATEUR: <message_utilisateur>refais le graphe</message_utilisateur>'
      }
    ])
  })

  // Le détail de la brique Demande la montre EN ENTIER (2026-10-12) : la demande reçue gardait le
  // premier paragraphe, 2000 caractères au plus — tout ce que l'arbre pouvait montrer d'un tour en cours.
  it('garde les mots de l’utilisateur EN ENTIER, paragraphes compris, jamais l’état de l’app', () => {
    const long = 'a'.repeat(5000)
    const multi = evenementDemandeRecue({
      conversationId: 'conv-1',
      turnId: 'tour-2',
      sequence: 1,
      at: AT,
      contenu: `premier paragraphe\n\n${long}\n\ndernier paragraphe`
    })
    expect(demandeHumaineEntiere(multi.payloads[0].content)).toBe(
      `premier paragraphe\n\n${long}\n\ndernier paragraphe`
    )

    const compose = evenementDemandeRecue({
      conversationId: 'conv-1',
      turnId: 'tour-2b',
      sequence: 1,
      at: AT,
      contenu: `ÉTAT DE L'APP:\n{"secret":"x"}\n\nUTILISATEUR: <message_utilisateur>un\n\ndeux</message_utilisateur>`
    })
    expect(compose.payloads[0].content).not.toContain('secret')
    expect(demandeHumaineEntiere(compose.payloads[0].content)).toBe('un\n\ndeux')
  })

  it('reste borné et lisible dans la trace allégée que reçoit le graphe', () => {
    const [court, long] = allegerTracePourGraphe([
      evenementDemandeRecue({
        conversationId: 'conv-1',
        turnId: 'tour-3',
        sequence: 1,
        at: AT,
        contenu: 'trie mes mails'
      }),
      evenementDemandeRecue({
        conversationId: 'conv-1',
        turnId: 'tour-4',
        sequence: 2,
        at: AT,
        contenu: 'b'.repeat(5000)
      })
    ])
    expect(demandeHumaineEntiere(court.payloads[0].content)).toBe('trie mes mails')
    expect(long.payloads[0].content.startsWith('UTILISATEUR: ')).toBe(true)
    expect(long.payloads[0].content.length).toBeLessThanOrEqual(2000)
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
