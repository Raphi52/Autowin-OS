import { describe, expect, it, vi } from 'vitest'
import {
  erreursDeTypage,
  nouvellesErreurs,
  projetsTouches,
  typerCeQuiPart,
  type MesureTypage,
  type ProjetTypage
} from './typage-avant-publication'

/**
 * Vécu le 2026-10-15 (conv-954) : le commit automatique `9d6bb850` a publié un fichier dont une
 * fonction prenait un paramètre de plus, sans `index.ts` qui l'appelle. main ne compilait plus, et le
 * contrôle d'avant publication (tests rejoués dans l'arbre partagé) était vert.
 */

describe('projets TypeScript touchés par ce qui part', () => {
  it('main et preload → node ; renderer → web ; shared → les deux ; le reste → aucun', () => {
    expect(projetsTouches(['src/main/index.ts'])).toEqual(['node'])
    expect(projetsTouches(['src\\main\\os.ts'])).toEqual(['node'])
    expect(projetsTouches(['src/renderer/src/components/SourceControlPane.tsx'])).toEqual(['web'])
    expect(projetsTouches(['src/shared/app-identity.ts'])).toEqual(['node', 'web'])
    expect(projetsTouches(['src/preload/index.ts'])).toEqual(['node'])
    expect(projetsTouches(['src/preload/index.d.ts'])).toEqual(['node', 'web'])
    expect(projetsTouches(['electron.vite.config.ts'])).toEqual(['node'])
    expect(projetsTouches(['scripts/menu-demarrer-dev.cjs', 'README.md', 'skills/gc/SKILL.md'])).toEqual([])
  })
})

describe('erreurs de typage reconnues sans ligne ni colonne', () => {
  const sortie = [
    "src/main/index.ts(4797,7): error TS2345: Argument of type '{ shell: X; }' is not assignable to parameter of type 'Y'.",
    "  Property 'args' is missing in type '{ shell: X; }' but required in type 'Y'.",
    'src\\renderer\\src\\a.tsx(12,3): error TS2322: Type \'string\' is not assignable to type \'number\'.',
    "error TS5083: Cannot read file 'D:/x/tsconfig.json'.",
    'Found 3 errors.'
  ].join('\r\n')

  it('une erreur par diagnostic, lignes de suite ignorées, chemins en barres obliques', () => {
    expect(erreursDeTypage(sortie)).toEqual([
      "src/main/index.ts: TS2345: Argument of type '{ shell: X; }' is not assignable to parameter of type 'Y'.",
      "src/renderer/src/a.tsx: TS2322: Type 'string' is not assignable to type 'number'.",
      "TS5083: Cannot read file 'D:/x/tsconfig.json'."
    ])
  })

  it('une ligne ajoutée plus haut ne rend pas nouvelle une erreur déjà là ; les doublons se comptent', () => {
    const avant = erreursDeTypage('src/a.ts(10,1): error TS1: x\nsrc/a.ts(20,1): error TS1: x')
    const apres = erreursDeTypage('src/a.ts(11,1): error TS1: x\nsrc/a.ts(21,1): error TS1: x\nsrc/a.ts(30,1): error TS1: x')
    expect(nouvellesErreurs(apres, avant)).toEqual(['src/a.ts: TS1: x'])
    expect(nouvellesErreurs(avant, apres)).toEqual([])
  })
})

