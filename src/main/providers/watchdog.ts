/**
 * Watchdogs anti-blocage des sous-agents. Deux briques indépendantes et testables :
 *
 *  - `withHardDeadline` : garantie de COORDINATION — une promesse d'attente se règle TOUJOURS (au pire
 *    par un rejet-deadline), même si le producteur sous-jacent ne se résout jamais (process zombie,
 *    event `close` qui ne tire pas). C'est le filet qui empêche « bloqué des jours ».
 *  - `createStreamWatchdog` : surveillance d'un flux — timer d'INACTIVITÉ réarmé à chaque battement
 *    (chunk stdout) + cap TOTAL. Déclenche `onTrip` UNE seule fois (figé → à tuer), distinguant un
 *    silence prolongé d'une tâche longue mais qui progresse.
 *
 * Les timers sont `unref()` : ils ne retiennent jamais l'event loop (pas de fuite au quit).
 */

const envMs = (name: string, fallback: number): number => {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

/**
 * Défauts anti-blocage des sous-agents CLI (tous env-overridables) :
 *  - INACTIVITÉ : silence stdout au-delà → figé → kill. Détecteur FIN d'un vrai blocage.
 *  - TOTAL : plafond de durée d'un tour, même s'il progresse (backstop généreux).
 * Ancien comportement = un simple kill total à 120s SANS filet de rejet (→ pouvait pendre à l'infini
 * si `close` ne tirait pas). L'inactivité 5 min reste le vrai signal de figé. Le cap total doit
 * laisser finir un build actif. Ces valeurs sont les gardes des appels directs ; une orchestration
 * transporte désormais la durée de son devis jusqu'au watchdog et au plafond de coordination.
 */
export const SUBAGENT_INACTIVITY_MS = envMs('AUTOWIN_SUBAGENT_INACTIVITY_MS', 5 * 60_000)
export const SUBAGENT_TOTAL_MS = envMs('AUTOWIN_SUBAGENT_TOTAL_MS', 40 * 60_000)
/** Délai de grâce entre SIGTERM et SIGKILL lors de l'escalade de kill d'un process figé. */
export const KILL_GRACE_MS = envMs('AUTOWIN_SUBAGENT_KILL_GRACE_MS', 3_000)

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
export function killEscalate(child: {
  kill: (signal?: NodeJS.Signals) => boolean
  killed?: boolean
  exitCode?: number | null
}): void {
  try {
    child.kill('SIGTERM')
  } catch {
    /* déjà mort / non killable */
  }
  const grace = setTimeout(() => {
    try {
      if (child.exitCode === null || child.exitCode === undefined) child.kill('SIGKILL')
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
 * Surveille un flux : déclenche `onTrip('inactivity')` si aucun `beat()` pendant `inactivityMs`, ou
 * `onTrip('total')` si `totalMs` s'écoule depuis la création. Ne déclenche qu'UNE fois puis se dispose.
 * Un seuil absent (undefined/0) désactive le timer correspondant.
 */
export function createStreamWatchdog(opts: {
  inactivityMs?: number
  totalMs?: number
  onTrip: (reason: 'inactivity' | 'total') => void
}): StreamWatchdog {
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined
  let totalTimer: ReturnType<typeof setTimeout> | undefined
  let tripped = false

  const dispose = (): void => {
    if (inactivityTimer) clearTimeout(inactivityTimer)
    if (totalTimer) clearTimeout(totalTimer)
    inactivityTimer = undefined
    totalTimer = undefined
  }
  const trip = (reason: 'inactivity' | 'total'): void => {
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

  if (opts.totalMs && opts.totalMs > 0) {
    totalTimer = setTimeout(() => trip('total'), opts.totalMs)
    unref(totalTimer)
  }
  beat() // arme l'inactivité dès le départ (avant le 1er chunk)
  return { beat, dispose }
}
