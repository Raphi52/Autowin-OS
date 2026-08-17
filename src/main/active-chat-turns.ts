interface ActiveChatTurn {
  controller: AbortController
  completion: Promise<void>
}

export class ActiveChatTurns {
  private readonly turns = new Map<string, Map<AbortController, ActiveChatTurn>>()
  private readonly deleting = new Set<string>()
  private readonly idleWaiters = new Set<() => void>()
  private readonly interactiveWaiters = new Set<() => void>()
  private readonly activeWaiters = new Map<string, Set<() => void>>()
  private idleLeaseHeld = false
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

  /**
   * Attend la courte course renderer -> IPC -> enregistrement du tour.
   * fix-ok: sans cette barriere bornee, « Orienter » echoue si le clic devance `set()` de quelques ms.
   */
  waitForActive(conversationId: string, timeoutMs: number): Promise<boolean> {
    if (this.get(conversationId)) return Promise.resolve(true)
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.resolve(false)

    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (active: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const waiters = this.activeWaiters.get(conversationId)
        waiters?.delete(onActive)
        if (waiters?.size === 0) this.activeWaiters.delete(conversationId)
        resolve(active)
      }
      const onActive = (): void => finish(true)
      const timer = setTimeout(() => finish(false), Math.min(Math.floor(timeoutMs), 2_147_000_000))
      timer.unref?.()
      const waiters = this.activeWaiters.get(conversationId) ?? new Set()
      waiters.add(onActive)
      this.activeWaiters.set(conversationId, waiters)
      // Ferme la course entre le premier test et l'inscription du waiter.
      if (this.get(conversationId)) onActive()
    })
  }

  /**
   * Attend l'inactivite sans jamais interrompre un tour existant. Le delai appartient a l'appelant :
   * un reveil de fond doit pouvoir renoncer plutot que prendre la main sur le travail interactif.
   *
   * fix-ok: le Watchdog avait seulement une primitive destructive `abortAndWait`; cette attente
   * non destructive est la frontiere minimale qui permet au dispatch de rester fail-closed.
   */
  waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.turns.size === 0 && !this.idleLeaseHeld) {
      this.idleLeaseHeld = true
      return Promise.resolve(true)
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.resolve(false)

    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (idle: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.idleWaiters.delete(onIdle)
        resolve(idle)
      }
      const onIdle = (): void => {
        if (this.turns.size > 0 || this.idleLeaseHeld) return
        this.idleLeaseHeld = true
        finish(true)
      }
      const timer = setTimeout(() => finish(false), Math.min(Math.floor(timeoutMs), 2_147_000_000))
      timer.unref?.()
      this.idleWaiters.add(onIdle)
      // Ferme la course entre le premier test et l'inscription du waiter.
      this.grantNextIdleLease()
    })
  }

  /**
   * Barriere symetrique pour un tour humain. Une fois l'inactivite accordee au Watchdog, aucun
   * nouveau tour interactif ne peut se glisser entre le controle et le spawn du provider.
   */
  waitForInteractiveAccess(): Promise<void> {
    if (!this.idleLeaseHeld) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const admit = (): void => {
        this.interactiveWaiters.delete(admit)
        resolve()
      }
      this.interactiveWaiters.add(admit)
      if (!this.idleLeaseHeld) admit()
    })
  }

  /** Rend le lease acquis par `waitForIdle`, y compris sur erreur ou annulation du reveil. */
  releaseIdleLease(): void {
    if (!this.idleLeaseHeld) return
    this.idleLeaseHeld = false
    if (this.interactiveWaiters.size > 0) {
      for (const admit of [...this.interactiveWaiters]) admit()
      // Les reactions des promesses interactives enregistrent leur tour avant qu'un autre reveil
      // puisse reprendre le lease. Sans ce tour de microtask, le fond gagnerait encore la course.
      queueMicrotask(() => this.grantNextIdleLease())
      return
    }
    this.grantNextIdleLease()
  }

  private grantNextIdleLease(): void {
    if (this.turns.size > 0 || this.idleLeaseHeld) return
    const next = this.idleWaiters.values().next().value as (() => void) | undefined
    next?.()
  }

  set(conversationId: string, controller: AbortController, completion: Promise<void>): void {
    const conversationTurns = this.turns.get(conversationId) ?? new Map()
    conversationTurns.set(controller, { controller, completion })
    this.turns.set(conversationId, conversationTurns)
    for (const notify of [...(this.activeWaiters.get(conversationId) ?? [])]) notify()
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
    if (this.turns.size === 0) this.grantNextIdleLease()
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
