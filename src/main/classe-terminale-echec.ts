import { isUpstreamOutage } from '../shared/panne-amont'
import { estMurDeQuota } from '../shared/reprise-quota'
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

export function classeTerminaleDEchec(erreur: unknown, annule: boolean): 'external' | 'defect' {
  if (annule) return 'external'
  const message = erreur instanceof Error ? erreur.message : String(erreur ?? '')
  if (!message.trim()) return 'defect'
  if (estMurDeQuota(message)) return 'external'
  if (isUpstreamOutage(message, '')) return 'external'
  if (isExpiredAuth(message) || FOURNISSEUR_NON_CONNECTE.test(message)) return 'external'
  return 'defect'
}
