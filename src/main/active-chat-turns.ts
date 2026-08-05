interface ActiveChatTurn {
  controller: AbortController
  completion: Promise<void>
}

export class ActiveChatTurns {
  private readonly turns = new Map<string, Map<AbortController, ActiveChatTurn>>()
  private readonly deleting = new Set<string>()
  /**
   * Conversations dont le dernier arrêt a été DÉLIBÉRÉ (clic Stop, suppression de conversation).
   *
   * La raison était déjà passée à `controller.abort(reason)` mais jamais MÉMORISÉE : elle disparaissait
   * avec le tour, alors que l'évènement de fin d'orchestration — celui qui décide s'il y a un incident —
   * arrive après. Résultat rapporté par l'utilisateur : couper un run auto-kaizen en déclenchait un
   * autre, chaque arrêt engendrant son incident.
   *
   * Effacé au DÉMARRAGE du tour suivant, pas après un délai : déterministe, sans minuterie, et
   * sémantiquement juste — un nouveau tour signifie que la fenêtre d'arrêt est refermée. Un drapeau
   * resté armé ne peut donc étouffer que ce qui survient AVANT le prochain tour de la conversation.
   */
  private readonly deliberatelyStopped = new Set<string>()

  get(conversationId: string): ActiveChatTurn | undefined {
    return [...(this.turns.get(conversationId)?.values() ?? [])].at(-1)
  }

  set(conversationId: string, controller: AbortController, completion: Promise<void>): void {
    const conversationTurns = this.turns.get(conversationId) ?? new Map()
    conversationTurns.set(controller, { controller, completion })
    this.turns.set(conversationId, conversationTurns)
    // Un nouveau tour referme la fenêtre d'arrêt délibéré : ce qui échouera désormais est un VRAI échec.
    this.deliberatelyStopped.delete(conversationId)
    if (this.deleting.has(conversationId)) controller.abort('conversation-deleted')
  }

  /**
   * Marque un arrêt VOULU. Appelé aussi par les chemins qui ne passent pas par `abort()` ci-dessous
   * (`os:orchestrate:cancel` ne coupe que l'orchestration), sinon la moitié des arrêts resterait
   * indiscernable d'une panne.
   */
  markDeliberateStop(conversationId: string): void {
    this.deliberatelyStopped.add(conversationId)
  }

  /**
   * Le dernier arrêt de cette conversation a-t-il été demandé ? Consulté avant de créer un incident :
   * un clic sur Stop n'est pas un défaut à analyser.
   */
  wasDeliberatelyStopped(conversationId: string): boolean {
    return this.deliberatelyStopped.has(conversationId)
  }

  delete(conversationId: string, controller: AbortController): void {
    const conversationTurns = this.turns.get(conversationId)
    if (!conversationTurns) return
    conversationTurns.delete(controller)
    if (conversationTurns.size === 0) this.turns.delete(conversationId)
  }

  abort(conversationId: string, reason: string): boolean {
    // Marqué AVANT le test de présence : couper une conversation dont le tour vient tout juste de finir
    // reste un arrêt voulu, et son orchestration peut encore rendre son résultat rouge derrière.
    this.deliberatelyStopped.add(conversationId)
    const conversationTurns = this.turns.get(conversationId)
    if (!conversationTurns?.size) return false
    for (const turn of conversationTurns.values()) turn.controller.abort(reason)
    return true
  }

  async abortAndWait(conversationId: string, reason: string): Promise<boolean> {
    // Supprimer une conversation est un geste tout aussi délibéré qu'un clic sur Stop.
    this.deliberatelyStopped.add(conversationId)
    this.deleting.add(conversationId)
    let aborted = false
    try {
      while (this.turns.get(conversationId)?.size) {
        const active = [...this.turns.get(conversationId)!.values()]
        for (const turn of active) turn.controller.abort(reason)
        aborted = true
        // `allSettled`, PAS `all` : un tour aborté peut terminer en erreur, et `all` rejetterait —
        // abandonnant la boucle, laissant les tours restants en place, et faisant échouer la
        // suppression de conversation côté appelant (« conversation-deleted »). Ici on veut attendre
        // la FIN de chacun, pas leur succès : l'échec d'un tour qu'on vient d'abandonner est normal.
        await Promise.allSettled(active.map((turn) => turn.completion))
        for (const turn of active) this.delete(conversationId, turn.controller)
      }
      return aborted
    } finally {
      this.deleting.delete(conversationId)
    }
  }
}
