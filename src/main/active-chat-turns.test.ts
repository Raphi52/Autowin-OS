import { describe, expect, it, vi } from 'vitest'
import { ActiveChatTurns } from './active-chat-turns'
import { AppCommandBus } from './commands'

describe('ActiveChatTurns', () => {
  it('aborts and waits for the active turn before allowing conversation deletion', async () => {
    const turns = new ActiveChatTurns()
    const controller = new AbortController()
    let finish!: () => void
    const completion = new Promise<void>((resolve) => {
      finish = resolve
    })
    const deleted = vi.fn()
    turns.set('conv-1', controller, completion)

    const removal = (async () => {
      await turns.abortAndWait('conv-1', 'conversation-deleted')
      deleted()
    })()

    await Promise.resolve()
    expect(controller.signal.aborted).toBe(true)
    expect(deleted).not.toHaveBeenCalled()
    finish()
    await removal
    expect(deleted).toHaveBeenCalledOnce()
  })

  it('does not let an older turn clear the newer turn for the same conversation', async () => {
    const turns = new ActiveChatTurns()
    const first = new AbortController()
    const second = new AbortController()
    turns.set('conv-1', first, Promise.resolve())
    turns.set('conv-1', second, Promise.resolve())

    turns.delete('conv-1', first)
    expect(turns.get('conv-1')?.controller).toBe(second)
  })
  it('allows the conversation id to be reused after deletion completed', async () => {
    const turns = new ActiveChatTurns()
    const deletedTurn = new AbortController()
    turns.set('conv-1', deletedTurn, Promise.resolve())
    await turns.abortAndWait('conv-1', 'conversation-deleted')

    const reusedTurn = new AbortController()
    turns.set('conv-1', reusedTurn, Promise.resolve())
    expect(reusedTurn.signal.aborted).toBe(false)
  })

  it('aborts the parent turn and its orchestration without touching another conversation', () => {
    const turns = new ActiveChatTurns()
    const parentA = new AbortController()
    const parentB = new AbortController()
    turns.set('A', parentA, Promise.resolve())
    turns.set('B', parentB, Promise.resolve())
    const bus = new AppCommandBus({} as never, () => {})
    const childA = bus.registerOrchestration('A')
    const childB = bus.registerOrchestration('B')

    const orchestrationAborted = bus.abortOrchestration('A')
    const parentAborted = turns.abort('A', 'user')

    expect(orchestrationAborted || parentAborted).toBe(true)
    expect(parentA.signal.aborted).toBe(true)
    expect(childA.signal.aborted).toBe(true)
    expect(parentB.signal.aborted).toBe(false)
    expect(childB.signal.aborted).toBe(false)
  })
})

/**
 * REGRESSION trouvee par un SCOUT de l'agent Autowin lui-meme (2026-07-28), puis verifiee
 * independamment : `abortAndWait` attendait les completions avec `Promise.all`, qui REJETTE des
 * qu'UNE promesse rejette. Or un tour aborte peut tres bien terminer en erreur.
 *
 * Consequences : la boucle `while` est abandonnee, les tours restants ne sont JAMAIS supprimes, et
 * l'appelant reel — `index.ts` sur le flux « conversation-deleted » — voit sa suppression echouer.
 * L'utilisateur ne peut plus supprimer sa conversation a cause d'un tour qui a mal fini.
 */
describe('abortAndWait — un tour qui REJETTE ne doit pas bloquer la suppression', () => {
  it('resout quand meme et vide les tours', async () => {
    const turns = new ActiveChatTurns()
    const controller = new AbortController()
    // Une completion qui rejette : le cas exact d'un tour aborte terminant en erreur.
    const rejected = Promise.reject(new Error('tour aborte en erreur'))
    rejected.catch(() => {}) // evite un unhandled rejection dans le test lui-meme
    turns.set('conv-1', controller, rejected)

    await expect(turns.abortAndWait('conv-1', 'conversation-deleted')).resolves.toBe(true)
    // Le tour doit avoir ete retire : sinon la conversation reste « occupee » pour toujours.
    expect(turns.get('conv-1')).toBeUndefined()
  })

  it('un tour sain ET un tour qui rejette : les DEUX sont nettoyes', async () => {
    const turns = new ActiveChatTurns()
    const ok = new AbortController()
    const ko = new AbortController()
    const rejected = Promise.reject(new Error('boom'))
    rejected.catch(() => {})
    turns.set('conv-2', ok, Promise.resolve())
    turns.set('conv-2', ko, rejected)

    await expect(turns.abortAndWait('conv-2', 'conversation-deleted')).resolves.toBe(true)
    expect(turns.get('conv-2')).toBeUndefined()
  })
})
