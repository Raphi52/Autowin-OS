/**
 * LE CANAL DE LA CARTE DES BESOINS (conv-1089, 2026-10-22) — lecture seule, aucun appel de modèle.
 *
 * La vue demande la carte ; le processus principal la calcule à partir des fils qu'il a déjà en
 * mémoire et des runs du scan borné de `get_state` (`runsWithGate`), puis ne renvoie que la
 * projection (~1,5 Mo mesurés pour 4 795 demandes), jamais l'historique.
 *
 * Lot 2 : il relit aussi `besoins.jsonl` (qui a prompté, ligne de besoin) et, pour les demandes
 * antérieures au journal, l'identité git actuelle du dossier de chaque fil.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { creerCalculateurDeCarte, type ConversationPourLaCarte } from '../carte-des-besoins'
import { creerIdentitesEnCache, type EntreeDuJournal } from '../journal-des-besoins'
import type { AutowinOS } from '../os'

export function registerCarteDesBesoinsIpc({
  os,
  journal
}: {
  os: Pick<AutowinOS, 'conversations' | 'runsWithGate' | 'executionWorkspace'>
  journal?: { lire: () => ReadonlyMap<string, EntreeDuJournal> }
}): void {
  const identiteDuDossier = creerIdentitesEnCache()
  const calculateur = creerCalculateurDeCarte({
    // Le type du store et celui de la carte décrivent le même JSON ; seul le typage des parts diffère.
    lireConversations: () =>
      os.conversations.list() as unknown as readonly (ConversationPourLaCarte & {
        updatedAt?: number
      })[],
    lireRuns: () => os.runsWithGate(),
    dossierParDefaut: () => os.executionWorkspace,
    ...(journal
      ? {
          lireJournal: () => {
            try {
              return journal.lire()
            } catch (erreur) {
              // Un journal illisible prive la carte des demandeurs relevés, pas de la carte.
              console.warn('[besoins] journal illisible :', erreur)
              return new Map<string, EntreeDuJournal>()
            }
          }
        }
      : {}),
    identiteDuDossier
  })
  ipcMain.handle('os:carteDesBesoins', (event) => {
    assertTrustedRendererSender(event, 'CarteDesBesoins')
    return calculateur.calculer()
  })
}
