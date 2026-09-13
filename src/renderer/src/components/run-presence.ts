/**
 * Ce que l'OS doit montrer des runs VIVANTS — extrait de l'état que la fenêtre tient déjà.
 *
 * La fenêtre est le seul endroit où vit la liste des runs en cours (`liveRuns` dans `ChatView`).
 * Cette fonction PURE la réduit à trois nombres, envoyés au process principal qui pose la jauge de
 * barre des tâches et le texte de l'icône de notification (`src/shared/os-presence.ts`).
 *
 * Le nombre TOTAL d'étapes d'un run n'est connu de personne (le plan varie selon le workflow) : on
 * rend donc `etapesTotales: 0`, ce qui fait choisir une jauge « en cours » plutôt qu'un pourcentage
 * inventé.
 */
import type { EtatRunsVivants } from '../../../shared/os-presence'

type RunVivantMinimal = { status: 'running' | 'green' | 'red'; steps: unknown[] }

export function presenceDepuisRunsVivants(
  runs: Record<string, RunVivantMinimal | undefined>
): EtatRunsVivants {
  const actifs = Object.values(runs).filter((r): r is RunVivantMinimal => r?.status === 'running')
  return {
    runsActifs: actifs.length,
    etapesFaites: actifs.reduce((total, r) => total + (r.steps?.length ?? 0), 0),
    etapesTotales: 0
  }
}
