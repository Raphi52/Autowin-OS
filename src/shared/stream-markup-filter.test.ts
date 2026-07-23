import { describe, expect, it } from 'vitest'
import { VisibleStreamFilter } from './stream-markup-filter'

function visible(chunks: string[]): string {
  const filter = new VisibleStreamFilter()
  return chunks.map((chunk) => filter.push(chunk)).join('') + filter.finish()
}

describe('VisibleStreamFilter', () => {
  it('streams ordinary text immediately', () => {
    const filter = new VisibleStreamFilter()
    expect(filter.push('Je ')).toBe('Je ')
    expect(filter.push('réponds.')).toBe('réponds.')
    expect(filter.finish()).toBe('')
  })

  it('never exposes a command split across arbitrary chunk boundaries', () => {
    const source = 'Avant <cmd>{"name":"get_state","args":{"token":"secret"}}</cmd> après.'
    for (let split = 1; split < source.length; split += 1) {
      const output = visible([source.slice(0, split), source.slice(split)])
      expect(output).toBe('Avant  après.')
      expect(output).not.toContain('<cmd>')
      expect(output).not.toContain('secret')
    }
  })

  it('suppresses model questions and partial control prefixes at the end', () => {
    expect(visible(['Visible ', '<question>{"question":"secret"}</question>', ' fin'])).toBe(
      'Visible  fin'
    )
    expect(visible(['Visible <cm'])).toBe('Visible ')
  })

  it('keeps an unclosed command tag mentioned in prose intact', () => {
    const source = 'Pour agir, émets une commande comme <cmd> par exemple, sans la fermer.'
    expect(visible([source])).toBe(source)
    for (let split = 1; split < source.length; split += 1) {
      expect(visible([source.slice(0, split), source.slice(split)])).toBe(source)
    }
  })

  it('keeps a closed control block with invalid JSON as visible text', () => {
    const source = 'Exemple littéral : <cmd>ceci n_est pas du JSON</cmd> voilà.'
    expect(visible([source])).toBe(source)
  })

  it('still suppresses a complete valid command block', () => {
    expect(visible(['Avant <cmd>{"name":"get_state","args":{}}</cmd> après.'])).toBe(
      'Avant  après.'
    )
  })
})
