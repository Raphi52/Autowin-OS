/**
 * LES CANAUX DES ARTEFACTS DU CHAT, sortis de `src/main/index.ts`.
 *
 * Deux canaux : lire l'aperçu d'un artefact, le montrer dans l'explorateur de fichiers.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, mêmes
 * validations. Trois règles de fond que le déplacement ne touche pas :
 *   - la fenêtre ne fournit JAMAIS de chemin. Elle donne un triplet d'identité (conversation,
 *     tour, artefact) et c'est le magasin qui retrouve le fichier — sinon n'importe quel chemin
 *     du disque serait lisible depuis l'interface ;
 *   - l'aperçu est plafonné DEUX fois : par artefact, et par un budget cumulé propre à chaque
 *     couple fenêtre + conversation. Un artefact refusé rend une erreur, pas un fichier tronqué
 *     en silence ;
 *   - le budget d'une fenêtre est libéré à sa fermeture, une seule fois par fenêtre — sinon la
 *     mémoire garderait des compteurs de fenêtres mortes.
 *
 * Le compteur de budget et le suivi des fenêtres n'avaient AUCUN autre appelant : ils viennent
 * avec les canaux plutôt que de rester des variables de module dans le fichier de démarrage.
 */
import { ipcMain, shell } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'
import {
  ChatArtifactPreviewBudget,
  MAX_ARTIFACT_PREVIEW_BYTES,
  readConversationArtifact,
  revealableConversationArtifactPath
} from '../store/chat-artifact-store'
import type { AutowinOS } from '../os'

/** Ce que les canaux des artefacts prenaient dans `index.ts` — désormais passé explicitement. */
export type ChatArtifactsIpcDeps = {
  os: AutowinOS
}

export function registerChatArtifactsIpc({ os }: ChatArtifactsIpcDeps): void {
  const chatArtifactPreviewBudget = new ChatArtifactPreviewBudget()
  const budgetedArtifactRenderers = new Set<number>()

  ipcMain.handle(
    'os:chatArtifact:read',
    (event, rawConversationId: unknown, rawTurnId: unknown, rawArtifactId: unknown) => {
      assertTrustedRendererSender(event, 'Chat artifact')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const turnId = guardString(rawTurnId, 'turnId')
      const artifactId = guardString(rawArtifactId, 'artifactId')
      if (!budgetedArtifactRenderers.has(event.sender.id)) {
        budgetedArtifactRenderers.add(event.sender.id)
        event.sender.once('destroyed', () => {
          chatArtifactPreviewBudget.clearRenderer(event.sender.id)
          budgetedArtifactRenderers.delete(event.sender.id)
        })
      }
      const scope = `${event.sender.id}:${conversationId}`
      const artifactBudgetId = `${turnId}\u0000${artifactId}`
      const remaining = Math.min(
        MAX_ARTIFACT_PREVIEW_BYTES,
        chatArtifactPreviewBudget.remaining(scope, artifactBudgetId)
      )
      const result = readConversationArtifact(
        os.conversations.get(conversationId),
        turnId,
        artifactId,
        undefined,
        remaining
      )
      if (
        result.ok &&
        !chatArtifactPreviewBudget.reserve(scope, artifactBudgetId, result.artifact?.size ?? 0)
      ) {
        return { ok: false, artifact: result.artifact, error: 'Budget cumulé des aperçus atteint' }
      }
      return result
    }
  )
  ipcMain.handle(
    'os:chatArtifact:reveal',
    (event, rawConversationId: unknown, rawTurnId: unknown, rawArtifactId: unknown) => {
      assertTrustedRendererSender(event, 'Chat artifact')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const turnId = guardString(rawTurnId, 'turnId')
      const artifactId = guardString(rawArtifactId, 'artifactId')
      const path = revealableConversationArtifactPath(
        os.conversations.get(conversationId),
        turnId,
        artifactId
      )
      if (!path) return { ok: false, error: 'Artefact introuvable' }
      shell.showItemInFolder(path)
      return { ok: true }
    }
  )
}
