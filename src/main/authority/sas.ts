/**
 * Sas d'autorité TTL + inbox de décisions.
 *
 * Quand un agent atteint une décision qui revient à l'humain, il la PROPOSE
 * au sas. Si l'humain ne répond pas avant le TTL, un DÉFAUT SÛR s'applique
 * et l'événement est TRACÉ dans le journal (append-only).
 *
 * Utile pour les agents AFK / nuit : ils peuvent avancer sans bloquer,
 * tout en laissant une trace auditable de chaque défaut appliqué.
 */

/** Une décision en attente d'arbitrage (humain ou défaut sûr). */
export interface Decision<T> {
  id: string
  question: string
  options: T[]
  safeDefault: T
  ttlMs: number
  createdAt: number
}

/** La résolution d'une décision, par l'utilisateur ou par défaut au timeout. */
export type Resolution<T> = {
  id: string
  choice: T
  by: 'user' | 'timeout-default'
  at: number
}

/** Paramètres pour proposer une nouvelle décision au sas. */
interface ProposeParams<T> {
  question: string
  options: T[]
  safeDefault: T
  ttlMs: number
}

export class AuthoritySas {
  private readonly now: () => number
  private nextId = 1
  private readonly decisions = new Map<string, Decision<unknown>>()
  private readonly resolved = new Set<string>()
  private readonly journalLog: Resolution<unknown>[] = []

  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  /** Enfile une nouvelle décision et retourne son id (déterministe, incrémental). */
  propose<T>(p: ProposeParams<T>): string {
    const id = `dec-${this.nextId}`
    this.nextId += 1
    const decision: Decision<T> = {
      id,
      question: p.question,
      options: p.options,
      safeDefault: p.safeDefault,
      ttlMs: p.ttlMs,
      createdAt: this.now()
    }
    this.decisions.set(id, decision as Decision<unknown>)
    return id
  }

  /** Décisions non résolues ET non expirées à l'instant now(). */
  pending(): Decision<unknown>[] {
    const t = this.now()
    const result: Decision<unknown>[] = []
    for (const [id, decision] of this.decisions) {
      if (this.resolved.has(id)) continue
      if (decision.createdAt + decision.ttlMs <= t) continue
      result.push(decision)
    }
    return result
  }

  /** Résolution humaine explicite. Jette si id inconnu ou déjà résolu. */
  resolve(id: string, choice: unknown): Resolution<unknown> {
    const decision = this.decisions.get(id)
    if (!decision) {
      throw new Error(`AuthoritySas.resolve: id inconnu "${id}"`)
    }
    if (this.resolved.has(id)) {
      throw new Error(`AuthoritySas.resolve: id "${id}" déjà résolu`)
    }
    if (!decision.options.includes(choice)) {
      throw new Error(`AuthoritySas.resolve: choix invalide pour "${id}"`)
    }
    this.resolved.add(id)
    const resolution: Resolution<unknown> = {
      id,
      choice,
      by: 'user',
      at: this.now()
    }
    this.journalLog.push(resolution)
    return resolution
  }

  /**
   * Applique le safeDefault à toutes les décisions dont le TTL est dépassé
   * et non encore résolues. Retourne les résolutions 'timeout-default'
   * produites, et les trace dans le journal.
   */
  sweepExpired(): Resolution<unknown>[] {
    const t = this.now()
    const produced: Resolution<unknown>[] = []
    for (const [id, decision] of this.decisions) {
      if (this.resolved.has(id)) continue
      if (decision.createdAt + decision.ttlMs > t) continue
      this.resolved.add(id)
      const resolution: Resolution<unknown> = {
        id,
        choice: decision.safeDefault,
        by: 'timeout-default',
        at: t
      }
      this.journalLog.push(resolution)
      produced.push(resolution)
    }
    return produced
  }

  /** Historique append-only de toutes les résolutions (user + timeout-default). */
  journal(): Resolution<unknown>[] {
    return [...this.journalLog]
  }
}
