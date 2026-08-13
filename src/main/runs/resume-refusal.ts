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
 * `run-worktree-coordinator.ts:290` et `worktree-manager.ts:3362` (apostrophe typographique
 * comprise), testable sans Electron.
 */

export type RefusDeReprise = 'publication-acquise' | 'copie-durable-absente'

export function classifierRefusDeReprise(message: string): RefusDeReprise | undefined {
  if (/Reprise du worktree refusée[^:]*: publication \S+ déjà engagée/.test(message)) {
    return 'publication-acquise'
  }
  // Les deux apostrophes acceptées : le message source porte U+2019, mais un transport peut la
  // normaliser en ASCII.
  if (/copie durable à reprendre n[’']existe plus/.test(message)) {
    return 'copie-durable-absente'
  }
  return undefined
}
