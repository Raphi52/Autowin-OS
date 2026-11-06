import { describe, expect, it } from 'vitest'
import type { WorkflowProfile } from './workflow-profiles'
import { buildExport, readImport, suggestedFileName } from './workflow-transfer'

/**
 * Ce que ces tests protègent : un import ne doit JAMAIS faire disparaître un workflow existant, ni
 * faire entrer un profil que la relecture locale aurait refusé, ni écarter quoi que ce soit en
 * silence. Les trois se paient cher et ne se voient qu'après coup.
 */

const existant: WorkflowProfile = { id: 'rigoureux', name: 'Rigoureux' }

describe('exporter', () => {
  it('produit une enveloppe reconnaissable et versionnée', () => {
    const paquet = buildExport([existant], '2026-08-05T12:00:00.000Z')
    expect(paquet.kind).toBe('autowin-workflows')
    expect(paquet.version).toBe(1)
    expect(paquet.profiles).toHaveLength(1)
  })

  it('propose un nom de fichier sans caractère interdit sous Windows', () => {
    const nom = suggestedFileName({ id: 'x', name: 'Rapide: v2/final?' })
    expect(nom).not.toMatch(/[\\/:*?"<>|]/)
    expect(nom.endsWith('.json')).toBe(true)
  })
})

describe('importer', () => {
  it('accepte l’enveloppe d’export', () => {
    const paquet = buildExport([{ id: 'rapide', name: 'Rapide' }], 'peu importe')
    expect(readImport(paquet, []).profiles.map((p) => p.name)).toEqual(['Rapide'])
  })

  it('accepte aussi un profil SEUL — partager un workflow ne doit pas exiger de bricoler le JSON', () => {
    expect(readImport({ id: 'seul', name: 'Seul' }, []).profiles).toHaveLength(1)
  })

  it('un identifiant en collision est RÉ-ATTRIBUÉ : l’existant n’est jamais écrasé', () => {
    const { profiles } = readImport({ id: 'rigoureux', name: 'Rigoureux' }, [existant])
    expect(profiles).toHaveLength(1)
    expect(profiles[0].id).not.toBe('rigoureux')
    expect(profiles[0].name).toBe('Rigoureux (2)')
  })

  it('un profil invalide est ÉCARTÉ et DIT, jamais avalé en silence', () => {
    // Même exigence qu'à la relecture locale : sans identifiant NI nom, un profil n'est ni
    // sélectionnable ni lisible. Assouplir la règle à l'import créerait la divergence que
    // `sanitizeImportedProfile` existe justement pour empêcher.
    const { profiles, rejected } = readImport(
      { profiles: [{ id: 'ok', name: 'Bon' }, { id: '', name: '' }, { name: 'Sans id' }] },
      []
    )
    expect(profiles.map((p) => p.name)).toEqual(['Bon'])
    expect(rejected).toEqual(['entrée sans nom ni identifiant', 'Sans id'])
  })

  it('un contenu illisible ne jette pas — il rend zéro profil et le dit', () => {
    const { profiles, rejected } = readImport('nawak', [])
    expect(profiles).toEqual([])
    expect(rejected).toEqual(['contenu illisible'])
  })

  it('le graphe composé survit à l’aller-retour', () => {
    const avecGraphe: WorkflowProfile = {
      id: 'g',
      name: 'Avec graphe',
      graph: {
        entry: 'frame-1',
        nodes: [
          { id: 'frame-1', phase: 'frame' },
          { id: 'judge-1', phase: 'judge', agents: [{ provider: 'claude', persona: 'gardien' }] }
        ],
        edges: [
          { from: 'frame-1', to: 'judge-1', when: 'always' },
          { from: 'judge-1', to: 'frame-1', when: 'red', maxTraversals: 2 }
        ]
      }
    }
    const aller = JSON.parse(JSON.stringify(buildExport([avecGraphe], 'now')))
    const retour = readImport(aller, []).profiles[0]
    expect(retour.graph?.nodes).toHaveLength(2)
    expect(retour.graph?.edges.find((e) => e.when === 'red')?.maxTraversals).toBe(2)
  })
})
