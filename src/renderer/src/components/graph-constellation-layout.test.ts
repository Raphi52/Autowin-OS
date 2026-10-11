import { describe, expect, it } from 'vitest'
import {
  CONSTELLATION,
  RAIL_X,
  constellationEdgePath,
  layoutConstellation,
  type ConstellationInputNode
} from './graph-constellation-layout'

/** Le run de la maquette retenue (conv-234) : demande, copie, build fini, judge en cours, Git. */
const RUN: ConstellationInputNode[] = [
  { id: 'demande', depth: 0 },
  { id: 'copie', parentId: 'demande', depth: 1, durationMs: 2_100 },
  { id: 'build', parentId: 'demande', depth: 1, durationMs: 186_000 },
  { id: 'orch-build', parentId: 'build', depth: 2, durationMs: 182_400 },
  { id: 'judge', parentId: 'demande', depth: 1, running: true },
  { id: 'orch-judge', parentId: 'judge', depth: 2, running: true },
  { id: 'git', parentId: 'demande', depth: 1 }
]

function chevauchements(layout: ReturnType<typeof layoutConstellation>): string[] {
  const fautes: string[] = []
  for (const row of layout.rows) {
    const xs = row.ids.map((id) => layout.nodes.get(id)!.x).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i += 1)
      if (xs[i] - xs[i - 1] < (row.root ? 0 : CONSTELLATION.slotMin) - 0.001)
        fautes.push(`ligne ${row.index} : ${xs[i - 1]} / ${xs[i]}`)
  }
  return fautes
}

