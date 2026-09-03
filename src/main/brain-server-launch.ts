/**
 * Auto-démarrage du brain_server local (loopback :8765) quand le preflight le trouve ROUGE.
 *
 * brain_server.py est un service Python EXTERNE (tooling du Brain, cf. README). L'app ne le
 * packageait pas ; ici on tente de le LANCER localement s'il est absent — jamais de le tuer/redémarrer
 * (127.0.0.1 = instance PAR MACHINE ; une instance vivante ne doit pas être touchée, cf. mémoire).
 *
 * Garde anti-doublon : on ping AVANT de spawn (déjà up → no-op) et on ne tente qu'UNE fois par session.
 * Chemin du tooling : config de l'installation locale, avec `AUTOWIN_BRAIN_TOOLING` comme override.
 * Le partage GED n'est utilisé que comme racine de données.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  amitelBrainPort,
  amitelBrainRoot,
  amitelBrainStateRoot,
  amitelBrainTooling
} from './amitel-paths'

// Le chemin du tooling vient de la SOURCE UNIQUE `amitel-paths.ts` et reste distinct du corpus partagé.

export interface BrainLaunchResult {
  status: 'already-up' | 'starting' | 'unavailable'
  detail: string
}

/**
 * Caractères que cmd.exe interprète AVANT d'exécuter la ligne (séparateurs, redirections,
 * expansion de variables). L'échappement win32 de Node ne met des guillemets qu'autour des
 * arguments contenant espace/tabulation/guillemet : ceux-ci passeraient NUS au shell. Comme le
 * Un override de tooling non fiable nommé `Brain & payload` suffirait à couper la ligne et à
 * exécuter la suite au démarrage de l'app. On REFUSE donc plutôt que d'échapper.
 */
