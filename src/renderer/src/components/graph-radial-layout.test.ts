import { describe, expect, it } from 'vitest'
import {
  boundingRadius,
  DEFAULT_RING_FAMILIES,
  familyOf,
  layoutRadial,
  pathSegments,
  relativePathOf,
  rowCapacity,
  sortThemeOf
} from './graph-radial-layout'
import type { GraphNode } from './graph-view-model'

const node = (id: string, themes?: string[]): GraphNode => ({
  id,
  label: id,
  group: 0,
  file: `\\\\ged2\\rig\\Projets IA\\Amitel Brain\\${id.replace(/\//g, '\\')}.md`,
  ...(themes ? { themes } : {})
})

/**
 * Réplique de la DISTRIBUTION RÉELLE du brain Amitel, mesurée le 2026-08-04 (530 fiches), AVEC les
 * chemins UNC absolus que l'app fournit vraiment et des thèmes multiples comme en production.
 *
 * La v1 était testée sur 5 nœuds jouets aux chemins relatifs : aucun de ses tests ne pouvait révéler
 * ni l'écrasement, ni le fait que `file` est absolu. Un test de layout doit tourner sur la forme réelle
 * des données, sinon il valide une géométrie sur un cas qui n'arrive jamais.
 */
function realBrainShape(): GraphNode[] {
  const nodes: GraphNode[] = []
  const themes = ['theme/rig', 'theme/architecture', 'theme/ia', 'theme/donnees', 'theme/operations']
  const push = (count: number, path: (i: number) => string): void => {
    for (let i = 0; i < count; i++) nodes.push(node(path(i), [themes[i % themes.length]]))
  }
  push(5, (i) => `racine-${i}`)
  push(11, (i) => `governance/g${i}`)
  push(345, (i) => `knowledge/domain/rigapplication-documentation/sub/n${i}`)
  push(21, (i) => `knowledge/domain/d${i}`)
  push(11, (i) => `knowledge/_maps/m${i}`)
  push(16, (i) => `knowledge/autres/a${i}`)
  push(100, (i) => `projects/p${i}/graphify-out/g`)
  push(20, (i) => `tooling/t${i}`)
  push(1, () => 'integrations/i')
  push(17, (i) => `inbox/in${i}`)
  push(3, (i) => `.trash/x${i}`)
  return nodes
}

describe('chemins — la forme RÉELLE que l’app fournit', () => {
  it('gère les DEUX séparateurs', () => {
    expect(pathSegments('knowledge\\domain\\x.md')).toEqual(['knowledge', 'domain', 'x.md'])
    expect(pathSegments('knowledge/domain\\x.md')).toEqual(['knowledge', 'domain', 'x.md'])
  })

  it('résiste au chemin UNC ABSOLU — la cause de la vue VIDE en v2', () => {
    // Relevé dans l'app : `file` est absolu, donc son 1ᵉʳ segment vaut `ged2` (le SERVEUR) pour TOUS
    // les nœuds → une seule famille, tout empilé. `id` porte le chemin relatif propre.
    const real = {
      id: 'knowledge/_maps/rig-architecture-applicative',
      file: '\\\\ged2\\rig\\Projets IA\\Amitel Brain\\knowledge\\_maps\\rig-architecture-applicative.md'
    }
    expect(relativePathOf(real)).toBe('knowledge/_maps/rig-architecture-applicative')
    expect(familyOf(real)).toBe('knowledge')
    expect(familyOf(real)).not.toBe('ged2')
    // Sans id exploitable (cas graphify) : on retrouve l'ancre dans le chemin absolu.
    expect(familyOf({ id: 'SymbolName', file: 'C:\\x\\Brain\\projects\\a\\g.md' })).toBe('projects')
  })

  it('prend le thème AU SENS DE L’APP, celui qui décide déjà la couleur', () => {
    // Une variante locale de « thème » ferait diverger couleur et position : un point coloré d'un thème
    // et rangé dans l'arc d'un autre.
    expect(sortThemeOf(node('knowledge/a', ['theme/rig']))).toBe('theme/rig')
    expect(sortThemeOf({ id: 'x', label: 'x', group: 7 })).toBe('community/7')
  })
})

