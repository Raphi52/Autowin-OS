/**
 * LA fenêtre au-delà de laquelle une reprise automatique n'en est plus une.
 *
 * Deux mécanismes rouvrent quelque chose au démarrage, et tous deux visaient le plus RÉCENT sans
 * jamais regarder son ÂGE : les checkpoints d'orchestration (`runs/orchestration-state.ts`, côté
 * main) et les tours de chat inachevés (`resume-unfinished.ts`, côté renderer).
 *
 * Défaut vécu le 2026-08-18 : la conversation du 17/08 « Arrêt inattendu du processus Autowin OS »
 * se rouvrait à CHAQUE démarrage. `unfinishedTurns()` la plaçait en tête — deux tours interrompus
 * la veille, un événement chacun, vestiges d'un processus tué avant leur clôture (le défaut
 * `electron-vite --watch`, corrigé depuis) — et la reprise d'un tour inachevé est PRIORITAIRE sur
 * la mémoire de la dernière conversation ouverte. L'utilisateur retombait donc indéfiniment sur un
 * vestige plutôt que sur son travail.
 *
 * La reprise existe pour rendre ce que l'utilisateur regardait quand l'app est tombée. Passé une
 * journée et demie, elle ne rend plus rien : elle hante.
 *
 * 36 h couvre une nuit, un week-end court ou une machine laissée éteinte ; c'est assez étroit pour
 * qu'un vestige ne décide pas ce qu'on voit des jours plus tard. Vit dans `shared/` parce que les
 * DEUX côtés l'appliquent : deux fenêtres qui divergent, c'est un mécanisme qui oublie et l'autre
 * qui se souvient, pour le même démarrage.
 */
export const RESUME_STALE_AFTER_MS = 36 * 60 * 60 * 1000

/**
 * Un instant daté est-il trop vieux pour justifier une reprise ?
 *
 * `nowMs` est un PARAMÈTRE partout : un module qui lit l'horloge en cachette n'est plus testable, et
 * l'appelant sait mieux que lui s'il évalue « maintenant » ou un instant rejoué.
 */
export function resumeIsStale(updatedAt: number, nowMs: number): boolean {
  return nowMs - updatedAt > RESUME_STALE_AFTER_MS
}
