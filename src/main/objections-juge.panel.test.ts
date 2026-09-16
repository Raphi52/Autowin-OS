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

  /**
   * conv-539, tour 6ba33167-9b16-4dbb-8a5f-fd40207ed80e : sur les 4 appels juge, celui de
   * 09:55:17.497 rend « DEFAUT: le tour n'est pas fini en réussite / SCORE: 66 » — les 3 autres
   * VALIDE. Le quorum passe, et les puces du dissident étaient recopiées NUES : non étiquetées =
   * verdict clos. D'où la saisie ts 1789466353210 : « tu t'es arrêté alors que 3/4 des juges ont
   * des objections ». Un DEFAUT explicite d'un membre vaut MAJEUR, même minoritaire.
   */
  it('les objections d’un membre qui vote DEFAUT rouvrent le verdict agrégé', () => {
    const texte = verdictPanelValide([
      { text: avecObjections('un commit n’est pas annulable seul'), ok: true },
      { text: avecObjections('rien n’est mesuré sur un vrai tour'), ok: true },
      {
        text: [
          'DEFAUT: le tour n’est pas fini en réussite',
          'SCORE: 66',
          'OBJECTIONS:',
          '- la demande n’est pas satisfaite'
        ].join('\n\n'),
        ok: false
      }
    ])
    expect(texte).toContain('la demande n’est pas satisfaite')
    expect(texte).toMatch(/MAJEUR\s*:\s*la demande n’est pas satisfaite/)
    expect(verdictAvecObjectionsPortees(texte)).toMatch(/^DEFAUT:/)
  })
})
