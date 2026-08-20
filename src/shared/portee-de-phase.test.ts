import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { phasesRestantes, runDAnalyseSeule } from './portee-de-phase'

describe('runDAnalyseSeule', () => {
  it('un /frame seul est de l’analyse', () => {
    expect(runDAnalyseSeule(['frame'])).toBe(true)
    expect(runDAnalyseSeule(['scout', 'frame', 'terrain'])).toBe(true)
    expect(runDAnalyseSeule(['frame', 'judge'])).toBe(true)
  })

  it('dès qu’une phase MUTE, ce n’est plus de l’analyse', () => {
    expect(runDAnalyseSeule(['frame', 'build'])).toBe(false)
    expect(runDAnalyseSeule(['build'])).toBe(false)
    expect(runDAnalyseSeule(['clean'])).toBe(false)
  })

  it('sans phase connue, on n’accuse pas — le doute ne déclenche rien', () => {
    expect(runDAnalyseSeule([])).toBe(false)
    expect(runDAnalyseSeule(['  ', ''])).toBe(false)
  })
})

describe('phasesRestantes', () => {
  it('après un frame, il reste terrain, build, clean et judge', () => {
    expect(phasesRestantes(['frame'])).toEqual(['terrain', 'build', 'clean', 'judge'])
  })

  it('part de la position la plus AVANCÉE, pas du nombre de phases', () => {
    expect(phasesRestantes(['frame', 'scout', 'frame'])).toEqual([
      'terrain',
      'build',
      'clean',
      'judge'
    ])
  })

  it('après le juge, il ne reste rien de la chaîne', () => {
    expect(phasesRestantes(['judge'])).toEqual([])
  })

  it('une phase inconnue ne fabrique pas de suite imaginaire', () => {
    expect(phasesRestantes(['skill-maison'])).toEqual([])
  })
})

describe('le module ne contient aucun caractère de contrôle', () => {
  /*
   * Onzieme occurrence du meme piege dans la journee : un `\b` destine a une frontiere de mot,
   * ecrit a travers une couche d'echappement, arrive en BACKSPACE (0x08). Il est arrive DANS ce
   * fichier-ci, sur `rien\b`, et n'aurait matche que si le texte contenait un backspace.
   */
  it('aucun 0x08 ni autre caractère invisible', () => {
    const source = readFileSync('src/shared/portee-de-phase.ts', 'utf8')
    const invisibles = [...source].filter((c) => {
      const code = c.codePointAt(0) ?? 0
      return code < 32 && c !== String.fromCharCode(10) && c !== String.fromCharCode(13)
    })
    expect(invisibles).toEqual([])
  })
})
