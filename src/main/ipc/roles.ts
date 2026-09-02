/**
 * LES CANAUX DES RÔLES D'AGENTS, sortis de `src/main/index.ts`.
 *
 * Deux canaux : lire les rôles courants, et poser le fournisseur/modèle d'un rôle depuis la vue.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, même
 * attente du catalogue de modèles avant de servir OU d'écrire. Deux règles de fond intactes :
 *   - les rôles ne sont pas une autorité à part : écrire un rôle passe par la TOPOLOGIE, qui est
 *     persistée puis resynchronisée — c'est `agent-topology.json` la source, pas `roles.json` ;
 *   - le catalogue de modèles est attendu avant de répondre, sinon un rôle non résolu sortirait.
 *
 * `agentTopology` et `agentModels` sont des variables RÉASSIGNÉES dans `index.ts` : elles sont
 * reçues comme lecteurs, jamais comme valeurs — sinon un rôle posé après un rafraîchissement du
 * catalogue serait validé contre le catalogue du démarrage.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { topologyWithRuntimeRole } from '../runtime-topology'
import type { AgentTopology } from '../topology'
import type { ImportedModel } from '../models'
import type { Role, ReasoningEffort } from '../roles'
import type { AutowinOS } from '../os'

/** Ce que les canaux des rôles prenaient dans `index.ts` — désormais passé explicitement. */
export type RolesIpcDeps = {
  os: AutowinOS
  /** Le catalogue de modèles : attendu avant de servir comme avant d'écrire. */
  agentModelsReady: Promise<unknown>
  /** Le catalogue courant, LU à l'instant de l'appel (il est réassigné ailleurs). */
  lireModeles: () => ImportedModel[]
  /** La topologie courante, LUE à l'instant de l'appel (elle est réassignée ailleurs). */
  lireTopologie: () => AgentTopology
  /** Persiste la topologie, resynchronise les rôles et rend celle qui a été retenue. */
  appliquerTopologie: (topology: AgentTopology) => AgentTopology
  /** Prévenir les écrans que les rôles ont changé. */
  broadcastRolesRefresh: () => void
}

export function registerRolesIpc({
  os,
  agentModelsReady,
  lireModeles,
  lireTopologie,
  appliquerTopologie,
  broadcastRolesRefresh
}: RolesIpcDeps): void {
  ipcMain.handle('os:roles', async (event) => {
    assertTrustedRendererSender(event, 'Roles')
    await agentModelsReady
    return os.roles.all()
  })
  ipcMain.handle(
    'os:setRole',
    async (event, role: Role, provider: string, model?: string, reasoningEffort?: string) => {
      assertTrustedRendererSender(event, 'SetRole')
      await agentModelsReady
      const next = topologyWithRuntimeRole(
        lireTopologie(),
        role,
        {
          provider,
          model,
          reasoningEffort: reasoningEffort as ReasoningEffort | undefined
        },
        lireModeles()
      )
      appliquerTopologie(next)
      broadcastRolesRefresh()
      return os.roles.all()
    }
  )
}
