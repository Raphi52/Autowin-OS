import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  retrieveBrainContext,
  brainServiceToken,
  clearBrainRetrievalCache
} from './brain-retrieval'

// La mémoire courte est PORTÉE PAR LE MODULE : sans remise à zéro, un test servirait la réponse
// mémorisée par le précédent (ils partagent la requête « q »). Effet de bord réel du cache, pas
// une bizarrerie de test — c'est aussi ce qui se passerait entre deux appelants de l'app.
beforeEach(() => clearBrainRetrievalCache())

const TEST_TOKEN = 'x'.repeat(40)

const signedPayload = (body: Record<string, unknown>): Record<string, unknown> => {
  if ('signature' in body) return body
  const context = typeof body.context === 'string' ? body.context : ''
  const authenticated = JSON.stringify({ context, navigation: body.navigation ?? null })
  return {
    service: 'amitel-brain',
    protocol: 2,
    authenticated,
    signature: createHmac('sha256', TEST_TOKEN)
      .update(`amitel-brain\n2\n${authenticated}`, 'utf8')
      .digest('hex')
  }
}

const okFetch = (body: Record<string, unknown>): typeof fetch =>
  (async () => ({ ok: true, json: async () => signedPayload(body) })) as unknown as typeof fetch

describe('parseNavigation — offsets de chunk + root', () => {
  it('borne le nombre de candidats signés avant exposition à l’UI', async () => {
    const candidates = Array.from({ length: 150 }, (_, index) => ({
      rank: index + 1,
      path: `knowledge/${index}.md`,
      type: 'domain',
      denseCos: 0.5,
      retained: true
    }))
    const res = await retrieveBrainContext('q', {
      env: { AMITEL_BRAIN_TOKEN: TEST_TOKEN } as NodeJS.ProcessEnv,
      fetchFn: okFetch({
        context: '[BRAIN] borné',
        navigation: { query: 'q', minDense: 0.25, candidates }
      })
    })
    expect(res.navigation?.candidates).toHaveLength(100)
  })

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
            {
              rank: 1,
              path: 'knowledge/a.md',
              type: 'domain',
              denseCos: 0.5,
              denseScore: 0.5,
              lexicalScore: 1,
              graphScore: 0.55,
              fusedScore: 0.048,
              relations: [{ type: 'related', target: 'knowledge/b.md' }],
              retained: true,
              chunkByteStart: 3111,
              chunkByteEnd: 3907
            }
          ]
        }
      })
    })
    expect(res.navigation?.root).toBe('\\\\ged2\\rig\\Projets IA\\Amitel Brain')
    expect(res.navigation?.candidates[0].chunkByteStart).toBe(3111)
    expect(res.navigation?.candidates[0].chunkByteEnd).toBe(3907)
    expect(res.navigation?.candidates[0].graphScore).toBe(0.55)
    expect(res.navigation?.candidates[0].relations).toEqual([
      { type: 'related', target: 'knowledge/b.md' }
    ])
  })
  it("dégrade proprement si un serveur ancien n'expose ni root ni offsets", async () => {
    const res = await retrieveBrainContext('q', {
      env: { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv,
      fetchFn: okFetch({
        context: '[BRAIN] x',
        navigation: {
          query: 'q',
          minDense: 0.25,
          candidates: [{ rank: 1, path: 'a.md', type: 'domain', denseCos: 0.5, retained: true }]
        }
      })
    })
    expect(res.navigation?.root).toBeUndefined()
    expect(res.navigation?.candidates[0].chunkByteStart).toBeUndefined()
  })
})

