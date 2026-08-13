const MUTATION_STEM =
  'ajout|add|modifi|chang|corrig|fix|cre|create|implement|refactor|supprim|remove|renomm|rename|update|build|ger|ecri|write|edit|patch|apply|delete|move|remplac|configur|repar|nettoi|deplac|mets|met|fai'
const MUTATION_TASK = new RegExp(`\\b(?:${MUTATION_STEM})\\w*`, 'i')
const NEGATED_MUTATION = new RegExp(
  `\\b(?:sans(?:\\s+rien)?\\s+(?:\\w+\\s+){0,2}|n['e]?\\s*(?:\\w+\\s+){0,2})(?:${MUTATION_STEM})\\w*(?:\\s+pas)?`,
  'gi'
)
const CLAUSE_SPLIT =
  /\b(?:et|puis|then|and|apres|après|mais|but|cependant|however)\b|[;,]|[.!?]\s+/gi
const APOSTROPHES = /[‘’ʼ]/g
const SENTINEL_PREFIX = /^\[[^\]]{0,160}\]\s*/
const PHASE_LECTURE_SEULE_LEAD = /^\/?(?:scout|frame|judge)\b/i
/*
  ATTENTION : un verbe de lecture seule doit être ajouté ICI **et** dans les deux listes de
  `classifyMutationConfidence` (le garde `explicitReadOnly` / `simpleReadOnlyLead`). Elles ne sont pas
  interchangeables — celle-ci filtre CHAQUE clause, les autres décident si le chemin lecture seule est
  même tenté — et ne pas le poser partout laisse la tâche en `uncertain`, donc traitée comme une
  mutation. C'est ce qui est arrivé à `verifi` : ajouté aux deux gardes seulement, il ne suffisait pas.
*/
const READ_ONLY_STEM =
  'analys|audit|cadr|document|expliqu|inspect|review|resume|resum|repond|decri|lis|lire|liste|montre|affiche|verifi'
const READ_ONLY_CLAUSE = new RegExp(`^(?:${READ_ONLY_STEM})\\w*\\b`, 'i')
const READ_ONLY_DELIVERABLE_CLAUSE =
  /^(?:produi|fourni)\w*\s+(?:(?:le|la|un|une)\s+)?(?:cadrage|analyse|audit|resume|documentation)\b/i
const NEGATED_OBJECT_REMAINDER = /^(?:de|du|des|le|la|les|un|une|aucun|aucune|rien)\b/i

export type MutationConfidence = 'mutation' | 'read-only' | 'uncertain'

/** Source canonique utilisée par le sandbox, le gate et le contrat racine. */
export function classifyMutationConfidence(task: string): MutationConfidence {
  if (/^\/kaizen(?=\s|$)/i.test(task.trim())) return 'read-only'
  if (/^\/(?:scout|frame|judge)(?=\s|$)/i.test(task.trim())) return 'read-only'
  const sansSentinelle = task.trim().replace(SENTINEL_PREFIX, '')
  if (PHASE_LECTURE_SEULE_LEAD.test(sansSentinelle)) {
    const normaliseLead = sansSentinelle
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(APOSTROPHES, "'")
      .toLowerCase()
      .replace(NEGATED_MUTATION, ' ')
    const [, ...clausesSuivantes] = normaliseLead
      .split(CLAUSE_SPLIT)
      .map((clause) => clause.trim())
      .filter(Boolean)
    if (!clausesSuivantes.some((clause) => MUTATION_TASK.test(clause))) return 'read-only'
  }
  const normalized = task
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(APOSTROPHES, "'")
    .toLowerCase()
  const withoutNegations = normalized.replace(NEGATED_MUTATION, ' ')
  if (MUTATION_TASK.test(withoutNegations)) return 'mutation'
  /*
    `verifi` manquait à ces deux listes. Conséquence MESURÉE : « Vérifier les écarts de facturation »
    était classé MUTATION (le défaut de la ligne suivante, un défaut sûr pour le bac à sable), donc le
    gabarit de RUN.md lui posait « Mutation demandee produite » et « Tests demandes executes » — deux
    obligations que la tâche ne demande pas, affichées ensuite comme une DoD manquée.

    Ajouter ce verbe ne relâche rien : `MUTATION_TASK` est testé AVANT (ligne 46), donc « vérifie puis
    corrige » reste une mutation, et `allClausesReadOnly` exige ensuite que CHAQUE clause soit en
    lecture seule. Le seul cas déplacé est la vérification pure — qui n'a effectivement pas besoin
    d'écrire.
  */
  const explicitReadOnly =
    withoutNegations !== normalized &&
    /\b(?:analys|audit|cadr|document|expliqu|inspect|lecture seule|review|verifi)\w*/i.test(
      normalized
    )
  const simpleReadOnlyLead =
    /^(?:analys|audit|expliqu|inspect|review|cadr|document|resume|decri|verifi)\w*\b/i.test(
      normalized
    )
  if (!explicitReadOnly && !simpleReadOnlyLead) return 'mutation'
  const clauses = normalized
    .split(CLAUSE_SPLIT)
    .map((clause) => clause.trim())
    .filter(Boolean)
  const allClausesReadOnly = clauses.every((clause) => {
    const withoutNegatedMutation = clause.replace(NEGATED_MUTATION, ' ').trim()
    if (
      READ_ONLY_CLAUSE.test(withoutNegatedMutation) ||
      READ_ONLY_DELIVERABLE_CLAUSE.test(withoutNegatedMutation)
    ) {
      return true
    }
    const containedNegatedMutation = withoutNegatedMutation !== clause
    return (
      containedNegatedMutation &&
      (!withoutNegatedMutation || NEGATED_OBJECT_REMAINDER.test(withoutNegatedMutation))
    )
  })
  return allClausesReadOnly ? 'read-only' : 'uncertain'
}

/** Une incertitude garde le chemin sûr : worktree isolé et preuves de mutation exigées. */
export function isMutationTask(task: string): boolean {
  return classifyMutationConfidence(task) !== 'read-only'
}
