/**
 * Watchdogs anti-blocage des sous-agents. Deux briques indépendantes et testables :
 *
 *  - `withHardDeadline` : garantie de COORDINATION — une promesse d'attente se règle TOUJOURS (au pire
 *    par un rejet-deadline), même si le producteur sous-jacent ne se résout jamais (process zombie,
 *    event `close` qui ne tire pas). C'est le filet qui empêche « bloqué des jours ».
 *  - `createStreamWatchdog` : surveillance d'un flux — timer d'INACTIVITÉ réarmé à chaque battement
 *    (chunk stdout). Déclenche `onTrip` UNE seule fois (figé → à tuer). Une tâche longue QUI
 *    PROGRESSE n'est jamais tuée : il n'existe plus de plafond de durée absolue.
 *
 * Les timers sont `unref()` : ils ne retiennent jamais l'event loop (pas de fuite au quit).
 */

import { tuerArbre } from '../verify-extinction'

const envMs = (name: string, fallback: number): number => {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

/**
 * Défaut anti-blocage des sous-agents CLI (env-overridable) : silence stdout au-delà → figé → kill.
 * L'inactivité est le SEUL détecteur de figé conservé.
 *
 * Le cap de DURÉE TOTALE a été supprimé le 2026-09-20. Mesure : conv-729, turn
 * `aa90027e-01c1-4d39-9645-7e5d01619323` — deux appels tués à 2 400 018 ms et 2 400 022 ms (40 min
 * pile = l'ancien `SUBAGENT_TOTAL_MS`) avec l'erreur « claude CLI figé (durée max) », alors que le
 * journal du même tour montrait des battements réguliers (« Bash en cours - 30 s / 1 min / … /
 * 3 min »). Le tour PROGRESSAIT : une simulation de 60 parties (saisie ts=1789921425334) demande
 * plus de 40 min de travail utile. Le cap total ne détectait donc aucun blocage — il détruisait du
 * travail vivant, ici 80 minutes et le résultat attendu par l'utilisateur, deux fois de suite.
 */
export const SUBAGENT_INACTIVITY_MS = envMs('AUTOWIN_SUBAGENT_INACTIVITY_MS', 5 * 60_000)
/** Délai de grâce entre SIGTERM et SIGKILL lors de l'escalade de kill d'un process figé. */
const KILL_GRACE_MS = envMs('AUTOWIN_SUBAGENT_KILL_GRACE_MS', 3_000)

/**
 * Le devis du run prime sur le plafond local du transport. Hors orchestration (chat direct, sonde),
 * l'adaptateur conserve son fallback et son éventuel override d'environnement.
 */
export function resolveProviderTimeoutMs(explicit: number | undefined, fallback: number): number {
  return typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0
    ? explicit
    : fallback
}

/**
 * Tue un process en ESCALADE : SIGTERM d'abord (arrêt propre), puis SIGKILL après un délai de grâce
 * s'il n'a pas rendu la main (zombie / SIGTERM ignoré). Best-effort, ne throw jamais. Le timer de
 * grâce est unref → ne retient pas l'event loop.
 */
export function killEscalate(
  child: {
    kill: (signal?: NodeJS.Signals) => boolean
    killed?: boolean
    exitCode?: number | null
    pid?: number
  },
  tuerArbreDuProcess: (pid: number) => void = tuerArbre
): void {
  try {
    child.kill('SIGTERM')
  } catch {
    /* déjà mort / non killable */
  }
  const grace = setTimeout(() => {
    try {
      if (child.exitCode !== null && child.exitCode !== undefined) return
      child.kill('SIGKILL')
      /*
       * WINDOWS : `child.kill()` ne tue QUE le process direct — Node appelle `TerminateProcess` sur
       * lui seul. Un CLI de provider est un ARBRE (shim npm → node → outils shell, serveurs MCP) :
       * le fils meurt, ses enfants continuent d'écrire, et le Stop de l'utilisateur ne stoppe donc
       * rien du travail réel. `tuerArbre` (taskkill /T /F) est le seul geste qui coupe l'arbre — il
       * est déjà utilisé pour les arbres de vérification, il manquait ici.
       */
      if (child.pid) tuerArbreDuProcess(child.pid)
    } catch {
      /* best-effort */
    }
  }, KILL_GRACE_MS)
  unref(grace)
}

/**
 * Limite pratique de la ligne de commande Windows (~32 ko). On garde une marge pour l'exécutable,
 * l'environnement et le quoting : au-delà, `spawn` échoue avec un `ENAMETOOLONG` opaque.
 */
const ARGV_BUDGET = 28_000

/**
 * GARDE anti-`spawn ENAMETOOLONG` : refuse un argv trop volumineux AVANT le spawn, avec une erreur
 * qui NOMME l'argument coupable (tronqué) au lieu du code système illisible. Un contenu de taille non
 * bornée (prompt, contexte, historique) ne doit JAMAIS transiter par argv — utiliser stdin ou un
 * fichier temporaire. Cette garde attrape les régressions et les chemins non encore migrés.
 */
export function assertArgvWithinLimit(label: string, args: readonly string[]): void {
  const total = args.reduce((sum, arg) => sum + arg.length + 3, 0)
  if (total <= ARGV_BUDGET) return
  const biggest = [...args].sort((a, b) => b.length - a.length)[0] ?? ''
  throw new Error(
    `${label}: ligne de commande trop longue (${total} caractères, limite ~${ARGV_BUDGET}). ` +
      `Le plus gros argument fait ${biggest.length} caractères et commence par « ${biggest.slice(0, 80)}… ». ` +
      `Un contenu de taille non bornée doit passer par stdin ou un fichier, jamais en argument.`
  )
}

function unref(timer: ReturnType<typeof setTimeout>): void {
  const maybe = timer as unknown as { unref?: () => void }
  if (typeof maybe.unref === 'function') maybe.unref()
}

/**
 * Règle `promise` en la faisant courir contre une deadline. Si `ms` s'écoule avant qu'elle se règle,
 * `onExpire` est appelé (best-effort : ex. tuer le process) puis la course REJETTE avec `message`.
 * La promesse d'origine continue en arrière-plan (abandonnée) — c'est au watchdog de flux / à l'abort
 * de nettoyer le process. Le timer est nettoyé quel que soit le vainqueur.
 */
export function withHardDeadline<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onExpire?: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      try {
        onExpire?.()
      } finally {
        reject(new Error(message))
      }
    }, ms)
    unref(timer)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

