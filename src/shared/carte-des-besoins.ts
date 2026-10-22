/**
 * CARTE DES BESOINS — lot 1 (conv-1089, 2026-10-22).
 *
 * Demande : « entretenir une map des besoins et du projet avec les demandes, la date, la personne
 * émettrice, l'état en cours / terminé ». Le lot 1 ne crée AUCUNE donnée : il agrège ce que la
 * carte du fil (conv-1059) calcule déjà pour UN fil, sur TOUS les fils, rangés par projet comme la
 * barre latérale, avec les runs bloqués de chaque projet. Aucun appel de modèle.
 *
 * Lot 2 (même jour) : chaque demande porte QUI A PROMPTÉ — l'identité git (`user.name`,
 * `user.email`) du dossier du fil, relevée au tour par `besoins.jsonl` — et la ligne de besoin que
 * l'agent a déclarée (`AUTOWIN_BESOIN_V1`). Correction de l'utilisateur : « le requester, la source,
 * c'est qui a prompté, et base-toi sur le git ; les collaborateurs ne sont pas tous sur Outlook ».
 *
 * Types seuls : partagés par le calcul (processus principal), le pont et la vue.
 */

/** Les états d'une DEMANDE réelle — l'étape « à venir » de la carte du fil n'en est pas une. */
export type StatutDemande = 'prouve' | 'refuse' | 'en-cours' | 'sans-preuve'

/** Ordre d'affichage : ce qui réclame une action d'abord, ce qui est prouvé en dernier. */
export const STATUTS_DEMANDE: readonly StatutDemande[] = [
  'refuse',
  'en-cours',
  'sans-preuve',
  'prouve'
]

export interface DemandeDeLaCarte {
  conversationId: string
  conversationTitre: string
  /** Rang du message de l'utilisateur dans son fil. */
  rang: number
  messageId?: string
  titre: string
  statut: StatutDemande
  /** Le constat qui justifie l'état : « npm test → exit 0 », « tour arrêté avant la fin »… */
  constat: string
  /** Heure du message de l'utilisateur (ms epoch), quand le fil la connaît. */
  debut?: number
  /** Qui a prompté ; absent quand git n'a rendu aucune identité. */
  demandeur?: DemandeurDeLaCarte
  /** Ce que l'agent a déclaré (`AUTOWIN_BESOIN_V1`) ; absent avant le journal ou sans ligne lisible. */
  besoin?: BesoinDeLaCarte
}

/**
 * D'où vient le demandeur. `journal` : relevé dans git AU MOMENT du prompt. `git-du-dossier` : la
 * demande est antérieure au journal, l'identité est celle que git donne AUJOURD'HUI dans le dossier
 * du fil — une déduction, affichée comme telle.
 */
export type OrigineDuDemandeur = 'journal' | 'git-du-dossier'

export interface DemandeurDeLaCarte {
  /** Clé de regroupement : l'email en minuscules, sinon le nom — git distingue deux emails, nous aussi. */
  cle: string
  nom: string
  email?: string
  origine: OrigineDuDemandeur
}

export type NatureDuBesoinDeLaCarte = 'nouveau' | 'suite' | 'aucun'

export interface BesoinDeLaCarte {
  nature: NatureDuBesoinDeLaCarte
  /** `suite conv-NNN` : le fil dont la demande est reprise. */
  de?: string
}

/** Une personne qui a prompté, et le nombre de ses demandes sur la carte. */
export interface DemandeurAuCompte {
  cle: string
  nom: string
  email?: string
  demandes: number
}

export interface RunBloqueDeLaCarte {
  sujet: string
  /** Statut du RUN.md (`red`, `open`…). */
  statut: string
  chemin: string
  mtime: number
  conversationId?: string
  conversationTitre?: string
}

export type NatureDuProjet = 'dossier' | 'categorie' | 'divers' | 'kaizen'

export interface ProjetDeLaCarte {
  /** La clé de groupe de la barre latérale (`groupeDe`) : chemin, libellé, `divers`… */
  cle: string
  libelle: string
  nature: NatureDuProjet
  conversations: number
  /** Les plus récentes d'abord. */
  demandes: DemandeDeLaCarte[]
  runsBloques: RunBloqueDeLaCarte[]
  comptes: Record<StatutDemande, number>
  /** La demande ou le run le plus récent du projet. */
  derniereActivite?: number
}

export interface CarteDesBesoins {
  /** Le projet le plus récemment actif d'abord. */
  projets: ProjetDeLaCarte[]
  comptes: Record<StatutDemande, number>
  demandes: number
  runsBloques: number
  conversationsLues: number
  /** Les personnes qui ont prompté, la plus active d'abord. */
  demandeurs: DemandeurAuCompte[]
  /** Demandes dont le demandeur a été relevé au moment du prompt (le reste est déduit ou inconnu). */
  demandesJournalisees: number
  /**
   * RUN.md que le scan borné n'a PAS ouverts : présent, il dit que la liste des runs bloqués est
   * PARTIELLE — une liste courte n'y prouve pas l'absence d'autres blocages.
   */
  runsNonExamines?: number
  calculeeA: number
  /** Durée du calcul dans le processus principal, pour voir s'il devient trop lourd. */
  dureeMs: number
}