describe('typer ce qui part', () => {
  const ROUGE = "src/main/index.ts(1,1): error TS2345: manque 'args'."
  function banc(scenario: { avecLeTour: Partial<Record<ProjetTypage, MesureTypage>>; base?: Partial<Record<ProjetTypage, MesureTypage>> }) {
    const journal: string[] = []
    let restauree = false
    const fermer = vi.fn(async () => {
      journal.push('fermer')
    })
    const typer = vi.fn(async (_racine: string, projet: ProjetTypage): Promise<MesureTypage> => {
      journal.push(`typer ${projet} ${restauree ? 'base' : 'tour'}`)
      const mesure = (restauree ? scenario.base : scenario.avecLeTour)?.[projet]
      return mesure ?? { lancee: true, exitCode: 0, sortie: '' }
    })
    const lancer = (fichiers: string[]) =>
      typerCeQuiPart({
        repo: 'D:\\Depot',
        fichiers,
        typer,
        ouvrirCopie: async () => ({ chemin: 'C:\\copie', fermer }),
        appliquer: (_repo, _copie, f) => {
          journal.push(`appliquer ${f.join(',')}`)
        },
        restaurer: async () => {
          restauree = true
          journal.push('restaurer')
        }
      })
    return { lancer, journal, fermer, typer }
  }
  const rouge = (sortie: string): MesureTypage => ({ lancee: true, exitCode: 2, sortie })

  it('aucun fichier TypeScript : rien à typer, aucune copie ouverte', async () => {
    const b = banc({ avecLeTour: {} })
    expect(await b.lancer(['scripts/menu-demarrer-dev.cjs'])).toEqual({ statut: 'sans-objet' })
    expect(b.journal).toEqual([])
  })

  it('vert : un seul typage par projet touché, sur la copie AVEC le tour, puis la copie est fermée', async () => {
    const b = banc({ avecLeTour: {} })
    expect(await b.lancer(['src/main/raccourci-demarrer-dev.ts'])).toEqual({ statut: 'vert', projets: ['node'] })
    expect(b.journal).toEqual(['appliquer src/main/raccourci-demarrer-dev.ts', 'typer node tour', 'fermer'])
  })

  it('le cas 9d6bb850 : une erreur absente du dernier commit BLOQUE, et elle est nommée', async () => {
    const b = banc({ avecLeTour: { node: rouge(ROUGE) }, base: {} })
    expect(await b.lancer(['src/main/raccourci-demarrer-dev.ts'])).toEqual({
      statut: 'echec',
      projets: ['node'],
      commande: 'tsc --noEmit -p tsconfig.node.json --composite false',
      erreurs: ["src/main/index.ts: TS2345: manque 'args'."]
    })
    expect(b.journal).toEqual([
      'appliquer src/main/raccourci-demarrer-dev.ts',
      'typer node tour',
      'restaurer',
      'typer node base',
      'fermer'
    ])
  })

  it('une erreur DÉJÀ présente au dernier commit ne bloque pas, mais elle est comptée', async () => {
    const b = banc({ avecLeTour: { web: rouge(ROUGE) }, base: { web: rouge(ROUGE.replace('(1,1)', '(9,9)')) } })
    expect(await b.lancer(['src/renderer/src/x.tsx'])).toEqual({ statut: 'vert', projets: ['web'], dejaRouges: 1 })
  })

  it('tsc coupé, planté ou introuvable : non vérifié (on ne bloque pas sur une mesure absente), copie fermée', async () => {
    const coupe = banc({ avecLeTour: { node: { lancee: true, exitCode: null, sortie: '' } } })
    expect(await coupe.lancer(['src/main/a.ts'])).toMatchObject({ statut: 'non-verifie', raison: expect.stringContaining('plafond') })
    expect(coupe.fermer).toHaveBeenCalledTimes(1)
    const plante = banc({ avecLeTour: { node: { lancee: true, exitCode: 1, sortie: 'RangeError: Maximum call stack' } } })
    expect(await plante.lancer(['src/main/a.ts'])).toMatchObject({ statut: 'non-verifie', raison: expect.stringContaining('sans erreur lisible') })
    const absent = banc({ avecLeTour: { node: { lancee: false, exitCode: null, sortie: '', raison: 'tsc introuvable : x' } } })
    expect(await absent.lancer(['src/main/a.ts'])).toEqual({ statut: 'non-verifie', raison: 'tsc introuvable : x' })
  })

  it('copie propre impossible : non vérifié, avec la raison', async () => {
    const r = await typerCeQuiPart({
      repo: 'D:\\Depot',
      fichiers: ['src/main/a.ts'],
      typer: vi.fn(),
      ouvrirCopie: async () => {
        throw new Error('worktree add refusé')
      }
    })
    expect(r).toEqual({ statut: 'non-verifie', raison: 'copie propre du dernier commit impossible : worktree add refusé' })
  })
})
