import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_WORKFLOWS } from './workflow-defaults'
import { loadWorkflowProfiles, seedDefaultWorkflows } from './workflow-profiles'
import { skillInstruction } from './skill-pipeline'

/**
 * La skill `salvage` a été supprimée le 2026-10-29 (conv-1252). Le fichier de workflows du poste
 * gardait douze profils dont le dernier nœud était `{ id: 'salvage-1', phase: 'salvage' }` : relu
 * tel quel, ce nœud partait sans aucune consigne (`skillInstruction('salvage')` rend ''). Ces tests
 * prouvent que la relecture le convertit en nœud `git`, arêtes et entrée comprises.
 */
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fichierAvec(profiles: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-salvage-git-'))
  dirs.push(dir)
  const path = join(dir, 'workflow-profiles.json')
  writeFileSync(path, JSON.stringify({ activeId: null, profiles }), 'utf8')
  return path
}

/** Le profil livré tel qu'il était enregistré AVANT la suppression : `git-1` s'appelait `salvage-1`. */
function ancienneVersion(id: string): unknown {
  const livre = DEFAULT_WORKFLOWS.find((p) => p.id === id)!
  const vieux = (s: string): string => (s === 'git-1' ? 'salvage-1' : s)
  return JSON.parse(
    JSON.stringify({
      ...livre,
      graph: {
        ...livre.graph!,
        entry: vieux(livre.graph!.entry),
        nodes: livre.graph!.nodes.map((n) =>
          n.phase === 'git' ? { ...n, id: 'salvage-1', phase: 'salvage' } : n
        ),
        edges: livre.graph!.edges.map((e) => ({ ...e, from: vieux(e.from), to: vieux(e.to) }))
      }
    })
  )
}

describe('un workflow enregistré avec `salvage` est relu avec `git`', () => {
  it('la skill salvage n’existe plus : sans conversion le nœud partirait sans consigne', () => {
    expect(skillInstruction('salvage')).toBe('')
    expect(skillInstruction('git').length).toBeGreaterThan(500)
  })

  it('un profil livré intact redevient EXACTEMENT le profil livré actuel', () => {
    const path = fichierAvec([ancienneVersion('feature')])
    const relu = loadWorkflowProfiles(path).profiles.find((p) => p.id === 'feature')!
    const livre = DEFAULT_WORKFLOWS.find((p) => p.id === 'feature')!
    expect(relu.graph).toEqual(livre.graph)
  })

  it('aucun nœud salvage ne survit au démarrage, sur tout le catalogue enregistré', () => {
    const avecFin = DEFAULT_WORKFLOWS.filter((p) => p.graph?.nodes.some((n) => n.phase === 'git'))
    expect(avecFin.length).toBeGreaterThan(5)
    const path = fichierAvec(avecFin.map((p) => ancienneVersion(p.id)))
    const semes = seedDefaultWorkflows(path)
    for (const profil of semes.profiles) {
      const phases = profil.graph?.nodes.map((n) => n.phase) ?? []
      expect(phases, profil.id).not.toContain('salvage')
    }
    expect(loadWorkflowProfiles(path).profiles.every((p) => p.graph)).toBe(true)
  })

  it('une variante de l’utilisateur garde ses autres nœuds et ses identifiants libres', () => {
    const path = fichierAvec([
      {
        id: 'perso',
        name: 'Perso',
        graph: {
          entry: 'b',
          nodes: [
            { id: 'b', phase: 'build' },
            { id: 'salvage-2', phase: 'salvage' }
          ],
          edges: [{ from: 'b', to: 'salvage-2', when: 'always' }]
        }
      }
    ])
    const relu = loadWorkflowProfiles(path).profiles[0]!
    expect(relu.graph).toEqual({
      entry: 'b',
      nodes: [
        { id: 'b', phase: 'build' },
        { id: 'git-2', phase: 'git' }
      ],
      edges: [{ from: 'b', to: 'git-2', when: 'always' }]
    })
  })
})
