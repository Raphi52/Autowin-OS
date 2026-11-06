import { describe, expect, it } from 'vitest'
import {
  bilanDuPlan,
  creerPlan,
  fichiersBloquesParLaBase,
  interrompreAuDemarrage,
  lirePlanDeLots,
  marquerLance,
  messageDeDemandeDeCommit,
  noterFinDeTour,
  relancerLot,
  type PlanDeLots
} from './plan-de-lots'

/*
 * LE LOT QUI ATTEND SA PUBLICATION (2026-11-06) — la partie pure : lire le refus, noter le lot,
 * le garder en vie au redémarrage, et écrire la demande de commit au fil qui bloque.
 */

const ECHEC_BASE =
  'refusé par le contrôle final : intégration locale non terminée ; blocage d’intégration: base-dirty — cause: des fichiers non committés de la base bloquent la publication — fichiers en cause: src/a.ts, src/b.ts ; Commit demande sans identite Git publiee verifiable'

function planLance(): PlanDeLots {
  const lu = lirePlanDeLots({
    titre: 'Coffre',
    parallele: 1,
    plafondTours: 2,
    lots: [
      { titre: 'Injection', demande: '/build injecte', fichiers: ['src/a.ts'] },
      { titre: 'Revue', demande: '/build relis', fichiers: [], apres: [1] }
    ]
  })
  if (!lu.ok) throw new Error(lu.erreur)
  const plan = creerPlan(lu.plan, { id: 'p1', chef: 'conv-1', maintenant: 1, avertissements: [] })
  return marquerLance({ ...plan, statut: 'en-cours' }, 1, 'conv-100', 2)
}

describe('fichiersBloquesParLaBase', () => {
  it('lit les fichiers d’un refus base-dirty, sans le motif qui suit', () => {
    expect(fichiersBloquesParLaBase(ECHEC_BASE)).toEqual(['src/a.ts', 'src/b.ts'])
  })
  it('un autre refus n’est pas un blocage par la base', () => {
    expect(
      fichiersBloquesParLaBase('blocage d’intégration: merge-failed — fichiers en cause: src/a.ts')
    ).toBeUndefined()
    expect(fichiersBloquesParLaBase('le juge a refusé : preuve absente')).toBeUndefined()
  })
  it('un refus base-dirty sans fichier nommé reste reconnu', () => {
    expect(fichiersBloquesParLaBase('blocage d’intégration: base-dirty')).toEqual([])
  })
})

describe('noterFinDeTour sur un refus base-dirty', () => {
  // Le lot 2 attend le lot 1 : sans cet état, le plan tombait en « plafond atteint ».
  it('note « attend sa publication », sans rendre le tour, et le plan reste en cours', () => {
    const note = noterFinDeTour(
      planLance(),
      'conv-100',
      { ok: true, echecOrchestration: ECHEC_BASE },
      3
    )
    expect(note.lot?.etat).toBe('attend-publication')
    expect(note.plan.toursLances).toBe(1)
    expect(note.plan.statut).toBe('en-cours')
    expect(bilanDuPlan(note.plan).texte).toMatch(/attend sa publication/)
  })

  it('un redémarrage n’interrompt pas un plan dont le seul lot attend sa publication', () => {
    const note = noterFinDeTour(
      planLance(),
      'conv-100',
      { ok: true, echecOrchestration: ECHEC_BASE },
      3
    )
    expect(interrompreAuDemarrage(note.plan)).toBe(note.plan)
  })

  it('reste relançable par l’utilisateur : c’est sa sortie si personne ne commite', () => {
    const note = noterFinDeTour(
      planLance(),
      'conv-100',
      { ok: true, echecOrchestration: ECHEC_BASE },
      3
    )
    const r = relancerLot(note.plan, 1)
    expect(r.ok).toBe(true)
  })
})

describe('messageDeDemandeDeCommit', () => {
  it('nomme le lot, les fichiers, le chef, et borne le geste : tes chemins, sans pousser', () => {
    const plan = planLance()
    const texte = messageDeDemandeDeCommit(plan, plan.lots[0], ['src/a.ts', 'src/b.ts'])
    expect(texte).toMatch(/lot 1/)
    expect(texte).toMatch(/src\/a\.ts, src\/b\.ts/)
    expect(texte).toMatch(/conv-1\b/)
    expect(texte).toMatch(/git commit -- /)
    expect(texte).toMatch(/sans pousser/)
    expect(texte).toMatch(/pas terminé/)
    // L'accord se vérifie dans une source que le fil lit lui-même, pas sur la parole du message.
    expect(texte).toMatch(/AGENTS\.md/)
  })
})
