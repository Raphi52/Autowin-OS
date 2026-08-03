// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SandboxedHtmlPreview, buildSandboxedHtmlDocument } from './SandboxedHtmlPreview'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('SandboxedHtmlPreview', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = (): void => {
    act(() =>
      root.render(
        <SandboxedHtmlPreview
          source={'<!doctype html><button onclick="this.textContent=\'ok\'">Go</button>'}
        />
      )
    )
  }

  it('injects a deny-by-default CSP and keeps a unique opaque origin', () => {
    render()
    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('sandbox')).toBe('')
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame?.getAttribute('src')).toMatch(/^data:text\/html/)
    const secured = buildSandboxedHtmlDocument('<button>Démo</button>')
    expect(secured).toContain("default-src 'none'")
    expect(secured).toContain("connect-src 'none'")
    expect(secured).toContain("form-action 'none'")
    expect(secured).toContain("script-src 'none'")
  })

  it('switches to inert source, reloads the frame and opens an escapable dialog', () => {
    render()
    const firstFrame = container.querySelector('iframe')

    act(() => container.querySelector<HTMLButtonElement>('[data-action="html-source"]')?.click())
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('<!doctype html>')

    act(() => container.querySelector<HTMLButtonElement>('[data-action="html-preview"]')?.click())
    act(() => container.querySelector<HTMLButtonElement>('[data-action="html-reload"]')?.click())
    expect(container.querySelector('iframe')).not.toBe(firstFrame)

    act(() => container.querySelector<HTMLButtonElement>('[data-action="html-expand"]')?.click())
    expect(
      document.body.querySelector('[role="dialog"][aria-label="Rendu HTML agrandi"]')
    ).not.toBeNull()
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(
      document.body.querySelector('[role="dialog"][aria-label="Rendu HTML agrandi"]')
    ).toBeNull()
  })
})

describe('buildSandboxedHtmlDocument', () => {
  it('places the restrictive policy before any untrusted markup', () => {
    const document = buildSandboxedHtmlDocument(
      '<html><head><title>x</title></head><body>x</body></html>'
    )
    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(
      document.indexOf('<title>x</title>')
    )
  })

  it('cannot be fooled by a fake head inside a comment', () => {
    const hostile = '<!-- <head> --><img src="https://example.invalid/leak">'
    const document = buildSandboxedHtmlDocument(hostile)
    const parsed = new DOMParser().parseFromString(document, 'text/html')

    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf(hostile))
    expect(parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull()
  })

  it('neutralizes automatic and clicked navigations while preserving local anchors', () => {
    const document = buildSandboxedHtmlDocument(
      '<meta http-equiv="refresh" content="0;url=https://example.invalid/meta">' +
        '<a id="remote" href="https://example.invalid/link">Remote</a>' +
        '<a id="local" href="#details">Local</a><div id="details">Détail</div>'
    )
    const parsed = new DOMParser().parseFromString(document, 'text/html')

    expect(parsed.querySelector('meta[http-equiv="refresh"]')).toBeNull()
    expect(parsed.querySelector('#remote')?.hasAttribute('href')).toBe(false)
    expect(parsed.querySelector('#local')?.getAttribute('href')).toBe('#details')
  })
})
