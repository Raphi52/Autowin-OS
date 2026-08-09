import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { amitelWorkspaces } from './amitel-paths'

const run = promisify(execFile)
const MAX_BUFFER = 4 * 1024 * 1024
/** Profondeur de recherche : un dépôt d'équipe n'est jamais enfoui plus bas qu'un ou deux niveaux. */
const MAX_DEPTH = 3

/**
 * INVENTAIRE DES DÉPÔTS — la source de la couronne « repos ».
 *
 * Pourquoi ce module n'est pas une simple recherche de dossiers `.git` : sur cette machine, **6 des
 * 11 dossiers portant un `.git` sont des WORKTREES**, pas des dépôts (`RIG-TV-alertes`,
 * `RIG-TV-dcademat`, `nu`, `pipeline` pointent sur `RIG-TV` ; `wt-edilot3` et
 * `wt-NoComReg-build-20260730` pointent sur `RigApplication`). Les compter aurait annoncé
 * « 11 repos » là où il y en a 5 — exactement l'erreur de nature qui faisait afficher
 * « PROJECTS · 100 » pour 100 NOTES réparties sur 9 projets.
 *
 * La distinction est faite avec `git rev-parse --git-dir` vs `--git-common-dir` : ils diffèrent pour
 * un worktree, ils coïncident pour un dépôt.
 */

export interface RepoEntry {
  /** Nom d'affichage : le dossier du dépôt. */
  name: string
  path: string
  /** Branche courante, absente si détachée ou illisible. */
  branch?: string
  /** Nombre de commits atteignables depuis HEAD, `undefined` si non calculable. */
  commits?: number
  /** Worktrees rattachés à ce dépôt — comptés, jamais présentés comme des dépôts. */
  worktrees: number
}

export interface RepoInventory {
  repos: RepoEntry[]
  /** Racines réellement balayées, pour que la vue puisse dire d'où vient sa liste. */
  roots: string[]
  error?: string
}

/** Vrai quand le dossier est un WORKTREE et non le dépôt lui-même. */
export function isWorktree(gitDir: string, gitCommonDir: string): boolean {
  const normalise = (value: string): string =>
    path
      .resolve(value.trim())
      .replace(/[\\/]+$/, '')
      .toLowerCase()
  return normalise(gitDir) !== normalise(gitCommonDir)
}

/** Le dépôt propriétaire d'un worktree, déduit de son `--git-common-dir` (`<repo>/.git`). */
export function ownerOfWorktree(gitCommonDir: string): string {
  return path.basename(path.dirname(path.resolve(gitCommonDir.trim())))
}

function repoRootOfCommonDir(gitCommonDir: string): string {
  return path.dirname(path.resolve(gitCommonDir.trim()))
}

function canonicalRepoIdentity(repoPath: string): string {
  return path.resolve(repoPath.trim()).replace(/[\\/]+$/, '').toLowerCase()
}

/**
 * `HEAD` n'est pas un nom de branche : c'est ce que git rend sur une tête DÉTACHÉE. L'afficher
 * comme une branche ferait croire à une branche nommée « HEAD » — un mensonge discret mais réel.
 */
export function branchLabel(raw: string | undefined): string | undefined {
  const value = raw?.trim()
  return value && value !== 'HEAD' ? value : undefined
}

/** Un dossier classé, avant repli. Rendu public pour que le cœur soit testable sans git. */
export interface ScannedGitDir {
  path: string
  worktree: boolean
  /** Nom du dépôt propriétaire — lui-même pour un dépôt, le parent pour un worktree. */
  owner: string
  /** Racine canonique du dépôt propriétaire, issue de `--git-common-dir`. */
  ownerPath?: string
  branch?: string
  commits?: number
}

/**
 * LE CŒUR, extrait de toute entrée-sortie : replie une liste de dossiers git en dépôts.
 *
 * Cette extraction n'est pas cosmétique — elle vient d'un échec mesuré. Tant que ce pli vivait à
 * l'intérieur de la fonction qui appelle git, mes tests ne l'exerçaient que sur UN dépôt : trois
 * mutants ont survécu (tri inversé, `HEAD` présentée comme branche, worktrees comptés comme dépôts).
 * Une logique qu'on ne peut atteindre qu'à travers du disque n'est pas testée, elle est survolée.
 */
