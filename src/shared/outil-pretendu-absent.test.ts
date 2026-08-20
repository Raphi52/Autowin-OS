import { describe, expect, it } from 'vitest'
import { correctionOutilsPresents, outilsFaussementAbsents } from './outil-pretendu-absent'

const CATALOGUE = ['edit_file', 'verify', 'orchestrate', 'read_file', 'brain_query']

describe('outilsFaussementAbsents — les phrases REELLES de la conversation du 20/08', () => {
  it('attrape « edit_file n’existe pas dans le catalogue »', () => {
    const texte =
      "`edit_file` n'existe pas dans le catalogue réellement disponible de cette session " +
      '(outils présents : lecture, recherche, shell).'
    expect(outilsFaussementAbsents(texte, CATALOGUE)).toEqual(['edit_file'])
  })

  it('attrape « verify non disponible non plus »', () => {
    expect(outilsFaussementAbsents('`verify` non disponible non plus', CATALOGUE)).toEqual([
      'verify'
    ])
  })

  it('attrape les deux dans la même phrase, telle qu’elle a été écrite', () => {
    const texte =
      "`edit_file` n'existe pas dans le catalogue réellement disponible de cette session. " +
      '`verify` non disponible non plus, donc je ne pourrais pas produire la preuve.'
    expect(outilsFaussementAbsents(texte, CATALOGUE).sort()).toEqual(['edit_file', 'verify'])
  })

  it('tolère quelques mots entre le nom et la négation', () => {
    const texte = "L'outil `brain_query` annoncé n'est pas exposé dans ce run"
    expect(outilsFaussementAbsents(texte, CATALOGUE)).toEqual(['brain_query'])
  })

  it('attrape la formule anglaise du runtime', () => {
    expect(outilsFaussementAbsents('brain_query: No such tool available', CATALOGUE)).toEqual([
      'brain_query'
    ])
  })
})

describe('outilsFaussementAbsents — la précision avant la couverture', () => {
  it('NE déclenche PAS quand la négation porte sur autre chose', () => {
    // Le cas voisin le plus proche de la frontière : la phrase est VRAIE.
    const texte = "j'ai `edit_file`, mais `git apply` n'est pas disponible"
    expect(outilsFaussementAbsents(texte, CATALOGUE)).toEqual([])
  })

  it('NE déclenche PAS sur un outil réellement hors du catalogue du tour', () => {
    // Un sous-agent orchestré n'a pas `brain_query` : le dire est honnête, pas un défaut.
    const restreint = ['read_file']
    expect(outilsFaussementAbsents("`brain_query` n'est pas exposé", restreint)).toEqual([])
  })

  it('NE déclenche PAS sur un nom qui n’est qu’un fragment', () => {
    expect(outilsFaussementAbsents("verifyPath n'existe pas", CATALOGUE)).toEqual([])
    expect(outilsFaussementAbsents("mon_edit_file n'existe pas", CATALOGUE)).toEqual([])
  })

  it('NE déclenche PAS quand la négation est trop loin du nom', () => {
    const texte =
      "`edit_file` sert à remplacer un extrait unique dans un bureau isolé, et le réseau n'est pas disponible"
    expect(outilsFaussementAbsents(texte, CATALOGUE)).toEqual([])
  })

  it('NE déclenche PAS sur un usage normal de l’outil', () => {
    expect(outilsFaussementAbsents("j'appelle `edit_file` puis `verify`", CATALOGUE)).toEqual([])
    expect(outilsFaussementAbsents('', CATALOGUE)).toEqual([])
    expect(outilsFaussementAbsents(undefined, CATALOGUE)).toEqual([])
    expect(outilsFaussementAbsents("`edit_file` n'existe pas", [])).toEqual([])
  })

  it('ne signale un outil qu’une fois, même répété', () => {
    const texte = "`edit_file` n'existe pas. Je répète : `edit_file` non disponible."
    expect(outilsFaussementAbsents(texte, CATALOGUE)).toEqual(['edit_file'])
  })
})

describe('correctionOutilsPresents', () => {
  it('nomme les outils et dit que la tentative n’a pas eu lieu', () => {
    const message = correctionOutilsPresents(['edit_file', 'verify'])
    expect(message).toContain('`edit_file`')
    expect(message).toContain('`verify`')
    expect(message).toContain("Tu ne l'as pas essayé")
    // Elle doit couper court à la réclamation de droits shell, qui est la spirale observée.
    expect(message).toContain('aucun droit shell')
  })

  it('accorde le verbe au singulier pour un seul outil', () => {
    expect(correctionOutilsPresents(['verify'])).toContain('`verify` est dans le catalogue')
  })
})
