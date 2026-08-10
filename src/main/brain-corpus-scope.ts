/**
 * PORTÉE DU BRAIN, DÉRIVÉE DU WORKSPACE (option O3 du cadrage `rag-brain-pertinence`).
 *
 * MESURE qui justifie ce module (index vivant du Brain, 2026-07-29) : 15 342 chunks, dont **99 %** de
 * `knowledge/domain/rigapplication-documentation` et **0,19 %** sur Autowin OS (4 documents). Une
 * question Autowin (« le bouton fork dans le chat ») ramenait donc 2 sources RIG sur 3 — appariement sur
 * le mot « bouton ». Ce n'est PAS un défaut de classement : c'est le résultat attendu d'un corpus à
 * 99 % consacré à un autre projet.
 *
 * Ce que ce module fait : restreindre les sources retenues au corpus du WORKSPACE courant. Ce qu'il ne
 * fait PAS : prétendre enrichir le Brain. Filtrer ne crée pas de connaissance — pour Autowin, la
 * connaissance vit dans le graphe de code (déjà scopé) et dans le contexte projet ; le Brain n'apporte
 * que 4 documents, qui restent atteignables.
 *
 * PRINCIPE DE PRUDENCE : un workspace sans identité déclarée est fail-closed. L'opérateur peut
 * explicitement demander le corpus global avec `AUTOWIN_BRAIN_CORPUS=*`, mais une absence de mapping
 * ne doit jamais devenir silencieusement « tout autoriser ».
 */
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { BrainRetrievalResult } from './brain-retrieval'

/** Séparateur entre deux sources dans le bloc rendu par le Brain (`brain_context.py:128`). */
const SOURCE_SEPARATOR = '\n\n---\n\n'
/** En-tête d'une source : `### Source N — <chemin>`. */

/**
 * Corpus Brain par workspace, indexé par SLUG de dossier. Les valeurs sont des identités exactes ou
 * des préfixes ANCRÉS du chemin `knowledge/...` (`/` ou `-` final = famille). Une sous-chaîne libre
 * permettrait à `rig/.../autowin-migration.md` de contourner l'isolation.
 *
 * Table EXPLICITE et non devinée : le slug d'un dossier ne dit pas le nom de son corpus
 * (« Code RIG » → la doc s'appelle `rigapplication-documentation`). Un workspace absent de cette table
 * est fail-closed.
 */
const WORKSPACE_BRAIN_CORPUS: Readonly<Record<string, readonly string[]>> = {
  'autowin-os': [
    'knowledge/_maps/autowin-os.md',
    'knowledge/domain/autowin-os-',
    'knowledge/runbooks/autowin-os-'
  ],
  'code-rig': [
    'knowledge/_maps/rig.md',
    'knowledge/_maps/rig-',
    'knowledge/decisions/rig-',
    'knowledge/domain/rig-',
    'knowledge/domain/rigapplication-documentation/',
    'knowledge/lessons/rig-'
  ],
  rigapplication: [
    'knowledge/_maps/rig.md',
    'knowledge/_maps/rig-',
    'knowledge/decisions/rig-',
    'knowledge/domain/rig-',
    'knowledge/domain/rigapplication-documentation/',
    'knowledge/lessons/rig-'
  ],
  rig: [
    'knowledge/_maps/rig.md',
    'knowledge/_maps/rig-',
    'knowledge/decisions/rig-',
    'knowledge/domain/rig-',
    'knowledge/domain/rigapplication-documentation/',
    'knowledge/lessons/rig-'
  ]
}

let invalidOverrideWarningEmitted = false