describe('placement de la constellation', () => {
  it('pose la demande en haut et ses quatre enfants sur une seule ligne dans 340 px', () => {
    const layout = layoutConstellation(RUN, { width: 340, rootQuote: true })

    expect(layout.rows.map((row) => row.ids)).toEqual([
      ['demande'],
      ['copie', 'build', 'judge', 'git'],
      ['orch-build', 'orch-judge']
    ])
    expect(layout.nodes.get('demande')?.root).toBe(true)
    expect(chevauchements(layout)).toEqual([])
  })

  it('place un enfant unique SOUS son parent', () => {
    const layout = layoutConstellation(RUN, { width: 340 })
    expect(layout.nodes.get('orch-build')?.x).toBeCloseTo(layout.nodes.get('build')!.x, 5)
    expect(layout.nodes.get('orch-judge')?.x).toBeCloseTo(layout.nodes.get('judge')!.x, 5)
  })

  it('fait suivre la taille de la perle à la durée : la plus longue est la plus grosse', () => {
    const layout = layoutConstellation(RUN, { width: 340 })
    const r = (id: string): number => layout.nodes.get(id)!.r
    expect(r('build')).toBe(CONSTELLATION.rayonMax)
    expect(r('copie')).toBeLessThan(r('orch-build'))
    expect(r('git')).toBe(CONSTELLATION.rayonSansDuree)
    expect(r('judge')).toBe(CONSTELLATION.rayonEnCours)
  })

  it('ne déborde jamais du panneau : un niveau trop large passe à la ligne', () => {
    const agents: ConstellationInputNode[] = [
      { id: 'demande', depth: 0 },
      ...Array.from({ length: 500 }, (_, i) => ({
        id: `agent-${i}`,
        parentId: 'demande',
        depth: 1,
        durationMs: 1_000 + i
      }))
    ]
    const layout = layoutConstellation(agents, { width: 340 })
    const capacite = Math.floor((340 - 2 * CONSTELLATION.marge) / CONSTELLATION.slotMin)

    expect(layout.rows.slice(1).every((row) => row.ids.length <= capacite)).toBe(true)
    expect(layout.rows.slice(1).reduce((n, row) => n + row.ids.length, 0)).toBe(500)
    for (const node of layout.nodes.values()) {
      expect(node.x - node.largeur / 2).toBeGreaterThanOrEqual(CONSTELLATION.marge - 0.001)
      expect(node.x + node.largeur / 2).toBeLessThanOrEqual(340 - CONSTELLATION.marge + 0.001)
      expect(node.largeur).toBeGreaterThanOrEqual(CONSTELLATION.slotMin - 0.001)
    }
    expect(chevauchements(layout)).toEqual([])
  })

  it('descend une longue chaîne d’outils ligne par ligne, sans la tasser', () => {
    const chaine: ConstellationInputNode[] = Array.from({ length: 14 }, (_, i) => ({
      id: `n${i}`,
      depth: i,
      ...(i > 0 ? { parentId: `n${i - 1}` } : {})
    }))
    const layout = layoutConstellation(chaine, { width: 340 })
    expect(layout.rows).toHaveLength(14)
    const tops = layout.rows.map((row) => row.top)
    expect(tops).toEqual([...tops].sort((a, b) => a - b))
  })

  it('un nœud dont le parent est absent devient une racine, sans lien inventé', () => {
    const layout = layoutConstellation(
      [
        { id: 'a', depth: 0 },
        { id: 'orphelin', parentId: 'disparu', depth: 2 }
      ],
      { width: 340 }
    )
    expect(layout.nodes.get('orphelin')?.root).toBe(true)
    expect(layout.nodes.get('orphelin')?.parentId).toBeUndefined()
  })

  /**
   * conv-108 (run réel, 2026-10-11) : 9 phases passaient à la ligne sur 3 rangées, et leurs agents
   * étaient posés APRÈS toutes les phases — chaque lien traversait toute la constellation. Chaque
   * rangée de phases est désormais suivie de ses propres agents.
   */
  it('garde les agents juste sous leur phase quand les phases passent à la ligne', () => {
    const run: ConstellationInputNode[] = [{ id: 'plan', depth: 0 }]
    for (let i = 0; i < 9; i += 1)
      run.push(
        { id: `phase-${i}`, parentId: 'plan', depth: 1, durationMs: 1_000 },
        { id: `agent-${i}`, parentId: `phase-${i}`, depth: 2, durationMs: 900 }
      )
    const layout = layoutConstellation(run, { width: 300 })

    expect(
      layout.rows.filter((row) => row.ids.some((id) => id.startsWith('phase-'))).length
    ).toBeGreaterThan(1)
    for (let i = 0; i < 9; i += 1)
      expect(layout.nodes.get(`agent-${i}`)!.row).toBe(layout.nodes.get(`phase-${i}`)!.row + 1)

    // Le plan rejoint ses phases des rangées suivantes par le RAIL de la marge, pas en diagonale.
    const plan = layout.nodes.get('plan')!
    const loin = layout.nodes.get('phase-8')!
    expect(loin.row - plan.row).toBeGreaterThan(1)
    expect(constellationEdgePath(plan, loin)).toContain(`V`)
    expect(constellationEdgePath(plan, loin)).toMatch(new RegExp(`C[\\d.]+ [\\d.]+ ${RAIL_X} `))
    expect(constellationEdgePath(plan, layout.nodes.get('phase-0')!)).not.toContain('V')
    // Un parent à DROITE prend le rail de droite : pas de lien qui balaie tout le panneau.
    const aDroite = { ...plan, x: 260 }
    expect(constellationEdgePath(aDroite, loin, 300)).toMatch(
      new RegExp(`C[\\d.]+ [\\d.]+ ${300 - RAIL_X} `)
    )
  })

  it('le lien part sous le bloc du parent et arrive au-dessus de la perle de l’enfant', () => {
    const layout = layoutConstellation(RUN, { width: 340 })
    const parent = layout.nodes.get('build')!
    const enfant = layout.nodes.get('orch-build')!
    const chemin = constellationEdgePath(parent, enfant)
    const [, sx, sy] = /^M([\d.]+) ([\d.]+)/.exec(chemin) ?? []
    const fin = chemin.split(' ').slice(-2).map(Number)

    expect(Number(sx)).toBeCloseTo(parent.x, 0)
    expect(Number(sy)).toBeGreaterThan(parent.bottom)
    expect(fin[0]).toBeCloseTo(enfant.x, 0)
    expect(fin[1]).toBeLessThan(enfant.cy - enfant.r)
  })
})
