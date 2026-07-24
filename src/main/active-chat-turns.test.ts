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
