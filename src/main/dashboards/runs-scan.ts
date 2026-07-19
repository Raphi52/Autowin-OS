import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

function safeReaddir(p: string): string[] {
  try {
    return existsSync(p) ? readdirSync(p) : []
  } catch {
    return []
  }
}

/** Découvre et parse tous les RUN.md sous la racine des runs, plus récent d'abord. */
export function scanRuns(root = runsRoot()): RunEntry[] {
  const entries: RunEntry[] = []
  for (const session of safeReaddir(root)) {
    const sessionDir = join(root, session)
    for (const ws of safeReaddir(sessionDir)) {
      const runPath = join(sessionDir, ws, 'RUN.md')
      if (!existsSync(runPath)) continue
      try {
        const md = readFileSync(runPath, 'utf8')
        const subject = ws.replace(/-workspace$/, '')
        entries.push({
          subject,
          session,
          path: runPath,
          mtime: statSync(runPath).mtimeMs,
          summary: parseRun(md, subject)
        })
      } catch {
        /* run illisible — ignoré */
      }
    }
  }
  return entries.sort((a, b) => b.mtime - a.mtime)
}
