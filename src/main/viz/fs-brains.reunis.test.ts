import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { brainReglageFile } from '../brain-reglage'

/**
 * LES DEUX BRAINS DANS UN SEUL GRAPHE (conv-1262, 2026-10-29, demande utilisateur : « ajoute les
 * ponts et un filtre pour voir que les nodes de l'un ou l'autre dans la vue knowledge »).
 */
const dossiers: string[] = []
const temp = (prefixe: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefixe))
  dossiers.push(d)
  return d
}

const ecrireNote = (racine: string, relatif: string, titre: string, corps = ''): void => {
  const fichier = join(racine, `${relatif}.md`)
  mkdirSync(dirname(fichier), { recursive: true })
  writeFileSync(fichier, `---\ntype: domain\n---\n\n# ${titre}\n\n${corps}\n`, 'utf8')
}

/** Un `.npy` v1 float32 tel que l'écrit `np.save`. */
function npy(lignes: number[][]): Buffer {
  const dim = lignes[0]?.length ?? 0
  let entete = `{'descr': '<f4', 'fortran_order': False, 'shape': (${lignes.length}, ${dim}), }`
  entete += ' '.repeat((64 - ((10 + entete.length + 1) % 64)) % 64) + '\n'
  const tete = Buffer.alloc(10)
  Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]).copy(tete)
  tete.writeUInt16LE(entete.length, 8)
  return Buffer.concat([
    tete,
    Buffer.from(entete, 'latin1'),
    Buffer.from(new Float32Array(lignes.flat()).buffer)
  ])
}

/** L'index tel que l'écrit `brain_index.py` : un vecteur par note, chemins relatifs à la racine. */
const indexer = (racine: string, notes: Array<[relatif: string, vecteur: number[]]>): void => {
  const generation = '20261029T000000Z-abc'
  const dossier = join(racine, 'tooling', 'index', 'generations', generation)
  mkdirSync(dossier, { recursive: true })
  writeFileSync(join(racine, 'tooling', 'index', 'CURRENT'), `${generation}\n`)
  writeFileSync(
    join(dossier, 'manifest.json'),
    JSON.stringify({ embedding_signature: { model: 'm', fastembed: '1' } })
  )
  writeFileSync(
    join(dossier, 'meta.jsonl'),
    notes.map(([relatif]) => JSON.stringify({ path: `${relatif}.md` })).join('\n') + '\n'
  )
  writeFileSync(join(dossier, 'emb.npy'), npy(notes.map(([, vecteur]) => vecteur)))
}

let equipe: string
let perso: string

async function chargerFsBrains(): Promise<typeof import('./fs-brains')> {
  vi.stubEnv('AUTOWIN_BRAIN_ROOT', equipe)
  const appdata = temp('fs-brains-reunis-appdata-')
  vi.stubEnv('APPDATA', appdata)
  const fichier = brainReglageFile({ APPDATA: appdata }, 'perso')
  if (!fichier) throw new Error('chemin du réglage introuvable')
  mkdirSync(dirname(fichier), { recursive: true })
  writeFileSync(fichier, JSON.stringify({ chemin: perso }), 'utf8')
  vi.resetModules()
  const module = await import('./fs-brains')
  ;(await import('../brain-ponts')).oublierIndexEnCache()
  return module
}

