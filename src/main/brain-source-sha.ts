/**
 * SHA COURANT d'un chemin de dépôt — de quoi dire « cette fiche cite un commit dépassé ».
 *
 * Les locators `git:<chemin>@<sha>` de `brain-remember.ts` ancrent un fait à un commit précis. Sans
 * comparaison, l'âge d'une fiche ne dit rien : une fiche de six mois sur un fichier jamais retouché
 * reste juste, une fiche d'hier sur un fichier réécrit ce matin est périmée. On résout donc le sha du
 * DERNIER commit touchant ce fichier, dans le workspace qui le contient.
 *
 * Bornage : les chemins sont dédupliqués puis groupés par lots de 50, avec timeout court ; tout échec
 * devient `undefined` (le signal s'affiche alors « non vérifié », jamais « à jour » par défaut).
 */
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { foldWindowsOrdinalCase } from './viz/windows-ordinal-case'

export type ShaBatchExec = (
  workspace: string,
  paths: readonly string[],
  timeoutMs: number
) => ReadonlyMap<string, string>

export const MAX_SHA_PATHS_PER_BATCH = 50
export const SHA_RESOLUTION_BUDGET_MS = 2_500
const MAX_SHA_BATCH_TIMEOUT_MS = 3_000

function cleanLocatorPath(path: string): string | undefined {
  const clean = path.trim().replace(/\\/g, '/')
  if (!clean) return undefined
  if (!isAbsolute(clean) && clean.split('/').includes('..')) return undefined
  return isAbsolute(clean) ? clean : normalize(clean).replace(/\\/g, '/').replace(/^\.\//, '')
}

function repositoryPathIdentity(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return process.platform === 'win32' ? foldWindowsOrdinalCase(normalized) : normalized
}

function repositoryPath(workspace: string, locatorPath: string): string | undefined {
  if (!isAbsolute(locatorPath)) return locatorPath
  const inside = relative(resolve(workspace), resolve(locatorPath))
  if (!inside || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
    return undefined
  }
  return inside.replace(/\\/g, '/')
}

function realRepositoryPath(
  workspace: string,
  realWorkspace: string,
  repoPath: string
): string | undefined {
  try {
    const realFile = realpathSync.native(resolve(workspace, repoPath))
    const inside = relative(realWorkspace, realFile)
    if (!inside || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
      return undefined
    }
    return inside.replace(/\\/g, '/')
  } catch {
    return undefined
  }
}

/**
 * Résout un lot de chemins dans un seul historique Git. Le premier commit rencontré pour chaque
 * chemin est le plus récent ; les lots bornent la ligne de commande et la taille de sortie.
 */
export function gitLogShaBatchExec(): ShaBatchExec {
  return (workspace, paths, timeoutMs) => {
    try {
      const out = execFileSync(
        'git',
        [
          '-c',
          'core.quotePath=false',
          'log',
          '--no-renames',
          '--format=%x1e%H',
          '--name-only',
          '-z',
          '--',
          ...paths
        ],
        {
          cwd: workspace,
          encoding: 'utf8',
          timeout: Math.max(1, Math.min(timeoutMs, MAX_SHA_BATCH_TIMEOUT_MS)),
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore']
        }
      )
      const wanted = new Map(paths.map((path) => [repositoryPathIdentity(path), path]))
      const resolved = new Map<string, string>()
      let sha: string | undefined
      for (const token of out.split('\0')) {
        if (!token) continue
        const record = token.replace(/^\r?\n/, '')
        const commit = record.charCodeAt(0) === 0x1e ? record.slice(1) : undefined
        if (commit && /^[0-9a-f]{40}$/i.test(commit)) {
          sha = commit
          continue
        }
        const path = token.replace(/^\r?\n+/, '').replace(/\\/g, '/')
        const requestedPath = wanted.get(repositoryPathIdentity(path))
        if (sha && requestedPath && !resolved.has(requestedPath)) resolved.set(requestedPath, sha)
      }
      return resolved
    } catch {
      return new Map()
    }
  }
}

/** Résolution groupée utilisée dans le worker inbox : au plus un appel par lot de 50 chemins. */
export function resolveHeadShas(
  workspaces: readonly string[],
  paths: readonly string[],
  exec: ShaBatchExec = gitLogShaBatchExec(),
  now: () => number = () => performance.now()
): ReadonlyMap<string, string> {
  const deadline = now() + SHA_RESOLUTION_BUDGET_MS
  const unresolved = new Map(
    paths.flatMap((path) => {
      const clean = cleanLocatorPath(path)
      return clean ? ([[path, clean]] as const) : []
    })
  )
  const resolved = new Map<string, string>()
  for (const workspace of workspaces) {
    let realWorkspace: string
    try {
      realWorkspace = realpathSync.native(resolve(workspace))
    } catch {
      continue
    }
    const entriesByIdentity = new Map<string, { path: string; aliases: string[] }>()
    for (const [lookupPath, locatorPath] of unresolved) {
      const candidatePath = repositoryPath(workspace, locatorPath)
      if (!candidatePath) continue
      const repoPath = realRepositoryPath(workspace, realWorkspace, candidatePath)
      if (!repoPath) continue
      const identity = repositoryPathIdentity(repoPath)
      const entry = entriesByIdentity.get(identity) ?? { path: repoPath, aliases: [] }
      entry.aliases.push(lookupPath)
      entriesByIdentity.set(identity, entry)
    }
    const aliasesByRepositoryPath = new Map(
      [...entriesByIdentity.values()].map((entry) => [entry.path, entry.aliases])
    )
    const present = [...aliasesByRepositoryPath.keys()]
    for (let offset = 0; offset < present.length; offset += MAX_SHA_PATHS_PER_BATCH) {
      const remainingMs = Math.floor(deadline - now())
      if (remainingMs <= 0) return resolved
      const batch = present.slice(offset, offset + MAX_SHA_PATHS_PER_BATCH)
      const batchResult = exec(workspace, batch, Math.min(MAX_SHA_BATCH_TIMEOUT_MS, remainingMs))
      if (now() > deadline) return resolved
      for (const [path, sha] of batchResult) {
        if (!sha) continue
        for (const lookupPath of aliasesByRepositoryPath.get(path.replace(/\\/g, '/')) ?? []) {
          resolved.set(lookupPath, sha)
          unresolved.delete(lookupPath)
        }
      }
    }
  }
  return resolved
}
