import { describe, expect, it } from 'vitest'
import { retrieveBrainContext, brainServiceToken } from './brain-retrieval'

const okFetch = (body: unknown): typeof fetch =>
  (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch

describe('retrieveBrainContext', () => {
  it('renvoie le contexte du serveur quand il répond', async () => {
    const ctx = await retrieveBrainContext('autowin', {
      env: { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv,
      fetchFn: okFetch({ context: '[BRAIN] note pertinente' })
    })
    expect(ctx).toBe('[BRAIN] note pertinente')
  })
  it('dégrade à vide si pas de token', async () => {
    expect(await retrieveBrainContext('q', { env: {} as NodeJS.ProcessEnv, fetchFn: okFetch({ context: 'x' }) })).toBe('')
  })
  it('dégrade à vide si le fetch throw (serveur down)', async () => {
    const boom = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const ctx = await retrieveBrainContext('q', {
      env: { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv,
      fetchFn: boom
    })
    expect(ctx).toBe('')
  })
  it('brainServiceToken lit AMITEL_BRAIN_TOKEN en priorité', () => {
    expect(brainServiceToken({ AMITEL_BRAIN_TOKEN: 'tok' } as NodeJS.ProcessEnv)).toBe('tok')
  })
})
