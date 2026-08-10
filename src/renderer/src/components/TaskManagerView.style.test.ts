import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Task Manager visual contracts', () => {
  it('place l action d une occurrence dans la colonne de contenu sans elargir le panneau', () => {
    const css = readFileSync(new URL('./TaskManagerView.css', import.meta.url), 'utf8')
    const actionRule = css.match(/\.task-manager-occurrence-open\s*{[^}]*}/s)?.[0]
    const statusRule = css.match(/\.task-manager-occurrence > span\s*{[^}]*}/s)?.[0]

    expect(actionRule).toMatch(/grid-column:\s*2/)
    expect(actionRule).toMatch(/grid-row:\s*3/)
    expect(actionRule).toMatch(/min-width:\s*0/)
    expect(statusRule).toMatch(/grid-row:\s*1\s*\/\s*span 3/)
  })
})
