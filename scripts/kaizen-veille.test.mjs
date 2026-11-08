import { describe, it, expect } from 'vitest'
import { estRecadrage, jourParis, releverLaJournee } from './kaizen-veille.mjs'

const T = (iso) => Date.parse(iso)

describe('relevé des ratés de la veille', () => {
  it('reconnaît un recadrage, pas une demande ordinaire', () => {
    for (const t of [
      'ça marche toujours pas',
      'pk ca met 0 caractere transmis?',
      'non, pas ça',
      "j'ai dit le bouton du haut"
    ])
      expect(estRecadrage(t)).toBe(true)
    for (const t of ['ajoute un tri par date dans le rail', 'go', 'pousse sur main'])
      expect(estRecadrage(t)).toBe(false)
  })

  it('range les instants par jour de Paris, minuit compris', () => {
    expect(jourParis('2026-11-07T22:30:00Z')).toBe('2026-11-07')
    expect(jourParis('2026-11-07T23:30:00Z')).toBe('2026-11-08')
  })

  it('classe les fils par gravité et ne garde que le dernier état d’une demande', () => {
    const r = releverLaJournee('2026-11-07', {
      saisies: [
        { ts: T('2026-11-07T09:00:00Z'), conversationId: 'conv-1', texte: 'ajoute le bouton' },
        { ts: T('2026-11-07T09:10:00Z'), conversationId: 'conv-1', texte: 'ça marche pas' },
        { ts: T('2026-11-07T10:00:00Z'), conversationId: 'conv-2', texte: 'fais le rapport' },
        { ts: T('2026-11-06T10:00:00Z'), conversationId: 'conv-3', texte: 'toujours pas' }
      ],
      demandes: [
        {
          ts: 1,
          demandeLe: T('2026-11-07T10:00:00Z'),
          messageId: 'm2',
          conversationId: 'conv-2',
          etat: 'refuse',
          constat: 'arrêté'
        },
        {
          ts: 2,
          demandeLe: T('2026-11-07T10:00:00Z'),
          messageId: 'm2',
          conversationId: 'conv-2',
          etat: 'prouve'
        },
        {
          ts: 1,
          demandeLe: T('2026-11-07T09:00:00Z'),
          messageId: 'm1',
          conversationId: 'conv-1',
          etat: 'refuse',
          constat: 'contrôle final'
        }
      ],
      verdicts: [{ ts: '2026-11-07T11:00:00Z', conversationId: 'conv-2', verdict: 'red' }],
      couts: [],
      gels: [
        { ts: '2026-11-07T12:00:00Z', blocageMs: 2500 },
        { ts: '2026-11-07T12:01:00Z', blocageMs: 900 }
      ]
    })
    expect(r.fils.map((f) => [f.conversationId, f.score])).toEqual([
      ['conv-1', 6],
      ['conv-2', 2]
    ])
    expect(r.fils[1].refus).toEqual([])
    expect(r.totaux.gels).toBe(1)
    expect(r.filsActifs).toBe(2)
  })
})
