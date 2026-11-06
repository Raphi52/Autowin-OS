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
  /**
   * Action de récupération best-effort exécutée après le log (ex. abort des orchestrations en vol dont
   * le `finally` ne tournera pas). Invoquée DANS le filet : si elle jette, on l'avale (inviolable).
   */
  onFatal?: () => void
}

/**
 * Redaction best-effort de secrets courants (token Bearer, clés, URL avec credentials) : une lib
 * tierce peut insérer un token dans un message/stack d'erreur (ex. dump d'une requête HTTP) qui
 * finirait en clair dans crash.log. On masque avant d'écrire. (Guardian.)
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***')
    .replace(/((?:authorization|api[-_]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1***')
    .replace(/(https?:\/\/[^:/\s]+:)[^@\s/]+(@)/gi, '$1***$2')
}

/** JSON.stringify infaillible (valeurs circulaires → placeholder au lieu de throw). */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]'
        seen.add(v)
      }
      return v
    })
  } catch {
    return String(value)
  }
}

/** Formate une erreur (ou valeur rejetée) en une ligne de journal horodatée avec stack si dispo. */
export function formatCrashLine(kind: string, err: unknown, now: () => string): string {
  const ts = now()
  const raw =
    err instanceof Error
      ? `[${ts}] ${kind}: ${err.message}\n${err.stack ?? '(no stack)'}\n`
      : `[${ts}] ${kind}: ${typeof err === 'string' ? err : safeStringify(err)}\n`
  return redactSecrets(raw)
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
  // Le handler est INVIOLABLE : même si le FORMATAGE de la ligne (JSON.stringify d'une valeur
  // circulaire) OU le sink casse, on n'a JAMAIS le droit de propager — ça tuerait le process qu'on
  // protège. Le try englobe donc formatCrashLine ET sink (bug corrigé : le formatage était hors try).
  const safe = (kind: string, payload: unknown): void => {
    try {
      sink(formatCrashLine(kind, payload, now))
    } catch {
      /* filet ultime : ne jamais relancer depuis le handler global */
    }
    try {
      opts.onFatal?.()
    } catch {
      /* la récupération est best-effort et ne doit jamais faire propager le handler */
    }
  }
  return {
    onUncaughtException: (err) => safe('uncaughtException', err),
    onUnhandledRejection: (reason) => safe('unhandledRejection', reason)
  }
}

/** Branche les handlers globaux sur `process`. À appeler UNE fois, avant `app.whenReady`. */
export function installCrashHandlers(opts: CrashHandlerOptions): void {
  const h = makeCrashHandlers(opts)
  process.on('uncaughtException', h.onUncaughtException)
  process.on('unhandledRejection', h.onUnhandledRejection)
}
