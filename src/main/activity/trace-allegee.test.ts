import { describe, expect, it } from 'vitest'
import { extractHumanMessage } from '../../renderer/src/components/human-message'
import {
  allegerTracePourGraphe,
  chargesDesEvenements,
  extraitDemandeUtilisateur
} from './trace-allegee'
import type { TraceEventV1 } from './trace-event'

function evenement(
  id: string,
  type: TraceEventV1['type'],
  payloads: TraceEventV1['payloads']
): TraceEventV1 {
  return {
    schema: 'autowin.trace/v1',
    id,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    timestamp: '2026-10-10T12:00:00.000Z',
    sequence: 1,
    type,
    status: 'completed',
    actor: { id: 'pilot', kind: 'agent', label: 'Pilote' },
    channel: 'internal',
    payloads,
    observation: { boundary: 'chat', fidelity: 'exact' }
  }
}

const PROMPT_COMPOSE = [
  "ÉTAT DE L'APP:",
  JSON.stringify({ tab: 'chat', secret: 'x'.repeat(50_000) }),
  '',
  'UTILISATEUR: <message_utilisateur>répare le graphe du chat</message_utilisateur>',
  '',
  'CONSIGNES: '.padEnd(20_000, 'c')
].join('\n')

describe('allegerTracePourGraphe', () => {
  it('vide tous les contenus mais garde genre, nom et type de chaque charge', () => {
    const [allege] = allegerTracePourGraphe([
      evenement('e-1', 'model-response', [
        {
          kind: 'model-response',
          content: 'réponse longue',
          name: 'final',
          mediaType: 'text/plain'
        }
      ])
    ])

    expect(allege.payloads).toEqual([
      { kind: 'model-response', name: 'final', mediaType: 'text/plain', content: '' }
    ])
  })

  it('un message ne garde QUE la demande humaine, et le libellé du tour ne change pas', () => {
    const [allege] = allegerTracePourGraphe([
      evenement('m-1', 'message', [{ kind: 'user-message', content: PROMPT_COMPOSE }])
    ])
    const contenu = allege.payloads[0].content

    expect(contenu.length).toBeLessThan(200)
    expect(contenu).not.toContain('secret')
    expect(extractHumanMessage(contenu, 80)).toBe(extractHumanMessage(PROMPT_COMPOSE, 80))
    expect(extractHumanMessage(contenu, 80)).toBe('répare le graphe du chat')
  })

  it('une étape EN ÉCHEC garde un extrait borné de sa cause ; un outil en échec, rien', () => {
    const cause = 'checkpoint orchestration causalement invalide : liens de reservation incoherents'
    const [relais, longue, outil] = allegerTracePourGraphe([
      {
        ...evenement('h-1', 'handoff', [
          { kind: 'model-response', content: cause },
          { kind: 'app-state', content: 'état privé' }
        ]),
        status: 'failed'
      },
      {
        ...evenement('h-2', 'handoff', [{ kind: 'error', content: 'e'.repeat(50_000) }]),
        status: 'failed'
      },
      {
        ...evenement('t-1', 'tool-call', [{ kind: 'error', content: 'sortie d’outil privée' }]),
        status: 'failed'
      }
    ])

    expect(relais.payloads.map((charge) => charge.content)).toEqual([cause, ''])
    expect(longue.payloads[0].content.length).toBe(300)
    expect(outil.payloads[0].content).toBe('')
  })

  it('ne modifie pas la trace lue (événements gelés par le TraceStore)', () => {
    const source = Object.freeze(
      evenement('m-1', 'message', [
        Object.freeze({ kind: 'user-message', content: PROMPT_COMPOSE })
      ])
    )

    expect(() => allegerTracePourGraphe([source])).not.toThrow()
    expect(source.payloads[0].content).toBe(PROMPT_COMPOSE)
  })
})

describe('extraitDemandeUtilisateur', () => {
  it('rend le DERNIER segment UTILISATEUR, borné', () => {
    const contenu = `UTILISATEUR: ancienne\n\nTOI: réponse\n\nUTILISATEUR: ${'n'.repeat(5000)}`
    const extrait = extraitDemandeUtilisateur(contenu)

    expect(extrait.startsWith('UTILISATEUR: nnn')).toBe(true)
    expect(extrait.length).toBe(2000)
  })

  it('rend vide un contenu sans demande humaine (prompt de sous-agent)', () => {
    expect(extraitDemandeUtilisateur('Tu es le juge. Évalue ce livrable.')).toBe('')
  })

  // Mesuré le 2026-10-10 sur 487 tours réels : 10 portaient `UTILISATEUR:` au MILIEU d'un bloc
  // injecté. Le contenu entier faisait alors afficher ce bloc (« CE QUE TU AS RETENU… ») comme
  // libellé du tour ; l'extrait vide fait retomber sur la date, le repli prévu par `turnOption`.
  it('un marqueur enfoui dans un bloc injecté ne fait pas fuiter ce bloc', () => {
    const contenu = 'CE QUE TU AS RETENU DANS CETTE CONVERSATION\n- fait 1\nUTILISATEUR: ok'

    expect(extraitDemandeUtilisateur(contenu)).toBe('')
  })
})

describe('chargesDesEvenements', () => {
  const trace = [
    evenement('a', 'message', [
      { kind: 'user-message', content: 'prompt A' },
      { kind: 'tool-result', content: 'contenu d’outil' }
    ]),
    evenement('b', 'model-response', [{ kind: 'model-response', content: 'retour B' }]),
    evenement('c', 'model-response', [{ kind: 'model-response', content: 'retour C' }])
  ]

  it('rend les charges ENTIÈRES des seuls événements nommés, aux seuls genres demandés', () => {
    expect(chargesDesEvenements(trace, ['a', 'b'], ['user-message', 'model-response'])).toEqual({
      a: [{ kind: 'user-message', content: 'prompt A' }],
      b: [{ kind: 'model-response', content: 'retour B' }]
    })
  })

  it('refuse une demande mal formée au lieu de tout renvoyer', () => {
    expect(() => chargesDesEvenements(trace, 'a', ['model-response'])).toThrow(/eventIds/)
    expect(() => chargesDesEvenements(trace, ['a'], [42])).toThrow(/kinds/)
    expect(() =>
      chargesDesEvenements(
        trace,
        Array.from({ length: 501 }, (_, i) => `e-${i}`),
        ['x']
      )
    ).toThrow(/500/)
  })

  // fix-ok: tests ajoutés (cas limites 5 et 6), pas un correctif ; mesuré : sans `element.trim() === ''` dans listeDeChaines, ce test échoue (code 1), restauré il passe
  it('refuse un identifiant vide dans la liste, au lieu de l’ignorer en silence', () => {
    expect(() => chargesDesEvenements(trace, ['a', ''], ['model-response'])).toThrow(
      /eventIds contient une entrée invalide/
    )
    expect(() => chargesDesEvenements(trace, ['a', '   '], ['model-response'])).toThrow(
      /eventIds contient une entrée invalide/
    )
  })

  it('une liste vide ne demande rien et ne rend rien', () => {
    expect(chargesDesEvenements(trace, [], ['model-response'])).toEqual({})
  })
})
