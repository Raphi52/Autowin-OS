/**
 * LES CANAUX DU COFFRE À CLÉS — section « Clés » des réglages.
 *
 * L'interface peut lister, ajouter (nom + valeur saisis par l'utilisateur), retirer et réimporter.
 * Aucune réponse ne porte une valeur : seulement nom, origine, date et longueur (`EtatCoffre`). La
 * valeur saisie entre ici, va au coffre chiffré, et n'en ressort que vers l'environnement d'un agent.
 * Un refus (nom invalide, chiffrement indisponible) revient en `erreur` lisible, jamais en exception
 * brute : son texte est écrit par le coffre et ne cite jamais la valeur.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from './ipc-senders'
import {
  ajouterCle,
  etatCoffre,
  importerDuPoste,
  retirerCle,
  type BilanImport,
  type EtatCoffre,
  type ReponseGesteCoffre
} from '../app/coffre-cles'

function geste(action: () => BilanImport | void): ReponseGesteCoffre {
  try {
    const bilan = action()
    return { ok: !bilan?.raison, ...(bilan ? { bilan } : {}), etat: etatCoffre() }
  } catch (erreur) {
    return {
      ok: false,
      erreur: erreur instanceof Error ? erreur.message : 'Geste refusé par le coffre.',
      etat: etatCoffre()
    }
  }
}

export function registerCoffreClesIpc(): void {
  ipcMain.handle('coffre:lister', (event): EtatCoffre => {
    assertTrustedRendererSender(event, 'Coffre à clés')
    return etatCoffre()
  })
  ipcMain.handle('coffre:ajouter', (event, nom: unknown, valeur: unknown): ReponseGesteCoffre => {
    assertTrustedRendererSender(event, 'Coffre à clés')
    return geste(() => ajouterCle(String(nom ?? ''), typeof valeur === 'string' ? valeur : ''))
  })
  ipcMain.handle('coffre:retirer', (event, nom: unknown): ReponseGesteCoffre => {
    assertTrustedRendererSender(event, 'Coffre à clés')
    return geste(() => {
      if (!retirerCle(String(nom ?? ''))) throw new Error('Aucune clé de ce nom dans le coffre.')
    })
  })
  ipcMain.handle('coffre:reimporter', (event): ReponseGesteCoffre => {
    assertTrustedRendererSender(event, 'Coffre à clés')
    return geste(importerDuPoste)
  })
}

/**
 * Import des clés du poste au démarrage. Une ligne de journal : des NOMBRES, et la raison d'un refus
 * (écrite par le coffre, sans valeur) — jamais un nom de clé ni une valeur.
 */
export function importerLeCoffreAuDemarrage(journaliser: (ligne: string) => void): void {
  try {
    const bilan = importerDuPoste()
    const importees = bilan.ajoutees + bilan.misesAJour
    journaliser(
      `[coffre] import du poste : ${importees} clé(s) importée(s) (${bilan.ajoutees} nouvelle(s), ` +
        `${bilan.misesAJour} mise(s) à jour), ${bilan.ignorees} laissée(s) telle(s) quelle(s)` +
        (bilan.raison ? ` — ${bilan.raison}` : '')
    )
  } catch (erreur) {
    journaliser(
      `[coffre] import du poste impossible : ${erreur instanceof Error ? erreur.message : 'erreur inconnue'}`
    )
  }
}
