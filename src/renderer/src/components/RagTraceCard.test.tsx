import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RagObservabilitySummary, RagTraceCard } from './RagTraceCard'

describe('RAG observability rendering', () => {
  it('keeps an explicit diagnostic visible when no Hermes trace exists', () => {
    const html = renderToStaticMarkup(<RagObservabilitySummary requests={[]} />)

    expect(html).toContain('data-rag-status="unavailable"')
    expect(html).toContain('Aucune trace native disponible')
  })

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

  it('describes the observed RAG state without contradicting an injected trace', () => {
    const injected = renderToStaticMarkup(
      <RagObservabilitySummary
        requests={[
          {
            body: {
              messages: [
                {
                  content:
                    'Question\n\n[AMITEL BRAIN REFERENCE DATA]\n\n### Source 1 - knowledge/test.md\nProvenance: domain | test | codex | 2026-07-20'
                }
              ]
            }
          }
        ]}
      />
    )
    const unavailable = renderToStaticMarkup(<RagObservabilitySummary requests={[]} />)

    expect(injected).toContain('Contexte Brain observé dans la requête native')
    expect(injected).not.toContain('RAG non branché')
    expect(unavailable).toContain('Aucune requête native disponible pour contrôler le RAG')
  })
})
