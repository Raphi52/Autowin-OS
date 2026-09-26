/**
 * LES CANAUX DE LA SÉPARATION DES VOIX (pyannote), sur le modèle de ceux de whisper.
 *
 * Deux canaux seulement, et c'est volontaire : LIRE l'état, et POSER la brique. Aucun fichier audio
 * ne transite ici — le traitement n'existe pas encore, et un canal qui accepterait un chemin sans
 * rien en faire serait une promesse vide dans l'interface.
 *
 * L'installation descend ~2,5 Go : elle n'est déclenchée que par un clic explicite côté fenêtre, et
 * le garde d'expéditeur reste celui de tous les autres canaux — une fenêtre non reconnue ne lance
 * pas un téléchargement de cette taille.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { etatDiarisation, installerDiarisation, type EtatDiarisation } from '../diarisation'

export type DiarisationIpcDeps = {
  /** Injectables pour les tests ; en production, les implémentations réelles du module. */
  etat?: () => Promise<EtatDiarisation>
  installer?: () => Promise<EtatDiarisation>
}

export function registerDiarisationIpc(deps: DiarisationIpcDeps = {}): void {
  const lireEtat = deps.etat ?? (() => etatDiarisation())
  const poser = deps.installer ?? (() => installerDiarisation())

  ipcMain.handle('os:diarisation:etat', (event) => {
    assertTrustedRendererSender(event, 'Diarisation état')
    return lireEtat()
  })
  ipcMain.handle('os:diarisation:installer', (event) => {
    assertTrustedRendererSender(event, 'Diarisation installation')
    return poser()
  })
}
