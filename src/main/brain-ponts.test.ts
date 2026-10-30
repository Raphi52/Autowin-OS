import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  calculerPonts,
  lireNpyFloat32,
  oublierIndexEnCache,
  pontsEntreBrains,
  vecteursParNote
} from './brain-ponts'

/**
 * PONTS perso → équipe (conv-1262, 2026-10-29) : relus depuis les index déjà écrits, en mémoire,
 * sans rien écrire côté équipe.
 */

/** Un `.npy` v1 float32 tel que l'écrit `np.save` (en-tête complété à 64 octets). */
function npy(lignes: number[][]): Buffer {
  const dim = lignes[0]?.length ?? 0
  let entete = `{'descr': '<f4', 'fortran_order': False, 'shape': (${lignes.length}, ${dim}), }`
  const total = 10 + entete.length + 1
  entete += ' '.repeat((64 - (total % 64)) % 64) + '\n'
  const tete = Buffer.alloc(10)
  Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]).copy(tete)
  tete.writeUInt16LE(entete.length, 8)
  const corps = Buffer.from(new Float32Array(lignes.flat()).buffer)
  return Buffer.concat([tete, Buffer.from(entete, 'latin1'), corps])
}

const dossiers: string[] = []

function brain(
  notes: Array<[chemin: string, vecteur: number[]]>,
  signature: Record<string, string> = { model: 'm', fastembed: '1' }
): string {
  const racine = mkdtempSync(join(tmpdir(), 'brain-ponts-'))
  dossiers.push(racine)
  const generation = '20261029T000000Z-abc'
  const dossier = join(racine, 'tooling', 'index', 'generations', generation)
  mkdirSync(dossier, { recursive: true })
  writeFileSync(join(racine, 'tooling', 'index', 'CURRENT'), `${generation}\n`)
  writeFileSync(join(dossier, 'manifest.json'), JSON.stringify({ embedding_signature: signature }))
  writeFileSync(
    join(dossier, 'meta.jsonl'),
    notes.map(([path]) => JSON.stringify({ path, chunk_index: 0 })).join('\n') + '\n'
  )
  writeFileSync(join(dossier, 'emb.npy'), npy(notes.map(([, v]) => v)))
  return racine
}

afterEach(() => {
  oublierIndexEnCache()
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true })
})

describe('lireNpyFloat32', () => {
  it('relit la matrice écrite par np.save', () => {
    const matrice = lireNpyFloat32(
      npy([
        [1, 2],
        [3, 4]
      ])
    )
    expect(matrice.lignes).toBe(2)
    expect(matrice.dim).toBe(2)
    expect([...matrice.donnees]).toEqual([1, 2, 3, 4])
  })

  it('refuse un fichier qui n’est pas un .npy float32', () => {
    expect(() => lireNpyFloat32(Buffer.from('pas un npy'))).toThrow(/signature/)
    const float64 = npy([[1]])
    float64.write("'<f8'", float64.indexOf("'<f4'"), 'latin1')
    expect(() => lireNpyFloat32(float64)).toThrow(/float32/)
  })
})

describe('vecteursParNote', () => {
  it('moyenne les morceaux d’une même note puis renormalise', () => {
    const notes = vecteursParNote(['knowledge/a.md', 'knowledge/a.md', 'knowledge/b.md'], {
      lignes: 3,
      dim: 2,
      donnees: new Float32Array([1, 0, 0, 1, 0, 2])
    })
    expect([...notes.keys()]).toEqual(['knowledge/a', 'knowledge/b'])
    const a = notes.get('knowledge/a')!
    expect(a[0]).toBeCloseTo(Math.SQRT1_2)
    expect(a[1]).toBeCloseTo(Math.SQRT1_2)
    expect([...notes.get('knowledge/b')!]).toEqual([0, 1])
  })

  it('refuse un index dont les méta et les vecteurs ne se correspondent pas', () => {
    expect(() =>
      vecteursParNote(['knowledge/a.md'], { lignes: 2, dim: 1, donnees: new Float32Array(2) })
    ).toThrow(/incohérent/)
  })
})

describe('calculerPonts', () => {
  const v = (x: number, y: number): Float32Array => {
    const n = Math.hypot(x, y)
    return new Float32Array([x / n, y / n])
  }
  const equipe = new Map([
    ['knowledge/proche', v(1, 0.1)],
    ['knowledge/moyen', v(1, 0.5)],
    ['knowledge/loin', v(0, 1)]
  ])

  it('garde les voisines d’équipe les plus proches, au-dessus du seuil, de la plus proche à la moins proche', () => {
    const ponts = calculerPonts(new Map([['knowledge/perso', v(1, 0)]]), equipe, {
      parNote: 3,
      similariteMin: 0.8
    })
    expect(ponts.map((pont) => pont.equipe)).toEqual(['knowledge/proche', 'knowledge/moyen'])
    expect(ponts.every((pont) => pont.perso === 'knowledge/perso')).toBe(true)
  })

  it('borne le nombre de ponts par note', () => {
    const ponts = calculerPonts(new Map([['knowledge/perso', v(1, 0)]]), equipe, {
      parNote: 1,
      similariteMin: -1
    })
    expect(ponts.map((pont) => pont.equipe)).toEqual(['knowledge/proche'])
  })

  it('ne relie jamais une note perso sans voisine assez proche', () => {
    expect(
      calculerPonts(new Map([['knowledge/vacances', v(-1, 0)]]), equipe, { similariteMin: 0.65 })
    ).toEqual([])
  })

  it('ne mène jamais vers une note d’équipe hors du corpus montré', () => {
    const ponts = calculerPonts(new Map([['knowledge/perso', v(1, 0)]]), equipe, {
      similariteMin: 0,
      equipeAutorisee: (id) => id !== 'knowledge/proche'
    })
    expect(ponts.map((pont) => pont.equipe)).not.toContain('knowledge/proche')
  })
})

describe('pontsEntreBrains', () => {
  it('relie une note perso à sa voisine d’équipe en relisant les deux index', async () => {
    const perso = brain([['knowledge/mes-notes-typage.md', [1, 0]]])
    const equipe = brain([
      ['knowledge/typecheck.md', [0.99, 0.1]],
      ['knowledge/sans-rapport.md', [0, 1]]
    ])
    const resultat = await pontsEntreBrains(perso, equipe)
    expect(resultat.raison).toBeUndefined()
    expect(resultat.ponts.map(({ perso: p, equipe: e }) => [p, e])).toEqual([
      ['knowledge/mes-notes-typage', 'knowledge/typecheck']
    ])
  })

  it('dit pourquoi aucun pont n’est calculé quand un Brain n’est pas indexé', async () => {
    const vide = mkdtempSync(join(tmpdir(), 'brain-ponts-vide-'))
    dossiers.push(vide)
    const equipe = brain([['knowledge/a.md', [1, 0]]])
    expect(await pontsEntreBrains(vide, equipe)).toEqual({
      ponts: [],
      raison: 'Brain perso pas encore indexé'
    })
    expect((await pontsEntreBrains(equipe, vide)).raison).toBe('Brain d’équipe pas encore indexé')
  })

  it('refuse de comparer deux index produits par des modèles différents', async () => {
    const perso = brain([['knowledge/a.md', [1, 0]]], { model: 'autre', fastembed: '1' })
    const equipe = brain([['knowledge/b.md', [1, 0]]])
    expect(await pontsEntreBrains(perso, equipe)).toEqual({
      ponts: [],
      raison: 'les deux Brains ne sont pas indexés par le même modèle'
    })
  })
})
