// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrainNavigationCard, type BrainTraceView } from './BrainNavigationCard'

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

const enc = (s: string): number => new TextEncoder().encode(s).length

describe('BrainNavigationCard — dépli + surlignage du passage retenu', () => {
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
          { rank: 1, path: 'knowledge/a.md', type: 'domain', denseCos: 0.5, retained: true, chunkByteStart: byteStart, chunkByteEnd: byteEnd }
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

    expect(readNodeFile).toHaveBeenCalledWith('//ged2/rig/Projets IA/Amitel Brain/knowledge/a.md')
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
        candidates: [{ rank: 1, path: 'knowledge/a.md', type: 'domain', denseCos: 0.5, retained: true }]
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
