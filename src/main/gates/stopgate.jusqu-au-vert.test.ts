import { describe, expect, it } from 'vitest'
import { arretDeLaReparation } from './stopgate'

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
  it('le code perime reste prioritaire', () => {
    const bundlePerime = { bundleMs: 1, sourceMs: 2, bundle: 'out/main/index.js' }
    expect(arretDeLaReparation({ ...base, tentative: 1, jusquAuVert: true, bundlePerime, reservesMineuresFigees: true })).toMatch(/périmé/)
  })
})
