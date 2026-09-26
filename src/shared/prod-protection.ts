/**
 * CE QUE L'ÉCRAN DE RÉGLAGES DIT DE LA PROTECTION DE PRODUCTION.
 *
 * Partagé entre le processus principal et l'interface pour une raison de fond : c'est un état de
 * SÛRETÉ, et les deux côtés doivent en parler avec les mêmes mots. Une protection qui dort ne doit
 * jamais pouvoir s'afficher comme active parce qu'un champ aurait été renommé d'un seul côté.
 *
 * Rien ici ne touche au secret : ni sel, ni empreinte, ni longueur de la phrase.
 */

/**
 * LES TROIS NIVEAUX, du plus courant au plus strict.
 *
 * `confirmation` est le DÉFAUT et répond au besoin réel : toute requête sur une base de production
 * ouvre une fenêtre « voulez-vous continuer ? ». C'est un garde-fou contre le geste involontaire —
 * pas contre quelqu'un de mal intentionné assis au clavier.
 *
 * `phrase` va plus loin : il faut saisir la phrase de passe. À réserver aux postes partagés, ou le
 * jour où un outil d'ÉCRITURE existera.
 *
 * `aucun` désactive la protection. Il existe pour être CHOISI explicitement, jamais subi : l'absence
 * de réglage vaut `confirmation`, pas `aucun`.
 */
export type NiveauProtectionProd = 'aucun' | 'confirmation' | 'phrase'

export const NIVEAU_PROTECTION_PAR_DEFAUT: NiveauProtectionProd = 'confirmation'

export function estNiveauProtection(valeur: unknown): valeur is NiveauProtectionProd {
  return valeur === 'aucun' || valeur === 'confirmation' || valeur === 'phrase'
}

export interface EtatPorteProd {
  /** `true` dès que la protection arrête réellement quelque chose (niveau ≠ `aucun`). */
  active: boolean
  /** Le niveau en vigueur, tel qu'il est appliqué par le point de passage. */
  niveau: NiveauProtectionProd
  /** La même phrase d'explication que celle du point de passage, en clair. */
  raison: string
  /** `true` si une phrase de passe est enregistrée (indépendant du niveau choisi). */
  phraseDefinie: boolean
  /** Nombre de cibles déclarées dans la liste d'autorité. Zéro = tout est traité comme production. */
  declarees: number
  /** Lignes écartées de la liste de déclaration, avec leur motif. */
  anomalies: string[]
  /** Le fichier de déclaration, pour que l'utilisateur sache où écrire. */
  chemin: string
}
