import { describe, expect, it } from 'vitest'
import { arretDeLaReparation } from './stopgate'
import { PREFIXE_TEST_MODIFIE } from '../objections-juge'

// conv-844 (2026-09-24) : « que ça s'arrête que quand y a plus de défauts ».
describe('reparation jusqu au vert', () => {
  const base = { reparationsAccordees: 2, plafondDur: 4, motifsCourants: ['x'], motifsPrecedents: ['x'] }
  it('ni le plafond dur ni un refus repete n arretent la reparation', () => {
    expect(arretDeLaReparation({ ...base, tentative: 50, refusIdentiquesConsecutifs: 9, jusquAuVert: true })).toBeUndefined()
  })
  it('sans le mode, le plafond dur mord toujours', () => {
    expect(arretDeLaReparation({ ...base, tentative: 4 })).toMatch(/plafond dur/)
  })
  it('un code perime arrete encore : aucune reparation ne peut changer le verdict', () => {
    const bundlePerime = { bundleMs: 1, sourceMs: 2, bundle: 'out/main/index.js' }
    expect(arretDeLaReparation({ ...base, tentative: 1, jusquAuVert: true, bundlePerime })).toMatch(/périmé/)
  })
  // conv-35 : ~107 passages sur 109 apres validation, memes reserves MINEUR a chaque tour.
  it('memes reserves mineures deux passages de suite : arret nomme, meme jusqu au vert', () => {
    expect(arretDeLaReparation({ ...base, tentative: 3, jusquAuVert: true, reservesMineuresFigees: true })).toMatch(/mêmes réserves mineures/)
  })
  it('reserves mineures qui bougent : on continue jusqu au vert', () => {
    expect(arretDeLaReparation({ ...base, tentative: 3, jusquAuVert: true, reservesMineuresFigees: false })).toBeUndefined()
  })
  // conv-44 (juge independant, MINEUR « refus sans fin ») : un fichier TEST: jamais restaure a
  // l'octet pres relancait build + juge a l'infini en mode jusqu'au vert.
  const testModifie = `${PREFIXE_TEST_MODIFIE} (D:/r/a.test.ts) — il fallait le faire passer sans le toucher.`
  it('meme refus « fichier de test modifie » repete : arret nomme, meme jusqu au vert', () => {
    const m = [testModifie]
    expect(
      arretDeLaReparation({ ...base, motifsCourants: m, motifsPrecedents: m, tentative: 3, refusIdentiquesConsecutifs: 2, jusquAuVert: true })
    ).toMatch(/fichier de test/)
  })
  it('jumeau : un premier refus « test modifie » laisse encore une chance de restaurer', () => {
    const m = [testModifie]
    expect(
      arretDeLaReparation({ ...base, motifsCourants: m, motifsPrecedents: [], tentative: 1, refusIdentiquesConsecutifs: 1, jusquAuVert: true })
    ).toBeUndefined()
  })
  it('jumeau : un autre refus repete continue jusqu au vert', () => {
    expect(arretDeLaReparation({ ...base, tentative: 3, refusIdentiquesConsecutifs: 2, jusquAuVert: true })).toBeUndefined()
  })
  it('le code perime reste prioritaire', () => {
    const bundlePerime = { bundleMs: 1, sourceMs: 2, bundle: 'out/main/index.js' }
    expect(arretDeLaReparation({ ...base, tentative: 1, jusquAuVert: true, bundlePerime, reservesMineuresFigees: true })).toMatch(/périmé/)
  })
})
