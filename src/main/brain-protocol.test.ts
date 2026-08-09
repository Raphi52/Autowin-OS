import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_BRAIN_CONTEXT_CHARS,
  MAX_SIGNED_BRAIN_RESPONSE_BYTES,
  readSignedBrainPayload,
  verifySignedBrainPayload,
  type SignedBrainPayload
} from './brain-protocol'

const TOKEN = 'protocol-v2-test-token'.repeat(2)

function signedV2(
  context: string,
  navigation: unknown,
  corpus?: readonly string[],
  structuredContext?: unknown
): SignedBrainPayload {
  const authenticated = JSON.stringify({
    context,
    navigation,
    ...(corpus ? { corpus } : {}),
    ...(structuredContext ? { structuredContext } : {})
  })
  return {
    service: 'amitel-brain',
    protocol: 2,
    authenticated,
    signature: createHmac('sha256', TOKEN)
      .update(`amitel-brain\n2\n${authenticated}`, 'utf8')
      .digest('hex')
  }
}

describe('protocole Brain v2', () => {
  const navigation = {
    query: 'architecture',
    minDense: 0.2,
    root: '\\\\ged2\\rig\\Projets IA\\Amitel Brain',
    candidates: [
      {
        rank: 1,
        path: 'knowledge/decision.md',
        type: 'decision',
        denseCos: 0.7,
        denseScore: 0.6,
        lexicalScore: 0.5,
        graphScore: 0.4,
        fusedScore: 0.3,
        retained: true,
        relations: [{ type: 'related', target: 'knowledge/source.md' }]
      }
    ]
  }

  it('rend contexte et navigation seulement après vérification de l’enveloppe complète', () => {
    expect(
      verifySignedBrainPayload(signedV2('contexte fiable', navigation, ['knowledge/domain/autowin-os-']), TOKEN)
    ).toEqual({
      context: 'contexte fiable',
      navigation,
      corpus: ['knowledge/domain/autowin-os-']
    })
  })

  it('rejette une attestation de corpus malformée même correctement signée', () => {
    for (const malformed of ['ok', '', '*', 'c:/mistyped/knowledge/', '../knowledge/', 'knowledge/../']) {
      expect(() =>
        verifySignedBrainPayload(signedV2('contexte', null, [malformed]), TOKEN)
      ).toThrow('corpus')
    }
  })

  it('compte la borne de contexte en points de code comme le serveur Python', () => {
    expect(verifySignedBrainPayload(signedV2('😀'.repeat(3000), null), TOKEN).context).toHaveLength(6000)
    expect(() => verifySignedBrainPayload(signedV2('😀'.repeat(3001), null), TOKEN)).toThrow('volumineux')
  })

  it('rejette des frontières signées qui ne reconstruisent pas exactement le contexte signé', () => {
    expect(() =>
      verifySignedBrainPayload(
        signedV2('CONTEXTE_A', null, ['knowledge/domain/autowin-os-'], {
          preamble: '',
          sources: [{ path: 'knowledge/domain/autowin-os-note.md', content: 'CONTEXTE_B' }]
        }),
        TOKEN
      )
    ).toThrow('frontières')
  })

  it.each([
    ['root', (value: typeof navigation) => ({ ...value, root: 'C:/attacker-vault' })],
    [
      'score',
      (value: typeof navigation) => ({
        ...value,
        candidates: [{ ...value.candidates[0], fusedScore: 999 }]
      })
    ],
    [
      'relation',
      (value: typeof navigation) => ({
        ...value,
        candidates: [
          {
            ...value.candidates[0],
            relations: [{ type: 'supersedes', target: 'knowledge/forged.md' }]
          }
        ]
      })
    ]
  ])('rejette une mutation de %s sans nouvelle signature', (_field, mutate) => {
    const envelope = signedV2('contexte fiable', navigation)
    envelope.authenticated = JSON.stringify({
      context: 'contexte fiable',
      navigation: mutate(navigation)
    })
    expect(() => verifySignedBrainPayload(envelope, TOKEN)).toThrow('Signature')
  })

  it('accepte le contexte v1 mais écarte sa navigation non authentifiée', () => {
    const context = 'contexte historique'
    const legacy: SignedBrainPayload = {
      service: 'amitel-brain',
      protocol: 1,
      context,
      navigation,
      signature: createHmac('sha256', TOKEN)
        .update(`amitel-brain\n1\n${context}`, 'utf8')
        .digest('hex')
    }
    expect(verifySignedBrainPayload(legacy, TOKEN)).toEqual({ context })
  })

  it.each(['v1', 'v2'] as const)(
    'accepte exactement la borne de contexte et rejette +1 en %s',
    (version) => {
      const payload = (context: string): SignedBrainPayload => {
        if (version === 'v2') return signedV2(context, null)
        return {
          service: 'amitel-brain',
          protocol: 1,
          context,
          signature: createHmac('sha256', TOKEN)
            .update(`amitel-brain\n1\n${context}`, 'utf8')
            .digest('hex')
        }
      }

      expect(
        verifySignedBrainPayload(payload('x'.repeat(MAX_BRAIN_CONTEXT_CHARS)), TOKEN).context
      ).toHaveLength(MAX_BRAIN_CONTEXT_CHARS)
      expect(() =>
        verifySignedBrainPayload(payload('x'.repeat(MAX_BRAIN_CONTEXT_CHARS + 1)), TOKEN)
      ).toThrow('Contexte Amitel Brain trop volumineux')
    }
  )

  it('refuse un corps HTTP surdimensionné avant de le lire', async () => {
    const text = vi.fn()
    await expect(
      readSignedBrainPayload({
        headers: new Headers({ 'content-length': String(4 * 1024 * 1024) }),
        text
      })
    ).rejects.toThrow('Réponse Amitel Brain trop volumineuse')
    expect(text).not.toHaveBeenCalled()
  })

  it('interrompt aussi un flux HTTP sans Content-Length dès que la borne est franchie', async () => {
    const cancel = vi.fn()
    const text = vi.fn()
    const read = vi.fn().mockResolvedValueOnce({
      done: false,
      value: new Uint8Array(MAX_SIGNED_BRAIN_RESPONSE_BYTES + 1)
    })

    await expect(
      readSignedBrainPayload({
        body: { getReader: () => ({ read, cancel }) },
        text
      })
    ).rejects.toThrow('Réponse Amitel Brain trop volumineuse')
    expect(cancel).toHaveBeenCalledOnce()
    expect(text).not.toHaveBeenCalled()
  })
})
