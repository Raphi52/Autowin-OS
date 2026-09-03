/**
 * LES CANAUX DE LA TOPOLOGIE D'AGENTS, sortis de `src/main/index.ts`.
 *
 * Deux canaux : relire la topologie courante, en poser une nouvelle depuis Agent Studio.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, même
 * attente du catalogue de modèles avant de servir OU d'écrire — servir la topologie avant la fin
 * de cette attente rendrait des rôles non résolus, ce qu'un contrat surveille.
 *
 * La topologie courante est une variable RÉASSIGNÉE dans `index.ts` : elle est donc reçue comme
 * lecteur (`lireTopologie`) et écrivain (`appliquerTopologie`), jamais comme valeur. C'est la même
 * paire que celle des profils — `index.ts` garde la seule autorité sur cette variable.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'
import { migrateTopologyShape } from '../topology'
import type { AgentTopology } from '../topology'

/** Ce que les canaux de topologie prenaient dans `index.ts` — désormais passé explicitement. */
export type TopologyIpcDeps = {
  /** Le catalogue de modèles : attendu avant de servir comme avant d'écrire. */
  agentModelsReady: Promise<unknown>
  /** La topologie courante, LUE à l'instant de l'appel (elle est réassignée ailleurs). */
  lireTopologie: () => AgentTopology
  /** Persiste la topologie, resynchronise les rôles et rend celle qui a été retenue. */
  appliquerTopologie: (topology: AgentTopology) => AgentTopology
  /** Prévenir les écrans que les rôles ont changé. */
  broadcastRolesRefresh: () => void
}

export function registerTopologyIpc({
  agentModelsReady,
  lireTopologie,
  appliquerTopologie,
  broadcastRolesRefresh
}: TopologyIpcDeps): void {
  ipcMain.handle('os:topology:get', async (event) => {
    assertTrustedRendererSender(event, 'Topology')
    await agentModelsReady
    return lireTopologie()
  })
  ipcMain.handle('os:topology:set', async (event, topology: AgentTopology) => {
    assertTrustedRendererSender(event, 'Topology')
    await agentModelsReady
    guardString(JSON.stringify(topology), 'topology')
    const retenue = appliquerTopologie(migrateTopologyShape(topology) as AgentTopology)
    broadcastRolesRefresh()
    return retenue
  })
}
