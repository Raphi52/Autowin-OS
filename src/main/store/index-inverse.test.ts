import { describe, expect, it } from 'vitest'
import { creerIndexInverse } from './index-inverse'

/**
 * Le contrat de la pre-selection. Il doit etre EXACT dans un sens : une conversation qui porte le mot
 * ne doit JAMAIS manquer a l'appel -- sinon la recherche devient silencieusement incomplete, ce qui
 * est pire que lente.
 */
describe('index inverse', () => {
  it('rend les conversations qui portent une racine', () => {
    const index = creerIndexInverse()
    index.ajouter('conv-1', ['pastil', 'couleu'])
    index.ajouter('conv-2', ['ticket'])
    expect([...(index.candidates(['pastil']) ?? [])]).toEqual(['conv-1'])
  })

  it('reunit les porteurs de plusieurs racines', () => {
    const index = creerIndexInverse()
    index.ajouter('conv-1', ['pastil'])
    index.ajouter('conv-2', ['couleu'])
    expect((index.candidates(['pastil', 'couleu']) ?? new Set()).size).toBe(2)
  })

  it('rend un ensemble VIDE, pas undefined, quand aucune conversation ne porte la racine', () => {
    const index = creerIndexInverse()
    index.ajouter('conv-1', ['pastil'])
    expect(index.candidates(['kubernetes'])?.size).toBe(0)
  })

  it('se met a jour a l ajout, sans rien reconstruire', () => {
    const index = creerIndexInverse()
    index.ajouter('conv-1', ['pastil'])
    index.ajouter('conv-1', ['zephyr'])
    expect([...(index.candidates(['zephyr']) ?? [])]).toEqual(['conv-1'])
  })

  it('oublie une conversation retiree, et la racine devenue orpheline avec elle', () => {
    const index = creerIndexInverse()
    index.ajouter('conv-1', ['pastil'])
    index.retirer('conv-1')
    expect(index.candidates(['pastil'])?.size).toBe(0)
  })

  it('ne retire que la conversation nommee', () => {
    const index = creerIndexInverse()
    index.ajouter('conv-1', ['pastil'])
    index.ajouter('conv-2', ['pastil'])
    index.retirer('conv-1')
    expect([...(index.candidates(['pastil']) ?? [])]).toEqual(['conv-2'])
  })
})
