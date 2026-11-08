import { objectionsDuJuge } from '../juge/objections-juge'

/**
 * OBJECTION D'ÉTENDUE RÉPÉTÉE EN MODE JUSQU'AU VERT → LE MODÈLE TRANCHE, SANS PAUSE.
 *
 * Mesure (run-ec2036c0932d-1, `activity/conv-1146.jsonl`) : le juge a refusé quatre
 * fois de suite « Ta demande n'est pas remplie. Tu as écrit « full anglais » », et chaque refus
 * relançait une réparation qui traduisait de nouveaux écrans (réparations 4, 8 et 11 : 33 $, 22 $,
 * 16 $), sans que personne ne décide s'il fallait tout livrer ou livrer par étapes.
 *
 * Le run se mettait alors en pause et ouvrait une fenêtre de question. L'utilisateur n'en veut pas
 * (2026-11-08 : « je veux pas de popup comme ça ; si le modèle est bloqué, on fait une phrase de prise
 * de décision, peut-être un scout si nécessaire »), et une fenêtre fermée sans réponse ARRÊTAIT le
 * run pour de bon. Désormais la réparation suivante reçoit l'ordre de trancher elle-même, par une
 * phrase `Décision :` lisible dans sa sortie, avec un inventaire en lecture seule d'abord si elle ne
 * sait pas ce qui reste.
 *
 * Le coût reste borné sans l'utilisateur : la décision ne remet PAS à zéro le frein du refus
 * répété (`arretDeLaReparation`, stopgate.ts), qui mord jusqu'au vert. Si la même objection revient
 * encore après la décision, la boucle s'arrête et le dit.
 *
 * PUR : ce module décide et met en forme ; la boucle (`orchestrator-parcours-sequentiel.ts`) pousse
 * la consigne et la ligne de trace.
 */

/**
 * Ajouté au prompt du juge du PIPELINE seulement (`orchestrator.ts`), comme
 * `CONTRAT_QUESTIONS_AU_BUILD` : la consigne de `phase-briefs.ts` est plafonnée à 3 000 caractères,
 * et seule la boucle de réparation du pipeline relit ce préfixe.
 */
export const CONTRAT_ETENDUE =
  "Une objection MAJEUR ou MINEUR qui dit qu'une PARTIE de la demande n'est pas faite (son étendue, pas un défaut de ce qui est livré) commence par « ÉTENDUE — »."

const PREFIXE_ETENDUE = /^\**\s*[ÉE]TENDUE\b/i

/** La première objection BLOQUANTE du verdict marquée « ÉTENDUE », ou `undefined`. */
export function objectionDEtendue(texteDuJuge: string): string | undefined {
  return objectionsDuJuge(texteDuJuge ?? '').find((objection) => PREFIXE_ETENDUE.test(objection))
}

/**
 * Deux verdicts du juge D'AFFILÉE portent une objection d'étendue : la même lacune revient, la
 * réparation ne la comble pas d'elle-même. Hors jusqu'au vert, la boucle a déjà ses arrêts. Une seule
 * décision par run : elle vaut pour la suite.
 */
export function doitTrancherLEtendue(etat: {
  jusquAuVert: boolean
  dejaTranchee: boolean
  courante?: string
  precedente?: string
}): boolean {
  return etat.jusquAuVert && !etat.dejaTranchee && Boolean(etat.courante && etat.precedente)
}

/** Ce que la réparation suivante lit : trancher elle-même, jamais attendre une réponse. */
export function consigneDeDecisionDEtendue(objection: string): string {
  return (
    `DÉCISION À PRENDRE TOI-MÊME — le juge refuse deux fois de suite pour l'étendue de la demande : « ${objection} ». ` +
    'Personne ne répondra à une question pendant ce travail : ne la pose pas, tranche. ' +
    'Écris en PREMIÈRE ligne de ta réponse `Décision : <ce que ce passage couvre, ce qu’il laisse, et pourquoi>`. ' +
    'Couvre toute la demande si ce passage le peut ; sinon le lot le plus utile, et nomme ce qui reste dans ton bilan. ' +
    "Si tu ne sais pas ce qui reste à couvrir, fais d'abord un inventaire en lecture seule (liste ce qui manque) avant de modifier quoi que ce soit."
  )
}

/** La ligne de trace : la décision est confiée au modèle, sans pause ni fenêtre. */
export function ligneDeDecisionDEtendue(objection: string): string {
  return `Le juge refuse deux fois de suite pour l'étendue de la demande (« ${objection.slice(0, 200)} ») : pas de pause, la réparation suivante tranche elle-même et écrit sa décision.`
}
