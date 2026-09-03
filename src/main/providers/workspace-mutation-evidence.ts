import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { realpathSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { readGitDiff, readGitState } from '../git-read-main'
import type { ExecutionEvidence } from './types'
import {
  addedLineFingerprintsFromUnifiedDiff,
  exactLineFingerprint
} from '../exact-line-fingerprint'
import {
  beginAtEnd,
  captureFileGenerationMarker,
  captureFileGenerationMarkerSync,
  readNewLines,
  type FileTailState
} from '../task-manager/watchdog-file-source'

export type WorkspaceMutationSnapshot = ReadonlyMap<string, string> & {
  generationMarkers: ReadonlyMap<string, string>
  lineFingerprints: ReadonlyMap<string, readonly string[]>
  /** Positions exactes des fichiers surveillés, y compris ignorés par Git. */
  observedTails: ReadonlyMap<string, FileTailState>
}

const watcherSessionId = randomUUID()
const watchedDirectories = new Map<string, FSWatcher>()
const pathWatchGenerations = new Map<string, number>()

/**
 * Forme CANONIQUE d'un chemin — la seule que `fs.watch` accepte sans tuer le processus.
 *
 * DÉFAUT REPRODUIT (2026-08-31, exit 127) : `fs.watch` sur un dossier dont le chemin traverse un
 * nom court 8.3 de Windows (`C:\Users\RAPHAE~1.VIL\...`, la forme que rend `os.tmpdir()` sur ce
 * poste) fait ABORTER le processus — `Assertion failed: !_wcsnicmp(filename, dir, dirlen), file
 * src\win\fs-event.c, line 72`. libuv compare le nom LONG que Windows lui rend dans l'événement au
 * chemin COURT qu'on lui a donné : ils diffèrent, il assert. Reproduit en isolation sur 5 fichiers
 * touchés : chemin court → exit 127 ; MÊME dossier via `realpathSync.native` → exit 0, événements
 * reçus. Ni le `try/catch` ci-dessous ni `watcher.on('error')` n'y peuvent quoi que ce soit : un
 * `abort()` en C n'est pas une exception JS. C'est ce qui tuait `vitest run` en cours de suite.
 *
 * On canonicalise donc AVANT de watcher, et on le fait dans `filesystemPathKey` pour que la clé de
 * lecture et la clé d'écriture des générations restent la MÊME chaîne. Un chemin encore absent
 * (cas normal : on surveille l'apparition d'un fichier) n'a pas de realpath : on canonicalise alors
 * son parent et on rattache le nom.
 */
export function realCanonique(chemin: string): string {
  try {
    return realpathSync.native(chemin)
  } catch {
    const parent = dirname(chemin)
    if (parent === chemin) return chemin
    try {
      return join(realpathSync.native(parent), basename(chemin))
    } catch {
      return chemin
    }
  }
}

function filesystemPathKey(path: string): string {
  const normalized = realCanonique(resolve(path)).replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function ensurePathGenerationWatcher(absolutePath: string): void {
  // Le dossier REELLEMENT surveille : jamais la forme courte 8.3 recue en argument.
  const parent = realCanonique(dirname(absolutePath))
  const parentKey = filesystemPathKey(parent)
  if (watchedDirectories.has(parentKey)) return
  try {
    const watcher = watch(parent, { persistent: false }, (_event, filename) => {
      if (!filename) return
      const changedPath = filesystemPathKey(resolve(parent, filename.toString()))
      const generation = (pathWatchGenerations.get(changedPath) ?? 0) + 1
      pathWatchGenerations.set(changedPath, generation)
    })
    watcher.on('error', () => {
      watcher.close()
      watchedDirectories.delete(parentKey)
    })
    watchedDirectories.set(parentKey, watcher)
  } catch {
    // Le marqueur de contenu/stat reste disponible même si le watcher n'est pas supporté.
  }
}

async function settlePathGenerationEvents(): Promise<void> {
  await new Promise<void>((resolveSettle) => setTimeout(resolveSettle, 10))
}

/**
 * Marqueur de génération du fichier de travail, distinct du contenu Git. Une réécriture externe
 * à l'identique change mtime/ctime et invalide ainsi une ancienne attribution causale.
 */
export async function captureWorkspacePathGenerationMarker(
  cwd: string,
  path: string
): Promise<string> {
  const absolute = resolve(cwd, path)
  const present = await captureFileGenerationMarker(absolute)
  if (present) return present
  try {
    ensurePathGenerationWatcher(absolute)
    await settlePathGenerationEvents()
    const restored = await captureFileGenerationMarker(absolute)
    if (restored) return restored
    return `missing:${watcherSessionId}:${pathWatchGenerations.get(filesystemPathKey(absolute)) ?? 0}`
  } catch {
    return `missing:${watcherSessionId}:${pathWatchGenerations.get(filesystemPathKey(absolute)) ?? 0}`
  }
}

function workspaceMutationSnapshot(
  entries: readonly (readonly [string, string, string, readonly string[]])[],
  observedTails: ReadonlyMap<string, FileTailState> = new Map()
): WorkspaceMutationSnapshot {
  return Object.assign(
    new Map(entries.map(([path, fingerprint]) => [path, fingerprint] as const)),
    {
      generationMarkers: new Map(
        entries.map(([path, , generationMarker]) => [path, generationMarker] as const)
      ),
      lineFingerprints: new Map(
        entries.map(([path, , , lineFingerprints]) => [path, lineFingerprints] as const)
      ),
      observedTails
    }
  )
}

function workspaceRelativePath(cwd: string, path: string): string | undefined {
  const root = resolve(cwd)
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path)
  const rel = relative(root, absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined
  return rel.replaceAll('\\', '/')
}

function multisetDifference(before: readonly string[], after: readonly string[]): string[] {
  const remaining = new Map<string, number>()
  for (const fingerprint of before) {
    remaining.set(fingerprint, (remaining.get(fingerprint) ?? 0) + 1)
  }
  return after.filter((fingerprint) => {
    const count = remaining.get(fingerprint) ?? 0
    if (count === 0) return true
    if (count === 1) remaining.delete(fingerprint)
    else remaining.set(fingerprint, count - 1)
    return false
  })
}

export async function captureWorkspaceMutationSnapshot(
  cwd: string,
  observedPaths: readonly string[] = []
): Promise<WorkspaceMutationSnapshot> {
  const git = await readGitState(cwd, 0)
  const normalizedObserved = [
    ...new Set(
      observedPaths.flatMap((path) => {
        const relativePath = workspaceRelativePath(cwd, path)
        return relativePath ? [relativePath] : []
      })
    )
  ]
  const observedTails = new Map(
    await Promise.all(
      normalizedObserved.map(async (path) => [path, await beginAtEnd(resolve(cwd, path))] as const)
    )
  )
  if (!git.available || !git.state) return workspaceMutationSnapshot([], observedTails)
  const paths = [
    ...new Set([
      ...git.state.changes.map((change) => change.path.replaceAll('\\', '/')),
      ...normalizedObserved
    ])
  ]
  const entries = await Promise.all(
    paths.map(async (path) => {
      const diff = await readGitDiff(cwd, path)
      const generationMarker = await captureWorkspacePathGenerationMarker(cwd, path)
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            diff: diff.available ? (diff.diff ?? '') : `unavailable:${diff.error ?? ''}`,
            generationMarker
          }),
          'utf8'
        )
        .digest('hex')
      return [
        path,
        fingerprint,
        generationMarker,
        diff.available ? addedLineFingerprintsFromUnifiedDiff(diff.diff ?? '') : []
      ] as const
    })
  )
  return workspaceMutationSnapshot(entries, observedTails)
}

