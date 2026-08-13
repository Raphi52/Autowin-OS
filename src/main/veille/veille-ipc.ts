import type { IpcMainInvokeEvent } from 'electron'
import type { TypeEntree } from './candidats'
import { ecrireStockVeille, lireStockVeille, type StockVeille } from './candidats-store'

/**
 * L'IPC de la veille : lire le stock, et marquer un candidat.
 *
 * Deux gestes seulement, et volontairement : la vue LIT et MARQUE. Elle ne lance pas de passe et
 * n'écrit pas de candidat — une interface qui pourrait fabriquer un candidat contournerait tout le
 * contrôle de citation, qui est la seule chose empêchant d'afficher une feature inventée.
 *
 * Le même garde d'origine que les autres surfaces (`assertTrusted`) : une fenêtre qui n'est pas la
 * nôtre n'a rien à lire ici.
 */

export type StatutCandidat = StockVeille['candidats'][number]['statut']

const STATUTS: readonly StatutCandidat[] = ['nouveau', 'ecarte', 'prompte']

export interface RegisterVeilleIpcOptions {
  ipc: {
    handle(
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    ): void
  }
  assertTrusted(event: IpcMainInvokeEvent, scope: string): void
  /** Injecté pour les tests : sinon on écrirait dans la racine de données réelle. */
  chemin?: string
  /**
   * « En générer plus » : lance la passe INTERNE côté main et rend le stock à jour. La vue ne
   * fabrique toujours AUCUN candidat — elle déclenche une passe, dont le contrôle de citation
   * (`trierCandidats`) reste le seul chemin d'écriture. Absent = le canal répond par une erreur
   * nommée plutôt que d'exister en silence.
   */
  genererInterne?: () => Promise<unknown>
}

export function registerVeilleIpc(options: RegisterVeilleIpcOptions): void {
  const { ipc, assertTrusted, chemin } = options

  /** Une seule génération à la fois : un double-clic ne paie pas deux scouts. */
  let generationEnCours: Promise<unknown> | undefined
  ipc.handle('veille:generer', (event) => {
    assertTrusted(event, 'Veille concurrents')
    if (!options.genererInterne) {
      throw new Error('génération interne non câblée sur ce poste')
    }
    if (!generationEnCours) {
      generationEnCours = options.genererInterne().finally(() => {
        generationEnCours = undefined
      })
    }
    return generationEnCours
  })

  ipc.handle('veille:snapshot', (event) => {
    assertTrusted(event, 'Veille concurrents')
    return lireStockVeille(chemin)
  })

  ipc.handle('veille:marquer', (event, ...args: unknown[]) => {
    assertTrusted(event, 'Veille concurrents')
    const [brutId, brutStatut] = args
    const id = typeof brutId === 'string' ? brutId : ''
    const statut = STATUTS.find((valide) => valide === brutStatut)
    // Un identifiant vide ou un statut inconnu est REFUSÉ, pas corrigé : accepter n'importe quoi ici
    // laisserait un appel malformé modifier silencieusement l'état affiché.
    if (!id || !statut) {
      throw new Error(
        `marquage de candidat invalide (id « ${String(brutId)} », statut « ${String(brutStatut)} »)`
      )
    }
    const stock = lireStockVeille(chemin)
    const candidat = stock.candidats.find((c) => c.id === id)
    if (!candidat) throw new Error(`candidat inconnu : ${id}`)
    const suivant: StockVeille = {
      ...stock,
      candidats: stock.candidats.map((c) => (c.id === id ? { ...c, statut } : c))
    }
    ecrireStockVeille(suivant, chemin)
    return suivant
  })
}

/** Réexporté pour la vue : le type d'entrée sert à afficher la nature du candidat. */
export type { TypeEntree }