function isCanonicalCorpusSelector(selector: string): boolean {
  const parts = selector.replace(/\/$/, '').split('/')
  return (
    selector.startsWith('knowledge/') &&
    !selector.includes('\\') &&
    !selector.includes('//') &&
    parts.every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

function warnInvalidCorpusOverride(): void {
  if (invalidOverrideWarningEmitted) return
  invalidOverrideWarningEmitted = true
  process.emitWarning('AUTOWIN_BRAIN_CORPUS malformé : accès Brain désactivé (fail-closed).', {
    code: 'AUTOWIN_BRAIN_CORPUS_INVALID'
  })
}

/** Slug comparable d'un chemin de workspace : dernier segment, minuscules, espaces en tirets. */
export function workspaceSlug(workspacePath: string): string {
  const name = basename(workspacePath.replace(/[\\/]+$/, ''))
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

/**
 * Fragments de chemin autorisés. `[]` signifie fail-closed ; `undefined` est réservé au wildcard
 * opérateur explicite (aucun filtrage).
 *
 * Échappatoire opérateur : `AUTOWIN_BRAIN_CORPUS` (fragments séparés par des virgules) surclasse la
 * table ; la valeur `*` désactive explicitement le filtrage.
 */
export function brainCorpusForWorkspace(
  workspacePath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  worktreeOwner: (workspacePath: string) => string | undefined = gitWorktreeOwner
): readonly string[] | undefined {
  const configuredOverride = env.AUTOWIN_BRAIN_CORPUS
  if (configuredOverride !== undefined) {
    const override = configuredOverride.trim()
    if (override === '*') return undefined
    const fragments = override.split(',').map((fragment) => fragment.trim().toLowerCase())
    // Le wildcard n'est valide que SEUL et chaque élément doit être explicite. Une virgule finale,
    // une liste vide ou `*,foo` est une erreur de configuration : elle coupe le Brain au lieu de
    // transformer une faute de frappe en accès global.
    if (fragments.some((fragment) => !fragment || fragment === '*' || !isCanonicalCorpusSelector(fragment))) {
      warnInvalidCorpusOverride()
      return []
    }
    return fragments
  }
  if (!workspacePath) return []
  const segments = workspacePath.split(/[\\/]+/).filter(Boolean)
  const direct = WORKSPACE_BRAIN_CORPUS[workspaceSlug(segments.at(-1) ?? '')]
  if (direct) return direct

  // Une copie agent vérifiée conserve l'identité du dépôt sous la forme
  // `<workspace>/.autowin/agent__<id>`. Ne jamais remonter arbitrairement les parents : un dépôt
  // client placé sous `.../autowin-os/` n'est pas pour autant le dépôt Autowin.
  const leaf = segments.at(-1) ?? ''
  const marker = segments.at(-2)?.toLowerCase()
  if (/^agent__[a-z0-9._-]+$/i.test(leaf) && marker === '.autowin') {
    return WORKSPACE_BRAIN_CORPUS[workspaceSlug(segments.at(-3) ?? '')] ?? []
  }

  // Les copies actuelles vivent dans le dossier de données global de l'app, donc leur chemin ne
  // porte PAS le nom du dépôt propriétaire. Leur fichier `.git` le prouve en revanche sans deviner
  // un parent : `gitdir: <dépôt>/.git/worktrees/<copie>`. Cette frontière est aussi valable pour un
  // dépôt externe (RigApplication) et évite de lui attribuer par erreur le corpus d'Autowin OS.
  const owner = worktreeOwner(workspacePath)
  return owner ? WORKSPACE_BRAIN_CORPUS[workspaceSlug(owner)] ?? [] : []
}

function gitWorktreeOwner(workspacePath: string): string | undefined {
  try {
    const pointer = readFileSync(join(workspacePath, '.git'), 'utf8').trim()
    const match = /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/]+\s*$/i.exec(pointer)
    return match ? basename(match[1]) : undefined
  } catch {
    return undefined
  }
}

/** Ramène un chemin absolu/UNC ou relatif à son identité stable `knowledge/...`. */
function normalizedKnowledgePath(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
  if (normalized.startsWith('knowledge/')) return normalized
  const marker = '/knowledge/'
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex >= 0) return normalized.slice(markerIndex + 1)
  return normalized.replace(/^\.\//, '').replace(/^\//, '')
}

/** Exact par défaut ; `/` ou `-` final déclare explicitement une famille de chemins. */
function matchesCorpusSelector(path: string, selector: string): boolean {
  if (!isCanonicalCorpusSelector(selector)) return false
  const normalizedPath = normalizedKnowledgePath(path)
  const normalizedSelector = normalizedKnowledgePath(selector)
  return normalizedSelector.endsWith('/') || normalizedSelector.endsWith('-')
    ? normalizedPath.startsWith(normalizedSelector)
    : normalizedPath === normalizedSelector
}

/** Même règle que le filtrage du bloc, appliquée à un chemin de navigation observé. */
export function brainSourcePathAllowed(
  path: string,
  selectors: readonly string[] | undefined
): boolean {
  if (selectors === undefined) return true
  if (selectors.length === 0) return false
  return selectors.some((selector) => matchesCorpusSelector(path, selector))
}

/** Une attestation HMAC doit reprendre exactement la portée demandée, ordre compris. */
export function brainCorpusAttestationMatches(
  attested: readonly string[] | undefined,
  requested: readonly string[] | undefined
): boolean {
  if (requested === undefined) return true
  return (
    attested !== undefined &&
    attested.length === requested.length &&
    attested.every((selector, index) => selector === requested[index])
  )
}

/** Projette ensemble contexte, statut et navigation après application de la portée workspace. */
export function scopeBrainRetrieval(
  result: BrainRetrievalResult,
  fragments: readonly string[] | undefined
): BrainRetrievalResult {
  if (fragments === undefined) return result
  const attested = brainCorpusAttestationMatches(result.corpus, fragments)
  const structured = attested ? result.structuredContext : undefined
  const sources = structured
    ? structured.sources.filter((source) => brainSourcePathAllowed(source.path, fragments))
    : []
  const context =
    sources.length > 0
      ? (structured?.preamble ?? '') + sources.map((source) => source.content).join(SOURCE_SEPARATOR)
      : ''
  const status = result.status === 'found' && !context ? 'empty' : result.status
  const navigation = result.navigation
    ? {
        ...result.navigation,
        candidates: result.navigation.candidates.map((candidate) => ({
          ...candidate,
          retained:
            attested && candidate.retained && brainSourcePathAllowed(candidate.path, fragments)
        }))
      }
    : undefined
  return {
    ...result,
    context,
    status,
    navigation,
    ...(structured
      ? { structuredContext: { preamble: structured.preamble, sources } }
      : { structuredContext: undefined })
  }
}
