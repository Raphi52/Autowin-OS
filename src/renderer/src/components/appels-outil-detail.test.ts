import { describe, expect, it } from 'vitest'
import { appelsDeLOutil, chargesAvecLeurEvenement } from './appels-outil-detail'

/** Les identifiants réels du pilote, tels que `traceActionEventId` les écrit. */
const evenement = (rang: number, genre: 'command' | 'result'): string =>
  `tour-1:action:natif-0-${rang}:${genre}`

describe('appelsDeLOutil — appels simultanés (conv-1370, lot 8)', () => {
  it('rend à chaque appel SON résultat, même quand ils se croisent', () => {
    expect(
      appelsDeLOutil([
        { kind: 'tool-call', content: 'a.md', evenementId: evenement(0, 'command') },
        { kind: 'tool-call', content: 'b.md', evenementId: evenement(1, 'command') },
        { kind: 'tool-result', content: 'note de b', evenementId: evenement(1, 'result') },
        { kind: 'tool-result', content: 'note de a', evenementId: evenement(0, 'result') }
      ])
    ).toEqual([
      { envoye: 'a.md', retour: 'note de a' },
      { envoye: 'b.md', retour: 'note de b' }
    ])
  })

  it('une action en échec garde son erreur sur son appel, pas sur le dernier ouvert', () => {
    expect(
      appelsDeLOutil([
        { kind: 'tool-call', content: 'a.md', evenementId: evenement(0, 'command') },
        { kind: 'tool-call', content: 'b.md', evenementId: evenement(1, 'command') },
        { kind: 'error', content: 'note absente', evenementId: evenement(0, 'result') }
      ])
    ).toEqual([{ envoye: 'a.md', retour: 'note absente', erreur: true }, { envoye: 'b.md' }])
  })

  it('un appel encore en cours reste sans retour : on ne lui prête pas celui d’un autre', () => {
    expect(
      appelsDeLOutil([
        { kind: 'tool-call', content: 'a.md', evenementId: evenement(0, 'command') },
        { kind: 'tool-call', content: 'b.md', evenementId: evenement(1, 'command') },
        { kind: 'tool-result', content: 'note de a', evenementId: evenement(0, 'result') }
      ])
    ).toEqual([{ envoye: 'a.md', retour: 'note de a' }, { envoye: 'b.md' }])
  })
})

describe('appelsDeLOutil — anciennes traces, écrites en file', () => {
  const FILE = [
    { kind: 'tool-call', content: 'note A', evenementId: evenement(0, 'command') },
    { kind: 'tool-result', content: 'texte A', evenementId: evenement(0, 'result') },
    { kind: 'tool-call', content: 'note B', evenementId: evenement(1, 'command') },
    { kind: 'error', content: 'introuvable', evenementId: evenement(1, 'result') }
  ]
  const LU = [
    { envoye: 'note A', retour: 'texte A' },
    { envoye: 'note B', retour: 'introuvable', erreur: true }
  ]

  it('avec ou sans leur événement, elles se lisent comme avant', () => {
    expect(appelsDeLOutil(FILE)).toEqual(LU)
    expect(appelsDeLOutil(FILE.map(({ kind, content }) => ({ kind, content })))).toEqual(LU)
  })

  it('un retour sans action commune avec son appel rejoint le dernier appel ouvert', () => {
    // Avant le 2026-08-05, certains identifiants portaient un compteur différent par événement.
    expect(
      appelsDeLOutil([
        { kind: 'tool-call', content: 'note A', evenementId: 'tour-1:action:0-1:command' },
        { kind: 'tool-result', content: 'texte A', evenementId: 'tour-1:action:0-2:result' }
      ])
    ).toEqual([{ envoye: 'note A', retour: 'texte A' }])
  })

  it('le geste propre d’un agent porte appel et retour sur un même événement', () => {
    const geste = 'tour-1:geste:3'
    expect(
      appelsDeLOutil([
        { kind: 'tool-call', content: 'Read a.ts', evenementId: geste },
        { kind: 'tool-result', content: 'contenu', evenementId: geste }
      ])
    ).toEqual([{ envoye: 'Read a.ts', retour: 'contenu' }])
  })
})

describe('chargesAvecLeurEvenement — les charges relues au clic', () => {
  it('garde l’ordre demandé et dit quel événement porte chaque charge', () => {
    expect(
      chargesAvecLeurEvenement(['appel', 'absent', 'retour'], {
        retour: [{ kind: 'tool-result', content: 'r' }],
        appel: [{ kind: 'tool-call', content: 'c' }]
      })
    ).toEqual([
      { kind: 'tool-call', content: 'c', evenementId: 'appel' },
      { kind: 'tool-result', content: 'r', evenementId: 'retour' }
    ])
  })
})

describe('appelsDeLOutil — ce que chaque appel a envoyé et reçu', () => {
  it('rattache chaque retour à l’appel qui le précède, dans l’ordre', () => {
    expect(
      appelsDeLOutil([
        { kind: 'tool-call', content: 'note A' },
        { kind: 'tool-result', content: 'texte A' },
        { kind: 'tool-call', content: 'note B' },
        { kind: 'error', content: 'introuvable' }
      ])
    ).toEqual([
      { envoye: 'note A', retour: 'texte A' },
      { envoye: 'note B', retour: 'introuvable', erreur: true }
    ])
  })

  it('n’invente rien pour un geste écrit sans contenu', () => {
    expect(appelsDeLOutil([{ kind: 'tool-call', content: '' }])).toEqual([])
  })

  it('garde un retour dont l’appel n’a pas de contenu, et ignore les autres genres', () => {
    expect(
      appelsDeLOutil([
        { kind: 'tool-call', content: '' },
        { kind: 'reasoning', content: 'pensée' },
        { kind: 'tool-result', content: 'sortie' }
      ])
    ).toEqual([{ retour: 'sortie' }])
  })
})
