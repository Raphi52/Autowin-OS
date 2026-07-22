/**
 * Classification de RÉGIME d'une tâche → sous-ensemble de phases du pipeline (proportionnalité).
 *
 * Aujourd'hui l'orchestrateur joue les 5 phases (scout→frame→terrain→build→clean) + juge pour TOUTE
 * tâche, même triviale — coût et latence inutiles. Ce module applique la proportionnalité du kit :
 * une tâche triviale ne mérite pas un pipeline complet.
 *
 * HEURISTIQUE DÉTERMINISTE (pas d'appel modèle) : coût nul, testable sans réseau, générique tous
 * modèles. En cas de DOUTE on remonte au régime supérieur (conservateur) — jamais sous-traiter une
 * tâche complexe. Le sous-ensemble de phases est volontairement prudent : on ne coupe que ce qui est
 * clairement superflu pour le régime.
 */
import type { PipelinePhase } from './skill-pipeline'

export type TaskRegime = 'trivial' | 'standard' | 'critical'

/** Phases jouées par régime. Le juge reste TOUJOURS actif (hors de cette liste, ajouté par l'orchestrateur). */
const REGIME_PHASES: Record<TaskRegime, PipelinePhase[]> = {
  trivial: ['build'],
  standard: ['frame', 'build'],
  critical: ['scout', 'frame', 'terrain', 'build', 'clean']
}

/** Signaux de COMPLEXITÉ (→ critical) : architecture, transverse, risque, irréversible. */
const CRITICAL_SIGNALS =
  /\b(architect\w*|refactor\w*|migrat\w*|s[eé]curit\w*|security|auth\w*|pipeline|orchestrat\w*|transvers\w*|breaking|irr[eé]versibl\w*|production|prod\b|deploy\w*|d[eé]ploie\w*|sch[eé]ma|schema|multi-\w+|tout le|l'ensemble|whole|entire)/i

/** Signaux de TRIVIALITÉ (→ trivial) : micro-édition ciblée, déjà précise. */
const TRIVIAL_SIGNALS =
  /\b(typo|renomm\w*|rename|corrige la faute|coquille|commentaire|comment|reformul\w*|un mot|one word|bump\w*|version|lint|format\w*)\b/i

/**
 * Classe une tâche. Ordre : critical d'abord (prudence), puis trivial (signal FORT + tâche courte),
 * sinon standard (défaut sûr). Une tâche longue OU multi-clauses ne peut PAS être triviale.
 */
export function classifyRegime(task: string): TaskRegime {
  const t = task.trim()
  if (!t) return 'standard'
  if (CRITICAL_SIGNALS.test(t)) return 'critical'
  // Multi-clause = vraie coupure de phrase (`;`, retour ligne, `. ` suivi de texte, « puis/then »),
  // PAS n'importe quel point (« 1.0.1 » n'est pas multi-clause).
  const hasClauseBreak = /[;\n]|\.\s+\S|\b(puis|ensuite|then|and then)\b/i.test(t)
  const isShort = t.length <= 120 && !hasClauseBreak
  if (TRIVIAL_SIGNALS.test(t) && isShort) return 'trivial'
  return 'standard'
}

/** Sous-ensemble de phases pour une tâche (via son régime). */
export function regimePhases(task: string): PipelinePhase[] {
  return [...REGIME_PHASES[classifyRegime(task)]]
}

/** Exposé pour test/observabilité : phases d'un régime donné. */
export function phasesForRegime(regime: TaskRegime): PipelinePhase[] {
  return [...REGIME_PHASES[regime]]
}
