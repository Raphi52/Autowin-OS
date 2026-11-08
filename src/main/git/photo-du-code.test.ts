import { execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { nomDeCopieDeFil } from '../../shared/copie-du-fil'
import { defaultGitRunner, type GitRunner } from '../runs/run-autoclose'
import {
  avancerLaBaseDuFil,
  lireLaBaseDuFil,
  ouvrirCopieDeLaPhoto,
  ouvrirLaCopieDuFil,
  photoDuTour,
  photographierLeCode as photographierAvecBudgetDuTour,
  refDeBaseDuFil,
  revenirAuCodeDuTour,
  refDePhoto
} from './photo-du-code'

/**
 * Aucun test de ce fichier ne porte sur le budget de 5 s du début de tour : sur une machine chargée,
 * il faisait rendre « pas de photo » en silence et le test échouait sur autre chose (
 * 2026-10-21 : « une photo plus vieille… sort » rouge à 18,8 s). Le budget reste celui du produit.
 */
const photographierLeCode = (
  entree: Parameters<typeof photographierAvecBudgetDuTour>[0]
): ReturnType<typeof photographierAvecBudgetDuTour> =>
  photographierAvecBudgetDuTour({ delaiMaxMs: 60_000, ...entree })

/**
 * REVENIR AU CODE D'UN TOUR (2026-10-21 — décision « branches-rewind », étape 2 : le
 * retour du code se fait dans une COPIE SÉPARÉE, jamais dans le dossier partagé).
 *
 * La branche depuis un message ne copiait que les messages, jamais l'état des fichiers, et le
 * `/rewind` de claude.exe ignore ce que les commandes ont écrit. La photo est prise au DÉBUT de
 * chaque tour, contenu compris, dans une référence git privée.
 *
 * Les entrées qui feraient échouer une version fausse :
 *  - le travail NON COMMITÉ de l'utilisateur : une photo prise par le VRAI index le mettrait en
 *    attente de commit (`git status` changerait) — l'index du dossier partagé appartient à tous ;
 *  - un fichier NOUVEAU écrit par une commande : il doit être dans la photo ;
 *  - un identifiant de fil qui porte « / » ou « .. » : il ne doit jamais devenir un nom de référence.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const run = promisify(execFile)
const git = async (cwd: string, ...args: string[]): Promise<string> =>
  (await run('git', args, { cwd })).stdout

const dossiers: string[] = []
afterEach(async () => {
  for (const dossier of dossiers.splice(0)) {
    // Le dépôt temporaire et ses copies vivent sous le même dossier : il part en entier.
    supprimerArbre(dossier)
  }
})

async function depot(): Promise<string> {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-photo-'))
  dossiers.push(racine)
  const repo = join(racine, 'depot')
  mkdirSync(repo)
  await git(repo, 'init', '-b', 'main')
  await git(repo, 'config', 'user.name', 'Test')
  await git(repo, 'config', 'user.email', 'test@example.invalid')
  writeFileSync(join(repo, 'a.txt'), 'version commitée\n')
  writeFileSync(join(repo, '.gitignore'), 'ignore/\n')
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-m', 'base')
  return repo
}

describe('refDePhoto — un identifiant de fil ne devient jamais un chemin de référence', () => {
  it('nomme la photo sous refs/autowin/tour/<fil>/<instant>', () => {
    expect(refDePhoto('conv-1038', 1_700)).toBe('refs/autowin/tour/conv-1038/1700')
  })
  it('refuse « / », « .. » et le vide', () => {
    expect(refDePhoto('conv/1038', 1)).toBeNull()
    expect(refDePhoto('..', 1)).toBeNull()
    expect(refDePhoto('', 1)).toBeNull()
  })
})

describe('photographierLeCode — au début du tour, sans toucher au dossier partagé', () => {
  it('garde le travail non commité ET les fichiers nouveaux, sans rien mettre en attente de commit', async () => {
    const repo = await depot()
    writeFileSync(join(repo, 'a.txt'), 'modifié, non commité\n')
    writeFileSync(join(repo, 'nouveau.txt'), 'écrit par une commande\n')
    mkdirSync(join(repo, 'ignore'))
    writeFileSync(join(repo, 'ignore', 'cache.bin'), 'ignoré\n')
    const avant = await git(repo, 'status', '--porcelain')

    const photo = await photographierLeCode({
      dossier: repo,
      conversationId: 'conv-1',
      quand: 1_000
    })

    expect(photo?.ref).toBe('refs/autowin/tour/conv-1/1000')
    expect(await git(repo, 'status', '--porcelain')).toBe(avant)
    expect(await git(repo, 'diff', '--cached', '--name-only')).toBe('')
    expect(await git(repo, 'stash', 'list')).toBe('')
    expect(await git(repo, 'show', `${photo!.sha}:a.txt`)).toBe('modifié, non commité\n')
    expect(await git(repo, 'show', `${photo!.sha}:nouveau.txt`)).toBe('écrit par une commande\n')
    await expect(git(repo, 'show', `${photo!.sha}:ignore/cache.bin`)).rejects.toThrow()
  })

  it('réutilise la même photo quand le code n’a pas changé depuis le tour précédent', async () => {
    const repo = await depot()

    const premiere = await photographierLeCode({
      dossier: repo,
      conversationId: 'conv-1',
      quand: 1_000
    })
    const seconde = await photographierLeCode({
      dossier: repo,
      conversationId: 'conv-1',
      quand: 2_000
    })

    expect(seconde?.sha).toBe(premiere?.sha)
    expect(seconde?.ref).toBe(premiere?.ref)
    expect(await git(repo, 'for-each-ref', '--format=%(refname)', 'refs/autowin/tour/conv-1/')).toBe(
      'refs/autowin/tour/conv-1/1000\n'
    )
  })

  it('un fichier nouveau trop gros reste hors de la photo', async () => {
    const repo = await depot()
    writeFileSync(join(repo, 'gros.bin'), 'x'.repeat(500))
    writeFileSync(join(repo, 'petit.txt'), 'ok\n')
    const photo = await photographierLeCode({
      dossier: repo,
      conversationId: 'conv-1',
      quand: 1_000,
      limiteOctets: 100
    })
    expect(await git(repo, 'show', `${photo!.sha}:petit.txt`)).toBe('ok\n')
    await expect(git(repo, 'show', `${photo!.sha}:gros.bin`)).rejects.toThrow()
  })

  it('garde les dernières photos du fil, jette les plus anciennes, ne touche pas aux autres fils', async () => {
    const repo = await depot()
    const garde = { parFil: 2, ageMaxMs: 1_000_000 }
    await photographierLeCode({
      dossier: repo,
      conversationId: 'conv-2',
      quand: 900,
      conserver: garde
    })
    for (const quand of [1_000, 2_000, 3_000])
      await photographierLeCode({
        dossier: repo,
        conversationId: 'conv-1',
        quand,
        conserver: garde
      })
    const refs = (await git(repo, 'for-each-ref', '--format=%(refname)', 'refs/autowin/tour/'))
      .trim()
      .split('\n')
      .sort()
    expect(refs).toEqual([
      'refs/autowin/tour/conv-1/1000',
      'refs/autowin/tour/conv-2/900'
    ])
  })

  it('une photo plus vieille que la durée de garde sort, même seule', async () => {
    const repo = await depot()
    await photographierLeCode({ dossier: repo, conversationId: 'conv-2', quand: 1_000 })
    await photographierLeCode({
      dossier: repo,
      conversationId: 'conv-1',
      quand: 50_000,
      conserver: { parFil: 10, ageMaxMs: 10_000 }
    })
    const refs = await git(repo, 'for-each-ref', '--format=%(refname)', 'refs/autowin/tour/')
    expect(refs.trim().split('\n')).toEqual(['refs/autowin/tour/conv-1/50000'])
  })

  it('hors dépôt git, ou fil au nom invalide : pas de photo, et aucune erreur', async () => {
    const hors = mkdtempSync(join(tmpdir(), 'autowin-photo-hors-'))
    dossiers.push(hors)
    await expect(
      photographierLeCode({ dossier: hors, conversationId: 'conv-1' })
    ).resolves.toBeNull()
    const repo = await depot()
    await expect(
      photographierLeCode({ dossier: repo, conversationId: '../conv', quand: 1 })
    ).resolves.toBeNull()
  })
})

describe('photoDuTour — la photo prise au début du tour d’un message', () => {
  it('la dernière photo jusqu’au message, après le message précédent', async () => {
    const repo = await depot()
    for (const quand of [1_000, 2_000, 3_000])
      await photographierLeCode({ dossier: repo, conversationId: 'conv-1', quand })
    expect(
      (await photoDuTour({ dossier: repo, conversationId: 'conv-1', jusqua: 2_500 }))?.quand
    ).toBe(1_000)
    // Bornes : l'heure du message est incluse, celle du message précédent exclue.
    expect(
      (await photoDuTour({ dossier: repo, conversationId: 'conv-1', jusqua: 2_000, apres: 1_000 }))
        ?.quand
    ).toBe(1_000)
    expect(
      (await photoDuTour({ dossier: repo, conversationId: 'conv-1', jusqua: 2_500, apres: 2_000 }))
        ?.quand
    ).toBe(1_000)
    expect(await photoDuTour({ dossier: repo, conversationId: 'conv-9', jusqua: 9_999 })).toBeNull()
  })
})

describe('ouvrirCopieDeLaPhoto — le code du tour, dans une copie séparée', () => {
  it('la copie porte le code de la photo ; le dossier partagé n’a pas bougé', async () => {
    const repo = await depot()
    writeFileSync(join(repo, 'a.txt'), 'état au début du tour\n')
    writeFileSync(join(repo, 'nouveau.txt'), 'nouveau\n')
    const photo = await photographierLeCode({
      dossier: repo,
      conversationId: 'conv-1',
      quand: 1_000
    })
    // Le tour (ou un autre fil) continue d'écrire dans le dossier partagé.
    writeFileSync(join(repo, 'a.txt'), 'état après le tour\n')
    const statutPartage = await git(repo, 'status', '--porcelain')

    const destination = join(repo, '..', 'retour__conv-1-1000')
    const copie = await ouvrirCopieDeLaPhoto({ dossier: repo, sha: photo!.sha, destination })

    expect(copie).toEqual({ chemin: destination, deja: false })
    // Les fins de ligne suivent la règle d'extraction du poste (core.autocrlf), comme toute copie.
    const lu = (chemin: string): string => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')
    expect(lu(join(destination, 'a.txt'))).toBe('état au début du tour\n')
    expect(lu(join(destination, 'nouveau.txt'))).toBe('nouveau\n')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('état après le tour\n')
    expect(await git(repo, 'status', '--porcelain')).toBe(statutPartage)
    // Aucun lien vers les dépendances : retirer cette copie ne peut pas atteindre node_modules.
    expect(existsSync(join(destination, 'node_modules'))).toBe(false)

    await expect(
      ouvrirCopieDeLaPhoto({ dossier: repo, sha: photo!.sha, destination })
    ).resolves.toEqual({ chemin: destination, deja: true })
  })
})

/*
 * CHEMINS LONGS (2026-10-22). Partout ailleurs, Autowin ouvre ses copies par
 * `git -c core.longpaths=true worktree add` (store/worktree-manager.ts, comparaison-a-la-base.ts) ;
 * « Revenir à ce tour » et l'ouverture d'une copie de fil le faisaient sans. Git pour Windows refuse alors tout
 * fichier dont le chemin COMPLET dépasse 260 caractères (« Filename too long ») : la copie d'un
 * dépôt aux chemins profonds, ouverte un peu loin de la racine, échouait.
 *
 * Mesuré ce jour (git 2.54.0.windows.1, LongPathsEnabled = 0) : avec l'option, une destination de
 * 215 caractères accueille un fichier à 311 ; à partir de 216, git refuse la destination ELLE-MÊME
 * (« '$GIT_DIR' too big » : GIT_DIR = destination + « /.git », borné à PATH_MAX − 40 = 220), avec
 * ou sans l'option. Une destination de plus de 260 caractères ne peut donc pas réussir : l'avis
 * doit alors le dire en une phrase.
 *
 * Le dépôt de test porte `core.longpaths=false` dans SA config : le test reste rouge sans le
 * correctif, même sur un poste qui active l'option globalement. L'option passée en ligne de
 * commande l'emporte — Autowin ne touche pas à la config de l'utilisateur.
 */
describe('ouvrirCopieDeLaPhoto — des fichiers à plus de 260 caractères dans la copie', () => {
  const FICHIER_PROFOND = [
    'src',
    'renderer',
    'src',
    'components',
    'conversation-et-fil',
    `ChatView.${'cas-de-progression-apres-orientation-'.repeat(2)}longue.test.tsx`
  ]

  async function depotAuxChemins(): Promise<{ repo: string; racine: string; sha: string }> {
    const repo = await depot()
    await git(repo, 'config', 'core.longpaths', 'false')
    mkdirSync(join(repo, ...FICHIER_PROFOND.slice(0, -1)), { recursive: true })
    writeFileSync(join(repo, ...FICHIER_PROFOND), 'au fond\n')
    const photo = await photographierLeCode({ dossier: repo, conversationId: 'conv-1', quand: 600 })
    // Forme longue du chemin (C:\Users\nom.complet\…) : c'est elle que git mesure.
    return { repo, racine: realpathSync.native(join(repo, '..')), sha: photo!.sha }
  }

  /** Un chemin de `longueur` caractères exactement sous `base`, en segments de 50 au plus. */
  function cheminDe(base: string, longueur: number): string {
    let chemin = base
    let restant = longueur - chemin.length
    if (restant < 2) throw new Error(`base déjà trop longue : ${chemin.length} caractères`)
    while (restant > 0) {
      // Un segment coûte son séparateur : on ne laisse jamais un reste de 1, impossible à combler.
      const segment = restant <= 51 ? restant - 1 : restant === 52 ? 49 : 50
      chemin = join(chemin, 'd'.repeat(segment))
      restant = longueur - chemin.length
    }
    return chemin
  }

  const lu = (chemin: string): string => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')

  it('« Revenir à ce tour » : destination de 200 caractères, fichier à plus de 260 — la copie s’ouvre', async () => {
    const { repo, racine, sha } = await depotAuxChemins()
    const destination = cheminDe(join(racine, 'retours'), 200)
    const fichier = join(destination, ...FICHIER_PROFOND)
    expect(destination.length).toBe(200)
    expect(fichier.length).toBeGreaterThan(260)

    const copie = await ouvrirCopieDeLaPhoto({ dossier: repo, sha, destination })

    expect(copie).toEqual({ chemin: destination, deja: false })
    expect(lu(fichier)).toBe('au fond\n')
  })

  it('copie de fil aux fichiers à plus de 260 : ouverte par core.longpaths', async () => {
    const { repo, racine } = await depotAuxChemins()
    const dossierDesCopies = cheminDe(join(racine, 'copies'), 200)
    const vrai = await defaultGitRunner()
    const ajouts: string[][] = []
    const runGit: GitRunner = (args, cwd, options) => {
      if (args.includes('worktree') && args.includes('add')) ajouts.push(args)
      return vrai(args, cwd, options)
    }

    const copie = await ouvrirLaCopieDuFil({
      dossier: repo,
      conversationId: 'conv-1',
      dossierDesCopies,
      quand: 5_000,
      runGit
    })

    expect(copie).toMatchObject({ ok: true })
    const { chemin } = copie as { chemin: string }
    expect(join(chemin, ...FICHIER_PROFOND).length).toBeGreaterThan(260)
    expect(lu(join(chemin, ...FICHIER_PROFOND))).toBe('au fond\n')
    // Hors Windows, aucun chemin n'est « trop long » : ce contrôle garde le correctif partout.
    expect(ajouts).toHaveLength(1)
    for (const args of ajouts) expect(args.slice(0, 2)).toEqual(['-c', 'core.longpaths=true'])
  })

  it('destination ELLE-MÊME de plus de 260 caractères : git la refuse, l’avis le dit en une phrase', async () => {
    const { repo, racine, sha } = await depotAuxChemins()
    const destination = cheminDe(join(racine, 'retours'), 300)
    expect(destination.length).toBe(300)

    const erreur = await ouvrirCopieDeLaPhoto({ dossier: repo, sha, destination }).then(
      () => null,
      (raison: unknown) => raison as Error
    )

    // Git pour Windows refuse tout GIT_DIR au-delà de 220 caractères ; ailleurs, la copie s'ouvre.
    if (process.platform === 'win32') {
      expect(erreur?.message).toBe(
        'La copie séparée du code n’a pas pu être créée : dossier de la copie trop long pour git (215 caractères au plus).'
      )
      expect(existsSync(destination)).toBe(false)
    } else {
      expect(erreur).toBeNull()
    }
  })
})

/*
 * L'ÉCHEC DE LA COPIE SE DIT EN UNE PHRASE (2026-10-22). Constaté à l'écran : un
 * `git worktree add` en « Filename too long » remplissait l'avis du chat de TOUTE la sortie de git
 * (la commande, puis une ligne `error: unable to create file …` par fichier, mêlée aux « Updating
 * files: NN% ») — un écran entier, la cause noyée dedans. L'erreur ci-dessous a la forme exacte de
 * celle d'execFile : `Command failed: <commande>` puis la sortie, et `stderr`, `code` à part.
 */
describe('ouvrirCopieDeLaPhoto — un échec de git se dit en une phrase, avec sa cause', () => {
  function echecDeGit(args: readonly string[], sortie: string): Error {
    return Object.assign(new Error(`Command failed: git ${args.join(' ')}\n${sortie}`), {
      code: 128,
      stderr: sortie,
      stdout: ''
    })
  }

  /** Le vrai git, sauf `worktree add`, qui échoue avec la sortie donnée. */
  async function gitQuiEchoueALaCopie(
    sortie: string
  ): Promise<{ runGit: GitRunner; erreurs: Error[] }> {
    const vrai = await defaultGitRunner()
    const erreurs: Error[] = []
    const runGit: GitRunner = async (args, cwd, options) => {
      if (args.includes('worktree') && args.includes('add')) {
        const erreur = echecDeGit(args, sortie)
        erreurs.push(erreur)
        throw erreur
      }
      return vrai(args, cwd, options)
    }
    return { runGit, erreurs }
  }

  const raisonDe = (promesse: Promise<unknown>): Promise<Error> =>
    promesse.then(
      () => {
        throw new Error('la copie aurait dû échouer')
      },
      (erreur: unknown) => erreur as Error
    )

  const SORTIE_CHEMIN_TROP_LONG = [
    'Preparing worktree (detached HEAD 9d9adf0e)',
    ...Array.from({ length: 80 }, (_, rang) =>
      rang % 10 === 9
        ? `Updating files:  ${60 + rang / 10}% (${2400 + rang}/3839)`
        : `error: unable to create file src/renderer/src/components/ChatView.cas-${rang}.test.tsx: Filename too long`
    )
  ].join('\n')

  it('« Filename too long » sur le bouton « Revenir à ce tour » : une phrase, la cause, rien de brut', async () => {
    const repo = await depot()
    const photo = await photographierLeCode({ dossier: repo, conversationId: 'conv-1', quand: 600 })
    const { runGit, erreurs } = await gitQuiEchoueALaCopie(SORTIE_CHEMIN_TROP_LONG)

    const erreur = await raisonDe(
      revenirAuCodeDuTour({
        conversationId: 'conv-1',
        messages: [{ role: 'user', ts: 1_000, messageId: 'm1' }],
        messageId: 'm1',
        dossier: repo,
        dossierDesRetours: join(repo, '..', 'retours'),
        runGit
      })
    )

    expect(photo).not.toBeNull()
    expect(erreur.message).toBe(
      'La copie séparée du code n’a pas pu être créée : chemin trop long pour Windows (plus de 260 caractères).'
    )
    // La sortie brute n'est pas perdue : elle reste attachée à l'erreur, pour qui diagnostique.
    expect(erreur.cause).toBe(erreurs[0])
  })

  it.each([
    ['fatal: invalid reference: 9d9adf0e', 'la photo n’existe plus dans le dépôt'],
    ["fatal: '/d/retours/retour__conv-1-600' already exists", 'le dossier de la copie existe déjà'],
    ['error: unable to write file src/a.ts: No space left on device', 'disque plein'],
    [
      'error: unable to create file src/a.ts: Permission denied',
      'accès refusé à l’emplacement de la copie'
    ],
    [
      "fatal: Unable to create 'D:/depot/.git/index.lock': File exists.",
      'un autre processus git verrouille le dépôt (fichier .lock)'
    ]
  ])('cause connue « %s » → « %s »', async (sortie, cause) => {
    const repo = await depot()
    const { runGit } = await gitQuiEchoueALaCopie(
      `Preparing worktree (detached HEAD 9d9adf0e)\n${sortie}`
    )
    const erreur = await raisonDe(
      ouvrirCopieDeLaPhoto({
        dossier: repo,
        sha: 'HEAD',
        destination: join(repo, '..', 'c'),
        runGit
      })
    )
    expect(erreur.message).toBe(`La copie séparée du code n’a pas pu être créée : ${cause}.`)
  })

  it('cause inconnue : la ligne de git qui dit pourquoi, sur UNE ligne et bornée', async () => {
    const repo = await depot()
    const longue = `fatal: quelque chose d’inattendu ${'x'.repeat(400)}`
    const { runGit } = await gitQuiEchoueALaCopie(
      ['Preparing worktree (detached HEAD 9d9adf0e)', 'Updating files:  12% (1/8)', longue].join(
        '\n'
      )
    )
    const erreur = await raisonDe(
      ouvrirCopieDeLaPhoto({
        dossier: repo,
        sha: 'HEAD',
        destination: join(repo, '..', 'c'),
        runGit
      })
    )
    expect(erreur.message).toMatch(
      /^La copie séparée du code n’a pas pu être créée : git a répondu « quelque chose d’inattendu x+… »\.$/u
    )
    expect(erreur.message).not.toContain('\n')
    expect(erreur.message).not.toContain('Command failed')
    expect(erreur.message.length).toBeLessThanOrEqual(240)
  })
})

describe('revenirAuCodeDuTour — le bouton « Revenir à ce tour » d’un message', () => {
  const fil = [
    { role: 'user', content: 'premier', ts: 1_000, messageId: 'm1' },
    { role: 'assistant', content: 'r1', ts: 1_100, messageId: 'm2' },
    { role: 'user', content: 'second', ts: 3_000, messageId: 'm3' },
    { role: 'assistant', content: 'r2', ts: 3_100, messageId: 'm4' }
  ]

  /*
   * ORDRE RÉEL (2026-10-22) : la photo est prise AVANT le tour (`index.ts`,
   * `photographierLeCode` avant `lancerTour`) et l'heure du message n'est posée qu'ensuite, par
   * `beginTurn` (`store/conversations.ts`). Mesuré sur 5 vrais tours : photo 393 à 613 ms AVANT
   * son message. Ces tests posaient l'ordre inverse (photo 50 ms après) : ils étaient verts
   * pendant que la vraie fonction ne retrouvait aucune photo, 0 sur 5.
   */
  it('chaque message rouvre la photo de SON tour, pas celle du tour suivant', async () => {
    const repo = await depot()
    writeFileSync(join(repo, 'a.txt'), 'tour 1\n')
    await photographierLeCode({ dossier: repo, conversationId: 'conv-1', quand: 600 })
    writeFileSync(join(repo, 'a.txt'), 'tour 2\n')
    await photographierLeCode({ dossier: repo, conversationId: 'conv-1', quand: 2_600 })
    const retours = join(repo, '..', 'retours')

    const premier = await revenirAuCodeDuTour({
      conversationId: 'conv-1',
      messages: fil,
      messageId: 'm1',
      dossier: repo,
      dossierDesRetours: retours
    })
    expect(premier).toMatchObject({ ok: true, quand: 600, deja: false })
    const lu = (chemin: string): string => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')
    expect(lu(join((premier as { chemin: string }).chemin, 'a.txt'))).toBe('tour 1\n')

    const second = await revenirAuCodeDuTour({
      conversationId: 'conv-1',
      messages: fil,
      messageId: 'm3',
      dossier: repo,
      dossierDesRetours: retours
    })
    expect(second).toMatchObject({ ok: true, quand: 2_600 })
    expect(lu(join((second as { chemin: string }).chemin, 'a.txt'))).toBe('tour 2\n')
  })

  it('une photo prise ENTRE deux tours (ouverture d’une copie de fil) ne remplace pas celle du tour', async () => {
    // L'ouverture d'une copie de fil photographie sous le même préfixe que les tours (`ouvrirLaCopieDuFil`).
    const repo = await depot()
    writeFileSync(join(repo, 'a.txt'), 'tour 1\n')
    await photographierLeCode({ dossier: repo, conversationId: 'conv-1', quand: 600 })
    writeFileSync(join(repo, 'a.txt'), 'après le tour 1\n')
    await photographierLeCode({ dossier: repo, conversationId: 'conv-1', quand: 2_000 })
    writeFileSync(join(repo, 'a.txt'), 'tour 2\n')
    await photographierLeCode({ dossier: repo, conversationId: 'conv-1', quand: 2_600 })
    const retours = join(repo, '..', 'retours')
    const revenir = (messageId: string): Promise<unknown> =>
      revenirAuCodeDuTour({
        conversationId: 'conv-1',
        messages: fil,
        messageId,
        dossier: repo,
        dossierDesRetours: retours
      })

    expect(await revenir('m1')).toMatchObject({ ok: true, quand: 600 })
    expect(await revenir('m3')).toMatchObject({ ok: true, quand: 2_600 })
  })

  it('un tour sans photo (antérieur à la fonction) le DIT, sans rien créer', async () => {
    const repo = await depot()
    const retours = join(repo, '..', 'retours')
    const retour = await revenirAuCodeDuTour({
      conversationId: 'conv-1',
      messages: fil,
      messageId: 'm1',
      dossier: repo,
      dossierDesRetours: retours
    })
    expect(retour).toMatchObject({ ok: false })
    expect((retour as { raison: string }).raison).toMatch(/aucune photo/i)
    expect(existsSync(retours)).toBe(false)
  })

  it('une réponse de l’agent n’est pas un point de retour', async () => {
    const repo = await depot()
    const retour = await revenirAuCodeDuTour({
      conversationId: 'conv-1',
      messages: fil,
      messageId: 'm2',
      dossier: repo,
      dossierDesRetours: join(repo, '..', 'retours')
    })
    expect(retour).toMatchObject({ ok: false })
  })
})

describe('revenirAuCodeDuTour — jamais la photo d’un AUTRE tour', () => {
  it('seul le tour suivant a une photo : le premier message n’en a pas', async () => {
    const repo = await depot()
    // Prise 400 ms AVANT le second message, donc APRÈS le premier : c'est elle qu'attrapait
    // l'ancienne recherche (« la première photo à partir du message »).
    await photographierLeCode({ dossier: repo, conversationId: 'conv-1', quand: 2_600 })
    const retour = await revenirAuCodeDuTour({
      conversationId: 'conv-1',
      messages: [
        { role: 'user', ts: 1_000, messageId: 'm1' },
        { role: 'assistant', ts: 1_100, messageId: 'm2' },
        { role: 'user', ts: 3_000, messageId: 'm3' }
      ],
      messageId: 'm1',
      dossier: repo,
      dossierDesRetours: join(repo, '..', 'retours')
    })
    expect(retour).toMatchObject({ ok: false })
  })
})

describe('ouvrirLaCopieDuFil — la photo d’ouverture', () => {
  it('machine chargée : l’ouverture attend sa photo au-delà des 5 s du début de tour', async () => {
    // 2026-10-21 : tombé rouge en suite chargée (photo abandonnée à 5 s, « son dossier n’est pas
    // un dépôt git… »), vert 3 fois sur 3 seul. Git est ici retenu le temps que l'horloge dépasse
    // 5 s, puis relâché : la photo doit aboutir.
    const repo = await depot()
    const vraiGit = await defaultGitRunner()
    let relacher!: () => void
    const porte = new Promise<void>((resolve) => {
      relacher = resolve
    })
    const lent: GitRunner = async (args, cwd, options) => {
      await porte
      return vraiGit(args, cwd, options)
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const enCours = ouvrirLaCopieDuFil({
        dossier: repo,
        conversationId: 'conv-1',
        dossierDesCopies: join(repo, '..', 'copies-lentes'),
        quand: 6_000,
        runGit: lent
      })
      await vi.advanceTimersByTimeAsync(5_001)
      vi.useRealTimers()
      relacher()
      expect(await enCours).toMatchObject({ ok: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('hors dépôt git : refusé avec la raison, aucune copie', async () => {
    const hors = mkdtempSync(join(tmpdir(), 'autowin-copie-hors-'))
    dossiers.push(hors)
    const copie = await ouvrirLaCopieDuFil({
      dossier: hors,
      conversationId: 'conv-1',
      dossierDesCopies: join(hors, 'copies-de-fil')
    })
    expect(copie).toMatchObject({ ok: false })
    expect(existsSync(join(hors, 'copies-de-fil'))).toBe(false)
  })
})

/*
 * LA BASE D'UN FIL EN COPIE. Un fil qui travaille dans sa copie publie par une porte (« Garder ») ce
 * qu'il a changé depuis sa BASE. Cette base était la photo d'ouverture de la copie, rangée parmi les
 * photos des tours : le ménage ordinaire (10 par fil, 14 jours) l'emportait, et la porte refusait
 * faute de base. Les entrées qui font échouer une version fausse :
 *  - 11 tours de plus du même fil (11 photos nouvelles) : la photo d'ouverture sort des 10 gardées ;
 *  - une horloge avancée de 15 jours : elle sort par l'âge, et le ramasse-miettes de git emporte
 *    ensuite tout commit que plus rien ne nomme ;
 *  - un second passage de la porte : s'il repart de la base d'ouverture, il republie le premier.
 * fix-ok: rouges sur le code d'avant (5 sur 5, fonctions absentes), puis verts ; chacun de trois
 * défauts réinjectés — base rangée parmi les photos, base lue non vérifiée, base qui n'avance pas —
 * rend son test rouge. Les éditions suivantes n'ont touché que la mise en forme (prettier/prettier).
 */
describe('base du fil en copie — elle survit au ménage des photos et avance à chaque passage', () => {
  const JOUR_MS = 24 * 60 * 60 * 1000

  const photosDuFil = async (repo: string, fil: string): Promise<string[]> =>
    (await git(repo, 'for-each-ref', '--format=%(refname)', `refs/autowin/tour/${fil}/`))
      .split(/\r?\n/u)
      .filter(Boolean)

  const lignes = (sortie: string): string[] => sortie.split(/\r?\n/u).filter(Boolean)

  /** L'arbre de ce que porte la copie maintenant, par une copie de son index : comme la porte. */
  async function arbreDeLaCopie(copie: string): Promise<string> {
    const temporaire = mkdtempSync(join(tmpdir(), 'autowin-porte-'))
    dossiers.push(temporaire)
    const env = { ...process.env, GIT_INDEX_FILE: join(temporaire, 'index') }
    await run('git', ['add', '-A', '--', '.'], { cwd: copie, env })
    return (await run('git', ['write-tree'], { cwd: copie, env })).stdout.trim()
  }

  /**
   * UN PASSAGE DE LA PORTE, réduit à ce qu'elle fait du dépôt : l'écart de la copie depuis la base,
   * fusionné à trois voies dans main (base de fusion = la base du fil), puis commité dans main.
   * Rend le commit de ce qui a été publié (l'arbre de la copie au passage) et les fichiers de l'écart.
   */
  async function passerLaPorte(
    repo: string,
    copie: string,
    base: string
  ): Promise<{ publie: string; fichiers: string[] }> {
    const arbre = await arbreDeLaCopie(copie)
    const fichiers = lignes(await git(copie, 'diff', '--name-only', '--no-renames', base, arbre))
    const publie = (
      await git(copie, 'commit-tree', arbre, '-p', base, '-m', 'passage de la porte')
    ).trim()
    const fusion = lignes(
      await git(repo, 'merge-tree', '--write-tree', `--merge-base=${base}`, 'HEAD', publie)
    )[0]
    await git(repo, 'read-tree', '-m', '-u', 'HEAD', fusion)
    await git(repo, 'commit', '-q', '-m', 'porte')
    return { publie, fichiers }
  }

  it('nomme la base sous refs/autowin/base-de-fil/<fil>, hors des photos que le ménage vise', () => {
    expect(refDeBaseDuFil('conv-1038')).toBe('refs/autowin/base-de-fil/conv-1038')
    expect(refDeBaseDuFil('conv/1038')).toBeNull()
    expect(refDeBaseDuFil('..')).toBeNull()
    expect(refDeBaseDuFil('')).toBeNull()
  })

  it('un fil qui a une base de copie la garde après 11 tours, puis avec une horloge avancée de 15 jours', async () => {
    const repo = await depot()
    writeFileSync(join(repo, 'a.txt'), 'état à l’ouverture de la copie\n')
    let quand = 1_000
    const ouverture = await photographierLeCode({ dossier: repo, conversationId: 'conv-1', quand })
    expect(
      await avancerLaBaseDuFil({
        dossier: repo,
        conversationId: 'conv-1',
        depuis: null,
        vers: ouverture!.sha
      })
    ).toEqual({ ok: true, sha: ouverture!.sha })

    for (let tour = 1; tour <= 11; tour += 1) {
      quand += 60_000
      writeFileSync(join(repo, 'a.txt'), `tour ${tour}\n`)
      const photo = await photographierLeCode({ dossier: repo, conversationId: 'conv-1', quand })
      // Une photo NOUVELLE à chaque tour : le code a changé, rien n'est réutilisé.
      expect(photo?.ref).toBe(refDePhoto('conv-1', quand))
    }
    // Le ménage ordinaire n'a pas changé : 10 photos gardées, celle de l'ouverture est sortie.
    const apresOnzeTours = await photosDuFil(repo, 'conv-1')
    expect(apresOnzeTours).toHaveLength(10)
    expect(apresOnzeTours).not.toContain(refDePhoto('conv-1', 1_000))
    expect(await lireLaBaseDuFil({ dossier: repo, conversationId: 'conv-1' })).toBe(ouverture!.sha)

    quand += 15 * JOUR_MS
    writeFileSync(join(repo, 'a.txt'), 'quinze jours plus tard\n')
    await photographierLeCode({ dossier: repo, conversationId: 'conv-1', quand })
    expect(await photosDuFil(repo, 'conv-1')).toEqual([refDePhoto('conv-1', quand)])
    // Plus rien d'autre que la base ne nomme le commit d'ouverture : git ne doit pas l'emporter.
    await git(repo, 'gc', '--prune=now', '--quiet')
    expect(await lireLaBaseDuFil({ dossier: repo, conversationId: 'conv-1' })).toBe(ouverture!.sha)
    expect(await git(repo, 'show', `${ouverture!.sha}:a.txt`)).toBe(
      'état à l’ouverture de la copie\n'
    )
  })

  it('après un passage de la porte, la base avance à l’état publié : la porte suivante ne publie que l’écart depuis ce passage', async () => {
    const repo = await depot()
    const ouverture = await photographierLeCode({
      dossier: repo,
      conversationId: 'conv-1',
      quand: 1_000
    })
    const copie = join(repo, '..', 'copie-conv-1')
    await ouvrirCopieDeLaPhoto({ dossier: repo, sha: ouverture!.sha, destination: copie })
    // La copie lit et fait avancer la même base que le dépôt : les références sont partagées.
    await avancerLaBaseDuFil({
      dossier: copie,
      conversationId: 'conv-1',
      depuis: null,
      vers: ouverture!.sha
    })

    writeFileSync(join(copie, 'a.txt'), 'changé avant le premier passage\n')
    const base1 = await lireLaBaseDuFil({ dossier: copie, conversationId: 'conv-1' })
    expect(base1).toBe(ouverture!.sha)
    const passage1 = await passerLaPorte(repo, copie, base1!)
    expect(passage1.fichiers).toEqual(['a.txt'])
    expect(
      await avancerLaBaseDuFil({
        dossier: copie,
        conversationId: 'conv-1',
        depuis: base1,
        vers: passage1.publie
      })
    ).toEqual({ ok: true, sha: passage1.publie })
    expect(await lireLaBaseDuFil({ dossier: repo, conversationId: 'conv-1' })).toBe(passage1.publie)

    // Entre les deux passages, main reçoit le travail d'un autre fil, que la copie n'a pas.
    writeFileSync(join(repo, 'autre.txt'), 'travail d’un autre fil\n')
    await git(repo, 'add', 'autre.txt')
    await git(repo, 'commit', '-q', '-m', 'autre fil')
    writeFileSync(join(copie, 'b.txt'), 'ajouté avant le second passage\n')

    const base2 = await lireLaBaseDuFil({ dossier: copie, conversationId: 'conv-1' })
    // Depuis la base d'ouverture, l'écart republierait le premier passage avec le second.
    expect(
      lignes(await git(copie, 'diff', '--name-only', ouverture!.sha, await arbreDeLaCopie(copie)))
    ).toEqual(['a.txt', 'b.txt'])
    const avantPassage2 = (await git(repo, 'rev-parse', 'HEAD')).trim()
    const passage2 = await passerLaPorte(repo, copie, base2!)

    expect(passage2.fichiers).toEqual(['b.txt'])
    expect(lignes(await git(repo, 'diff', '--name-only', avantPassage2, 'HEAD'))).toEqual(['b.txt'])
    // Le travail de l'autre fil, absent de la copie, n'est pas défait par la fusion.
    expect(await git(repo, 'show', 'HEAD:autre.txt')).toBe('travail d’un autre fil\n')
    expect(await git(repo, 'show', 'HEAD:a.txt')).toBe('changé avant le premier passage\n')
  })

  it('une base déjà posée ne se repose pas ; une base lue périmée n’avance pas — la base reste intacte', async () => {
    const repo = await depot()
    const premiere = (await git(repo, 'rev-parse', 'HEAD')).trim()
    writeFileSync(join(repo, 'a.txt'), 'seconde\n')
    await git(repo, 'commit', '-q', '-am', 'seconde')
    const seconde = (await git(repo, 'rev-parse', 'HEAD')).trim()
    const fil = { dossier: repo, conversationId: 'conv-1' }

    // Jumeau accepté : aucune base encore, la première se pose.
    expect(await avancerLaBaseDuFil({ ...fil, depuis: null, vers: premiere })).toEqual({
      ok: true,
      sha: premiere
    })
    const reposee = await avancerLaBaseDuFil({ ...fil, depuis: null, vers: seconde })
    expect(reposee).toMatchObject({ ok: false })
    expect((reposee as { raison: string }).raison).toMatch(/déjà une base/u)
    expect(await lireLaBaseDuFil(fil)).toBe(premiere)

    // Refus : la porte a lu `seconde`, mais la base est encore `premiere`.
    const perimee = await avancerLaBaseDuFil({ ...fil, depuis: seconde, vers: seconde })
    expect(perimee).toMatchObject({ ok: false })
    expect((perimee as { raison: string }).raison).toContain(premiere)
    expect(await lireLaBaseDuFil(fil)).toBe(premiere)
    // Jumeau accepté : la base lue est bien la base actuelle.
    expect(await avancerLaBaseDuFil({ ...fil, depuis: premiere, vers: seconde })).toEqual({
      ok: true,
      sha: seconde
    })
  })

  it('refuse ce qui n’est pas un commit, et un fil au nom invalide ; sans base, la lecture rend null', async () => {
    const repo = await depot()
    const commit = (await git(repo, 'rev-parse', 'HEAD')).trim()
    const arbre = (await git(repo, 'rev-parse', 'HEAD^{tree}')).trim()
    const fil = { dossier: repo, conversationId: 'conv-1' }

    expect(await lireLaBaseDuFil(fil)).toBeNull()
    expect(await avancerLaBaseDuFil({ ...fil, depuis: null, vers: arbre })).toMatchObject({
      ok: false
    })
    expect(await avancerLaBaseDuFil({ ...fil, depuis: null, vers: 'pas-un-sha' })).toMatchObject({
      ok: false
    })
    expect(
      await avancerLaBaseDuFil({
        dossier: repo,
        conversationId: '../conv',
        depuis: null,
        vers: commit
      })
    ).toMatchObject({ ok: false })
    expect(await lireLaBaseDuFil({ dossier: repo, conversationId: '../conv' })).toBeNull()
    expect(await lireLaBaseDuFil(fil)).toBeNull()
    expect(await git(repo, 'for-each-ref', 'refs/autowin/')).toBe('')

    const hors = mkdtempSync(join(tmpdir(), 'autowin-base-hors-'))
    dossiers.push(hors)
    expect(await lireLaBaseDuFil({ dossier: hors, conversationId: 'conv-1' })).toBeNull()
    expect(
      await avancerLaBaseDuFil({
        dossier: hors,
        conversationId: 'conv-1',
        depuis: null,
        vers: commit
      })
    ).toMatchObject({ ok: false })
    // Jumeau accepté : le même commit, dans le dépôt, se pose.
    expect(await avancerLaBaseDuFil({ ...fil, depuis: null, vers: commit })).toEqual({
      ok: true,
      sha: commit
    })
  })
})

/*
 * LA COPIE D'UN FIL. Un fil d'AutoWinOS travaille dans SA copie, ouverte par une photo puis
 * une copie détachée à cette photo, puis sa porte vers main la publie depuis
 * sa BASE. Les entrées qui font échouer une version fausse :
 *  - un nom de copie que le ménage ne lit pas : il ne la reconnaîtrait pas ;
 *  - une copie ouverte sans base : la porte refuserait au premier tour (« base absente ») ;
 *  - une copie sans `node_modules` : le fil ne pourrait lancer aucun test (décision 2-A, lien partagé) ;
 *  - un chemin de 216 caractères : git pour Windows le refuse après coup, la photo déjà prise.
 */
describe('ouvrirLaCopieDuFil — un fil d’AutoWinOS dans sa propre copie', () => {
  it('ouvre la copie sous copies-de-fil/<fil>, pose sa première base et relie les dépendances', async () => {
    const repo = await depot()
    mkdirSync(join(repo, 'node_modules', 'paquet'), { recursive: true })
    writeFileSync(join(repo, 'node_modules', 'paquet', 'index.js'), 'module.exports = 1\n')
    writeFileSync(join(repo, '.gitignore'), 'ignore/\nnode_modules/\n')
    writeFileSync(join(repo, 'a.txt'), 'travail non commité d’un autre fil\n')
    const copies = join(repo, '..', 'copies-de-fil')

    const copie = await ouvrirLaCopieDuFil({
      dossier: repo,
      conversationId: 'conv-7',
      dossierDesCopies: copies,
      quand: 9_000
    })

    expect(copie).toMatchObject({ ok: true })
    const { chemin, base } = copie as { chemin: string; base: string }
    expect(chemin).toBe(join(copies, 'conv-7'))
    expect(nomDeCopieDeFil(chemin)).toEqual({ fil: 'conv-7' })
    expect(await lireLaBaseDuFil({ dossier: repo, conversationId: 'conv-7' })).toBe(base)
    expect((await git(chemin, 'rev-parse', 'HEAD')).trim()).toBe(base)
    expect(readFileSync(join(chemin, 'node_modules', 'paquet', 'index.js'), 'utf8')).toContain(
      'module.exports'
    )
    // Le travail non commité du dossier partagé est dans la copie : la copie part de ce que tu vois.
    expect(readFileSync(join(chemin, 'a.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe(
      'travail non commité d’un autre fil\n'
    )
    // Le lien ne se voit pas dans la copie : rien à publier au premier passage de la porte.
    expect(await git(chemin, 'status', '--porcelain')).toBe('')
  })

  it('une base déjà posée (copie précédente disparue) avance jusqu’à la nouvelle copie', async () => {
    const repo = await depot()
    const commit = (await git(repo, 'rev-parse', 'HEAD')).trim()
    const fil = { dossier: repo, conversationId: 'conv-8' }
    expect(await avancerLaBaseDuFil({ ...fil, depuis: null, vers: commit })).toMatchObject({
      ok: true
    })
    writeFileSync(join(repo, 'a.txt'), 'plus récent\n')

    const copie = await ouvrirLaCopieDuFil({
      ...fil,
      dossierDesCopies: join(repo, '..', 'copies-de-fil'),
      quand: 9_500
    })

    expect(copie).toMatchObject({ ok: true })
    expect(await lireLaBaseDuFil(fil)).toBe((copie as { base: string }).base)
    expect((copie as { base: string }).base).not.toBe(commit)
  })

  it('deux fils modifient le même fichier dans leurs copies : le dépôt partagé ne bouge pas', async () => {
    const repo = await depot()
    const copiesDeFil = join(repo, '..', 'copies-de-fil')
    const statut = await git(repo, 'status', '--porcelain')
    const neuf = await ouvrirLaCopieDuFil({
      dossier: repo,
      conversationId: 'conv-neuf',
      dossierDesCopies: copiesDeFil,
      quand: 10_000
    })
    const ancien = await ouvrirLaCopieDuFil({
      dossier: repo,
      conversationId: 'conv-ancien',
      dossierDesCopies: copiesDeFil,
      quand: 10_001
    })
    const copies = [neuf, ancien].map((copie) => (copie as { chemin: string }).chemin)

    writeFileSync(join(copies[0], 'a.txt'), 'écrit par le fil neuf\n')
    writeFileSync(join(copies[1], 'a.txt'), 'écrit par le fil ancien\n')

    expect(new Set(copies).size).toBe(2)
    expect(await git(repo, 'status', '--porcelain')).toBe(statut)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe(
      'version commitée\n'
    )
  })

  it('chemin de copie au-delà de 215 caractères : refus clair, ni photo ni copie', async () => {
    const repo = await depot()
    const longueurDuNom = 'conv-9'.length + 1
    const retours = join(repo, '..', 'r'.repeat(216 - longueurDuNom - join(repo, '..').length - 1))
    const attendu = join(retours, 'conv-9')
    expect(attendu.length).toBe(216)

    const copie = await ouvrirLaCopieDuFil({
      dossier: repo,
      conversationId: 'conv-9',
      dossierDesCopies: retours,
      quand: 9_999
    })

    expect(copie).toMatchObject({ ok: false })
    expect((copie as { raison: string }).raison).toContain('215 caractères')
    expect((copie as { raison: string }).raison).toContain(attendu)
    expect(existsSync(retours)).toBe(false)
    expect(await git(repo, 'for-each-ref', 'refs/autowin/')).toBe('')
  })

  it('jumeau accepté : un chemin de 215 caractères tout juste s’ouvre', async () => {
    const repo = await depot()
    const longueurDuNom = 'conv-9'.length + 1
    const retours = join(repo, '..', 'r'.repeat(215 - longueurDuNom - join(repo, '..').length - 1))
    expect(join(retours, 'conv-9').length).toBe(215)

    const copie = await ouvrirLaCopieDuFil({
      dossier: repo,
      conversationId: 'conv-9',
      dossierDesCopies: retours,
      quand: 9_999
    })

    expect(copie).toMatchObject({ ok: true })
  })
})

describe('ouvrirLaCopieDuFil — un dossier déjà là n’est jamais écrasé', () => {
  it('refuse sans photo ni base quand copies-de-fil/<fil> existe déjà', async () => {
    const repo = await depot()
    const copies = join(repo, '..', 'copies-de-fil')
    mkdirSync(join(copies, 'conv-3'), { recursive: true })
    writeFileSync(join(copies, 'conv-3', 'note.txt'), 'à quelqu’un\n')

    const copie = await ouvrirLaCopieDuFil({
      dossier: repo,
      conversationId: 'conv-3',
      dossierDesCopies: copies
    })

    expect(copie).toMatchObject({ ok: false })
    expect((copie as { raison: string }).raison).toContain(join(copies, 'conv-3'))
    expect(readFileSync(join(copies, 'conv-3', 'note.txt'), 'utf8')).toBe('à quelqu’un\n')
    expect(await git(repo, 'for-each-ref', 'refs/autowin/')).toBe('')
  })
})
