// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrainRetrievalBench, type BrainSearchEnvelopeView } from './BrainRetrievalBench'

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
    note: 'savoir trouvé — passages retenus injectés dans le budget ci-dessous',
    query: 'où vit la promotion ?',
    results: [{ id: 'knowledge/a' }],
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

function mockSearch(result: unknown, reject = false): ReturnType<typeof vi.fn> {
  const searchBrain = reject ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result)
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    searchBrain,
    readNodeFile: vi.fn().mockResolvedValue({ path: 'x', content: 'contenu de la note' })
  }
  return searchBrain
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

async function ask(question = 'où vit la promotion ?'): Promise<void> {
  await act(async () => {
    root.render(<BrainRetrievalBench brainPath="C:/brain" />)
  })
  const input = container.querySelector('input') as HTMLInputElement
  // React n'écoute pas une écriture directe de `.value` : il faut passer par le setter natif, comme le
  // fait déjà GraphView.refresh.test.tsx.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, question)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => container.querySelector('button')?.click())
  await flush()
}

describe('BrainRetrievalBench — tester une question depuis la vue Knowledge', () => {
  it('interroge le Brain et réutilise la carte de navigation existante', async () => {
    const searchBrain = mockSearch(
      envelope({
        navigation: {
          query: 'où vit la promotion ?',
          minDense: 0.35,
          root: 'C:/brain',
          candidates: [
            { rank: 1, path: 'knowledge/a.md', type: 'lesson', denseCos: 0.712, retained: true },
            { rank: 2, path: 'knowledge/b.md', type: 'lesson', denseCos: 0.201, retained: false }
          ]
        }
      })
    )
    await ask()
    expect(searchBrain).toHaveBeenCalledWith('C:/brain', 'où vit la promotion ?')
    // La carte EXISTANTE est bien montée : rang, dense_cos, retenu/écarté.
    expect(container.querySelector('.brain-nav-card')).not.toBeNull()
    expect(container.textContent).toContain('#1')
    expect(container.textContent).toContain('dense 0.712')
    expect(container.textContent).toContain('retenu → injecté')
    expect(container.textContent).toContain('écarté (< 0.35)')
    expect(container.querySelectorAll('.brain-nav-candidates li')).toHaveLength(2)
  })

  it('rend les 4 états de retrieval AVEC leur note, chacun distinct (item 4)', async () => {
    for (const [status, label] of [
      ['found', 'savoir trouvé'],
      ['empty', 'aucun passage retenu'],
      ['invalid', 'réponse écartée'],
      ['unavailable', 'Brain indisponible']
    ] as const) {
      mockSearch(envelope({ status, note: `note propre à ${status}` }))
      await ask()
      const banner = container.querySelector(`[data-retrieval-status="${status}"]`)
      expect(banner, status).not.toBeNull()
      expect(banner?.textContent).toContain(label)
      expect(banner?.textContent).toContain(`note propre à ${status}`)
    }
  })

  it('une PANNE du canal ne devient pas « 0 résultat »', async () => {
    mockSearch(new Error('worker brain arrêté'), true)
    await ask()
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Recherche impossible')
    expect(alert?.textContent).toContain('worker brain arrêté')
    expect(container.querySelector('.brain-budget')).toBeNull()
  })

  it('affiche le budget d’injection et les deux plafonds (item 3)', async () => {
    mockSearch(envelope())
    await ask()
    const budget = container.querySelector('.brain-budget')
    expect(budget?.textContent).toContain('500 car.')
    expect(budget?.textContent).toContain('6 000 car.')
    expect(budget?.textContent).toContain('dans le budget')
    expect(container.querySelectorAll('.brain-budget [data-truncated="yes"]')).toHaveLength(0)
  })

  it('dit COMBIEN de savoir a été coupé au plafond', async () => {
    mockSearch(
      envelope({
        budget: {
          ...envelope().budget,
          knowledgeAvailableChars: 9_500,
          knowledgeChars: 6_000,
          knowledgeTruncated: true,
          knowledgeDroppedChars: 3_500
        }
      })
    )
    await ask()
    const truncated = container.querySelector('.brain-budget [data-truncated="yes"]')
    expect(truncated?.textContent).toContain('3 500 car. coupés sur 9 500')
  })

  it('dit que la QUESTION a été tronquée à 500 caractères', async () => {
    mockSearch(
      envelope({
        budget: {
          ...envelope().budget,
          questionSubmittedChars: 720,
          questionChars: 500,
          questionTruncated: true
        }
      })
    )
    await ask('a'.repeat(720))
    expect(container.textContent).toContain('220 car. coupés sur 720')
    expect(container.querySelector('.brain-bench__cut')?.textContent).toContain(
      'la fin n’a pas été cherchée'
    )
  })

  it('sans navigation, la carte le dit au lieu d’un vide muet', async () => {
    mockSearch(envelope({ status: 'unavailable', navigation: undefined }))
    await ask()
    expect(container.textContent).toContain('navigation non exposée')
  })

  it('une question vide ne déclenche aucun appel', async () => {
    const searchBrain = mockSearch(envelope())
    await act(async () => {
      root.render(<BrainRetrievalBench brainPath="C:/brain" />)
    })
    await act(async () => container.querySelector('button')?.click())
    await flush()
    expect(searchBrain).not.toHaveBeenCalled()
    expect(container.querySelector('button')?.hasAttribute('disabled')).toBe(true)
  })

  it('rappelle que la recherche locale reste rendue même Brain éteint', async () => {
    mockSearch(envelope({ status: 'unavailable', results: [{ id: 'a' }, { id: 'b' }] }))
    await ask()
    expect(container.querySelector('.brain-bench__local')?.textContent).toContain('2 fiches')
  })
})
