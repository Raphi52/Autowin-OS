import { describe, expect, it } from 'vitest'
import { verdictPanelValide } from './objections-juge'
import { verdictAvecObjectionsPortees } from './objections-juge'

describe('panel qui atteint le quorum', () => {
  const avecObjections = (n: string, etiquette = '') =>
    `VALIDE\n\nSCORE: 72\n\nOBJECTIONS:\n- ${etiquette}${n}\n`

  it('porte les objections des membres au lieu de les jeter', () => {
    const texte = verdictPanelValide([
      avecObjections('le tour n’est pas fini en réussite'),
      avecObjections('un commit n’est pas annulable seul'),
      'VALIDE\n\nOBJECTIONS:\n- aucune\n'
    ])
    expect(texte).toContain('le tour n’est pas fini en réussite')
    expect(texte).toContain('un commit n’est pas annulable seul')
    expect(texte.startsWith('VALIDE')).toBe(true)
  })

  it('reste le simple VALIDE quand aucun membre n’objecte', () => {
    expect(verdictPanelValide(['VALIDE\n\nOBJECTIONS:\n- aucune\n', 'VALIDE'])).toBe('VALIDE')
  })

  it('une objection MAJEUR d’un membre rouvre le verdict agrégé', () => {
    const texte = verdictPanelValide([avecObjections('preuve absente', 'MAJEUR: ')])
    expect(verdictAvecObjectionsPortees(texte)).toMatch(/^DEFAUT:/)
  })

  it('des objections non étiquetées ne rouvrent pas le verdict (pas de boucle sans fin)', () => {
    const texte = verdictPanelValide([avecObjections('constat : 284 tests verts')])
    expect(verdictAvecObjectionsPortees(texte)).toBe(texte)
  })
})
