import type { PreflightResult } from './preflight'

/**
 * Quand ANNONCER un diagnostic de démarrage — et quand se taire.
 *
 * Le brain_server met plusieurs secondes à répondre au lancement (spawn, puis warm-up fastembed).
 * Annoncer son absence dès la première sonde produit une alerte pour un service qui est simplement en
 * train de démarrer : l'utilisateur voit une panne là où il n'y a qu'une attente, et apprend à ignorer
 * la bannière. Une alerte qu'on apprend à ignorer ne protège plus de rien.
 *
 * La règle inverse : on laisse au Brain un délai de grâce, et on ne parle QUE s'il a vraiment échoué —
 * en disant alors POURQUOI, ce que la première sonde ne pouvait pas savoir.
 *
 * Ce qui ne se répare pas tout seul, en revanche, s'annonce tout de suite : une session CLI absente ne
 * deviendra pas présente en attendant dix secondes.
 */

/** Ce que la tentative de démarrage du service local a donné, si elle a eu lieu. */
export interface BrainLaunchOutcome {
  status: 'already-up' | 'starting' | 'unavailable'
  detail?: string
}

export interface AnnounceContext {
  /** Temps écoulé depuis le début de la surveillance. */
  elapsedMs: number
  /** Délai laissé au Brain avant de parler de lui. */
  graceMs: number
  brainLaunch?: BrainLaunchOutcome
}

export interface AnnounceDecision {
  announce: boolean
  /** Le résultat à pousser, détail du Brain enrichi quand on parle après la grâce. */
  result: PreflightResult
}

export const DEFAULT_BRAIN_GRACE_MS = 10_000

function failing(result: PreflightResult): PreflightResult['checks'] {
  return result.checks.filter((check) => !check.ok)
}

/**
 * Le « pourquoi » que la première sonde ne pouvait pas donner. La tentative de démarrage l'a appris
 * entre-temps : c'est elle qu'on relaie, pas un message générique.
 */
function brainReason(outcome: BrainLaunchOutcome | undefined, graceMs: number): string {
  const secondes = Math.round(graceMs / 1000)
  if (outcome?.status === 'unavailable' && outcome.detail) {
    return `injoignable après ${secondes} s — ${outcome.detail}`
  }
  if (outcome?.status === 'starting') {
    return `démarré mais toujours pas prêt après ${secondes} s — warm-up anormalement long, RAG désactivé`
  }
  return `injoignable après ${secondes} s — service local non démarré, RAG désactivé`
}

export function decidePreflightAnnouncement(
  result: PreflightResult,
  context: AnnounceContext
): AnnounceDecision {
  const rouges = failing(result)
  // Tout va bien : on parle, ne serait-ce que pour effacer une bannière affichée plus tôt.
  if (rouges.length === 0) return { announce: true, result }

  const seulementBrain = rouges.every((check) => check.id === 'brain')
  if (!seulementBrain) {
    // Une session CLI absente ne se répare pas en attendant : la retenir n'apporterait rien et
    // retarderait un diagnostic utile.
    return { announce: true, result }
  }

  if (context.elapsedMs < context.graceMs) return { announce: false, result }

  const raison = brainReason(context.brainLaunch, context.graceMs)
  return {
    announce: true,
    result: {
      ...result,
      checks: result.checks.map((check) =>
        check.id === 'brain' && !check.ok ? { ...check, detail: raison } : check
      )
    }
  }
}
