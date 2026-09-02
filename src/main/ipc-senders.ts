/**
 * Les GARDES D'EXPÉDITEUR des canaux IPC, sorties de `src/main/index.ts`.
 *
 * Elles étaient posées au milieu du fichier de démarrage alors qu'elles ne dépendent de rien de
 * lui : chaque canal IPC les appelle, donc elles doivent être IMPORTABLES — et testables sans
 * démarrer Electron. Déplacement mécanique : corps identique, aucune dépendance à passer.
 */
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { diagnostiquerExpediteurRenderer } from './behaviour-access'

/** Où vit le renderer légitime : l'URL de développement si elle existe, sinon le fichier packagé. */
export function behaviourRendererOptions(): { devRendererUrl?: string; rendererHtmlPath: string } {
  return {
    devRendererUrl: is.dev ? process.env.ELECTRON_RENDERER_URL : undefined,
    rendererHtmlPath: join(__dirname, '../renderer/index.html')
  }
}

export function assertTrustedRendererSender(event: IpcMainInvokeEvent, scope: string): void {
  // Le refus DIT ce qu'il a vu : une frame détachée (rechargement en cours) n'est pas une origine
  // hostile, et la confondre envoyait chercher une faille là où il y a un cycle de vie.
  // Rien n'est relâché : les deux cas restent refusés.
  const verdict = diagnostiquerExpediteurRenderer(
    event.senderFrame?.url,
    behaviourRendererOptions()
  )
  if (verdict.trusted) return
  if (verdict.cause === 'frame-indisponible') {
    throw new Error(`Frame renderer indisponible pour ${scope} (rechargement en cours ?)`)
  }
  throw new Error(
    `Origine renderer non autorisée pour ${scope}${verdict.origine ? ` : ${verdict.origine}` : ''}`
  )
}

export function assertTrustedBehaviourSender(event: IpcMainInvokeEvent): void {
  assertTrustedRendererSender(event, 'Behaviour')
}
