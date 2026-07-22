/**
 * #6 — Transform PUR pour la timeline coût/confiance type CI/CD. Prend les steps d'orchestration
 * (déjà porteurs de durationMs / costUsd / tokens / role / phase) et produit des SEGMENTS waterfall
 * prêts à rendre : offset cumulé (position horizontale), durée (largeur), coût/tokens (intensité),
 * ok (couleur), + une confiance de run dérivée du verdict juge.
 *
 * Aucune dépendance UI ni Node → testable directement. Rendu par un composant renderer séparé.
 */
import type { OrchestrationStep } from '../main/orchestrator'

export interface TimelineSegment {
  index: number
  step: 'exec' | 'judge' | 'gate'
  /** Phase du pipeline si connue (extrait du detail "phase X"), sinon le rôle/step. */
  label: string
  role?: string
  provider?: string
  offsetMs: number
  durationMs: number
  costUsd: number
  tokens: number
  ok: boolean
}

export interface CostConfidenceTimeline {
  segments: TimelineSegment[]
  totalMs: number
  totalUsd: number
  totalTokens: number
  /** Confiance du run : true si le juge a validé (aucun verdict/défaut → false). */
  confidence: boolean
}

/** Extrait un libellé de phase lisible depuis le step (detail "phase X" > role > step). */
function labelOf(step: OrchestrationStep): string {
  const m = /phase\s+([a-z]+)/i.exec(step.detail ?? '')
  if (m) return m[1]
  return step.role ?? step.step
}

/** Construit la timeline waterfall à partir des steps (dans l'ordre d'exécution). */
export function buildCostConfidenceTimeline(steps: OrchestrationStep[]): CostConfidenceTimeline {
  const segments: TimelineSegment[] = []
  let offset = 0
  let totalUsd = 0
  let totalTokens = 0
  let confidence = false
  let index = 0
  for (const step of steps) {
    if (step.step === 'gate') {
      // Le gate n'a pas de durée propre significative ; il ne crée pas de segment mais peut porter
      // le verdict final (traité via les steps judge ci-dessous).
      continue
    }
    const durationMs = step.durationMs ?? 0
    const costUsd = step.costUsd ?? 0
    const tokens = step.tokens ?? 0
    const ok = step.status !== 'failed'
    segments.push({
      index: index++,
      step: step.step,
      label: labelOf(step),
      role: step.role,
      provider: step.provider,
      offsetMs: offset,
      durationMs,
      costUsd,
      tokens,
      ok
    })
    offset += durationMs
    totalUsd += costUsd
    totalTokens += tokens
    // Confiance : le dernier verdict juge "validé" fait foi.
    if (step.step === 'judge') confidence = /valid/i.test(step.detail ?? '') || step.detail === 'validé'
  }
  return { segments, totalMs: offset, totalUsd, totalTokens, confidence }
}
