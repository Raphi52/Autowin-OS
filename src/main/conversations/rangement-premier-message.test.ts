import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dossierDeduitDuPremierMessage } from './rangement-premier-message'

/**
 * LE CAS QUI A PRODUIT CE CODE (2026-09-16) : conversation ouverte alors que le dossier
 * actif etait celui d'un autre projet, premier message parlant des bureaux virtuels d'Autowin. Si la
 * deduction disparait ou devient trop laxiste, un de ces six cas tombe.
 */
const AUTOWIN = resolve('D:/AutoWinOS')
const AUTRE = resolve('D:/MonProjet')
const CONNUS = [AUTOWIN, AUTRE]
const existe = (): boolean => true
/** Le PREMIER message reel, copie de sa trace causale — jamais reecrit. */
const MESSAGE_REEL_CONV_611 =
  '/kaizen mes travaux en paralele se parasitent car ils utilise pas mon systeme de bureau virtuel'

describe('dossierDeduitDuPremierMessage', () => {
  it('NE range PAS le vrai message de conv-611 : aucun nom de dossier n y est ecrit', () => {
    // Cette limite est le motif de l'appel de modele (voir dossierDeduitParModele) : le lexical
    // ne sait pas relier « bureau virtuel » a D:\AutoWinOS. Le test l'ENONCE au lieu de la cacher.
    expect(dossierDeduitDuPremierMessage(MESSAGE_REEL_CONV_611, CONNUS, AUTRE, existe)).toBeNull()
  })

  it('range quand le nom du dossier est ecrit tel quel', () => {
    expect(
      dossierDeduitDuPremierMessage(
        'mes travaux en parallele se parasitent dans AutoWinOS',
        CONNUS,
        AUTRE,
        existe
      )
    ).toBe(AUTOWIN)
  })

  it('ne range pas quand le message ne nomme aucun dossier connu', () => {
    expect(
      dossierDeduitDuPremierMessage('corrige ce bug de rendu stp', CONNUS, AUTRE, existe)
    ).toBeNull()
  })

  it('ne range pas quand le dossier deduit est deja celui du tour', () => {
    expect(
      dossierDeduitDuPremierMessage('un souci dans AutoWinOS', CONNUS, AUTOWIN, existe)
    ).toBeNull()
  })

  it('ne range pas sur un dossier absent du poste', () => {
    expect(
      dossierDeduitDuPremierMessage(
        'les bureaux virtuels d’Autowin',
        CONNUS,
        AUTRE,
        (chemin) => !chemin.toLowerCase().includes('autowinos')
      )
    ).toBeNull()
  })

  it('ne range pas quand deux dossiers connus marquent autant', () => {
    expect(
      dossierDeduitDuPremierMessage(
        'compare Autowin ici',
        [resolve('D:/Autowin'), resolve('E:/Autowin')],
        resolve('D:/Ailleurs'),
        existe
      )
    ).toBeNull()
  })

  it('exige un fragment de nom assez long : « zox » ne suffit pas', () => {
    expect(
      dossierDeduitDuPremierMessage(
        'zox est lent',
        [resolve('D:/ZoxApplication')],
        resolve('D:/Autre'),
        existe
      )
    ).toBeNull()
  })
})
