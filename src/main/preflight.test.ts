import { describe, it, expect } from 'vitest'
import { runPreflight } from './preflight'

describe('runPreflight', () => {
  it('tout OK → ok:true, résumé positif', async () => {
    const r = await runPreflight({
      pingBrain: async () => true,
      hasBin: async () => true,
      hasBrainToken: () => true
    })
    expect(r.ok).toBe(true)
    expect(r.checks).toHaveLength(4)
    expect(r.summary).toContain('OK')
  })

  it('brain down + codex absent → ok:false, détaille les manquants', async () => {
    const r = await runPreflight({
      pingBrain: async () => false,
      hasBin: async (w) => w === 'claude',
      hasBrainToken: () => true
    })
    expect(r.ok).toBe(false)
    const failed = r.checks.filter((c) => !c.ok).map((c) => c.id)
    expect(failed).toContain('brain')
    expect(failed).toContain('codex')
    expect(failed).not.toContain('claude')
    expect(r.summary).toMatch(/incomplète/i)
  })

  it('un probe qui throw = ko, jamais un crash', async () => {
    const r = await runPreflight({
      pingBrain: async () => {
        throw new Error('ECONNREFUSED')
      },
      hasBin: async () => {
        throw new Error('spawn fail')
      },
      hasBrainToken: () => {
        throw new Error('fs')
      }
    })
    expect(r.ok).toBe(false)
    expect(r.checks.every((c) => !c.ok)).toBe(true)
  })
})
