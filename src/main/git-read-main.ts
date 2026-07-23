import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseGitStatus, parseGitLog, type GitReadResult } from '../shared/git-read'

const run = promisify(execFile)

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
