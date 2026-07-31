import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assertWorkflowRequestGraphProof } from './cdp-proof-validation.mjs'

describe('workflow request graph CDP proof', () => {
  const valid = {
    graphTurnId: 'turn-current',
    expectedTurnId: 'turn-current',
    requestRootCount: 1,
    previousTurnLeaks: 0,
    identityCount: 1,
    edgeCount: 2,
    detailVisible: true,
    keyboardNodeId: 'agent-1',
    keyboardSelected: true,
    overflow: false,
    paneVisible: true,
    narrowWidth: true,
    whiteBorder: false,
    wizardVisible: false,
    error: null
  }

  it('rejette un graphe conversation-wide ou sans identité agent/modèle', () => {
    expect(() => assertWorkflowRequestGraphProof({ ...valid, previousTurnLeaks: 1 })).toThrow(
      /tour précédent/i
    )
    expect(() => assertWorkflowRequestGraphProof({ ...valid, requestRootCount: 0 })).toThrow(
      /racine demande/i
    )
    expect(() => assertWorkflowRequestGraphProof({ ...valid, identityCount: 0 })).toThrow(
      /agent.*modèle/i
    )
    expect(() => assertWorkflowRequestGraphProof(valid)).not.toThrow()
  })

  it('valide avant de capturer la preuve visuelle', () => {
    const source = readFileSync(
      new URL('cdp-workflow-execution-graph.mjs', import.meta.url),
      'utf8'
    )
    const validation = 'assertWorkflowRequestGraphProof(state)'
    expect(source).toContain(validation)
    expect(source.indexOf(validation)).toBeLessThan(source.indexOf('Page.captureScreenshot'))
  })
})
