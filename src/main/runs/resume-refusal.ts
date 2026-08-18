/**
 * Classement des REFUS DÉFINITIFS de reprise au démarrage.
 *
 * Mesuré le 2026-08-13 sur deux boots consécutifs : le catch de `relaunchResumableRun` marquait le
 * tour `failed` mais LAISSAIT le checkpoint — le même run zombie rejouait donc sa reprise (et son
 * échec) à CHAQUE démarrage :
 *  - run-5f5a75a0208d-1 : « publication complete déjà engagée » — le run a RÉUSSI, sa publication
 *    Git est acquise ; le rejouer en rouge transforme un succès en échec répété. Le filtre d'entrée
 *    (`publishedWorktreeProofForResume`) le rate quand l'inventaire worktree ne porte plus la
 *    preuve : le coordinateur, lui, la connaît — c'est SON refus qu'on classe ici.
 *  - « La copie durable à reprendre n'existe plus » — la reprise ne pourra JAMAIS aboutir ;
 *    l'échec doit se conclure une fois, checkpoint retiré, pas se répéter en silence.
 *
 * Module PUR : il classe les messages EXACTEMENT tels que les jettent
 * `run-worktree-coordinator.ts:291` et `worktree-manager.ts:3362` (apostrophe typographique
 * comprise), testable sans Electron.
 */

export type RefusDeReprise =
  | 'publication-acquise'
  | 'copie-durable-absente'
  | 'contexte-de-reprise-invalide'

/**
 * Les 5 `detail` DÉFINITIFS de `validateRecoveryContext` (`worktree-manager.ts:3422-3444`),
 * atteints via `run-worktree-coordinator.ts:385` et `:502` sous la forme
 * « Reprise du worktree refusée : <detail> ».
 *
 * DÉCISION — le 6e `detail` (`worktree-manager.ts:3418`) est VOLONTAIREMENT EXCLU. Celui-là
 * n'est pas un littéral : il ré-emballe le message d'une erreur arbitraire attrapée
 * (`error instanceof Error ? error.message : String(error)`). Un tel message peut décrire une
 * condition TRANSITOIRE (un `index.lock` git, un verrou, un disque momentanément indisponible) ;
 * le classer « définitif » ferait oublier le checkpoint d'un run parfaitement reprenable — on
 * tuerait un run récupérable pour économiser un rejeu. C'est exactement le cas que la péremption
 * générique (36 h) doit ramasser, pas ce classificateur.
 */
const DETAILS_DEFINITIFS = [
  'Le contexte durable ne correspond pas à ce dépôt.',
  'Le SHA de départ durable est invalide.',
  'Le SHA source durable est invalide ou indisponible.',
  'La branche ou le SHA durable n’existe plus dans ce dépôt.',
  'Le SHA durable n’appartient plus à la branche capturée.'
] as const

/** Apostrophe typographique ↔ ASCII : un transport peut normaliser l'une en l'autre. */
function normaliserApostrophes(texte: string): string {
  return texte.replace(/[’']/g, "'")
}

export function classifierRefusDeReprise(message: string): RefusDeReprise | undefined {
  if (/Reprise du worktree refusée[^:]*: publication \S+ déjà engagée/.test(message)) {
    return 'publication-acquise'
  }
  // Les deux apostrophes acceptées : le message source porte U+2019, mais un transport peut la
  // normaliser en ASCII.
  if (/copie durable à reprendre n[’']existe plus/.test(message)) {
    return 'copie-durable-absente'
  }
  // Même cause, AUTRE phrase : `run-worktree-coordinator.ts:272` refuse quand la copie durable
  // suivie est absente ou incomplète. La reprise ne pourra jamais aboutir non plus.
  if (/Reprise du worktree impossible pour .+ : copie durable absente ou incomplète/.test(message)) {
    return 'copie-durable-absente'
  }
  const normalise = normaliserApostrophes(message)
  for (const detail of DETAILS_DEFINITIFS) {
    if (normalise.includes(normaliserApostrophes(detail))) {
      return 'contexte-de-reprise-invalide'
    }
  }
  return undefined
}
