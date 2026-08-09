import type { TracePayload } from './trace-event'

/**
 * Forme minimale d'une etape d'orchestration dont la trace a besoin — structurelle plutot qu'un
 * import d'`OrchestrationStep`, pour qu'un champ ajoute la-bas ne puisse jamais casser une ecriture
 * de trace ici.
 */
export interface StepLike {
  step: string
  text?: string
  detail?: string
  error?: string
  /** Raisonnement du sous-agent — affiche dans le chat, absent de la trace jusqu'au 2026-08-07. */
  thinking?: string
}

/**
 * Charges de la trace d'une etape d'orchestration.
 *
 * La charge principale reprend exactement la regle d'origine (`error ?? text ?? detail`), et le
 * raisonnement du sous-agent vient S'AJOUTER en charge distincte.
 *
 * Deliberation et conclusion restent SEPAREES a dessein : les concatener ferait lire un raisonnement
 * exploratoire — avec ses hypotheses abandonnees — comme la reponse effectivement remise. C'est la
 * meme raison qui justifie un genre `reasoning` distinct de `model-response` dans le contrat.
 */
export function stepPayloads(step: StepLike): TracePayload[] {
  const payloads: TracePayload[] = [
    {
      kind: step.step === 'gate' ? 'app-state' : 'model-response',
      content: step.error ?? step.text ?? step.detail ?? ''
    }
  ]
  const thinking = step.thinking?.trim()
  if (thinking) payloads.push({ kind: 'reasoning', content: thinking })
  return payloads
}
