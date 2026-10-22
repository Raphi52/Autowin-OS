/**
 * LES LOTS DU WORKFLOW INTELLIGENT DANS LA MÉMOIRE DU SCOUT (conv-1080, 2026-10-22).
 *
 * Le panneau des candidats découpe une sélection en lots, un message par lot. La mémoire du scout lit
 * chaque message (`noterChoixScout`) : sans la règle des lots, le lot 2 marquait « laissee » les
 * pistes prises par le lot 1 et effaçait le run qui les avait traitées. Elle note aussi la VOIE de
 * chaque piste prise, pour mesurer ce que chaque voie livre (`bilanDesVoies`).
 *
 * Chaîne RÉELLE de bout en bout : tableau du scout → candidats du panneau → plan → messages des lots.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseScoutTable } from '../shared/scout-table'
import {
  candidatsDepuisScoutTable,
  planDeLancement,
  redigerPromptsDuPlan
} from '../renderer/src/components/veille-candidats-message'
import {
  bilanDesChoix,
  bilanDesVoies,
  lireMemoireScout,
  noterChoixScout,
  noterPistesScout,
  type ClasseResultatRun
} from './scout-memoire'

const TABLEAU = [
  '| # | Score | Type | What | Why | How |',
  '|---|---|---|---|---|---|',
  '| 1 | 70 | 🔧 fix | Écriture du cache | perdue au redémarrage | Écrire avant de quitter, src/a.ts:12 |',
  '| 2 | 60 | 🆕 new | Vue des coûts | relus à la main | Ajouter une vue dédiée |',
  '| 3 | 50 | 🔧 fix | Tri instable | ordre change | Trier par date, src/b.ts:40 |',
  '| 4 | 40 | 🆕 new | Export CSV | demandé | Nouveau module d’export |',
  '| 5 | 30 | 🔧 fix | Logs bavards | bruit | Baisser le niveau, src/c.ts:7 |'
].join('\n')

const DEPOT = 'D:/AutoWinOS'

/** Le panneau : toutes les lignes sauf la 5ᵉ cochées, puis les messages de chaque lot. */
function messagesDesLots(): string[] {
  const candidats = candidatsDepuisScoutTable(parseScoutTable(TABLEAU)!)
  return redigerPromptsDuPlan(planDeLancement(candidats.slice(0, 4)))
}

function memoireApresLesLots(): string {
  const chemin = join(mkdtempSync(join(tmpdir(), 'autowin-lots-')), 'scout-pistes.json')
  noterPistesScout({
    depot: DEPOT,
    texte: TABLEAU,
    run: 'scout-1',
    maintenant: '2026-10-22T10:00:00Z',
    chemin
  })
  messagesDesLots().forEach((demande, rang) =>
    noterChoixScout({
      depot: DEPOT,
      demande,
      run: `lot-${rang + 1}`,
      maintenant: `2026-10-22T1${rang + 1}:00:00Z`,
      chemin
    })
  )
  return chemin
}

describe('lots du workflow intelligent → mémoire du scout', () => {
  it('le plan réel fait deux lots : les corrections localisées, puis les ajouts', () => {
    const [direct, complet] = messagesDesLots()
    expect(direct!.split('\n')[0]).toBe('/build')
    expect(direct).toContain('Écriture du cache')
    expect(direct).toContain('Tri instable')
    expect(complet).toContain('Vue des coûts')
    expect(complet).toContain('Export CSV')
  })

  it('le lot 2 ne défait pas le lot 1 : chaque piste garde le run qui l’a traitée et sa voie', () => {
    const chemin = memoireApresLesLots()
    const etat = Object.fromEntries(
      lireMemoireScout(chemin).entrees.map((e) => [e.titre, [e.choix, e.traitePar, e.voie]])
    )
    expect(etat).toEqual({
      'Écriture du cache': ['prise', 'lot-1', 'directe'],
      'Vue des coûts': ['prise', 'lot-2', 'complete'],
      'Tri instable': ['prise', 'lot-1', 'directe'],
      'Export CSV': ['prise', 'lot-2', 'complete'],
      'Logs bavards': ['laissee', undefined, undefined]
    })
  })

  it('une NOUVELLE sélection (lot 1 ou sans lot) remet le scout à plat, comme avant', () => {
    const chemin = memoireApresLesLots()
    const candidats = candidatsDepuisScoutTable(parseScoutTable(TABLEAU)!)
    const [seul] = redigerPromptsDuPlan(planDeLancement([candidats[4]!]))
    noterChoixScout({
      depot: DEPOT,
      demande: seul!,
      run: 'reprise',
      maintenant: '2026-10-22T15:00:00Z',
      chemin
    })
    const prises = lireMemoireScout(chemin).entrees.filter((e) => e.choix === 'prise')
    expect(prises.map((e) => [e.titre, e.traitePar, e.voie])).toEqual([
      ['Logs bavards', 'reprise', 'directe']
    ])
  })

  it('le bilan par voie compte ce que chaque voie a LIVRÉ, runs finis seulement', () => {
    const chemin = memoireApresLesLots()
    const resultats: Record<string, ClasseResultatRun> = { 'lot-1': 'delivered', 'lot-2': 'defect' }
    const resultatDuRun = (run: string): ClasseResultatRun | undefined => resultats[run]
    expect(bilanDesVoies({ depot: DEPOT, resultatDuRun, chemin })).toEqual({
      directe: { traitees: 2, livrees: 2 },
      complete: { traitees: 2, livrees: 0 }
    })
    expect(bilanDesChoix({ depot: DEPOT, resultatDuRun, chemin })).toContain(
      'par voie : correction directe 2/2 livrées, workflow complet 0/2 livrées'
    )
    // Un run pas encore fini ne compte pas : rien n'est inventé.
    expect(
      bilanDesVoies({ depot: DEPOT, resultatDuRun: () => undefined, chemin }).directe.traitees
    ).toBe(0)
  })
})
