import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ConversationFileTrace } from './activity/conversation-file-trace-spool'
import { exactLineFingerprint } from './exact-line-fingerprint'
import {
  autoCloseBranch,
  autoCloseRun,
  defaultGitRunner,
  parsePorcelainPaths,
  type AutoCloseReport,
  type GitRunner,
  type PrOpener
} from './run-autoclose'

/**
 * ENCHAÎNEMENT AUTO DU CHAT.
 *
 * Choix de l'utilisateur (conv-871, 2026-09-26) : « aussi le travail du chat : à la fin de chaque tour
 * qui a modifié des fichiers, commit de ces fichiers-là puis push ». Avant, l'interrupteur ne se
 * déclenchait qu'à la fin d'une tâche d'agent (`os.ts`, `closeGreenRun`). Mesuré du 24/09 20:13 au
 * 26/09 13:50 : 64 commits sur main, 1 seul publié tout seul, les 63 autres poussés à la main.
 *
 * LE DOSSIER EST PARTAGÉ PAR PLUSIEURS FILS, et le journal des fichiers attribue aussi à un tour ce
 * qu'un autre fil a écrit pendant qu'il tournait (mesuré le 2026-09-26 : `ChatComposer.tsx`, écrit par
 * conv-870, attribué aussi à conv-871 et conv-869 par la comparaison avant/après). Un fichier n'est
 * donc publié que s'il est PROUVÉ au fil :
 *  1. par ses LIGNES : chaque ligne ajoutée de son diff a été écrite par un outil d'édition du fil ;
 *  2. à défaut (édition en ligne de commande, suppression, renommage) : il était propre au début du
 *     tour ET aucun autre fil ne l'a touché depuis.
 * Le reste est LAISSÉ en attente et nommé dans le rapport. Un faux négatif laisse un fichier non
 * publié, visible dans le panneau ; un faux positif pousserait le travail d'un autre fil sans lui.
 */

/** Travail propre au chat. `subagent` en est exclu : une tâche d'agent publie elle-même son travail. */
const SOURCES_DU_CHAT: ReadonlySet<ConversationFileTrace['source']> = new Set([
  'chat_tool',
  'edit_file',
  'file_command'
])

/** Au-delà, un fichier non suivi n'est pas relu pour la preuve par lignes (binaire, export…). */
const TAILLE_MAX_PREUVE = 2 * 1024 * 1024

export interface ChatTurnStart {
  /** Instant de départ du tour : toute trace d'un autre fil ultérieure est du travail concurrent. */
  startedAt: number
  /** Racine du dépôt git du tour ; absente = pas de dépôt lisible, donc rien à publier. */
  repo?: string
  /** Chemins (relatifs au dépôt) déjà modifiés au départ du tour. */
  dirty: string[]
}

type Exclusion = NonNullable<AutoCloseReport['exclus']>[number]

