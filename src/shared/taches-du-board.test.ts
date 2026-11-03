import { describe, expect, it } from 'vitest'
import type { DemandeDeLaCarte, StatutDemande } from './carte-des-besoins'
import { cleDeLaFiche, tachesDuBoard } from './taches-du-board'

function demande(
  conversationId: string,
  rang: number,
  debut: number | undefined,
  fiche?: string,
  statut: StatutDemande = 'prouve',
  constat = 'npm test → exit 0'
): DemandeDeLaCarte {
  return {
    conversationId,
    conversationTitre: `fil ${conversationId}`,
    rang,
    messageId: `${conversationId}-m${rang}`,
    titre: `demande ${conversationId} ${rang}`,
    statut,
    constat,
    ...(debut === undefined ? {} : { debut }),
    ...(fiche ? { fiche } : {})
  }
}

const projet = (cle: string, demandes: DemandeDeLaCarte[]) => ({ cle, libelle: cle, demandes })

describe('tachesDuBoard — un post-it par RUN.md léger (conv-1456)', () => {
  it('un fil à deux nouvelles demandes donne deux post-it, la suite reste sur la première', () => {
    const A = 'conv-1/premiere-aaa/RUN.md'
    const B = 'conv-1/seconde-bbb/RUN.md'
    const taches = tachesDuBoard([
      projet('p', [
        demande('conv-1', 0, 100, A),
        demande('conv-1', 2, 200, A),
        demande('conv-1', 4, 300, B)
      ])
    ])
    expect(taches.map((t) => t.cle)).toEqual(['conv-1.seconde-bbb', 'conv-1.premiere-aaa'])
    const [seconde, premiere] = taches
    expect(premiere.demandes.map((d) => d.rang)).toEqual([0, 2])
    expect(premiere.titre).toBe('demande conv-1 0')
    expect(premiere.fiche).toBe(A)
    // Le fil est passé à la seconde : vérifier la première y viserait la mauvaise demande.
    expect(premiere.derniereDuFil).toBe(false)
    expect(seconde.derniereDuFil).toBe(true)
  })

  it('un chantier et ses lots, rangés dans la même fiche, ne font qu’un post-it, dans le projet du chef', () => {
    const chantier = 'conv-2/refonte-ccc/RUN.md'
    const taches = tachesDuBoard([
      projet('autre-dossier', [demande('conv-3', 0, 500, chantier)]),
      projet('depot', [demande('conv-2', 0, 400, chantier)])
    ])
    expect(taches).toHaveLength(1)
    const [tache] = taches
    expect(tache.demandes.map((d) => d.conversationId)).toEqual(['conv-2', 'conv-3'])
    // Le fil de la dernière demande s'ouvre ; le projet reste celui où la fiche est née.
    expect(tache.conversationId).toBe('conv-3')
    expect(tache.projet.cle).toBe('depot')
    expect(tache.derniereActivite).toBe(500)
  })

  it('une demande sans fiche (question, tour en cours) rejoint la tâche qui la précède', () => {
    const C = 'conv-4/tache-ddd/RUN.md'
    const taches = tachesDuBoard([
      projet('p', [demande('conv-4', 0, 100, C), demande('conv-4', 2, 200, undefined, 'en-cours')])
    ])
    expect(taches).toHaveLength(1)
    expect(taches[0].derniere.statut).toBe('en-cours')
    expect(taches[0].derniereDuFil).toBe(true)
  })

  it('un fil plus ancien que les fiches garde son post-it, sous l’id du fil et son titre', () => {
    const taches = tachesDuBoard([
      projet('p', [demande('conv-5', 0, 100), demande('conv-5', 2, 200)])
    ])
    expect(taches).toHaveLength(1)
    expect(taches[0]).toMatchObject({
      cle: 'conv-5',
      titre: 'fil conv-5',
      conversationId: 'conv-5'
    })
    expect(taches[0].fiche).toBeUndefined()
  })

  it('un fil qui a des demandes d’avant les fiches puis une fiche donne deux post-it', () => {
    const D = 'conv-6/neuve-eee/RUN.md'
    const taches = tachesDuBoard([
      projet('p', [demande('conv-6', 0, 100), demande('conv-6', 2, 200, D)])
    ])
    expect(taches.map((t) => t.cle).sort()).toEqual(['conv-6', 'conv-6.neuve-eee'])
  })

  it('une branche recopiée à l’identique ne double pas la demande ; une « façon N/3 » qui a répondu autrement reste', () => {
    const E = 'conv-7/ecran-fff/RUN.md'
    const original = demande('conv-7', 0, 100, E)
    const copie = demande('conv-8', 0, 100, E)
    const facon = demande('conv-9', 0, 100, E, 'refuse', 'tour arrêté avant la fin')
    const taches = tachesDuBoard([
      projet('p', [
        original,
        { ...copie, titre: original.titre },
        { ...facon, titre: original.titre }
      ])
    ])
    expect(taches).toHaveLength(1)
    expect(taches[0].demandes.map((d) => d.conversationId)).toEqual(['conv-7', 'conv-9'])
  })

  it('une demande sans heure garde sa place dans son fil', () => {
    const F = 'conv-10/g-ggg/RUN.md'
    const taches = tachesDuBoard([
      projet('p', [demande('conv-10', 0, 100, F), demande('conv-10', 2, undefined, F)])
    ])
    expect(taches[0].demandes.map((d) => d.rang)).toEqual([0, 2])
    expect(taches[0].derniereActivite).toBe(100)
  })
})

describe('cleDeLaFiche', () => {
  it('rend une clé que la copie du Board accepte pour un état posé à la main', () => {
    const cle = cleDeLaFiche('conv-1441/avais-commence-voir-comment-faire-run-mvzc2mvi/RUN.md')
    expect(cle).toBe('conv-1441.avais-commence-voir-comment-faire-run-mvzc2mvi')
    // Même règle que `etatsManuelsLisibles` (src/main/ipc/carte-des-besoins.ts).
    expect(cle).toMatch(/^[\w.-]{1,80}$/)
  })
})
