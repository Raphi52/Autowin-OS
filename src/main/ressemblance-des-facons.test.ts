import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre } from './fs-supprimer'
import { ecartDeLEssai } from './garder-un-essai'
import { ouvrirCopiesDEssai } from './photo-du-code'
import {
  lignesChangeesDuDiff,
  ressemblanceDesEcarts,
  ressemblanceDesFacons,
  type EntreeDeRessemblance
} from './ressemblance-des-facons'

/**
 * « ESSAIE 3 FAÇONS » : LE CONTRÔLE DE RESSEMBLANCE (conv-1057, 2026-10-22). Les trois branches
 * reçoivent trois consignes différentes, mais rien ne vérifiait que leurs RÉSULTATS diffèrent : deux
 * correctifs identiques s'affichaient comme deux lignes aux mêmes chiffres. Le contrôle compare ce que
 * chaque façon a changé depuis la photo de l'essai : même état du code = identique, sinon la part de
 * lignes changées en commun avec la façon la plus proche.
 *
 * Les entrées qui feraient échouer une version fausse :
 *  - deux façons au MÊME code : « identique », jamais un pourcentage approché ;
 *  - la même ligne dans deux fichiers différents : deux changements, pas un ;
 *  - une indentation différente : la même ligne ;
 *  - une ligne sans lettre ni chiffre (`}`) : elle ne fait pas ressembler deux façons ;
 *  - un binaire : compté par son contenu, jamais comme « zéro ligne » ;
 *  - une façon sans changement : sans objet, et jamais la « plus proche » d'une autre ;
 *  - deux photos différentes : rien de comparable.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const patch = (...lignes: string[]): string => `${lignes.join('\n')}\n`

const entete = (fichier: string): string[] => [
  `diff --git a/${fichier} b/${fichier}`,
  'index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644',
  `--- a/${fichier}`,
  `+++ b/${fichier}`
]

describe('lignesChangeesDuDiff', () => {
  it('compte les lignes ajoutées et retirées, jamais les en-têtes ni les lignes sans lettre ni chiffre', () => {
    const lignes = lignesChangeesDuDiff(
      patch(
        ...entete('a.ts'),
        '@@ -1 +1,3 @@',
        '-const x = 1',
        '+const x = 2',
        '+}',
        '+',
        '\\ No newline at end of file'
      )
    )
    expect(lignes.size).toBe(2)
  })

  it('la même ligne dans deux fichiers différents compte deux fois', () => {
    const lignes = lignesChangeesDuDiff(
      patch(
        ...entete('a.ts'),
        '@@ -0,0 +1 @@',
        '+return 1',
        ...entete('b.ts'),
        '@@ -0,0 +1 @@',
        '+return 1'
      )
    )
    expect(lignes.size).toBe(2)
  })

  it('une indentation différente ne rend pas deux lignes différentes', () => {
    const espaces = lignesChangeesDuDiff(
      patch(...entete('a.ts'), '@@ -0,0 +1 @@', '+    return  1')
    )
    const tabulation = lignesChangeesDuDiff(
      patch(...entete('a.ts'), '@@ -0,0 +1 @@', '+\treturn 1\r')
    )
    expect([...espaces]).toEqual([...tabulation])
  })

  it('un binaire compte par son contenu, jamais comme zéro ligne', () => {
    const binaire = (blob: string): Set<string> =>
      lignesChangeesDuDiff(
        patch(
          'diff --git a/logo.png b/logo.png',
          `index 0000000000000000000000000000000000000000..${blob} 100644`,
          'Binary files a/logo.png and b/logo.png differ'
        )
      )
    const premier = binaire('a'.repeat(40))
    expect(premier.size).toBe(1)
    expect([...binaire('a'.repeat(40))]).toEqual([...premier])
    expect([...binaire('b'.repeat(40))]).not.toEqual([...premier])
  })
})

const mesurable = (
  id: string,
  rang: number,
  arbre: string,
  lignes: string[],
  photo = 'photo-1'
): EntreeDeRessemblance => ({ id, ok: true, rang, photo, arbre, lignes: new Set(lignes) })

describe('ressemblanceDesFacons', () => {
  it('deux façons au même code sont identiques ; la troisième dit sa part commune avec la plus proche', () => {
    const resultat = ressemblanceDesFacons([
      mesurable('B1', 1, 'arbre-A', ['l1', 'l2']),
      mesurable('B2', 2, 'arbre-A', ['l1', 'l2']),
      mesurable('B3', 3, 'arbre-C', ['l1', 'l3', 'l4'])
    ])
    expect(resultat.get('B1')).toEqual({ etat: 'mesuree', avec: 2, part: 1, identique: true })
    expect(resultat.get('B2')).toEqual({ etat: 'mesuree', avec: 1, part: 1, identique: true })
    // B3 contre B1 : 1 ligne commune sur 4 distinctes.
    expect(resultat.get('B3')).toEqual({ etat: 'mesuree', avec: 1, part: 0.25, identique: false })
  })

  it('les mêmes lignes dans un code différent ne sont pas « identiques »', () => {
    const resultat = ressemblanceDesFacons([
      mesurable('B1', 1, 'arbre-A', ['l1']),
      mesurable('B2', 2, 'arbre-B', ['l1'])
    ])
    expect(resultat.get('B1')).toEqual({ etat: 'mesuree', avec: 2, part: 1, identique: false })
  })

  it('à part égale, une façon identique passe devant, puis la plus petite', () => {
    const resultat = ressemblanceDesFacons([
      mesurable('B1', 1, 'arbre-X', ['l1']),
      mesurable('B2', 2, 'arbre-A', ['l1']),
      mesurable('B3', 3, 'arbre-A', ['l1'])
    ])
    expect(resultat.get('B2')).toMatchObject({ avec: 3, identique: true })
    expect(resultat.get('B1')).toMatchObject({ avec: 2, identique: false })
  })

  it('une façon sans changement est sans objet, et n’est jamais la plus proche d’une autre', () => {
    const resultat = ressemblanceDesFacons([
      mesurable('B1', 1, 'arbre-A', ['l1']),
      { id: 'B2', ok: false, raison: 'aucun changement à comparer' }
    ])
    expect(resultat.get('B2')).toEqual({
      etat: 'sans-objet',
      raison: 'aucun changement à comparer'
    })
    expect(resultat.get('B1')).toEqual({
      etat: 'sans-objet',
      raison: 'aucune autre façon à comparer'
    })
  })

  it('deux photos différentes ne se comparent pas', () => {
    const resultat = ressemblanceDesFacons([
      mesurable('B1', 1, 'arbre-A', ['l1'], 'photo-1'),
      mesurable('B2', 2, 'arbre-A', ['l1'], 'photo-2')
    ])
    expect(resultat.get('B1')).toMatchObject({ etat: 'sans-objet' })
  })

  it('aucune ligne à comparer de part et d’autre : 0 %, pas une division par zéro', () => {
    const resultat = ressemblanceDesFacons([
      mesurable('B1', 1, 'arbre-A', []),
      mesurable('B2', 2, 'arbre-B', [])
    ])
    expect(resultat.get('B1')).toEqual({ etat: 'mesuree', avec: 2, part: 0, identique: false })
  })
})

const run = promisify(execFile)
const git = async (cwd: string, ...args: string[]): Promise<string> =>
  (await run('git', args, { cwd })).stdout

const dossiers: string[] = []
afterEach(() => {
  for (const dossier of dossiers.splice(0)) supprimerArbre(dossier)
})

describe('ressemblanceDesEcarts, sur de vraies copies d’essai', () => {
  it('deux copies au même changement sont identiques, la troisième en diffère', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-ressemblance-'))
    dossiers.push(racine)
    const repo = join(racine, 'depot')
    mkdirSync(repo)
    await git(repo, 'init', '-b', 'main')
    await git(repo, 'config', 'user.name', 'Test')
    await git(repo, 'config', 'user.email', 'test@example.invalid')
    writeFileSync(join(repo, 'calcul.ts'), 'export const total = (a, b) => a + b\n')
    await git(repo, 'add', '-A')
    await git(repo, 'commit', '-m', 'base')
    const retours = join(racine, 'retours-de-tour')
    const essai = await ouvrirCopiesDEssai({
      dossier: repo,
      conversationId: 'conv-1',
      dossierDesRetours: retours,
      nombre: 4,
      quand: 1_000
    })
    if (!essai.ok) throw new Error(essai.raison)
    const [c1, c2, c3, c4] = essai.chemins as [string, string, string, string]
    const memeCorrectif = 'export const total = (a, b) => Number(a) + Number(b)\n'
    writeFileSync(join(c1, 'calcul.ts'), memeCorrectif)
    writeFileSync(join(c2, 'calcul.ts'), memeCorrectif)
    writeFileSync(
      join(c3, 'calcul.ts'),
      'export function total(...valeurs: number[]): number {\n  return valeurs.reduce((somme, valeur) => somme + valeur, 0)\n}\n'
    )
    // c4 ne change rien.
    const entrees = await Promise.all(
      [c1, c2, c3, c4].map(async (copie, rang) => ({
        id: `B${rang + 1}`,
        copie,
        ecart: await ecartDeLEssai({ copie, dossierDesRetours: retours })
      }))
    )
    const resultat = await ressemblanceDesEcarts(entrees)
    expect(resultat.get('B1')).toEqual({ etat: 'mesuree', avec: 2, part: 1, identique: true })
    expect(resultat.get('B2')).toEqual({ etat: 'mesuree', avec: 1, part: 1, identique: true })
    const troisieme = resultat.get('B3')
    expect(troisieme).toMatchObject({ etat: 'mesuree', identique: false })
    expect(troisieme?.etat === 'mesuree' && troisieme.part).toBeLessThan(0.5)
    expect(resultat.get('B4')).toEqual({
      etat: 'sans-objet',
      raison: 'aucun changement à comparer'
    })
  })

  it('un écart illisible est sans objet, avec sa raison', async () => {
    const resultat = await ressemblanceDesEcarts([
      { id: 'B1', copie: 'D:\\nulle-part', ecart: { ok: false, raison: 'photo absente' } }
    ])
    expect(resultat.get('B1')).toEqual({ etat: 'sans-objet', raison: 'écart illisible' })
  })
})
