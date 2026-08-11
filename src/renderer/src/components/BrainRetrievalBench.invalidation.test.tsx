// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrainRetrievalBench, type BrainSearchEnvelopeView } from './BrainRetrievalBench'

/**
 * CHANTIER 1 — la régression du banc d'essai : une invalidation (`resetToken`) efface le résultat
 * affiché, mais si la relance (`reloadToken`) n'arrive JAMAIS — c'est le cas quand la réindexation
 * échoue — le banc redevient muet : plus de verdict, plus d'explication, plus de sortie. La question
 * reste tapée à l'écran comme si elle n'avait jamais été posée.
 */

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const flush = (): Promise<void> =>
  act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })

function envelope(over: Partial<BrainSearchEnvelopeView> = {}): BrainSearchEnvelopeView {
  return {
    status: 'found',
    note: 'savoir trouvé',
    query: 'où vit la promotion ?',
    results: [
      {
        id: 'knowledge/a',
        label: 'Promotion humaine',
        file: 'knowledge/a.md',
        themes: ['memory'],
        score: 1
      }
    ],
    budget: {
      questionSubmittedChars: 20,
      questionChars: 20,
      questionMax: 500,
      questionTruncated: false,
      knowledgeAvailableChars: 1_200,
      knowledgeChars: 1_200,
      knowledgeMax: 6_000,
      knowledgeTruncated: false,
      knowledgeDroppedChars: 0
    },
    ...over
  }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function askOnce(searchBrain: ReturnType<typeof vi.fn>): Promise<void> {
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    searchBrain,
    readNodeFile: vi.fn().mockResolvedValue({ path: 'x', content: 'c' })
  }
  await act(async () => {
    root.render(<BrainRetrievalBench brainPath="C:/brain" resetToken={0} reloadToken={0} />)
  })
  const input = container.querySelector('input') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, 'où vit la promotion ?')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () =>
    container.querySelector<HTMLButtonElement>('.brain-bench__ask button')?.click()
  )
  await flush()
}

describe('BrainRetrievalBench — une invalidation sans relance ne laisse plus un banc muet', () => {
  it('dit que le résultat est périmé et offre de relancer la question', async () => {
    const searchBrain = vi
      .fn()
      .mockResolvedValueOnce(envelope({ note: 'ANCIEN' }))
      .mockResolvedValueOnce(envelope({ note: 'FRAIS' }))
    await askOnce(searchBrain)
    expect(container.textContent).toContain('ANCIEN')

    // Invalidation SEULE : le graphe a été rafraîchi, la relance n'est jamais venue.
    await act(async () => {
      root.render(<BrainRetrievalBench brainPath="C:/brain" resetToken={1} reloadToken={0} />)
    })
    await flush()

    expect(container.textContent).not.toContain('ANCIEN')
    const stale = container.querySelector('[data-bench-state="stale"]')
    expect(stale).not.toBeNull()
    expect(stale?.textContent).toContain('Relancer')

    await act(async () =>
      container.querySelector<HTMLButtonElement>('.brain-bench__relaunch')?.click()
    )
    await flush()
    expect(searchBrain).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('FRAIS')
    expect(container.querySelector('[data-bench-state="stale"]')).toBeNull()
  })

  it('une panne du canal reste rattrapable par un réessai ciblé', async () => {
    const searchBrain = vi
      .fn()
      .mockRejectedValueOnce(new Error('worker arrêté'))
      .mockResolvedValueOnce(envelope({ note: 'REVENU' }))
    await askOnce(searchBrain)
    expect(container.querySelector('[data-retrieval-status="failed"]')).not.toBeNull()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('.brain-bench__retry')?.click()
    )
    await flush()
    expect(searchBrain).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('REVENU')
  })
})
