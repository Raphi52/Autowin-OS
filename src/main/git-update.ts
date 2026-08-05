import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { strategiesFor, type UpdateStrategy } from '../shared/update-contract'

export { strategiesFor, type UpdateStrategy }

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
  /** Arbre de travail modifié. N'empêche PLUS la mise à jour : `--autostash` s'en charge. */
  dirty?: boolean
  /** Stratégies applicables ici, la première étant la recommandée. */
  strategies?: UpdateStrategy[]
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
    // L'état de l'arbre est REMONTÉ, plus utilisé pour interdire : l'interface peut annoncer « ton
    // travail en cours sera mis de côté puis remis » au lieu de refuser après le clic.
    let dirty = false
    try {
      dirty = (await run(['status', '--porcelain'], cwd)).stdout.trim().length > 0
    } catch {
      /* état inconnu : on n'en fait pas un blocage */
    }
    return { available: behind > 0, behind, branch, reference, dirty, strategies: strategiesFor(branch) }
  } catch (error) {
    return { available: false, behind: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

export interface ApplyResult {
  ok: boolean
  relaunch?: boolean
  npmInstalled?: boolean
  error?: string
  /** Stratégie réellement appliquée — à afficher, pour que l'utilisateur sache ce qui a été fait. */
  strategy?: UpdateStrategy
  /**
   * Vrai quand rien n'a été touché faute d'intention explicite : l'interface doit proposer
   * `strategies`. Distinct d'une ERREUR — c'est une question, pas un échec.
   */
  needsChoice?: boolean
  strategies?: UpdateStrategy[]
}

export interface ApplyOptions {
  strategy?: UpdateStrategy
}

function packageSignature(cwd: string): string {
  const read = (f: string): string => {
    const p = join(cwd, f)
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  }
  return `${read('package.json')}::${read('package-lock.json')}`
}

/**
 * Applique la mise à jour selon la stratégie demandée.
 *
 * Un arbre SALE n'est PLUS un refus : `--autostash` met le travail de côté et le remet, y compris en cas
 * d'échec. L'ancien refus obligeait à commiter n'importe quoi juste pour récupérer une mise à jour, ce
 * qui est le contraire de protéger le travail local.
 *
 * La SEULE garde conservée : hors de `main`, aucune stratégie n'est choisie à la place de l'utilisateur
 * → `needsChoice`. C'est une question posée, pas un échec, et c'est ce qui empêche de fabriquer une
 * fusion que personne n'a demandée sur la branche de quelqu'un.
 *
 * `npm install` n'est relancé que si `package.json`/lock a changé. Un relaunch est signalé à l'appelant.
 */
export async function applyUpdate(
  cwd: string,
  options: ApplyOptions = {},
  run: GitRunner = defaultRunner,
  npmInstall: (cwd: string) => Promise<void> = defaultNpmInstall
): Promise<ApplyResult> {
  try {
    const before = packageSignature(cwd)
    const currentBranch = (await run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).stdout.trim()
    const available = strategiesFor(currentBranch)
    // Sur main, avancer est sans ambiguïté → défaut. Ailleurs, l'appelant DOIT nommer sa stratégie :
    // c'est la seule garde conservée, et elle empêche exactement une chose — fabriquer un merge que
    // personne n'a demandé sur la branche de quelqu'un.
    const strategy = options.strategy ?? (currentBranch === 'main' ? 'fast-forward' : undefined)
    if (!strategy) {
      return {
        ok: false,
        needsChoice: true,
        strategies: available,
        error: `Tu es sur « ${currentBranch} » : choisis comment intégrer origin/main (fusionner, rebaser, ou basculer sur main).`
      }
    }
    if (!available.includes(strategy)) {
      return {
        ok: false,
        strategies: available,
        error: `La stratégie « ${strategy} » ne s'applique pas depuis « ${currentBranch} ».`
      }
    }
    // `--autostash` PARTOUT : git met le travail en cours de côté et le remet lui-même, y compris si
    // l'opération échoue. C'est ce qui remplace l'ancien refus sur arbre sale — refuser obligeait à
    // commiter n'importe quoi juste pour récupérer une mise à jour.
    if (strategy === 'fast-forward') await run(['pull', '--ff-only', '--autostash'], cwd)
    else if (strategy === 'merge') await run(['merge', '--autostash', TEAM_REFERENCE], cwd)
    else if (strategy === 'rebase') await run(['rebase', '--autostash', TEAM_REFERENCE], cwd)
    else {
      // Basculer NE PERD RIEN : le travail de la branche reste sur la branche, on ne fait que changer
      // de point de vue avant d'avancer main.
      await run(['switch', 'main'], cwd)
      await run(['pull', '--ff-only', '--autostash'], cwd)
    }
    const npmInstalled = packageSignature(cwd) !== before
    if (npmInstalled) await npmInstall(cwd)
    return { ok: true, relaunch: true, npmInstalled, strategy }
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
