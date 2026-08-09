import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { parseGitWorktrees, type GitGraphWorktree } from '../shared/git-graph'
import type { WorktreeMapEntry, WorktreeMapSnapshot } from '../shared/worktree-map'
import { diagnoseWorktrees } from './worktree-doctor'

const run = promisify(execFile)
const MAX_BUFFER = 8 * 1024 * 1024
const DEFAULT_BASE_CANDIDATES = ['main', 'master'] as const
/** Une copie enorme ne doit pas faire ramer la vue : au-dela, on arrete de compter et on le dit. */
const SIZE_SCAN_ENTRY_CAP = 40_000

export interface WorktreeMapReadOptions {
  /** Branche de reference du retard. Sinon `main`, puis `master`, puis la tete courante. */
  baseBranch?: string
  /** Coupe la mesure de taille disque : c'est le seul appel non borné en O(1). */
  measureSize?: boolean
}

/**
 * Lecture STRICTEMENT read-only de l'etat des worktrees git, enrichie des trois grandeurs que
 * `git worktree list --porcelain` ne donne pas : retard en commits, fichiers non commités,
 * taille sur disque.
 *
 * Une grandeur qui n'a pas pu etre mesurée reste `undefined`. Elle n'est jamais remplacée par 0 :
 * la vue distingue « propre » de « inconnu », et un 0 par defaut ferait passer une copie non
 * mesurée pour une copie recuperable.
 */
export async function readWorktreeMap(
  cwd: string,
  options: WorktreeMapReadOptions = {}
): Promise<WorktreeMapSnapshot> {
  let repoPath = cwd
  try {
    const rootResult = await run('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      windowsHide: true,
      maxBuffer: MAX_BUFFER
    })
    repoPath = rootResult.stdout.trim() || cwd
    const listResult = await run('git', ['worktree', 'list', '--porcelain', '-z'], {
      cwd: repoPath,
      windowsHide: true,
      maxBuffer: MAX_BUFFER
    })
    const worktrees = parseGitWorktrees(listResult.stdout)
    const baseBranch = await resolveBaseBranch(repoPath, options.baseBranch)
    const baseHead = await shortSha(repoPath, baseBranch)

    const entries = await Promise.all(
      worktrees.map((worktree) =>
        describeWorktree(repoPath, worktree, baseBranch, options.measureSize !== false)
      )
    )

    return {
      available: true,
      repoPath,
      repositoryName: path.basename(repoPath),
      ...(baseBranch ? { baseBranch } : {}),
      ...(baseHead ? { baseHead } : {}),
      entries,
      doctor: diagnoseWorktrees(repoPath, entries)
    }
  } catch (error) {
    // Degrade au lieu de propager : une exception traversant l'IPC laisse la vue muette.
    return {
      available: false,
      repoPath,
      entries: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function describeWorktree(
  repoPath: string,
  worktree: GitGraphWorktree,
  baseBranch: string | undefined,
  measureSize: boolean
): Promise<WorktreeMapEntry> {
  const [behind, dirtyFiles, sizeBytes, pathExists] = await Promise.all([
    baseBranch ? countBehind(repoPath, worktree.head, baseBranch) : Promise.resolve(undefined),
    countDirtyFiles(worktree.path),
    measureSize ? directorySize(worktree.path) : Promise.resolve(undefined),
    exists(worktree.path)
  ])
  return {
    path: worktree.path,
    head: worktree.head.slice(0, 7),
    ...(worktree.branch ? { branch: worktree.branch } : {}),
    detached: worktree.detached,
    locked: worktree.locked,
    ...(worktree.lockedReason ? { lockedReason: worktree.lockedReason } : {}),
    ...(worktree.prunableReason ? { prunableReason: worktree.prunableReason } : {}),
    ...(pathExists === undefined ? {} : { pathExists }),
    ...(behind === undefined ? {} : { behind }),
    ...(dirtyFiles === undefined ? {} : { dirtyFiles }),
    ...(sizeBytes === undefined ? {} : { sizeBytes })
  }
}

async function exists(target: string): Promise<boolean | undefined> {
  try {
    await fs.stat(target)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' ? false : undefined
  }
}

async function resolveBaseBranch(
  repoPath: string,
  requested?: string
): Promise<string | undefined> {
  const candidates = requested ? [requested] : DEFAULT_BASE_CANDIDATES
  for (const candidate of candidates) {
    if (await refExists(repoPath, candidate)) return candidate
  }
  return undefined
}

async function refExists(repoPath: string, ref: string): Promise<boolean> {
  try {
    await run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: repoPath,
      windowsHide: true,
      maxBuffer: MAX_BUFFER
    })
    return true
  } catch {
    return false
  }
}

async function shortSha(repoPath: string, ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined
  try {
    const result = await run('git', ['rev-parse', '--short', ref], {
      cwd: repoPath,
      windowsHide: true,
      maxBuffer: MAX_BUFFER
    })
    return result.stdout.trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Retard = commits presents sur la reference et absents de la copie. C'est `base..head` inversé,
 * soit `head..base` : ce qu'il faudrait tirer pour rattraper. Le sens compte — l'inverse
 * compterait l'avance, pas le retard.
 */
async function countBehind(
  repoPath: string,
  head: string,
  baseBranch: string
): Promise<number | undefined> {
  try {
    const result = await run('git', ['rev-list', '--count', `${head}..${baseBranch}`], {
      cwd: repoPath,
      windowsHide: true,
      maxBuffer: MAX_BUFFER
    })
    const value = Number.parseInt(result.stdout.trim(), 10)
    return Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

async function countDirtyFiles(worktreePath: string): Promise<number | undefined> {
  try {
    const result = await run('git', ['status', '--porcelain'], {
      cwd: worktreePath,
      windowsHide: true,
      maxBuffer: MAX_BUFFER
    })
    return result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0).length
  } catch {
    // Copie absente du disque ou illisible : inconnu, pas propre.
    return undefined
  }
}

/**
 * Somme des tailles de fichiers, en excluant `.git` (partagé avec le dépôt principal : le compter
 * gonflerait chaque copie du poids de l'historique commun). Bornée par `SIZE_SCAN_ENTRY_CAP`.
 */
async function directorySize(root: string): Promise<number | undefined> {
  let total = 0
  let visited = 0
  const stack: string[] = [root]
  try {
    while (stack.length > 0) {
      const current = stack.pop() as string
      const dirents = await fs.readdir(current, { withFileTypes: true })
      for (const dirent of dirents) {
        if (visited >= SIZE_SCAN_ENTRY_CAP) return total
        visited += 1
        const full = path.join(current, dirent.name)
        if (dirent.isDirectory()) {
          if (dirent.name === '.git') continue
          stack.push(full)
        } else if (dirent.isFile()) {
          const stat = await fs.stat(full).catch(() => undefined)
          total += stat?.size ?? 0
        }
      }
    }
    return total
  } catch {
    return visited > 0 ? total : undefined
  }
}
