/**
 * DÉCLENCHEUR de la curation des candidats Brain.
 *
 * Cause mesurée le 2026-09-02 : 109 candidats dormaient dans `inbox/`. Autowin savait DÉPOSER
 * (`remember` → `brain-remember.ts`) et savait AFFICHER la file (`brain-inbox.ts` →
 * vue Knowledge), mais RIEN dans l'app n'exécutait jamais l'étape 3 du protocole écrit dans
 * `inbox/README.md` (« toute session IA exécute `tooling/brain_curate.py --report` puis
 * `--apply` »). La revue n'existait qu'en un-clic-par-fiche : 67 dépôts pour la seule journée du
 * 2026-09-02 contre 0 promotion automatique. Une règle de comportement n'y pouvait rien — il
 * manquait le déclencheur.
 *
 * Ce que le déclencheur ne fait PAS : décider. `brain_curate.py --apply` n'exécute QUE la partie
 * mécanique (verdict `promote`). Les fusions et les rejets restent à une session humaine ou IA.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { buildBrainLaunchCommand, CMD_UNSAFE, resolveBrainRuntime } from './brain-server-launch'

/** Identité de revue : DOIT différer de la famille d'agent auteur (`autowin-os`), sinon
 *  `brain_curate._promote` refuse la promotion (« reviewer must belong to a distinct family »). */
export const CURATION_REVIEWER = 'autowin-app-curation'

export interface CurationLaunch {
  status: 'launched' | 'nothing-to-do' | 'unavailable'
  detail: string
}

/** Compte les candidats réellement en attente (les .md de `inbox/`, README exclu). */
export function pendingCandidateCount(brainRoot: string): number {
  try {
    return readdirSync(join(brainRoot, 'inbox')).filter(
      (name) => name.toLowerCase().endsWith('.md') && name.toLowerCase() !== 'readme.md'
    ).length
  } catch {
    return 0
  }
}

let attempted = false

/** Remise à zéro de la tentative unique — réservée aux tests. */
export function resetBrainCurationAttempt(): void {
  attempted = false
}

/**
 * Lance la curation UNE fois par session, en tâche de fond, et seulement s'il y a de quoi traiter.
 * Détaché comme le serveur Brain (même piège de handles hérités sous Windows, cf.
 * `buildBrainLaunchCommand`).
 */
export function startBrainCuration(
  env: NodeJS.ProcessEnv = process.env,
  spawnFn: (
    bin: string,
    args: readonly string[],
    options: Record<string, unknown>
  ) => Pick<ChildProcess, 'unref'> & {
    once?: (evenement: 'exit', rappel: (code: number | null) => void) => unknown
  } = spawn as never,
  /**
   * Appelée quand la curation se TERMINE. `--apply` promeut des notes dans `knowledge/` : sans
   * reconstruction derrière, l'index devient périmé et le Brain refuse toute question (503) —
   * mesuré le 2026-09-29. L'appelant y branche la réindexation.
   */
  apresCuration?: () => void,
  /**
   * Instance de TEST isolée (`--isolated-test-instance`) : elle partage le Brain de production et
   * ne doit pas le modifier. Mesuré le 2026-09-29 : une instance lancée par un autre fil a démarré
   * sa propre maintenance du Brain en parallèle de l'app principale.
   */
  instanceDeTest = false
): CurationLaunch {
  if (instanceDeTest) {
    return { status: 'nothing-to-do', detail: 'instance de test : le Brain partagé n’est pas curé' }
  }
  if (attempted) return { status: 'nothing-to-do', detail: 'curation déjà tentée cette session' }
  const runtime = resolveBrainRuntime(env)
  const { tooling, python, brainRoot } = runtime
  if (!tooling || !python || !brainRoot) {
    return { status: 'unavailable', detail: 'runtime Brain local non configuré' }
  }
  const script = join(tooling, 'brain_curate.py')
  if (!existsSync(python) || !existsSync(script)) {
    return { status: 'unavailable', detail: `brain_curate.py ou venv introuvable (${script})` }
  }
  const pending = pendingCandidateCount(brainRoot)
  if (pending === 0) return { status: 'nothing-to-do', detail: 'aucun candidat en attente' }
  // `attendre` : sans `/wait`, `cmd` se termine en ~50 ms, AVANT la moindre promotion — la
  // réindexation branchée sur sa fin partirait trop tôt et ne verrait rien de périmé.
  const command = buildBrainLaunchCommand(tooling, python, script, process.platform, true)
  if (!command) return { status: 'unavailable', detail: 'chemin du tooling refusé (fail-closed)' }
  // La racine passe elle aussi par cmd.exe : même garde fail-closed que le tooling.
  if (process.platform === 'win32' && CMD_UNSAFE.test(brainRoot)) {
    return { status: 'unavailable', detail: 'racine du Brain refusée (fail-closed)' }
  }
  const childEnv: NodeJS.ProcessEnv = { ...env }
  delete childEnv.PYTHONPATH
  childEnv.AMITEL_BRAIN_ROOT = brainRoot
  attempted = true
  const child = spawnFn(
    command.bin,
    [
      ...command.args,
      // Sans `--brain`/`--index`, brain_curate.py prend le PARENT de son propre dossier. Depuis que
      // le code est installé en local (%LOCALAPPDATA%\AmitelBrain\tooling), ce parent n'a pas
      // d'inbox/ : la curation ne voyait aucun candidat (mesuré le 2026-09-29). L'index est celui
      // que le serveur sert (`brain_server.py` lit `racine/tooling/index`).
      '--brain',
      brainRoot,
      '--index',
      join(brainRoot, 'tooling', 'index'),
      '--apply',
      '--reviewer',
      CURATION_REVIEWER
    ],
    { cwd: command.cwd, env: childEnv, detached: true, stdio: 'ignore', windowsHide: true }
  )
  // Le code de sortie ne dit rien (`cmd /c start /wait` rend 0 même quand python échoue). Le
  // signal fiable est la BOÎTE : une promotion en sort le candidat ; une fusion proposée ou un
  // rejet l'y laissent, et ne justifient pas une reconstruction de plusieurs minutes.
  if (apresCuration) {
    child.once?.('exit', () => {
      if (pendingCandidateCount(brainRoot) < pending) apresCuration()
    })
  }
  child.unref?.()
  return { status: 'launched', detail: `curation lancée sur ${pending} candidat(s) en attente` }
}
