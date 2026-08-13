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
  /** Arbre de travail modifié. Il sera protégé par un stash explicite pendant la mise à jour. */
  dirty?: boolean
  /** Une opération Git contient déjà des fichiers non fusionnés. */
  conflicted?: boolean
  conflictOperation?: 'merge' | 'unknown'
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



/** Détecte d'abord les conflits locaux, puis fetch et compte les commits de retard. */
export async function checkForUpdate(cwd: string, run: GitRunner = defaultRunner): Promise<UpdateStatus> {
  // L'annulation d'une fusion est purement LOCALE : elle doit rester disponible même si le réseau
  // ou le remote est indisponible. Ne jamais remettre cette sonde après le fetch.
  try {
    const unmerged = (await run(['diff', '--name-only', '--diff-filter=U'], cwd)).stdout.trim()
    if (unmerged) {
      const mergeHead = (
        await run(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], cwd)
      ).stdout.trim()
      let branch: string | undefined
      try {
        branch = (await run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).stdout.trim() || undefined
      } catch {
        /* le bouton d'annulation ne dépend pas du nom de branche */
      }
      return {
        available: true,
        behind: 0,
        ...(branch ? { branch, strategies: strategiesFor(branch) } : {}),
        dirty: true,
        conflicted: true,
        conflictOperation: mergeHead ? 'merge' : 'unknown'
      }
    }
  } catch {
    /* hors dépôt ou état local illisible : le fetch produira l'erreur utile */
  }

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
    return {
      available: behind > 0,
      behind,
      branch,
      reference,
      dirty,
      conflicted: false,
      strategies: strategiesFor(branch)
    }
  } catch (error) {
    return { available: false, behind: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Ce qu'il faut faire de l'application une fois le code tiré.
 *
 * `reload` : recharger la FENÊTRE seulement — le process principal reste vivant, les runs en cours
 * aussi. `relaunch` : redémarrer, seule option quand le main ou le preload a changé (Electron ne
 * sait pas remplacer à chaud des modules déjà chargés dans le process principal).
 * `none` : rien n'a bougé, on ne dérange pas l'utilisateur.
 */
export type UpdateEffect = 'none' | 'reload' | 'relaunch'

/** Chemins dont un changement N'IMPACTE QUE la fenêtre. Tout le reste impose un redémarrage. */
const RENDERER_ONLY = /^src\/renderer\//

/**
 * Décide de l'effet à partir des fichiers réellement changés par la mise à jour.
 *
 * La règle est volontairement ASYMÉTRIQUE : on ne recharge que si l'on est sûr, on redémarre dans
 * tous les autres cas — y compris quand la liste est inconnue. Un renderer neuf qui parle à un main
 * périmé produit les bugs les plus coûteux à diagnostiquer : une IPC qui « n'existe pas » alors
 * qu'elle est bien dans le code source qu'on vient de tirer. Ce défaut exact s'est produit sur ce
 * dépôt le 2026-08-06 (`window.api.claudeAccounts` absent d'un preload plus ancien que le renderer).
 *
 * `src/shared/**` compte donc comme un redémarrage : ces fichiers sont importés des DEUX côtés.
 */
export function updateEffectFor(changedPaths: readonly string[]): UpdateEffect {
  const paths = changedPaths.map((path) => path.trim()).filter(Boolean)
  if (paths.length === 0) return 'none'
  return paths.every((path) => RENDERER_ONLY.test(path)) ? 'reload' : 'relaunch'
}

export interface ApplyResult {
  ok: boolean
  relaunch?: boolean
  /** Recharger la fenêtre suffit : le changement ne touche que le renderer. */
  reload?: boolean
  /** L'effet décidé, pour que l'interface puisse le DIRE au lieu de le subir. */
  effect?: UpdateEffect
  /** Les fichiers changés, pour expliquer POURQUOI un redémarrage est nécessaire. */
  changedPaths?: string[]
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

/** Annule uniquement une fusion réellement ouverte; jamais un reset implicite. */
export async function abortUpdateConflict(
  cwd: string,
  run: GitRunner = defaultRunner
): Promise<ApplyResult> {
  try {
    const unmerged = (await run(['diff', '--name-only', '--diff-filter=U'], cwd)).stdout.trim()
    const mergeHead = (
      await run(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], cwd)
    ).stdout.trim()
    if (!unmerged || !mergeHead) {
      return { ok: false, error: "Aucune fusion Git conflictuelle n'est actuellement ouverte." }
    }
    await run(['merge', '--abort'], cwd)
    const remaining = (await run(['diff', '--name-only', '--diff-filter=U'], cwd)).stdout.trim()
    if (remaining) {
      return {
        ok: false,
        error: `La fusion n'a pas pu être annulée complètement (${remaining.split(/\r?\n/).length} fichier(s) encore en conflit).`
      }
    }
    return { ok: true, effect: 'none', reload: false, relaunch: false }
  } catch (error) {
    return {
      ok: false,
      error: `Impossible d'annuler la fusion en cours. ${error instanceof Error ? error.message : String(error)}`
    }
  }
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
 * Un arbre SALE n'est PLUS un refus : un stash explicite met le travail de côté, la mise à jour est
 * tentée, puis le stash est remis. Contrairement à `--autostash`, ce flux permet d'annuler une fusion
 * ou un rebase raté AVANT de restaurer le travail local.
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
    // Le SHA d'avant : c'est lui qui permettra de lister ce que la mise à jour a réellement changé,
    // donc de décider entre recharger la fenêtre et redémarrer. `HEAD@{1}` ne conviendrait pas :
    // une fusion ou un rebase peut ajouter plusieurs entrées au reflog.
    const headBefore = (await run(['rev-parse', 'HEAD'], cwd)).stdout.trim()
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

    const unmerged = (await run(['diff', '--name-only', '--diff-filter=U'], cwd)).stdout.trim()
    if (unmerged) {
      return {
        ok: false,
        strategy,
        error: `Le dépôt est déjà en conflit (${unmerged.split(/\r?\n/).length} fichier(s)). Résous les conflits ou annule l'opération Git en cours avant de mettre à jour.`
      }
    }

    const dirty = (await run(['status', '--porcelain'], cwd)).stdout.trim().length > 0

    let stashed = false
    if (dirty) {
      await run(['stash', 'push', '--include-untracked', '--message', 'autowin-pre-update'], cwd)
      stashed = true
    }

    let switchedToMain = false
    try {
      if (strategy === 'fast-forward') await run(['pull', '--ff-only'], cwd)
      else if (strategy === 'merge') await run(['merge', TEAM_REFERENCE], cwd)
      else if (strategy === 'rebase') await run(['rebase', TEAM_REFERENCE], cwd)
      else {
        await run(['switch', 'main'], cwd)
        switchedToMain = true
        await run(['pull', '--ff-only'], cwd)
        // Le stash appartient au contexte de la branche d'origine : on y revient AVANT de le remettre.
        await run(['switch', currentBranch], cwd)
        switchedToMain = false
      }
    } catch (updateError) {
      // Une fusion/rebase en conflit doit être ANNULÉE avant le pop. Si l'annulation ne suffit pas,
      // le stash reste intact : mieux vaut un travail rangé qu'un mélange impossible à démêler.
      if (strategy === 'merge') {
        try {
          await run(['merge', '--abort'], cwd)
        } catch {
          /* le merge a pu échouer avant de commencer */
        }
      } else if (strategy === 'rebase') {
        try {
          await run(['rebase', '--abort'], cwd)
        } catch {
          /* le rebase a pu échouer avant de commencer */
        }
      }

      if (switchedToMain) {
        try {
          await run(['switch', currentBranch], cwd)
          switchedToMain = false
        } catch (restoreBranchError) {
          return {
            ok: false,
            strategy,
            error: `La mise à jour de main a échoué et la branche d'origine « ${currentBranch} » n'a pas pu être restaurée. Le travail local reste protégé dans le stash. Mise à jour : ${updateError instanceof Error ? updateError.message : String(updateError)}. Retour : ${restoreBranchError instanceof Error ? restoreBranchError.message : String(restoreBranchError)}`
          }
        }
      }

      const conflictsRemain = (await run(['diff', '--name-only', '--diff-filter=U'], cwd)).stdout.trim()
      if (stashed && !conflictsRemain) {
        try {
          await run(['stash', 'pop'], cwd)
        } catch (popError) {
          return {
            ok: false,
            strategy,
            error: `La mise à jour a échoué et le travail local n'a pas pu être remis automatiquement. Le stash est conservé. Mise à jour : ${updateError instanceof Error ? updateError.message : String(updateError)}. Restauration : ${popError instanceof Error ? popError.message : String(popError)}`
          }
        }
      }
      return {
        ok: false,
        strategy,
        error: conflictsRemain
          ? `La mise à jour a échoué et des conflits subsistent. Le travail local reste protégé dans le stash. ${updateError instanceof Error ? updateError.message : String(updateError)}`
          : `La mise à jour a échoué; la tentative a été annulée${stashed ? ' et le travail local remis' : ''}. ${updateError instanceof Error ? updateError.message : String(updateError)}`
      }
    }

    if (stashed) {
      try {
        await run(['stash', 'pop'], cwd)
      } catch (popError) {
        return {
          ok: false,
          strategy,
          error: `La mise à jour est appliquée, mais le travail local n'a pas pu être remis automatiquement. Résous les conflits; le stash est conservé. ${popError instanceof Error ? popError.message : String(popError)}`
        }
      }
    }
    const npmInstalled = packageSignature(cwd) !== before
    if (npmInstalled) await npmInstall(cwd)

    let changedPaths: string[] = []
    let effect: UpdateEffect = 'relaunch'
    try {
      const headAfter = (await run(['rev-parse', 'HEAD'], cwd)).stdout.trim()
      // Un SHA VIDE n'est pas « inchangé », c'est « inconnu » — et les deux se ressemblent
      // dangereusement : `'' === ''` concluait « rien n'a bougé », donc aucun redémarrage, donc une
      // mise à jour réellement tirée mais jamais appliquée, sous une interface qui annonce le
      // succès. Le pire des faux verts. Inconnu ⇒ redémarrage.
      if (!headBefore || !headAfter) {
        effect = 'relaunch'
      } else if (headAfter === headBefore) {
        // Rien n'a bougé (déjà à jour) : ni rechargement ni redémarrage.
        changedPaths = []
        effect = 'none'
      } else {
        const diff = await run(['diff', '--name-only', `${headBefore}..${headAfter}`], cwd)
        changedPaths = diff.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
        effect = updateEffectFor(changedPaths)
      }
    } catch {
      // Liste indisponible → on ne PARIE pas : redémarrage, l'option toujours correcte.
      effect = 'relaunch'
    }
    // Une dépendance installée invalide le process en cours quoi qu'ait changé le renderer.
    if (npmInstalled && effect !== 'relaunch') effect = 'relaunch'

    return {
      ok: true,
      relaunch: effect === 'relaunch',
      reload: effect === 'reload',
      effect,
      changedPaths,
      npmInstalled,
      strategy
    }
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
