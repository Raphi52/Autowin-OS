import type { ExecutionEvidence } from './providers/types'
import { isMutationTask } from './task-mutation-classifier'

export const ROOT_DOD = {
  analysis: 'Analyse demandee presente dans le livrable',
  mutation: 'Mutation demandee produite avec une preuve executable',
  tests: 'Tests demandes executes avec un code de sortie 0',
  commit: 'Commit demande publie avec une identite Git verifiable'
} as const

export interface RootExecutionRequirements {
  analysis: boolean
  mutation: boolean
  tests: boolean
  commit: boolean
}

const ANALYSIS_REQUEST = /\b(?:scout|audit|analys|inspect|cherche|trouve|repere|explore)\w*/i
const TEST_REQUEST =
  /\b(?:tests?|test(?:e|er|ez|s)?|vitest|verification|verifi\w*|rouge\s*(?:vers|->|→)\s*vert|exit\s*0)\b/i
const COMMIT_REQUEST =
  /\b(?:publie\w*(?:\s+(?:les?|un|une|ces|mes|nos|vos)\s+(?:changements?|commit|branche))?|push(?:e|er|ez|ons)?|(?:fais|fait|faire|cree|realise)\w*\s+(?:un\s+)?commit|(?:puis|ensuite|et)\s+commit(?:e|er|ez)?|commit(?:e|er|ez)?\s+(?:les?\s+)?(?:changements?|modifications?|code|branche))\b/i

