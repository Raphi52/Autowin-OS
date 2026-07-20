import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Observatory causal details', () => {
  it('renders a selected causal node detail and proves the click in CDP', () => {
    const view = readFileSync(new URL('./ObservatoryView.tsx', import.meta.url), 'utf8')
    const proof = readFileSync(
      new URL('../../../../scripts/cdp-observatory-critical-path.mjs', import.meta.url),
      'utf8'
    )

    expect(view).toContain('observatory-causal-detail')
    expect(view).toContain('selected?.id === node.id')
    expect(proof).toContain("document.querySelector('.observatory-causal-tree")
    expect(proof).toContain('detailVisible')
    expect(proof).toContain('window.api.captureTestPage()')
  })
})
