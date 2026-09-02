/**
 * LES CANAUX DE COMPUTE FABRIC, sortis de `src/main/index.ts`.
 *
 * Deux canaux : lister les nœuds connus, en rafraîchir un.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, même
 * validation de l'identifiant de nœud. Deux règles de fond intactes :
 *   - la liste montre la fixture d'une instance isolée EN REMPLACEMENT du nœud réel de même nom,
 *     jamais en double — sinon la vue afficherait deux fois le même nœud ;
 *   - un rafraîchissement reprojette les modèles de Fabric PUIS prévient les écrans : un nœud
 *     revenu en ligne doit redevenir choisissable sans recharger l'application.
 *
 * La fixture d'instance isolée est posée par un canal de test qui reste dans `index.ts` : elle est
 * donc reçue comme lecteur, pas comme valeur.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'
import type { FabricNodeSummary } from '../compute-fabric/control-plane'

/** Ce que les canaux de Compute Fabric prenaient dans `index.ts` — désormais passé explicitement. */
export type FabricIpcDeps = {
  /** Le plan de contrôle : `list()` rend les nœuds connus, `refresh(id)` en resonde un. */
  fabricControlPlane: {
    list: () => FabricNodeSummary[]
    refresh: (nodeId: string) => Promise<FabricNodeSummary>
  }
  /** La fixture d'instance isolée, LUE à l'instant de l'appel (elle est posée ailleurs). */
  lireFixtureIsolee: () => FabricNodeSummary | null
  /** Reprojeter les modèles de Compute Fabric dans le catalogue. */
  synchroniserFabric: () => void
  /** Prévenir les écrans que les rôles ont changé. */
  broadcastRolesRefresh: () => void
}

export function registerFabricIpc({
  fabricControlPlane,
  lireFixtureIsolee,
  synchroniserFabric,
  broadcastRolesRefresh
}: FabricIpcDeps): void {
  ipcMain.handle('os:fabric:list', (event) => {
    assertTrustedRendererSender(event, 'Compute Fabric')
    const live = fabricControlPlane.list()
    const fixture = lireFixtureIsolee()
    return fixture ? [...live.filter((node) => node.nodeId !== fixture.nodeId), fixture] : live
  })
  ipcMain.handle('os:fabric:refresh', async (event, nodeId?: unknown) => {
    assertTrustedRendererSender(event, 'Compute Fabric')
    const summary = await fabricControlPlane.refresh(guardString(nodeId, 'nodeId'))
    synchroniserFabric()
    broadcastRolesRefresh()
    return summary
  })
}
