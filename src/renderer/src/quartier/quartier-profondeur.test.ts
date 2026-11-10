import { describe, expect, it } from 'vitest'
import donnees from '../assets/quartier/donnees.json'
import { creerMarche, type DonneesMarche } from './quartier-marche'
import {
  couvre,
  estDerriere,
  piedSous,
  repeintsApres,
  type ObjetPlace
} from './quartier-profondeur'

type Objet = ObjetPlace & { n?: string }
const D = donnees as unknown as DonneesMarche & { obj: Objet[] }
const marche = creerMarche(D)
const retour = D.obj.find((o) => o.n === 'cloture_onsen_coin') as Objet

// Deux tanukis sur les galets, au pied du coin de l'onsen. Celui de droite est devant le pilier droit
// (pied 752) ; celui de gauche, posé après lui, est derrière le pilier gauche (pied 768). Le repeint du
// retour, déclenché par celui de gauche, ne doit pas recouvrir celui de droite déjà posé.
const devant = { x: 605, y: 755, u: 64 }
const derriere = { x: 560, y: 760, u: 64 }

describe('le retour de barrière de l’onsen devant les tanukis', () => {
  it('les deux places sont marchables', () => {
    expect(marche.libre(devant.x, devant.y)).toBe(true)
    expect(marche.libre(derriere.x, derriere.y)).toBe(true)
  })

  it('la ligne de pied du retour vaut 768 sous le pilier gauche et 752 sous le pilier droit', () => {
    expect(piedSous(retour, 556)).toBe(768)
    expect(piedSous(retour, 604)).toBe(752)
  })

  it('celui de droite est devant le retour, celui de gauche derrière, et la boîte les touche tous deux', () => {
    expect(couvre(retour, devant)).toBe(true)
    expect(estDerriere(retour, devant)).toBe(false)
    expect(couvre(retour, derriere)).toBe(true)
    expect(estDerriere(retour, derriere)).toBe(true)
  })

  it('le repeint déclenché par celui de gauche épargne celui de droite déjà posé', () => {
    const plan = repeintsApres(derriere, [devant], D.obj)
    expect(plan.map((p) => p.o)).toEqual([retour])
    expect(plan[0].sauf).toEqual([devant])
  })

  it('un tanuki posé derrière le retour n’est pas épargné : le repeint le recouvre, comme il doit', () => {
    const autre = { x: 565, y: 760, u: 64 }
    expect(repeintsApres(derriere, [autre], [retour])[0].sauf).toEqual([])
  })

  it('un tanuki devant le retour ne déclenche aucun repeint', () => {
    expect(repeintsApres(devant, [], [retour])).toEqual([])
  })
})