function cle(path: string): string {
  const normalized = resolve(path).replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function absoluDeTrace(racine: string, path: string): string {
  return resolve(
    racine,
    path
      .trim()
      .replaceAll('\\', '/')
      .replace(/^\.\/+/, '')
  )
}

/**
 * Chemin RÉEL d'un dossier : git rend la forme longue (`raphael.vilain`), un dossier temporaire
 * Windows peut arriver en nom court (`RAPHAE~1.VIL`). Sans cette résolution, le même fichier aurait
 * deux clés et le tour ne reconnaîtrait pas le sien.
 */
async function cheminsReels(dossiers: Iterable<string>): Promise<Map<string, string>> {
  const reels = new Map<string, string>()
  for (const dossier of new Set(dossiers))
    reels.set(dossier, await realpath(dossier).catch(() => dossier))
  return reels
}

function dansLeDepot(repo: string, absolu: string): boolean {
  const rel = relative(repo, absolu)
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * La photo est ATTENDUE avant que le tour parte (~65 ms mesurées sur D:\AutoWinOS). Un git bloqué
 * (dossier réseau, verrou) ne doit jamais retenir la réponse : passé ce délai, le tour part sans
 * photo, donc sans publication.
 */
const DELAI_MAX_PHOTO_MS = 5_000

/** Photo prise AVANT le tour : ce qui était déjà modifié n'appartient pas au tour. */
export async function photographierDebutDeTour(
  workspaceRoot: string,
  runGit?: GitRunner,
  now: number = Date.now(),
  delaiMaxMs: number = DELAI_MAX_PHOTO_MS
): Promise<ChatTurnStart> {
  const sansPhoto: ChatTurnStart = { startedAt: now, dirty: [] }
  // Un dossier vide ferait tourner git dans le dossier courant du processus : jamais celui du tour.
  if (!workspaceRoot.trim()) return sansPhoto
  const photo = async (): Promise<ChatTurnStart> => {
    const git = runGit ?? (await defaultGitRunner())
    const repo = (await git(['rev-parse', '--show-toplevel'], workspaceRoot)).trim()
    if (!repo) return sansPhoto
    const dirty = parsePorcelainPaths(await git(['status', '--porcelain=v1', '-z', '-uall'], repo))
    return { startedAt: now, repo, dirty }
  }
  let minuteur: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      photo(),
      new Promise<ChatTurnStart>((resolveDelai) => {
        minuteur = setTimeout(() => resolveDelai(sansPhoto), delaiMaxMs)
      })
    ])
  } catch {
    // Sans photo fiable, on ne saurait pas ce qui préexistait : aucun dépôt, donc aucune publication.
    return sansPhoto
  } finally {
    if (minuteur) clearTimeout(minuteur)
  }
}

/** Lignes non vides ajoutées par rapport à HEAD (fichier suivi) ou contenu entier (non suivi). */
async function lignesAjoutees(repo: string, gitPath: string, runGit: GitRunner): Promise<string[]> {
  const diff = await runGit(
    ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=0', 'HEAD', '--', gitPath],
    repo
  )
  if (!diff.trim()) {
    const absolu = resolve(repo, gitPath)
    const info = await stat(absolu).catch(() => undefined)
    if (!info?.isFile() || info.size > TAILLE_MAX_PREUVE) return []
    return (await readFile(absolu, 'utf8')).split(/\r?\n/).filter((line) => line.trim())
  }
  const ajoutees: string[] = []
  let dansUnBloc = false
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) dansUnBloc = false
    else if (line.startsWith('@@')) dansUnBloc = true
    else if (dansUnBloc && line.startsWith('+') && line.slice(1).trim())
      ajoutees.push(line.slice(1))
  }
  return ajoutees
}

async function prouveParLignes(
  repo: string,
  gitPath: string,
  revendiquees: ReadonlySet<string> | undefined,
  runGit: GitRunner
): Promise<boolean> {
  if (!revendiquees?.size) return false
  try {
    const ajoutees = await lignesAjoutees(repo, gitPath, runGit)
    return (
      ajoutees.length > 0 && ajoutees.every((line) => revendiquees.has(exactLineFingerprint(line)))
    )
  } catch {
    return false
  }
}

function messageDeCommit(conversationId: string, request: string): string {
  const head = request.replace(/\s+/g, ' ').trim().slice(0, 100) || 'travail du chat'
  return `auto(${conversationId}): ${head}`
}

/**
 * Publie les fichiers PROUVÉS d'un tour de chat terminé : commit de ces seuls fichiers, puis push
 * sur la branche courante ; si le dépôt refuse, branche dédiée + PR (même règle que les tâches
 * d'agent). Rend `undefined` quand le tour n'a laissé aucun fichier en attente : le dernier rapport
 * affiché reste alors celui d'avant, au lieu d'un « aucun changement » à chaque question.
 */
