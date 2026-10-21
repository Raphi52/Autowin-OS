/**
 * « POURQUOI PAS ? » — le canal du motif d'une piste décochée du panneau du scout (piste 2, conv-1033).
 *
 * Mesuré le 21/10 dans `scout-pistes.json` : 6 runs scout sur 10 sans aucun choix noté. Une piste
 * laissée ne disait jamais POURQUOI — déjà faite, fausse, trop petite, hors sujet —, alors que ces
 * quatre raisons appellent quatre corrections différentes du scout suivant. Le panneau ne connaît ni
 * le dépôt ni le run : le processus principal retrouve la piste par son titre dans la mémoire du dépôt
 * de travail, comme il le fait pour le message de sélection (`noterChoixScout`). Ce dépôt est celui de
 * la CONVERSATION (même règle que `project:root`) : le scout y a noté ses pistes, pas forcément dans
 * le dossier du démarrage (objection du juge indépendant, reprise de conv-1033).
 *
 * Même patron que `veille/veille-ipc.ts` : expéditeur vérifié, entrée inconnue REFUSÉE (jamais
 * corrigée), écriture par le seul module de la mémoire.
 */
import type { IpcMainInvokeEvent } from 'electron'
import { estMotifRefus } from '../shared/scout-table'
import { noterMotifScout } from './scout-memoire'

/** Le titre d'une piste dépasse rarement 160 caractères (`MAX_TITRE`) ; au-delà, ce n'est pas un titre. */
const MAX_TITRE_RECU = 2000
/** Un identifiant de conversation (« conv-1033 ») ; au-delà, ce n'en est pas un : repli sur le démarrage. */
const MAX_ID_CONVERSATION = 200

export interface RegisterScoutMotifIpcOptions {
  ipc: {
    handle: (
      canal: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    ) => void
  }
  assertTrusted: (event: IpcMainInvokeEvent, surface: string) => void
  /**
   * Le dossier de travail d'une conversation (`dossierDeTravailDuTour`) : celui où l'orchestrateur a
   * noté les pistes. Sans conversation, le dossier du démarrage.
   */
  depotDe: (conversationId?: string) => string
  /** Fichier de la mémoire ; défaut = celui de l'app (`cheminMemoireScout`). */
  chemin?: string
}

export function registerScoutMotifIpc(options: RegisterScoutMotifIpcOptions): void {
  options.ipc.handle('scout:motif', (event, ...args: unknown[]) => {
    options.assertTrusted(event, 'Candidats du scout')
    const [titre, motif, conversationId] = args
    if (typeof titre !== 'string' || !titre.trim() || titre.length > MAX_TITRE_RECU) {
      throw new Error('motif de refus invalide : titre de piste absent ou trop long')
    }
    if (!estMotifRefus(motif)) throw new Error(`motif de refus inconnu : « ${String(motif)} »`)
    const conversation =
      typeof conversationId === 'string' &&
      conversationId.trim() &&
      conversationId.length <= MAX_ID_CONVERSATION
        ? conversationId
        : undefined
    return noterMotifScout({
      depot: options.depotDe(conversation),
      titre,
      motif,
      ...(options.chemin ? { chemin: options.chemin } : {})
    })
  })
}
