import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseGitStatus, parseGitLog, type GitReadResult, type GitDiffResult } from '../shared/git-read'

const run = promisify(execFile)

/** stdout d'une erreur execFile (git renvoie exit≠0 avec un diff valide sur --no-index). */
function stdoutOf(error: unknown): string {
  return error && typeof error === 'object' && 'stdout' in error
    ? String((error as { stdout: unknown }).stdout ?? '')
    : ''
}

/**
 * Diff READ-ONLY d'un fichier (vs HEAD ; fallback --no-index pour un fichier non suivi). N'exécute
 * QUE `git diff` (aucune mutation). Le path vient du renderer → passé en argv (jamais un shell) + `--`.
 */
export async function readGitDiff(cwd: string, path: string): Promise<GitDiffResult> {
  try {
    const r = await run('git', ['diff', '--no-color', 'HEAD', '--', path], { cwd, windowsHide: true })
    let diff = r.stdout
    if (!diff.trim()) {
      try {
        const u = await run('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', path], {
          cwd,
          windowsHide: true
        })
        diff = u.stdout
      } catch (e) {
        diff = stdoutOf(e) // --no-index sort exit 1 QUAND il y a des différences → stdout valide
      }
    }
    return { available: true, diff }
  } catch (error) {
    const stdout = stdoutOf(error)
    if (stdout.trim()) return { available: true, diff: stdout }
    return { available: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Lecture git READ-ONLY pour la surface "Source control". N'exécute QUE status/log (aucune mutation).
 * Les actions git (commit/push/branche) ne passent JAMAIS par ici : elles composent un prompt agent.
 * Dégrade proprement (repo absent / git indispo) → { available:false } sans jamais throw vers l'IPC.
 */
export async function readGitState(cwd: string, historyLimit = 20): Promise<GitReadResult> {
  try {
    const [status, log] = await Promise.all([
      run('git', ['status', '--porcelain=v2', '--branch'], { cwd, windowsHide: true }),
      run('git', ['log', '--pretty=format:%h%x09%s', '-n', String(historyLimit)], {
        cwd,
        windowsHide: true
      })
    ])
    return {
      available: true,
      state: parseGitStatus(status.stdout),
      history: parseGitLog(log.stdout)
    }
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error) }
  }
}
