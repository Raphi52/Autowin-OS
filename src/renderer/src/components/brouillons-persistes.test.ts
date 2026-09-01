import { describe, expect, it } from 'vitest'
import {
  CLE_BROUILLONS,
  lireBrouillons,
  memoriserBrouillon,
  oublierBrouillons
} from './brouillons-persistes'

function stockageFactice(initial: Record<string, string> = {}): {
  getItem: (cle: string) => string | null
  setItem: (cle: string, valeur: string) => void
} {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (cle) => data.get(cle) ?? null,
    setItem: (cle, valeur) => void data.set(cle, valeur)
  }
}

describe('brouillons persistés', () => {
  it('rend le texte tapé APRÈS un rechargement de fenêtre — le défaut corrigé', () => {
    const store = stockageFactice()
    memoriserBrouillon('conv-7', 'un message à moitié écrit', store)
    // Rechargement : la mémoire du renderer repart de zéro, seul le stockage subsiste.
    expect(lireBrouillons(store)['conv-7']).toBe('un message à moitié écrit')
  })

  it('garde les brouillons de conversations DIFFÉRENTES sans les mélanger', () => {
    const store = stockageFactice()
    memoriserBrouillon('conv-1', 'texte A', store)
    memoriserBrouillon('conv-2', 'texte B', store)
    expect(lireBrouillons(store)).toEqual({ 'conv-1': 'texte A', 'conv-2': 'texte B' })
  })

  it('oublie le brouillon dès que le composer est vidé (envoi)', () => {
    const store = stockageFactice()
    memoriserBrouillon('conv-1', 'parti', store)
    memoriserBrouillon('conv-1', '', store)
    expect(lireBrouillons(store)['conv-1']).toBeUndefined()
  })

  it('ignore une entrée corrompue sans perdre les autres', () => {
    const store = stockageFactice({
      [CLE_BROUILLONS]: JSON.stringify({ 'conv-1': 42, 'conv-2': 'survit' })
    })
    expect(lireBrouillons(store)).toEqual({ 'conv-2': 'survit' })
  })

  it('rend un objet vide sur un stockage illisible, sans lever', () => {
    const store = stockageFactice({ [CLE_BROUILLONS]: '{pas du json' })
    expect(lireBrouillons(store)).toEqual({})
  })

  it('oublie les conversations supprimées et laisse les autres intactes', () => {
    const store = stockageFactice()
    memoriserBrouillon('conv-1', 'A', store)
    memoriserBrouillon('conv-2', 'B', store)
    oublierBrouillons(['conv-1'], store)
    expect(lireBrouillons(store)).toEqual({ 'conv-2': 'B' })
  })

  it('n’explose pas quand l’écriture est refusée (quota)', () => {
    const store = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded')
      }
    }
    expect(() => memoriserBrouillon('conv-1', 'texte', store)).not.toThrow()
  })
})
