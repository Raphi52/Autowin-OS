import { describe, expect, it } from 'vitest'
import type { RadialBand } from './graph-radial-layout'
import {
  DRILL_ROOT,
  REPO_CATEGORY_ORDER,
  bandAtRadius,
  categoryOfNote,
  drillBack,
  drillInto,
  drillTrail,
  radiusOf,
  summarizeRepo
} from './graph-drill'

const band = (ring: number, family: string, inner: number, outer: number): RadialBand => ({
  ring,
  family,
  innerRadius: inner,
  outerRadius: outer,
  labelRadius: (inner + outer) / 2,
  notes: 0,
  rows: 1
})

/** Trois bandes contiguës, comme le layout les produit. */
const BANDS = [
  band(0, '<racine>', 100, 180),
  band(1, 'governance', 200, 280),
  band(2, 'projects', 300, 420)
]

describe('clic → couronne', () => {
  it('trouve la bande qui contient le rayon', () => {
    expect(bandAtRadius(BANDS, 140)?.family).toBe('<racine>')
    expect(bandAtRadius(BANDS, 250)?.family).toBe('governance')
    expect(bandAtRadius(BANDS, 400)?.family).toBe('projects')
  })

  it('ne sélectionne RIEN dans le vide central, entre deux bandes, ou au-delà de la dernière', () => {
    // Sans cette réserve, le forage volerait le clic qui sert aujourd'hui à désélectionner.
    expect(bandAtRadius(BANDS, 40)).toBeUndefined()
    expect(bandAtRadius(BANDS, 190)).toBeUndefined()
    expect(bandAtRadius(BANDS, 900)).toBeUndefined()
  })

  it('atteint la bande quand le clic tombe PILE sur son trait', () => {
    expect(bandAtRadius(BANDS, 200)?.family).toBe('governance')
    expect(bandAtRadius(BANDS, 280)?.family).toBe('governance')
  })

  it('refuse un rayon absurde au lieu de choisir au hasard', () => {
    expect(bandAtRadius(BANDS, Number.NaN)).toBeUndefined()
    expect(bandAtRadius(BANDS, -10)).toBeUndefined()
  })

  it('calcule le rayon depuis les coordonnées du plan', () => {
    expect(radiusOf(3, 4)).toBe(5)
    expect(radiusOf(0, 0)).toBe(0)
  })
})

describe('catégories — sur les chemins RÉELS du Brain', () => {
  it('classe les quatre formes réellement observées', () => {
    expect(categoryOfNote('projects/rig-tv/obsidian/areas/treeview.md')).toBe('areas')
    expect(categoryOfNote('projects/rig-tv/obsidian/relations/calls.md')).toBe('relations')
    expect(categoryOfNote('projects/rig-tv/obsidian/rig-tv.md')).toBe('map')
    expect(categoryOfNote('projects/rig-tv/graphify-out/GRAPH_REPORT.md')).toBe('other')
  })

  it('reconnaît les catégories à créer — décisions et leçons', () => {
    expect(categoryOfNote('projects/autowin-os/obsidian/decisions/echelle-rompue.md')).toBe(
      'decisions'
    )
    expect(categoryOfNote('projects/autowin-os/obsidian/lessons/bundle-perime.md')).toBe('lessons')
    // Tolère le pluriel/singulier et l'accent : le nommage réel du Brain mêle les deux langues
    // (dossiers en anglais `inherits`, tags en français `heritage`).
    expect(categoryOfNote('projects/x/obsidian/decision/y.md')).toBe('decisions')
    expect(categoryOfNote('projects/x/obsidian/leçons/y.md')).toBe('lessons')
  })

  it('ne se laisse pas piéger par un segment qui ressemble à une catégorie', () => {
    // `areas` doit être un SEGMENT de chemin, pas un morceau de nom de fichier.
    expect(categoryOfNote('projects/x/obsidian/mes-areas-du-projet.md')).not.toBe('areas')
    expect(categoryOfNote('projects/x/obsidian/decisions-a-prendre.md')).not.toBe('decisions')
  })
})

