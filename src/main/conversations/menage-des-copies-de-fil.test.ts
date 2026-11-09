import { execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { racineDesCopiesDeTaches } from '../copies/chemins-de-copies'
import {
  entrerLeTravailDeLaCopie,
  ouvrirLaCopieDeTache,
  uneEntreeEstEnAttente
} from '../copies/copie-de-tache'
import {
  avancerLaBaseDuFil,
  lireLaBaseDuFil,
  ouvrirCopieDeLaPhoto,
  photographierLeCode
} from '../git/photo-du-code'
import { defaultGitRunner } from '../runs/run-autoclose'
import { lierLesDependances } from '../store/dependances-copie-agent'
import { encoderCheminCli, suivreSessionEntreDossiers } from '../store/historique-cli-copie'
import {
  CALME_AVANT_MENAGE_MS,
  decisionPourLaCopie,
  menageDesCopiesDeFil,
  menageDesCopiesDeTaches,
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
const SESSION_CLI = '3cd742bb-8548-4ae9-8b2f-7038dd27af57'
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

  it('un fil est fini à la limite du délai de calme, et pas une milliseconde avant', () => {
    expect(
      decider([fil({ ...dansSaCopie, updatedAt: MAINTENANT - CALME_AVANT_MENAGE_MS })]).supprimer
    ).toBe(true)
    expect(
      decider([fil({ ...dansSaCopie, updatedAt: MAINTENANT - CALME_AVANT_MENAGE_MS + 1 })])
        .supprimer
    ).toBe(false)
  })

  it('une copie propre reste 1 h après la fin du tour : la suite du travail ne paie pas sa réouverture', () => {
    expect(CALME_AVANT_MENAGE_MS).toBe(H)
  })

  it('un fil marqué inactif n’a pas de délai plus court : le même calme', () => {
    expect(
      decider([fil({ ...dansSaCopie, inactive: true, updatedAt: MAINTENANT - 5_000 })]).supprimer
    ).toBe(false)
  })

  it('garde la copie d’un fil dont un tour est en cours, même ancien', () => {
    expect(decider([fil(dansSaCopie)], ['conv-9'])).toEqual({
      supprimer: false,
      raison: 'conv-9 a un tour en cours'
    })
  })

  it('une branche du fil qui travaille encore dans la copie la garde', () => {
    const branche = fil({ ...dansSaCopie, id: 'conv-10', updatedAt: MAINTENANT - 5_000 })
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

/**
 * Une copie d'avant (`copies-de-fil\<fil>`) : une copie détachée, sa base posée, ses modules liés.
 * La primitive ne crée plus que sous la racine unique : cette mise en place refait, pas à pas, ce que
 * l'ancienne ouverture faisait, et vérifie le lien sur le disque (le module du dépôt y est visible).
 * la réouverture part de la base lue, sinon l'avancement est refusé.
 */
async function copieDuFil(repo: string, copies: string, conversationId: string): Promise<string> {
  const copie = join(copies, conversationId)
  await git(repo, 'worktree', 'add', '--detach', copie, 'HEAD')
  const lue = await lireLaBaseDuFil({ dossier: copie, conversationId })
  const base = await avancerLaBaseDuFil({
    dossier: copie,
    conversationId,
    depuis: lue,
    vers: 'HEAD'
  })
  if (!base.ok) throw new Error(base.raison)
  expect(lierLesDependances(repo, copie).fait).toBe('liees')
  expect(existsSync(join(copie, 'node_modules', 'canari.txt'))).toBe(true)
  return copie
}

describe('menageDesCopiesDeFil — sur un vrai dépôt', () => {
  it('ramène la session du fil sous son dossier d’avant, puis range l’historique CLI de la copie d’avant retirée', async () => {
    const { repo, retours, copies } = await depot()
    const copie = await copieDuFil(repo, copies, 'conv-7')
    const config = mkdtempSync(join(tmpdir(), 'cli-menage-'))
    dossiers.push(config)
    const histo = join(config, 'projects', encoderCheminCli(copie))
    mkdirSync(histo, { recursive: true })
    writeFileSync(join(histo, `${SESSION_CLI}.jsonl`), 'tour 1')

    await menageDesCopiesDeFil({
      dossierDesRetours: retours,
      dossierDesCopiesDeFil: copies,
      depot: repo,
      lireFils: () => [
        fil({ id: 'conv-7', projectPath: copie, copieDuFil: { chemin: copie, dossierAvant: repo } })
      ],
      tourEnCours: () => false,
      decrocher: () => {},
      maintenant: () => MAINTENANT,
      racinesHistoriqueCli: () => [join(config, 'projects')]
    })

    expect(existsSync(copie)).toBe(false)
    expect(existsSync(histo)).toBe(false)
    expect(
      readFileSync(join(config, 'projects', encoderCheminCli(repo), `${SESSION_CLI}.jsonl`), 'utf8')
    ).toBe('tour 1')
  })

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

  it('retire la copie propre dès que son fil a eu le délai de calme, sans attendre 12 h', async () => {
    const { repo, retours, copies, canari } = await depot()
    const copie = await copieDuFil(repo, copies, 'conv-7')
    const decroches: string[] = []

    const bilan = await menageDesCopiesDeFil({
      dossierDesRetours: retours,
      dossierDesCopiesDeFil: copies,
      depot: repo,
      lireFils: () => [
        fil({
          id: 'conv-7',
          updatedAt: MAINTENANT - CALME_AVANT_MENAGE_MS,
          projectPath: copie,
          copieDuFil: { chemin: copie }
        })
      ],
      tourEnCours: () => false,
      decrocher: (id) => decroches.push(id),
      maintenant: () => MAINTENANT
    })

    expect(bilan).toEqual({ supprimees: [copie], gardees: [], echecs: [] })
    expect(decroches).toEqual(['conv-7'])
    expect(existsSync(copie)).toBe(false)
    expect(existsSync(canari)).toBe(true)
  })

  it('une copie rouverte après son retrait reprend le même chemin : la session rangée sous ce chemin reste reprenable', async () => {
    const { repo, retours, copies } = await depot()
    const premiere = await copieDuFil(repo, copies, 'conv-8')

    await menageDesCopiesDeFil({
      dossierDesRetours: retours,
      dossierDesCopiesDeFil: copies,
      depot: repo,
      lireFils: () => [
        fil({
          id: 'conv-8',
          updatedAt: MAINTENANT - CALME_AVANT_MENAGE_MS,
          projectPath: premiere,
          copieDuFil: { chemin: premiere }
        })
      ],
      tourEnCours: () => false,
      decrocher: () => undefined,
      maintenant: () => MAINTENANT
    })
    expect(existsSync(premiere)).toBe(false)

    expect(await copieDuFil(repo, copies, 'conv-8')).toBe(premiere)
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

/**
 * LA RACINE UNIQUE (`copies-de-taches\<fil>`) : le ménage y passe par les verbes de la primitive. Même
 * décision que pour les anciennes copies (fil fini, calme, aucun tour), et le retrait refuse tout écart.
 */
describe('menageDesCopiesDeTaches — copies sous la racine unique, par la primitive', () => {
  async function copieDeTache(
    repo: string,
    dossierDeDonnees: string,
    tache: string
  ): Promise<string> {
    const ouverte = await ouvrirLaCopieDeTache({
      dossierDeDonnees,
      depot: repo,
      tache,
      sansDistant: true
    })
    if (!ouverte.ok) throw new Error(ouverte.raison)
    return ouverte.chemin
  }

  // la session se pose avant le rangement de l'historique de la copie retirée, sinon la reprise la perd.
  /** La copie d'un fil, son historique CLI sous `projects` (le CLI le range sous le dossier de son cwd). */
  const historiqueDe = (config: string, cwd: string): string =>
    join(config, 'projects', encoderCheminCli(cwd))

  // Une création coupée n'a jamais été rendue : la passe horaire la défait d'abord (reprise), sans attendre que le fil revienne.
  it('une création coupée est défaite par la passe horaire, sans attendre la réouverture du fil', async () => {
    const { repo, retours } = await depot()
    const dossierDeDonnees = dirname(retours)
    const gitReel = await defaultGitRunner()
    const coupee = await ouvrirLaCopieDeTache({
      dossierDeDonnees,
      depot: repo,
      tache: 'conv-8',
      sansDistant: true,
      runGit: async (args, cwd, options) => {
        const sortie = await gitReel(args, cwd, options)
        if (args.includes('worktree') && args.includes('add'))
          throw new Error('arrêt simulé pendant la création')
        return sortie
      }
    })
    expect(coupee).toMatchObject({ ok: false, motif: 'echec' })
    const racine = racineDesCopiesDeTaches(dossierDeDonnees)
    expect(existsSync(join(racine, 'en-creation__conv-8'))).toBe(true)
    expect(existsSync(join(racine, 'conv-8'))).toBe(true)

    const bilan = await menageDesCopiesDeTaches({
      dossierDeDonnees,
      depot: repo,
      lireFils: () => [],
      tourEnCours: () => false,
      decrocher: () => {},
      maintenant: () => MAINTENANT,
      racinesHistoriqueCli: () => []
    })

    expect(bilan.echecs).toEqual([])
    expect(bilan.gardees).toEqual([])
    expect(existsSync(join(racine, 'en-creation__conv-8'))).toBe(false)
    expect(existsSync(join(racine, 'conv-8'))).toBe(false)
    expect(await git(repo, 'worktree', 'list')).not.toContain('conv-8')
  })

  it('une copie sans fil, retirée à son âge, garde son historique : rien ne dit où reprendre la session', async () => {
    const { repo, retours } = await depot()
    const dossierDeDonnees = dirname(retours)
    const copie = await copieDeTache(repo, dossierDeDonnees, 'conv-8')
    const config = mkdtempSync(join(tmpdir(), 'cli-menage-'))
    dossiers.push(config)
    const histo = historiqueDe(config, copie)
    mkdirSync(histo, { recursive: true })
    writeFileSync(join(histo, `${SESSION_CLI}.jsonl`), 'tour 1')

    const bilan = await menageDesCopiesDeTaches({
      dossierDeDonnees,
      depot: repo,
      lireFils: () => [],
      tourEnCours: () => false,
      decrocher: () => {},
      maintenant: () => MAINTENANT,
      racinesHistoriqueCli: () => [join(config, 'projects')]
    })

    expect(bilan.supprimees).toEqual([copie])
    expect(existsSync(histo)).toBe(true)
    expect(bilan.echecs).toEqual([])
  })

  it('ramène la session du fil sous son dossier d’avant, puis range l’historique CLI de la copie retirée', async () => {
    const { repo, retours } = await depot()
    const dossierDeDonnees = dirname(retours)
    const copie = await copieDeTache(repo, dossierDeDonnees, 'conv-4')
    const config = mkdtempSync(join(tmpdir(), 'cli-menage-'))
    dossiers.push(config)
    const histo = historiqueDe(config, copie)
    mkdirSync(histo, { recursive: true })
    writeFileSync(join(histo, `${SESSION_CLI}.jsonl`), 'tour 1 et 2')

    await menageDesCopiesDeTaches({
      dossierDeDonnees,
      depot: repo,
      lireFils: () => [
        fil({ id: 'conv-4', projectPath: copie, copieDuFil: { chemin: copie, dossierAvant: repo } })
      ],
      tourEnCours: () => false,
      decrocher: () => {},
      maintenant: () => MAINTENANT,
      racinesHistoriqueCli: () => [join(config, 'projects')]
    })

    expect(existsSync(copie)).toBe(false)
    expect(existsSync(histo)).toBe(false)
    expect(readFileSync(join(historiqueDe(config, repo), `${SESSION_CLI}.jsonl`), 'utf8')).toBe(
      'tour 1 et 2'
    )
    // Le fil revenu dans son dossier d’avant reprend sa session : elle est là où le CLI la cherche.
    expect(
      suivreSessionEntreDossiers({
        configDir: config,
        depuis: copie,
        vers: repo,
        sessionId: SESSION_CLI
      })
    ).toBe('suivie')
  })

  it('garde l’historique de la copie retirée tant qu’une de ses sessions n’a pas pu être posée', async () => {
    const { repo, retours } = await depot()
    const dossierDeDonnees = dirname(retours)
    const copie = await copieDeTache(repo, dossierDeDonnees, 'conv-6')
    const config = mkdtempSync(join(tmpdir(), 'cli-menage-'))
    dossiers.push(config)
    const histo = historiqueDe(config, copie)
    mkdirSync(histo, { recursive: true })
    writeFileSync(join(histo, 'pas un uuid.jsonl'), 'x')

    const bilan = await menageDesCopiesDeTaches({
      dossierDeDonnees,
      depot: repo,
      lireFils: () => [
        fil({ id: 'conv-6', projectPath: copie, copieDuFil: { chemin: copie, dossierAvant: repo } })
      ],
      tourEnCours: () => false,
      decrocher: () => {},
      maintenant: () => MAINTENANT,
      racinesHistoriqueCli: () => [join(config, 'projects')]
    })

    expect(existsSync(copie)).toBe(false)
    expect(existsSync(join(histo, 'pas un uuid.jsonl'))).toBe(true)
    expect(bilan.echecs.map((echec) => echec.chemin)).toContain(join(histo, 'pas un uuid.jsonl'))
  })

  it('retire la copie d’un fil fini, identique à sa base, décroche le fil, et laisse les modules du dépôt', async () => {
    const { repo, retours, canari } = await depot()
    const dossierDeDonnees = dirname(retours)
    const copie = await copieDeTache(repo, dossierDeDonnees, 'conv-1')
    const decroches: string[] = []

    const bilan = await menageDesCopiesDeTaches({
      dossierDeDonnees,
      depot: repo,
      lireFils: () => [fil({ id: 'conv-1', projectPath: copie, copieDuFil: { chemin: copie } })],
      tourEnCours: () => false,
      decrocher: (id) => decroches.push(id),
      maintenant: () => MAINTENANT
    })

    expect(bilan).toEqual({ supprimees: [copie], gardees: [], echecs: [] })
    expect(decroches).toEqual(['conv-1'])
    expect(existsSync(copie)).toBe(false)
    expect(existsSync(canari)).toBe(true)
    expect(await git(repo, 'worktree', 'list')).not.toContain('copies-de-taches')
  })

  it('garde la copie qui porte un fichier non publié, et ne décroche pas son fil', async () => {
    const { repo, retours } = await depot()
    const dossierDeDonnees = dirname(retours)
    const copie = await copieDeTache(repo, dossierDeDonnees, 'conv-2')
    writeFileSync(join(copie, 'travail.txt'), 'jamais passé par la porte\n')
    const decrocher = vi.fn()

    const bilan = await menageDesCopiesDeTaches({
      dossierDeDonnees,
      depot: repo,
      lireFils: () => [fil({ id: 'conv-2', projectPath: copie, copieDuFil: { chemin: copie } })],
      tourEnCours: () => false,
      decrocher,
      maintenant: () => MAINTENANT
    })

    expect(bilan.supprimees).toEqual([])
    expect(bilan.gardees).toEqual([
      { chemin: copie, raison: expect.stringContaining('travail.txt') }
    ])
    expect(decrocher).not.toHaveBeenCalled()
    expect(existsSync(join(copie, 'travail.txt'))).toBe(true)
  })

  it('garde la copie d’un fil dont un tour est en cours, et ne la touche pas', async () => {
    const { repo, retours } = await depot()
    const dossierDeDonnees = dirname(retours)
    const copie = await copieDeTache(repo, dossierDeDonnees, 'conv-3')

    const bilan = await menageDesCopiesDeTaches({
      dossierDeDonnees,
      depot: repo,
      lireFils: () => [fil({ id: 'conv-3', projectPath: copie, copieDuFil: { chemin: copie } })],
      tourEnCours: (id) => id === 'conv-3',
      decrocher: () => {},
      maintenant: () => MAINTENANT
    })

    expect(bilan.supprimees).toEqual([])
    expect(existsSync(copie)).toBe(true)
  })

  it('ne retire pas la copie d’un fil dont le calme n’est pas atteint', async () => {
    const { repo, retours } = await depot()
    const dossierDeDonnees = dirname(retours)
    const copie = await copieDeTache(repo, dossierDeDonnees, 'conv-4')

    const bilan = await menageDesCopiesDeTaches({
      dossierDeDonnees,
      depot: repo,
      lireFils: () => [
        fil({
          id: 'conv-4',
          updatedAt: MAINTENANT - H / 2,
          projectPath: copie,
          copieDuFil: { chemin: copie }
        })
      ],
      tourEnCours: () => false,
      decrocher: () => {},
      maintenant: () => MAINTENANT
    })

    expect(bilan.supprimees).toEqual([])
    expect(bilan.gardees).toEqual([{ chemin: copie, raison: 'conv-4 n’est pas fini' }])
    expect(existsSync(copie)).toBe(true)
  })

  // la passe horaire doit refaire seule l'entrée refusée ; sans la fiche qui la marque, elle ne touche pas à HEAD.
  /**
   * Le travail d'un fil dont la porte a été refusée parce qu'un fichier visé était modifié dans le dossier
   * partagé. Le fil change la ligne 1 de `b.txt`, le dossier partagé la ligne 3 sans commit : la porte refuse.
   * Puis l'utilisateur commite son fichier. Aucun tour du fil n'a repris.
   */
  async function travailRefuseParUnFichierVise(): Promise<{
    repo: string
    dossierDeDonnees: string
    copie: string
    avant: string
  }> {
    const { repo, retours } = await depot()
    const dossierDeDonnees = dirname(retours)
    writeFileSync(join(repo, 'b.txt'), 'un\ndeux\ntrois\n')
    await git(repo, 'add', 'b.txt')
    await git(repo, 'commit', '-m', 'b')
    const copie = await copieDeTache(repo, dossierDeDonnees, 'conv-7')
    writeFileSync(join(copie, 'b.txt'), 'UN\ndeux\ntrois\n')
    writeFileSync(join(repo, 'b.txt'), 'un\ndeux\nTROIS\n')
    expect(
      await entrerLeTravailDeLaCopie({
        dossierDeDonnees,
        depot: repo,
        tache: 'conv-7',
        sansDistant: true
      })
    ).toMatchObject({ ok: false, motif: 'modifie-non-commite' })
    expect(uneEntreeEstEnAttente(dossierDeDonnees, 'conv-7')).toBe(true)
    await git(repo, 'add', 'b.txt')
    await git(repo, 'commit', '-m', 'travail de l’utilisateur')
    return { repo, dossierDeDonnees, copie, avant: await git(repo, 'rev-parse', 'HEAD') }
  }

  it('la passe horaire fait entrer seule ce travail refusé, une fois le fichier visé commité, sans nouveau tour', async () => {
    const { repo, dossierDeDonnees, copie, avant } = await travailRefuseParUnFichierVise()

    const bilan = await menageDesCopiesDeTaches({
      dossierDeDonnees,
      depot: repo,
      lireFils: () => [
        fil({
          id: 'conv-7',
          updatedAt: MAINTENANT,
          projectPath: copie,
          copieDuFil: { chemin: copie }
        })
      ],
      tourEnCours: () => false,
      decrocher: () => {},
      maintenant: () => MAINTENANT
    })

    expect(await git(repo, 'rev-parse', 'HEAD')).not.toBe(avant)
    expect(await git(repo, 'show', 'HEAD:b.txt')).toBe('UN\ndeux\nTROIS')
    expect(uneEntreeEstEnAttente(dossierDeDonnees, 'conv-7')).toBe(false)
    expect(bilan.echecs).toEqual([])
    expect(existsSync(copie)).toBe(true)
  })

  it('la passe horaire annonce au fil que son travail refusé est entré dans main', async () => {
    const { repo, dossierDeDonnees, copie } = await travailRefuseParUnFichierVise()
    const annonces: string[] = []

    await menageDesCopiesDeTaches({
      dossierDeDonnees,
      depot: repo,
      lireFils: () => [
        fil({
          id: 'conv-7',
          updatedAt: MAINTENANT,
          projectPath: copie,
          copieDuFil: { chemin: copie }
        })
      ],
      tourEnCours: () => false,
      decrocher: () => {},
      maintenant: () => MAINTENANT,
      annoncerLaReprise: (tache) => annonces.push(tache)
    })

    expect(annonces).toEqual(['conv-7'])
  })

  it('la passe horaire n’annonce rien tant que ce travail reste refusé', async () => {
    const { repo, dossierDeDonnees, copie } = await travailRefuseParUnFichierVise()
    // Le fichier visé est de nouveau modifié sans commit dans le dossier partagé : la primitive refuse encore.
    writeFileSync(join(repo, 'b.txt'), 'un\ndeux\nENCORE\n')
    const annonces: string[] = []

    await menageDesCopiesDeTaches({
      dossierDeDonnees,
      depot: repo,
      lireFils: () => [
        fil({
          id: 'conv-7',
          updatedAt: MAINTENANT,
          projectPath: copie,
          copieDuFil: { chemin: copie }
        })
      ],
      tourEnCours: () => false,
      decrocher: () => {},
      maintenant: () => MAINTENANT,
      annoncerLaReprise: (tache) => annonces.push(tache)
    })

    expect(annonces).toEqual([])
    expect(uneEntreeEstEnAttente(dossierDeDonnees, 'conv-7')).toBe(true)
  })

  it('la passe horaire ne fait pas entrer ce travail pendant qu’un tour du fil tourne', async () => {
    const { repo, dossierDeDonnees, copie, avant } = await travailRefuseParUnFichierVise()

    await menageDesCopiesDeTaches({
      dossierDeDonnees,
      depot: repo,
      lireFils: () => [
        fil({
          id: 'conv-7',
          updatedAt: MAINTENANT,
          projectPath: copie,
          copieDuFil: { chemin: copie }
        })
      ],
      tourEnCours: (id) => id === 'conv-7',
      decrocher: () => {},
      maintenant: () => MAINTENANT
    })

    expect(await git(repo, 'rev-parse', 'HEAD')).toBe(avant)
    expect(await git(repo, 'show', 'HEAD:b.txt')).toBe('un\ndeux\nTROIS')
    expect(readFileSync(join(copie, 'b.txt'), 'utf8')).toBe('UN\ndeux\ntrois\n')
    expect(uneEntreeEstEnAttente(dossierDeDonnees, 'conv-7')).toBe(true)
  })
})
