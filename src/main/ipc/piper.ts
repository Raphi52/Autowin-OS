/**
 * LES CANAUX DE LA VOIX NEURONALE (Piper), sortis de `src/main/index.ts`.
 *
 * Les voix de `speechSynthesis` sont celles DÉJÀ installées sur le poste : leur qualité est un
 * plafond que ni le débit ni la hauteur ne dépassent. Ces trois canaux exposent une voix française
 * téléchargée UNE fois sur un clic, puis prononcée en local — plus aucun réseau à l'usage. Rien
 * n'est un préalable : sans installation, `etat().installe` est faux et la fenêtre reparle avec la
 * voix du système.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, gardes d'expéditeur inchangés. Le
 * service reste construit PARESSEUSEMENT côté `index.ts` et n'est reçu ici que comme lecteur.
 */
import { ipcMain } from 'electron'
import type { ServicePiper } from '../piper-local'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'

export type PiperIpcDeps = {
  /** Lecteur, pas valeur : le service n'est construit qu'au premier appel. */
  servicePiper: () => ServicePiper
}

export function registerPiperIpc({ servicePiper }: PiperIpcDeps): void {
  ipcMain.handle('os:piper:etat', (event) => {
    assertTrustedRendererSender(event, 'Piper état')
    return servicePiper().etat()
  })
  ipcMain.handle('os:piper:installer', async (event) => {
    assertTrustedRendererSender(event, 'Piper installation')
    return servicePiper().installer()
  })
  ipcMain.handle('os:piper:parler', async (event, texte: unknown) => {
    assertTrustedRendererSender(event, 'Piper synthèse')
    const phrase = guardString(texte, 'texte')
    // Une phrase d'assistant fait quelques dizaines de mots : au-delà, ce n'est plus une réponse
    // parlée, c'est une lecture de document qui occuperait le processeur pour rien.
    if (phrase.length > 1_000) throw new Error('Phrase trop longue pour être prononcée')
    return servicePiper().synthetiser(phrase)
  })
}
