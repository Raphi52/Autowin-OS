import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const racine = resolve(__dirname, '..', '..')
const demande = resolve(racine, 'skills/scout/ORIENTER-UN-SCOUT.md')
const skill = resolve(racine, 'skills/scout/SKILL.md')

describe('demande d orientation d un scout', () => {
  it('existe', () => {
    expect(existsSync(demande)).toBe(true)
  })

  it('ne laisse aucun trou a remplir', () => {
    const t = readFileSync(demande, 'utf8')
    expect(t).not.toMatch(/<[^>\n]*a nommer[^>\n]*>|<module|TODO|\bXXX\b/i)
  })

  it('active des leviers reellement presents dans SKILL.md', () => {
    const t = readFileSync(demande, 'utf8').toLowerCase()
    const s = readFileSync(skill, 'utf8').toLowerCase()
    // levier 1 : bascule du quota de pistes ambitieuses
    expect(t).toContain('fresh vision')
    expect(s).toContain('"fresh vision" request → tilt 🆕 (≥50%)'.toLowerCase())
    // levier 2 : elargissement quand la moisson est tiede
    expect(t).toMatch(/refais un tour|elargis|élargis/)
    expect(s).toContain('widen if the harvest is tepid')
    // levier 3 : lentille prior-art datee 30-90 jours
    expect(t).toMatch(/30[  ]?(a|à|-)[  ]?90 jours/)
    expect(s).toContain('last 30-90 days')
    // levier 4 : plafond des pistes deduites
    expect(t).toMatch(/file:line|fichier:ligne/)
    expect(s).toContain('capped at 50')
    // levier 5 : la ligne finale lue par la machine
    expect(t).toContain('CIBLE:'.toLowerCase())
    expect(s).toContain('exactly one `cible:` line')
  })
})
