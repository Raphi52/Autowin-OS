import { describe, expect, it } from 'vitest'
import { copieAfficheeDuFil, dossierDeLaBranche } from './copie-du-fil-entete'

const COPIE = 'D:\\AutoWinOS\\.autowin-data\\autowin-os\\copies-de-fil\\conv-1710'

describe('copieAfficheeDuFil — l’en-tête nomme le projet, pas la copie', () => {
  it('rend le dossier d’avant quand le fil travaille dans sa copie', () => {
    expect(
      copieAfficheeDuFil({
        projectPath: COPIE,
        copieDuFil: { chemin: COPIE, depot: 'D:\\AutoWinOS', dossierAvant: 'D:\\AutoWinOS' }
      })
    ).toEqual({ projet: 'D:\\AutoWinOS', depot: 'D:\\AutoWinOS', copie: COPIE })
  })

  it('sans dossier d’avant, le dépôt ; chemins comparés sans casse ni barre finale', () => {
    expect(
      copieAfficheeDuFil({
        projectPath: `${COPIE.toUpperCase()}\\`,
        copieDuFil: { chemin: COPIE, depot: 'D:\\AutoWinOS' }
      })?.projet
    ).toBe('D:\\AutoWinOS')
  })

  it('un fil revenu de sa copie, ou sans copie, s’affiche comme avant', () => {
    expect(
      copieAfficheeDuFil({
        projectPath: 'D:\\AutoWinOS',
        copieDuFil: { chemin: COPIE, depot: 'D:\\AutoWinOS' }
      })
    ).toBeNull()
    expect(copieAfficheeDuFil({ projectPath: 'D:\\AutoWinOS' })).toBeNull()
    expect(copieAfficheeDuFil(undefined)).toBeNull()
  })
})

describe('dossierDeLaBranche — la branche est celle où le travail entre', () => {
  const copie = { projet: 'D:\\AutoWinOS', depot: 'D:\\AutoWinOS', copie: COPIE }

  it('dans sa copie, le fil lit la branche du dépôt partagé, pas celle de la copie', () => {
    expect(dossierDeLaBranche(COPIE, copie)).toBe('D:\\AutoWinOS')
  })

  it('hors copie, le fil lit la branche de son propre dossier', () => {
    expect(dossierDeLaBranche('D:\\Projet', null)).toBe('D:\\Projet')
    expect(dossierDeLaBranche(undefined, null)).toBeUndefined()
  })

  it('sans dépôt connu, le dossier d’avant porte la branche', () => {
    expect(
      copieAfficheeDuFil({
        projectPath: COPIE,
        copieDuFil: { chemin: COPIE, dossierAvant: 'D:\\AutoWinOS' }
      })?.depot
    ).toBe('D:\\AutoWinOS')
  })
})