describe('résumé d’un dépôt', () => {
  /** La forme réelle de `rig-tv` : 15 notes, mesurée sur le partage. */
  const RIG_TV = [
    'projects/rig-tv/obsidian/rig-tv.md',
    ...Array.from({ length: 9 }, (_, i) => `projects/rig-tv/obsidian/areas/zone-${i}.md`),
    'projects/rig-tv/obsidian/relations/calls.md',
    'projects/rig-tv/obsidian/relations/imports.md',
    'projects/rig-tv/obsidian/relations/references.md',
    'projects/rig-tv/obsidian/relations/inherits.md',
    'projects/rig-tv/graphify-out/GRAPH_REPORT.md'
  ]

  it('PARTITIONNE : la somme des comptes égale le nombre de notes', () => {
    const summary = summarizeRepo('rig-tv', RIG_TV)
    expect(summary.total).toBe(15)
    const somme = summary.categories.reduce((s, c) => s + c.count, 0)
    // L'invariant qui compte : aucune note perdue, aucune comptée deux fois.
    expect(somme).toBe(RIG_TV.length)
  })

  it('affiche les Décisions et Leçons MÊME À ZÉRO — c’est l’information utile', () => {
    const summary = summarizeRepo('rig-tv', RIG_TV)
    const parCategorie = new Map(summary.categories.map((c) => [c.category, c.count]))
    expect(parCategorie.get('decisions')).toBe(0)
    expect(parCategorie.get('lessons')).toBe(0)
    // ... et le POURQUOI passe AVANT l'index : l'ordre n'est pas cosmétique.
    expect(summary.categories[0].category).toBe('decisions')
    expect(summary.categories[1].category).toBe('lessons')
  })

  it('masque en revanche une catégorie d’INDEX vide, qui n’apprend rien', () => {
    const sansRelations = summarizeRepo('x', ['projects/x/obsidian/areas/a.md'])
    const categories = sansRelations.categories.map((c) => c.category)
    expect(categories).not.toContain('relations')
    expect(categories).toContain('areas')
    expect(categories).toContain('decisions')
  })

  it('dit qu’un dépôt est vide au lieu de rendre une liste vide — le cas réel d’autowin-os', () => {
    const vide = summarizeRepo('autowin-os', [])
    expect(vide.empty).toBe(true)
    expect(vide.total).toBe(0)
    // Même vide, il annonce ce qui MANQUE.
    expect(vide.categories.map((c) => c.category)).toEqual(['decisions', 'lessons'])
  })

  it('couvre toutes les catégories déclarées, sans en oublier une à l’usage', () => {
    const uneDeChaque = REPO_CATEGORY_ORDER.filter((c) => c !== 'other').map((c) =>
      c === 'map' ? 'projects/x/obsidian/x.md' : `projects/x/obsidian/${c}/n.md`
    )
    const summary = summarizeRepo('x', [...uneDeChaque, 'projects/x/graphify-out/r.md'])
    expect(summary.categories.every((c) => c.count === 1)).toBe(true)
    expect(summary.categories).toHaveLength(REPO_CATEGORY_ORDER.length)
  })
})

describe('navigation — descendre, remonter, se situer', () => {
  it('descend couronne → dépôt → catégorie', () => {
    const crown = drillInto(DRILL_ROOT, { family: 'projects' })
    expect(crown).toEqual({ level: 'crown', family: 'projects' })
    const repo = drillInto(crown, { repo: 'rig-tv' })
    expect(repo).toEqual({ level: 'repo', family: 'projects', repo: 'rig-tv' })
    const cat = drillInto(repo, { category: 'decisions' })
    expect(cat).toEqual({
      level: 'category',
      family: 'projects',
      repo: 'rig-tv',
      category: 'decisions'
    })
  })

  it('ne descend pas sans cible, et ne descend pas au-delà du dernier niveau', () => {
    expect(drillInto(DRILL_ROOT, {})).toEqual(DRILL_ROOT)
    const cat = { level: 'category', family: 'p', repo: 'r', category: 'areas' } as const
    expect(drillInto(cat, { category: 'lessons' })).toEqual(cat)
  })

  it('remonte cran par cran, et reste à la racine sans jamais produire un état invalide', () => {
    const cat = {
      level: 'category',
      family: 'projects',
      repo: 'rig-tv',
      category: 'areas'
    } as const
    const repo = drillBack(cat)
    expect(repo).toEqual({ level: 'repo', family: 'projects', repo: 'rig-tv' })
    const crown = drillBack(repo)
    expect(crown).toEqual({ level: 'crown', family: 'projects' })
    expect(drillBack(crown)).toEqual(DRILL_ROOT)
    expect(drillBack(DRILL_ROOT)).toEqual(DRILL_ROOT)
  })

  it('rend un fil d’Ariane qui grandit avec la profondeur', () => {
    expect(drillTrail(DRILL_ROOT)).toEqual(['Tout'])
    expect(drillTrail({ level: 'crown', family: 'projects' })).toEqual(['Tout', 'projects'])
    expect(drillTrail({ level: 'repo', family: 'projects', repo: 'rig-tv' })).toEqual([
      'Tout',
      'projects',
      'rig-tv'
    ])
    expect(
      drillTrail({ level: 'category', family: 'projects', repo: 'rig-tv', category: 'decisions' })
    ).toEqual(['Tout', 'projects', 'rig-tv', 'Décisions'])
  })

  it('descendre puis remonter ramène EXACTEMENT au point de départ', () => {
    const depart = { level: 'crown', family: 'projects' } as const
    const descendu = drillInto(depart, { repo: 'rig-tv' })
    expect(drillBack(descendu)).toEqual(depart)
  })
})
