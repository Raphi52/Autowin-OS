import { describe, expect, it, vi } from 'vitest'
import { createDecipheriv, createHash, createHmac } from 'node:crypto'
import { retrieveBrainContext, brainServiceToken } from './brain-retrieval'

const TEST_TOKEN = 'x'.repeat(40)

const signedPayload = (body: Record<string, unknown>): Record<string, unknown> => {
  if ('signature' in body) return body
  const context = typeof body.context === 'string' ? body.context : ''
  const authenticated = JSON.stringify({
    context,
    navigation: body.navigation ?? null,
    ...('corpus' in body ? { corpus: body.corpus } : {}),
    ...('structuredContext' in body ? { structuredContext: body.structuredContext } : {}),
    ...('request' in body ? { request: body.request } : {})
  })
  return {
    service: 'amitel-brain',
    protocol: 2,
    authenticated,
    signature: createHmac('sha256', TEST_TOKEN)
      .update(`amitel-brain\n2\n${authenticated}`, 'utf8')
      .digest('hex')
  }
}

const textResponse = (body: unknown, ok = true): { ok: boolean; text: () => Promise<string> } => ({
  ok,
  text: async () => JSON.stringify(body)
})

const challengeResponse = (
  url: unknown
): { ok: boolean; text: () => Promise<string> } | undefined => {
  const parsed = new URL(String(url))
  if (parsed.pathname !== '/challenge') return undefined
  const nonce = parsed.searchParams.get('nonce') ?? ''
  if (!/^[0-9a-f]{24}$/.test(nonce)) {
    return textResponse({ error: 'invalid challenge' }, false)
  }
  return textResponse(signedPayload({ context: `challenge:${nonce}` }))
}

const withChallenge = (
  queryFetch: (url: unknown, init?: RequestInit) => Promise<unknown>
): typeof fetch =>
  (async (url: unknown, init?: RequestInit) =>
    challengeResponse(url) ?? queryFetch(url, init)) as unknown as typeof fetch

const openRequest = (body: unknown): Record<string, unknown> => {
  const envelope = JSON.parse(String(body)) as { nonce: string; ciphertext: string }
  const encrypted = Buffer.from(envelope.ciphertext, 'base64')
  const key = createHash('sha256').update(TEST_TOKEN, 'utf8').digest()
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'hex'))
  decipher.setAAD(Buffer.from('amitel-brain/request-v1', 'utf8'))
  decipher.setAuthTag(encrypted.subarray(-16))
  return JSON.parse(
    Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8')
  ) as Record<string, unknown>
}

const boundSignedPayload = (
  body: Record<string, unknown>,
  requestBody: unknown
): Record<string, unknown> => {
  const request = openRequest(requestBody)
  return signedPayload({
    ...body,
    request: { query: request.query, trace_id: request.trace_id }
  })
}

