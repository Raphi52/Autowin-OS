import { describe, expect, it } from 'vitest'
import { demandeUltrathink, effortAvecUltrathink } from './ultrathink'

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
