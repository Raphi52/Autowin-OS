import { describe, expect, it } from 'vitest'
import {
  noterRendu,
  oublierRendusRecents,
  signalerRenduLong,
  sousBlocDominant,
  vueDominanteRecente
} from './rendu-long'

/**
 * NOMMER LA VUE QUI GELE — mesure du 2026-09-03 (`gels.jsonl`).
 *
 * 272 s de fenetre morte en `renderer:longtask` sur 70 episodes, aucune ne portant de nom, alors
 * que les dix vues restent montees ensemble. Ces tests verrouillent le contrat de l'instrument :
 * il se tait sous le seuil, il nomme la vue au-dessus, et il ne casse jamais l'interface.
 */
describe('signalerRenduLong', () => {
  it('se tait quand le rendu reste sous le seuil', () => {
    const vus: Array<[number, string | undefined]> = []
    const canal = { signalerGelRenderer: (ms: number, e?: string) => vus.push([ms, e]) }
    expect(signalerRenduLong('chat', 120, 1_000, canal)).toBe(false)
    expect(vus).toEqual([])
  })

  it('NOMME la vue des que le rendu atteint le seuil', () => {
    const vus: Array<[number, string | undefined]> = []
    const canal = { signalerGelRenderer: (ms: number, e?: string) => vus.push([ms, e]) }
    expect(signalerRenduLong('observatory', 1_450.6, 1_000, canal)).toBe(true)
    expect(vus).toEqual([[1451, 'vue-observatory']])
  })

  it('ne casse rien quand le canal est absent ou jette', () => {
    expect(signalerRenduLong('chat', 5_000, 1_000, {})).toBe(false)
    expect(
      signalerRenduLong('chat', 5_000, 1_000, {
        signalerGelRenderer: () => {
          throw new Error('canal coupe')
        }
      })
    ).toBe(false)
  })
})

/**
 * NOMMER UN GEL FAIT DE PLUSIEURS PETITS RENDUS.
 *
 * Le cas courant mesure le 2026-09-03 : 3 s de fenetre morte composees de rendus de 300 ms, dont
 * aucun n’atteint le seuil. Sans cumul recent, la tache longue serait repartie anonyme.
 */
describe('vueDominanteRecente', () => {
  it('accuse la vue qui a le plus rendu, pas celle qui a rendu le plus souvent', () => {
    oublierRendusRecents()
    noterRendu('chat', 40, 1_000)
    noterRendu('chat', 40, 1_100)
    noterRendu('chat', 40, 1_200)
    noterRendu('observatory', 800, 1_300)
    expect(vueDominanteRecente(1_400)).toBe('observatory')
  })

  it('oublie ce qui est trop ancien — une vue qui avait fini n’est pas accusee', () => {
    oublierRendusRecents()
    noterRendu('observatory', 900, 1_000)
    noterRendu('chat', 100, 5_000)
    expect(vueDominanteRecente(5_100)).toBe('chat')
  })

  it('n’invente AUCUN nom quand rien n’a ete mesure', () => {
    oublierRendusRecents()
    expect(vueDominanteRecente(1_000)).toBeUndefined()
    noterRendu('chat', 0, 1_000)
    expect(vueDominanteRecente(1_000)).toBeUndefined()
  })
})

/**
 * LE HARNAIS DANS LA VUE CHAT — 859 gels `vue-chat` (p95 ≈ 10 s) sans dire QUEL bloc de ChatView.
 * Les sous-blocs sont imbriques dans la vue : la vue cumule donc TOUJOURS au moins autant qu'eux.
 * Sans descente, le bloc fautif ne gagnerait jamais et l'etiquette resterait `vue-chat`.
 */
describe('sous-blocs d une vue (harnais ChatView)', () => {
  it('descend vers le sous-bloc qui a le plus rendu dans la vue dominante', () => {
    oublierRendusRecents()
    noterRendu('chat-saisie', 50, 1_000)
    noterRendu('chat-fil', 700, 1_000)
    noterRendu('chat', 800, 1_000)
    expect(vueDominanteRecente(1_100)).toBe('chat-fil')
    expect(sousBlocDominant('chat', 1_100)).toBe('chat-fil')
  })

  it('reste sur la vue quand aucun sous-bloc n a ete mesure', () => {
    oublierRendusRecents()
    noterRendu('chat', 800, 1_000)
    expect(sousBlocDominant('chat', 1_100)).toBe('chat')
  })

  it('le rendu long isole porte le nom du sous-bloc, une seule fois', () => {
    oublierRendusRecents()
    const vus: Array<[number, string | undefined]> = []
    const canal = { signalerGelRenderer: (ms: number, e?: string) => vus.push([ms, e]) }
    noterRendu('chat-fil', 1_900, Date.now())
    signalerRenduLong('chat', 2_000, 1_000, canal)
    expect(vus).toEqual([[2000, 'vue-chat-fil']])
  })
})
