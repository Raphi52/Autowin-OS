import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lireDuelsParWorkflow } from './arena-duels'

/**
 * LES MESURES EXISTENT DEJA SUR DISQUE.
 *
 * arena-duels.jsonl porte 82 duels horodates avec `dureeMs`, `coutUsd`, `verdict` et `workflow`,
 * mais AUCUN fichier de src/ ne le lisait : la vue qui promet de « comparer » faisait REJOUER
 * l'objectif, donc repayer une mesure deja acquise. Ce lecteur agrege, il ne relance rien.
 */
const ecrire = (lignes: unknown[]): string => {
  const racine = mkdtempSync(join(tmpdir(), 'arena-'))
  writeFileSync(
    join(racine, 'arena-duels.jsonl'),
    lignes.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'),
    'utf8'
  )
  return racine
}

const duel = (workflow: string, dureeMs: number, coutUsd: number, verdict = 'gagnant') => ({
  schema: 'autowin.arena-duel/v1',
  ts: '2026-09-04T12:00:15.263Z',
  tache: 't',
  workflow,
  bras: 'a',
  dureeMs,
  coutUsd,
  verdict
})

describe('lireDuelsParWorkflow', () => {
  it('agrege duree et cout MEDIANS par workflow, et compte les duels', () => {
    const racine = ecrire([
      duel('A pipeline complet', 100, 1),
      duel('A pipeline complet', 300, 3),
      duel('A pipeline complet', 200, 2),
      duel('B mesure d abord', 50, 0.5)
    ])

    const agr = lireDuelsParWorkflow(racine)

    expect(agr['A pipeline complet']).toMatchObject({
      duels: 3,
      dureeMedianeMs: 200,
      coutMedianUsd: 2
    })
    expect(agr['B mesure d abord'].duels).toBe(1)
  })

  it('compte les verdicts par valeur pour ne pas afficher un zero invente', () => {
    const racine = ecrire([
      duel('A', 10, 1, 'gagnant'),
      duel('A', 20, 2, 'perdant'),
      duel('A', 30, 3, 'gagnant')
    ])

    expect(lireDuelsParWorkflow(racine).A.verdicts).toEqual({ gagnant: 2, perdant: 1 })
  })

  it('ignore une ligne corrompue ou sans workflow au lieu de tout perdre', () => {
    const racine = ecrire(['{pas du json', JSON.stringify({ dureeMs: 5 }), duel('A', 10, 1)])

    const agr = lireDuelsParWorkflow(racine)
    expect(Object.keys(agr)).toEqual(['A'])
    expect(agr.A.duels).toBe(1)
  })

  it('rend un agregat vide quand le journal est absent (pas une erreur)', () => {
    const racine = mkdtempSync(join(tmpdir(), 'arena-vide-'))
    expect(lireDuelsParWorkflow(racine)).toEqual({})
  })

  it('ne compte pas une ligne nue (workflow seul, aucune mesure) comme un duel', () => {
    const racine = ecrire([{ workflow: 'A' }, duel('A', 10, 1)])
    expect(lireDuelsParWorkflow(racine).A.duels).toBe(1)
  })
})
