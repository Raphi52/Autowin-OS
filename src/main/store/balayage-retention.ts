import { WorktreeManager } from './worktree-manager'
import type { RapportRetention } from '../../shared/rapport-retention'

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

/** Ce que la passe emprunte a l'app, injecte pour la jouer sans Electron ni depot reel. */
export interface DependancesPasseRetention {
  recenser: () => Promise<EntreeBalayage[]>
  poserRapport: (rapport: RapportRetention) => void
  journal?: Pick<Console, 'info' | 'warn'>
}

/** UNE passe de retention : recenser, planifier, deposer le rapport. Appelee par `index.ts`. */
export async function jouerPasseDeRetention(deps: DependancesPasseRetention): Promise<void> {
  const journal = deps.journal ?? console
  let entrees: EntreeBalayage[]
  try {
    entrees = await deps.recenser()
  } catch (erreur) {
    /*
     * GERE, PAS AVALE (crash.log, 2026-10-28 18:28:45Z) : le recensement passe par la file
     * d'operations git, plafonnee a 5 min ; un depassement rejetait la promesse et, lancee en
     * `void` depuis le minuteur, elle finissait en « unhandledRejection ». On ne fabrique pas de
     * rapport sur un recensement absent : le precedent reste affiche avec sa date, la passe
     * suivante (une heure) reessaie, et l'echec est ecrit ici avec sa cause.
     */
    const cause = erreur instanceof Error ? erreur.message : String(erreur)
    journal.warn(`[retention] passe abandonnee, aucun nouveau rapport : ${cause}`)
    return
  }
  const plan = planifierBalayage(entrees)
  /*
   * ON DEPOSE LE RAPPORT AVANT DE SORTIR, y compris quand il est VIDE. Un plan vide n'est pas
   * un non-evenement : il affirme que le stock est sain, ce que « rien affiche » ne dit pas.
   * L'interface distingue « jamais balaye » de « balaye, rien a signaler ».
   */
  deps.poserRapport({
    faitLe: new Date().toISOString(),
    examines: entrees.length,
    sansPerte: plan.aSupprimer.map((e) => e.nom),
    aTrancher: plan.aSignaler.map((e) => e.nom),
    reportees: plan.reportees
  })
  if (plan.aSupprimer.length === 0 && plan.aSignaler.length === 0) return
  journal.info(
    `[retention] ${plan.aSupprimer.length} sans perte, ${plan.aSignaler.length} perimes a trancher` +
      (plan.reportees > 0 ? `, ${plan.reportees} reportes` : '') +
      ' — AUCUNE suppression automatique.'
  )
}
