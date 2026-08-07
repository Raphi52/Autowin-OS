import { describe, expect, it } from 'vitest'
import { layoutTree, pickVisibleLabels, treeBoundingRadius } from './graph-tree-layout'
import type { GraphNode } from './graph-view-model'

const RACINE_UNC = '//ged2/rig/Projets IA/Amitel Brain/'

/** Fabrique une fiche avec un chemin réaliste — le chemin EST la lignée, donc il porte tout le test. */
function fiche(chemin: string): GraphNode {
  return {
    id: chemin,
    label: chemin.split('/').pop() ?? chemin,
    group: 1,
    file: RACINE_UNC + chemin
  }
}

const VAULT = [
  fiche('projects/rig-tv/obsidian/areas/import.md'),
  fiche('projects/rig-tv/obsidian/areas/export.md'),
  fiche('projects/rig-tv/obsidian/relations/calls.md'),
  fiche('projects/autowin-os/obsidian/autowin-os.md'),
  fiche('knowledge/decisions/curation.md'),
  fiche('knowledge/lessons/smb.md'),
  fiche('governance/NOTE-SCHEMA-v1.md')
]

describe('arborescence radiale — les invariants que la vue doit tenir', () => {
  it('un anneau est une PROFONDEUR : tous les nœuds d’un anneau ont le même nombre de segments', () => {
    const { nodes } = layoutTree(VAULT)
    const parRayon = new Map<number, Set<number>>()
    for (const n of nodes) {
      if (!parRayon.has(n.radius)) parRayon.set(n.radius, new Set())
      parRayon.get(n.radius)?.add(n.depth)
    }
    // C'est LE changement demandé : le rayon ne dit plus la famille, il dit la profondeur.
    for (const profondeurs of parRayon.values()) expect(profondeurs.size).toBe(1)
  })

  it('l’arbre est CONNEXE : tout nœud non-racine a un parent qui existe', () => {
    const { nodes } = layoutTree(VAULT)
    const ids = new Set(nodes.map((n) => n.id))
    const racines = nodes.filter((n) => n.parentId === null)
    expect(racines).toHaveLength(1)
    for (const n of nodes) {
      if (n.parentId === null) continue
      expect(ids.has(n.parentId)).toBe(true)
    }
  })

  it('PARTITION : chaque fiche apparaît exactement une fois comme feuille', () => {
    const { nodes } = layoutTree(VAULT)
    const feuilles = nodes.filter((n) => n.isLeaf)
    expect(feuilles).toHaveLength(VAULT.length)
    const notes = feuilles.map((f) => f.noteId).sort()
    expect(notes).toEqual(VAULT.map((n) => n.id).sort())
  })

  it('un parent est CONTENU dans le secteur de ses enfants — il ne flotte pas hors de sa branche', () => {
    const { nodes } = layoutTree(VAULT)
    const parId = new Map(nodes.map((n) => [n.id, n]))
    for (const n of nodes) {
      const enfants = nodes.filter((e) => e.parentId === n.id)
      if (enfants.length === 0) continue
      const angles = enfants.map((e) => e.angle)
      const noeud = parId.get(n.id)
      expect(noeud).toBeDefined()
      expect(noeud!.angle).toBeGreaterThanOrEqual(Math.min(...angles) - 1e-9)
      expect(noeud!.angle).toBeLessThanOrEqual(Math.max(...angles) + 1e-9)
    }
  })

  it('les feuilles ne se recouvrent JAMAIS : le pas angulaire est constant et non nul', () => {
    const { nodes } = layoutTree(VAULT)
    const angles = nodes
      .filter((n) => n.isLeaf)
      .map((n) => n.angle)
      .sort((a, b) => a - b)
    const ecarts = angles.slice(1).map((a, i) => a - angles[i])
    for (const e of ecarts) expect(e).toBeCloseTo((Math.PI * 2) / VAULT.length, 9)
  })

  it('tient la densité RÉELLE demandée — 564 feuilles, aucune superposition', () => {
    // L'utilisateur a choisi l'arbre COMPLET jusqu'à la note : c'est cette densité qu'il faut tenir.
    const masse = Array.from({ length: 564 }, (_, i) =>
      fiche('projects/depot' + (i % 12) + '/obsidian/note' + i + '.md')
    )
    const { nodes } = layoutTree(masse)
    const feuilles = nodes.filter((n) => n.isLeaf)
    expect(feuilles).toHaveLength(564)
    const angles = new Set(feuilles.map((f) => f.angle.toFixed(9)))
    expect(angles.size).toBe(564)
  })

  it('une fiche SANS chemin exploitable est rattachée à la racine, jamais perdue', () => {
    const orpheline: GraphNode = { id: 'sans-fichier', label: 'sans-fichier', group: 1 }
    const { nodes } = layoutTree([...VAULT, orpheline])
    const feuilles = nodes.filter((n) => n.isLeaf)
    expect(feuilles).toHaveLength(VAULT.length + 1)
    expect(feuilles.some((f) => f.noteId === 'sans-fichier')).toBe(true)
  })

  it('la corbeille est écartée, et son exclusion ne décale pas les autres', () => {
    const avec = [...VAULT, fiche('.trash/vieux.md')]
    const { nodes } = layoutTree(avec)
    expect(nodes.some((n) => n.id.startsWith('.trash'))).toBe(false)
    expect(nodes.filter((n) => n.isLeaf)).toHaveLength(VAULT.length)
  })

  it('les anneaux sont régulièrement espacés, et il y en a un par niveau', () => {
    const { ringRadii, maxDepth } = layoutTree(VAULT, { ringGap: 100 })
    expect(ringRadii).toHaveLength(maxDepth + 1)
    expect(ringRadii[0]).toBe(0)
    ringRadii.slice(1).forEach((r, i) => expect(r - ringRadii[i]).toBe(100))
  })

  it('le rayon de cadrage vaut l’anneau le plus externe — sinon la caméra vise du vide', () => {
    const layout = layoutTree(VAULT, { ringGap: 100 })
    expect(treeBoundingRadius(layout)).toBe(layout.ringRadii[layout.maxDepth])
  })

  it('chaque branche relie un parent à un enfant RÉELLEMENT présent', () => {
    const { nodes, edges } = layoutTree(VAULT)
    const ids = new Set(nodes.map((n) => n.id))
    for (const e of edges) {
      expect(ids.has(e.from)).toBe(true)
      expect(ids.has(e.to)).toBe(true)
    }
    // Un arbre a exactement N-1 arêtes : ni cycle, ni branche manquante.
    expect(edges).toHaveLength(nodes.length - 1)
  })

  it('est DÉTERMINISTE : deux calculs sur la même entrée donnent le même dessin', () => {
    const a = layoutTree(VAULT)
    const b = layoutTree(VAULT)
    expect(a.nodes.map((n) => [n.id, n.fx, n.fy])).toEqual(b.nodes.map((n) => [n.id, n.fx, n.fy]))
  })

  it('le vault vide ne jette pas', () => {
    const { nodes, edges, maxDepth } = layoutTree([])
    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(0)
    expect(maxDepth).toBe(0)
  })
})

