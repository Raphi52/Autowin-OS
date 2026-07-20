import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotWorkspace } from './branch-snapshots'

function git(repo: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env
  }).trim()
}

/**
 * Restaure le working tree au contenu d'un snapshot (créé par snapshotWorkspace).
 * SÛR et RÉVERSIBLE (gardes R1/R4 du RUN branches-rewind) :
 *  1. prend d'abord un snapshot de SÉCURITÉ de l'état courant (renvoyé pour undo) ;
 *  2. réécrit les fichiers du snapshot via un GIT_INDEX_FILE temporaire (index/HEAD
 *     utilisateur intouchés), SANS supprimer les fichiers créés après le snapshot
 *     (non destructif — jamais de reset/clean qui effacerait du travail).
 * Renvoie le sha du snapshot de sécurité : `restoreWorkspace(repo, safety)` annule.
 */
/** Erreur de restore préservant le sha du snapshot de sécurité pour permettre l'annulation. */
export class RestoreFailedError extends Error {
  constructor(
    message: string,
    readonly safetySha: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'RestoreFailedError'
  }
}

export function restoreWorkspace(repo: string, snapshot: string): string {
  const safety = snapshotWorkspace(repo, `pre-restore ${snapshot}`)
  const indexDir = mkdtempSync(join(tmpdir(), 'autowin-idx-'))
  const env: NodeJS.ProcessEnv = { GIT_INDEX_FILE: join(indexDir, 'index') }
  try {
    git(repo, ['read-tree', snapshot], env) // index temporaire = arbre du snapshot
    git(repo, ['checkout-index', '-f', '-a'], env) // réécrit les fichiers du snapshot dans le WT
    return safety
  } catch (error) {
    // R4 : même si checkout-index échoue à mi-course (read-only/lock/symlink), le sha du
    // snapshot de sécurité DOIT remonter pour que l'appelant puisse annuler l'état hybride.
    throw new RestoreFailedError(
      `Restore échoué (état hybride possible) — annuler via safetySha=${safety}`,
      safety,
      error
    )
  } finally {
    rmSync(indexDir, { recursive: true, force: true })
  }
}
