interface ActiveChatTurn {
  controller: AbortController
  completion: Promise<void>
}

export class ActiveChatTurns {
  private readonly turns = new Map<string, Map<AbortController, ActiveChatTurn>>()
  private readonly deleting = new Set<string>()

  get(conversationId: string): ActiveChatTurn | undefined {
    return [...(this.turns.get(conversationId)?.values() ?? [])].at(-1)
  }

  set(conversationId: string, controller: AbortController, completion: Promise<void>): void {
    const conversationTurns = this.turns.get(conversationId) ?? new Map()
    conversationTurns.set(controller, { controller, completion })
    this.turns.set(conversationId, conversationTurns)
    if (this.deleting.has(conversationId)) controller.abort('conversation-deleted')
  }

  delete(conversationId: string, controller: AbortController): void {
    const conversationTurns = this.turns.get(conversationId)
    if (!conversationTurns) return
    conversationTurns.delete(controller)
    if (conversationTurns.size === 0) this.turns.delete(conversationId)
  }

  abort(conversationId: string, reason: string): boolean {
    const conversationTurns = this.turns.get(conversationId)
    if (!conversationTurns?.size) return false
    for (const turn of conversationTurns.values()) turn.controller.abort(reason)
    return true
  }

  async abortAndWait(conversationId: string, reason: string): Promise<boolean> {
    this.deleting.add(conversationId)
    let aborted = false
    try {
      while (this.turns.get(conversationId)?.size) {
        const active = [...this.turns.get(conversationId)!.values()]
        for (const turn of active) turn.controller.abort(reason)
        aborted = true
        await Promise.all(active.map((turn) => turn.completion))
        for (const turn of active) this.delete(conversationId, turn.controller)
      }
      return aborted
    } finally {
      this.deleting.delete(conversationId)
    }
  }
}
