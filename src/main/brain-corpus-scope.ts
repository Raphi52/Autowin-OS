/**
 * PORTEE DU BRAIN. Par defaut : TOUT le Brain, sauf les zones de quarantaine.
 *
 * CE QUE CE MODULE FAISAIT, ET POURQUOI C'EST RETIRE.
 *
 * Il restreignait les sources a une liste blanche de prefixes derivee du nom du workspace. La mesure
 * qui l'avait justifie etait reelle (index du 2026-07-29 : 15 342 chunks, dont 99 % de
 * `knowledge/domain/rigapplication-documentation` et 0,19 % sur Autowin OS) — une question Autowin
 * ramenait des sources RIG par appariement sur un mot commun.
 *
 * Mais la liste n'a jamais suivi le vault. Mesure du 2026-08-12 : le corpus `autowin-os` n'admettait
 * que 11 notes sur les 461 de `knowledge/`, en ignorant `projects/autowin-os/obsidian/` et
 * `knowledge/decisions/` — qui portent l'essentiel des decisions Autowin. La vue Knowledge affichait
 * donc « 11 NOEUDS » pour un Brain de 633 notes, SANS annoncer qu'un filtre etait actif : l'utilisateur
 * a legitimement cru avoir perdu les neuf dixiemes de sa memoire.
 *
 * Et le remede etait redondant avec le mal : la recuperation CLASSE deja par pertinence (dense +
 * lexical + RRF). Un filtre par prefixe pose AU-DESSUS d'un classeur de pertinence ne corrige pas un
 * mauvais classement — il supprime des candidats avant qu'ils soient notes, y compris le meilleur.
 * Le probleme de dominance d'un corpus se traite dans le CLASSEMENT, pas par une liste blanche
 * ecrite a la main qui se perime en silence.
 *
 * Ce qui reste : les zones de quarantaine (`inbox`, `.trash`, `escrow`) sont TOUJOURS exclues, meme
 * sous wildcard — ce ne sont pas du savoir canonique. Et `AUTOWIN_BRAIN_CORPUS` permet a un operateur
 * de re-restreindre EXPLICITEMENT s'il le veut ; une valeur invalide coupe toujours le Brain plutot
 * que de se transformer en acces global par accident.
 */
import { basename } from 'node:path'
import { renderStructuredBrainContext } from './brain-protocol'
import { retrieveBrainContext, type BrainRetrievalResult } from './brain-retrieval'
import type { BrainNoteSearchResult } from './viz/fs-brains'
/** En-tête d'une source : `### Source N — <chemin>`. */

/** Portee d'une execution menee DANS le depot RigApplication : sa propre documentation. */
const RIG_EXECUTION_CORPUS: readonly string[] = [
  'knowledge/domain/rigapplication-documentation/'
]

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
 * table ; la valeur `*` ouvre tout le corpus canonique mais jamais les zones de quarantaine.
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
    // Le wildcard n'est valide que SEUL et chaque element doit etre explicite. Une virgule finale,
    // une liste vide ou `*,foo` est une erreur de configuration : elle coupe le Brain au lieu de
    // transformer une faute de frappe en acces global.
    if (
      fragments.some(
        (fragment) => !fragment || fragment === '*' || !isCanonicalCorpusSelector(fragment)
      )
    ) {
      warnInvalidCorpusOverride()
      return []
    }
    return fragments
  }
  // SEULE restriction survivante, et ce n'est PAS de la pertinence : executer DANS le depot d'un
  // AUTRE produit. Une note Autowin qui entre dans un prompt agissant sur RigApplication est un
  // vecteur de contamination croisee, pas un simple hors-sujet — le classement par pertinence ne
  // protege de rien face a une source redigee pour etre attirante. Le tri par pertinence suffit
  // partout ailleurs, et le Brain d'Autowin reste entier (c'etait le defaut a corriger).
  if (workspacePath !== undefined && workspaceSlug(workspacePath) === 'rigapplication') {
    return RIG_EXECUTION_CORPUS
  }
  return undefined
}

