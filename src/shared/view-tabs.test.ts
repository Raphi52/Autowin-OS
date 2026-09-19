import { describe, expect, it } from 'vitest'
import {
  deplacerOnglet,
  fermerOnglet,
  isAppDestination,
  lacheHorsFenetre,
  placerFenetreDetachee,
  vueDetacheeDepuisHash
} from './view-tabs'

describe('onglets de vues', () => {
  it('fermer l’onglet actif active le voisin', () => {
    expect(fermerOnglet(['a', 'b', 'c'], 'b', 'b')).toEqual({ onglets: ['a', 'c'], actif: 'c' })
    expect(fermerOnglet(['a', 'b', 'c'], 'c', 'c')).toEqual({ onglets: ['a', 'b'], actif: 'b' })
    expect(fermerOnglet(['a', 'b'], 'a', 'b')).toEqual({ onglets: ['b'], actif: 'b' })
    expect(fermerOnglet(['a'], 'a', 'a')).toEqual({ onglets: [], actif: null })
  })
  it('glisser un onglet sur un autre le déplace', () => {
    expect(deplacerOnglet(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a'])
    expect(deplacerOnglet(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })
  it('détecte un lâcher hors de la fenêtre (autre écran)', () => {
    const fenetre = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(lacheHorsFenetre({ screenX: 2500, screenY: 400 }, fenetre)).toBe(true)
    expect(lacheHorsFenetre({ screenX: -300, screenY: 400 }, fenetre)).toBe(true)
    expect(lacheHorsFenetre({ screenX: 800, screenY: 400 }, fenetre)).toBe(false)
    expect(lacheHorsFenetre({ screenX: 0, screenY: 0 }, { ...fenetre, x: 100 })).toBe(false)
  })
  it('lit la vue d’une fenêtre détachée dans son adresse, refuse l’inconnu', () => {
    expect(vueDetacheeDepuisHash('#view=observatory')).toBe('observatory')
    expect(vueDetacheeDepuisHash('#view=evil')).toBeNull()
    expect(vueDetacheeDepuisHash('#model-question')).toBeNull()
    expect(isAppDestination('chat')).toBe(true)
  })
})

describe('placement de la fenêtre détachée', () => {
  const ecran2 = { x: 1920, y: 0, width: 1920, height: 1040 }
  it('se pose sur l’écran du lâcher, centrée sur la souris', () => {
    expect(
      placerFenetreDetachee({ screenX: 2880, screenY: 300 }, { width: 1100, height: 760 }, ecran2)
    ).toEqual({ x: 2330, y: 280, width: 1100, height: 760 })
  })
  it('reste entière dans l’écran quand on lâche près du bord', () => {
    expect(
      placerFenetreDetachee({ screenX: 3830, screenY: 1030 }, { width: 1100, height: 760 }, ecran2)
    ).toEqual({ x: 2740, y: 280, width: 1100, height: 760 })
    expect(
      placerFenetreDetachee({ screenX: 1925, screenY: 5 }, { width: 1100, height: 760 }, ecran2)
    ).toEqual({ x: 1920, y: 0, width: 1100, height: 760 })
  })
  it('rétrécit à la taille d’un petit écran', () => {
    const petit = { x: 0, y: 0, width: 800, height: 600 }
    expect(
      placerFenetreDetachee({ screenX: 400, screenY: 300 }, { width: 1100, height: 760 }, petit)
    ).toEqual({ x: 0, y: 0, width: 800, height: 600 })
  })
})
