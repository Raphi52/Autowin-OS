import { WorktreeManager } from './worktree-manager'

/**
 * LE PLAN D'UN BALAYAGE DE RETENTION — pur, sans aucun effet, testable seul.
 *
 * POURQUOI CE MODULE EXISTE, et pourquoi il ne supprime rien lui-meme. Un balayage automatique a
 * DEJA fait des degats sur ce depot : le 2026-08-24, la reprise automatique des travaux non publies
 * a tourne SANS PLAFOND, rejouant vingt-et-une copies impubliables et RECREANT 682 Mo a chaque
 * passage -- exactement les copies que le chantier devait supprimer. La lecon retenue ce jour-la
 * fut un plafond d'essais. Ici on va plus loin : la DECISION est separee de l'ACTE, et seul l'acte
 * a risque nul est autorise.
 */

export interface EntreeBalayage {
  /** Nom complet, tel qu'il sera passe a git. */
  nom: string
  /** `branche` ou la famille d'une ref `refs/autowin/<famille>/`. */
  famille: string
  apporteQuelqueChose: boolean
  shaConsigne: boolean
  ageMs?: number
}

export interface PlanDeBalayage {
  /** A supprimer VRAIMENT : contenu deja en base, aucune perte possible. */
  aSupprimer: EntreeBalayage[]
  /** A SIGNALER seulement : porteur mais perime. Une perte reelle -- l'humain tranche. */
  aSignaler: EntreeBalayage[]
  /** Combien ont depasse le plafond de ce passage, et attendront le suivant. */
  reportees: number
}

/**
 * LE PLAFOND PAR PASSAGE. Un balayage qui traite tout d'un coup est un balayage dont on ne peut pas
 * observer l'effet avant qu'il soit consomme. Vingt suffit a resorber un stock en quelques
 * passages (mesure du 2026-09-08 : 21 refs et 14 branches designees sur un stock de 296 objets)
 * tout en laissant une trace lisible entre deux passages.
 */
export const PLAFOND_PAR_PASSAGE = 20

/**
 * Traduit un etat en PLAN, sans rien toucher.
 *
 * CE QUI N'EST JAMAIS SUPPRIME AUTOMATIQUEMENT, et c'est le coeur de ce module :
 *  - le verdict `garder`, evidemment ;
 *  - le verdict `supprimable-perime` : la branche PORTE du travail, seul l'age la condamne. Une
 *    suppression automatique y ferait perdre du code que personne n'a lu. Elle est SIGNALEE.
 * Seul `supprimable-sans-perte` est agi : son contenu est deja en base, le detruire ne peut rien
 * couter. C'est la seule categorie dont on a prouve le 2026-09-08, sur 27 objets reels, qu'elle ne
 * contenait aucun travail recuperable.
 */
export function planifierBalayage(entrees: readonly EntreeBalayage[]): PlanDeBalayage {
  const aSupprimer: EntreeBalayage[] = []
  const aSignaler: EntreeBalayage[] = []
  let reportees = 0

  for (const e of entrees) {
    const verdict =
      e.famille === 'branche'
        ? WorktreeManager.decisionRetentionBranche(e)
        : WorktreeManager.decisionRetentionRefAutowin(e)
    if (verdict === 'supprimable-sans-perte') {
      if (aSupprimer.length < PLAFOND_PAR_PASSAGE) aSupprimer.push(e)
      else reportees += 1
    } else if (verdict === 'supprimable-perime') {
      aSignaler.push(e)
    }
  }

  return { aSupprimer, aSignaler, reportees }
}