describe('le barycentre est PONDÉRÉ — l’invariant qu’une moyenne simple ne tiendrait pas', () => {
  it('un parent penche vers sa branche LOURDE, pas au milieu de ses deux branches', () => {
    // Une branche à 10 feuilles, une à 1. Une moyenne SIMPLE des angles d'enfants poserait le parent
    // à mi-chemin, et la branche épaisse partirait visiblement de travers.
    const masse = [
      ...Array.from({ length: 10 }, (_, i) => fiche('racine/lourde/n' + i + '.md')),
      fiche('racine/legere/seule.md')
    ]
    const { nodes } = layoutTree(masse)
    const parent = nodes.find((n) => n.id === 'racine')
    const lourde = nodes.find((n) => n.id === 'racine/lourde')
    const legere = nodes.find((n) => n.id === 'racine/legere')
    expect(parent && lourde && legere).toBeTruthy()

    const versLourde = Math.abs(parent!.angle - lourde!.angle)
    const versLegere = Math.abs(parent!.angle - legere!.angle)
    expect(versLourde).toBeLessThan(versLegere)

    // Et il est STRICTEMENT ailleurs que la moyenne simple : c'est ce qui distingue les deux calculs.
    const moyenneSimple = (lourde!.angle + legere!.angle) / 2
    expect(Math.abs(parent!.angle - moyenneSimple)).toBeGreaterThan(1e-6)
  })
})

describe('étiquettes de l’arbre — on garde le plus important, on tait l’autre', () => {
  const et = (x: number, y: number, priority: number) => ({ x, y, width: 100, height: 20, priority })

  it('omet le libellé MOINS important quand deux se recouvrent', () => {
    expect(pickVisibleLabels([et(0, 0, 5), et(10, 5, 50)])).toEqual([false, true])
  })

  it('garde les deux quand ils ne se gênent pas', () => {
    expect(pickVisibleLabels([et(0, 0, 5), et(500, 300, 50)])).toEqual([true, true])
  })

  it('sur une file serrée, garde les plus gros et tait le reste — sans JAMAIS déplacer', () => {
    // C'est le cas mesuré : huit dossiers sous `projects`, tous dans un secteur étroit.
    const file = [et(0, 0, 1), et(0, 8, 100), et(0, 16, 50), et(0, 400, 2)]
    const visibles = pickVisibleLabels(file)
    expect(visibles[1]).toBe(true) // le plus important garde sa place
    expect(visibles[0]).toBe(false)
    expect(visibles[2]).toBe(false)
    expect(visibles[3]).toBe(true) // loin des autres : gardé
  })

  it('départage deux libellés de MÊME importance par leur ordre, de façon déterministe', () => {
    const a = pickVisibleLabels([et(0, 0, 9), et(5, 5, 9)])
    const b = pickVisibleLabels([et(0, 0, 9), et(5, 5, 9)])
    expect(a).toEqual([true, false])
    expect(a).toEqual(b)
  })

  it('supporte le cas dégénéré', () => {
    expect(pickVisibleLabels([])).toEqual([])
    expect(pickVisibleLabels([et(0, 0, 1)])).toEqual([true])
  })
})
