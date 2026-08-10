import { assertTraceEvent, type TraceEventV1 } from './trace-event'

/**
 * Plafond du raisonnement transporte dans un evenement. Le raisonnement d'un tour long se compte en
 * dizaines de milliers de caracteres ; la trace est un fichier append-only relu integralement par
 * Observatory. La borne est necessaire — mais elle est ANNONCEE et degrade la fidelite declaree,
 * jamais silencieuse.
 */
export const MAX_REASONING = 30_000

interface ReasoningTraceInput {
  id: string
  conversationId: string
  turnId: string
  parentId?: string
  timestamp: string
  sequence: number
  text: string
}

/**
 * Evenement causal du raisonnement du modele — ACCUMULE sur le tour, ecrit une seule fois.
 *
 * Le raisonnement est emis par fragment (`agent-pilot.ts:543`) : un evenement par fragment produirait
 * des centaines de lignes pour un seul tour et rendrait la chronologie d'Observatory illisible.
 *
 * Type `decision` et non `model-response` : une deliberation n'est pas une reponse remise, et les
 * confondre ferait lire des hypotheses abandonnees comme des conclusions.
 */
export function reasoningToTraceEvent(input: ReasoningTraceInput): TraceEventV1 {
  const tronque = input.text.length > MAX_REASONING
  const content = tronque
    ? `${input.text.slice(0, MAX_REASONING)}\n… (tronqué : ${input.text.length} caractères de raisonnement au total)`
    : input.text

  return assertTraceEvent({
    schema: 'autowin.trace/v1',
    id: input.id,
    conversationId: input.conversationId,
    turnId: input.turnId,
    parentId: input.parentId,
    timestamp: input.timestamp,
    sequence: input.sequence,
    type: 'decision',
    status: 'completed',
    actor: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
    injector: { id: 'autowin', kind: 'system', label: 'Autowin OS' },
    recipient: { id: 'user', kind: 'human', label: 'Utilisateur' },
    channel: 'assistant',
    payloads: [{ kind: 'reasoning', content }],
    observation: {
      boundary: 'Autowin OS model reasoning',
      fidelity: tronque ? 'derived' : 'exact',
      limitation: tronque ? `raisonnement borné à ${MAX_REASONING} caractères` : undefined
    }
  })
}
