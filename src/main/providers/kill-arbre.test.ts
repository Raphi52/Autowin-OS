import { describe, expect, it, vi } from 'vitest'
import { killEscalate } from './watchdog'

/**
 * Le Stop de l'utilisateur doit couper l'ARBRE du CLI, pas seulement son process direct :
 * sinon les petits-enfants (node du CLI, outils shell, serveurs MCP) continuent de travailler.
 */
describe('killEscalate', () => {
  it("tue l'arbre du process quand le fils n'a pas rendu la main", async () => {
    vi.useFakeTimers()
    const tues: number[] = []
    const child = { pid: 4242, exitCode: null as number | null, kill: vi.fn(() => true) }
    killEscalate(child, (pid) => tues.push(pid))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(tues).toEqual([4242])
    vi.useRealTimers()
  })

  it('ne tue aucun arbre si le fils est deja sorti', async () => {
    vi.useFakeTimers()
    const tues: number[] = []
    const child = { pid: 7, exitCode: 0, kill: vi.fn(() => true) }
    killEscalate(child, (pid) => tues.push(pid))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(tues).toEqual([])
    vi.useRealTimers()
  })
})