describe('retrieveBrainContext', () => {
  it('ne contacte pas le Brain quand le workspace est fail-closed', async () => {
    const fetchFn = vi.fn()
    const res = await retrieveBrainContext('secret', {
      env: { AMITEL_BRAIN_TOKEN: TEST_TOKEN } as NodeJS.ProcessEnv,
      fetchFn: fetchFn as unknown as typeof fetch,
      corpus: []
    })
    expect(res).toEqual({ context: '', status: 'empty' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('transporte le corpus autorisé au serveur et le sépare dans le cache', async () => {
    const bodies: unknown[] = []
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return { ok: true, json: async () => signedPayload({ context: '[BRAIN] savoir' }) }
    }) as unknown as typeof fetch
    const env = { AMITEL_BRAIN_TOKEN: TEST_TOKEN } as NodeJS.ProcessEnv

    await retrieveBrainContext('question', { env, fetchFn, corpus: ['autowin-os'] })
    await retrieveBrainContext('question', { env, fetchFn, corpus: ['rig-'] })

    expect(bodies).toEqual([
      { query: 'question', corpus: ['autowin-os'] },
      { query: 'question', corpus: ['rig-'] }
    ])
  })

  it('rejette une reponse forgee meme si son contexte semble exploitable', async () => {
    const res = await retrieveBrainContext('autowin', {
      env: { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv,
      fetchFn: okFetch({
        service: 'amitel-brain',
        protocol: 1,
        context: '[BRAIN] contenu forge',
        signature: '0'.repeat(64)
      })
    })
    expect(res).toMatchObject({ context: '', status: 'invalid' })
  })

  it.each([1, 2])('rejette fail-soft un contexte signé surdimensionné en v%s', async (protocol) => {
    const context = 'x'.repeat(3_001)
    const payload =
      protocol === 2
        ? signedPayload({ context })
        : {
            service: 'amitel-brain',
            protocol: 1,
            context,
            signature: createHmac('sha256', TEST_TOKEN)
              .update(`amitel-brain\n1\n${context}`, 'utf8')
              .digest('hex')
          }
    const res = await retrieveBrainContext(`oversize-${protocol}`, {
      env: { AMITEL_BRAIN_TOKEN: TEST_TOKEN } as NodeJS.ProcessEnv,
      fetchFn: okFetch(payload)
    })

    expect(res).toEqual({ context: '', status: 'invalid' })
  })

  it('renvoie le contexte du serveur quand il répond', async () => {
    const res = await retrieveBrainContext('autowin', {
      env: { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv,
      fetchFn: okFetch({ context: '[BRAIN] note pertinente' })
    })
    expect(res.context).toBe('[BRAIN] note pertinente')
    expect(res.status).toBe('found')
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
    const res = await retrieveBrainContext('q', {
      env: {} as NodeJS.ProcessEnv,
      fetchFn: okFetch({ context: 'x' })
    })
    expect(res).toMatchObject({ context: '', status: 'unavailable' })
  })
  it('dégrade à vide si le fetch throw (serveur down)', async () => {
    const boom = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const res = await retrieveBrainContext('q', {
      env: { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv,
      fetchFn: boom
    })
    expect(res).toMatchObject({ context: '', status: 'unavailable' })
  })
  it('distingue une réponse valide vide d’un service indisponible', async () => {
    const res = await retrieveBrainContext('q', {
      env: { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv,
      fetchFn: okFetch({ context: '' })
    })
    expect(res).toMatchObject({ context: '', status: 'empty' })
  })
  it('brainServiceToken lit AMITEL_BRAIN_TOKEN en priorité', () => {
    expect(brainServiceToken({ AMITEL_BRAIN_TOKEN: 'tok' } as NodeJS.ProcessEnv)).toBe('tok')
  })
})

/**
 * Mesuré sur un journal réel : 15 appels pour 4 requêtes distinctes sur une seule conversation, 24
 * appels redondants sur 51 au total. Une question déjà posée au Brain, corpus inchangé, ne peut rien
 * apprendre de neuf — elle coûte juste ~1 500 caractères réinjectés et ~500 ms d'attente.
 */
describe('mémoire courte — une même question ne repart pas sur le réseau', () => {
  const env = { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv

  function countingFetch(): { fetchFn: typeof fetch; appels: () => number } {
    let appels = 0
    const fetchFn = (async () => {
      appels += 1
      return { ok: true, json: async () => signedPayload({ context: '[BRAIN] savoir' }) }
    }) as unknown as typeof fetch
    return { fetchFn, appels: () => appels }
  }

  it('la même requête n’interroge le serveur qu’UNE fois', async () => {
    clearBrainRetrievalCache()
    const { fetchFn, appels } = countingFetch()
    const premier = await retrieveBrainContext('même question', { env, fetchFn })
    const second = await retrieveBrainContext('même question', { env, fetchFn })

    expect(appels()).toBe(1)
    expect(second.context).toBe(premier.context) // et le résultat servi est identique
  })

  it('une requête DIFFÉRENTE repart bien sur le réseau', async () => {
    clearBrainRetrievalCache()
    const { fetchFn, appels } = countingFetch()
    await retrieveBrainContext('question A', { env, fetchFn })
    await retrieveBrainContext('question B', { env, fetchFn })
    expect(appels()).toBe(2)
  })

  it('passé le délai, on réinterroge — le corpus est vivant, pas figé', async () => {
    clearBrainRetrievalCache()
    const { fetchFn, appels } = countingFetch()
    let horloge = 1_000_000
    await retrieveBrainContext('q', { env, fetchFn, now: () => horloge })
    horloge += 5 * 60 * 1000 + 1
    await retrieveBrainContext('q', { env, fetchFn, now: () => horloge })
    expect(appels()).toBe(2)
  })

  it('un serveur indisponible n’est PAS mémorisé — sinon un vide se figerait', async () => {
    clearBrainRetrievalCache()
    let appels = 0
    let enPanne = true
    const fetchFn = (async () => {
      appels += 1
      if (enPanne) throw new Error('serveur down')
      return { ok: true, json: async () => signedPayload({ context: '[BRAIN] revenu' }) }
    }) as unknown as typeof fetch

    const panne = await retrieveBrainContext('q', { env, fetchFn })
    expect(panne.status).toBe('unavailable')
    enPanne = false
    const retour = await retrieveBrainContext('q', { env, fetchFn })

    expect(appels).toBe(2) // on a bien retenté
    expect(retour.context).toContain('revenu')
  })
})
