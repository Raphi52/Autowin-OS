/**
 * File globale des reprises automatiques au démarrage.
 *
 * Chaque orchestration possède ses propres limites, mais un redémarrage peut retrouver plusieurs
 * conversations : sans cette file, toutes repartent ensemble et multiplient agents, worktrees et
 * appels providers. Une erreur ne condamne pas les reprises suivantes.
 */
export class StartupResumeQueue {
  private tail: Promise<void> = Promise.resolve()

  enqueue(task: () => Promise<void>): Promise<void> {
    const current = this.tail.then(task)
    this.tail = current.catch(() => undefined)
    return current
  }
}
