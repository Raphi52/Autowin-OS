/**
 * Règle UNIQUE du « run bloqué », partagée entre le processus principal et l'interface.
 *
 * Elle vivait dans `src/main/dashboards/runs.ts`, et le rail d'Observatory l'importait DEPUIS le
 * main (`ObservatoryRail.tsx` → `../../../main/dashboards/runs`) : une traversée de frontière que le
 * reste de la vue évite justement. Déplacée ici, la définition reste unique — aucune seconde règle
 * locale — sans que l'interface aille lire du code du processus principal.
 */

/** Un run rouge COUPÉ — par le bouton Stop du chat, ou par le quota de l'abonnement — et non raté. */
export type RunInterruption = 'stop' | 'quota'

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
 *
 * Un run `red` COUPÉ (`interruption`, lue dans sa clôture par `parseRun`) ne bloque pas, DoD
 * incomplète comprise : arrêté par le Stop, il est annulé ; coupé par le quota, il est suspendu.
 * Aucun des deux ne dit que le travail a échoué — les compter ici remplissait la liste servie à
 * chaque tour de runs sans rien à réparer (15 entrées le 2026-10-22, conv-1069).
 */
export function isBlocked(s: {
  status: string
  dodTotal: number
  dodChecked: number
  interruption?: RunInterruption
}): boolean {
  // INTERROMPU (piste 4, conv-1070) : coupé par Stop, la limite de session ou une panne en face.
  // Seule exception à la règle de DoD, et elle est forcée : un run arrêté avant sa fin a TOUJOURS
  // une DoD incomplète, donc le garder « bloqué » à ce titre le bloquait pour toujours. Il n'a pas
  // échoué ; l'interface le montre comme reprenable, à part des runs bloqués.
  if (s.status === 'interrupted') return false
  // Même cas pour un RUN.md écrit AVANT `status: interrupted` (d7d3765c) : il porte `red`, et
  // seule sa ligne de clôture dit qu'il a été coupé (conv-1069 : 10 Stop et 29 quotas sur le poste).
  if (s.status === 'red' && s.interruption) return false
  return (
    ['pending', 'running', 'open', 'failed', 'red', 'unknown'].includes(s.status) ||
    s.dodChecked < s.dodTotal
  )
}

/**
 * Run à traiter dont la suite appartient à l'utilisateur : il ne se débloque pas, il attend sa
 * réponse. conv-1199 s'affichait « green · bloqué » pour une publication que lui seul pouvait
 * décider (scout conv-1332).
 *
 * `isBlocked` reste vrai pour ce run, et c'est voulu : une question écrite dans un bilan ne doit
 * pas suffire à faire sortir un run de la liste à traiter. Les écrans qui montrent une PANNE (compteur
 * « bloqués », liseré rouge, « Débloque ») l'en retirent avec cette règle, pas avec une copie locale.
 */
export function attendUneDecision(s: {
  status: string
  dodTotal: number
  dodChecked: number
  interruption?: RunInterruption
  decisionAttendue?: boolean
}): boolean {
  return s.decisionAttendue === true && isBlocked(s)
}

/**
 * La mention écrite à côté du statut d'un run (rail de l'Observatoire). Un run INTERROMPU n'est
 * pas bloqué : on peut le relancer, et la limite de session le reprend seule (piste 4, conv-1070).
 */
export function mentionDEtatDuRun(s: {
  status: string
  dodTotal: number
  dodChecked: number
  interruption?: RunInterruption
  decisionAttendue?: boolean
}): string {
  if (s.status === 'interrupted' || (s.status === 'red' && s.interruption))
    return 'interrompu, relançable'
  if (attendUneDecision(s)) return 'en attente de votre décision'
  return isBlocked(s) ? 'bloqué' : ''
}