export interface StreamWatchdog {
  /** Signale une activité (chunk reçu) → réarme le timer d'inactivité. No-op après déclenchement. */
  beat: () => void
  /** Arrête tous les timers (à appeler dès que le flux se termine normalement). Idempotent. */
  dispose: () => void
}

/**
 * Surveille un flux : déclenche `onTrip('inactivity')` si aucun `beat()` pendant `inactivityMs`.
 * Ne déclenche qu'UNE fois puis se dispose. Un seuil absent (undefined/0) désactive le timer.
 * Aucun plafond de durée absolue : une tâche qui parle reste en vie aussi longtemps qu'elle parle.
 */
export function createStreamWatchdog(opts: {
  inactivityMs?: number
  onTrip: (reason: 'inactivity') => void
}): StreamWatchdog {
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined
  let tripped = false

  const dispose = (): void => {
    if (inactivityTimer) clearTimeout(inactivityTimer)
    inactivityTimer = undefined
  }
  const trip = (reason: 'inactivity'): void => {
    if (tripped) return
    tripped = true
    dispose()
    opts.onTrip(reason)
  }
  const beat = (): void => {
    if (tripped || !opts.inactivityMs) return
    if (inactivityTimer) clearTimeout(inactivityTimer)
    inactivityTimer = setTimeout(() => trip('inactivity'), opts.inactivityMs)
    unref(inactivityTimer)
  }

  beat() // arme l'inactivité dès le départ (avant le 1er chunk)
  return { beat, dispose }
}
