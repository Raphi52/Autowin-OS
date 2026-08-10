import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export interface RepositoryWorktreeIdentity {
  repoId: string
  root: string
  gitCommonDir: string
}

type CommonDirProbe = (repo: string) => string | undefined

function defaultProbe(repo: string): string | undefined {
  try {
    const raw = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
    if (!raw) return undefined
    return isAbsolute(raw) ? raw : resolve(repo, raw)
  } catch {
    return undefined
  }
}

function canonical(path: string): string {
  let real = path
  try {
    real = realpathSync.native(path)
  } catch {
    real = resolve(path)
  }
  return real.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Namespace les copies par object-store Git prouvé. Si Git ne peut pas répondre, l'appel échoue :
 * mieux vaut rendre le moteur indisponible que réutiliser la copie d'un autre dépôt.
 */
export function repositoryWorktreeIdentity(
  globalRoot: string,
  repo: string,
  probe: CommonDirProbe = defaultProbe
): RepositoryWorktreeIdentity {
  const commonDir = probe(repo)
  if (!commonDir) throw new Error(`Impossible de prouver l’identité Git du workspace ${repo}.`)
  const gitCommonDir = canonical(commonDir)
  const repoId = createHash('sha256').update(gitCommonDir).digest('hex').slice(0, 16)
  return { repoId, root: join(globalRoot, repoId), gitCommonDir }
}