const CLAUSE_BOUNDARY = /(?:[.;:!?,]|\b(?:mais|puis|ensuite|cependant|toutefois)\b)/gi
const NEGATED_MENTION_PREFIX =
  /(?:\b(?:sans|ni|aucun(?:e|s|es)?|zero|pas\s+de|interdi\w*\s+de|evit\w*\s+de|without|no)\b(?:\s+\w+){0,6}\s*|\b(?:ne|n['’]\w*)(?:\s+\w+){0,6}\s+(?:pas|jamais|aucun(?:e|s|es)?|rien)\b(?:\s+\w+){0,4}\s*|\b(?:do\s+not|don't)(?:\s+\w+){0,4}\s*)$/i
const DIRECT_NEGATION_PREFIX = /\b(?:ne|n['’]\w*|not)\s*$/i
const DIRECT_NEGATION_SUFFIX = /^\s*(?:\w+\s+){0,3}(?:pas|jamais|rien|aucun(?:e|s|es)?|not)\b/i

function clauseBefore(text: string, index: number): string {
  const prefix = text.slice(Math.max(0, index - 120), index)
  let boundaryEnd = 0
  for (const boundary of prefix.matchAll(new RegExp(CLAUSE_BOUNDARY.source, 'gi'))) {
    boundaryEnd = (boundary.index ?? 0) + boundary[0].length
  }
  return prefix.slice(boundaryEnd)
}

/** Une mention interdite décrit une non-action ; elle ne doit jamais devenir une case de DoD. */
function hasRequestedAction(text: string, request: RegExp): boolean {
  const matcher = new RegExp(request.source, request.flags.includes('i') ? 'gi' : 'g')
  for (const match of text.matchAll(matcher)) {
    const start = match.index ?? 0
    const before = /^(?:puis|ensuite|et)\b/i.test(match[0]) ? '' : clauseBefore(text, start)
    const after = text.slice(start + match[0].length, start + match[0].length + 48)
    const negated =
      NEGATED_MENTION_PREFIX.test(before) ||
      (DIRECT_NEGATION_PREFIX.test(before) && DIRECT_NEGATION_SUFFIX.test(after))
    if (!negated) return true
  }
  return false
}

/**
 * Compile uniquement les obligations explicites et falsifiables du prompt. Une demande de lecture
 * seule conserve une DoD vide ; une demande composee analyse + mutation ne peut plus etre fermee par
 * le seul sous-run d'analyse.
 */
export function rootExecutionRequirements(
  task: string,
  phasesProgrammees?: readonly string[]
): RootExecutionRequirements {
  const normalized = task.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const demandee = isMutationTask(task)
  // Le TEXTE dit ce que l'utilisateur envisage ; le PROGRAMME dit ce que le run va jouer. Un run
  // limite a frame/scout/terrain n'ecrit rien : lui demander une mutation, un test ou un commit est
  // insatisfaisable par construction. L'ANALYSE, elle, reste due : il peut la tenir.
  const ecrit = !programmeSansEcriture(phasesProgrammees)
  return {
    analysis: demandee && hasRequestedAction(normalized, ANALYSIS_REQUEST),
    mutation: demandee && ecrit,
    tests: demandee && ecrit && hasRequestedAction(normalized, TEST_REQUEST),
    commit: demandee && ecrit && hasRequestedAction(normalized, COMMIT_REQUEST)
  }
}

export function rootDodLabels(task: string, phasesProgrammees?: readonly string[]): string[] {
  const required = rootExecutionRequirements(task, phasesProgrammees)
  const labels: string[] = []
  if (required.analysis) labels.push(ROOT_DOD.analysis)
  if (required.mutation) labels.push(ROOT_DOD.mutation)
  if (required.tests) labels.push(ROOT_DOD.tests)
  if (required.commit) labels.push(ROOT_DOD.commit)
  return labels
}

export interface RootExecutionProofs {
  phases: Array<{ phase: string; text?: string; executionEvidence?: ExecutionEvidence[] }>
  publishedCommitSha?: string
}

function successfulEvidence(item: ExecutionEvidence): boolean {
  return item.ok && !/^(?:failed|error|cancelled|aborted)$/i.test(item.status)
}

function verificationTargetsRequest(task: string, item: ExecutionEvidence): boolean {
  if (item.kind !== 'verification' || !successfulEvidence(item) || (item.exitCode ?? 0) !== 0) {
    return false
  }
  const requested = task
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
  const observed = `${item.command ?? ''} ${item.summary ?? ''}`.toLowerCase()
  if (/\bnpm\s+(?:run\s+)?test\b/.test(requested)) {
    return /\bnpm\s+(?:run\s+)?test\b/.test(observed)
  }
  if (/\bvitest\b/.test(requested)) return /\bvitest\b/.test(observed)
  if (/\bpytest\b/.test(requested)) return /\bpytest\b/.test(observed)
  if (/\bdotnet\s+test\b/.test(requested)) return /\bdotnet\s+test\b/.test(observed)
  if (/\btests?\b/.test(requested)) {
    return /\b(?:tests?|vitest|jest|pytest|ctest)\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b|\b(?:dotnet|cargo|go)\s+test\b/.test(
      observed
    )
  }
  return true
}

export function rootRequirementChecks(
  task: string,
  proofs: RootExecutionProofs
): Array<{ label: string; checked: boolean }> {
  const required = rootExecutionRequirements(task)
  const evidence = proofs.phases.flatMap((phase) => phase.executionEvidence ?? [])
  const checks: Array<{ label: string; checked: boolean }> = []
  if (required.analysis) {
    checks.push({
      label: ROOT_DOD.analysis,
      checked: proofs.phases.some((phase) => phase.phase === 'scout' && Boolean(phase.text?.trim()))
    })
  }
  if (required.mutation) {
    checks.push({
      label: ROOT_DOD.mutation,
      checked: evidence.some((item) => item.kind === 'mutation' && successfulEvidence(item))
    })
  }
  if (required.tests) {
    checks.push({
      label: ROOT_DOD.tests,
      checked: evidence.some((item) => verificationTargetsRequest(task, item))
    })
  }
  if (required.commit) {
    checks.push({ label: ROOT_DOD.commit, checked: Boolean(proofs.publishedCommitSha?.trim()) })
  }
  return checks
}

/** Phases qui n'ECRIVENT rien : leur livrable est un texte, pas une mutation. */
const PHASES_LECTURE_SEULE = new Set(['scout', 'frame', 'terrain'])

/**
 * Le run n'a joué QUE des phases de lecture — il n'a donc aucune mutation à prouver.
 *
 * Défaut vécu le 2026-08-18 : « Statut "red" : la clôture a été refusée en amont » sur un scout qui
 * avait pourtant rendu sa shortlist. Le prompt était classé MUTATION (`isMutationTask` → true) et,
 * depuis que « scout » nomme déterministement la phase, le run ne jouait QUE scout. La clôture
 * exigeait alors une preuve d'exécution mutante qu'un run en lecture seule ne peut pas produire :
 * exigence structurellement insatisfaisable, donc rouge à chaque fois.
 *
 * Un run se juge sur ce qu'on lui a demandé de JOUER, pas sur ce que la phrase de l'utilisateur
 * laissait entrevoir pour la suite. Un tableau vide n'est PAS blanchi : sans phase, il n'y a rien à
 * déclarer en lecture seule.
 */
/**
 * Le PROGRAMME du run ne comporte aucune phase qui ecrit — pendant a `runEnLectureSeule`, mais en
 * AMONT : celui-ci se prononce sur les phases PROGRAMMEES (avant execution, ce que connaissent
 * `regimePhases`/`effectivePhases`), celui-la sur les phases JOUEES (apres execution).
 *
 * `undefined` ou tableau vide = « on ne sait pas » → aucune obligation n'est levee. Un programme
 * inconnu ne blanchit rien : c'est ce qui rend le parametre sur derriere un appelant non migre.
 */
export function programmeSansEcriture(phases?: readonly string[]): boolean {
  return (
    Array.isArray(phases) && phases.length > 0 && phases.every((p) => PHASES_LECTURE_SEULE.has(p))
  )
}

export function runEnLectureSeule(phases: readonly { phase: string }[]): boolean {
  return phases.length > 0 && phases.every((entree) => PHASES_LECTURE_SEULE.has(entree.phase))
}

/**
 * L'état de clôture d'un run : ce que le gate doit évaluer, calculé EN UN SEUL ENDROIT.
 *
 * Cette décision vivait en ligne dans l'orchestrateur, donc hors de portée des tests — une mutation
 * de sa garde ne faisait rougir aucun test (vérifié le 2026-08-18). C'est la leçon de
 * `orchestrator.verdict-gate.test.ts` appliquée une fois de plus : un fait, un seul lecteur.
 */
export function etatDeCloture(
  task: string,
  phases: readonly { phase: string; text?: string; executionEvidence?: ExecutionEvidence[] }[],
  evidenceOk: boolean,
  mutationDemandee: boolean
): { status: 'green' | 'red'; dod: Array<{ label: string; checked: boolean }> } {
  const lectureSeule = runEnLectureSeule(phases)
  const checks = rootRequirementChecks(task, { phases: [...phases] }).filter(
    (check) =>
      check.label !== ROOT_DOD.commit &&
      // Un run en lecture seule ne porte que l'obligation d'ANALYSE : exiger de lui une preuve de
      // mutation ou de test est structurellement insatisfaisable, donc un rouge garanti.
      !(lectureSeule && check.label !== ROOT_DOD.analysis)
  )
  if (
    !lectureSeule &&
    mutationDemandee &&
    !checks.some((check) => check.label === ROOT_DOD.mutation)
  ) {
    checks.push({ label: ROOT_DOD.mutation, checked: evidenceOk })
  }
  return { status: lectureSeule || evidenceOk ? 'green' : 'red', dod: checks }
}
