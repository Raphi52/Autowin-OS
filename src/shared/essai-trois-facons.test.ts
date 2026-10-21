import { describe, expect, it } from 'vitest'
import { MARQUE_DEMANDE_DESSAI, nomDeCopieDEssai } from './essai-trois-facons'
import { demandePourLaFacon } from '../renderer/src/components/trois-facons'

/**
 * « ESSAIE 3 FAÇONS » — ce que l'interface et le processus principal doivent lire de la même façon
 * (conv-1038, 2026-10-21). Le nom de la copie (`essai__<fil>-<instant>-<rang>`, posé par
 * `ouvrirCopiesDEssai`) relie les branches d'un même essai ; la marque de la demande sépare le
 * travail de la façon des messages copiés du fil d'origine.
 *
 * Les entrées qui feraient échouer une version fausse : un identifiant de fil qui contient des
 * tirets (`conv-1038`) — une lecture par `split('-')` le couperait ; le texte RÉEL envoyé à une façon
 * (`demandePourLaFacon`) — une marque recopiée à la main dériverait dès qu'on retouche ce texte.
 */
describe('nomDeCopieDEssai', () => {
  it('lit fil, instant et rang, tirets du fil compris, sous Windows comme ailleurs', () => {
    expect(nomDeCopieDEssai('D:\\data\\retours-de-tour\\essai__conv-1038-1700-3')).toEqual({
      fil: 'conv-1038',
      quand: 1700,
      rang: 3
    })
    expect(nomDeCopieDEssai('/data/retours-de-tour/essai__conv-7-12-1/')).toEqual({
      fil: 'conv-7',
      quand: 12,
      rang: 1
    })
  })
  it('refuse une copie de « revenir à ce tour », un rang nul, un nom sans instant', () => {
    expect(nomDeCopieDEssai('D:\\r\\retour__conv-1-1700')).toBeNull()
    expect(nomDeCopieDEssai('D:\\r\\essai__conv-1-1700-0')).toBeNull()
    expect(nomDeCopieDEssai('D:\\r\\essai__conv-1')).toBeNull()
    expect(nomDeCopieDEssai(undefined)).toBeNull()
  })
})

describe('MARQUE_DEMANDE_DESSAI', () => {
  it('reconnaît le texte réellement envoyé à chaque façon, et pas une demande ordinaire', () => {
    for (const rang of [0, 1, 2])
      expect(MARQUE_DEMANDE_DESSAI.test(demandePourLaFacon('fais X', rang, 3))).toBe(true)
    expect(MARQUE_DEMANDE_DESSAI.test('fais X de la façon la plus simple')).toBe(false)
  })
})
