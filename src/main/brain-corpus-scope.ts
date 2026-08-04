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
import { basename } from 'node:path'
import type { BrainRetrievalResult } from './brain-retrieval'

/** Séparateur entre deux sources dans le bloc rendu par le Brain (`brain_context.py:128`). */
const SOURCE_SEPARATOR = '\n\n---\n\n'
/** En-tête d'une source : `### Source N — <chemin>`. */
const SOURCE_HEADER = /^### Source \d+ — (.+)$/m

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
  env: NodeJS.ProcessEnv = process.env
): readonly string[] | undefined {
  const configuredOverride = env.AUTOWIN_BRAIN_CORPUS
  if (configuredOverride !== undefined) {
    const override = configuredOverride.trim()
    if (override === '*') return undefined
    const fragments = override.split(',').map((fragment) => fragment.trim().toLowerCase())
    // Le wildcard n'est valide que SEUL et chaque élément doit être explicite. Une virgule finale,
    // une liste vide ou `*,foo` est une erreur de configuration : elle coupe le Brain au lieu de
    // transformer une faute de frappe en accès global.
    if (fragments.some((fragment) => !fragment || fragment === '*')) {
      warnInvalidCorpusOverride()
      return []
    }
    return fragments
  }
  if (!workspacePath) return []
  const segments = workspacePath
    .split(/[\\/]+/)
    .map((segment) => workspaceSlug(segment))
    .filter(Boolean)
    .reverse()
  for (const slug of segments) {
    const corpus = WORKSPACE_BRAIN_CORPUS[slug]
    if (corpus) return corpus
  }
  return []
}

/** Ramène un chemin absolu/UNC ou relatif à son identité stable `knowledge/...`. */
function normalizedKnowledgePath(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (normalized.startsWith('knowledge/')) return normalized
  const marker = '/knowledge/'
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex >= 0) return normalized.slice(markerIndex + 1)
  return normalized.replace(/^\.\//, '').replace(/^\//, '')
}

/** Exact par défaut ; `/` ou `-` final déclare explicitement une famille de chemins. */
function matchesCorpusSelector(path: string, selector: string): boolean {
  const normalizedPath = normalizedKnowledgePath(path)
  const normalizedSelector = normalizedKnowledgePath(selector)
  return normalizedSelector.endsWith('/') || normalizedSelector.endsWith('-')
    ? normalizedPath.startsWith(normalizedSelector)
    : normalizedPath === normalizedSelector
}

/** Une source appartient-elle au corpus ? Comparaison ancrée, insensible à la casse. */
function sourceAllowed(section: string, selectors: readonly string[]): boolean {
  const header = SOURCE_HEADER.exec(section)
  // Un fragment SANS en-tête reconnaissable est conservé : c'est le préambule (signature + consigne
  // anti-injection), pas une source. Le jeter romprait le contrat de confiance du bloc.
  if (!header) return true
  const path = header[1].toLowerCase()
  return selectors.some((selector) => matchesCorpusSelector(path, selector))
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

export interface BrainScopeResult {
  /** Bloc filtré, prêt à injecter. Vide si aucune source du corpus n'a survécu. */
  block: string
  /** Nombre de sources écartées — à journaliser : un filtrage silencieux est indéfendable. */
  dropped: number
  /** Nombre de sources conservées. */
  kept: number
}

/**
 * Restreint un bloc Brain aux sources du corpus. Rend le bloc intact seulement pour le wildcard
 * explicite (`undefined`) et vide pour un corpus fail-closed (`[]`).
 *
 * Si plus aucune source ne survit, le bloc rendu est VIDE : mieux vaut n'injecter rien que le préambule
 * seul, qui coûterait des tokens en n'annonçant aucune connaissance.
 */
export function scopeBrainBlock(
  block: string,
  fragments: readonly string[] | undefined
): BrainScopeResult {
  if (!block.trim()) return { block: '', dropped: 0, kept: 0 }
  if (fragments === undefined) {
    const total = block.split(SOURCE_SEPARATOR).filter((part) => SOURCE_HEADER.test(part)).length
    return { block, dropped: 0, kept: total }
  }
  if (fragments.length === 0) {
    const total = block.split(SOURCE_SEPARATOR).filter((part) => SOURCE_HEADER.test(part)).length
    return { block: '', dropped: total, kept: 0 }
  }
  const parts = block.split(SOURCE_SEPARATOR)
  const kept: string[] = []
  let dropped = 0
  let keptSources = 0
  for (const part of parts) {
    const isSource = SOURCE_HEADER.test(part)
    if (!isSource) {
      kept.push(part)
      continue
    }
    if (sourceAllowed(part, fragments)) {
      kept.push(part)
      keptSources += 1
    } else {
      dropped += 1
    }
  }
  // Aucune source retenue → rien a injecter (le preambule seul ne porte aucune connaissance).
  if (keptSources === 0) return { block: '', dropped, kept: 0 }
  return { block: kept.join(SOURCE_SEPARATOR), dropped, kept: keptSources }
}

/** Projette ensemble contexte, statut et navigation après application de la portée workspace. */
export function scopeBrainRetrieval(
  result: BrainRetrievalResult,
  fragments: readonly string[] | undefined
): BrainRetrievalResult {
  const scoped = scopeBrainBlock(result.context, fragments)
  const status = result.status === 'found' && !scoped.block ? 'empty' : result.status
  const navigation = result.navigation
    ? {
        ...result.navigation,
        candidates: result.navigation.candidates.map((candidate) => ({
          ...candidate,
          retained: candidate.retained && brainSourcePathAllowed(candidate.path, fragments)
        }))
      }
    : undefined
  return { context: scoped.block, status, navigation }
}
