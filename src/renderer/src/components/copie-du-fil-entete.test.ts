import { describe, expect, it } from 'vitest'
import { brancheEstLaCopieDuFil, copieAfficheeDuFil } from './copie-du-fil-entete'

const COPIE = 'D:\\AutoWinOS\\.autowin-data\\autowin-os\\copies-de-fil\\conv-1710'

describe('copieAfficheeDuFil — l’en-tête nomme le projet, pas la copie', () => {
  it('rend le dossier d’avant quand le fil travaille dans sa copie', () => {
    expect(
      copieAfficheeDuFil({
        projectPath: COPIE,
        copieDuFil: { chemin: COPIE, depot: 'D:\\AutoWinOS', dossierAvant: 'D:\\AutoWinOS' }
      })
    ).toEqual({ projet: 'D:\\AutoWinOS', copie: COPIE })
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

describe('brancheEstLaCopieDuFil — « copie du fil » remplace « (detached) »', () => {
  const copie = { projet: 'D:\\AutoWinOS', copie: COPIE }

  it('dans la copie du fil, la branche détachée est la copie du fil', () => {
    expect(brancheEstLaCopieDuFil('(detached)', copie)).toBe(true)
  })

  it('une vraie branche, ou un détachement hors copie, reste tel quel', () => {
    expect(brancheEstLaCopieDuFil('main', copie)).toBe(false)
    expect(brancheEstLaCopieDuFil('(detached)', null)).toBe(false)
  })
})