export async function appendWorkspaceMutationEvidence(
  before: WorkspaceMutationSnapshot,
  cwd: string,
  evidence: ExecutionEvidence[]
): Promise<void> {
  try {
    const observedPaths = [...before.observedTails.keys()]
    const observedReadings = new Map(
      await Promise.all(
        observedPaths.map(
          async (path) =>
            [path, await readNewLines(resolve(cwd, path), before.observedTails.get(path)!)] as const
        )
      )
    )
    const after = await captureWorkspaceMutationSnapshot(cwd, observedPaths)
    const paths = [...after.entries()]
      .filter(([path, fingerprint]) => before.get(path) !== fingerprint)
      .map(([path]) => path)
      .sort()
    if (paths.length === 0) return
    const pathGenerationMarkers = Object.fromEntries(
      paths.map((path) => [path, after.generationMarkers.get(path) as string])
    )
    const writtenLineFingerprintsByPath = Object.fromEntries(
      paths.flatMap((path) => {
        const observedLines = observedReadings.get(path)?.lines
        const fingerprints = observedLines
          ? observedLines.map(exactLineFingerprint)
          : multisetDifference(
              before.lineFingerprints.get(path) ?? [],
              after.lineFingerprints.get(path) ?? []
            )
        return fingerprints.length ? [[path, fingerprints]] : []
      })
    )
    evidence.push({
      type: 'workspace_delta',
      kind: 'mutation',
      status: 'completed',
      ok: true,
      summary: `${paths.length} fichier(s) modifié(s) dans le worktree isolé`,
      paths,
      workspaceRoot: cwd,
      pathFingerprints: Object.fromEntries(paths.map((path) => [path, after.get(path) as string])),
      pathBaseFingerprints: Object.fromEntries(
        paths.map((path) => [path, before.get(path) ?? null])
      ),
      pathBaseGenerationMarkers: Object.fromEntries(
        paths.map((path) => [path, before.generationMarkers.get(path) ?? null])
      ),
      pathGenerationMarkers,
      ...(Object.keys(writtenLineFingerprintsByPath).length > 0
        ? { writtenLineFingerprintsByPath }
        : {})
    })
  } catch {
    // Une preuve best-effort ne doit jamais transformer un tour réussi en échec.
  }
}

