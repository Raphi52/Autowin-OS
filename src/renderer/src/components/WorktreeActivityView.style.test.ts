import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./WorktreeActivityView.css', import.meta.url), 'utf8')

function declarationsFor(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`))?.[1] ?? ''
}

describe('WorktreeActivityView layout', () => {
  it('empile verticalement et fait défiler la frise dans sa hauteur disponible', () => {
    const frieze = declarationsFor(css, '.wt-frieze')

    expect(frieze).toMatch(/\bflex-direction\s*:\s*column\s*;/)
    expect(frieze).toMatch(/\bmax-height\s*:\s*calc\(100%\s*-\s*24px\)\s*;/)
    expect(frieze).toMatch(/\boverflow-y\s*:\s*auto\s*;/)
  })

  it('conserve le débordement horizontal de la frise sur écran étroit', () => {
    const narrowScreen = css.match(/@media\s*\(max-width:\s*760px\)\s*\{([\s\S]+)\}\s*$/)?.[1] ?? ''
    const frieze = declarationsFor(narrowScreen, '.wt-frieze')

    expect(frieze).toMatch(/\boverflow-x\s*:\s*auto\s*;/)
  })

  it('rejette la disposition historique sans empilement ni scroll vertical', () => {
    const historicalFrieze = `
      position: relative;
      display: flex;
      margin: 12px;
    `

    expect(historicalFrieze).not.toMatch(/\bflex-direction\s*:\s*column\s*;/)
    expect(historicalFrieze).not.toMatch(/\boverflow-y\s*:\s*auto\s*;/)
  })
})
