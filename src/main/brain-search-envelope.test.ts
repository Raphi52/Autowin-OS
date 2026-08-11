import { describe, expect, it } from 'vitest'
import {
  BRAIN_RETRIEVAL_NOTES,
  buildBrainSearchEnvelope,
  type BrainSearchLocalResult
} from './brain-search-envelope'
import {
  BRAIN_QUERY_MAX_CHARS,
  BRAIN_RESULT_CAP,
  BRAIN_RESULT_TRUNCATION_MARKER
} from './brain-query-command'
import type { BrainRetrievalResult } from './brain-retrieval'

const local: BrainSearchLocalResult[] = [
  { id: 'knowledge/a', label: 'A', file: 'C:/brain/knowledge/a.md', themes: [], score: 3 }
]

function retrieval(over: Partial<BrainRetrievalResult> = {}): BrainRetrievalResult {
  return { context: '', status: 'found', ...over }
}

describe('buildBrainSearchEnvelope — le statut et le budget cessent d’être jetés', () => {
  it('remonte les 4 statuts de retrieval avec leur note, jamais un tableau vide muet', () => {
    for (const status of ['found', 'empty', 'invalid', 'unavailable'] as const) {
      const envelope = buildBrainSearchEnvelope({
        rawQuery: 'où vit la promotion inbox ?',
        results: local,
        retrieval: retrieval({ status, context: status === 'found' ? 'du savoir' : '' })
      })
      expect(envelope.status).toBe(status)
      expect(envelope.note).toBe(BRAIN_RETRIEVAL_NOTES[status])
      // Une panne ne doit PAS effacer la recherche locale (le bug de GraphView.tsx:306).
      expect(envelope.results).toHaveLength(1)
    }
  })

  it.each([' ', '\n\t', '\r\n'])(
    'annonce empty et zéro savoir pour un contexte found sans caractère utile (%j)',
    (context) => {
      const envelope = buildBrainSearchEnvelope({
        rawQuery: 'question',
        results: local,
        retrieval: retrieval({ status: 'found', context })
      })
      expect(envelope).toMatchObject({
        status: 'empty',
        note: BRAIN_RETRIEVAL_NOTES.empty,
        budget: {
          knowledgeAvailableChars: 0,
          knowledgeChars: 0,
          knowledgeDroppedChars: 0
        }
      })
    }
  )

  it('rejette une navigation retenue contradictoire avec zéro savoir injectable', () => {
    const envelope = buildBrainSearchEnvelope({
      rawQuery: 'question',
      results: local,
      retrieval: retrieval({
        status: 'found',
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

    expect(envelope.status).toBe('invalid')
    expect(envelope.note).toBe(BRAIN_RETRIEVAL_NOTES.invalid)
    expect(envelope.navigation).toBeUndefined()
    expect(envelope.budget.knowledgeChars).toBe(0)
  })

  it('rejette une navigation qui ne correspond pas à la question normalisée', () => {
    const envelope = buildBrainSearchEnvelope({
      rawQuery: '  Où   vit 😀 A ?  ',
      results: local,
      retrieval: retrieval({
        status: 'found',
        context: '[BRAIN] réponse B',
        navigation: {
          query: 'Où vit 😀 B ?',
          minDense: 0.25,
          candidates: []
        }
      })
    })
    expect(envelope.query).toBe('Où vit 😀 A ?')
    expect(envelope.status).toBe('invalid')
    expect(envelope.navigation).toBeUndefined()
    expect(envelope.budget.knowledgeChars).toBe(0)
  })

  it('rend visible la troncature de la QUESTION au plafond de brain-query-command', () => {
    const long = 'a'.repeat(BRAIN_QUERY_MAX_CHARS + 200)
    const envelope = buildBrainSearchEnvelope({
      rawQuery: long,
      results: [],
      retrieval: retrieval()
    })
    expect(envelope.budget.questionMax).toBe(BRAIN_QUERY_MAX_CHARS)
    expect(envelope.budget.questionChars).toBe(BRAIN_QUERY_MAX_CHARS)
    expect(envelope.budget.questionSubmittedChars).toBe(BRAIN_QUERY_MAX_CHARS + 200)
    expect(envelope.budget.questionTruncated).toBe(true)
    expect(envelope.query).toHaveLength(BRAIN_QUERY_MAX_CHARS)
  })

  it('laisse une question courte intacte et non signalée comme tronquée', () => {
    const envelope = buildBrainSearchEnvelope({
      rawQuery: '  promotion   inbox  ',
      results: [],
      retrieval: retrieval()
    })
    expect(envelope.query).toBe('promotion inbox')
    expect(envelope.budget.questionTruncated).toBe(false)
    expect(envelope.budget.questionChars).toBe('promotion inbox'.length)
  })

  it('compte et borne les questions Unicode en caractères, pas en unités UTF-16', () => {
    const rawQuery = `${'😀'.repeat(BRAIN_QUERY_MAX_CHARS)}fin`
    const envelope = buildBrainSearchEnvelope({
      rawQuery,
      results: [],
      retrieval: retrieval()
    })
    expect(envelope.query).toBe('😀'.repeat(BRAIN_QUERY_MAX_CHARS))
    expect(envelope.budget.questionSubmittedChars).toBe(BRAIN_QUERY_MAX_CHARS + 3)
    expect(envelope.budget.questionChars).toBe(BRAIN_QUERY_MAX_CHARS)
    expect(envelope.budget.questionTruncated).toBe(true)
  })

  it('rend visible le plafond du SAVOIR et le nombre de caractères réellement coupés', () => {
    const context = 'x'.repeat(BRAIN_RESULT_CAP + 1_000)
    const envelope = buildBrainSearchEnvelope({
      rawQuery: 'q',
      results: [],
      retrieval: retrieval({ context })
    })
    expect(envelope.budget.knowledgeMax).toBe(BRAIN_RESULT_CAP)
    expect(envelope.budget.knowledgeTruncated).toBe(true)
    expect(envelope.budget.knowledgeChars).toBe(BRAIN_RESULT_CAP)
    expect(envelope.budget.knowledgeDroppedChars).toBe(
      1_000 + [...BRAIN_RESULT_TRUNCATION_MARKER].length
    )
    expect(envelope.budget.knowledgeAvailableChars).toBe(BRAIN_RESULT_CAP + 1_000)
  })

  it('un savoir sous le plafond n’est jamais annoncé tronqué', () => {
    const envelope = buildBrainSearchEnvelope({
      rawQuery: 'q',
      results: [],
      retrieval: retrieval({ context: 'court' })
    })
    expect(envelope.budget.knowledgeTruncated).toBe(false)
    expect(envelope.budget.knowledgeChars).toBe(5)
    expect(envelope.budget.knowledgeDroppedChars).toBe(0)
  })

  it('compte honnêtement les caractères Unicode réellement écartés du savoir', () => {
    const envelope = buildBrainSearchEnvelope({
      rawQuery: 'q',
      results: [],
      retrieval: retrieval({ context: '😀'.repeat(BRAIN_RESULT_CAP + 1) })
    })
    expect(envelope.budget.knowledgeAvailableChars).toBe(BRAIN_RESULT_CAP + 1)
    expect(envelope.budget.knowledgeChars).toBe(BRAIN_RESULT_CAP)
    expect(envelope.budget.knowledgeDroppedChars).toBe(
      1 + [...BRAIN_RESULT_TRUNCATION_MARKER].length
    )
  })

  it('propage la navigation du Brain — c’est elle qui alimente le banc d’essai', () => {
    const envelope = buildBrainSearchEnvelope({
      rawQuery: 'q',
      results: [],
      retrieval: retrieval({
        context: 'ok',
        navigation: {
          query: 'q',
          minDense: 0.35,
          root: 'C:/brain',
          candidates: [
            { rank: 1, path: 'knowledge/a.md', type: 'lesson', denseCos: 0.71, retained: true }
          ]
        }
      })
    })
    expect(envelope.navigation?.candidates[0].denseCos).toBe(0.71)
    expect(envelope.navigation?.minDense).toBe(0.35)
  })

  it('une question vide reste exploitable : statut not-requested, aucun appel annoncé', () => {
    const envelope = buildBrainSearchEnvelope({
      rawQuery: '   ',
      results: local,
      retrieval: undefined
    })
    expect(envelope.status).toBe('not-requested')
    expect(envelope.note).toBe(BRAIN_RETRIEVAL_NOTES['not-requested'])
    expect(envelope.results).toHaveLength(1)
  })
})
