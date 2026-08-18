import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
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

export interface ScanRunsOptions {
  /** Nombre maximum de RUN.md RÉELLEMENT lus et parsés (les plus récents d'abord). */
  limit?: number
  /** Restreint la traversée à ces sessions/conversations. Absent = toutes. */
  sessions?: string[]
}

export interface ScanRunsResult {
  entries: RunEntry[]
  /** Candidats écartés par la borne. > 0 = la liste est TRONQUÉE, jamais en silence. */
  remaining: number
}

/**
 * Découvre et parse les RUN.md sous la racine, plus récent d'abord — avec une borne qui porte
 * sur les LECTURES, pas seulement sur la sortie.
 *
 * Pourquoi la borne ne pouvait pas rester un simple `slice` : la version précédente lisait et
 * parsait TOUS les fichiers puis tranchait. Sur la racine dev mesurée le 2026-08-18 (11 784
 * RUN.md), cela coûtait ~15 s à froid pour n'en garder que quelques dizaines — et `listConvRuns`
 * payait ce prix à chaque affichage d'une conversation. On stat d'abord (cheap), on trie, et on
 * ne `readFile` que les `limit` plus récents.
 */
export async function scanRunsBounded(
  root = runsRoot(),
  options: ScanRunsOptions = {}
): Promise<ScanRunsResult> {
  const sessionFilter = options.sessions ? new Set(options.sessions) : undefined
  const sessions = sessionFilter
    ? (await safeReaddir(root)).filter((s) => sessionFilter.has(s))
    : await safeReaddir(root)

  const candidates: { subject: string; session: string; path: string; mtime: number }[] = []
  for (const session of sessions) {
    const sessionDir = join(root, session)
    for (const ws of await safeReaddir(sessionDir)) {
      const runPath = join(sessionDir, ws, 'RUN.md')
      try {
        const runStat = await stat(runPath)
        candidates.push({
          subject: ws.replace(/-workspace$/, ''),
          session,
          path: runPath,
          mtime: runStat.mtimeMs
        })
      } catch {
        /* pas de RUN.md ici — ignoré */
      }
    }
  }

  candidates.sort((a, b) => b.mtime - a.mtime)
  const limit =
    options.limit === undefined ? candidates.length : Math.max(0, Math.floor(options.limit))
  const retenus = candidates.slice(0, limit)

  const entries: RunEntry[] = []
  for (const candidate of retenus) {
    try {
      const md = await readFile(candidate.path, 'utf8')
      entries.push({ ...candidate, summary: parseRun(md, candidate.subject) })
    } catch {
      /* run illisible — ignoré */
    }
  }

  return { entries, remaining: candidates.length - retenus.length }
}

/** Variante historique : la liste seule. */
export async function scanRuns(
  root = runsRoot(),
  options: ScanRunsOptions = {}
): Promise<RunEntry[]> {
  return (await scanRunsBounded(root, options)).entries
}

function comparablePath(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLocaleLowerCase('en-US') : absolute
}

/** Supprime uniquement un workspace dont le RUN.md figure encore dans le scan global courant. */
export async function deleteListedRun(runPath: string, root = runsRoot()): Promise<void> {
  const candidate = comparablePath(runPath)
  const listedRun = (await scanRuns(root)).find((run) => comparablePath(run.path) === candidate)
  if (!listedRun) throw new Error('RUN non autorisé dans la liste globale')
  await rm(dirname(listedRun.path), { recursive: true, force: false })
}