export async function publierTourDeChat(input: {
  conversationId: string
  turnId: string
  /** Demande de l'utilisateur : sert au message de commit. */
  request: string
  debut: ChatTurnStart
  traces: readonly ConversationFileTrace[]
  runGit?: GitRunner
  openPr?: PrOpener
}): Promise<AutoCloseReport | undefined> {
  const { conversationId, turnId, debut } = input
  if (!debut.repo) return undefined
  const runGit = input.runGit ?? (await defaultGitRunner())
  const racines = await cheminsReels([
    debut.repo,
    ...input.traces
      .map((trace) => trace.workspaceRoot)
      .filter((root): root is string => typeof root === 'string' && Boolean(root.trim()))
  ])
  const repo = racines.get(debut.repo) ?? debut.repo

  const duTour = new Set<string>()
  const revendiquees = new Map<string, Set<string>>()
  const concurrents = new Set<string>()
  for (const trace of input.traces) {
    if (typeof trace.workspaceRoot !== 'string' || !trace.workspaceRoot.trim()) continue
    const racine = racines.get(trace.workspaceRoot) ?? trace.workspaceRoot
    const autreFil = trace.conversationId !== conversationId
    const pendantLeTour = Date.parse(trace.timestamp) >= debut.startedAt
    for (const path of trace.paths) {
      const absolu = absoluDeTrace(racine, path)
      if (!dansLeDepot(repo, absolu)) continue
      const key = cle(absolu)
      if (autreFil) {
        if (pendantLeTour) concurrents.add(key)
        continue
      }
      if (!SOURCES_DU_CHAT.has(trace.source)) continue
      if (trace.turnId === turnId) duTour.add(key)
      const lignes = Object.entries(trace.pathLineFingerprints ?? {}).find(
        ([candidate]) => cle(absoluDeTrace(racine, candidate)) === key
      )?.[1]
      if (lignes?.length) {
        const set = revendiquees.get(key) ?? new Set<string>()
        for (const line of lignes) set.add(line)
        revendiquees.set(key, set)
      }
    }
  }
  if (duTour.size === 0) return undefined

  let enAttente: string[]
  try {
    enAttente = parsePorcelainPaths(
      await runGit(['status', '--porcelain=v1', '-z', '-uall'], repo)
    ).filter((gitPath) => duTour.has(cle(resolve(repo, gitPath))))
  } catch (error) {
    return rapport(input, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    })
  }
  // Tout est déjà commité (le tour l'a fait lui-même) : rien à publier au nom du tour.
  if (enAttente.length === 0) return undefined

  const salesAuDepart = new Set(debut.dirty.map((gitPath) => cle(resolve(repo, gitPath))))
  const publier: string[] = []
  const exclus: Exclusion[] = []
  for (const gitPath of enAttente) {
    const key = cle(resolve(repo, gitPath))
    if (await prouveParLignes(repo, gitPath, revendiquees.get(key), runGit)) publier.push(gitPath)
    else if (salesAuDepart.has(key)) exclus.push({ path: gitPath, motif: 'modifie-avant-le-tour' })
    else if (concurrents.has(key)) exclus.push({ path: gitPath, motif: 'touche-par-un-autre-fil' })
    else publier.push(gitPath)
  }
  // GARDE-FOU : `autoCloseRun` sans chemins publierait TOUT l'arbre (`add -A`).
  if (publier.length === 0)
    return rapport(input, { status: 'skipped', reason: 'unattributed' }, exclus)
  const project = await autoCloseRun({
    repo,
    branch: brancheDuTour(conversationId, turnId),
    message: messageDeCommit(conversationId, input.request),
    paths: publier,
    runGit,
    direct: true,
    ...(input.openPr ? { openPr: input.openPr } : {})
  })
  return rapport(input, project, exclus)
}

function brancheDuTour(conversationId: string, turnId: string): string {
  return autoCloseBranch(`${conversationId}-${turnId.slice(0, 8)}`)
}

function rapport(
  input: { conversationId: string; turnId: string },
  project: AutoCloseReport['project'],
  exclus: Exclusion[] = []
): AutoCloseReport {
  return {
    runId: `${input.conversationId} · tour ${input.turnId.slice(0, 8)}`,
    branch: brancheDuTour(input.conversationId, input.turnId),
    project,
    at: new Date().toISOString(),
    source: 'chat',
    ...(exclus.length ? { exclus } : {})
  }
}
