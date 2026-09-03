/**
 * TOUTE issue de finalisation non fusionnée DOIT porter une cause lisible.
 *
 * Défaut mesuré le 2026-08-31 (conv-1, run « reprend-pardon-mthg437j », 2,13 $) : le rapport rendu
 * à l'utilisateur portait `gateReasons: ["intégration locale non terminée"]` — un ÉTAT, aucune
 * CAUSE. Le run était vert, ses 16 fichiers existaient, et ils n'ont été retrouvés que par une
 * fouille manuelle des branches de secours. La lecture de l'issue rendait `undefined` dès que
 * `reason` manquait, et ce silence remontait intact jusqu'à l'utilisateur.
 *
 * La garde n'est donc pas déclarative : cette fonction est TOTALE et son retour n'est PAS
 * optionnel. Quelle que soit l'issue — absente, de forme inconnue, sans `reason` —, il en sort une
 * phrase qui nomme ce qu'on OBSERVE. Une finalisation muette devient impossible à représenter.
 */

/** Ce que l'orchestrateur sait lire d'une issue de finalisation, sans dépendre de sa forme exacte. */
export interface IssueDeFinalisation {
  outcome?: string
  reason?: string
  detail?: string
  files?: string[]
}

/** Au-delà, une sortie git entière rendrait le journal illisible. */
const CAUSE_MAX = 300

/**
 * LE CODE INTERNE NE SE DEVINE PAS — il vient avec son sens.
 *
 * Vécu le 2026-09-03 (conv-158, turnId `e0697674-fb4a-4f79-a6a0-565be7e07998`) : le tour a échoué
 * sur `blocage d’intégration: base-dirty — fichiers en cause: .arena/banc-noms/RUN.md, …`, et
 * l'appel suivant (même turnId, 05:44:26) a annoncé à l'utilisateur une cause FAUSSE — « la fusion
 * a été refusée … la branche de base a bougé pendant l'intégration ». La base n'avait pas bougé.
 * `base-dirty` était le seul mot disponible, et il ne dit rien à qui ne lit pas le code : le
 * lecteur a comblé le vide.
 *
 * Le sens existait déjà en clair, mais seulement dans la table d'AFFICHAGE
 * (`orchestration-outcome.ts`, `BLOCAGES`) — jamais dans la phrase remise au modèle. Il est
 * désormais dans la phrase elle-même. Un `detail` réel de git reste prioritaire : on n'écrase
 * jamais une cause observée par une traduction générique.
 */
const SENS_DU_CODE: Record<string, string> = {
  'base-dirty': 'des fichiers non committés de la base bloquent la publication',
  'base-in-progress': 'une opération git est déjà en cours dans la base',
  'merge-failed': 'la fusion dans la base a été refusée',
  'ignored-deliverables': 'la copie porte un fichier nommé un par un dans .gitignore'
}

export function raisonDeBlocageIntegration(finalized: unknown): string {
  if (typeof finalized !== 'object' || finalized === null) {
    return 'blocage d’intégration: aucune issue rendue par la finalisation'
  }
  const issue = finalized as IssueDeFinalisation
  const cause = (issue.detail ?? '').trim()
  const causePart = cause
    ? ` — cause: ${cause.length > CAUSE_MAX ? `${cause.slice(0, CAUSE_MAX - 3)}...` : cause}`
    : ''
  const fichiers = (issue.files ?? []).slice(0, 5)
  const filesPart = fichiers.length > 0 ? ` — fichiers en cause: ${fichiers.join(', ')}` : ''
  // `reason` nomme la CATÉGORIE (« merge-failed »), `detail` porte la CAUSE. Les deux remontent.
  if (issue.reason) {
    const sens = SENS_DU_CODE[issue.reason.trim()]
    const sensPart = !cause && sens ? ` — cause: ${sens}` : ''
    return `blocage d’intégration: ${issue.reason}${causePart}${sensPart}${filesPart}`
  }
  // Sans `reason`, on nomme au moins l'issue OBSERVÉE, et on AVOUE que la cause manque : c'est
  // exactement ce qui manquait au run vécu.
  const observee = (issue.outcome ?? '').trim()
  return observee
    ? `blocage d’intégration: issue « ${observee} » — aucune cause rendue par la finalisation${causePart}${filesPart}`
    : `blocage d’intégration: aucune cause NI issue rendue par la finalisation${causePart}${filesPart}`
}
