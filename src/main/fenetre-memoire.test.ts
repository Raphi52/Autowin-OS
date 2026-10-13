import { describe, expect, it } from 'vitest'
import {
  ecrireEtatFenetre,
  lireEtatFenetre,
  placerFenetreMemorisee,
  TAILLE_MINIMALE,
  type Rect
} from './fenetre-memoire'

const ECRAN_PRINCIPAL: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
const ECRAN_DROITE: Rect = { x: 1920, y: 0, width: 2560, height: 1400 }

describe('lireEtatFenetre / ecrireEtatFenetre', () => {
  it('relit exactement ce qui a été écrit (place, taille, agrandie ou non)', () => {
    const etat = { x: 240, y: 130, width: 1280, height: 820, maximisee: false }
    expect(lireEtatFenetre(ecrireEtatFenetre(etat))).toEqual(etat)
    expect(lireEtatFenetre(ecrireEtatFenetre({ ...etat, maximisee: true }))?.maximisee).toBe(true)
  })

  it('fichier absent, corrompu ou incomplet → aucun état (la fenêtre garde son ouverture par défaut)', () => {
    expect(lireEtatFenetre(null)).toBeNull()
    expect(lireEtatFenetre('')).toBeNull()
    expect(lireEtatFenetre('{"x":10,"y":')).toBeNull()
    expect(lireEtatFenetre('{"x":10,"y":20,"width":800}')).toBeNull()
    expect(lireEtatFenetre('{"x":10,"y":20,"width":0,"height":600}')).toBeNull()
    expect(lireEtatFenetre('"texte"')).toBeNull()
  })
})

describe('placerFenetreMemorisee', () => {
  it('rend la fenêtre réduite à SA place et SA taille quand elle est toujours à l’écran', () => {
    const etat = { x: 300, y: 120, width: 1100, height: 700, maximisee: false }
    expect(placerFenetreMemorisee(etat, [ECRAN_PRINCIPAL, ECRAN_DROITE])).toEqual(etat)
  })

  it('garde une fenêtre posée sur le second écran', () => {
    const etat = { x: 2400, y: 200, width: 1400, height: 900, maximisee: false }
    expect(placerFenetreMemorisee(etat, [ECRAN_PRINCIPAL, ECRAN_DROITE])).toEqual(etat)
  })

  it('ramène dans l’écran principal une fenêtre laissée sur un écran débranché', () => {
    const etat = { x: 2400, y: 200, width: 1400, height: 900, maximisee: false }
    const place = placerFenetreMemorisee(etat, [ECRAN_PRINCIPAL])!
    expect(place.width).toBe(1400)
    expect(place.height).toBe(900)
    expect(place.x).toBeGreaterThanOrEqual(0)
    expect(place.x + place.width).toBeLessThanOrEqual(1920)
    expect(place.y + place.height).toBeLessThanOrEqual(1040)
  })

  it('réduit à la taille de l’écran une fenêtre plus grande que lui', () => {
    const etat = { x: 5000, y: 0, width: 2500, height: 1350, maximisee: true }
    expect(placerFenetreMemorisee(etat, [ECRAN_PRINCIPAL])).toEqual({
      ...ECRAN_PRINCIPAL,
      maximisee: true
    })
  })

  it('ramène une fenêtre dont la barre de titre est passée au-dessus de l’écran', () => {
    const etat = { x: 200, y: -400, width: 1000, height: 700, maximisee: false }
    const place = placerFenetreMemorisee(etat, [ECRAN_PRINCIPAL])!
    expect(place.y).toBe(0)
    expect(place.x).toBe(200)
  })

  it('remonte une taille enregistrée trop petite pour être utilisable', () => {
    const etat = { x: 100, y: 100, width: 50, height: 40, maximisee: false }
    const place = placerFenetreMemorisee(etat, [ECRAN_PRINCIPAL])!
    expect(place.width).toBe(TAILLE_MINIMALE.width)
    expect(place.height).toBe(TAILLE_MINIMALE.height)
  })

  it('aucun écran connu → aucune décision', () => {
    expect(
      placerFenetreMemorisee({ x: 0, y: 0, width: 800, height: 600, maximisee: false }, [])
    ).toBeNull()
  })
})
