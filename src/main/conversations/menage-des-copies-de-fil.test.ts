import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { ouvrirLaCopieDuFil } from '../git/photo-du-code'
import {
  CALME_AVANT_MENAGE_MS,
  decisionPourLaCopie,
  menageDesCopiesDeFil,
  PREFIXE_A_SUPPRIMER,
  type FilDuMenage
} from './menage-des-copies-de-fil'

/**
 * Le ménage des copies de fil retire la copie d'un fil fini, et RIEN de ce qui serait perdu.
 * Entrées qui doivent faire échouer : une copie gardée alors que son fil est fini et qu'elle est
 * identique à sa base ; une copie retirée alors qu'elle porte un fichier non publié, que son fil
 * travaille encore, ou qu'un fil y est rangé sans pouvoir en revenir ; les modules du dépôt vidés à
 * travers la jonction ; un fil laissé rangé dans un dossier qui n'existe plus.
 */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const H = 3_600_000
const MAINTENANT = 1_800_000_000_000
const COPIE =
  'D:\\AutoWinOS\\.autowin-data\\autowin-os\\retours-de-tour\\essai__conv-9-1700000000000-1'

function fil(champs: Partial<FilDuMenage>): FilDuMenage {
  return { id: 'conv-9', updatedAt: MAINTENANT - 13 * H, ...champs }
}

describe('decisionPourLaCopie — qui se sert de la copie, et chacun a-t-il fini ?', () => {
  const decider = (fils: FilDuMenage[], enCours: string[] = []) =>
    decisionPourLaCopie({
      copie: COPIE,
      fils,
      tourEnCours: (id) => enCours.includes(id),
      maintenant: MAINTENANT
    })
  const dansSaCopie = { projectPath: COPIE, copieDuFil: { chemin: COPIE } }

  it('retire la copie d’un fil calme depuis 12 h, et le décroche', () => {
    expect(decider([fil(dansSaCopie)])).toEqual({
      supprimer: true,
      filDuNom: 'conv-9',
      aDecrocher: ['conv-9']
    })
  })

  it('garde la copie d’un fil qui a servi il y a moins de 12 h', () => {
    expect(decider([fil({ ...dansSaCopie, updatedAt: MAINTENANT - 11 * H })]).supprimer).toBe(false)
  })

  it('un fil marqué inactif est fini dès 3 min de calme', () => {
    expect(
      decider([fil({ ...dansSaCopie, inactive: true, updatedAt: MAINTENANT - 4 * 60_000 })])
        .supprimer
    ).toBe(true)
  })

  it('garde la copie d’un fil dont un tour est en cours, même ancien', () => {
    expect(decider([fil(dansSaCopie)], ['conv-9'])).toEqual({
      supprimer: false,
      raison: 'conv-9 a un tour en cours'
    })
  })

  it('une branche du fil qui travaille encore dans la copie la garde', () => {
    const branche = fil({ ...dansSaCopie, id: 'conv-10', updatedAt: MAINTENANT - H })
    expect(decider([fil(dansSaCopie), branche]).supprimer).toBe(false)
  })

  it('garde une copie où un fil est rangé sans que ce soit sa copie (une façon d’essai)', () => {
    expect(decider([fil({ projectPath: COPIE })]).supprimer).toBe(false)
  })

  it('un fil déjà revenu de sa copie ne se décroche pas une seconde fois', () => {
    expect(decider([fil({ projectPath: 'D:\\AutoWinOS', copieDuFil: { chemin: COPIE } })])).toEqual(
      {
        supprimer: true,
        filDuNom: 'conv-9',
        aDecrocher: []
      }
    )
  })

  it('sans fil : seule une copie de plus de 12 h part (une copie neuve peut être en cours d’ouverture)', () => {
    expect(decider([]).supprimer).toBe(true)
    expect(
      decisionPourLaCopie({
        copie: COPIE.replace('1700000000000', String(MAINTENANT - H)),
        fils: [],
        tourEnCours: () => false,
        maintenant: MAINTENANT
      }).supprimer
    ).toBe(false)
  })

  it('ignore ce qui n’est pas une copie de fil', () => {
    expect(
      decisionPourLaCopie({
        copie: 'D:\\AutoWinOS',
        fils: [],
        tourEnCours: () => false,
        maintenant: MAINTENANT
      }).supprimer
    ).toBe(false)
  })
})

const run = promisify(execFile)
const git = async (cwd: string, ...args: string[]): Promise<string> =>
  (await run('git', args, { cwd })).stdout.trim()

const dossiers: string[] = []
afterEach(() => {
  for (const dossier of dossiers.splice(0)) supprimerArbre(dossier)
})

