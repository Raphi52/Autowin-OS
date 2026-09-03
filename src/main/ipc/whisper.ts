/**
 * LES CANAUX DE LA RECONNAISSANCE VOCALE LOCALE (whisper.cpp), sortis de `src/main/index.ts`.
 *
 * MESURÉ sur cette application : le moteur `webkitSpeechRecognition` rend le code d'erreur
 * `network`, affiché à l'écran et conservé en capture datée (voir l'en-tête de `whisper-local.ts`
 * pour le chemin de l'artefact) — Jarvis ouvrait le micro et n'entendait jamais rien. La CAUSE de
 * ce code n'est pas établie ici et n'est pas nécessaire : ces trois canaux exposent whisper.cpp
 * installé en local — téléchargé UNE fois, puis plus aucun réseau.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, gardes d'expéditeur inchangés, mêmes
 * refus. Deux règles de fond que le déplacement ne touche pas :
 *   - la transcription reçoit des OCTETS, jamais un chemin : la fenêtre ne désigne aucun fichier ;
 *   - un segment est plafonné à 8 Mo. Un WAV de 15 s à 16 kHz/16 bits pèse ~480 Ko : au-delà, ce
 *     n'est plus un segment de dictée.
 *
 * Le service reste construit PARESSEUSEMENT côté `index.ts` et n'est reçu ici que comme lecteur —
 * rien n'est téléchargé ni lu sur le disque tant que personne ne dicte.
 */
import { ipcMain } from 'electron'
import type { ServiceWhisper } from '../whisper-local'
import { assertTrustedRendererSender } from '../ipc-senders'

export type WhisperIpcDeps = {
  /** Lecteur, pas valeur : le service n'est construit qu'au premier appel. */
  serviceWhisper: () => ServiceWhisper
}

export function registerWhisperIpc({ serviceWhisper }: WhisperIpcDeps): void {
  ipcMain.handle('os:whisper:etat', (event) => {
    assertTrustedRendererSender(event, 'Whisper état')
    return serviceWhisper().etat()
  })
  ipcMain.handle('os:whisper:installer', async (event) => {
    assertTrustedRendererSender(event, 'Whisper installation')
    return serviceWhisper().installer()
  })
  ipcMain.handle('os:whisper:transcrire', async (event, wav: unknown) => {
    assertTrustedRendererSender(event, 'Whisper transcription')
    if (!(wav instanceof Uint8Array) && !Buffer.isBuffer(wav)) {
      throw new Error('Segment audio invalide')
    }
    const octets = wav as Uint8Array
    // Un WAV de 15 s à 16 kHz/16 bits pèse ~480 Ko : au-delà de 8 Mo, ce n'est plus un segment.
    if (octets.byteLength > 8_000_000) throw new Error('Segment audio trop volumineux')
    return serviceWhisper().transcrire(octets)
  })
}
