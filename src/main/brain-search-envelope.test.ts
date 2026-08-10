import { describe, expect, it } from 'vitest'
import {
  BRAIN_RETRIEVAL_NOTES,
  buildBrainSearchEnvelope,
  type BrainSearchLocalResult
} from './brain-search-envelope'
import { BRAIN_QUERY_MAX_CHARS, BRAIN_RESULT_CAP } from './brain-query-command'
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
    expect(envelope.budget.knowledgeDroppedChars).toBe(1_000)
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
