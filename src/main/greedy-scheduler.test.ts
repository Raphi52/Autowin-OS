import { describe, expect, it } from 'vitest'
import { runGreedy, type GreedyNode } from './greedy-scheduler'

/** Deferred contrôlé : on résout/rejette à la main pour piloter l'ordre d'arrivée sans timer. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const tick = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('runGreedy — ordonnanceur completion-driven', () => {
  it('traite chaque nœud DANS L’ORDRE D’ARRIVÉE, pas l’ordre de dispatch', async () => {
    const dSlow = deferred<string>()
    const dFast = deferred<string>()
    const arrival: string[] = []
    const nodes: GreedyNode<string>[] = [
      { id: 'slow', deps: [], run: () => dSlow.promise },
      { id: 'fast', deps: [], run: () => dFast.promise }
    ]
    const done = runGreedy(nodes, { onSettled: (e) => arrival.push(e.id) })
    await tick()
    // 'slow' est dispatché en premier mais 'fast' revient d'abord → doit être traité d'abord.
    dFast.resolve('F')
    await tick()
    dSlow.resolve('S')
    const result = await done
    expect(arrival).toEqual(['fast', 'slow'])
    expect(result.results).toEqual({ slow: 'S', fast: 'F' })
  })

  it('déclenche un nœud aval DÈS que sa dépendance revient, sans attendre les autres', async () => {
    const dA = deferred<string>()
    const dB = deferred<string>()
    let cStartedWhileBRunning = false
    const nodes: GreedyNode<string>[] = [
      { id: 'A', deps: [], run: () => dA.promise },
      { id: 'B', deps: [], run: () => dB.promise }, // indépendant, encore en cours
      {
        id: 'C',
        deps: ['A'],
        run: (deps) => {
          // C ne doit partir qu'après A, mais AVANT que B (toujours en cours) ne finisse.
          cStartedWhileBRunning = true
          expect(deps).toEqual({ A: 'a' })
          return Promise.resolve('c')
        }
      }
    ]
    const done = runGreedy(nodes)
    await tick()
    dA.resolve('a') // A revient → C doit démarrer immédiatement, B tourne encore
    await tick()
    expect(cStartedWhileBRunning).toBe(true)
    dB.resolve('b')
    const result = await done
    expect(result.results).toEqual({ A: 'a', B: 'b', C: 'c' })
    expect(result.failed).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('respecte le plafond de concurrence', async () => {
    let running = 0
    let maxSeen = 0
    const defs = [deferred<number>(), deferred<number>(), deferred<number>(), deferred<number>()]
    const nodes: GreedyNode<number>[] = defs.map((d, i) => ({
      id: `n${i}`,
      deps: [],
      run: () => {
        running++
        maxSeen = Math.max(maxSeen, running)
        return d.promise.then((v) => {
          running--
          return v
        })
      }
    }))
    const done = runGreedy(nodes, { concurrency: 2 })
    await tick()
    expect(maxSeen).toBe(2) // seulement 2 en vol malgré 4 éligibles
    defs[0].resolve(0)
    await tick()
    defs[1].resolve(1)
    await tick()
    defs.forEach((d, i) => d.resolve(i))
    await done
    expect(maxSeen).toBe(2)
  })

  it('cascade : un nœud dont la dépendance échoue est SAUTÉ (jamais lancé)', async () => {
    let cRan = false
    const nodes: GreedyNode<string>[] = [
      { id: 'A', deps: [], run: () => Promise.reject(new Error('boom')) },
      {
        id: 'C',
        deps: ['A'],
        run: () => {
          cRan = true
          return Promise.resolve('c')
        }
      },
      { id: 'D', deps: ['C'], run: () => Promise.resolve('d') } // cascade transitive
    ]
    const result = await runGreedy(nodes)
    expect(cRan).toBe(false)
    expect(result.failed).toEqual(['A'])
    expect(result.skipped.sort()).toEqual(['C', 'D'])
    expect(result.results).toEqual({})
  })

  it('rejette un DAG avec cycle ou dépendance inconnue', async () => {
    await expect(
      runGreedy([
        { id: 'A', deps: ['B'], run: () => Promise.resolve(1) },
        { id: 'B', deps: ['A'], run: () => Promise.resolve(1) }
      ])
    ).rejects.toThrow(/cycle/)
    await expect(
      runGreedy([{ id: 'A', deps: ['ghost'], run: () => Promise.resolve(1) }])
    ).rejects.toThrow(/inconnue/)
  })

  it('numérote les arrivées (order) de façon monotone', async () => {
    const orders: number[] = []
    await runGreedy(
      [
        { id: 'A', deps: [], run: () => Promise.resolve(1) },
        { id: 'B', deps: ['A'], run: () => Promise.resolve(2) }
      ],
      { onSettled: (e) => orders.push(e.order) }
    )
    expect(orders).toEqual([1, 2])
  })
})
