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
import { existsSync, mkdirSync, readdirSync, rmdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { buildBrainLaunchCommand, CMD_UNSAFE, resolveBrainRuntime } from './brain-server-launch'

/** Identité de revue : DOIT différer de la famille d'agent auteur (`autowin-os`), sinon
 *  `brain_curate._promote` refuse la promotion (« reviewer must belong to a distinct family »). */
export const CURATION_REVIEWER = 'autowin-app-curation'

export interface CurationLaunch {
  /** `busy` : une autre passe tient le verrou de la boîte, la curation n'est pas lancée. */
  status: 'launched' | 'nothing-to-do' | 'unavailable' | 'busy'
  detail: string
}

/**
 * Le verrou de la skill `curate` (étape 0) : un dossier VIDE `inbox/.curation.lock`, pris par
 * `mkdir` — atomique y compris sur le partage réseau (mesuré le 2026-09-26 : le second `mkdir`
 * échoue). Une seule passe le tient, les autres renoncent. Mesuré le 2026-09-29 : sans lui, la
 * curation de démarrage a promu une note à 08:57:24 pendant qu'une passe /curate d'un autre poste
 * tenait la boîte depuis 08:34:04.
 */
export function curationLockPath(brainRoot: string): string {
  return join(brainRoot, 'inbox', '.curation.lock')
}

function prendreVerrou(verrou: string): 'pris' | 'tenu' | { erreur: string } {
  try {
    mkdirSync(verrou) // NON récursif : échoue si le dossier existe déjà.
    return 'pris'
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return 'tenu'
    return { erreur: (e as Error).message }
  }
}

function rendreVerrou(verrou: string): void {
  try {
    // `rmdir` refuse un dossier non vide : on ne détruit jamais ce qu'un autre y aurait mis.
    rmdirSync(verrou)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    // ENOENT : déjà rendu, ou repris comme périmé par une passe /curate — rien à rendre.
    if (code !== 'ENOENT') console.warn('[brain-curation] verrou non rendu :', verrou, code)
  }
}

function heureDuVerrou(verrou: string): string {
  try {
    return statSync(verrou).mtime.toTimeString().slice(0, 5)
  } catch {
    return 'une heure inconnue'
  }
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
    once?: (evenement: 'exit' | 'error', rappel: () => void) => unknown
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
  // Verrou de la boîte, pris APRÈS les refus fail-closed (rien à rendre s'ils tombent) et AVANT
  // `--apply`. Tenu par une autre passe → on renonce, sans consommer la tentative de la session.
  // Un verrou périmé (plus de 4 h) n'est PAS repris ici : c'est la passe /curate qui le reprend
  // (skill curate, étape 0) ; l'app se contente de renoncer.
  const verrou = curationLockPath(brainRoot)
  const prise = prendreVerrou(verrou)
  if (prise === 'tenu') {
    return {
      status: 'busy',
      detail: `verrou inbox/.curation.lock tenu depuis ${heureDuVerrou(verrou)} : une autre passe cure la boîte, curation non lancée`
    }
  }
  if (prise !== 'pris') {
    return {
      status: 'unavailable',
      detail: `verrou de curation impossible à poser (${prise.erreur})`
    }
  }
  // Sous le verrou, la boîte a pu être vidée par la passe qui vient de le rendre.
  const enAttente = pendingCandidateCount(brainRoot)
  if (enAttente === 0) {
    rendreVerrou(verrou)
    return { status: 'nothing-to-do', detail: 'aucun candidat en attente' }
  }
  const childEnv: NodeJS.ProcessEnv = { ...env }
  delete childEnv.PYTHONPATH
  childEnv.AMITEL_BRAIN_ROOT = brainRoot
  attempted = true
  let rendu = false
  const liberer = (): void => {
    if (rendu) return
    rendu = true
    rendreVerrou(verrou)
  }
  let child: ReturnType<typeof spawnFn>
  try {
    child = spawnFn(
      command.bin,
      [
        ...command.args,
        // Sans `--brain`/`--index`, brain_curate.py prend le PARENT de son propre dossier. Depuis
        // que le code est installé en local (%LOCALAPPDATA%\AmitelBrain\tooling), ce parent n'a pas
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
  } catch (e) {
    liberer()
    return {
      status: 'unavailable',
      detail: `lancement de brain_curate.py impossible (${(e as Error).message})`
    }
  }
  if (child.once) {
    // Échec du lancement (programme introuvable…) : `exit` peut ne jamais venir.
    child.once('error', liberer)
    // Le code de sortie ne dit rien (`cmd /c start /wait` rend 0 même quand python échoue). Le
    // signal fiable est la BOÎTE : une promotion en sort le candidat ; une fusion proposée ou un
    // rejet l'y laissent, et ne justifient pas une reconstruction de plusieurs minutes.
    child.once('exit', () => {
      liberer()
      if (apresCuration && pendingCandidateCount(brainRoot) < enAttente) apresCuration()
    })
  } else {
    // Sans moyen d'observer la fin, on ne garde pas un verrou qu'on ne saurait rendre : il
    // bloquerait toutes les passes pendant 4 h. Le vrai ChildProcess a toujours `once`.
    liberer()
  }
  child.unref?.()
  return { status: 'launched', detail: `curation lancée sur ${enAttente} candidat(s) en attente` }
}
