import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseRun, type RunSummary } from './runs'

/**
 * Scanne les RUN.md vivants du kit autowin (~/.claude/runs/<session>/<sujet>-workspace/RUN.md)
 * et renvoie un résumé parsé de chacun — la "visualisation du workflow des skills"
 * (candidat ④). Lecture disque, côté main uniquement.
 */
export interface RunEntry {
  subject: string
  session: string
  path: string
  mtime: number
  summary: RunSummary
}

/** Racine des runs (override possible via AUTOWIN_RUN_ROOT). */
export function runsRoot(): string {
  if (process.env.AUTOWIN_RUN_ROOT) return process.env.AUTOWIN_RUN_ROOT
  return join(process.env.USERPROFILE ?? '.', '.claude', 'runs')
}

async function safeReaddir(p: string): Promise<string[]> {
  try {
    return await readdir(p)
  } catch {
    return []
  }
}

/** Découvre et parse tous les RUN.md sous la racine des runs, plus récent d'abord. */
export async function scanRuns(
  root = runsRoot(),
  options: { limit?: number } = {}
): Promise<RunEntry[]> {
  const entries: RunEntry[] = []
  for (const session of await safeReaddir(root)) {
    const sessionDir = join(root, session)
    for (const ws of await safeReaddir(sessionDir)) {
      const runPath = join(sessionDir, ws, 'RUN.md')
      try {
        const [md, runStat] = await Promise.all([readFile(runPath, 'utf8'), stat(runPath)])
        const subject = ws.replace(/-workspace$/, '')
        entries.push({
          subject,
          session,
          path: runPath,
          mtime: runStat.mtimeMs,
          summary: parseRun(md, subject)
        })
      } catch {
        /* run illisible — ignoré */
      }
    }
  }
  const limit =
    options.limit === undefined ? entries.length : Math.max(0, Math.floor(options.limit))
  return entries.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}
