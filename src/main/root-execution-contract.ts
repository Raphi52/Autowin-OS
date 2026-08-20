import type { ExecutionEvidence } from './providers/types'
import { attributedPaths, normalized } from './providers/causal-verification-evidence'
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
      // Toute phase de LECTURE porte l'analyse, pas seulement `scout` : un run programme
      // `['frame']` ou `['terrain']` ne joue JAMAIS `scout`, donc n'aurait pu cocher cette case a
      // aucun prix — la seule case que `rootDodLabels` lui seme etait structurellement incochable
      // (« DoD 0/1 » sur un livrable complet). On reutilise `noeudSansEcriture`, le predicat deja
      // defini plus bas : deux listes du meme concept, c'est le defaut que ce run corrige. Un noeud
      // SKILL y entre aussi — sinon un workflow fait de skills n'aurait, lui non plus, aucun moyen
      // de cocher cette case.
      checked: proofs.phases.some(
        (phase) => noeudSansEcriture(phase.phase) && Boolean(phase.text?.trim())
      )
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

/** Les huit phases du pipeline. Tout autre identifiant de noeud designe une SKILL du disque. */
const PHASES_PIPELINE = new Set([
  'scout',
  'frame',
  'terrain',
  'build',
  'clean',
  'judge',
  'kaizen',
  'remake'
])

/**
 * Ce noeud produit-il un texte plutot qu'une mutation ?
 *
 * Les trois phases d'analyse, PLUS tout noeud SKILL. Un noeud skill s'execute en `read-only`
 * (`sandboxForPhase` ne donne les droits d'ecriture qu'a build et clean) : lui demander une preuve
 * de mutation a la cloture serait une exigence structurellement insatisfaisable — exactement le
 * defaut vecu le 2026-08-18 sur scout, ou un run correct sortait rouge a chaque fois parce qu'on
 * exigeait de lui ce que son propre contrat lui interdit de produire.
 *
 * Les huit phases gardent leur classement d'origine : `judge`, `kaizen` et `remake` ne sont PAS
 * ajoutes ici, ce serait un changement de comportement hors sujet.
 */
function noeudSansEcriture(phase: string): boolean {
  return PHASES_LECTURE_SEULE.has(phase) || !PHASES_PIPELINE.has(phase)
}

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
    Array.isArray(phases) && phases.length > 0 && phases.every((p) => noeudSansEcriture(p))
  )
}

export function runEnLectureSeule(phases: readonly { phase: string }[]): boolean {
  return phases.length > 0 && phases.every((entree) => noeudSansEcriture(entree.phase))
}

/**
 * Une CIBLE NOMMEE est un chemin de fichier porte par un ANCRAGE `chemin:ligne` dans la demande.
 *
 * Defaut vecu (conv-1302) : quatre runs d'affilee ont ferme `succeeded`, gate vert, juges 96/100,
 * en corrigeant un AUTRE fichier que celui que l'utilisateur avait nomme. Le gate evalue la QUALITE
 * de ce qui est produit ; personne n'evaluait la CORRESPONDANCE avec ce qui etait demande.
 *
 * Le numero de ligne est le discriminant, pas la mention : une reference documentaire, un exemple,
 * un `.test.ts` cite en passant n'en portent pas. Sens d'erreur IMPOSE : faux negatif tolere, faux
 * positif JAMAIS — un faux blocage rendrait l'app inutilisable.
 */
const EXTENSIONS_CIBLE =
  'ts|tsx|js|jsx|mjs|cjs|json|md|ps1|psm1|py|cs|sql|css|scss|html|yml|yaml|sh|rs|go|java|xml'
const CIBLE_ANCREE = new RegExp(
  `((?:[\\w.@~-]+[/\\\\])+[\\w.@-]+\\.(?:${EXTENSIONS_CIBLE}))\\s*:\\s*(\\d{1,6})(?!\\d)`,
  'gu'
)
/** Une clause « hors perimetre » decrit ce qu'il ne faut PAS toucher : jamais une obligation. */
const HORS_PERIMETRE =
  /\b(?:perimetre\s+out|out\s+of\s+scope|hors\s+perimetre|reste\s+intacts?|touche\w*\s+pas|sans\s+toucher|pas\s+toucher|ne\s+pas\s+modifier|exclu\w*)\b/i

export function ciblesNommees(task: string): string[] {
  const texte = task.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const cibles: string[] = []
  for (const match of texte.matchAll(CIBLE_ANCREE)) {
    const index = match.index ?? 0
    // Une URL (`http://host:8080/x.ts:3`) n'est pas un chemin du depot.
    if (/(?:https?|file|ftp):\/\/\S*$/i.test(texte.slice(Math.max(0, index - 200), index))) continue
    const large = texte.slice(Math.max(0, index - 120), index)
    if (HORS_PERIMETRE.test(large)) continue
    if (NEGATED_MENTION_PREFIX.test(clauseBefore(texte, index))) continue
    const chemin = normalized(match[1])
    if (!cibles.includes(chemin)) cibles.push(chemin)
  }
  return cibles
}

function memeChemin(a: string, b: string): boolean {
  if (a === b) return true
  return a.length > b.length ? a.endsWith(`/${b}`) : b.endsWith(`/${a}`)
}

