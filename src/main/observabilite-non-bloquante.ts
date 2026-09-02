/**
 * L'OBSERVABILITE NE CASSE JAMAIS LE TOUR.
 *
 * Exigence posee par l'utilisateur le 2026-09-02 : « les gels de l'interface ne doivent pas casser
 * les tours ». Le lien mesure entre les deux : pendant un gel, l'ecriture de la trace causale
 * s'appuie sur un verrou de sequence (`withSequenceLock`, src/main/activity/trace-store.ts) qui
 * JETTE au dela de son budget d'acquisition (« allocation de sequence verrouillee trop longtemps »).
 * Or les rappels d'observabilite du pipeline etaient invoques a nu (`onStep?.(s)`, `onPhase?.(p)`) :
 * ce jet remontait dans l'orchestrateur et tuait le RUN entier. Une trace non ecrite devenait donc
 * un tour perdu.
 *
 * `onRunLifecycle` etait DEJA protege de cette facon dans `orchestrator.ts` ; ce module ne fait
 * qu'etendre le meme contrat aux autres rappels, au SEUL endroit ou ils entrent dans le pipeline.
 *
 * Ce n'est pas un catch avale : l'echec est signale a `onErreur` (journalise par l'appelant), il
 * cesse seulement d'etre FATAL pour un travail qui, lui, a reussi.
 */
export function protegerRappel<A extends unknown[]>(
  nom: string,
  rappel: ((...args: A) => void) | undefined,
  onErreur: (nom: string, erreur: unknown) => void = (n, e) =>
    console.warn(`[observabilite] ${n} a echoue sans casser le tour :`, e)
): ((...args: A) => void) | undefined {
  if (!rappel) return undefined
  return (...args: A): void => {
    try {
      rappel(...args)
    } catch (erreur) {
      try {
        onErreur(nom, erreur)
      } catch {
        /* le signalement de l'echec ne peut pas casser le tour non plus */
      }
    }
  }
}
