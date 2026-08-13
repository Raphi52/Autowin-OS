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
 * CE QUI RESTE, exhaustivement — deux choses, et rien d'autre :
 *
 * 1. Les zones de QUARANTAINE (`inbox`, `.trash`, `escrow`) sont TOUJOURS exclues, meme sous
 *    wildcard : ce n'est pas du savoir canonique. Deux couches independantes l'assurent, chacune
 *    SUFFISANTE seule (verifie par sabotage : desarmer l'une laisse les tests verts, desarmer les
 *    deux fait remonter `inbox/note`) — `SKIPPED_VAULT_DIRS` (`viz/fs-brains.ts`) pour le parcours
 *    disque, et `brainSourcePathAllowed` ici pour les chemins ANNONCES par la recuperation. Cette
 *    seconde couche compte : les chemins de sources viennent du serveur Brain, donc rien ne garantit
 *    qu'ils correspondent a un dossier reel.
 * 2. `AUTOWIN_BRAIN_CORPUS` permet a un operateur de re-restreindre EXPLICITEMENT ; une valeur
 *    invalide coupe le Brain (fail-closed) plutot que de devenir un acces global par accident.
 *
 * Aucune restriction n'est plus derivee du chemin du workspace. Une exception RigApplication a ete
 * ajoutee puis RETIREE le meme jour (2026-08-13) : elle ne pouvait pas se declencher, et affichait
 * donc une protection inexistante — le detail est dans `brainCorpusForWorkspace`.
 */
import { basename } from 'node:path'
import { renderStructuredBrainContext } from './brain-protocol'
import { retrieveBrainContext, type BrainRetrievalResult } from './brain-retrieval'
import type { BrainNoteSearchResult } from './viz/fs-brains'
/** En-tête d'une source : `### Source N — <chemin>`. */

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
 * Fragments de chemin autorisés, ou `undefined` = AUCUN filtrage (le cas par défaut désormais).
 *
 * `[]` ne subsiste que pour UN cas : un `AUTOWIN_BRAIN_CORPUS` malformé, qui coupe le Brain plutôt
 * que de devenir un accès global par faute de frappe. Il n'y a plus de « table » à surclasser — ce
 * JSDoc en parlait encore alors qu'elle avait été supprimée, et décrivait donc un module disparu.
 * `AUTOWIN_BRAIN_CORPUS=*` ouvre tout le corpus canonique, jamais la quarantaine.
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
  // AUCUNE restriction derivee du workspace. Une exception « isolation RigApplication » a existe ici
  // du 2026-08-13 au meme jour : elle n'a JAMAIS pu se declencher. Le workspace vient de
  // `resolveExecutionWorkspace` → `gitWorkspaceFrom` (`os.ts:109`), qui exige `.git` ET
  // `package.json` dans le meme dossier ; `C:\Code RIG\RigApplication` est un depot .NET sans
  // `package.json`, donc le slug ne valait jamais `rigapplication`. Elle affichait une protection
  // inexistante — pire qu'aucune protection.
  //
  // Et le motif ne tenait pas non plus : la mesure d'origine (2026-07-29, index a 15 342 fragments
  // dont 99 % de doc RIG) decrit une DOMINANCE de corpus, que le classement (dense + lexical + RRF)
  // traite mieux qu'une liste blanche. Un filtre par prefixe pose AU-DESSUS d'un classeur supprime
  // des candidats avant qu'ils soient notes, y compris le meilleur — c'est ce qui masquait 450 des
  // 461 notes. Le Brain est le vault de l'equipe, pas une entree hostile : le modele de menace
  // « source adverse » supposait une note piegee dans sa propre memoire.
  //
  // Si des sources RIG polluent un jour les reponses Autowin, le correctif est dans le CLASSEMENT.
  void workspacePath
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
  // Chaque SEGMENT est nettoyé, pas seulement la chaîne entière : `knowledge/ inbox /x.md`,
  // `knowledge/ escrow/x.md` et `knowledge/inbox./x.md` franchissaient la quarantaine (mesuré), là où
  // `knowledge/inbox/x.md` était bien rejeté. Ces chemins ne viennent PAS du disque mais de la
  // RÉCUPÉRATION — ce sont les sources annoncées par le serveur Brain — donc rien ne garantit qu'ils
  // soient des chemins réels : une source adverse peut se nommer ainsi. Windows tolère mal l'espace
  // ou le point final dans un nom de dossier, ce qui rendait ce trou invisible aux essais locaux.
  const segments = path
    .toLowerCase()
    .replace(/\\/gu, '/')
    .split('/')
    .map((segment) => segment.trim().replace(/\.+$/u, ''))
    .filter(Boolean)
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
