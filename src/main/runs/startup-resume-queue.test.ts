import { describe, expect, it, vi } from 'vitest'
import { StartupResumeQueue } from './startup-resume-queue'

describe('StartupResumeQueue', () => {
  it('ne lance jamais deux reprises automatiques en meme temps', async () => {
    const queue = new StartupResumeQueue()
    let releaseFirst!: () => void
    const first = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
    )
    const second = vi.fn(async () => undefined)

    const firstRun = queue.enqueue(first)
    const secondRun = queue.enqueue(second)
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1))
    expect(second).not.toHaveBeenCalled()

    releaseFirst()
    await Promise.all([firstRun, secondRun])
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('continue la file quand une reprise echoue', async () => {
    const queue = new StartupResumeQueue()
    const failed = queue.enqueue(async () => {
      throw new Error('run rouge')
    })
    const next = vi.fn(async () => undefined)
    const continued = queue.enqueue(next)

    await expect(failed).rejects.toThrow('run rouge')
    await expect(continued).resolves.toBeUndefined()
    expect(next).toHaveBeenCalledTimes(1)
  })
})
