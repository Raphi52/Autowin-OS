import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = () => readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
/**
 * `is-running` a migre dans l'ATOME 5A de theme.css (SOURCE UNIQUE du « ca bosse »), et sa couleur y
 * est portee par `border-top-color` : c'est l'anneau qui est colore, plus un point plein.
 *
 * Ce test lisait ChatView.css SEUL et cherchait `color:`. Il annoncait donc « running sans couleur
 * propre » alors que la couleur existait — ailleurs. Corrige a sa cause : on lit les DEUX sources et
 * les DEUX proprietes. L'exigence ne bouge pas : chaque etat garde une couleur, les six distinctes.
 */
const theme = () => readFileSync(new URL('../assets/theme.css', import.meta.url), 'utf8')

const colorOf = (state: string): string | undefined => {
  const motif = new RegExp(
    String.raw`\.conversation-state\.is-` + state + String.raw`\b[^{]*\{([^}]*)\}`,
    'gs'
  )
  for (const source of [css(), theme()]) {
    for (const bloc of source.matchAll(motif)) {
      const teinte = bloc[1].match(/(?:^|[\s;])(?:border-top-)?color:\s*(#[0-9a-fA-F]{3,8})/)
      if (teinte) return teinte[1].toLowerCase()
    }
  }
  return undefined
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
