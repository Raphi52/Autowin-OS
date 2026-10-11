import { beforeEach, describe, expect, it } from 'vitest'
import { creerRelanceurTachesDeFond, type TacheRelancee } from './relance-taches-de-fond'
import {
  tacheRelanceeParAutowin,
  tachesDeFondEnCours,
  viderTachesDeFondSuivies
} from '../providers/taches-de-fond-suivies'

/*
 * Le relanceur INSCRIT ce qu'il fait tourner dans le registre lu par `claude.ts` et `commands.ts`.
 * Sans cette inscription, le registre reste vide en production et le tour suivant redit
 * « son résultat est perdu » (conv-253, tour bdfe38d3-5ba5-4693-bad2-f70b39bc845e).
 */

function deps(lotsSurDisque: TacheRelancee[][] = []) {
  let fini = false
  const lots = new Map<string, TacheRelancee[]>(lotsSurDisque.map((l) => [l[0].lot, l]))
  return {
    finir: () => (fini = true),
    deps: {
      lancer: ({ jeton }: { jeton: string }) => ({ journalPath: `/j/${jeton}`, pid: 4242 }),
      codeDeSortie: () => (fini ? 0 : undefined),
      lireSortie: () => 'status: green',
      arreter: () => true,
      conversationOccupee: () => false,
      envoyerTour: async () => undefined,
      magasin: {
        ecrire: (lot: string, taches: TacheRelancee[]) => void lots.set(lot, taches),
        lister: () => [...lots.values()],
        supprimer: (lot: string) => void lots.delete(lot)
      },
      maintenant: () => 1_000,
      intervalleMs: 1
    }
  }
}

beforeEach(() => viderTachesDeFondSuivies())

describe('relance des tâches de fond → registre des tâches suivies', () => {
  it('inscrit la tâche relancée, puis la sort des « en cours » quand son tour de reprise part', async () => {
    const banc = deps()
    let vueEnCours: string[] = []
    const relanceur = creerRelanceurTachesDeFond({
      ...banc.deps,
      attendre: async () => {
        vueEnCours = tachesDeFondEnCours().map((t) => `${t.conversationId}:${t.tache}`)
        banc.finir()
      }
    })
    await relanceur.relancer('conv-253', [
      { id: 'bmaye5d39', commande: 'while true; do sleep 30; done', cwd: 'D:/Autowin' }
    ])
    // Pendant qu'elle tournait, elle était listée « en cours ».
    expect(vueEnCours).toEqual(['conv-253:bmaye5d39'])
    // Rendue : plus « en cours », mais toujours reconnue comme relancée (donc jamais « perdue »).
    expect(tachesDeFondEnCours()).toEqual([])
    expect(tacheRelanceeParAutowin('bmaye5d39')).toBe(true)
  })

  it('réinscrit au démarrage les lots restés sur disque (app fermée pendant la tâche)', async () => {
    const lot: TacheRelancee = {
      lot: '6cb0f6b4-103c-474e-b97d-64c1606b56dd',
      conversationId: 'conv-253',
      id: 'bmaye5d39',
      commande: 'while true; do sleep 30; done',
      cwd: 'D:/Autowin',
      debut: 500,
      journalPath: '/j/x',
      pid: 19976
    }
    const banc = deps([[lot]])
    let vueEnCours: string[] = []
    const relanceur = creerRelanceurTachesDeFond({
      ...banc.deps,
      attendre: async () => {
        vueEnCours = tachesDeFondEnCours().map((t) => t.tache)
        banc.finir()
      }
    })
    await relanceur.reprendreAuDemarrage()
    expect(vueEnCours).toEqual(['bmaye5d39'])
    expect(tacheRelanceeParAutowin('bmaye5d39')).toBe(true)
  })

  it('n’inscrit pas une tâche dont le lancement a échoué', async () => {
    const banc = deps()
    const relanceur = creerRelanceurTachesDeFond({
      ...banc.deps,
      lancer: () => {
        throw new Error('bash introuvable')
      },
      attendre: async () => undefined
    })
    await relanceur.relancer('conv-253', [{ id: 'zzz', commande: 'x', cwd: 'D:/Autowin' }])
    expect(tacheRelanceeParAutowin('zzz')).toBe(false)
  })
})
