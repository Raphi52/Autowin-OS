/**
 * Les règles de l'alerte par interlocuteur (demande du 2026-09-07 : un switch par personne).
 *
 * Ce que ce fichier protège : on n'alerte que sur du REÇU NON LU d'une personne SURVEILLÉE, et JAMAIS
 * deux fois pour le même message — la régression la plus probable est la popup qui repart à chaque
 * relecture d'Outlook (toutes les deux minutes).
 */
import { describe, expect, it } from 'vitest'
import {
  basculerAlerte,
  ecrireAlertes,
  lireAlertes,
  messagesAAlerter,
  parseAlertes
} from './outlook-alertes'
import type { Interlocuteur, MessageInterlocuteur } from './outlook-model'

function message(part: Partial<MessageInterlocuteur> & { id: string }): MessageInterlocuteur {
  return {
    sujet: 'Devis',
    corps: 'texte',
    recuLe: 0,
    nonLu: true,
    deMoi: false,
    auteur: 'Zoé',
    fil: 'f1',
    ...part
  } as MessageInterlocuteur
}

function contact(cle: string, messages: MessageInterlocuteur[]): Interlocuteur {
  return {
    cle,
    nom: cle,
    adresse: `${cle}@ex.fr`,
    nonLus: messages.filter((m) => m.nonLu).length,
    messages
  } as Interlocuteur
}

describe('alertes par interlocuteur', () => {
  it('n’alerte que sur un reçu non lu d’une personne surveillée', () => {
    const fils = [
      contact('zoe', [
        message({ id: 'a' }),
        message({ id: 'b', nonLu: false }),
        message({ id: 'c', deMoi: true })
      ]),
      contact('bob', [message({ id: 'd' })])
    ]
    const trouves = messagesAAlerter(fils, new Set(['zoe']), new Set())
    expect(trouves.map((m) => m.id)).toEqual(['a'])
  })

  it('n’alerte pas deux fois pour le même message', () => {
    const fils = [contact('zoe', [message({ id: 'a' })])]
    expect(messagesAAlerter(fils, new Set(['zoe']), new Set(['a']))).toEqual([])
  })

  it('bascule et persiste le réglage', () => {
    const memoire = new Map<string, string>()
    const storage = {
      getItem: (k: string) => memoire.get(k) ?? null,
      setItem: (k: string, v: string) => void memoire.set(k, v)
    }
    ecrireAlertes(storage, basculerAlerte(new Set(), 'zoe'))
    expect([...lireAlertes(storage)]).toEqual(['zoe'])
    ecrireAlertes(storage, basculerAlerte(lireAlertes(storage), 'zoe'))
    expect([...lireAlertes(storage)]).toEqual([])
  })

  it('un réglage illisible n’alerte personne', () => {
    expect([...parseAlertes('nope')]).toEqual([])
    const storage = { getItem: () => '{oops', setItem: () => undefined }
    expect([...lireAlertes(storage)]).toEqual([])
  })
})
