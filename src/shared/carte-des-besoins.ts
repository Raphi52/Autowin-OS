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
  /**
   * Le message ENTIER, sauts de ligne gardés, que la fiche du Board montre (conv-1278) ; absent quand
   * il ne dit rien de plus que `titre` (première ligne coupée à 120 caractères).
   */
  texte?: string
  statut: StatutDemande
  /** Le constat qui justifie l'état : « npm test → exit 0 », « tour arrêté avant la fin »… */
  constat: string
  /** Heure du message de l'utilisateur (ms epoch), quand le fil la connaît. */
  debut?: number
  /** Qui a prompté ; absent quand git n'a rendu aucune identité. */
  demandeur?: DemandeurDeLaCarte
  /** Ce que l'agent a déclaré (`AUTOWIN_BESOIN_V1`) ; absent avant le journal ou sans ligne lisible. */
  besoin?: BesoinDeLaCarte
  /**
   * Les numéros de work item que le TEXTE du prompt nomme : ceux que la vue Tickets écrit dans le
   * prompt d'un fil qu'elle ouvre, et les mentions `#1234` / `AB#1234`. Une mention n'est qu'un
   * candidat : elle ne devient un lien qu'après lecture de la fiche à la source (conv-1127).
   */
  references?: ReferenceDeLaDemande[]
  /** Les work items (tasks) liés à cette demande ; absent = « sans task » (conv-1127). */
  workItems?: WorkItemDeLaDemande[]
  /**
   * Le collègue dont vient cette demande (conv-1210, 2026-10-28) : posé par la VUE seulement, depuis
   * le Board qu'un autre poste a recopié dans le dossier du Board — jamais par le calcul de la
   * carte. Une telle demande se lit, elle ne se touche pas : ni glisser, ni vérifier, ni ouvrir.
   */
  collegue?: CollegueDeLaDemande
}

/** D'où vient une demande d'un collègue, et ce que son Board en montre (conv-1210). */
export interface CollegueDeLaDemande {
  /** Son sous-dossier dans le dossier du Board : son compte Windows. */
  poste: string
  /** Le nom écrit sur ses post-it. */
  nom: string
  /** L'étage où SON Board pose le post-it, état posé à la main compris. */
  etage: 'a-faire' | StatutDemande
  /** L'identifiant du fil dans l'Autowin du collègue (`conv-…`), à lui demander de rouvrir. */
  conversationId: string
  /** Les tasks que son Board lie à cette demande, lues telles quelles. */
  taches?: { sourceId: string; id: string; titre?: string }[]
}

/**
 * D'où vient le lien d'une demande vers un work item (conv-1127, 2026-10-23) :
 * `tickets` — le fil a été ouvert par la vue Tickets pour cette fiche, sûr par construction ;
 * `mention` — le prompt écrit `#1234`, et la fiche a été lue à la source avant de poser le lien ;
 * `manuel` — rattaché à la main depuis la fiche de la Carte du projet, lui aussi lu à la source.
 */
export type OrigineDuLienWorkItem = 'tickets' | 'mention' | 'manuel'

export interface ReferenceDeLaDemande {
  id: string
  /** Connu pour une référence écrite par la vue Tickets ; absent pour une mention. */
  sourceId?: string
  origine: 'tickets' | 'mention'
  /** Mention écrite `AB#1234` : la convention d'Azure Boards, donc une source Azure. */
  azure?: true
}

export interface WorkItemDeLaDemande {
  sourceId: string
  id: string
  /** Recopié de la fiche lue à la source ; absent tant qu'elle n'a pas été lue. */
  titre?: string
  type?: string
  origine: OrigineDuLienWorkItem
  /** Repris de la demande précédente du fil (ligne de besoin `suite`), pas posé sur celle-ci. */
  herite?: true
}

/**
 * La clé d'une demande dans son fil, la même pour la vue et le processus principal : l'id du
 * message, sinon son rang (fils anciens sans id de message). Seule fonction de ce fichier de types :
 * deux copies divergentes feraient viser une autre demande que celle cliquée (conv-1127).
 */
export function cleDeLaDemande(d: { messageId?: string; rang: number }): string {
  return d.messageId ?? `rang:${d.rang}`
}

/** Ce que rend un rattachement à la main : le lien posé, ou le motif du refus en clair. */
export type ResultatDuRattachement =
  { ok: true; workItem: WorkItemDeLaDemande } | { ok: false; raison: string }

/** Le bilan d'une passe de vérification des mentions `#1234` (lecture seule chez le fournisseur). */
export interface BilanDesMentions {
  /** Fiches pour lesquelles la source a RÉPONDU pendant la passe (trouvées ou introuvables). */
  lues: number
  /** Liens posés (mentions vérifiées). */
  liees: number
  /** Numéros que la source ne connaît pas : jamais posés comme liens. */
  introuvables: number
  /** Vrai si la source n'a pas répondu : la passe s'arrête, rien n'est posé, on réessaiera. */
  injoignable: boolean
  /** Fiches encore à lire, laissées à la passe suivante (plafond par passe). */
  restantes: number
}

/**
 * D'où vient le demandeur. `journal` : relevé dans git AU MOMENT du prompt. `git-du-dossier` : la
 * demande est antérieure au journal, l'identité est celle que git donne AUJOURD'HUI dans le dossier
 * du fil — une déduction, affichée comme telle. `poste` : le nom de ce poste sur le Board (choisi
 * dans les réglages, sinon le compte Windows), posé sur toutes ses demandes (conv-1230,
 * `board-nom-du-poste.ts`).
 */
export type OrigineDuDemandeur = 'journal' | 'git-du-dossier' | 'poste'

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
  /**
   * Durée de chaque étape (conv-1248) : voir dans l'app OÙ part le temps, sans la redémarrer avec
   * un chrono. La lecture des runs se recouvre avec les autres : la somme dépasse `dureeMs`.
   * Absente d'une carte écrite par une version plus ancienne (Board d'un collègue).
   */
  etapesMs?: EtapesDuCalcul
}

/** Millisecondes par étape du calcul de la carte (conv-1248). */
export interface EtapesDuCalcul {
  /** Relecture des fils (seuls ceux qui ont bougé sont recalculés). */
  fils: number
  /** Du lancement de la lecture des runs à son résultat, attente du disque comprise. */
  runs: number
  /** Identités git des dossiers (servies de leur mémoire, relues en fond). */
  identites: number
  /** `besoins.jsonl` relu. */
  journal: number
  /** `liens-work-items.jsonl` relu. */
  liens: number
  /** Projection finale : projets, demandes, demandeurs. */
  assemblage: number
}
