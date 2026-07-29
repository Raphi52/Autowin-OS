import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')

describe('confinement du Markdown dans les bulles', () => {
  it('autorise les longues chaînes inline à se couper sans élargir les conteneurs flex', () => {
    expect(css).toMatch(/\.msg-body\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%/s)
    expect(css).toMatch(/\.msg-turn\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%/s)
    expect(css).toMatch(/\.md code\s*\{[^}]*overflow-wrap:\s*anywhere;/s)
    expect(css).toMatch(/\.md\s*\{[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;/s)
  })

  it('style les tableaux GFM (entête, bordures, zébrage) sans déborder de la bulle', () => {
    expect(css).toMatch(/\.md-table-wrap\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/s)
    expect(css).toMatch(/\.md-table\s*\{[^}]*border-collapse:\s*collapse;/s)
    expect(css).toMatch(/\.md-table th,\s*\.md-table td\s*\{[^}]*border-bottom:/s)
    expect(css).toMatch(/\.md-table tbody tr:nth-child\(even\) td\s*\{/)
    for (const level of ['good', 'warn', 'bad']) {
      expect(css).toMatch(new RegExp(`\\.md-badge-${level}\\s*\\{[^}]*color:`, 's'))
    }
  })
})
