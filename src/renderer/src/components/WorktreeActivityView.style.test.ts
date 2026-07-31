import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./WorktreeActivityView.css', import.meta.url), 'utf8')

describe('WorktreeActivityView A2 responsive', () => {
  it('pilote le layout par la largeur du conteneur', () => {
    expect(css).toMatch(/container-type\s*:\s*inline-size/)
    expect(css).toMatch(/@container\s+worktree-hub\s+\(max-width:\s*380px\)/)
  })

  it('interdit le scroll horizontal et casse les chemins longs', () => {
    expect(css).toMatch(/overflow-x\s*:\s*hidden/)
    expect(css).toMatch(/overflow-wrap\s*:\s*anywhere/)
    expect(css).not.toMatch(/min-width\s*:\s*720px/)
  })

  it('conserve une hiérarchie bureau principal, satellites et boîte entrante', () => {
    expect(css).toMatch(/\.wt-main-office/)
    expect(css).toMatch(/\.wt-agent-office/)
    expect(css).toMatch(/\.wt-inbox/)
  })

  it('dessine un tronc vertical et une branche par bureau sans grosse frise', () => {
    expect(css).toMatch(/\.wt-office-flow::before/)
    expect(css).toMatch(/\.wt-office-branch::before/)
    expect(css).toMatch(/writing-mode\s*:\s*vertical-rl/)
  })
})
