import { describe, expect, it } from 'vitest'
import type { Message } from '../providers/types'
import { messageDuTour } from './message-du-tour'

/**
 * « GO », « OK », « VAS-Y » : LA CIBLE EST JOINTE PAR LE CODE (revue règle par règle, 2026-11-06).
 *
 * Avant, seule une règle du bloc style disait au modèle qu'un « go » est l'ordre d'exécuter la
 * rubrique « 👉 Recommandé » de sa dernière clôture, ou la demande d'un tour interrompu ; ses ~1 100
 * caractères partaient à chaque message pour un cas rare. Le message d'ouverture du tour joint
 * maintenant cette cible lui-même, lue dans l'historique, et seulement sur une relance sans objet.
 */
const ouverture = (history: Message[]): string =>
  messageDuTour({
    history,
    conversationId: undefined,
    workspaceDuTour: '',
    resumeSessionId: undefined,
    snapshot: {},
    retrievedContext: '',
    tourCoupePourCeMessage: undefined,
    lectureRetenue: undefined,
    bus: {} as never,
    growDejaEnvoye: new Set(),
    rappelDejaEnvoye: new Map(),
    dernierEtatPousse: new Map(),
    consommerCompteRendu: () => undefined
  }).blocsDuTour.find((bloc) => bloc.name === 'relanceSansCible')?.text ?? ''

const CLOTURE =
  'J’ai corrigé le tri.\n\n✅ Fait\n1. Tri corrigé — test vert.\n📍 Maintenant\nLe rail trie par date.\n' +
  '⏳ Reste à faire\nAucune limite connue.\n👉 Recommandé : Relancer le test de ChatComposer sur le thème clair.\n' +
  'AUTOWIN_PROMPT_V1: [85] Relance le test de ChatComposer sur le thème clair.'

describe('relance sans cible : le message du tour joint la suite désignée', () => {
  it('« go » après une clôture : la rubrique « 👉 Recommandé » est jointe telle quelle', () => {
    const texte = ouverture([
      { role: 'user', content: 'corrige le tri du rail' },
      { role: 'assistant', content: CLOTURE },
      { role: 'user', content: 'go' }
    ])
    expect(texte).toContain('RELANCE SANS CIBLE')
    expect(texte).toContain('Relancer le test de ChatComposer sur le thème clair.')
    expect(texte).not.toContain('AUTOWIN_PROMPT_V1: [85] Relance le test de ChatComposer')
  })

  it('« vas-y » après un tour resté sans réponse : la demande abandonnée est jointe', () => {
    const texte = ouverture([
      { role: 'user', content: 'ajoute un tri par date dans le rail de l’Observatoire' },
      { role: 'user', content: 'vas-y' }
    ])
    expect(texte).toContain('RELANCE SANS CIBLE')
    expect(texte).toContain('ajoute un tri par date dans le rail de l’Observatoire')
  })

  it('jumeau accepté : un message qui nomme son objet ne reçoit rien', () => {
    const texte = ouverture([
      { role: 'assistant', content: CLOTURE },
      { role: 'user', content: 'reprends le découpage de index.ts' }
    ])
    expect(texte).not.toContain('RELANCE SANS CIBLE')
  })

  it('jumeau accepté : « ok » sans suite désignée ne fabrique aucune cible', () => {
    const texte = ouverture([
      { role: 'assistant', content: 'Bonjour, que veux-tu faire ?' },
      { role: 'user', content: 'ok' }
    ])
    expect(texte).not.toContain('RELANCE SANS CIBLE')
  })
})
