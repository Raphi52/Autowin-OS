/**
 * CE QUE L'INTERFACE VOIT DES RUN.md LÉGERS (conv-1441, 2026-11-02).
 *
 * Les fiches s'écrivaient depuis le 01/11 (`src/main/board/fiches-de-demande.ts`, conv-1418), mais aucun
 * écran ne les lisait : « je vois dans mes dernières convs que ça a pas spécialement généré plus de
 * run.md ». Elles s'affichent désormais à deux endroits : le panneau RUN.md du fil, et un lien sur
 * chaque demande d'un post-it du Board.
 */
import type { StatutDemande } from './carte-des-besoins'

export interface FicheDeDemande {
  /** Chemin absolu du RUN.md, tel que `readNodeFile` l'ouvre. */
  chemin: string
  /** Le fil qui PORTE la fiche : un lot de chantier nourrit celle du fil qui l'a lancé. */
  conversationId: string
  /** Première ligne du besoin. */
  titre: string
  statut: StatutDemande
  /** Dernière écriture du RUN.md (ms epoch). */
  maj: number
  /** Nombre de demandes rangées dans cette fiche : la première et ses suites. */
  demandes: number
}

/** La fiche de chaque demande, par fil puis par identifiant de message : chemin absolu du RUN.md. */
export type FichesDesDemandes = Record<string, Record<string, string>>
