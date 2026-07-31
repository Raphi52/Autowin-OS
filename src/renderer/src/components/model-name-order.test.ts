import { describe, expect, it } from 'vitest'
import { compareModelsByName, displayedModelName } from './model-name-order'

describe('model name order', () => {
  it('trie naturellement par nom affiché sans tenir compte de la casse ni des accents', () => {
    const models = [
      { id: 'zeta/model-10', provider: 'zeta', model: 'model-10', label: 'Modèle 10' },
      { id: 'alpha/model-2', provider: 'alpha', model: 'model-2', label: 'modele 2' },
      { id: 'middle/model-1', provider: 'middle', model: 'model-1', label: 'MODÈLE 1' }
    ]

    expect(models.sort(compareModelsByName).map(displayedModelName)).toEqual([
      'MODÈLE 1',
      'modele 2',
      'Modèle 10'
    ])
  })

  it('départage les noms identiques par provider puis identifiant', () => {
    const models = [
      { id: 'zeta/b', provider: 'zeta', model: 'same', label: 'Même nom' },
      { id: 'alpha/b', provider: 'alpha', model: 'same', label: 'meme nom' },
      { id: 'alpha/a', provider: 'alpha', model: 'same', label: 'MÊME NOM' }
    ]

    expect(models.sort(compareModelsByName).map(({ id }) => id)).toEqual([
      'alpha/a',
      'alpha/b',
      'zeta/b'
    ])
  })

  it('utilise le nom runtime quand aucun libellé n’est fourni', () => {
    expect(
      displayedModelName({ id: 'local/model', provider: 'local', model: 'Runtime Model' })
    ).toBe('Runtime Model')
  })
})
