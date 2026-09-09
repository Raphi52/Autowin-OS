import { describe, expect, it } from 'vitest'

import { ConversationStore } from './conversations'
import {
  classifierRefusDeReprise,
  refusDeRepriseEstTransitoire,
  refusDeRepriseRaconteDuTravail
} from '../runs/resume-refusal'

/**
 * DEMANDE (conv-336, 2026-09-07) : « un refus de reprise transitoire ne doit plus bouger la date de
 * derniere touche d'une conversation ni la faire remonter en tete de liste ».
 *
 * VECU, et c'est la mesure : au demarrage de 09:48, `conversations.json.journal.jsonl` porte 22
 * evenements (`resumed` puis `failed`) ecrits en UNE seconde dans 11 conversations vieilles de
 * plusieurs jours -- conv-83, 226, 246, 266, 268, 288, 300, 305, 308, 321, 323. L'erreur etait a
 * chaque fois « Reprise refusee : 1 appel(s) provider encore actif(s). Refus transitoire, aucun
 * fichier touche ». Consequence a l'ecran : ces 11 fils sont remontes en tete de la liste et sont
 * repasses en pastille jaune « termine, non lu », alors que rien n'avait ete produit.
 *
 * ENTREES QUI DOIVENT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE :
 *  - `applyTurnEvent` qui remet `updatedAt` a `now()` sur `resumed` ou sur un `failed` transitoire
 *    (le defaut exact) ;
 *  - un `failed` ORDINAIRE qui ne bougerait plus la date (on aurait alors cache un vrai echec) ;
 *  - un classificateur qui ne reconnait pas le message reel du refus, ou qui classerait un refus
 *    DEFINITIF comme transitoire (le checkpoint serait rejoue sans fin).
 */

const REFUS_REEL =
  'Reprise refusee : 1 appel(s) provider encore actif(s). ' +
  'Refus transitoire : l’appel en cours se regle seul. Cette TENTATIVE-CI n’a rien ecrit.'

function clock(start = 1000): () => number {
  let t = start
  return () => t++
}

/** Un fil avec un tour DEJA termine, comme les 11 conversations du 07/09. */
function filTermine(store: ConversationStore, titre: string): { id: string; turnId: string } {
  const id = store.create({ title: titre, provider: 'claude' }).id
  const turnId = `tour-${titre}`
  store.beginTurn(id, { content: 'ma demande' }, { turnId })
  store.applyTurnEvent(id, turnId, { kind: 'delta', streamId: `${turnId}:1`, text: 'ma reponse' })
  store.applyTurnEvent(id, turnId, { kind: 'done' })
  return { id, turnId }
}

describe('un refus de reprise transitoire ne repeint pas la liste', () => {
  it('le message reel du refus est classe TRANSITOIRE', () => {
    expect(classifierRefusDeReprise(REFUS_REEL)).toBe('appel-provider-actif')
    expect(refusDeRepriseEstTransitoire(classifierRefusDeReprise(REFUS_REEL))).toBe(true)
  })

  it('les refus DEFINITIFS restent definitifs — ils ne deviennent pas transitoires', () => {
    const definitifs = [
      'Reprise du worktree refusée : publication complete déjà engagée',
      'La copie durable à reprendre n’existe plus',
      'Le SHA de départ durable est invalide.'
    ]
    for (const message of definitifs) {
      const refus = classifierRefusDeReprise(message)
      expect(refus).toBeDefined()
      expect(refusDeRepriseEstTransitoire(refus)).toBe(false)
    }
  })

  /**
   * MESURE DU JOURNAL DE 10:20 (le demarrage SUIVANT, releve dans conv-336) : sur les 13 refus de
   * reprise ecrits en 12 secondes, UN SEUL etait « appel(s) provider encore actif » ; les 12 autres
   * portaient « copie durable absente ou incomplete » — classes DEFINITIFS, donc encore comptes
   * comme du travail et repeignant la liste. Un refus, definitif ou non, n'execute rien.
   */
  it('un refus DEFINITIF ne raconte pas de travail non plus — il ne repeint pas la liste', () => {
    const refusDuJournalDe1020 =
      'Reprise du worktree impossible pour run-4bf63ce8f076-1 : copie durable absente ou incomplète'
    const refus = classifierRefusDeReprise(refusDuJournalDe1020)
    expect(refus).toBe('copie-durable-absente')
    expect(refusDeRepriseEstTransitoire(refus)).toBe(false)
    expect(refusDeRepriseRaconteDuTravail(refus)).toBe(false)

    const store = new ConversationStore(clock())
    const { id, turnId } = filTermine(store, 'ancienne-copie-absente')
    const avant = store.get(id)!.updatedAt
    store.applyTurnEvent(id, turnId, { kind: 'resumed' })
    store.applyTurnEvent(id, turnId, {
      kind: 'failed',
      error: refusDuJournalDe1020,
      transient: true
    })
    expect(store.get(id)!.updatedAt).toBe(avant)
  })

  it('un echec ORDINAIRE raconte du travail — sa date doit bouger', () => {
    expect(refusDeRepriseRaconteDuTravail(classifierRefusDeReprise('Erreur reseau'))).toBe(true)
  })

  it('`resumed` puis `failed` transitoire laissent la date de derniere touche INTACTE', () => {
    const store = new ConversationStore(clock())
    const { id, turnId } = filTermine(store, 'ancienne')
    const avant = store.get(id)!.updatedAt

    store.applyTurnEvent(id, turnId, { kind: 'resumed' })
    expect(store.get(id)!.updatedAt).toBe(avant)

    store.applyTurnEvent(id, turnId, {
      kind: 'failed',
      error: REFUS_REEL,
      transient: true
    })
    expect(store.get(id)!.updatedAt).toBe(avant)
  })

  it('la conversation refusee ne remonte PAS en tete de la liste', () => {
    const store = new ConversationStore(clock())
    const ancienne = filTermine(store, 'ancienne')
    const recente = filTermine(store, 'recente')

    // Avant le refus, la plus recente est en tete — c'est l'ordre que l'utilisateur connait.
    expect(store.list()[0].id).toBe(recente.id)

    store.applyTurnEvent(ancienne.id, ancienne.turnId, { kind: 'resumed' })
    store.applyTurnEvent(ancienne.id, ancienne.turnId, {
      kind: 'failed',
      error: REFUS_REEL,
      transient: true
    })

    expect(store.list()[0].id).toBe(recente.id)
  })

  it('un echec ORDINAIRE bouge toujours la date : on ne cache pas un vrai echec', () => {
    const store = new ConversationStore(clock())
    const { id, turnId } = filTermine(store, 'ancienne')
    const avant = store.get(id)!.updatedAt

    store.applyTurnEvent(id, turnId, { kind: 'failed', error: 'le provider a rendu une erreur' })

    expect(store.get(id)!.updatedAt).toBeGreaterThan(avant)
  })

  it('le refus ecrit quand meme sa trace dans le tour — seule la DATE ne bouge pas', () => {
    const store = new ConversationStore(clock())
    const { id, turnId } = filTermine(store, 'ancienne')

    store.applyTurnEvent(id, turnId, {
      kind: 'failed',
      error: REFUS_REEL,
      transient: true
    })

    const tour = store.get(id)!.messages.find((message) => message.turnId === turnId)!
    expect(tour.status).toBe('failed')
    expect(tour.error).toContain('appel(s) provider encore actif')
  })
})