/** Un dépôt avec ses modules installés, et le dossier de ses copies de fil. */
async function depot(): Promise<{ repo: string; retours: string; canari: string }> {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-menage-copies-'))
  dossiers.push(racine)
  const repo = join(racine, 'depot')
  mkdirSync(repo)
  await git(repo, 'init', '-b', 'main')
  await git(repo, 'config', 'user.name', 'Test')
  await git(repo, 'config', 'user.email', 'test@example.invalid')
  writeFileSync(join(repo, 'a.txt'), 'version commitée\n')
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-m', 'base')
  mkdirSync(join(repo, 'node_modules'))
  const canari = join(repo, 'node_modules', 'canari.txt')
  writeFileSync(canari, 'module du dépôt\n')
  const retours = join(racine, 'retours-de-tour')
  mkdirSync(retours)
  return { repo, retours, canari }
}

async function copieDuFil(repo: string, retours: string, conversationId: string): Promise<string> {
  const ouverte = await ouvrirLaCopieDuFil({
    dossier: repo,
    conversationId,
    dossierDesRetours: retours,
    quand: MAINTENANT - 20 * H
  })
  if (!ouverte.ok) throw new Error(ouverte.raison)
  expect(ouverte.dependances.fait).toBe('liees')
  return ouverte.chemin
}

describe('menageDesCopiesDeFil — sur un vrai dépôt', () => {
  it('retire la copie identique à sa base, décroche son fil, et laisse les modules du dépôt', async () => {
    const { repo, retours, canari } = await depot()
    const copie = await copieDuFil(repo, retours, 'conv-1')
    const decroches: string[] = []

    const bilan = await menageDesCopiesDeFil({
      dossierDesRetours: retours,
      depot: repo,
      lireFils: () => [fil({ id: 'conv-1', projectPath: copie, copieDuFil: { chemin: copie } })],
      tourEnCours: () => false,
      decrocher: (id) => decroches.push(id),
      maintenant: () => MAINTENANT
    })

    expect(bilan).toEqual({ supprimees: [copie], gardees: [], echecs: [] })
    expect(decroches).toEqual(['conv-1'])
    expect(readdirSync(retours)).toEqual([])
    expect(existsSync(canari)).toBe(true)
    expect(await git(repo, 'worktree', 'list')).not.toContain('essai__')
  })

  it('garde la copie qui porte un fichier non publié, même si son fil est fini', async () => {
    const { repo, retours } = await depot()
    const copie = await copieDuFil(repo, retours, 'conv-2')
    writeFileSync(join(copie, 'travail.txt'), 'jamais passé par la porte\n')
    const decrocher = vi.fn()

    const bilan = await menageDesCopiesDeFil({
      dossierDesRetours: retours,
      depot: repo,
      lireFils: () => [fil({ id: 'conv-2', projectPath: copie, copieDuFil: { chemin: copie } })],
      tourEnCours: () => false,
      decrocher,
      maintenant: () => MAINTENANT
    })

    expect(bilan.supprimees).toEqual([])
    expect(bilan.gardees).toEqual([{ chemin: copie, raison: 'elle porte du travail non publié' }])
    expect(decrocher).not.toHaveBeenCalled()
    expect(existsSync(join(copie, 'travail.txt'))).toBe(true)
  })

  it('garde la copie quand son fil repart pendant la mesure de l’écart', async () => {
    const { repo, retours } = await depot()
    const copie = await copieDuFil(repo, retours, 'conv-3')
    let lectures = 0
    const bilan = await menageDesCopiesDeFil({
      dossierDesRetours: retours,
      depot: repo,
      // 1re lecture : fil fini ; 2e, juste avant le geste : un message vient d'arriver.
      lireFils: () => [
        fil({
          id: 'conv-3',
          projectPath: copie,
          copieDuFil: { chemin: copie },
          updatedAt: ++lectures === 1 ? MAINTENANT - 13 * H : MAINTENANT
        })
      ],
      tourEnCours: () => false,
      decrocher: () => undefined,
      maintenant: () => MAINTENANT
    })

    expect(bilan.supprimees).toEqual([])
    expect(existsSync(copie)).toBe(true)
  })

  it('reprend une copie déjà décrochée qu’un ménage coupé a laissée', async () => {
    const { repo, retours, canari } = await depot()
    const reste = join(retours, `${PREFIXE_A_SUPPRIMER}essai__conv-4-1-1`)
    mkdirSync(reste)
    writeFileSync(join(reste, 'x.txt'), 'reste\n')

    const bilan = await menageDesCopiesDeFil({
      dossierDesRetours: retours,
      depot: repo,
      lireFils: () => [],
      tourEnCours: () => false,
      decrocher: () => undefined,
      maintenant: () => MAINTENANT,
      calmeMs: CALME_AVANT_MENAGE_MS
    })

    expect(bilan.echecs).toEqual([])
    expect(existsSync(reste)).toBe(false)
    expect(existsSync(canari)).toBe(true)
  })
})
