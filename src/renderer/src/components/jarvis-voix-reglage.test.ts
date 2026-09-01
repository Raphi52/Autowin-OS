import { describe, expect, it } from 'vitest'
import {
  CLE_VOIX_JARVIS,
  DEBIT_MAX,
  DEBIT_MIN,
  ecrireReglageVoix,
  lireReglageVoix,
  normaliserReglageVoix,
  REGLAGE_VOIX_DEFAUT
} from './jarvis-voix-reglage'

function stockage(
  initial: Record<string, string> = {}
): Storage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v
    }
  } as unknown as Storage & { data: Record<string, string> }
}

describe('le reglage de voix', () => {
  it('rend le reglage d’origine quand rien n’a jamais ete choisi', () => {
    expect(lireReglageVoix(stockage())).toEqual(REGLAGE_VOIX_DEFAUT)
  })

  it('borne un debit et une hauteur hors limites au lieu de refuser la phrase', () => {
    // Hors bornes, l'API de synthese REFUSE de prononcer : borner est la seule facon de rester audible.
    expect(normaliserReglageVoix({ debit: 12, hauteur: -4 }).debit).toBe(DEBIT_MAX)
    expect(normaliserReglageVoix({ debit: 0.01, hauteur: -4 }).debit).toBe(DEBIT_MIN)
    expect(normaliserReglageVoix({ hauteur: 99 }).hauteur).toBe(2)
  })

  it('survit a un JSON abime', () => {
    const s = stockage({ [CLE_VOIX_JARVIS]: '{ pas du json' })
    expect(lireReglageVoix(s)).toEqual(REGLAGE_VOIX_DEFAUT)
  })

  it('enregistre un changement PARTIEL sans perdre les autres reglages', () => {
    const s = stockage()
    ecrireReglageVoix(s, { voixURI: 'Microsoft Hortense' })
    const apres = ecrireReglageVoix(s, { debit: 1.5 })
    expect(apres).toEqual({
      voixURI: 'Microsoft Hortense',
      debit: 1.5,
      hauteur: REGLAGE_VOIX_DEFAUT.hauteur
    })
    expect(lireReglageVoix(s)).toEqual(apres)
  })
})
