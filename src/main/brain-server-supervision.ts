/**
 * SURVEILLANCE DU brain_server PENDANT TOUTE LA SESSION.
 *
 * Défaut mesuré le 2026-09-04 (conv-270) : `watchAppPreflight` est une boucle de DÉMARRAGE bornée
 * (7 re-sondes, ~118 s cumulés) qui s'arrête dès que le check `brain` passe au vert. Donc un
 * brain_server qui MEURT en cours de session n'était jamais relancé : l'app répondait « Brain
 * injoignable » jusqu'à un démarrage à la main dans une console — exactement ce que l'utilisateur
 * subissait. `ensureBrainServerStarted` savait le lancer sans fenêtre ; il manquait seulement
 * quelqu'un pour le rappeler après le démarrage.
 *
 * Ici : un battement périodique qui ping, réarme les tentatives tant que le service vit, et le
 * relance dès qu'il tombe. Les gardes anti-spam (cooldown + plafond) vivent déjà dans
 * `ensureBrainServerStarted` et ne sont pas dupliquées.
 */
import { ensureBrainServerStarted, resetBrainLaunchAttempt } from './brain-server-launch'

/** Battement par défaut : assez lent pour ne rien coûter, assez court pour une reprise en < 1 min. */
export const BRAIN_SUPERVISION_INTERVAL_MS = 45_000

export interface BrainSupervisionDeps {
  pingBrain: () => Promise<boolean>
  ensureStarted?: typeof ensureBrainServerStarted
  reset?: typeof resetBrainLaunchAttempt
  setIntervalFn?: (fn: () => void, ms: number) => unknown
  clearIntervalFn?: (handle: unknown) => void
  onEvent?: (message: string) => void
}

export interface BrainSupervisionHandle {
  /** Exposé pour les tests : joue UN battement et rend ce qui a été décidé. */
  tick: () => Promise<'alive' | 'relaunch-attempted'>
  stop: () => void
}

export function superviseBrainServer(
  deps: BrainSupervisionDeps,
  intervalMs: number = BRAIN_SUPERVISION_INTERVAL_MS
): BrainSupervisionHandle {
  const ensure = deps.ensureStarted ?? ensureBrainServerStarted
  const reset = deps.reset ?? resetBrainLaunchAttempt
  const setIntervalFn =
    deps.setIntervalFn ??
    ((fn, ms): unknown => {
      const t = setInterval(fn, ms)
      if (typeof t === 'object' && t && 'unref' in t) (t as { unref: () => void }).unref()
      return t
    })
  const clearIntervalFn = deps.clearIntervalFn ?? ((h): void => clearInterval(h as NodeJS.Timeout))

  const tick = async (): Promise<'alive' | 'relaunch-attempted'> => {
    let up = false
    try {
      up = await deps.pingBrain()
    } catch {
      up = false // ping en erreur = service traité comme absent
    }
    if (up) {
      reset() // il vit → la prochaine chute redonne droit à un plein quota de tentatives
      return 'alive'
    }
    const r = await ensure(async () => false) // le ping vient d'être fait : ne pas le refaire
    deps.onEvent?.(`[brain-supervision] ${r.status} — ${r.detail}`)
    return 'relaunch-attempted'
  }

  const handle = setIntervalFn(() => {
    void tick()
  }, intervalMs)

  return { tick, stop: () => clearIntervalFn(handle) }
}
