import { isUpstreamOutage } from '../shared/panne-amont'
import { estMurDeQuota } from '../shared/reprise-quota'
import type { RunInterruption } from '../shared/run-execution'
import { isExpiredAuth } from './task-manager/watchdog-suppression'

/**
 * UN ÉCHEC D'ORCHESTRATION DIT-IL QUELQUE CHOSE DU CODE — OU SEULEMENT DE L'ABONNEMENT ?
 *
 * Mesuré le 2026-10-13 (`outcome-learning/events-v1.jsonl`, 09:17) : deux runs arrêtés par
 * « You've hit your session limit · resets 1pm » ont été observés `failed` / `defect`. Or
 * `outcome-learning-policy.ts` n'accepte une leçon d'échec publiable que pour la classe `defect` :
 * seule `external` l'envoie en revue humaine. Une panne d'abonnement pouvait donc devenir une
 * « leçon » sur le code. Les deux sites d'observation (`commands.ts`, `index.ts`) ne regardaient
 * que l'annulation.
 *
 * `external` = la cause est HORS du travail jugé :
 * - l'annulation (l'utilisateur ou l'app a coupé le run) — l'historique, inchangé ;
 * - le mur de quota d'abonnement (`estMurDeQuota`, vocabulaire partagé avec le disjoncteur) ;
 * - une panne du fournisseur (`isUpstreamOutage`, LA définition partagée de « c'est en face ») ;
 * - une session d'authentification expirée (`isExpiredAuth`, celle des chiens de garde), ou le
 *   refus d'Autowin quand un fournisseur n'est pas connecté (« codex non authentifié — lance … »).
 *
 * Tout le reste reste `defect` : un classement trop large ferait taire de vrais défauts. Les
 * détecteurs de REJEU (`isTransientOverload`, `classifyProviderFailure`) ne sont donc PAS repris :
 * un faux positif n'y coûte qu'un appel, ici il coûte une leçon perdue. Relevé par les revues du
 * 2026-10-14 : leur `401` / `503` sans contexte prend « conv-1401 » ou `runs/conv-503/…` pour une
 * panne, « surcharg » attrape une « surcharge de style », « non authentifi » le nom d'un test.
 */
const FOURNISSEUR_NON_CONNECTE = /\bnon authentifi[ée] — lance npm run \S+:login\b/i

/** Le vocabulaire historique du contrôle final (ex-ternaire en ligne de `commands.ts`). */
const RAISON_HORS_DU_TRAVAIL = /quota|rate.?limit|annul|cancel|canary|flaky|timeout|provider/iu
/**
 * Le run était VERT, mais la base portait le travail non commité d'un autre (`base-dirty`) ou une
 * fusion en cours (`base-in-progress`). Le contrôle final n'écrit ces raisons qu'après un vert
 * (`orchestrator.ts`, garde `green && !integrated`). `merge-failed` (un conflit) reste un défaut.
 */
const INTEGRATION_BLOQUEE_PAR_LA_BASE = /\bbase-(?:dirty|in-progress)\b/u

/**
 * LA CLASSE D'UN RUN ALLÉ AU BOUT MAIS REFUSÉ PAR LE CONTRÔLE FINAL (piste 1, conv-1033). La mémoire
 * du scout relit cette classe pour dire ce que sont devenues les pistes prises : un run vert bloqué
 * par la base y passait pour un échec de la piste (conv-981, 2026-10-16). Le refus du contrôle des
 * causes reste `defect` : il porte sur la preuve du travail lui-même.
 */
export function classeTerminaleDuControle(raisons: readonly string[]): 'external' | 'defect' {
  return raisons.some(
    (raison) => RAISON_HORS_DU_TRAVAIL.test(raison) || INTEGRATION_BLOQUEE_PAR_LA_BASE.test(raison)
  )
    ? 'external'
    : 'defect'
}

export function classeTerminaleDEchec(erreur: unknown, annule: boolean): 'external' | 'defect' {
  if (annule) return 'external'
  const message = erreur instanceof Error ? erreur.message : String(erreur ?? '')
  if (!message.trim()) return 'defect'
  if (estMurDeQuota(message)) return 'external'
  if (isUpstreamOutage(message, '')) return 'external'
  if (isExpiredAuth(message) || FOURNISSEUR_NON_CONNECTE.test(message)) return 'external'
  return 'defect'
}

/**
 * POURQUOI CE RUN S'EST-IL ARRÊTÉ, QUAND CE N'EST PAS LA FAUTE DU TRAVAIL (piste 4, conv-1070).
 *
 * `classeTerminaleDEchec` ne servait qu'à la mémoire d'apprentissage : le RUN.md, lui, recevait
 * `red` dans tous les cas, et `isBlocked` gardait ainsi « bloqués » pour toujours des runs coupés
 * par le bouton Stop ou par la limite de session (mesuré le 2026-10-22 : 8 runs, dont
 * `judge-carnet-fil`, conv-1058, coupé par Stop). Cette cause nommée est ce qui écrit
 * `status: interrupted` à la place, et ce que la vue Workflows retire de ses taux.
 *
 * MÊME règle que `classe external`, sans une de plus : `undefined` ⇔ `defect`. Un run allé au
 * bout puis refusé (aucune exception, aucun arrêt) n'est jamais une interruption.
 *
 * fix-ok: conv-1070 — cause lue dans le code puis mesurée : `commands.ts` écrivait `closeConvRun(…, 'red')` sans condition et l'orchestrateur émettait sa clôture terminale sans cause ; le test « mur de quota → red, interruption quota » (orchestrator.mur-de-quota.test.ts) était rouge avant ce module, vert après.
 */
export function causeDInterruption(erreur: unknown, annule: boolean): RunInterruption | undefined {
  if (annule) return 'arret'
  if (erreur === undefined || erreur === null) return undefined
  if (classeTerminaleDEchec(erreur, false) !== 'external') return undefined
  const message = erreur instanceof Error ? erreur.message : String(erreur)
  return estMurDeQuota(message) ? 'quota' : 'externe'
}
