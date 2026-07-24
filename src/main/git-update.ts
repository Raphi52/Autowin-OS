import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * Auto-update GIT au démarrage (distribution clone-and-run) : vérifie si la branche locale est en retard
 * sur son upstream et applique une mise à jour (pull + npm install si besoin) sur demande. Runner
 * injectable → testable sans repo. Hors repo git (build packagé) → renvoie proprement « indisponible ».
 */
export type GitRunner = (args: string[], cwd: string) => Promise<{ stdout: string }>

const execRun = promisify(execFile)
const defaultRunner: GitRunner = async (args, cwd) => {
  const { stdout } = await execRun('git', args, { cwd, windowsHide: true, timeout: 30_000 })
  return { stdout }
}

export interface UpdateStatus {
  available: boolean
  behind: number
  branch?: string
  error?: string
}

/** Fetch quiet + compte les commits de retard (HEAD..upstream). Tout échec → indisponible (silencieux). */
export async function checkForUpdate(cwd: string, run: GitRunner = defaultRunner): Promise<UpdateStatus> {
  try {
    await run(['fetch', '--quiet'], cwd)
    const branch = (await run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).stdout.trim()
    const raw = (await run(['rev-list', '--count', 'HEAD..@{u}'], cwd)).stdout.trim()
    const behind = Number.parseInt(raw, 10)
    if (!Number.isFinite(behind)) return { available: false, behind: 0 }
    return { available: behind > 0, behind, branch }
  } catch (error) {
    return { available: false, behind: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

export interface ApplyResult {
  ok: boolean
  relaunch?: boolean
  npmInstalled?: boolean
  error?: string
}

function packageSignature(cwd: string): string {
  const read = (f: string): string => {
    const p = join(cwd, f)
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  }
  return `${read('package.json')}::${read('package-lock.json')}`
}

/**
 * Applique la maj : refuse si arbre SALE (protège le travail local), sinon `git pull --ff-only` ;
 * relance `npm install` uniquement si package.json/lock a changé. Signale un relaunch au caller.
 */
export async function applyUpdate(
  cwd: string,
  run: GitRunner = defaultRunner,
  npmInstall: (cwd: string) => Promise<void> = defaultNpmInstall
): Promise<ApplyResult> {
  try {
    const dirty = (await run(['status', '--porcelain'], cwd)).stdout.trim()
    if (dirty)
      return { ok: false, error: 'Arbre de travail modifié — commit ou stash avant de mettre à jour.' }
    const before = packageSignature(cwd)
    await run(['pull', '--ff-only'], cwd)
    const npmInstalled = packageSignature(cwd) !== before
    if (npmInstalled) await npmInstall(cwd)
    return { ok: true, relaunch: true, npmInstalled }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const defaultNpmInstall = (cwd: string): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile('npm', ['install'], { cwd, windowsHide: true, shell: true, timeout: 300_000 }, (err) =>
      err ? reject(err) : resolve()
    )
  })
