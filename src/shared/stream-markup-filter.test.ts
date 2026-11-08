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

  it('never exposes an unclosed model question, even when its payload is not JSON', () => {
    for (const source of ['Visible <question>sk-test-123', 'Visible <QUESTION>sk-test-123']) {
      for (let split = 1; split < source.length; split += 1) {
        const output = visible([source.slice(0, split), source.slice(split)])
        expect(output).toBe('Visible ')
        expect(output).not.toContain('sk-test-123')
      }
    }
  })

  it('laisse visible une balise de question citée dans du code, quel que soit le découpage', () => {
    const sources = [
      'Je garde la lecture de la balise `<question>` et la suite reste visible.',
      'Exemple :\n```\n<question>{"text":"Exemple ?"}</question>\n```\nFin du message.',
      'Double : ``<question>`` puis la suite.'
    ]
    for (const source of sources) {
      expect(visible([source])).toBe(source)
      for (let split = 1; split < source.length; split += 1) {
        expect(visible([source.slice(0, split), source.slice(split)])).toBe(source)
      }
    }
  })

  it('masque toujours une vraie question posée après un passage de code refermé', () => {
    const source = 'La balise `<question>` est citée. <question>{"text":"secret"}</question> fin'
    for (let split = 1; split < source.length; split += 1) {
      expect(visible([source.slice(0, split), source.slice(split)])).toBe(
        'La balise `<question>` est citée.  fin'
      )
    }
  })

  it('masque une vraie question posée après un backtick isolé, quel que soit le découpage', () => {
    const sources = [
      'Voici le `souci. <question>{"text":"sk-secret-123"}</question> fin',
      'Voici le `souci. <question>sk-secret-123',
      'Bloc jamais fermé :\n```\n<question>{"text":"sk-secret-123"}</question>'
    ]
    for (const source of sources) {
      for (let split = 1; split < source.length; split += 1) {
        const sortie = visible([source.slice(0, split), source.slice(split)])
        expect(sortie, `découpage ${split}`).not.toContain('sk-secret-123')
        expect(sortie).not.toContain('<question>')
      }
    }
  })

  it('tient compte du texte qui précède le morceau filtré', () => {
    const filtre = new VisibleStreamFilter('Avant\n```\n')
    expect(filtre.push('<question>cité</question>\n```') + filtre.finish()).toBe(
      '<question>cité</question>\n```'
    )
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

  it('hides an orphan command (foreign closing tags) followed by a real one (conv-66)', () => {
    const cmd = '{"name":"orchestrate","args":{"task":"x"}}'
    expect(
      visible([`Je lance.\n<cmd>${cmd}</parameter>\n</invoke>\n<cmd>${cmd}</cmd>\nSuite.`])
    ).toBe('Je lance.\n\nSuite.')
  })
})
