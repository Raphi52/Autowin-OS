import { describe, expect, it } from 'vitest'
import { cibleDansLeCadre, moletteAvantDefilement, verdictCapture } from './ui-capture.mjs'

/*
 * --scroll DOIT MONTRER LA CIBLE SUR LA PHOTO (conv-1014, 2026-10-16).
 *
 * Constat : `--view chat --conversation conv-1014 --scroll <message ancien>` rendait `ok: true`,
 * cible trouvee, mais le PNG montrait le BAS du fil. Le fil du chat se recolle en bas tant que le
 * lecteur n'a fait aucun geste, et un `scrollIntoView` n'en est pas un. La capture etait une preuve
 * verte de la mauvaise chose. Deux reponses : un vrai coup de molette avant de cadrer (chat), et un
 * verdict qui MESURE la cible au moment de la photo au lieu de croire que le defilement a tenu.
 */

const mesuresVertes = {
  vue: 'chat',
  destinationActive: 'chat',
  longueurTexte: 5000,
  elements: 500,
  octetsPng: 200_000
}

describe('cibleDansLeCadre', () => {
  it('une cible courte entierement visible est dans le cadre', () => {
    expect(
      cibleDansLeCadre({
        hauteur: 120,
        hauteurVisible: 120,
        largeurVisible: 800,
        hauteurCadre: 760
      })
    ).toBe(true)
  })

  it('une cible courte coupee par le bord du fil ne l’est pas', () => {
    expect(
      cibleDansLeCadre({ hauteur: 200, hauteurVisible: 30, largeurVisible: 800, hauteurCadre: 760 })
    ).toBe(false)
  })

  it('une cible plus haute que le fil, qui le remplit, est dans le cadre', () => {
    expect(
      cibleDansLeCadre({
        hauteur: 1597,
        hauteurVisible: 760,
        largeurVisible: 870,
        hauteurCadre: 760
      })
    ).toBe(true)
  })

  it('une cible plus haute que le fil, qui n’en occupe que le bas, ne l’est pas', () => {
    expect(
      cibleDansLeCadre({
        hauteur: 1597,
        hauteurVisible: 90,
        largeurVisible: 870,
        hauteurCadre: 760
      })
    ).toBe(false)
  })

  it('une cible hors champ, ou disparue au moment de la photo, ne l’est pas', () => {
    expect(
      cibleDansLeCadre({ hauteur: 300, hauteurVisible: 0, largeurVisible: 0, hauteurCadre: 760 })
    ).toBe(false)
    expect(cibleDansLeCadre(null)).toBe(false)
    expect(cibleDansLeCadre(undefined)).toBe(false)
  })
})

describe('verdictCapture avec --scroll', () => {
  it('cible hors du cadre au moment de la photo → echec nomme, plus de faux vert', () => {
    const verdict = verdictCapture({
      ...mesuresVertes,
      defilementVers: '.msg.assistant',
      cadrage: { hauteur: 1597, hauteurVisible: 0, largeurVisible: 0, hauteurCadre: 760 }
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.echecs).toContain('scroll-cible-hors-cadre(.msg.assistant)')
  })

  it('cadrage non mesure → echec nomme : on ne suppose pas que le defilement a tenu', () => {
    const verdict = verdictCapture({ ...mesuresVertes, defilementVers: '.msg.assistant' })
    expect(verdict.ok).toBe(false)
    expect(verdict.echecs).toContain('scroll-cible-hors-cadre(.msg.assistant)')
  })

  it('cible dans le cadre → vert', () => {
    expect(
      verdictCapture({
        ...mesuresVertes,
        defilementVers: '.msg.assistant',
        cadrage: { hauteur: 1597, hauteurVisible: 760, largeurVisible: 870, hauteurCadre: 760 }
      }).ok
    ).toBe(true)
  })

  it('sans --scroll, aucune exigence de cadrage', () => {
    expect(verdictCapture(mesuresVertes).ok).toBe(true)
  })
})

describe('moletteAvantDefilement', () => {
  it('seule la vue chat recoit un coup de molette : ailleurs la molette peut zoomer un graphe', () => {
    expect(moletteAvantDefilement('chat')).toBe(true)
    expect(moletteAvantDefilement('knowledge')).toBe(false)
    expect(moletteAvantDefilement('worktree')).toBe(false)
  })
})
