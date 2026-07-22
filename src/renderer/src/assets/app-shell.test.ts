import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('collapsed navigation rail', () => {
  it('renders Autowin OS as one uniform brand string', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(app).toMatch(/<span className="brand-name">\s*Autowin OS\s*<\/span>/s)
    expect(app).not.toContain('<b>OS</b>')
    expect(css).not.toContain('.brand b')
  })

  it('uses the selected Segoe UI Variable face for the Autowin OS brand title', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(css).toMatch(
      /\.brand-name\s*{[^}]*font-family:\s*'Segoe UI Variable Display',\s*'Segoe UI',\s*sans-serif/s
    )
    expect(css).toMatch(/\.brand-name\s*{[^}]*color:\s*#fff/s)
    expect(css).toMatch(
      /\.brand-name\s*{[^}]*text-shadow:\s*0 0 5px rgba\(255, 255, 255, 0\.78\),\s*0 0 10px rgba\(54, 230, 255, 0\.34\)/s
    )
  })

  it('hides labels without hiding the navigation icons', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(css).toContain('.rail.is-collapsed .nav-item > span:not(.space-toy-icon)')
    expect(css).not.toMatch(/\.rail\.is-collapsed \.nav-item > span,?\s*\n/)
  })

  it('keeps the collapsed controls square and reduces the gap before content', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(css).toMatch(
      /\.rail\.is-collapsed\s*{[^}]*width:\s*54px[^}]*padding-inline:\s*9px/s
    )
    expect(css).toMatch(
      /\.rail\.is-collapsed \.nav-item\s*{[^}]*width:\s*36px[^}]*height:\s*36px/s
    )
    expect(css).toMatch(/\.shell:has\(\.rail\.is-collapsed\) \.main\s*{[^}]*padding-left:\s*var\(--s2\)/s)
    expect(css).toMatch(/\.rail\.is-collapsed \.nav\s*{[^}]*overflow-x:\s*hidden/s)
    expect(css).not.toMatch(/(?:^|\n)\.nav\s*{[^}]*overflow-x:\s*hidden/s)
  })

  it('shifts navigation icons three pixels left only when the rail is collapsed', () => {
    const css = readFileSync(new URL('./app-shell.css', import.meta.url), 'utf8')
    expect(css).toMatch(
      /\.rail\.is-collapsed \.space-toy-icon\s*{[^}]*transform:\s*translateX\(-3px\)/s
    )
    expect(css).not.toMatch(/(?:^|\n)\.space-toy-icon\s*{[^}]*translateX\(-3px\)/s)
  })
})
