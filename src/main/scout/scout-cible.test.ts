import { describe, expect, it } from 'vitest'
import { enteteCibleManquante, lireCibleScout, sortieScoutAvecCible } from './scout-cible'

const TABLEAU = `## Constats\n| # | Score | Type | What |\n| 1 | 82 | fix | corriger X |\n| 2 | 40 | fix | corriger Y |`

describe('cible engagée par un scout', () => {
  it('lit une section ## Cible', () => {
    expect(lireCibleScout(`## Cible\nligne 1 — corriger X\n\n${TABLEAU}`)).toBe('ligne 1 — corriger X')
  })

  it('lit une ligne CIBLE:', () => {
    expect(lireCibleScout(`CIBLE: ligne 1\nPOURQUOI: score le plus haut`)).toBe('ligne 1')
  })

  it('ne prend pas une section ## Cible VIDE pour un choix', () => {
    expect(lireCibleScout(`## Cible\n\n## Constats\nrien`)).toBeUndefined()
  })

  it("ne prend pas le mot cible au fil du texte pour un choix", () => {
    expect(lireCibleScout('sur la cible donnée, plusieurs pistes')).toBeUndefined()
  })

  it('un scout sans cible reçoit un entête qui le dit, en TÊTE', () => {
    const sortie = sortieScoutAvecCible(TABLEAU)
    expect(sortie.startsWith('## Cible')).toBe(true)
    expect(sortie).toContain('SUITE: fin')
    expect(sortie).toContain('corriger X')
  })

  it("une sortie qui déclare sa cible n'est pas modifiée", () => {
    const texte = `## Cible\nligne 1\n\n${TABLEAU}`
    expect(enteteCibleManquante(texte)).toBeUndefined()
    expect(sortieScoutAvecCible(texte)).toBe(texte)
  })

  it('la cible reste lisible dans une sortie longue, désormais portée entière', () => {
    const gros = `## Cible
ligne 1 — corriger X

## Constats
${'détail. '.repeat(200)}

## Défauts
${'reste. '.repeat(200)}`
    expect(lireCibleScout(gros)).toContain('ligne 1')
  })
})
