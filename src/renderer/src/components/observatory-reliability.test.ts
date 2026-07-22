import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LatestRequestGate, settleObservatorySources } from './observatory-reliability'

describe('Observatory reliability', () => {
  it('keeps only the latest request current', () => {
    const gate = new LatestRequestGate()
    const first = gate.begin()
    const second = gate.begin()

    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)
  })

  it('ignores a stale asynchronous response resolved after the latest one', async () => {
    const gate = new LatestRequestGate()
    let resolveFirst!: (value: string) => void
    let resolveSecond!: (value: string) => void
    const first = new Promise<string>((resolve) => (resolveFirst = resolve))
    const second = new Promise<string>((resolve) => (resolveSecond = resolve))
    let rendered = ''
    const load = async (request: Promise<string>): Promise<void> => {
      const id = gate.begin()
      const value = await request
      if (gate.isCurrent(id)) rendered = value
    }

    const firstLoad = load(first)
    const secondLoad = load(second)
    resolveSecond('conversation B')
    await secondLoad
    resolveFirst('conversation A')
    await firstLoad

    expect(rendered).toBe('conversation B')
  })

  it('keeps healthy source values when another source rejects', async () => {
    const result = await settleObservatorySources({
      conversations: Promise.resolve(['ok']),
      promptCalls: Promise.reject(new Error('ledger unavailable')),
      native: Promise.resolve([1])
    })

    expect(result.values).toEqual({ conversations: ['ok'], native: [1] })
    expect(result.errors).toEqual({ promptCalls: 'ledger unavailable' })
  })

  it('wires stale-response protection and a retryable visible error in the view', () => {
    const source = readFileSync(new URL('./ObservatoryView.tsx', import.meta.url), 'utf8')

    expect(source).toContain('causalRequestGate.current.begin()')
    expect(source).toContain('causalRequestGate.current.isCurrent(requestId)')
    expect(source).toContain('Certaines sources de télémétrie sont indisponibles')
    expect(source).toContain('Réessayer')
  })
})
