/**
 * LES CANAUX DU BOUTON « LANCER » (panneau Fichiers d'une conversation, 2026-09-28).
 *
 * Même règle que les canaux « Projet » (`project-files.ts`) : le renderer ne transmet QUE
 * l'identifiant de la conversation ; le dossier où la commande tourne est déduit ici, jamais reçu.
 * La commande elle-même vient de la déclaration du dossier (`.autowin/scripts.json`, sinon
 * Conductor, sinon `package.json`) : le renderer ne peut pas faire exécuter une ligne de son choix.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { dossierDeTravailDuTour } from '../bascule-dossier-conversation'
import { guardString } from '../ipc-guards'
import { assertTrustedRendererSender } from '../ipc-senders'
import { emitToLiveWindows } from '../renderer-emit'
import { LancementsParDossier } from '../scripts-copie-main'
import type { AutowinOS } from '../os'

export function registerLancementIpc({ os }: { os: AutowinOS }): {
  arreterTout: () => Promise<void>
} {
  const lancements = new LancementsParDossier({
    notifier: (conversationId, etat) =>
      emitToLiveWindows(BrowserWindow.getAllWindows(), 'lancement:maj', { conversationId, etat })
  })
  const dossier = (conversationId: string): string =>
    dossierDeTravailDuTour(
      os.conversations?.get?.(conversationId)?.projectPath,
      os.executionWorkspace
    )
  const conversation = (brut: unknown): string => {
    const id = guardString(brut, 'conversationId').trim()
    if (!id) throw new Error('IPC conversationId: identifiant vide')
    return id
  }

  ipcMain.handle('lancement:etat', (event, brut: unknown) => {
    assertTrustedRendererSender(event, 'LancementEtat')
    const id = conversation(brut)
    return lancements.etat(id, dossier(id))
  })
  ipcMain.handle('lancement:demarrer', (event, brut: unknown) => {
    assertTrustedRendererSender(event, 'LancementDemarrer')
    const id = conversation(brut)
    return lancements.demarrer(id, dossier(id))
  })
  ipcMain.handle('lancement:arreter', (event, brut: unknown) => {
    assertTrustedRendererSender(event, 'LancementArreter')
    return lancements.arreter(conversation(brut))
  })
  return { arreterTout: () => lancements.arreterTout() }
}
