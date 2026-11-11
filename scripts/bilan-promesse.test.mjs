import { describe, expect, it } from 'vitest'
import { bilan, familleDuRefus } from './bilan-promesse.mjs'

const ligne = (conversationId, rang, role, etat, constat = '') => ({
  conversationId,
  messageId: `m-${conversationId}-${rang}`,
  demandeLe: rang,
  role,
  etat,
  constat
})

describe('bilan-promesse', () => {
  it('une copie de fil n’est pas une demande de plus', () => {
    const b = bilan({
      lignes: [
        ligne('conv-1', 1, 'besoin', 'prouve'),
        ligne('conv-2', 2, 'copie', 'sans-preuve', 'fini sans vérification')
      ],
      besoins: [],
      traces: []
    })
    expect(b.demandes).toBe(1)
    expect(b.copiesEcartees).toBe(1)
    expect(b.besoins).toBe(1)
    expect(b.sansPreuve).toEqual({})
  })

  it('un besoin se juge sur sa dernière relance, et garde la trace d’un vert perdu', () => {
    const b = bilan({
      lignes: [
        ligne('conv-1', 1, 'besoin', 'prouve'),
        ligne('conv-1', 2, 'suite', 'refuse', 'npx vitest run a.test.ts → exit 1'),
        ligne('conv-3', 3, 'besoin', 'refuse', 'tour arrêté avant la fin'),
        ligne('conv-3', 4, 'suite', 'prouve')
      ],
      besoins: [],
      traces: []
    })
    expect(b.besoins).toBe(2)
    expect(b.prouvesAuPremierMessage).toBe(1)
    expect(b.prouvesALaFin).toBe(1)
    expect(b.prouvesPuisPerdus).toBe(1)
    expect(b.etats).toEqual({ prouve: 2, refuse: 2 })
  })

  it('« fini sans vérification » distingue rien écrit, code écrit et autres fichiers', () => {
    const fini = 'fini sans vérification'
    const lignes = [1, 2, 3, 4].map((n) => ligne(`conv-${n}`, n, 'besoin', 'sans-preuve', fini))
    const besoins = [1, 2, 3].map((n) => ({
      conversationId: `conv-${n}`,
      messageId: `m-conv-${n}-${n}`,
      turnId: `T${n}`
    }))
    const b = bilan({
      lignes,
      besoins,
      traces: [
        { turnId: 'T1', paths: ['.autowin-tmp/conv-1/sonde.mjs'] },
        { turnId: 'T2', paths: ['src/main/x.ts'] },
        { turnId: 'T3', paths: ['docs/note.md'] }
      ]
    })
    expect(b.sansPreuve).toEqual({
      'aucun fichier écrit — rien à prouver': 1,
      'code écrit sans test': 1,
      'fichiers écrits, pas de code': 1,
      'tour inconnu': 1
    })
  })

  it('la dernière ligne d’un message remplace les précédentes', () => {
    const b = bilan({
      lignes: [ligne('conv-1', 1, 'besoin', 'refuse', 'x'), ligne('conv-1', 1, 'besoin', 'prouve')],
      besoins: [],
      traces: []
    })
    expect(b.etats).toEqual({ prouve: 1 })
  })

  it('range un refus par ce qui l’a causé', () => {
    expect(familleDuRefus('npx vitest run src/main/a.test.ts → exit 1')).toBe(
      'test rouge — test du dépôt'
    )
    expect(familleDuRefus('npx vitest run src/main/separation-entreprise.test.ts → exit 1')).toBe(
      'test rouge — garde de tout le dossier'
    )
    expect(
      familleDuRefus('cd .autowin-tmp/conv-1600/wt && npx vitest run src/main/a.test.ts → exit 1')
    ).toBe('test rouge — dossier à part')
    expect(
      familleDuRefus(
        'cd "D:/AutoWinOS/.autowin-data/autowin-os/copies-de-taches/conv-1773" && npx vitest run a.test.ts → exit 1'
      )
    ).toBe('test rouge — copie de travail du fil')
    expect(familleDuRefus('arrêté au contrôle final — Promis mais pas fait : « … »')).toBe(
      'contrôle final'
    )
    expect(familleDuRefus('tour arrêté avant la fin')).toBe('tour arrêté avant la fin')
    expect(
      familleDuRefus("tour en échec : Claude a interrompu l'appel : You've hit your limit")
    ).toBe('limite d’usage')
  })
})
