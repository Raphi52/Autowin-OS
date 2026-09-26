/**
 * Règle UNIQUE du « run bloqué », partagée entre le processus principal et l'interface.
 *
 * Elle vivait dans `src/main/dashboards/runs.ts`, et le rail d'Observatory l'importait DEPUIS le
 * main (`ObservatoryRail.tsx` → `../../../main/dashboards/runs`) : une traversée de frontière que le
 * reste de la vue évite justement. Déplacée ici, la définition reste unique — aucune seconde règle
 * locale — sans que l'interface aille lire du code du processus principal.
 */

/**
 * True si le run est BLOQUÉ, c'est-à-dire ni clos ni concluant.
 *
 * Bloquent : `open`, `red`, et le vocabulaire FOSSILE `pending`/`running`/`failed` — plus aucun
 * code ne les écrit, mais 109 RUN.md historiques les portent (mesuré le 2026-08-18) et un run figé
 * sur `running` depuis des semaines n'est pas « en cours », c'est un abandon.
 * Ne bloquent pas, à DoD complète : `green`, `degraded-closed` et `succeeded` — ce dernier est un
 * fossile de SUCCÈS, il hérite donc du traitement de `green`, condition de DoD comprise.
 * Une DoD incomplète bloque quel que soit le statut : c'est la règle, sans exception par statut.
 * Un statut illisible (`unknown`) bloque également : un RUN.md corrompu doit rester visible.
 */
export function isBlocked(s: { status: string; dodTotal: number; dodChecked: number }): boolean {
  return (
    ['pending', 'running', 'open', 'failed', 'red', 'unknown'].includes(s.status) ||
    s.dodChecked < s.dodTotal
  )
}
