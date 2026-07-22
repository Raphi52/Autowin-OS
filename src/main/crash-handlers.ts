/**
 * Filet de sécurité process-level (#1) : sans ça, UNE promesse non-catchée (callback IPC, timer,
 * stream provider) fait crasher tout le process Electron main → toutes les fenêtres, tous les runs et
 * la persistance en mémoire non flushée disparaissent. On installe des handlers globaux qui LOGGENT
 * l'erreur (fichier + console) et laissent le process VIVRE plutôt que mourir en silence.
 *
 * Le handler est un filet, PAS une excuse : il ne doit jamais MASQUER un bug (il loggue tout,
 * horodaté, avec la stack), il empêche seulement qu'un oubli ponctuel tue toute la session.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface CrashHandlerOptions {
  /** Répertoire où append le journal des crashes non fatals (créé si absent). */
  logDir: string
  /** Sink de log injectable (test). Défaut : append fichier + console.error. */
  sink?: (line: string) => void
  /** Horodatage injectable (test déterministe). Défaut : ISO now. */
  now?: () => string
}

/** Formate une erreur (ou valeur rejetée) en une ligne de journal horodatée avec stack si dispo. */
export function formatCrashLine(kind: string, err: unknown, now: () => string): string {
  const ts = now()
  if (err instanceof Error) {
    return `[${ts}] ${kind}: ${err.message}\n${err.stack ?? '(no stack)'}\n`
  }
  return `[${ts}] ${kind}: ${typeof err === 'string' ? err : JSON.stringify(err)}\n`
}

/**
 * Construit (sans les brancher) les 2 handlers. Exposé pour test : on peut invoquer le handler
 * directement et vérifier qu'il LOGGUE sans throw (le process survit), avec un sink/now injectés.
 */
export function makeCrashHandlers(opts: CrashHandlerOptions): {
  onUncaughtException: (err: unknown) => void
  onUnhandledRejection: (reason: unknown) => void
} {
  const now = opts.now ?? (() => new Date().toISOString())
  const sink =
    opts.sink ??
    ((line: string) => {
      try {
        mkdirSync(opts.logDir, { recursive: true })
        appendFileSync(join(opts.logDir, 'crash.log'), line, 'utf8')
      } catch {
        /* le log de secours ne doit JAMAIS relancer une exception depuis le handler */
      }
      // eslint-disable-next-line no-console
      console.error(line.trimEnd())
    })
  // Le handler est INVIOLABLE : même si le sink lui-même casse, on n'a JAMAIS le droit de propager
  // (ça tuerait le process qu'on protège). On avale toute erreur du sink en dernier recours.
  const safe = (line: string): void => {
    try {
      sink(line)
    } catch {
      /* filet ultime : ne jamais relancer depuis le handler global */
    }
  }
  return {
    onUncaughtException: (err) => safe(formatCrashLine('uncaughtException', err, now)),
    onUnhandledRejection: (reason) => safe(formatCrashLine('unhandledRejection', reason, now))
  }
}

/** Branche les handlers globaux sur `process`. À appeler UNE fois, avant `app.whenReady`. */
export function installCrashHandlers(opts: CrashHandlerOptions): void {
  const h = makeCrashHandlers(opts)
  process.on('uncaughtException', h.onUncaughtException)
  process.on('unhandledRejection', h.onUnhandledRejection)
}
