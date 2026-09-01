import { describe, expect, it } from 'vitest'
import {
  CLE_NOM_JARVIS,
  NOM_JARVIS_DEFAUT,
  NOM_JARVIS_LONGUEUR_MAX,
  ecrireNomJarvis,
  lireNomJarvis,
  normaliserNomJarvis
} from './jarvis-nom'

function memoire(initial: Record<string, string> = {}): {
  getItem(cle: string): string | null
  setItem(cle: string, valeur: string): void
} {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (cle: string): string | null => data.get(cle) ?? null,
    setItem: (cle: string, valeur: string): void => {
      data.set(cle, valeur)
    }
  }
}

describe('nom de l assistant vocal', () => {
  it('garde le nom d origine quand rien n a ete choisi', () => {
    expect(lireNomJarvis(memoire())).toBe(NOM_JARVIS_DEFAUT)
  })

  it('rend le nom choisi', () => {
    expect(lireNomJarvis(memoire({ [CLE_NOM_JARVIS]: 'Alfred' }))).toBe('Alfred')
  })

  it('ne laisse jamais un titre vide', () => {
    expect(normaliserNomJarvis('   ')).toBe(NOM_JARVIS_DEFAUT)
    expect(normaliserNomJarvis(null)).toBe(NOM_JARVIS_DEFAUT)
    expect(normaliserNomJarvis(42)).toBe(NOM_JARVIS_DEFAUT)
  })

  it('nettoie les sauts de ligne et les espaces multiples', () => {
    expect(normaliserNomJarvis('  Miss\n  Moneypenny  ')).toBe('Miss Moneypenny')
  })

  it('coupe un nom trop long pour l etiquette', () => {
    const long = 'A'.repeat(NOM_JARVIS_LONGUEUR_MAX + 12)
    expect(normaliserNomJarvis(long)).toHaveLength(NOM_JARVIS_LONGUEUR_MAX)
  })

  it('enregistre la valeur normalisee, pas la saisie brute', () => {
    const storage = memoire()
    expect(ecrireNomJarvis(storage, '  Friday  ')).toBe('Friday')
    expect(storage.getItem(CLE_NOM_JARVIS)).toBe('Friday')
    expect(lireNomJarvis(storage)).toBe('Friday')
  })

  it('survit a un stockage indisponible', () => {
    const casse = {
      getItem: (): string | null => {
        throw new Error('stockage refuse')
      },
      setItem: (): void => {
        throw new Error('stockage refuse')
      }
    }
    expect(lireNomJarvis(casse)).toBe(NOM_JARVIS_DEFAUT)
    expect(ecrireNomJarvis(casse, 'Jarvis 2')).toBe('Jarvis 2')
  })
})
