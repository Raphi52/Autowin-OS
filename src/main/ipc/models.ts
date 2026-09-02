/**
 * LES CANAUX DU CATALOGUE DE MODÈLES, sortis de `src/main/index.ts`.
 *
 * Deux canaux : servir le catalogue (avec rafraîchissement forcé optionnel) et lire les quotas.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, même
 * refus d'une option de rafraîchissement qui n'est pas un booléen. Deux règles de fond intactes :
 *   - sans rafraîchissement forcé, le catalogue en cache est servi TOUT DE SUITE — c'est ce qui
 *     évite d'attendre un aller-retour réseau à chaque ouverture d'écran ;
 *   - un rafraîchissement forcé ARME la barrière AVANT le premier `await` : aucun tour ne peut
 *     partir sur l'ancien catalogue pendant qu'un rafraîchissement est en vol.
 *
 * Le catalogue et la topologie sont des variables RÉASSIGNÉES dans `index.ts` : elles sont reçues
 * comme lecteurs, jamais comme valeurs.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { assertRuntimeTopologyAvailable } from '../runtime-topology'
import { buildModelQuotaSnapshot, getModelQuotaSnapshot } from '../model-quotas'
import type { AgentTopology } from '../topology'
import type { ImportedModel } from '../models'
import type { AutowinOS } from '../os'

/** Ce que les canaux du catalogue prenaient dans `index.ts` — désormais passé explicitement. */
export type ModelsIpcDeps = {
  os: AutowinOS
  /** Le rafraîchisseur du catalogue : `refresh(true)` force, `current()` rend l'état connu. */
  modelCatalog: {
    refresh: (force: boolean) => Promise<ImportedModel[]>
    current: () => ImportedModel[]
  }
  /** Le catalogue courant, LU à l'instant de l'appel (il est réassigné ailleurs). */
  lireModeles: () => ImportedModel[]
  /** La topologie courante, LUE à l'instant de l'appel (elle est réassignée ailleurs). */
  lireTopologie: () => AgentTopology
  /** Reprojeter les modèles de Compute Fabric après un rafraîchissement du catalogue. */
  synchroniserFabric: () => void
  /** Vrai dans une instance isolée de test : les quotas y sont une fixture, jamais un appel réel. */
  isolatedTestInstance: boolean
}

export function registerModelsIpc({
  os,
  modelCatalog,
  lireModeles,
  lireTopologie,
  synchroniserFabric,
  isolatedTestInstance
}: ModelsIpcDeps): void {
  ipcMain.handle('os:models:list', async (event, force = false) => {
    assertTrustedRendererSender(event, 'Model catalog')
    if (typeof force !== 'boolean') throw new Error('Option de rafraîchissement invalide')
    if (!force) return lireModeles()
    const refresh = modelCatalog.refresh(true)
    // Armer la barriere avant le premier await : aucun tour ne part sur l'ancien catalogue
    // pendant qu'un rafraichissement force est en vol.
    os.setTaskReadiness(
      refresh.then(() => assertRuntimeTopologyAvailable(lireTopologie(), lireModeles()))
    )
    await refresh
    synchroniserFabric()
    return lireModeles()
  })
  ipcMain.handle('os:models:quotas', async (event, force = false) => {
    assertTrustedRendererSender(event, 'Model quotas')
    if (typeof force !== 'boolean') throw new Error('Option de rafraîchissement invalide')
    const models = modelCatalog.current()
    if (isolatedTestInstance) {
      const observedAt = new Date().toISOString()
      const fiveHourResetsAt = new Date(Date.now() + 5 * 60 * 60_000).toISOString()
      const sevenDayResetsAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
      return buildModelQuotaSnapshot(models, {
        claude: {
          status: 'available',
          source: 'Fixture isolée Claude',
          observedAt,
          windows: [
            {
              id: 'five-hour',
              label: '5 h',
              usedPercent: 63,
              remainingPercent: 37,
              resetsAt: fiveHourResetsAt
            },
            {
              id: 'seven-day',
              label: '7 j',
              usedPercent: 18,
              remainingPercent: 82,
              resetsAt: sevenDayResetsAt
            }
          ]
        },
        codex: {
          status: 'available',
          source: 'Fixture isolée Codex',
          observedAt,
          windows: [
            {
              id: 'five-hour',
              label: '5 h',
              usedPercent: 42,
              remainingPercent: 58,
              resetsAt: fiveHourResetsAt
            },
            {
              id: 'seven-day',
              label: '7 j',
              usedPercent: 29,
              remainingPercent: 71,
              resetsAt: sevenDayResetsAt
            }
          ]
        }
      })
    }
    return getModelQuotaSnapshot(models, { force })
  })
}