export function foldRepoScan(scanned: readonly ScannedGitDir[]): RepoEntry[] {
  const repos = new Map<string, RepoEntry>()
  const worktreesByOwner = new Map<string, number>()
  for (const item of scanned) {
    if (item.worktree) {
      const ownerKey = item.ownerPath
        ? canonicalRepoIdentity(item.ownerPath)
        : `name:${item.owner.toLowerCase()}`
      worktreesByOwner.set(ownerKey, (worktreesByOwner.get(ownerKey) ?? 0) + 1)
      continue
    }
    // Un même dépôt atteint par deux racines ne compte qu'une fois.
    repos.set(canonicalRepoIdentity(item.path), {
      name: path.basename(item.path),
      path: item.path,
      ...(item.branch ? { branch: item.branch } : {}),
      ...(item.commits === undefined ? {} : { commits: item.commits }),
      worktrees: 0
    })
  }
  const list = [...repos.values()].map((repo) => ({
    ...repo,
    worktrees:
      worktreesByOwner.get(canonicalRepoIdentity(repo.path)) ??
      worktreesByOwner.get(`name:${repo.name.toLowerCase()}`) ??
      0
  }))
  return sortRepos(list)
}

/**
 * Du plus VIVANT au plus dormant. Le nombre de commits est le seul ordre non arbitraire dont on
 * dispose sans lire les dates ; le nom ne départage que les égalités.
 */
export function sortRepos(repos: readonly RepoEntry[]): RepoEntry[] {
  return [...repos].sort(
    (a, b) => (b.commits ?? 0) - (a.commits ?? 0) || a.name.localeCompare(b.name)
  )
}

export async function readRepoInventory(
  roots: readonly string[] = amitelWorkspaces()
): Promise<RepoInventory> {
  const scannedRoots: string[] = []
  const scanned: ScannedGitDir[] = []
  try {
    for (const root of roots) {
      const candidates = await gitCandidates(root)
      if (candidates.length > 0) scannedRoots.push(root)
      for (const candidate of candidates) {
        const kind = await classify(candidate)
        if (kind) scanned.push({ path: candidate, ...kind })
      }
    }
    // Toute la logique de pli vit dans `foldRepoScan`, testable sans git.
    return { repos: foldRepoScan(scanned), roots: scannedRoots }
  } catch (error) {
    return {
      repos: [],
      roots: scannedRoots,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/** Dossiers contenant un `.git`, jusqu'à `MAX_DEPTH`. Ne suit aucun lien symbolique. */
async function gitCandidates(root: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return []
  const entries = await readdir(root, { withFileTypes: true }).catch(() => undefined)
  if (!entries) return []
  // `.git` peut être un DOSSIER (dépôt) ou un FICHIER (worktree) : les deux comptent comme candidat.
  if (entries.some((entry) => entry.name === '.git')) return [root]
  const found: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    found.push(...(await gitCandidates(path.join(root, entry.name), depth + 1)))
  }
  return found
}

interface Classification {
  worktree: boolean
  owner: string
  ownerPath: string
  branch?: string
  commits?: number
}

async function classify(cwd: string): Promise<Classification | undefined> {
  const gitDir = await git(cwd, ['rev-parse', '--absolute-git-dir'])
  const commonDir = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (!gitDir || !commonDir) return undefined
  const worktree = isWorktree(gitDir, commonDir)
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const countRaw = await git(cwd, ['rev-list', '--count', 'HEAD'])
  const commits = countRaw ? Number.parseInt(countRaw, 10) : Number.NaN
  return {
    worktree,
    owner: ownerOfWorktree(commonDir),
    ownerPath: repoRootOfCommonDir(commonDir),
    // `HEAD` détachée n'est pas une branche : `branchLabel` s'en charge, et c'est testé.
    ...(branchLabel(branch) ? { branch: branchLabel(branch) as string } : {}),
    ...(Number.isFinite(commits) ? { commits } : {})
  }
}

async function git(cwd: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const result = await run('git', [...args], { cwd, windowsHide: true, maxBuffer: MAX_BUFFER })
    return result.stdout.trim() || undefined
  } catch {
    return undefined
  }
}