beforeEach(() => {
  equipe = temp('fs-brains-reunis-equipe-')
  perso = temp('fs-brains-reunis-perso-')
  // Trois notes d'équipe très reliées entre elles, et une note isolée proche de la note perso.
  ecrireNote(equipe, 'knowledge/a', 'A', '[[b]] [[c]]')
  ecrireNote(equipe, 'knowledge/b', 'B', '[[a]] [[c]]')
  ecrireNote(equipe, 'knowledge/c', 'C', '[[a]] [[b]]')
  ecrireNote(equipe, 'knowledge/typecheck', 'Typage du dépôt')
  ecrireNote(perso, 'knowledge/mes-notes-typage', 'Mes notes sur le typage', '[[velo]]')
  ecrireNote(perso, 'knowledge/velo', 'Vélo du dimanche')
  indexer(equipe, [
    ['knowledge/a', [0, 1, 0]],
    ['knowledge/b', [0, 1, 0.1]],
    ['knowledge/c', [0, 0.9, 0.2]],
    ['knowledge/typecheck', [1, 0, 0.05]]
  ])
  indexer(perso, [
    ['knowledge/mes-notes-typage', [1, 0, 0]],
    ['knowledge/velo', [0, 0, 1]]
  ])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('vue Knowledge — les deux Brains reliés par leurs ponts', () => {
  it('marque les notes perso, préfixe leurs ids et garde les ids d’équipe tels quels', async () => {
    const fs = await chargerFsBrains()
    const graphe = await fs.loadBrainsReunisAsync(equipe, perso)
    const ids = graphe.nodes.map((node) => node.id).sort()
    expect(ids).toEqual([
      'knowledge/a',
      'knowledge/b',
      'knowledge/c',
      'knowledge/typecheck',
      'perso:knowledge/mes-notes-typage',
      'perso:knowledge/velo'
    ])
    expect(graphe.nodes.filter((node) => node.perso).map((node) => node.id)).toEqual([
      'perso:knowledge/mes-notes-typage',
      'perso:knowledge/velo'
    ])
    // Les liens internes du Brain perso suivent le préfixe.
    expect(graphe.links).toContainEqual(
      expect.objectContaining({
        source: 'perso:knowledge/mes-notes-typage',
        target: 'perso:knowledge/velo'
      })
    )
  })

  it('trace un pont de la note perso vers sa voisine d’équipe, et aucun pour une note sans voisine', async () => {
    const fs = await chargerFsBrains()
    const graphe = await fs.loadBrainsReunisAsync(equipe, perso)
    const ponts = graphe.links.filter((link) => link.relation === 'pont')
    expect(ponts.map(({ source, target }) => [source, target])).toEqual([
      ['perso:knowledge/mes-notes-typage', 'knowledge/typecheck']
    ])
    expect(graphe.ponts).toEqual({ nombre: 1 })
  })

  it('sous le plafond d’affichage, garde d’abord les notes perso et la cible de leurs ponts', async () => {
    const fs = await chargerFsBrains()
    const graphe = await fs.loadBrainsReunisAsync(equipe, perso, 3)
    expect(graphe.nodes.map((node) => node.id).sort()).toEqual([
      'knowledge/typecheck',
      'perso:knowledge/mes-notes-typage',
      'perso:knowledge/velo'
    ])
    expect(graphe.totalNodes).toBe(6)
  })

  it('sans index perso : les deux graphes restent montrés, et la vue sait pourquoi il n’y a aucun pont', async () => {
    rmSync(join(perso, 'tooling'), { recursive: true, force: true })
    const fs = await chargerFsBrains()
    const graphe = await fs.loadBrainsReunisAsync(equipe, perso)
    expect(graphe.nodes).toHaveLength(6)
    expect(graphe.ponts).toEqual({ nombre: 0, raison: 'Brain perso pas encore indexé' })
  })

  it('ne mène aucun pont vers une note d’équipe hors du corpus du dossier de travail', async () => {
    const fs = await chargerFsBrains()
    const graphe = await fs.loadBrainsReunisAsync(equipe, perso, 300, ['knowledge/a.md'])
    expect(graphe.links.filter((link) => link.relation === 'pont')).toEqual([])
    expect(graphe.nodes.some((node) => node.id === 'knowledge/typecheck')).toBe(false)
  })

  it('refuse un dossier perso qui n’est pas celui réglé', async () => {
    const fs = await chargerFsBrains()
    const autre = temp('fs-brains-reunis-autre-')
    await expect(fs.loadBrainsReunisAsync(equipe, autre)).rejects.toThrow(
      'brain vault hors périmètre autorisé'
    )
  })
})