const CMD_UNSAFE = /[&|^<>()"%!\r\n]/

/** Un cwd UNC est REFUSÉ par cmd.exe (« UNC paths are not supported ») → il repart de C:\Windows. */
function isUncPath(path: string): boolean {
  return /^[\\/]{2}[^\\/]/.test(path)
}

export interface BrainLaunchCommand {
  bin: string
  args: string[]
  /** `undefined` = on n'impose aucun cwd (voir isUncPath) ; le script est passé en ABSOLU. */
  cwd?: string
}

/**
 * Construit la commande de lancement, ou rend `null` si elle ne peut pas être construite SANS
 * risque d'injection (fail-closed : mieux vaut un brain absent qu'une ligne shell attaquable).
 *
 * `script` est passé en chemin ABSOLU : un argument relatif était résolu contre le cwd réel du
 * processus — `C:\Windows` dès que le tooling est UNC — donc python sortait en erreur, `stdio:'ignore'`
 * avalait le message, et le preflight affichait « en démarrage » pour un service jamais démarré.
 */
export function buildBrainLaunchCommand(
  tooling: string,
  python: string,
  script: string,
  platform: string = process.platform
): BrainLaunchCommand | null {
  // brain_server fait lui-même os.chdir(AMITEL_BRAIN_ROOT) : aucun cwd n'est nécessaire ici, on
  // n'en impose un que s'il est LOCAL (un cwd UNC ferait repartir cmd.exe de C:\Windows).
  const cwd = isUncPath(tooling) ? undefined : tooling
  if (platform !== 'win32') return { bin: python, args: [script], cwd }
  if (CMD_UNSAFE.test(python) || CMD_UNSAFE.test(script)) return null
  // `/d` : ignore les AutoRun du registre (HKCU\...\Command Processor\AutoRun s'exécuterait sinon
  // dans notre cmd). Titre vide `''` : sinon `start` prend le chemin cité comme TITRE de fenêtre.
  return { bin: 'cmd.exe', args: ['/d', '/c', 'start', '', '/b', python, script], cwd }
}

/**
 * Tentatives BORNÉES par session, pas une seule.
 *
 * Défaut mesuré le 2026-09-03 : une tentative unique avait été posée pour ne pas spammer de spawns
 * pendant le backoff de re-probe. Conséquence observée dans `dev-app-stdout.log` — l'app tente à
 * 08:43 (« starting »), le service meurt pendant son warm-up, et les 7 re-sondes suivantes rendent
 * « démarrage déjà tenté cette session » : le Brain est resté INJOIGNABLE pendant toute la session,
 * sans autre issue qu'un démarrage à la main. Un seul essai n'est pas une garde anti-spam, c'est un
 * verrou d'échec définitif.
 *
 * Le vrai anti-spam est un DÉLAI entre deux essais (le warm-up fastembed dure ~30-40 s : re-spawner
 * avant lui créerait un doublon inutile) plus un PLAFOND d'essais (si trois spawns meurent, le
 * problème n'est pas le timing et re-spawner en boucle ne le résoudra pas).
 */
let attempts = 0
let lastAttemptAt = 0

/** Plafond d'essais par session : au-delà, le défaut n'est pas un problème de timing. */
export const MAX_BRAIN_LAUNCH_ATTEMPTS = 3
/** Délai minimal entre deux essais : couvre le warm-up fastembed (~30-40 s) avec une marge. */
export const BRAIN_LAUNCH_COOLDOWN_MS = 90_000

export interface BrainRuntimePaths {
  tooling: string
  python: string
  brainRoot: string
}

interface InstalledBrainConfig {
  brain_root?: unknown
  code_root?: unknown
  python?: unknown
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Resout le code et Python depuis l'installation locale de confiance. La racine GED ne sert que
 * de corpus : elle ne doit jamais redevenir une source de code executable.
 */
export function resolveBrainRuntime(env: NodeJS.ProcessEnv = process.env): BrainRuntimePaths {
  const stateRoot = amitelBrainStateRoot(env)
  let config: InstalledBrainConfig = {}
  if (stateRoot) {
    try {
      config = JSON.parse(readFileSync(join(stateRoot, 'config.json'), 'utf8')) as InstalledBrainConfig
    } catch {
      // Installation inachevee ou configuration absente : les chemins locaux par defaut restent
      // valides et ensureBrainServerStarted verifiera l'existence des fichiers avant tout spawn.
    }
  }

  const explicitLegacyTooling = nonEmptyString(env.AUTOWIN_BRAIN_TOOLING)
  const tooling = explicitLegacyTooling
    ?? nonEmptyString(env.AMITEL_BRAIN_CODE_ROOT)
    ?? nonEmptyString(config.code_root)
    ?? amitelBrainTooling(env)
  const python = nonEmptyString(env.AMITEL_BRAIN_PYTHON)
    ?? nonEmptyString(config.python)
    ?? (explicitLegacyTooling
      ? join(explicitLegacyTooling, '.venv', 'Scripts', 'python.exe')
      : stateRoot
        ? join(stateRoot, '.venv', 'Scripts', 'python.exe')
        : '')
  const brainRoot = nonEmptyString(env.AMITEL_BRAIN_ROOT)
    ?? nonEmptyString(config.brain_root)
    ?? amitelBrainRoot(env)
  return { tooling, python, brainRoot }
}

/** Réarme les tentatives (ex. brain repassé up puis re-tombé, ou déclenchement manuel explicite). */
export function resetBrainLaunchAttempt(): void {
  attempts = 0
  lastAttemptAt = 0
}

/**
 * S'assure que le brain_server tourne : si `isUp()` répond, no-op ; sinon tente un spawn détaché.
 * `spawnFn` injectable pour test (défaut: child_process.spawn). Ne throw jamais.
 */
export async function ensureBrainServerStarted(
  isUp: () => Promise<boolean>,
  env: NodeJS.ProcessEnv = process.env,
  spawnFn: typeof spawn = spawn,
  now: () => number = Date.now
): Promise<BrainLaunchResult> {
  try {
    if (await isUp()) {
      resetBrainLaunchAttempt() // il tourne → réarme pour une éventuelle chute future
      return { status: 'already-up', detail: 'brain_server déjà joignable' }
    }
  } catch {
    /* ping en erreur = traité comme down */
  }
  if (attempts >= MAX_BRAIN_LAUNCH_ATTEMPTS) {
    return {
      status: 'unavailable',
      detail: `${attempts} démarrages tentés sans succès cette session — le service ne tient pas, voir %LOCALAPPDATA%\\AmitelBrain\\server-err.log`
    }
  }
  const sinceLast = now() - lastAttemptAt
  if (attempts > 0 && sinceLast < BRAIN_LAUNCH_COOLDOWN_MS) {
    const reste = Math.ceil((BRAIN_LAUNCH_COOLDOWN_MS - sinceLast) / 1000)
    return {
      status: 'unavailable',
      detail: `démarrage n°${attempts} en cours de warm-up — nouvel essai dans ${reste} s`
    }
  }
  const runtime = resolveBrainRuntime(env)
  const { tooling, python } = runtime
  const script = join(tooling, 'brain_server.py')
  if (!tooling || !python) {
    return {
      status: 'unavailable',
      detail: 'runtime Brain local non configure — relancer install.ps1 depuis le clone Hermes-Brain de confiance'
    }
  }
  if (!existsSync(python)) {
    return { status: 'unavailable', detail: `venv Python introuvable (${python}) — venv par machine à créer (uv venv)` }
  }
  if (!existsSync(script)) {
    return { status: 'unavailable', detail: `brain_server.py introuvable (${script})` }
  }
  // ⚠️ PYTHONPATH retiré : sinon un PYTHONPATH hérité (Hermes) shadow les deps du venv isolé (cf. README).
  const childEnv: NodeJS.ProcessEnv = { ...env }
  delete childEnv.PYTHONPATH
  childEnv.AMITEL_BRAIN_ROOT = runtime.brainRoot
  childEnv.AMITEL_BRAIN_CODE_ROOT = runtime.tooling
  childEnv.AMITEL_BRAIN_PYTHON = runtime.python
  /*
   * LE PORT DU SERVEUR VIENT DE LA MEME SOURCE QUE CELUI DU CLIENT.
   *
   * MESURE DU 2026-09-03 (conv-8) : `brain_server.py` prend son port dans `AMITEL_BRAIN_PORT`, avec
   * 8765 par defaut. L'environnement herite ne la portait pas, donc l'app a demarre un serveur sur
   * 8765 pendant que le service a jour ecoutait 8766 — deux serveurs, et le client qui interrogeait
   * celui que personne n'avait mis a jour. Deriver le port de `amitelBrainOrigin()` rend cette
   * divergence STRUCTURELLEMENT impossible : une seule valeur decide des deux cotes.
   */
  childEnv.AMITEL_BRAIN_PORT = amitelBrainPort(env)
  // Détaché + unref : survit à l'app, stdio ignoré (pas de pipe qui bloque). windowsHide : pas de
  // console qui pop.
  // Sous Windows, `detached` + `stdio:'ignore'` + `unref()` ne suffisent PAS : libuv appelle
  // CreateProcess avec bInheritHandles=TRUE, donc l'enfant hérite des handles héritables du parent
  // — y compris le SOCKET D'ÉCOUTE DevTools d'Electron. À la mort de l'app, ce python survivant
  // gardait le port 9223 en otage : le serveur DevTools ne redémarrait plus jamais (« Cannot start
  // http server for devtools »), et tout pilotage CDP devenait impossible. Constaté deux fois.
  //
  // On passe donc par un lanceur intermédiaire qui, LUI, crée le python sans transmettre de
  // handles, puis sort immédiatement en relâchant ceux qu'il avait hérités. Aucune API Node ne
  // permet de piloter bInheritHandles / PROC_THREAD_ATTRIBUTE_HANDLE_LIST, et `detached` +
  // `stdio:'ignore'` + `windowsHide` étaient DÉJÀ posés quand le port 9223 a été séquestré : le
  // lanceur reste donc obligatoire — mais il est fail-closed (cf. buildBrainLaunchCommand).
  const command = buildBrainLaunchCommand(tooling, python, script)
  if (!command) {
    return {
      status: 'unavailable',
      detail: `chemin du tooling refusé (caractère interprété par cmd.exe dans « ${tooling} ») — renommer le dossier ou pointer AUTOWIN_BRAIN_TOOLING ailleurs`
    }
  }
  attempts += 1
  lastAttemptAt = now()
  const child = spawnFn(command.bin, command.args, {
    cwd: command.cwd,
    env: childEnv,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref?.()
  return {
    status: 'starting',
    detail: `brain_server lancé (essai ${attempts}/${MAX_BRAIN_LAUNCH_ATTEMPTS}) — warm-up fastembed ~30-40 s (le preflight re-sonde avec backoff)`
  }
}
