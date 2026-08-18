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
import { matchIntentPhase } from './intent-phase-routing'
import { routeSkillRequest } from './skill-routing'

export type TaskRegime = 'trivial' | 'standard' | 'critical'

/**
 * Définit les phases que l'orchestrateur exécute avant le juge pour chaque régime de tâche :
 * trivial : exécute uniquement build pour une modification directe ;
 * standard : cadre le besoin avec frame, puis exécute build ;
 * critical : exécute le pipeline complet, de scout à clean.
 * Le juge reste TOUJOURS actif : il est ajouté séparément par l'orchestrateur.
 */
const REGIME_PHASES: Record<TaskRegime, PipelinePhase[]> = {
  trivial: ['build'],
  standard: ['frame', 'build'],
  critical: ['scout', 'frame', 'terrain', 'build', 'clean']
}

/** Signaux de COMPLEXITÉ (→ critical) : architecture, transverse, risque, irréversible. */
const CRITICAL_SIGNALS =
  /\b(architect\w*|refactor\w*|migrat\w*|s[eé]curit\w*|security|auth\w*|pipeline|(?<!\/)orchestrat(?!e\b)\w*|transvers\w*|breaking|irr[eé]versibl\w*|production|prod\b|deploy\w*|d[eé]ploie\w*|sch[eé]ma|schema|multi-\w+|tout le|l'ensemble|whole|entire)/i

/**
 * Une contrainte négative décrit précisément ce qu'il NE faut pas faire ; elle ne doit donc pas
 * promouvoir seule une correction bornée en chantier critique. On retire uniquement le signal
 * placé dans la petite fenêtre de la négation : tout autre signal positif reste classé critical.
 */
const NEGATED_CRITICAL_SIGNALS =
  /\b(?:ne\s+pas|n['’]\s*|pas\s+de|aucun(?:e)?|sans|ni|do\s+not|don't|without)\s+(?:[^\s.;,:!?]+\s+){0,5}(?:architect\w*|refactor\w*|migrat\w*|s[eé]curit\w*|security|auth\w*|pipeline|orchestrat\w*|transvers\w*|breaking|irr[eé]versibl\w*|production|prod\b|deploy\w*|d[eé]ploie\w*|sch[eé]ma|schema|multi-\w+|tout le|l'ensemble|whole|entire)/gi

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
  const positiveComplexity = t.replace(NEGATED_CRITICAL_SIGNALS, '')
  if (CRITICAL_SIGNALS.test(positiveComplexity)) return 'critical'
  // Multi-clause = vraie coupure de phrase (`;`, retour ligne, `. ` suivi de texte, « puis/then »),
  // PAS n'importe quel point (« 1.0.1 » n'est pas multi-clause).
  const hasClauseBreak = /[;\n]|\.\s+\S|\b(puis|ensuite|then|and then)\b/i.test(t)
  const isShort = t.length <= 120 && !hasClauseBreak
  if (TRIVIAL_SIGNALS.test(t) && isShort) return 'trivial'
  return 'standard'
}

/**
 * Phases demandées EXPLICITEMENT en tête de message. Une demande nommée est autoritaire : quand
 * l'utilisateur écrit « scout le routing », il veut la phase scout — pas le pipeline complet déduit
 * d'un signal de complexité. Variantes tolérées : suffixe verbal FR (`scoute`, `scouter`, `framez`)
 * et séparateur (`scout:`, `scout-moi`, `scout — …`).
 */
const PHASE_KEYWORDS: Record<string, PipelinePhase> = {
  scout: 'scout',
  frame: 'frame',
  terrain: 'terrain',
  build: 'build',
  clean: 'clean',
  judge: 'judge'
}

/**
 * `\b` après le suffixe optionnel garantit qu'on ne matche PAS un mot qui englobe la phase
 * (`framework`, `cleanup`, `building`) ; l'ancre `^` garantit le DÉBUT du message (une phase citée
 * au milieu d'une phrase n'est pas une demande de phase).
 */
const PHASE_PREFIX = new RegExp(`^(${Object.keys(PHASE_KEYWORDS).join('|')})(e|es|er|ez)?\\b`, 'i')

/** Phase demandée explicitement en tête de message, sinon `null`. */
export function matchExplicitPhase(task: string): PipelinePhase | null {
  const m = PHASE_PREFIX.exec(task.trim())
  return m ? PHASE_KEYWORDS[m[1].toLowerCase()] : null
}

/**
 * Sous-ensemble de phases pour une tâche. Une phase NOMMÉE en tête court-circuite le régime
 * (consultée AVANT `classifyRegime`) ; sinon on retombe sur l'heuristique de proportionnalité.
 */
export function regimePhases(task: string): PipelinePhase[] {
  // Ordre : une phase NOMMEE prime (autorite maximale), puis l'INTENTION en langage naturel. Cette
  // derniere ne fait que RESTREINDRE les phases d'une tache deja partie en orchestration — elle ne
  // decide jamais d'orchestrer, precisement pour ne pas rejouer la regression du 2026-07-28.
  // Une phase NOMMÉE est AUTORITAIRE : l'utilisateur (ou le modèle) l'a désignée, on ne discute pas.
  const explicitSlashPhase = routeSkillRequest(task)?.explicitPhase
  if (explicitSlashPhase === 'judge') return []
  if (explicitSlashPhase) return [explicitSlashPhase]

  const namedPhase = matchExplicitPhase(task) ?? undefined
  const naturalIntent = matchIntentPhase(task)?.phase
  if (namedPhase && naturalIntent === namedPhase) {
    return namedPhase === 'judge' ? [] : [namedPhase]
  }

  const regime = classifyRegime(task)
  // AMPUTATION D'UN RÉGIME CRITIQUE — défaut relevé par l'audit du 2026-07-29 :
  // `regimePhases("il faut refactorer toute l'architecture")` rendait `['frame']` au lieu des cinq
  // phases, parce que « il faut » déclenche l'intention `frame`. Une INTENTION est un indice de
  // registre, pas une autorisation de réduire une tâche à risque. Mon test anti-régression passait à
  // côté : il exerçait une tâche critique SANS intention en tête.
  // Une phase NOMMÉE, elle, garde le droit de réduire (au-dessus) : c'est une décision explicite.
  if (regime === 'critical') return [...REGIME_PHASES[regime]]

  const intentPhase = naturalIntent
  // `judge` est la closure externe permanente de l'orchestrateur, pas une phase worker : une demande
  // d'audit saute donc les phases d'exécution et lance ce juge une seule fois.
  if (intentPhase === 'judge') return []
  if (intentPhase) return [intentPhase]
  const fallback = [...REGIME_PHASES[regime]]
  // Une phase naturelle suivie d'une seconde action n'est pas une commande de reduction. Elle reste
  // visible, puis le regime poursuit le travail demande (ex. scout -> correction).
  return namedPhase && namedPhase !== 'judge'
    ? [namedPhase, ...fallback.filter((phase) => phase !== namedPhase)]
    : fallback
}

/** Exposé pour test/observabilité : phases d'un régime donné. */
export function phasesForRegime(regime: TaskRegime): PipelinePhase[] {
  return [...REGIME_PHASES[regime]]
}
