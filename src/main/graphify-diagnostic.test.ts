import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGraphify, type GraphifyProcessRunner } from './graphify-command'

/**
 * MESURE (conv-1478) : `graphify` a echoue deux fois de suite sur « graphe Graphify invalide :
 * <chemin dans un bureau isole supprime > ». Le CLI sortait a 0, sa sortie etait capturee puis
 * JETEE, et le message ne nommait ni la cause ni les cles reellement presentes. Ces tests exigent
 * que l'echec porte la sortie du CLI et la forme du fichier fautif.
 */
const roots: string[] = []
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'autowin-graphify-diag-'))
  roots.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'index.ts'), 'export const a = 1\n', 'utf8')
  return root
}
function ecrire(root: string, contenu: string): void {
  mkdirSync(join(root, 'graphify-out'), { recursive: true })
  writeFileSync(join(root, 'graphify-out', 'graph.json'), contenu, 'utf8')
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('diagnostic d’un graphe Graphify invalide', () => {
  it('remonte le stderr reel du CLI et les cles trouvees quand nodes/links manquent', async () => {
    const root = workspace()
    const run: GraphifyProcessRunner = async () => {
      ecrire(root, JSON.stringify({ nodes: [], edges: [] }))
      return { stdout: 'Merged 3 chunks', stderr: 'WARNING: refused to shrink graph.json (#479)' }
    }
    const echec = await runGraphify({ workspaceRoot: root }, { run }).catch((e: Error) => e)
    expect(echec).toBeInstanceOf(Error)
    const message = (echec as Error).message
    expect(message).toContain('graphe Graphify invalide')
    expect(message).toContain('refused to shrink graph.json')
    expect(message).toContain('nodes/links absents')
    expect(message).toContain('edges')
  })

  it('nomme le silence du CLI et la taille du fichier quand le JSON est illisible', async () => {
    const root = workspace()
    const run: GraphifyProcessRunner = async () => {
      ecrire(root, '{"nodes": [')
      return { stdout: '', stderr: '' }
    }
    const echec = await runGraphify({ workspaceRoot: root }, { run }).catch((e: Error) => e)
    const message = (echec as Error).message
    expect(message).toContain('JSON illisible')
    expect(message).toContain('octets')
    expect(message).toContain("n'a rien ecrit")
  })
})
