/**
 * QUI l'utilisateur veut être ALERTÉ, et QUOI alerter — en fonctions pures.
 *
 * Demande de l'utilisateur du 2026-09-07 : « dans le widget outlook, pour chaque interlocuteur, un
 * switch pour activer une notif popup + audio ». Le réglage est donc PAR PERSONNE, il survit au
 * redémarrage, et il ne concerne QUE les messages REÇUS et NON LUS.
 *
 * Hors React à dessein : la règle « qu'est-ce qui est nouveau » est la partie qui casse, et elle doit
 * être testable sans monter d'interface ni de vraie boîte aux lettres.
 */
import type { Interlocuteur } from './outlook-model'
import { autowinStorageKey } from '../storage-keys'

export const CLE_ALERTES_INTERLOCUTEURS = autowinStorageKey('outlook.alertes-interlocuteurs.v1')

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Les clés des interlocuteurs surveillés. Absent = pas d'alerte : personne n'en reçoit sans l'avoir demandé. */
export type AlertesInterlocuteurs = ReadonlySet<string>

export function parseAlertes(raw: unknown): AlertesInterlocuteurs {
  if (!Array.isArray(raw)) return new Set()
  return new Set(raw.filter((cle): cle is string => typeof cle === 'string' && cle !== ''))
}

export function lireAlertes(storage: StorageLike): AlertesInterlocuteurs {
  try {
    const raw = storage.getItem(CLE_ALERTES_INTERLOCUTEURS)
    if (raw === null) return new Set()
    return parseAlertes(JSON.parse(raw))
  } catch {
    // Réglage illisible : on n'alerte pas plutôt que d'alerter au hasard.
    return new Set()
  }
}

export function ecrireAlertes(storage: StorageLike, alertes: AlertesInterlocuteurs): void {
  try {
    storage.setItem(CLE_ALERTES_INTERLOCUTEURS, JSON.stringify([...alertes]))
  } catch {
    // Sans écriture, le réglage vaut pour la session.
  }
}

export function basculerAlerte(alertes: AlertesInterlocuteurs, cle: string): AlertesInterlocuteurs {
  const suivant = new Set(alertes)
  if (suivant.has(cle)) suivant.delete(cle)
  else suivant.add(cle)
  return suivant
}

export function estAlerte(alertes: AlertesInterlocuteurs, cle: string): boolean {
  return alertes.has(cle)
}

/** Ce qu'une alerte annonce : de qui, quel objet, et le message qui l'a déclenchée. */
export interface AlerteMessage {
  id: string
  contact: string
  sujet: string
  apercu: string
}

/**
 * Les messages qui MÉRITENT une alerte à cet instant.
 *
 * Trois conditions, toutes nécessaires : l'interlocuteur est surveillé, le message est REÇU et NON
 * LU, et il n'a pas déjà été annoncé. Sans la dernière, la relecture d'Outlook toutes les deux
 * minutes rejouerait la même popup jusqu'à ce que le message soit lu.
 */
export function messagesAAlerter(
  fils: readonly Interlocuteur[],
  alertes: AlertesInterlocuteurs,
  dejaAnnonces: ReadonlySet<string>
): AlerteMessage[] {
  const resultat: AlerteMessage[] = []
  for (const fil of fils) {
    if (!alertes.has(fil.cle)) continue
    for (const message of fil.messages) {
      if (!message.nonLu || message.deMoi) continue
      if (dejaAnnonces.has(message.id)) continue
      resultat.push({
        id: message.id,
        contact: fil.nom,
        sujet: message.sujet,
        apercu: message.corps.slice(0, 180)
      })
    }
  }
  return resultat
}