/**
 * Croise les cibles nommees avec les chemins REELLEMENT mutes, rapportes par `ExecutionEvidence`.
 *
 * La source n'est PAS `git diff` : `worktrees.end()` (`orchestrator.ts:1887`) est POSTERIEUR au
 * gate, donc un controle base sur le diff serait structurellement aveugle.
 *
 * FAIL-OPEN a deux endroits : aucune cible nommee, ou aucune preuve ne portant de chemin attribue
 * (un provider qui ne renseigne pas `paths` ne doit jamais produire un faux rouge).
 */
/**
 * Une valeur attribuee est-elle vraiment un CHEMIN ?
 *
 * Regression VECUE le 2026-08-18 sur conv-1304 : une preuve d'execution portait `path: "0"`. Le garde
 * l'a comptee comme un fichier modifie, le repli « aucun chemin attribue → sans-objet » n'a donc pas
 * joue, et un run qui avait POURTANT modifie et committe la cible nommee a ete bloque. Un faux
 * blocage est pire que le defaut que ce garde corrige : il refuse du travail juste.
 *
 * Un chemin porte un separateur ou une extension de fichier. Tout le reste est une valeur de
 * remplissage a laquelle on ne doit accorder aucune confiance — dans le doute, on NE BLOQUE PAS.
 */
function ressembleAUnChemin(valeur: string): boolean {
  const propre = valeur.trim()
  if (propre.length < 3) return false
  return /[\\/]/u.test(propre) || /\.[A-Za-z0-9]{1,8}$/u.test(propre)
}

export function cibleNommeeTouchee(
  task: string,
  evidence: readonly ExecutionEvidence[]
): 'sans-objet' | 'touchee' | 'manquee' {
  const cibles = ciblesNommees(task)
  if (cibles.length === 0) return 'sans-objet'
  const touches = evidence
    .filter((item) => item.kind === 'mutation' && successfulEvidence(item))
    .flatMap((item) => attributedPaths(item))
    .filter(ressembleAUnChemin)
    .map((chemin) => normalized(chemin))
  if (touches.length === 0) return 'sans-objet'
  // Decision cadree : le gate ne bloque que le MISS TOTAL. Une couverture PARTIELLE part au juge,
  // non bloquante — un `every` en dur ici interdirait la relocalisation causale legitime.
  return cibles.some((cible) => touches.some((chemin) => memeChemin(chemin, cible)))
    ? 'touchee'
    : 'manquee'
}

export function libelleCibleNommee(cibles: readonly string[]): string {
  return `Cible nommee dans la demande reellement modifiee : ${cibles.join(', ')}`
}

/*
 * AUTORITÉS DE CLÔTURE — pathologie CONNUE, garde RETIRÉE, à ne pas retenter à l'identique.
 * (Commentaire de bloc et non JSDoc : il ne documente aucun symbole, il documente une ABSENCE.)
 *
 * Défaut réel (conv-1302, 2026-08-18) : bloqué par le gate, un run a réparé LE GATE quatre fois
 * d'affilée au lieu de la tâche demandée, puis a fermé `succeeded` avec un juge à 96/100. L'agent
 * modifiait la chose qui l'évaluait.
 *
 * Une garde a été écrite le même jour : rougir un run dont TOUTES les mutations tombent dans
 * `root-execution-contract.ts` / `phase-briefs.ts` alors que la demande ne parle pas du gate. Un
 * juge adversarial l'a réfutée par exécution — onze faux blocages sur du travail légitime :
 * corriger une faute dans un brief de phase, raccourcir un prompt, ajouter une extension à la liste
 * des cibles, extraire une fonction, toute demande en anglais, et même une demande qui NOMMAIT le
 * fichier autrement que par son basename exact (`phase-briefs`, `src\main\phase-briefs`). Le
 * contrat que la garde s'était fixé — « faux négatif toléré, faux positif JAMAIS » — n'était pas
 * tenu, et un faux blocage refuse du travail juste : c'est pire que le défaut visé.
 *
 * Ce qui manquait n'est pas une meilleure regex : c'est le CONTRAT DE LA TÂCHE au niveau de la
 * CONVERSATION. Sur le tour « finis », le texte courant ne nomme plus rien, donc aucune heuristique
 * locale ne peut distinguer une échappatoire d'un travail légitime. Une garde correcte devrait
 * s'appuyer sur un signal POSITIF d'échappatoire — le run précédent était bloqué ET la cible
 * héritée du fil n'est pas touchée — et non sur l'absence d'un vocabulaire. Tant que ce contrat
 * hérité n'existe pas, il n'y a pas de garde honnête à écrire ici.
 */

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
  // Garde « cible nommee » : un run qui a mute des fichiers SANS toucher aucune des cibles que la
  // demande ancrait (`chemin:ligne`) ne peut pas fermer vert. Seul le MISS TOTAL bloque ; une
  // couverture partielle passe et part au juge (`phase-briefs.ts`), non bloquante.
  const cibleManquee =
    !lectureSeule &&
    cibleNommeeTouchee(
      task,
      phases.flatMap((phase) => phase.executionEvidence ?? [])
    ) === 'manquee'
  if (cibleManquee) {
    checks.push({ label: libelleCibleNommee(ciblesNommees(task)), checked: false })
  }
  return {
    status: !cibleManquee && (lectureSeule || evidenceOk) ? 'green' : 'red',
    dod: checks
  }
}