describe('LISIBILITÉ — les invariants dont l’absence a laissé passer deux versions illisibles', () => {
  const { dots, bands } = layoutRadial(realBrainShape())

  it('place CHAQUE fiche non exclue, une seule fois, sans en agréger aucune', () => {
    const expected = realBrainShape().filter((n) => familyOf(n) !== '.trash').length
    expect(dots).toHaveLength(expected)
    expect(new Set(dots.map((d) => d.id)).size).toBe(expected)
  })

  it('respecte l’écart minimal entre deux points d’une même rangée', () => {
    // Le garde-fou de lisibilité : c'est lui qui décide du nombre de rangées d'une bande. Sans lui, une
    // bande dense sature une couronne unique et redevient un amas.
    const byRow = new Map<string, RadialPoint[]>()
    type RadialPoint = { fx: number; fy: number }
    for (const dot of dots) {
      const key = `${dot.ring}#${dot.row}`
      byRow.set(key, [...(byRow.get(key) ?? []), dot])
    }
    for (const [, row] of byRow) {
      if (row.length < 2) continue
      const radius = Math.hypot(row[0].fx, row[0].fy)
      const spacing = (2 * Math.PI * radius) / row.length
      expect(spacing).toBeGreaterThanOrEqual(26 - 1e-6)
    }
  })

  it('n’empile RIEN au centre — le bug certain de la v1', () => {
    for (const dot of dots) expect(Math.hypot(dot.fx, dot.fy)).toBeGreaterThan(0)
  })

  it('donne plusieurs RANGÉES à la bande dense, au lieu de saturer une couronne', () => {
    const knowledge = bands.find((b) => b.family === 'knowledge')!
    expect(knowledge.notes).toBe(393)
    expect(knowledge.rows).toBeGreaterThan(1)
    expect(knowledge.outerRadius).toBeGreaterThan(knowledge.innerRadius)
  })

  it('ne laisse JAMAIS deux bandes se chevaucher', () => {
    // Un chevauchement rendrait les frontières de famille — la structure même de la vue — indéchiffrables.
    const sorted = [...bands].sort((a, b) => a.ring - b.ring)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].innerRadius).toBeGreaterThan(sorted[i - 1].outerRadius)
    }
  })

  it('regroupe les mêmes thèmes en ARCS CONTIGUS dans une bande', () => {
    // C'est ce qui produit les secteurs colorés de la référence : les couleurs ne sont pas recalculées,
    // c'est l'ORDRE des points qui les rassemble.
    const shape = realBrainShape()
    const themeById = new Map(shape.map((n) => [String(n.id), sortThemeOf(n)]))
    const row0 = dots
      .filter((d) => d.family === 'knowledge' && d.row === 0)
      .map((d) => themeById.get(d.id)!)
    const blocks = row0.filter((theme, i) => i === 0 || theme !== row0[i - 1]).length
    // Un bloc par thème présent dans la rangée, jamais un thème éclaté en morceaux.
    expect(blocks).toBe(new Set(row0).size)
  })

  it('décale les rangées voisines d’un demi-pas — sinon la bande se lit en rayons de roue', () => {
    const r0 = dots.filter((d) => d.family === 'knowledge' && d.row === 0)
    const r1 = dots.filter((d) => d.family === 'knowledge' && d.row === 1)
    expect(r0.length).toBeGreaterThan(0)
    expect(r1.length).toBeGreaterThan(0)
    const a0 = Math.atan2(r0[0].fy, r0[0].fx)
    const a1 = Math.atan2(r1[0].fy, r1[0].fx)
    expect(Math.abs(a0 - a1)).toBeGreaterThan(1e-9)
  })
})

describe('bandes, ordre et déterminisme', () => {
  it('écarte la corbeille', () => {
    const { dots } = layoutRadial(realBrainShape())
    expect(dots.some((d) => d.family === '.trash')).toBe(false)
  })

  it('respecte l’ordre SÉMANTIQUE des familles, du centre vers l’extérieur', () => {
    const { bands } = layoutRadial(realBrainShape())
    expect(bands.map((b) => b.family)).toEqual([...DEFAULT_RING_FAMILIES])
  })

  it('expose de quoi DESSINER chaque bande : rayons et point d’étiquette', () => {
    // La v2 calculait ces rayons et ne dessinait rien : 0 étiquette sur 30 à l'écran.
    const { bands } = layoutRadial(realBrainShape())
    for (const band of bands) {
      expect(band.labelRadius).toBeGreaterThanOrEqual(band.innerRadius)
      expect(band.labelRadius).toBeLessThanOrEqual(band.outerRadius)
      expect(band.notes).toBeGreaterThan(0)
    }
  })

  it('adapte la capacité d’une rangée à son rayon', () => {
    expect(rowCapacity(100, 26)).toBeLessThan(rowCapacity(1000, 26))
    expect(rowCapacity(1, 26)).toBe(1) // jamais zéro : une rangée accueille au moins un point
  })

  it('est DÉTERMINISTE', () => {
    expect(layoutRadial(realBrainShape())).toEqual(layoutRadial(realBrainShape()))
  })

  it('expose un rayon englobant non nul pour le cadrage caméra', () => {
    expect(boundingRadius(layoutRadial(realBrainShape()).dots)).toBeGreaterThan(0)
  })
})
