// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(text: string): void {
  act(() => root.render(createElement(Markdown, { text })))
}

describe('Markdown', () => {
  it('renders "- " lines as a real bullet list', () => {
    render('- a\n- b')
    const items = container.querySelectorAll('ul > li')
    expect(items.length).toBe(2)
    expect(items[0].textContent).toBe('a')
    expect(items[1].textContent).toBe('b')
  })

  it('renders [text](http url) as a clickable anchor with safe rel/target', () => {
    render('voir [doc](https://example.com/x)')
    const a = container.querySelector('a')
    expect(a).not.toBeNull()
    expect(a?.getAttribute('href')).toBe('https://example.com/x')
    expect(a?.textContent).toBe('doc')
    expect(a?.getAttribute('rel')).toContain('noopener')
    expect(a?.getAttribute('target')).toBe('_blank')
  })

  it('does NOT create an anchor for a non-http(s) scheme', () => {
    render('[x](javascript:alert(1))')
    expect(container.querySelector('a')).toBeNull()
  })

  it('still renders code and bold inline', () => {
    render('a `b` **c**')
    expect(container.querySelector('code')?.textContent).toBe('b')
    expect(container.querySelector('strong')?.textContent).toBe('c')
  })
})
