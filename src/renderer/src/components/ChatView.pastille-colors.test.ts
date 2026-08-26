import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = () => readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')

const colorOf = (state: string): string | undefined => {
  const source = css()
  const block = source.match(
    new RegExp(String.raw`\.conversation-state\.is-${state}\s*\{([^}]*)\}`, 's')
  )?.[1]
  return block?.match(/color:\s*(#[0-9a-fA-F]{3,8})/)?.[1]?.toLowerCase()
}

describe('conversation status dot palette', () => {
  it('gives every conversation state its own colour', () => {
    const states = ['running', 'waiting', 'completed', 'failed', 'interrupted', 'cancelled']
    const colors = states.map((state) => [state, colorOf(state)] as const)

    for (const [state, color] of colors) {
      expect(color, `état "${state}" sans couleur propre`).toBeDefined()
    }
    const unique = new Set(colors.map(([, color]) => color))
    expect(unique.size, `couleurs partagées: ${JSON.stringify(colors)}`).toBe(states.length)
  })

  it('keeps the empty state visually muted rather than coloured like a live one', () => {
    const block = css().match(/\.conversation-state\.is-empty\s*{([^}]*)}/s)?.[1]
    expect(block).toBeDefined()
    expect(block).toMatch(/opacity:\s*0\.[0-9]+/)
  })
})
