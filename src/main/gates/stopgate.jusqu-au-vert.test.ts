import { describe, expect, it } from 'vitest'
import { arretDeLaReparation } from './stopgate'
import { PREFIXE_TEST_MODIFIE } from '../juge/objections-juge'

// 2026-09-24 : « que ça s'arrête que quand y a plus de défauts ».
describe('reparation jusqu au vert', () => {
  const base = { reparationsAccordees: 2, plafondDur: 4, motifsCourants: ['x'], motifsPrecedents: ['x'] }
  it('le plafond dur n arrete pas un refus qui change', () => {
    expect(
      arretDeLaReparation({ ...base, motifsPrecedents: ['y'], tentative: 50, refusIdentiquesConsecutifs: 0, jusquAuVert: true })
    ).toBeUndefined()
  })
  // 05/11/2026 : 220 refus du contrôle final identiques mot pour mot (une cible citée
  // pour mesurer, prise pour une cible à modifier), ~215 passages de build, ~389 $ ; le frein
  // « même refus répété » existait mais le mode jusqu'au vert sortait avant lui.
  const refusConv1613 = [
    "Échec déjà déclaré : ce travail s'est lui-même terminé en échec, ce contrôle ne fait que le relayer.",
    'Promis mais pas fait : « Cible nommee dans la demande reellement modifiee : autowinos/src/main/agent-pilot/message-du-tour.ts »'
  ]
  it('le meme refus repete arrete la reparation, meme jusqu au vert', () => {
    expect(
      arretDeLaReparation({
        ...base,
        motifsCourants: refusConv1613,
        motifsPrecedents: refusConv1613,
        tentative: 50,
        refusIdentiquesConsecutifs: 9,
        jusquAuVert: true
      })
    ).toMatch(/même refus est revenu 11 fois .*jusqu'au vert/)
  })
  // Choix utilisateur : la 3e apparition d'affilée arrête. Le compteur transmis par la
  // boucle ne compte pas encore le refus courant (0 au 2e refus identique, 1 au 3e).
  it('jusqu au vert : le 2e refus identique continue, le 3e arrete', () => {
    const entree = { ...base, motifsCourants: refusConv1613, motifsPrecedents: refusConv1613, tentative: 3, jusquAuVert: true }
    expect(arretDeLaReparation({ ...entree, refusIdentiquesConsecutifs: 0 })).toBeUndefined()
    expect(arretDeLaReparation({ ...entree, refusIdentiquesConsecutifs: 1 })).toMatch(/revenu 3 fois de suite/)
  })
  it('sans le mode, le plafond dur mord toujours', () => {
    expect(arretDeLaReparation({ ...base, tentative: 4 })).toMatch(/plafond dur/)
  })
  it('un code perime arrete encore : aucune reparation ne peut changer le verdict', () => {
    const bundlePerime = { bundleMs: 1, sourceMs: 2, bundle: 'out/main/index.js' }
    expect(arretDeLaReparation({ ...base, tentative: 1, jusquAuVert: true, bundlePerime })).toMatch(/périmé/)
  })
  // ~107 passages sur 109 apres validation, memes reserves MINEUR a chaque tour.
  it('memes reserves mineures deux passages de suite : arret nomme, meme jusqu au vert', () => {
    expect(arretDeLaReparation({ ...base, tentative: 3, jusquAuVert: true, reservesMineuresFigees: true })).toMatch(/mêmes réserves mineures/)
  })
  it('reserves mineures qui bougent : on continue jusqu au vert', () => {
    expect(arretDeLaReparation({ ...base, tentative: 3, jusquAuVert: true, reservesMineuresFigees: false })).toBeUndefined()
  })
  // juge independant, MINEUR « refus sans fin » : un fichier TEST: jamais restaure a
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
  it('jumeau : un autre refus qui revient pour la 2e fois continue jusqu au vert', () => {
    expect(arretDeLaReparation({ ...base, tentative: 3, refusIdentiquesConsecutifs: 0, jusquAuVert: true })).toBeUndefined()
  })
  it('le code perime reste prioritaire', () => {
    const bundlePerime = { bundleMs: 1, sourceMs: 2, bundle: 'out/main/index.js' }
    expect(arretDeLaReparation({ ...base, tentative: 1, jusquAuVert: true, bundlePerime, reservesMineuresFigees: true })).toMatch(/périmé/)
  })
})
