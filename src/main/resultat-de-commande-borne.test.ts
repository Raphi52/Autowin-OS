import { describe, expect, it } from 'vitest'
import {
  CARACTERES_MAX_RESULTAT_COMMANDE,
  CARACTERES_MAX_RESULTAT_COMMANDE_MAXIMUM,
  CARACTERES_MAX_RESULTAT_COMMANDE_PAR_DEFAUT,
  bornerResultatDeCommande,
  plafondDepuisEnvironnement
} from './resultat-de-commande-borne'

describe('resultat de commande — plafond a l injection', () => {
  it('laisse un resultat ordinaire intact', () => {
    const rendu = 'retrospective → {"ok":true}'
    expect(bornerResultatDeCommande('retrospective', rendu)).toBe(rendu)
  })

  it('coupe le resultat geant qui a tue conv-312, et le DIT', () => {
    // 2 860 957 caracteres rendus par `retrospective` : le prompt passait a ~890 k tokens.
    const geant = 'x'.repeat(2_860_957)
    const borne = bornerResultatDeCommande('retrospective', geant)
    expect(borne.length).toBeLessThan(CARACTERES_MAX_RESULTAT_COMMANDE + 600)
    expect(borne).toContain('RESULTAT TRONQUE')
    expect(borne).toContain('retrospective')
    expect(borne).toContain(String(2_860_957 - CARACTERES_MAX_RESULTAT_COMMANDE))
  })

  it('ne coupe jamais en silence : la coupe nomme ce qui manque', () => {
    const borne = bornerResultatDeCommande('read_file', 'y'.repeat(200), 100)
    expect(borne.startsWith('y'.repeat(100))).toBe(true)
    expect(borne).toContain('100 caractere(s)')
  })
})

describe('plafond reglable par AUTOWIN_MAX_RESULTAT_COMMANDE_CHARS', () => {
  it('applique la valeur utile lue dans la variable', () => {
    expect(plafondDepuisEnvironnement('5000')).toBe(5000)
  })

  it('retombe sur 120000 quand la variable est absente', () => {
    expect(CARACTERES_MAX_RESULTAT_COMMANDE_PAR_DEFAUT).toBe(120_000)
    expect(plafondDepuisEnvironnement(undefined)).toBe(120_000)
  })

  it('retombe sur 120000 quand la variable est mal typee', () => {
    expect(plafondDepuisEnvironnement('beaucoup')).toBe(120_000)
    expect(plafondDepuisEnvironnement('')).toBe(120_000)
    expect(plafondDepuisEnvironnement('   ')).toBe(120_000)
  })

  it('retombe sur 120000 quand la variable vaut zero', () => {
    expect(plafondDepuisEnvironnement('0')).toBe(120_000)
  })

  it('retombe sur 120000 quand la variable est negative', () => {
    expect(plafondDepuisEnvironnement('-42')).toBe(120_000)
  })

  it('coupe reellement a la valeur reglee, et le DIT', () => {
    const plafond = plafondDepuisEnvironnement('5000')
    const borne = bornerResultatDeCommande('retrospective', 'x'.repeat(400_000), plafond)
    expect(borne.startsWith('x'.repeat(5000))).toBe(true)
    expect(borne.indexOf('[RESULTAT TRONQUE') - 2).toBe(5000)
    expect(borne).toContain(String(400_000 - 5000))
  })

  it('expose un plafond effectif utilisable tel quel', () => {
    expect(Number.isFinite(CARACTERES_MAX_RESULTAT_COMMANDE)).toBe(true)
    expect(CARACTERES_MAX_RESULTAT_COMMANDE).toBeGreaterThan(0)
    expect(CARACTERES_MAX_RESULTAT_COMMANDE).toBe(
      plafondDepuisEnvironnement(process.env.AUTOWIN_MAX_RESULTAT_COMMANDE_CHARS)
    )
  })
})

describe('borne HAUTE du plafond reglable', () => {
  it('expose une borne haute finie et superieure au defaut', () => {
    expect(CARACTERES_MAX_RESULTAT_COMMANDE_MAXIMUM).toBe(400_000)
    expect(CARACTERES_MAX_RESULTAT_COMMANDE_MAXIMUM).toBeGreaterThan(
      CARACTERES_MAX_RESULTAT_COMMANDE_PAR_DEFAUT
    )
  })

  it('ecrete une valeur enorme au lieu de la laisser passer', () => {
    expect(plafondDepuisEnvironnement('10000000')).toBe(400_000)
    expect(plafondDepuisEnvironnement('999999999999')).toBe(400_000)
  })

  it('tronque reellement le cul-de-sac de conv-312 malgre un reglage enorme', () => {
    const plafond = plafondDepuisEnvironnement('10000000')
    const borne = bornerResultatDeCommande('retrospective', 'x'.repeat(2_860_957), plafond)
    expect(borne.length).toBeLessThan(410_000)
    expect(borne).toContain('[RESULTAT TRONQUE')
  })

  it('laisse intacte une valeur utile sous la borne haute', () => {
    expect(plafondDepuisEnvironnement('5000')).toBe(5000)
    expect(plafondDepuisEnvironnement('400000')).toBe(400_000)
    expect(plafondDepuisEnvironnement('399999')).toBe(399_999)
  })
})
