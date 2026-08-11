// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrainNavigationCard, type BrainTraceView } from './BrainNavigationCard'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function mountTrace(trace: BrainTraceView): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(<BrainNavigationCard trace={trace} />)
  })
}

function renderTrace(trace: BrainTraceView): void {
  act(() => {
    root!.render(<BrainNavigationCard trace={trace} />)
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function scopedTrace(rootPath: string, query: string, timestamp: string): BrainTraceView {
  return {
    timestamp,
    conversationId: 'c1',
    query,
    injectedChars: 10,
    navigation: {
      query,
      minDense: 0.25,
      root: rootPath,
      candidates: [{ rank: 1, path: 'same.md', type: 'domain', denseCos: 0.5, retained: true }]
    }
  }
}

const enc = (s: string): number => new TextEncoder().encode(s).length

describe('BrainNavigationCard — dépli + surlignage du passage retenu', () => {
  it('ne conserve pas le contenu A quand une nouvelle trace B réutilise rang et chemin', async () => {
    const readNodeFile = vi.fn(async (path: string) => ({
      path,
      content: path.startsWith('B/') ? 'CONTENU-B' : 'CONTENU-A'
    }))
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = { readNodeFile }
    mountTrace(scopedTrace('A', 'QUESTION-A', 'trace-a'))
    const detailsA = host!.querySelector('details') as HTMLDetailsElement
    await act(async () => {
      detailsA.open = true
      detailsA.dispatchEvent(new Event('toggle'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(host!.textContent).toContain('CONTENU-A')

    renderTrace(scopedTrace('B', 'QUESTION-B', 'trace-b'))
    expect(host!.textContent).toContain('QUESTION-B')
    expect(host!.textContent).not.toContain('CONTENU-A')
    const detailsB = host!.querySelector('details') as HTMLDetailsElement
    await act(async () => {
      detailsB.open = true
      detailsB.dispatchEvent(new Event('toggle'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(readNodeFile).toHaveBeenLastCalledWith('B/same.md', 'B')
    expect(host!.textContent).toContain('CONTENU-B')
    expect(host!.textContent).not.toContain('CONTENU-A')
  })

  it('ignore une lecture A terminée après le montage de la trace B', async () => {
    const pendingA = deferred<{ path: string; content: string }>()
    const readNodeFile = vi.fn((path: string) =>
      path.startsWith('A/')
        ? pendingA.promise
        : Promise.resolve({ path, content: 'CONTENU-B-FRAIS' })
    )
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = { readNodeFile }
    mountTrace(scopedTrace('A', 'QUESTION-A', 'trace-a'))
    const detailsA = host!.querySelector('details') as HTMLDetailsElement
    await act(async () => {
      detailsA.open = true
      detailsA.dispatchEvent(new Event('toggle'))
      await Promise.resolve()
    })

    renderTrace(scopedTrace('B', 'QUESTION-B', 'trace-b'))
    const detailsB = host!.querySelector('details') as HTMLDetailsElement
    await act(async () => {
      detailsB.open = true
      detailsB.dispatchEvent(new Event('toggle'))
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      pendingA.resolve({ path: 'A/same.md', content: 'CONTENU-A-RETARDE' })
      await Promise.resolve()
    })
    expect(readNodeFile.mock.calls.map(([path]) => path)).toEqual(['A/same.md', 'B/same.md'])
    expect(host!.textContent).toContain('QUESTION-B')
    expect(host!.textContent).toContain('CONTENU-B-FRAIS')
    expect(host!.textContent).not.toContain('CONTENU-A-RETARDE')
  })

  it('surligne EXACTEMENT la tranche octets, correct malgré les accents (byte≠char)', async () => {
    // Contenu accentué : "é" = 2 octets → byteStart/End ≠ index caractère → teste byteToChar.
    const before = 'préambule éàç '
    const target = 'PASSAGE-RETENU'
    const after = ' fin éòû'
    const content = before + target + after
    const byteStart = enc(before)
    const byteEnd = enc(before + target)
    // sanity : byteStart != char index (à cause des accents)
    expect(byteStart).not.toBe(before.length)

    const readNodeFile = vi.fn(async () => ({ path: 'x', content }))
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = { readNodeFile }

    mountTrace({
      timestamp: '2026-07-23T00:00:00Z',
      conversationId: 'c1',
      query: 'q',
      injectedChars: content.length,
      navigation: {
        query: 'q',
        minDense: 0.25,
        root: '//ged2/rig/Projets IA/Amitel Brain',
        candidates: [
          {
            rank: 1,
            path: 'knowledge/a.md',
            type: 'domain',
            denseCos: 0.5,
            retained: true,
            chunkByteStart: byteStart,
            chunkByteEnd: byteEnd
          }
        ]
      }
    })

    // déplier : ouvrir le <details> et déclencher onToggle
    const details = host!.querySelector('details') as HTMLDetailsElement
    expect(details).toBeTruthy()
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(readNodeFile).toHaveBeenCalledWith(
      '//ged2/rig/Projets IA/Amitel Brain/knowledge/a.md',
      '//ged2/rig/Projets IA/Amitel Brain'
    )
    const mark = host!.querySelector('.brain-nav-highlight')
    expect(mark).toBeTruthy()
    // le passage surligné = EXACTEMENT la tranche cible (pas décalé par les accents)
    expect(mark!.textContent).toBe(target)
  })

  it('sans offsets, affiche la note sans surlignage (dégrade proprement)', async () => {
    const readNodeFile = vi.fn(async () => ({ path: 'x', content: 'contenu simple' }))
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = { readNodeFile }
    mountTrace({
      timestamp: 't',
      conversationId: 'c1',
      query: 'q',
      injectedChars: 10,
      navigation: {
        query: 'q',
        minDense: 0.25,
        root: '//ged2/x',
        candidates: [{ rank: 1, path: 'a.md', type: 'domain', denseCos: 0.5, retained: true }]
      }
    })
    const details = host!.querySelector('details') as HTMLDetailsElement
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(host!.querySelector('.brain-nav-highlight')).toBeNull()
    expect(host!.querySelector('.brain-nav-note')?.textContent).toBe('contenu simple')
  })

  it('trace ANCIENNE (sans root) : affiche un message, pas un dépli vide', async () => {
    const readNodeFile = vi.fn(async () => ({ path: 'x', content: 'x' }))
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = { readNodeFile }
    mountTrace({
      timestamp: 't',
      conversationId: 'c1',
      query: 'q',
      injectedChars: 0,
      // pas de root → cas des vieilles traces pré-offsets
      navigation: {
        query: 'q',
        minDense: 0.25,
        candidates: [
          { rank: 1, path: 'knowledge/a.md', type: 'domain', denseCos: 0.5, retained: true }
        ]
      }
    })
    const details = host!.querySelector('details') as HTMLDetailsElement
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(readNodeFile).not.toHaveBeenCalled()
    const status = host!.querySelector('.brain-nav-note-status')
    expect(status).toBeTruthy()
    expect(status!.textContent).toMatch(/trace ancienne/i)
  })
})
