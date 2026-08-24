import { describe, expect, it } from 'vitest'
import {
  messageSansSigneDeVie,
  runsSansSigneDeVie,
  SILENCE_SUSPECT_MS,
  type CandidatSansSigne
} from './run-sans-signe-de-vie'

/**
 * LE DÉFAUT, et c'est l'utilisateur qui l'a vu avant moi le 2026-08-24. Un run restait `working` dans
 * le graphe ; j'ai répondu « ça tourne » sur la foi de ce champ. Il a insisté : « ça tourne là ? on
 * dirait pas ». Mesuré alors — la copie du run n'avait pas bougé d'un octet en 75 secondes, aucun
 * processus enfant, aucun tour de chat actif, aucune trace. Mort depuis six minutes, affiché vivant.
 *
 * CE QUI EXISTAIT NE POUVAIT PAS L'ATTRAPER. `providers/watchdog.ts` détecte très bien l'inactivité
 * d'un FLUX (silence stdout > 5 min). Mais ici il n'y avait aucun processus : rien à surveiller.
 *
 * CES TESTS TIENNENT LES DEUX BORDS, et le second compte autant que le premier : signaler un run
 * réellement muet, et ne JAMAIS accuser un run qui travaille. Un signal qui crie au loup cesse d'être
 * lu, et on serait revenu au point de départ.
 */

const vivant = (): boolean => true
const mort = (): boolean => false

const run = (partiel: Partial<CandidatSansSigne>): CandidatSansSigne => ({
  runId: 'run-1',
  state: 'working',
  derniereVieMs: 0,
  ...partiel
})

describe('un run qui affiche « en cours » sans rien produire', () => {
  it('est signalé passé le seuil de silence', () => {
    const suspects = runsSansSigneDeVie([run({ derniereVieMs: 1_000 })], mort, 1_000 + SILENCE_SUSPECT_MS)

    expect(suspects).toEqual(['run-1'])
  })

  it('n’est PAS signalé si un processus travaille — même après un long silence', () => {
    // Le bord qui compte le plus : c'est exactement ce que le watchdog de flux appelle « long mais
    // progresse ». Le contredire ici rendrait les deux signaux incohérents.
    const suspects = runsSansSigneDeVie([run({ derniereVieMs: 1_000 })], vivant, 1_000 + 10 * SILENCE_SUSPECT_MS)

    expect(suspects).toEqual([])
  })

  it('n’est pas signalé AVANT le seuil — on ne confond pas « réfléchit » et « mort »', () => {
    const suspects = runsSansSigneDeVie(
      [run({ derniereVieMs: 1_000 })],
      mort,
      1_000 + SILENCE_SUSPECT_MS - 1
    )

    expect(suspects).toEqual([])
  })

  it('ne touche pas aux runs qui ne sont pas « en cours »', () => {
    const lot = [
      run({ runId: 'fini', state: 'merged', derniereVieMs: 0 }),
      run({ runId: 'bloque', state: 'blocked', derniereVieMs: 0 }),
      run({ runId: 'pret', state: 'ready', derniereVieMs: 0 })
    ]

    expect(runsSansSigneDeVie(lot, mort, 10 * SILENCE_SUSPECT_MS)).toEqual([])
  })

  it('retombe sur l’heure de DÉMARRAGE quand aucun battement n’a été enregistré', () => {
    // Sans ce repli, un run hérité d'une session antérieure ne serait jamais signalé — donc les cas
    // les plus anciens, et les plus suspects, passeraient à travers.
    const suspects = runsSansSigneDeVie(
      [{ runId: 'ancien', state: 'working', startedAtMs: 1_000 }],
      mort,
      1_000 + SILENCE_SUSPECT_MS
    )

    expect(suspects).toEqual(['ancien'])
  })

  it('ne signale rien sans aucun repère temporel — on n’invente pas une durée', () => {
    expect(runsSansSigneDeVie([{ runId: 'sans-date', state: 'working' }], mort, 10 ** 12)).toEqual([])
  })

  it('une horloge qui RECULE ne transforme pas un run sain en suspect', () => {
    const suspects = runsSansSigneDeVie([run({ derniereVieMs: 9_000_000 })], mort, 1_000)

    expect(suspects).toEqual([])
  })

  it('trie le lot : seul le muet sort', () => {
    const lot = [
      run({ runId: 'muet', derniereVieMs: 1_000 }),
      run({ runId: 'occupe', derniereVieMs: 1_000 }),
      run({ runId: 'fini', state: 'merged', derniereVieMs: 1_000 })
    ]

    const suspects = runsSansSigneDeVie(
      lot,
      (id) => id === 'occupe',
      1_000 + SILENCE_SUSPECT_MS
    )

    expect(suspects).toEqual(['muet'])
  })
})

describe('le message porté à l’utilisateur', () => {
  it('DIT la durée : six minutes sur une compilation n’est rien, six minutes sur une ligne est un mur', () => {
    expect(messageSansSigneDeVie(5 * 60_000)).toMatch(/5 min/)
  })

  it('énonce un fait et propose une sortie, au lieu de juger', () => {
    const m = messageSansSigneDeVie(SILENCE_SUSPECT_MS)

    expect(m).toMatch(/aucun processus actif/i)
    expect(m).toMatch(/Relance|annule/i)
    // L'entrée qui doit faire échouer un message qui conclurait à la mort : ce module ne le sait pas.
    expect(m).not.toMatch(/\bmort\b|\bplant/i)
  })
})
