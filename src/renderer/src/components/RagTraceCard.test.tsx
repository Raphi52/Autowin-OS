import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RagTraceCard } from './RagTraceCard'

describe('RAG observability rendering', () => {
  it('distinguishes calls without RAG from malformed RAG traces', () => {
    const withoutRag = renderToStaticMarkup(
      <RagTraceCard request={{ body: { messages: [{ content: 'Question simple' }] } }} />
    )
    const malformed = renderToStaticMarkup(
      <RagTraceCard
        request={{
          body: { messages: [{ content: 'Question\n\n[AMITEL BRAIN REFERENCE DATA — tronqué]' }] }
        }}
      />
    )

    expect(withoutRag).toContain('data-rag-status="not-injected"')
    expect(withoutRag).toContain('Aucun contexte Brain')
    expect(malformed).toContain('data-rag-status="unparseable"')
    expect(malformed).toContain('format non analysable')
  })
})
