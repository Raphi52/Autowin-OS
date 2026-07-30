/**
 * Auto-démarrage du brain_server local (loopback :8765) quand le preflight le trouve ROUGE.
 *
 * brain_server.py est un service Python EXTERNE (tooling du Brain, cf. README). L'app ne le
 * packageait pas ; ici on tente de le LANCER localement s'il est absent — jamais de le tuer/redémarrer
 * (127.0.0.1 = instance PAR MACHINE ; une instance vivante ne doit pas être touchée, cf. mémoire).
 *
 * Garde anti-doublon : on ping AVANT de spawn (déjà up → no-op) et on ne tente qu'UNE fois par session.
 * Chemin du tooling : env `AUTOWIN_BRAIN_TOOLING` (override), sinon défaut Amitel documenté ci-dessous
 * (jamais une racine utilisateur devinée — un défaut d'intégration explicite, surchargé par env).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { amitelBrainTooling } from './amitel-paths'

// Le chemin du tooling vient de la SOURCE UNIQUE `amitel-paths.ts`, ou il est DERIVE de la racine du
// Brain. Avant, les deux litteraux etaient independants : surcharger la racine laissait le tooling
// pointer ailleurs, et rien ne signalait la divergence.

export interface BrainLaunchResult {
  status: 'already-up' | 'starting' | 'unavailable'
  detail: string
}

/**
 * Caractères que cmd.exe interprète AVANT d'exécuter la ligne (séparateurs, redirections,
 * expansion de variables). L'échappement win32 de Node ne met des guillemets qu'autour des
 * arguments contenant espace/tabulation/guillemet : ceux-ci passeraient NUS au shell. Comme le
 * tooling par défaut est un partage RÉSEAU écrivable par des collègues, un dossier nommé
 * `Brain & payload` suffirait à couper la ligne et à exécuter la suite au démarrage de l'app,
 * sans aucun clic (le preflight appelle ce lanceur). On REFUSE donc plutôt que d'échapper.
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

/** Tentative unique par session : évite de spammer des spawns pendant le backoff de re-probe. */
let attempted = false

export function resolveBrainTooling(env: NodeJS.ProcessEnv = process.env): string {
  return amitelBrainTooling(env)
}

/** Réarme la tentative (ex. brain repassé up puis re-tombé, ou déclenchement manuel explicite). */
export function resetBrainLaunchAttempt(): void {
  attempted = false
}

/**
 * S'assure que le brain_server tourne : si `isUp()` répond, no-op ; sinon tente un spawn détaché.
 * `spawnFn` injectable pour test (défaut: child_process.spawn). Ne throw jamais.
 */
export async function ensureBrainServerStarted(
  isUp: () => Promise<boolean>,
  env: NodeJS.ProcessEnv = process.env,
  spawnFn: typeof spawn = spawn
): Promise<BrainLaunchResult> {
  try {
    if (await isUp()) {
      attempted = false // il tourne → réarme pour une éventuelle chute future
      return { status: 'already-up', detail: 'brain_server déjà joignable' }
    }
  } catch {
    /* ping en erreur = traité comme down */
  }
  if (attempted) {
    return { status: 'unavailable', detail: 'démarrage déjà tenté cette session — pas de nouveau spawn' }
  }
  const tooling = resolveBrainTooling(env)
  const python = join(tooling, '.venv', 'Scripts', 'python.exe')
  const script = join(tooling, 'brain_server.py')
  if (!existsSync(python)) {
    return { status: 'unavailable', detail: `venv Python introuvable (${python}) — venv par machine à créer (uv venv)` }
  }
  if (!existsSync(script)) {
    return { status: 'unavailable', detail: `brain_server.py introuvable (${script})` }
  }
  // ⚠️ PYTHONPATH retiré : sinon un PYTHONPATH hérité (Hermes) shadow les deps du venv isolé (cf. README).
  const childEnv: NodeJS.ProcessEnv = { ...env }
  delete childEnv.PYTHONPATH
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
  attempted = true
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
    detail: 'brain_server lancé — warm-up fastembed ~30-40 s (le preflight re-sonde avec backoff)'
  }
}
