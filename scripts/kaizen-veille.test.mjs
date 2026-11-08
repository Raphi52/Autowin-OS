import { describe, it, expect } from 'vitest'
import {
  estRecadrage,
  jourParis,
  normaliserCause,
  refusDeLaFiche,
  releverLaJournee,
  releverLaPeriode
} from './kaizen-veille.mjs'

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

  it('lit la raison d’un refus dans la fiche, sans son coût', () => {
    expect(
      normaliserCause('arrêté au contrôle final — intégration locale non terminée · 6,89 $')
    ).toBe('arrêté au contrôle final — intégration locale non terminée')
    const fiche = [
      'Résultat (2026-11-06 21:10 UTC) : prouvé — une question t’attend',
      'Résultat (2026-11-06 22:30 UTC) : refusé — tour arrêté avant la fin',
      'Résultat (2026-11-07 08:00 UTC) : refusé — arrêté au contrôle final — x · 7,31 $'
    ].join('\n')
    expect(refusDeLaFiche(fiche)).toEqual([
      { jour: '2026-11-06', cause: 'tour arrêté avant la fin' },
      { jour: '2026-11-07', cause: 'arrêté au contrôle final — x' }
    ])
  })

  it('compte une cause qui revient dans plusieurs fils avant une cause répétée dans un seul', () => {
    const refus = (messageId, conversationId, fiche) => ({
      ts: 1,
      demandeLe: T('2026-11-06T10:00:00Z'),
      messageId,
      conversationId,
      etat: 'refuse',
      fiche
    })
    const fiches = {
      'a/RUN.md':
        'Résultat (2026-11-06 10:00 UTC) : refusé — intégration locale non terminée · 1 $',
      'b/RUN.md':
        'Résultat (2026-11-07 10:00 UTC) : refusé — intégration locale non terminée · 2 $',
      'c/RUN.md': [
        'Résultat (2026-11-06 10:00 UTC) : refusé — échec déjà déclaré',
        'Résultat (2026-11-06 11:00 UTC) : refusé — échec déjà déclaré',
        'Résultat (2026-11-06 12:00 UTC) : refusé — échec déjà déclaré'
      ].join('\n')
    }
    const r = releverLaPeriode(
      { du: '2026-11-06', au: '2026-11-07' },
      {
        saisies: [],
        demandes: [
          refus('m1', 'conv-1', 'a/RUN.md'),
          refus('m2', 'conv-2', 'b/RUN.md'),
          refus('m3', 'conv-3', 'c/RUN.md')
        ],
        verdicts: [],
        couts: [],
        gels: []
      },
      (f) => fiches[f]
    )
    expect(r.causes).toEqual([
      { cause: 'intégration locale non terminée', fois: 2, fils: ['conv-1', 'conv-2'] },
      { cause: 'échec déjà déclaré', fois: 3, fils: ['conv-3'] }
    ])
    // Sur le seul 06/11, le refus du 07 sort de la période.
    const seul = releverLaJournee(
      '2026-11-06',
      {
        saisies: [],
        demandes: [refus('m2', 'conv-2', 'b/RUN.md')],
        verdicts: [],
        couts: [],
        gels: []
      },
      (f) => fiches[f]
    )
    expect(seul.causes).toEqual([
      { cause: 'raison non écrite dans la fiche', fois: 1, fils: ['conv-2'] }
    ])
  })
})