/** Ramène un chemin absolu/UNC ou relatif à son identité stable `knowledge/...`. */
function normalizedKnowledgePath(value: string): string | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
  const markerIndex = normalized.indexOf('/knowledge/')
  const candidate = normalized.startsWith('knowledge/')
    ? normalized
    : markerIndex >= 0
      ? normalized.slice(markerIndex + 1)
      : normalized.replace(/^\//, '')
  const segments = candidate.split('/')
  return segments.some((segment) => !segment || segment === '.' || segment === '..')
    ? undefined
    : candidate
}

/** Exact par défaut ; `/` ou `-` final déclare explicitement une famille de chemins. */
function matchesCorpusSelector(path: string, selector: string): boolean {
  if (!isCanonicalCorpusSelector(selector)) return false
  const normalizedPath = normalizedKnowledgePath(path)
  if (!normalizedPath) return false
  const normalizedSelector = selector.trim().toLowerCase()
  return normalizedSelector.endsWith('/') || normalizedSelector.endsWith('-')
    ? normalizedPath.startsWith(normalizedSelector)
    : normalizedPath === normalizedSelector
}

/** Même règle que le filtrage du bloc, appliquée à un chemin de navigation observé. */
export function brainSourcePathAllowed(
  path: string,
  selectors: readonly string[] | undefined
): boolean {
  const segments = path.trim().toLowerCase().replace(/\\/gu, '/').split('/').filter(Boolean)
  // Ces zones ne sont jamais du savoir canonique, même sous wildcard opérateur.
  if (
    segments.some((segment) => segment === 'inbox' || segment === '.trash' || segment === 'escrow')
  )
    return false
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

function scopeBrainLocalResults(
  results: readonly BrainNoteSearchResult[],
  fragments: readonly string[] | undefined
): BrainNoteSearchResult[] {
  return results
    .filter((result) => brainSourcePathAllowed(result.file, fragments))
    .map((result) => ({
      ...result,
      relations: result.relations.filter((relation) =>
        brainSourcePathAllowed(relation.target, fragments)
      )
    }))
}

/** Projette ensemble contexte, statut et navigation après application de la portée workspace. */
export function scopeBrainRetrieval(
  result: BrainRetrievalResult,
  fragments: readonly string[] | undefined
): BrainRetrievalResult {
  const attested = brainCorpusAttestationMatches(result.corpus, fragments)
  const structured = attested ? result.structuredContext : undefined
  const sources = structured
    ? structured.sources.filter((source) => brainSourcePathAllowed(source.path, fragments))
    : []
  const context =
    sources.length > 0
      ? renderStructuredBrainContext({ preamble: structured?.preamble ?? '', sources })
      : ''
  const status = result.status === 'found' && !context ? 'empty' : result.status
  const navigation = result.navigation
    ? {
        ...result.navigation,
        candidates: attested
          ? result.navigation.candidates
              .filter((candidate) => brainSourcePathAllowed(candidate.path, fragments))
              .map((candidate, index) => ({
                ...candidate,
                rank: index + 1,
                relations: candidate.relations?.filter((relation) =>
                  brainSourcePathAllowed(relation.target, fragments)
                )
              }))
          : []
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

type WorkspaceBrainRetriever = (
  query: string,
  options: { corpus?: readonly string[] }
) => Promise<BrainRetrievalResult>

interface WorkspaceBrainScope {
  corpus: readonly string[] | undefined
  localResults(results: readonly BrainNoteSearchResult[]): BrainNoteSearchResult[]
  retrieve(query: string, retrieve?: WorkspaceBrainRetriever): Promise<BrainRetrievalResult>
}

/** Portée immuable d'une opération : recherche locale et retrieval partagent les mêmes sélecteurs. */
export function brainScopeForWorkspace(workspacePath: string | undefined): WorkspaceBrainScope {
  const corpus = brainCorpusForWorkspace(workspacePath)
  return {
    corpus,
    localResults: (results: readonly BrainNoteSearchResult[]): BrainNoteSearchResult[] =>
      scopeBrainLocalResults(results, corpus),
    retrieve: async (
      query: string,
      retrieve: WorkspaceBrainRetriever = retrieveBrainContext
    ): Promise<BrainRetrievalResult> => {
      const raw =
        corpus?.length === 0
          ? ({ context: '', status: 'empty' } as const)
          : await retrieve(query, { corpus })
      return scopeBrainRetrieval(raw, corpus)
    }
  }
}
