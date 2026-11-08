import { describe, expect, it } from 'vitest'
import { CLE_BLOCS_REPLIES, lireBlocsReplies, noterBlocReplie } from './blocs-replies'

/** Un faux stockage en mémoire : le module ne lit que `getItem` et `setItem`. */
function stockage(initial?: string): Pick<Storage, 'getItem' | 'setItem'> & { brut: () => string } {
  let valeur = initial ?? null
  return {
    getItem: () => valeur,
    setItem: (_cle, suivante) => {
      valeur = suivante
    },
    brut: () => valeur ?? ''
  }
}

describe('blocs-replies — mémoire des blocs repliés', () => {
  it('un stockage illisible ou absent laisse tout déplié', () => {
    expect(lireBlocsReplies(stockage('{pas du json'))).toEqual({})
    expect(lireBlocsReplies(stockage('[true]'))).toEqual({})
    expect(lireBlocsReplies(undefined)).toEqual({})
  })

  it('ne retient que les blocs repliés, et déplier retire la clé du bloc', () => {
    const s = stockage(JSON.stringify({ scout: true, judge: 'oui' }))
    expect(lireBlocsReplies(s)).toEqual({ scout: true })
    noterBlocReplie(s, 'judge', true)
    expect(lireBlocsReplies(s)).toEqual({ scout: true, judge: true })
    noterBlocReplie(s, 'scout', false)
    noterBlocReplie(s, 'judge', false)
    expect(s.brut()).toBe('{}')
  })

  it('un stockage qui refuse l’écriture ne lève pas', () => {
    const plein = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      }
    }
    expect(() => noterBlocReplie(plein, 'judge', true)).not.toThrow()
  })

  it('la clé de stockage est stable : la changer ferait tout redéplier', () => {
    expect(CLE_BLOCS_REPLIES).toBe('autowin.ceQueCaCouvre.replies')
  })
})