const okFetch = (body: Record<string, unknown>): typeof fetch =>
  withChallenge(async (_url, init) => textResponse(boundSignedPayload(body, init?.body)))

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
  it.each([' ', '\n\t', '\r\n'])(
    'classe un contexte signé sans caractère utile comme empty (%j)',
    async (context) => {
      const result = await retrieveBrainContext('question', {
        env: { AMITEL_BRAIN_TOKEN: TEST_TOKEN } as NodeJS.ProcessEnv,
        fetchFn: okFetch({ context })
      })
      expect(result).toMatchObject({ context: '', status: 'empty' })
    }
  )

  it('rejette une navigation retenue quand le contexte signé ne contient aucun savoir', async () => {
    const result = await retrieveBrainContext('question', {
      env: { AMITEL_BRAIN_TOKEN: TEST_TOKEN } as NodeJS.ProcessEnv,
      fetchFn: okFetch({
        context: '\n\t',
        navigation: {
          query: 'question',
          minDense: 0.25,
          candidates: [
            {
              rank: 1,
              path: 'knowledge/a.md',
              type: 'domain',
              denseCos: 0.9,
              retained: true
            }
          ]
        }
      })
    })
    expect(result).toEqual({ context: '', status: 'invalid' })
  })

  it('rejette une navigation signée pour une autre question Unicode', async () => {
    const result = await retrieveBrainContext('Où vit 😀 A ?', {
      env: { AMITEL_BRAIN_TOKEN: TEST_TOKEN } as NodeJS.ProcessEnv,
      fetchFn: okFetch({
        context: '[BRAIN] réponse B',
        navigation: {
          query: 'Où vit 😀 B ?',
          minDense: 0.25,
          candidates: []
        }
      })
    })
    expect(result).toEqual({ context: '', status: 'invalid' })
  })

  it('rejette un contexte sans navigation ni liaison signée à la requête', async () => {
    const result = await retrieveBrainContext('QUESTION_A', {
      env: { AMITEL_BRAIN_TOKEN: TEST_TOKEN } as NodeJS.ProcessEnv,
      fetchFn: withChallenge(async () =>
        textResponse(signedPayload({ context: '[BRAIN] REPONSE_DE_B' }))
      )
    })
    expect(result).toEqual({ context: '', status: 'invalid' })
  })

  it("rejette le rejeu signé d'une ancienne exécution de la même question", async () => {
    const result = await retrieveBrainContext('QUESTION_A', {
      env: { AMITEL_BRAIN_TOKEN: TEST_TOKEN } as NodeJS.ProcessEnv,
      traceId: () => 'trace-courante',
      fetchFn: withChallenge(async () =>
        textResponse(
          signedPayload({
            context: '[BRAIN] ANCIENNE_REPONSE',
            request: { query: 'QUESTION_A', trace_id: 'trace-ancienne' }
          })
        )
      )
    })
    expect(result).toEqual({ context: '', status: 'invalid' })
  })

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

  it('transporte chaque corpus autorisé indépendamment au serveur', async () => {
    const bodies: unknown[] = []
    const fetchFn = withChallenge(async (_url: unknown, init?: RequestInit) => {
      bodies.push(openRequest(init?.body))
      return textResponse(boundSignedPayload({ context: '[BRAIN] savoir' }, init?.body))
    })
    const env = { AMITEL_BRAIN_TOKEN: TEST_TOKEN } as NodeJS.ProcessEnv

    await retrieveBrainContext('question', {
      env,
      fetchFn,
      corpus: ['autowin-os'],
      traceId: () => 'trace-a'
    })
    await retrieveBrainContext('question', {
      env,
      fetchFn,
      corpus: ['rig-'],
      traceId: () => 'trace-b'
    })

    expect(bodies).toEqual([
      { query: 'question', harness: 'autowin-os', trace_id: 'trace-a', corpus: ['autowin-os'] },
      { query: 'question', harness: 'autowin-os', trace_id: 'trace-b', corpus: ['rig-'] }
    ])
  })

  it('refuse un contexte non lié cryptographiquement au corpus demandé', async () => {
    const env = { AMITEL_BRAIN_TOKEN: TEST_TOKEN } as NodeJS.ProcessEnv
    const missing = await retrieveBrainContext('sans-attestation', {
      env,
      corpus: ['knowledge/domain/autowin-os-'],
      fetchFn: okFetch({ context: 'SECRET_RIG' })
    })
    const wrong = await retrieveBrainContext('mauvaise-attestation', {
      env,
      corpus: ['knowledge/domain/autowin-os-'],
      fetchFn: okFetch({ context: 'SECRET_RIG', corpus: ['knowledge/domain/rig-'] })
    })
    const exact = await retrieveBrainContext('bonne-attestation', {
      env,
      corpus: ['knowledge/domain/autowin-os-'],
      fetchFn: okFetch({ context: 'AUTOWIN_OK', corpus: ['knowledge/domain/autowin-os-'] })
    })

    expect(missing).toEqual({ context: '', status: 'invalid' })
    expect(wrong).toEqual({ context: '', status: 'invalid' })
    expect(exact).toMatchObject({
      context: 'AUTOWIN_OK',
      status: 'found',
      corpus: ['knowledge/domain/autowin-os-']
    })
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

  it('ne divulgue ni token ni requête à un faux listener loopback', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchFn = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return challengeResponse(url) ?? { ok: false }
    }) as unknown as typeof fetch
    const result = await retrieveBrainContext('PROMPT_ULTRA_SECRET', {
      env: { AMITEL_BRAIN_TOKEN: TEST_TOKEN } as NodeJS.ProcessEnv,
      fetchFn
    })
    expect(result.status).toBe('unavailable')
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toContain('/challenge')
    expect(calls[0].init?.headers).toBeUndefined()
    expect(calls[0].init?.body).toBeUndefined()
    expect(calls[1].url).toContain('/query-secure')
    expect(calls[1].init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.stringify(calls)).not.toContain('PROMPT_ULTRA_SECRET')
    expect(JSON.stringify(calls)).not.toContain(TEST_TOKEN)
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

describe('fraîcheur — aucune publication n’est masquée par le client', () => {
  const env = { AMITEL_BRAIN_TOKEN: 'x'.repeat(40) } as NodeJS.ProcessEnv

  function countingFetch(): { fetchFn: typeof fetch; appels: () => number } {
    let appels = 0
    const fetchFn = withChallenge(async (_url, init) => {
      appels += 1
      return textResponse(boundSignedPayload({ context: '[BRAIN] savoir' }, init?.body))
    })
    return { fetchFn, appels: () => appels }
  }

  it('la même requête interroge le service à chaque fois', async () => {
    const { fetchFn, appels } = countingFetch()
    const premier = await retrieveBrainContext('même question', { env, fetchFn })
    const second = await retrieveBrainContext('même question', { env, fetchFn })

    expect(appels()).toBe(2)
    expect(second.context).toBe(premier.context) // et le résultat servi est identique
  })

  it('ne masque pas une nouvelle génération pour une requête identique', async () => {
    let generation = 'A'
    let appels = 0
    const fetchFn = withChallenge(async (_url, init) => {
      appels += 1
      return textResponse(
        boundSignedPayload({ context: `[BRAIN] génération ${generation}` }, init?.body)
      )
    }) as unknown as typeof fetch

    const premier = await retrieveBrainContext('même question', { env, fetchFn })
    generation = 'B'
    const second = await retrieveBrainContext('même question', { env, fetchFn })

    expect(appels).toBe(2)
    expect(premier.context).toContain('génération A')
    expect(second.context).toContain('génération B')
  })

  it('une requête DIFFÉRENTE repart bien sur le réseau', async () => {
    const { fetchFn, appels } = countingFetch()
    await retrieveBrainContext('question A', { env, fetchFn })
    await retrieveBrainContext('question B', { env, fetchFn })
    expect(appels()).toBe(2)
  })

  it('un serveur indisponible n’est PAS mémorisé — sinon un vide se figerait', async () => {
    let appels = 0
    let enPanne = true
    const fetchFn = withChallenge(async (_url, init) => {
      appels += 1
      if (enPanne) throw new Error('serveur down')
      return textResponse(boundSignedPayload({ context: '[BRAIN] revenu' }, init?.body))
    }) as unknown as typeof fetch

    const panne = await retrieveBrainContext('q', { env, fetchFn })
    expect(panne.status).toBe('unavailable')
    enPanne = false
    const retour = await retrieveBrainContext('q', { env, fetchFn })

    expect(appels).toBe(2) // on a bien retenté
    expect(retour.context).toContain('revenu')
  })
})
