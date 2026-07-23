import { describe, expect, it } from 'vitest'
import { retrieveBrainContext, brainServiceToken } from './brain-retrieval'

const okFetch = (body: unknown): typeof fetch =>
  (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch

describe('parseNavigation — offsets de chunk + root', () => {
  it('remonte root, chunkByteStart/End quand le serveur les expose', async () => {
    const res = await retrieveBrainContext('q', {
      env: { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv,
      fetchFn: okFetch({
        context: '[BRAIN] x',
        navigation: {
          query: 'q',
          minDense: 0.25,
          root: '\\\\ged2\\rig\\Projets IA\\Amitel Brain',
          candidates: [
            { rank: 1, path: 'knowledge/a.md', type: 'domain', denseCos: 0.5, retained: true, chunkByteStart: 3111, chunkByteEnd: 3907 }
          ]
        }
      })
    })
    expect(res.navigation?.root).toBe('\\\\ged2\\rig\\Projets IA\\Amitel Brain')
    expect(res.navigation?.candidates[0].chunkByteStart).toBe(3111)
    expect(res.navigation?.candidates[0].chunkByteEnd).toBe(3907)
  })
  it('dégrade proprement si un serveur ancien n\'expose ni root ni offsets', async () => {
    const res = await retrieveBrainContext('q', {
      env: { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv,
      fetchFn: okFetch({
        context: '[BRAIN] x',
        navigation: { query: 'q', minDense: 0.25, candidates: [{ rank: 1, path: 'a.md', type: 'domain', denseCos: 0.5, retained: true }] }
      })
    })
    expect(res.navigation?.root).toBeUndefined()
    expect(res.navigation?.candidates[0].chunkByteStart).toBeUndefined()
  })
})

describe('retrieveBrainContext', () => {
  it('renvoie le contexte du serveur quand il répond', async () => {
    const res = await retrieveBrainContext('autowin', {
      env: { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv,
      fetchFn: okFetch({ context: '[BRAIN] note pertinente' })
    })
    expect(res.context).toBe('[BRAIN] note pertinente')
  })
  it('capture la navigation quand le serveur l’expose', async () => {
    const res = await retrieveBrainContext('autowin', {
      env: { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv,
      fetchFn: okFetch({
        context: '[BRAIN]',
        navigation: {
          query: 'autowin',
          minDense: 0.25,
          candidates: [{ rank: 1, path: 'a.md', type: 'domain', denseCos: 0.44, retained: true }]
        }
      })
    })
    expect(res.navigation?.candidates[0]).toEqual({
      rank: 1,
      path: 'a.md',
      type: 'domain',
      denseCos: 0.44,
      retained: true
    })
  })
  it('navigation undefined si serveur ancien (dégradation gracieuse)', async () => {
    const res = await retrieveBrainContext('q', {
      env: { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv,
      fetchFn: okFetch({ context: 'x' })
    })
    expect(res.navigation).toBeUndefined()
  })
  it('dégrade à vide si pas de token', async () => {
    expect(
      (await retrieveBrainContext('q', { env: {} as NodeJS.ProcessEnv, fetchFn: okFetch({ context: 'x' }) })).context
    ).toBe('')
  })
  it('dégrade à vide si le fetch throw (serveur down)', async () => {
    const boom = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const res = await retrieveBrainContext('q', {
      env: { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv,
      fetchFn: boom
    })
    expect(res.context).toBe('')
  })
  it('brainServiceToken lit AMITEL_BRAIN_TOKEN en priorité', () => {
    expect(brainServiceToken({ AMITEL_BRAIN_TOKEN: 'tok' } as NodeJS.ProcessEnv)).toBe('tok')
  })
})
