import type { HarnessTimelineEvent } from './harness-timeline-model'
import { langueCourante } from '../langue'
import { traduireObservatory, type CleObservatory } from '../textes-ecrans/observatory'

/**
 * Filtres rapides de la chronologie Observatory — extraits d'`ObservatoryView.tsx` le 2026-08-07.
 *
 * Aucune dependance a React : ces deux exports sont des donnees et une fonction pure, et n'avaient
 * rien a faire dans un composant de 1492 lignes ou ils n'etaient verifiables qu'en montant le DOM.
 */
export type QuickFilter =
  | 'all'
  | 'errors'
  | 'tools'
  | 'prompt'
  | 'agents'
  /** Controles qualite : aucun filtre rapide ne les couvrait, alors qu'ils decident d'un run. */
  | 'controls'
  /** Livrables produits par le modele — traçables depuis l'ajout du type d'evenement `artifact`. */
  | 'artifacts'

/**
 * Le libellé se lit à l'affichage (accesseur) : il suit la langue courante sans que la liste soit
 * reconstruite (conv-1170). « Prompt / RAG » et « Artefacts » se disent pareil en anglais.
 */
function filtre(value: QuickFilter, cle: CleObservatory): { value: QuickFilter; label: string } {
  return {
    value,
    get label() {
      return traduireObservatory(cle, langueCourante())
    }
  }
}

export const QUICK_FILTERS: Array<{ value: QuickFilter; label: string }> = [
  filtre('errors', 'filtres.erreurs'),
  filtre('tools', 'filtres.outils'),
  { value: 'prompt', label: 'Prompt / RAG' },
  filtre('agents', 'filtres.sousAgents'),
  filtre('controls', 'filtres.controles'),
  { value: 'artifacts', label: 'Artefacts' }
]

const GENRES_PAR_FILTRE: Record<
  Exclude<QuickFilter, 'all'>,
  ReadonlyArray<HarnessTimelineEvent['kind']>
> = {
  errors: ['error', 'retry', 'cancellation'],
  tools: ['tool-call', 'tool-result'],
  prompt: ['injection', 'boundary'],
  agents: ['handoff', 'verdict'],
  controls: ['gate', 'decision'],
  artifacts: ['artifact']
}

/**
 * Un evenement passe-t-il le filtre rapide actif ?
 *
 * Table explicite plutot qu'une chaine de `if` terminee par un `return` fourre-tout : ce `return`
 * final faisait tomber N'IMPORTE QUEL filtre inconnu dans la branche « sous-agents », de sorte qu'un
 * filtre nouveau ou mal orthographie renvoyait silencieusement les resultats d'un AUTRE filtre. Un
 * faux resultat credible est plus couteux qu'un filtre vide.
 */
export function matchesQuickFilter(event: HarnessTimelineEvent, filter: QuickFilter): boolean {
  if (filter === 'all') return true
  return GENRES_PAR_FILTRE[filter as Exclude<QuickFilter, 'all'>]?.includes(event.kind) ?? false
}
