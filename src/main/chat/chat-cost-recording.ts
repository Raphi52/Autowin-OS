import type { CostSink } from '../dashboards/cost'

/**
 * COMPTAGE DU COUT DES TOURS DE CHAT DU SUPERVISEUR.
 *
 * Mesure du 2026-09-11 : `activity/*.jsonl` totalisait 3 074,93 USD sur 5 894 tours de chat quand
 * `cost.jsonl` n'en portait que 644,45 USD sur 823 tours — parce que SEULE l'orchestration
 * alimentait le collecteur de cout. Le plafond et l'alerte a 80 % ne voyaient donc qu'un sixieme
 * de la depense reelle : un garde-fou affiche qui ne gardait rien.
 *
 * Difficulte propre au chat : l'usage d'un tour est publie PLUSIEURS FOIS, sous forme CUMULEE
 * (chaque reglement du superviseur republie le total du tour). Additionner ces instantanes
 * compterait le meme appel deux ou trois fois. Ce recorder n'enregistre donc que le DELTA par
 * rapport a ce qu'il a deja transmis : le total agrege reste exactement le dernier instantane.
 */
export interface ChatTurnUsageSnapshot {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  /** Cout connu CUMULE du tour, ou `null`/`undefined` quand le tour n'est pas tarife. */
  costUsd?: number | null
}

export interface ChatTurnCostIdentity {
  provider: string
  model?: string
  conversationId?: string
  turnId?: string
}

/** Role sous lequel les tours de chat du pilote entrent dans le collecteur de cout. */
export const CHAT_SUPERVISOR_COST_ROLE = 'supervisor'

export class ChatTurnCostRecorder {
  private sent: Required<Omit<ChatTurnUsageSnapshot, 'costUsd'>> & { costUsd: number } = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0
  }

  constructor(private readonly cost: CostSink) {}

  /**
   * Transmet au collecteur ce qui MANQUE encore pour ce tour. Rend `true` si une ligne a ete
   * ecrite. Un instantane identique (ou en retard) au precedent n'ecrit rien.
   */
  record(usage: ChatTurnUsageSnapshot, identity: ChatTurnCostIdentity): boolean {
    const cumul = {
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      cacheReadTokens: usage.cacheReadTokens || 0,
      cacheCreationTokens: usage.cacheCreationTokens || 0,
      costUsd: usage.costUsd ?? 0
    }
    const delta = {
      inputTokens: cumul.inputTokens - this.sent.inputTokens,
      outputTokens: cumul.outputTokens - this.sent.outputTokens,
      cacheReadTokens: cumul.cacheReadTokens - this.sent.cacheReadTokens,
      cacheCreationTokens: cumul.cacheCreationTokens - this.sent.cacheCreationTokens,
      costUsd: cumul.costUsd - this.sent.costUsd
    }
    // Un instantane qui n'apporte RIEN de neuf (ou qui regresse) ne produit pas de ligne : ecrire
    // un delta negatif ferait BAISSER une depense deja consommee.
    if (Object.values(delta).every((n) => n <= 0)) return false
    this.sent = cumul
    this.cost.add({
      provider: identity.provider,
      role: CHAT_SUPERVISOR_COST_ROLE,
      ...(identity.model ? { model: identity.model } : {}),
      ...(identity.conversationId ? { conversationId: identity.conversationId } : {}),
      ...(identity.turnId ? { turnId: identity.turnId } : {}),
      inputTokens: Math.max(0, delta.inputTokens),
      outputTokens: Math.max(0, delta.outputTokens),
      ...(delta.cacheReadTokens > 0 ? { cacheReadTokens: delta.cacheReadTokens } : {}),
      ...(delta.cacheCreationTokens > 0 ? { cacheCreationTokens: delta.cacheCreationTokens } : {}),
      // Un tour NON TARIFE doit rester non tarife : poser 0 le ferait passer pour gratuit au lieu
      // de le compter dans `unpricedTurns`.
      ...(delta.costUsd > 0 ? { costUsd: delta.costUsd } : {})
    })
    return true
  }
}