/**
 * Decoupe un diff unifie MULTI-FICHIERS en portions, indexees par le chemin d'apres (`+++ b/...`).
 *
 * Le chemin d'APRES est le bon : c'est celui que l'appelant a demande, et il survit a un renommage.
 * Un fichier supprime (`+++ /dev/null`) n'apporte aucune ligne ajoutee — il est simplement absent.
 */
export function decouperDiffParFichier(diff: string): Map<string, string> {
  const portions = new Map<string, string>()
  if (!diff) return portions
  for (const bloc of diff.split(/^diff --git /m).slice(1)) {
    const entete = /^\+\+\+ b\/(.+)$/m.exec(bloc)
    const chemin = entete?.[1]?.trim()
    if (!chemin || chemin === '/dev/null') continue
    portions.set(chemin, `diff --git ${bloc}`)
  }
  return portions
}

/**
 * Preuve causale issue du commit IMMUTABLE préparé par WorktreeManager. Contrairement au snapshot
 * du répertoire vivant, cette plage ne peut pas rater une écriture arrivée juste avant `git add`, ni
 * attribuer une écriture arrivée après le commit (elle n'est alors pas publiée dans cette SHA).
 */
export function preparedCommitMutationEvidence(
  cwd: string,
  baseSha: string,
  agentSha: string,
  observedPaths: readonly string[]
): ExecutionEvidence[] {
  if (!/^[0-9a-f]{40,64}$/i.test(baseSha) || !/^[0-9a-f]{40,64}$/i.test(agentSha)) return []
  const paths = [
    ...new Set(
      observedPaths.flatMap((path) => {
        const relativePath = workspaceRelativePath(cwd, path)
        return relativePath ? [relativePath] : []
      })
    )
  ]
  if (paths.length === 0) return []
  /*
   * UN SEUL `git diff` POUR TOUS LES FICHIERS, pas un par fichier.
   *
   * Mesure du 2026-09-03 (`gels.jsonl`, 536 gels) : `execFileSync` coute 145 ms par appel EN
   * MOYENNE sur ce depot, et il est lance ici sur le thread qui dessine la fenetre, une fois par
   * fichier touche — un run qui touche dix fichiers figeait donc la fenetre pres d'une seconde et
   * demie, a chaque preuve de mutation. `git diff` accepte tous les chemins d'un coup ; il ne reste
   * qu'a decouper sa sortie par fichier, ce que ses entetes `diff --git` permettent exactement.
   */
  const diffParFichier = new Map<string, string>()
  try {
    const stdout = execFileSync(
      'git',
      [
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--text',
        '--unified=0',
        `${baseSha}...${agentSha}`,
        '--',
        ...paths
      ],
      { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }
    )
    for (const [path, portion] of decouperDiffParFichier(stdout)) diffParFichier.set(path, portion)
  } catch {
    // Une preuve best-effort ne doit jamais transformer un tour reussi en echec.
  }
  const entries = paths.map((path) => {
    try {
      const portion = diffParFichier.get(path)
      if (portion === undefined) return undefined
      const fingerprints = addedLineFingerprintsFromUnifiedDiff(portion)
      if (!fingerprints.length) return undefined
      const generationMarker = captureFileGenerationMarkerSync(resolve(cwd, path))
      if (!generationMarker) return undefined
      return [path, fingerprints, generationMarker] as const
    } catch {
      return undefined
    }
  })
  const claimed = entries.filter(
    (entry): entry is readonly [string, string[], string] => entry !== undefined
  )
  if (claimed.length === 0) return []
  return [
    {
      type: 'workspace_delta',
      kind: 'mutation',
      status: 'completed',
      ok: true,
      summary: `${claimed.length} fichier(s) causal(aux) confirmé(s) dans le commit publié`,
      paths: claimed.map(([path]) => path),
      workspaceRoot: cwd,
      pathGenerationMarkers: Object.fromEntries(
        claimed.map(([path, , generationMarker]) => [path, generationMarker])
      ),
      writtenLineFingerprintsByPath: Object.fromEntries(
        claimed.map(([path, fingerprints]) => [path, fingerprints])
      )
    }
  ]
}
