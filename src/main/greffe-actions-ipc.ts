/**
 * Le canal que le widget « Actions des utilisateurs » emprunte pour lire un greffe.
 *
 * Le renderer n'envoie JAMAIS de SQL : il envoie un nom de greffe, et rien d'autre. Les deux
 * requêtes sont construites ici (`greffe-actions.ts`) et repassent par `runSqlRead` — donc par le
 * catalogue des greffes exploités et la garde lecture seule. C'est ce qui empêche l'écran de
 * devenir une console SQL.
 */
import { lireActionsGreffe, type ResultatActions } from './greffe-actions'
import { resolveSqlTargets } from './sql-read-catalog'
import { runSqlRead } from './sql-read-command'

export interface GreffeActionsIpcRegistrar {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle: (channel: string, listener: (event: any, ...args: any[]) => any) => void
}

export interface GreffeActionsDeps {
  ipc: GreffeActionsIpcRegistrar
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assertTrusted: (event: any, scope: string) => void
  listerGreffes?: () => Promise<{ server: string; database: string }[]>
  lire?: typeof lireActionsGreffe
}

const DEFAUT_LIMITE = 100

export function registerGreffeActionsIpc({
  ipc,
  assertTrusted,
  listerGreffes,
  lire = lireActionsGreffe
}: GreffeActionsDeps): void {
  const greffes =
    listerGreffes ??
    (async () => {
      const catalogue = await resolveSqlTargets()
      return catalogue
        .servers()
        .flatMap((server) =>
          catalogue.databasesFor(server).map((database) => ({ server, database }))
        )
    })

  ipc.handle('greffe:actions:liste', async (event) => {
    assertTrusted(event, 'Actions des utilisateurs')
    return greffes()
  })

  ipc.handle('greffe:actions:lire', async (event, demande: unknown): Promise<ResultatActions> => {
    assertTrusted(event, 'Actions des utilisateurs')
    const base = (demande as { database?: unknown })?.database
    if (typeof base !== 'string' || !base.trim()) {
      return { ok: false, raison: 'Aucun greffe demandé.' }
    }
    // La cible est reprise du CATALOGUE, pas du message : le renderer ne choisit pas de serveur.
    const cible = (await greffes()).find(
      (candidat) => candidat.database.toLowerCase() === base.trim().toLowerCase()
    )
    if (!cible) return { ok: false, raison: `Greffe inconnu ou non exploité : ${base}.` }
    return lire(cible, DEFAUT_LIMITE, { runSqlRead: (args) => runSqlRead(args) })
  })
}
