import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  inventorierDisque,
  menageDemarrage,
  oublierMenageDemarrage,
  retenirMenageDemarrage
} from './inventaire-disque'

function famille(racine: string, nom: string, fichiers: Record<string, string>): void {
  mkdirSync(join(racine, nom), { recursive: true })
  for (const [chemin, contenu] of Object.entries(fichiers))
    writeFileSync(join(racine, nom, chemin), contenu, 'utf8')
}

describe('inventaire disque d’Autowin', () => {
  beforeEach(() => oublierMenageDemarrage())

  it('rend le poids par famille, du plus lourd au plus léger, et leur total', () => {
    const racine = mkdtempSync(join(tmpdir(), 'inventaire-'))
    famille(racine, 'causal-trace', { 'a.jsonl': 'x'.repeat(300) })
    famille(racine, 'turn-journals', { 'b.jsonl': 'y'.repeat(50) })

    const inventaire = inventorierDisque(racine, ['turn-journals', 'causal-trace'])

    expect(inventaire.familles.map((item) => item.nom)).toEqual(['causal-trace', 'turn-journals'])
    expect(inventaire.familles[0]?.octets).toBe(300)
    expect(inventaire.octets).toBe(350)
    expect(inventaire.partiel).toBe(false)
  })

  it('compte une famille absente pour zéro au lieu d’échouer', () => {
    const racine = mkdtempSync(join(tmpdir(), 'inventaire-absent-'))
    const inventaire = inventorierDisque(racine, ['jamais-cree'])
    expect(inventaire.octets).toBe(0)
    expect(inventaire.familles[0]).toEqual({
      nom: 'jamais-cree',
      octets: 0,
      fichiers: 0,
      partiel: false
    })
  })

  it('descend dans les sous-dossiers : une famille ne se mesure pas à plat', () => {
    const racine = mkdtempSync(join(tmpdir(), 'inventaire-profond-'))
    mkdirSync(join(racine, 'worktrees', 'run-1'), { recursive: true })
    writeFileSync(join(racine, 'worktrees', 'run-1', 'fichier.txt'), 'z'.repeat(120), 'utf8')
    expect(inventorierDisque(racine, ['worktrees']).octets).toBe(120)
  })

  it('retient les chiffres du ménage du démarrage, qui n’existaient plus au moment de les montrer', () => {
    retenirMenageDemarrage({
      famille: 'causal-trace',
      supprimes: 441,
      octetsLiberes: 700_000_000,
      restants: 197
    })
    retenirMenageDemarrage({
      famille: 'causal-trace',
      supprimes: 12,
      octetsLiberes: 2_000,
      restants: 190
    })
    expect(menageDemarrage()).toEqual([
      { famille: 'causal-trace', supprimes: 12, octetsLiberes: 2_000, restants: 190 }
    ])
    expect(
      inventorierDisque(mkdtempSync(join(tmpdir(), 'x-')), [], menageDemarrage()).menage
    ).toHaveLength(1)
  })
})
