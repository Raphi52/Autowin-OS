import { describe, expect, it } from 'vitest'
import { asRecord, isOptionalString, objetOuNull } from './is-record'
import { comptesVides } from './carte-des-besoins'
import { normaliserTitre } from './mots'
import { raisonDeLErreur } from './raison-de-l-erreur'
import { r2 } from './glyphe-du-halo'
import { record } from './compute-fabric'

/*
 * Des fonctions copiées à l'identique dans deux fichiers n'en font plus qu'une
 * (`scripts/fonctions-en-double.mjs`). Chaque test rejoue le corps de la copie retirée, recopié
 * tel quel, et vérifie que la version unique rend la même réponse : un regroupement ne change rien.
 */
const VALEURS: unknown[] = [
  undefined,
  null,
  0,
  1,
  '',
  'x',
  true,
  false,
  [],
  [1],
  {},
  { a: 1 },
  new Date(0),
  Object.create(null)
]

describe('gardes d’objets et de chaînes', () => {
  it('asRecord : objet (tableau compris) ou undefined, comme ses deux copies', () => {
    const copie = (value: unknown): Record<string, unknown> | undefined =>
      value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
    for (const v of VALEURS) expect(asRecord(v)).toBe(copie(v))
  })

  it('objetOuNull : objet à clés ou null, comme `objet` des collègues et du quartier', () => {
    const copie = (v: unknown): Record<string, unknown> | null =>
      v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    for (const v of VALEURS) expect(objetOuNull(v)).toBe(copie(v))
  })

  it('isOptionalString : absent ou chaîne', () => {
    for (const v of VALEURS)
      expect(isOptionalString(v)).toBe(v === undefined || typeof v === 'string')
  })
})

describe('petites aides', () => {
  it('comptesVides : un compteur neuf à zéro à chaque appel', () => {
    const a = comptesVides()
    expect(a).toEqual({ prouve: 0, refuse: 0, 'en-cours': 0, 'sans-preuve': 0 })
    a.prouve = 3
    expect(comptesVides().prouve).toBe(0)
  })

  it('normaliserTitre : sans accent ni casse, ponctuation repliée en espaces', () => {
    const copie = (titre: string): string =>
      titre
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    for (const t of ['## Cible', 'Élément — À FAIRE !', '  l’œuvre  ', '', 'Déjà-vu 2']) {
      expect(normaliserTitre(t)).toBe(copie(t))
    }
    expect(normaliserTitre('## Élément — À faire')).toBe('element a faire')
  })

  it('raisonDeLErreur : le message d’une Error, sinon la valeur en texte', () => {
    expect(raisonDeLErreur(new Error('disque plein'))).toBe('disque plein')
    expect(raisonDeLErreur('refus')).toBe('refus')
    expect(raisonDeLErreur(42)).toBe('42')
    expect(raisonDeLErreur(undefined)).toBe('undefined')
  })

  it('r2 : arrondi au centième', () => {
    expect(r2(1.234)).toBe(1.23)
    expect(r2(1.235)).toBe(Math.round(1.235 * 100) / 100)
    expect(r2(-0.5)).toBe(-0.5)
  })

  it('record : rend l’objet, refuse le reste en nommant le champ', () => {
    const objet = { a: 1 }
    expect(record(objet, 'état')).toBe(objet)
    for (const v of [null, undefined, 0, 'x', [], [1]]) {
      expect(() => record(v, 'état')).toThrow('état invalide')
    }
  })
})
