import { describe, expect, it } from 'vitest'
import {
  demandeUltrathink,
  effortAvecUltrathink,
  saisieArriveeDUnBloc,
  ultrathinkResteTape
} from './ultrathink'

describe('demandeUltrathink — le mot-clé dans le message', () => {
  it.each([
    'ultrathink',
    'Ultrathink pourquoi ce test échoue',
    'corrige ce défaut, ultrathink.',
    'cherche la cause\nULTRATHINK',
    'ultrathink: reprends tout'
  ])('reconnaît « %s »', (texte) => {
    expect(demandeUltrathink(texte)).toBe(true)
  })

  it.each([
    '',
    'réfléchis bien',
    'think hard',
    'ouvre `ultrathink` dans la doc',
    'le mot "ultrathink" entre guillemets',
    'lis docs/ultrathink.md',
    'lance --ultrathink',
    'ultrathinking',
    'megaultrathink',
    '(ultrathink)'
  ])('laisse passer « %s » comme du texte ordinaire', (texte) => {
    expect(demandeUltrathink(texte)).toBe(false)
  })

  it('accepte un message absent', () => {
    expect(demandeUltrathink(undefined)).toBe(false)
  })
})

describe('effortAvecUltrathink — le niveau de réflexion du tour', () => {
  const claude = ['low', 'medium', 'high', 'xhigh', 'max']

  it('monte à xhigh quand le modèle le propose', () => {
    expect(effortAvecUltrathink('medium', claude)).toBe('xhigh')
    expect(effortAvecUltrathink(undefined, claude)).toBe('xhigh')
  })

  it('ne baisse jamais un réglage déjà plus haut', () => {
    expect(effortAvecUltrathink('max', claude)).toBe('max')
    expect(effortAvecUltrathink('xhigh', claude)).toBe('xhigh')
  })

  it('prend le plus haut niveau proposé sous xhigh quand xhigh manque', () => {
    expect(effortAvecUltrathink('low', ['low', 'medium', 'high'])).toBe('high')
    expect(effortAvecUltrathink('minimal', ['minimal', 'low', 'ultra'])).toBe('low')
  })

  it('ne change rien pour un modèle sans réglage de réflexion', () => {
    expect(effortAvecUltrathink('none', ['none'])).toBe('none')
    expect(effortAvecUltrathink(undefined, ['none'])).toBeUndefined()
  })

  it('ne déduit rien quand les niveaux du modèle sont inconnus', () => {
    expect(effortAvecUltrathink('medium', undefined)).toBe('medium')
    expect(effortAvecUltrathink(undefined, undefined)).toBeUndefined()
  })
})

describe('ultrathinkResteTape — le mot ne compte que tapé par la personne', () => {
  const suivre = (
    etapes: Array<[apres: string, tape: boolean]>,
    depart = { texte: '', tape: false }
  ): boolean =>
    etapes.reduce(
      (etat, [apres, tape]) => ({
        texte: apres,
        tape: ultrathinkResteTape({ avant: etat.texte, apres, dejaTape: etat.tape, tape })
      }),
      depart
    ).tape

  it('tapé lettre à lettre : compte dès que le mot est complet', () => {
    expect(suivre([['ultrathin', true]])).toBe(false)
    expect(
      suivre([
        ['ultrathin', true],
        ['ultrathink', true]
      ])
    ).toBe(true)
  })

  it('collé, ou posé par l’app (suite proposée, brouillon rendu) : ne compte pas', () => {
    expect(suivre([['ultrathink corrige a.ts', false]])).toBe(false)
  })

  it('un mot collé ne devient pas tapé parce qu’on tape autour', () => {
    expect(
      suivre([
        ['ultrathink corrige', false],
        ['ultrathink corrige a.ts', true]
      ])
    ).toBe(false)
  })

  it('un mot tapé le reste quand du texte est collé ou ajouté par l’app ensuite', () => {
    expect(
      suivre([
        ['ultrathink', true],
        ['ultrathink voici le journal collé', false]
      ])
    ).toBe(true)
  })

  it('effacé puis retapé : compte ; effacé : ne compte plus', () => {
    expect(
      suivre([
        ['ultrathink corrige', false],
        ['corrige', true],
        ['ultrathink corrige', true]
      ])
    ).toBe(true)
    expect(
      suivre([
        ['ultrathink', true],
        ['', true]
      ])
    ).toBe(false)
  })
})

describe('saisieArriveeDUnBloc — frappe ou texte arrivé d’un bloc', () => {
  it.each(['insertFromPaste', 'insertFromDrop', 'insertReplacementText', 'historyUndo'])(
    '« %s » arrive d’un bloc',
    (type) => expect(saisieArriveeDUnBloc(type)).toBe(true)
  )
  it.each(['insertText', 'insertCompositionText', 'deleteContentBackward', undefined])(
    '« %s » est de la frappe',
    (type) => expect(saisieArriveeDUnBloc(type)).toBe(false)
  )
})
