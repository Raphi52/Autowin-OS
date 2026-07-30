import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * Auto-update GIT au démarrage (distribution clone-and-run) : vérifie si le clone local est en retard
 * sur l'ÉTAT DE RÉFÉRENCE DE L'ÉQUIPE (`origin/main`) et applique la mise à jour sur demande.
 *
 * POURQUOI `origin/main` et non `@{u}` : la comparaison se faisait contre l'upstream de la branche
 * SORTIE. Sur `main` c'était juste par coïncidence ; sur une branche de feature la bannière annonçait
 * « à jour » alors que `main` avait avancé, et sans upstream elle se taisait complètement. Depuis
 * qu'on impose branche + PR, c'est l'état de `main` qui intéresse tout le monde.
 *
 * Runner injectable → testable sans repo. Hors repo git (build packagé) → « indisponible » silencieux.
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
  /** Branche SORTIE (≠ la référence comparée) — à afficher pour lever toute ambiguïté. */
  branch?: string
  /** Référence de comparaison réellement utilisée (`origin/main`, ou l'upstream en repli). */
  reference?: string
  error?: string
}

/** État de référence de l'équipe. Repli sur l'upstream de la branche si ce ref n'existe pas. */
const TEAM_REFERENCE = 'origin/main'

/** Fetch quiet + compte les commits de retard (HEAD..upstream). Tout échec → indisponible (silencieux). */
export async function checkForUpdate(cwd: string, run: GitRunner = defaultRunner): Promise<UpdateStatus> {
  try {
    await run(['fetch', '--quiet'], cwd)
    const branch = (await run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).stdout.trim()
    // On mesure le retard sur `origin/main`. Repli sur `@{u}` si ce ref est absent (fork, autre
    // nom de branche par défaut) → jamais de régression silencieuse vers « rien à signaler ».
    let reference = TEAM_REFERENCE
    let raw: string
    try {
      raw = (await run(['rev-list', '--count', `HEAD..${TEAM_REFERENCE}`], cwd)).stdout.trim()
    } catch {
      reference = '@{u}'
      raw = (await run(['rev-list', '--count', 'HEAD..@{u}'], cwd)).stdout.trim()
    }
    const behind = Number.parseInt(raw, 10)
    if (!Number.isFinite(behind)) return { available: false, behind: 0 }
    return { available: behind > 0, behind, branch, reference }
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
    // Recuperer l'etat de `main` NE DOIT PAS muter silencieusement une branche de feature : un
    // `merge` automatique fabriquerait un travail que personne n'a demande. Sur `main` on pull
    // normalement ; ailleurs on REFUSE en le disant, l'utilisateur reste maitre de son integration.
    const currentBranch = (await run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).stdout.trim()
    if (currentBranch && currentBranch !== 'main' && currentBranch !== 'HEAD') {
      return {
        ok: false,
        error: `Tu es sur « ${currentBranch} ». Bascule sur main (git switch main) pour recuperer son etat, ou integre-le toi-meme (git merge origin/main).`
      }
    }
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
