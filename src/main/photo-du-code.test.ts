import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre } from './fs-supprimer'
import { defaultGitRunner, type GitRunner } from './run-autoclose'
import {
  ouvrirCopieDeLaPhoto,
  ouvrirCopiesDEssai,
  photoDuTour,
  photographierLeCode as photographierAvecBudgetDuTour,
  revenirAuCodeDuTour,
  refDePhoto
} from './photo-du-code'

/**
 * Aucun test de ce fichier ne porte sur le budget de 5 s du début de tour : sur une machine chargée,
 * il faisait rendre « pas de photo » en silence et le test échouait sur autre chose (conv-1038,
 * 2026-10-21 : « une photo plus vieille… sort » rouge à 18,8 s). Le budget reste celui du produit.
 */
const photographierLeCode = (
  entree: Parameters<typeof photographierAvecBudgetDuTour>[0]
): ReturnType<typeof photographierAvecBudgetDuTour> =>
  photographierAvecBudgetDuTour({ delaiMaxMs: 60_000, ...entree })

/**
 * REVENIR AU CODE D'UN TOUR (conv-1038, 2026-10-21 — décision « branches-rewind », étape 2 : le
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
      'refs/autowin/tour/conv-1/2000',
      'refs/autowin/tour/conv-1/3000',
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
    ).toBe(2_000)
    // Bornes : l'heure du message est incluse, celle du message précédent exclue.
    expect(
      (await photoDuTour({ dossier: repo, conversationId: 'conv-1', jusqua: 2_000, apres: 1_000 }))
        ?.quand
    ).toBe(2_000)
    expect(
      await photoDuTour({ dossier: repo, conversationId: 'conv-1', jusqua: 2_500, apres: 2_000 })
    ).toBeNull()
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
 * L'ÉCHEC DE LA COPIE SE DIT EN UNE PHRASE (conv-1050, 2026-10-22). Constaté à l'écran : un
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
   * ORDRE RÉEL (conv-1050, 2026-10-22) : la photo est prise AVANT le tour (`index.ts`,
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

  it('une photo prise ENTRE deux tours (« Essaie 3 façons ») ne remplace pas celle du tour', async () => {
    // Les copies d'essai photographient sous le même préfixe que les tours (`ouvrirCopiesDEssai`).
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

describe('ouvrirCopiesDEssai — « Essaie 3 façons » : une photo, trois copies séparées', () => {
  it('trois copies DISTINCTES au même état, le dossier partagé intact', async () => {
    const repo = await depot()
    writeFileSync(join(repo, 'a.txt'), 'état au moment de l’essai\n')
    const statut = await git(repo, 'status', '--porcelain')
    const essai = await ouvrirCopiesDEssai({
      dossier: repo,
      conversationId: 'conv-1',
      dossierDesRetours: join(repo, '..', 'essais'),
      nombre: 3,
      quand: 5_000
    })
    expect(essai.ok).toBe(true)
    const chemins = (essai as { chemins: string[] }).chemins
    expect(new Set(chemins).size).toBe(3)
    const lu = (chemin: string): string => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')
    for (const chemin of chemins)
      expect(lu(join(chemin, 'a.txt'))).toBe('état au moment de l’essai\n')
    // Une copie modifiée ne touche ni ses sœurs ni le dossier partagé.
    writeFileSync(join(chemins[0], 'a.txt'), 'façon 1\n')
    expect(lu(join(chemins[1], 'a.txt'))).toBe('état au moment de l’essai\n')
    expect(await git(repo, 'status', '--porcelain')).toBe(statut)
  })

  it('machine chargée : le clic attend sa photo au-delà des 5 s du début de tour', async () => {
    // conv-1038, 2026-10-21 : garder-un-essai.test.ts est tombé rouge en suite chargée (photo
    // abandonnée à 5 s, « son dossier n’est pas un dépôt git… »), vert 3 fois sur 3 seul. Git est
    // ici retenu le temps que l'horloge dépasse 5 s, puis relâché : la photo doit aboutir.
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
      const enCours = ouvrirCopiesDEssai({
        dossier: repo,
        conversationId: 'conv-1',
        dossierDesRetours: join(repo, '..', 'essais-lents'),
        nombre: 2,
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
    const hors = mkdtempSync(join(tmpdir(), 'autowin-essai-hors-'))
    dossiers.push(hors)
    const essai = await ouvrirCopiesDEssai({
      dossier: hors,
      conversationId: 'conv-1',
      dossierDesRetours: join(hors, 'essais'),
      nombre: 3
    })
    expect(essai).toMatchObject({ ok: false })
    expect(existsSync(join(hors, 'essais'))).toBe(false)
  })
})
