/**
 * conv-1115 (2026-10-23) : le gel de la liste des conversations porte ses lignes redessinées et
 * ses déclencheurs. Registre de `rendu-long.ts` : un PASSAGE = les lignes notées entre deux rendus
 * de la vue `chat-liste`, clos par `noterRendu`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  declencheursDeListe,
  detailDeGelPourVue,
  noterDeclencheursListe,
  noterLigneListe,
  noterRendu,
  oublierRendusRecents,
  signalerRenduLong
} from './rendu-long'

type Appel = [number, string | undefined, unknown]
const canal = (vus: Appel[]): { signalerGelRenderer: (...a: unknown[]) => number } => ({
  signalerGelRenderer: (...a: unknown[]) => vus.push(a as Appel)
})

afterEach(oublierRendusRecents)

describe('declencheursDeListe', () => {
  it('nomme les données changées par identité, `montage` au premier rendu, `hors-liste` sinon', () => {
    const convs = [{ id: 'a' }]
    expect(declencheursDeListe(null, { conversations: convs })).toEqual(['montage'])
    expect(
      declencheursDeListe(
        { conversations: convs, 'fil-ouvert': 'a', recherche: '' },
        { conversations: [...convs], 'fil-ouvert': 'b', recherche: '' }
      )
    ).toEqual(['conversations', 'fil-ouvert'])
    expect(
      declencheursDeListe(
        { conversations: convs, recherche: '' },
        { conversations: convs, recherche: '' }
      )
    ).toEqual(['hors-liste'])
  })
})

describe('gel de la liste — détail joint', () => {
  it('le rendu long de la liste emporte SON passage : fils distincts, rendus, déclencheurs', () => {
    // Passage précédent, qui ne doit pas se mêler au rendu mesuré.
    noterLigneListe('vieux')
    noterRendu('chat-liste', 5, 1_000)

    noterDeclencheursListe(['conversations'])
    noterLigneListe('c7')
    noterLigneListe('c7') // la même ligne dans « Récent »
    noterLigneListe('c8')
    noterRendu('chat-liste', 1_500, 2_000)
    const vus: Appel[] = []
    expect(signalerRenduLong('chat-liste', 1_500, 1_000, canal(vus))).toBe(true)
    expect(vus).toEqual([
      [
        1_500,
        'vue-chat-liste',
        { liste: { lignes: 2, rendus: 3, passages: 1, declencheurs: ['conversations'] } }
      ]
    ])
  })

  it('un rendu de 0 ms clôt quand même son passage (ses lignes ne passent pas au suivant)', () => {
    noterLigneListe('a')
    noterRendu('chat-liste', 0, 1_000)
    noterLigneListe('b')
    noterDeclencheursListe(['fil-ouvert'])
    noterRendu('chat-liste', 1_200, 1_100)
    const vus: Appel[] = []
    signalerRenduLong('chat-liste', 1_200, 1_000, canal(vus))
    expect((vus[0]![2] as { liste: { lignes: number } }).liste.lignes).toBe(1)
  })

  it('jumeau : un autre bloc que la liste part sans détail de liste', () => {
    noterLigneListe('a')
    noterRendu('chat-liste', 3, 1_000)
    const vus: Appel[] = []
    signalerRenduLong('chat-saisie', 1_500, 1_000, canal(vus))
    expect(vus).toEqual([[1_500, 'vue-chat-saisie']])
  })
})

describe('detailDeGelPourVue — tâche longue dominée par la liste (main.tsx)', () => {
  it('additionne les passages depuis le DÉBUT de la tâche longue, fenêtre récente comprise', () => {
    // Tâche longue de 12 s finie à t = 20 000 : elle a commencé à 8 000, la fenêtre part de 6 000.
    noterLigneListe('hors-fenetre')
    noterRendu('chat-liste', 10, 5_000)
    for (const id of ['a', 'b', 'c']) noterLigneListe(id)
    noterDeclencheursListe(['conversations'])
    noterRendu('chat-liste', 300, 8_500)
    noterLigneListe('a')
    noterDeclencheursListe(['fil-ouvert', 'conversations'])
    noterRendu('chat-liste', 11_000, 19_900)
    expect(detailDeGelPourVue('chat-liste', 12_000, 20_000)).toEqual({
      liste: {
        lignes: 4,
        rendus: 4,
        passages: 2,
        declencheurs: ['conversations', 'fil-ouvert']
      }
    })
  })

  it('autre vue, ou aucun passage dans la fenêtre ⇒ aucun détail', () => {
    noterRendu('chat-liste', 10, 1_000)
    expect(detailDeGelPourVue('chat-fil', 3_000, 2_000)).toBeUndefined()
    expect(detailDeGelPourVue(undefined, 3_000, 2_000)).toBeUndefined()
    expect(detailDeGelPourVue('chat-liste', 1_000, 60_000)).toBeUndefined()
  })
})
