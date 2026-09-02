/**
 * LES CANAUX DES ENREGISTREMENTS PARLÉS, sortis de `src/main/index.ts`.
 *
 * Le texte dicté n'allait NULLE PART : il vivait en mémoire de fenêtre, plafonné à 40 lignes, perdu
 * au rechargement — une réunion de trois heures était donc perdue. Ces cinq canaux l'écrivent au fil
 * de l'eau. Le chemin est décidé côté application : la fenêtre ne manipule qu'un identifiant de
 * session, jamais un chemin de fichier.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, gardes d'expéditeur inchangés. Le
 * service reste construit PARESSEUSEMENT côté `index.ts` et n'est reçu ici que comme lecteur.
 */
import { ipcMain, shell } from 'electron'
import type { ServiceTranscripts } from '../transcripts'
import { assertTrustedRendererSender } from '../ipc-senders'

export type TranscriptsIpcDeps = {
  /** Lecteur, pas valeur : aucun dossier n'est créé tant que personne n'appuie sur « Enregistrer ». */
  serviceTranscripts: () => ServiceTranscripts
}

export function registerTranscriptsIpc({ serviceTranscripts }: TranscriptsIpcDeps): void {
  ipcMain.handle('os:transcript:demarrer', async (event) => {
    assertTrustedRendererSender(event, 'Enregistrement démarrage')
    return serviceTranscripts().demarrer()
  })
  ipcMain.handle('os:transcript:ajouter', async (event, id: unknown, texte: unknown) => {
    assertTrustedRendererSender(event, 'Enregistrement écriture')
    if (typeof id !== 'string' || typeof texte !== 'string') {
      throw new Error('Ligne d’enregistrement invalide')
    }
    return serviceTranscripts().ajouter(id, texte)
  })
  ipcMain.handle('os:transcript:terminer', async (event, id: unknown) => {
    assertTrustedRendererSender(event, 'Enregistrement fin')
    if (typeof id !== 'string') throw new Error('Enregistrement invalide')
    return serviceTranscripts().terminer(id)
  })
  ipcMain.handle('os:transcript:lister', async (event, max: unknown) => {
    assertTrustedRendererSender(event, 'Enregistrements liste')
    return serviceTranscripts().lister(typeof max === 'number' ? max : 10)
  })
  ipcMain.handle('os:transcript:revealer', async (event, chemin: unknown) => {
    assertTrustedRendererSender(event, 'Enregistrement dans l’explorateur')
    // Seul un fichier RÉELLEMENT listé s'ouvre : la fenêtre ne choisit pas ce que l'explorateur
    // met en évidence.
    const fichiers = await serviceTranscripts().lister(200)
    const cible = fichiers.find((f) => f.chemin === chemin)
    if (!cible) throw new Error('Enregistrement introuvable')
    shell.showItemInFolder(cible.chemin)
    return { ok: true as const }
  })
}
