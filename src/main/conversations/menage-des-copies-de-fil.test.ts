import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import {
  avancerLaBaseDuFil,
  ouvrirCopieDeLaPhoto,
  ouvrirLaCopieDuFil,
  photographierLeCode
} from '../git/photo-du-code'
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
const COPIE_NEUVE = 'D:\\AutoWinOS\\.autowin-data\\autowin-os\\copies-de-fil\\conv-9'

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

  it('copies-de-fil/<fil> : même décision, le fil lu dans le nom', () => {
    const neuve = COPIE_NEUVE
    expect(
      decisionPourLaCopie({
        copie: neuve,
        fils: [fil({ projectPath: neuve, copieDuFil: { chemin: neuve } })],
        tourEnCours: () => false,
        maintenant: MAINTENANT
      })
    ).toEqual({ supprimer: true, filDuNom: 'conv-9', aDecrocher: ['conv-9'] })
  })

  it('copies-de-fil/<fil> sans fil : l’âge vient du disque, et sans lui la copie reste', () => {
    const neuve = COPIE_NEUVE
    const decider = (ouverteA?: number) =>
      decisionPourLaCopie({
        copie: neuve,
        fils: [],
        tourEnCours: () => false,
        maintenant: MAINTENANT,
        ...(ouverteA === undefined ? {} : { ouverteA })
      }).supprimer
    expect(decider(MAINTENANT - 13 * H)).toBe(true)
    expect(decider(MAINTENANT - H)).toBe(false)
    expect(decider()).toBe(false)
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
async function depot(): Promise<{
  repo: string
  retours: string
  copies: string
  canari: string
}> {
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
  return { repo, retours, copies: join(racine, 'copies-de-fil'), canari }
}

async function copieDuFil(repo: string, copies: string, conversationId: string): Promise<string> {
  const ouverte = await ouvrirLaCopieDuFil({
    dossier: repo,
    conversationId,
    dossierDesCopies: copies,
    quand: MAINTENANT - 20 * H
  })
  if (!ouverte.ok) throw new Error(ouverte.raison)
  expect(ouverte.dependances.fait).toBe('liees')
  return ouverte.chemin
}

describe('menageDesCopiesDeFil — sur un vrai dépôt', () => {
  it('retire la copie identique à sa base, décroche son fil, et laisse les modules du dépôt', async () => {
    const { repo, retours, copies, canari } = await depot()
    const copie = await copieDuFil(repo, copies, 'conv-1')
    const decroches: string[] = []

    const bilan = await menageDesCopiesDeFil({
      dossierDesRetours: retours,
      dossierDesCopiesDeFil: copies,
      depot: repo,
      lireFils: () => [fil({ id: 'conv-1', projectPath: copie, copieDuFil: { chemin: copie } })],
      tourEnCours: () => false,
      decrocher: (id) => decroches.push(id),
      maintenant: () => MAINTENANT
    })

    expect(bilan).toEqual({ supprimees: [copie], gardees: [], echecs: [] })
    expect(decroches).toEqual(['conv-1'])
    expect(readdirSync(copies)).toEqual([])
    expect(existsSync(canari)).toBe(true)
    expect(await git(repo, 'worktree', 'list')).not.toContain('copies-de-fil')
  })

  it('garde la copie qui porte un fichier non publié, même si son fil est fini', async () => {
    const { repo, retours, copies } = await depot()
    const copie = await copieDuFil(repo, copies, 'conv-2')
    writeFileSync(join(copie, 'travail.txt'), 'jamais passé par la porte\n')
    const decrocher = vi.fn()

    const bilan = await menageDesCopiesDeFil({
      dossierDesRetours: retours,
      dossierDesCopiesDeFil: copies,
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
    const { repo, retours, copies } = await depot()
    const copie = await copieDuFil(repo, copies, 'conv-3')
    let lectures = 0
    const bilan = await menageDesCopiesDeFil({
      dossierDesRetours: retours,
      dossierDesCopiesDeFil: copies,
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

  it('retire aussi une copie d’avant, rangée sous retours-de-tour/essai__…', async () => {
    const { repo, retours, copies } = await depot()
    // L'ancien rangement : une photo, puis sa copie sous `essai__<fil>-<instant>-1`.
    const quand = MAINTENANT - 20 * H
    const photo = await photographierLeCode({ dossier: repo, conversationId: 'conv-5', quand })
    if (!photo) throw new Error('photo impossible')
    const { chemin: ancienne } = await ouvrirCopieDeLaPhoto({
      dossier: repo,
      sha: photo.sha,
      destination: join(retours, `essai__conv-5-${quand}-1`)
    })
    await avancerLaBaseDuFil({
      dossier: repo,
      conversationId: 'conv-5',
      depuis: null,
      vers: photo.sha
    })

    const bilan = await menageDesCopiesDeFil({
      dossierDesRetours: retours,
      dossierDesCopiesDeFil: copies,
      depot: repo,
      lireFils: () => [
        fil({ id: 'conv-5', projectPath: ancienne, copieDuFil: { chemin: ancienne } })
      ],
      tourEnCours: () => false,
      decrocher: () => undefined,
      maintenant: () => MAINTENANT
    })

    expect(bilan).toEqual({ supprimees: [ancienne], gardees: [], echecs: [] })
    expect(existsSync(ancienne)).toBe(false)
  })
})
