import { execFile } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { lireLaBaseDuFil, refDeBaseDuFil } from '../git/photo-du-code'
import { defaultGitRunner, type GitRunner } from '../runs/run-autoclose'
import { dossierDeCopieDeTache, racineDesCopiesDeTaches } from './chemins-de-copies'
import {
  copieDUnAutreDepot,
  entrerLeTravailDeLaCopie,
  ouvrirLaCopieDeTache,
  reprendreLesSuppressionsCoupees,
  retirerLaCopieDeTache
} from './copie-de-tache'

/* Les dépôts témoins font plusieurs appels git chacun : le budget par défaut de vitest ne suffit pas sur Windows. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const run = promisify(execFile)
const git = async (cwd: string, ...args: string[]): Promise<string> =>
  (await run('git', args, { cwd })).stdout

const dossiers: string[] = []
afterEach(() => {
  for (const dossier of dossiers.splice(0)) supprimerArbre(dossier)
})

describe('copieDUnAutreDepot — lu dans le fichier .git de la copie, sans appeler git', () => {
  function decor(): {
    depot: string
    autre: string
    copie: string
    copieDeLAutre: string
    racine: string
  } {
    const racine = mkdtempSync(join(tmpdir(), 'copie-depot-'))
    dossiers.push(racine)
    const depot = join(racine, 'depot')
    const autre = join(racine, 'autre')
    mkdirSync(join(depot, '.git', 'worktrees', 'conv-1'), { recursive: true })
    mkdirSync(join(autre, '.git', 'worktrees', 'conv-2'), { recursive: true })
    const copie = join(racine, 'copie-du-depot')
    const copieDeLAutre = join(racine, 'copie-de-l-autre')
    mkdirSync(copie)
    mkdirSync(copieDeLAutre)
    writeFileSync(join(copie, '.git'), `gitdir: ${join(depot, '.git', 'worktrees', 'conv-1')}\n`)
    writeFileSync(
      join(copieDeLAutre, '.git'),
      `gitdir: ${join(autre, '.git', 'worktrees', 'conv-2')}\n`
    )
    return { depot, autre, copie, copieDeLAutre, racine }
  }

  it('une copie qui nomme l’enregistrement du dépôt est la sienne ; celle d’un autre dépôt ne l’est pas', () => {
    const { depot, autre, copie, copieDeLAutre } = decor()
    expect(copieDUnAutreDepot(copie, depot)).toBe(false)
    expect(copieDUnAutreDepot(copieDeLAutre, autre)).toBe(false)
    expect(copieDUnAutreDepot(copieDeLAutre, depot)).toBe(true)
    expect(copieDUnAutreDepot(copie, autre)).toBe(true)
  })

  it('sans fichier .git (création coupée), la copie est traitée comme avant', () => {
    const { depot, racine } = decor()
    const sansGit = join(racine, 'sans-git')
    mkdirSync(sansGit)
    expect(copieDUnAutreDepot(sansGit, depot)).toBe(false)
  })

  it('un .git qui est un dépôt à part, ou qu’on ne rattache à aucun enregistrement, reste en place', () => {
    const { depot, racine } = decor()
    const dossierGit = join(racine, 'depot-a-part')
    mkdirSync(join(dossierGit, '.git'), { recursive: true })
    expect(copieDUnAutreDepot(dossierGit, depot)).toBe(true)
    const sansGitdir = join(racine, 'sans-gitdir')
    mkdirSync(sansGitdir)
    writeFileSync(join(sansGitdir, '.git'), 'texte sans enregistrement\n')
    expect(copieDUnAutreDepot(sansGitdir, depot)).toBe(true)
  })

  it('un projet lié (git worktree) : sa copie est la sienne, et celle d’un autre dépôt ne l’est pas', () => {
    const racine = mkdtempSync(join(tmpdir(), 'copie-depot-lie-'))
    dossiers.push(racine)
    const principal = join(racine, 'principal')
    mkdirSync(join(principal, '.git', 'worktrees', 'conv-1'), { recursive: true })
    // Le projet lié n'a pas de dossier .git : son fichier .git renvoie vers le dépôt principal.
    const lie = join(racine, 'lie')
    mkdirSync(lie)
    writeFileSync(join(lie, '.git'), `gitdir: ${join(principal, '.git', 'worktrees', 'lie')}\n`)
    const copie = join(racine, 'copie-du-lie')
    mkdirSync(copie)
    writeFileSync(
      join(copie, '.git'),
      `gitdir: ${join(principal, '.git', 'worktrees', 'conv-1')}\n`
    )
    const autre = join(racine, 'autre')
    mkdirSync(join(autre, '.git', 'worktrees', 'conv-2'), { recursive: true })
    const copieDeLAutre = join(racine, 'copie-de-l-autre')
    mkdirSync(copieDeLAutre)
    writeFileSync(
      join(copieDeLAutre, '.git'),
      `gitdir: ${join(autre, '.git', 'worktrees', 'conv-2')}\n`
    )
    expect(copieDUnAutreDepot(copie, lie)).toBe(false)
    expect(copieDUnAutreDepot(copieDeLAutre, lie)).toBe(true)
    expect(copieDUnAutreDepot(copie, autre)).toBe(true)
  })
})

interface Temoin {
  racine: string
  depot: string
  bare: string
  donnees: string
}

/**
 * Un dépôt témoin temporaire, avec un dépôt nu local comme distant. Rien ne va vers un serveur, et le
 * distant sert à prouver qu'aucune primitive n'y pousse.
 */
async function temoin(): Promise<Temoin> {
  const racine = realpathSync(mkdtempSync(join(tmpdir(), 'autowin-copie-tache-')))
  dossiers.push(racine)
  const depot = join(racine, 'depot')
  mkdirSync(depot)
  await git(depot, 'init', '-q', '-b', 'main')
  await git(depot, 'config', 'user.name', 'Test')
  await git(depot, 'config', 'user.email', 'test@example.invalid')
  // Le réglage système de Git pour Windows convertit les fins de ligne (CRLF) ; le témoin le fixe pour que
  // les octets écrits par le test soient ceux qu'il relit.
  await git(depot, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(depot, 'a.txt'), 'un\ndeux\ntrois\n')
  writeFileSync(join(depot, 'b.txt'), 'b\n')
  writeFileSync(join(depot, '.gitignore'), 'node_modules/\n')
  await git(depot, 'add', '-A')
  await git(depot, 'commit', '-q', '-m', 'base')
  const bare = join(racine, 'distant.git')
  await git(racine, 'init', '-q', '--bare', bare)
  await git(depot, 'remote', 'add', 'origin', bare)
  await git(depot, 'push', '-q', 'origin', 'main')
  const donnees = join(racine, 'donnees')
  mkdirSync(donnees)
  return { racine, depot, bare, donnees }
}

const TACHE = 'tache-1'

const racineDe = (t: Temoin): string => racineDesCopiesDeTaches(t.donnees)
const copieDe = (t: Temoin, tache = TACHE): string =>
  dossierDeCopieDeTache(racineDe(t), tache) as string

async function ouvrir(t: Temoin, tache = TACHE): Promise<string> {
  const resultat = await ouvrirLaCopieDeTache({
    dossierDeDonnees: t.donnees,
    depot: t.depot,
    tache,
    sansDistant: true
  })
  if (!resultat.ok) throw new Error(`ouverture refusée : ${resultat.raison}`)
  return resultat.chemin
}

const entrer = (t: Temoin, tache = TACHE) =>
  entrerLeTravailDeLaCopie({
    dossierDeDonnees: t.donnees,
    depot: t.depot,
    tache,
    sansDistant: true
  })

const retirer = (t: Temoin, utilisatrices: readonly string[] = [], tache = TACHE) =>
  retirerLaCopieDeTache({
    dossierDeDonnees: t.donnees,
    depot: t.depot,
    tache,
    sansDistant: true,
    tachesQuiLUtilisent: () => utilisatrices
  })

const tete = async (depot: string): Promise<string> =>
  (await git(depot, 'rev-parse', 'HEAD')).trim()
const nombreDeCommits = async (depot: string): Promise<number> =>
  Number((await git(depot, 'rev-list', '--count', 'HEAD')).trim())

/** Un changement déjà dans la branche, fait après l'ouverture de la copie. */
async function commitDansLaBranche(depot: string, fichier: string, contenu: string): Promise<void> {
  writeFileSync(join(depot, fichier), contenu)
  await git(depot, 'add', '--', fichier)
  await git(depot, 'commit', '-q', '-m', `changement de ${fichier}`)
}

/**
 * Une création de copie interrompue : git a posé l'enregistrement et le dossier, puis s'arrête avant la fin
 * du remplissage. Les autres appels git passent tels quels.
 */
function coupureDeLaCreation(gitReel: GitRunner): GitRunner {
  return async (args, cwd, options) => {
    if (!args.includes('worktree') || !args.includes('add')) return gitReel(args, cwd, options)
    const destination = args[args.indexOf('--detach') + 1]
    await gitReel(args, cwd, options)
    unlinkSync(join(destination, 'a.txt'))
    throw new Error('arrêt simulé pendant la création')
  }
}

const PROFIL_VALIDE = JSON.stringify({ termesInterdits: [{ motif: 'zorglub' }] })

/**
 * Un profil d'entreprise posé sur le dépôt principal, non suivi : la copie le trouve par le dépôt commun,
 * comme sur le poste. Son nom n'apparaît dans aucun contenu écrit par les tests.
 */
function poserUnProfil(depot: string, contenu: string): void {
  mkdirSync(join(depot, 'entreprise', 'profil-essai'), { recursive: true })
  writeFileSync(join(depot, 'entreprise', 'profil-essai', 'identite.json'), contenu)
}

describe('ouvrir — une copie par tâche, sous la racine unique, base posée', () => {
  it('range la copie sous la racine unique et pose sa base à la photo du dépôt', async () => {
    const t = await temoin()
    const resultat = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    if (!resultat.ok) throw new Error(resultat.raison)
    expect(resultat.chemin).toBe(copieDe(t))
    expect(resultat.deja).toBe(false)
    expect(readFileSync(join(resultat.chemin, 'a.txt'), 'utf8')).toBe('un\ndeux\ntrois\n')
    expect(await lireLaBaseDuFil({ dossier: resultat.chemin, conversationId: TACHE })).toBe(
      resultat.base
    )
    expect((await git(resultat.chemin, 'rev-parse', 'HEAD')).trim()).toBe(resultat.base)
    expect(await git(resultat.chemin, 'status', '--porcelain')).toBe('')
  })

  it('reprend telle quelle une copie déjà ouverte, sans la recréer', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)
    const baseAvant = await lireLaBaseDuFil({ dossier: copie, conversationId: TACHE })
    const seconde = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    expect(seconde).toMatchObject({ ok: true, chemin: copie, deja: true })
    expect(await lireLaBaseDuFil({ dossier: copie, conversationId: TACHE })).toBe(baseAvant)
  })

  it('refuse un dossier qui occupe la place sans être sa copie, sans rien écrire par-dessus', async () => {
    const t = await temoin()
    const occupe = copieDe(t)
    mkdirSync(occupe, { recursive: true })
    writeFileSync(join(occupe, 'intrus.txt'), 'pas à moi')
    const resultat = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    expect(resultat).toMatchObject({ ok: false, motif: 'dossier-occupe' })
    expect(readFileSync(join(occupe, 'intrus.txt'), 'utf8')).toBe('pas à moi')
  })

  it('refuse un identifiant qui ne peut pas nommer une copie, sans rien créer', async () => {
    const t = await temoin()
    for (const mauvais of ['../x', '-x', 'a.b', '']) {
      const resultat = await ouvrirLaCopieDeTache({
        dossierDeDonnees: t.donnees,
        depot: t.depot,
        tache: mauvais,
        sansDistant: true
      })
      expect(resultat, `« ${mauvais} »`).toMatchObject({ ok: false, motif: 'identifiant-invalide' })
    }
    expect(existsSync(racineDe(t))).toBe(false)
  })

  it('une copie sans sa base n’est ni reprise ni réparée : le refus dit cette cause, et rien n’est écrit', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nCOPIE\ntrois\n')
    await git(t.depot, 'update-ref', '-d', refDeBaseDuFil(TACHE) as string)

    const resultat = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    expect(resultat).toMatchObject({ ok: false, motif: 'base-absente' })
    if (resultat.ok) throw new Error('ouverture acceptée sans base')
    expect(resultat.raison).not.toContain('sans être la copie de cette tâche')
    expect(await lireLaBaseDuFil({ dossier: copie, conversationId: TACHE })).toBeNull()
    expect(readFileSync(join(copie, 'a.txt'), 'utf8')).toBe('un\nCOPIE\ntrois\n')
  })

  it('une pose de base qui échoue ne laisse aucune copie sans base : l’ouverture suivante réussit', async () => {
    const t = await temoin()
    const gitReel = await defaultGitRunner()
    const panne = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true,
      runGit: async (args, cwd, options) => {
        if (args[0] === 'update-ref' && args[1] === refDeBaseDuFil(TACHE))
          throw new Error('panne simulée de la pose de base')
        return gitReel(args, cwd, options)
      }
    })
    expect(panne).toMatchObject({ ok: false, motif: 'echec' })
    expect(existsSync(copieDe(t))).toBe(false)

    const reprise = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    if (!reprise.ok) throw new Error(`reprise refusée : ${reprise.raison}`)
    expect(reprise.deja).toBe(false)
    expect(await lireLaBaseDuFil({ dossier: reprise.chemin, conversationId: TACHE })).toBe(
      reprise.base
    )
  })

  it('relie node_modules du dépôt dans la copie : les tests peuvent tourner comme dans la copie du fil', async () => {
    const t = await temoin()
    mkdirSync(join(t.depot, 'node_modules', 'paquet'), { recursive: true })
    writeFileSync(join(t.depot, 'node_modules', 'paquet', 'index.txt'), 'module')

    const resultat = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    if (!resultat.ok) throw new Error(resultat.raison)
    if (resultat.deja) throw new Error('copie neuve attendue')
    expect(resultat.dependances).toEqual({ fait: 'liees' })
    expect(lstatSync(join(resultat.chemin, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(resultat.chemin, 'node_modules', 'paquet', 'index.txt'), 'utf8')).toBe(
      'module'
    )
  })

  it('sans node_modules dans le dépôt, rien n’est relié et la copie le dit', async () => {
    const t = await temoin()

    const resultat = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    if (!resultat.ok) throw new Error(resultat.raison)
    if (resultat.deja) throw new Error('copie neuve attendue')
    expect(resultat.dependances).toMatchObject({ fait: 'rien-a-lier' })
    expect(existsSync(join(resultat.chemin, 'node_modules'))).toBe(false)
  })

  // Une coupure pendant la création laisse la copie sous son nom, mais la fiche `en-creation__<tâche>` dit qu'elle n'est
  // pas entière : elle n'est ni rendue, ni entrée, ni retirée, et l'ouverture suivante la défait puis la refait.
  // la fiche de création tient seule la copie en cours ; il n'y a pas de nom provisoire à rétablir.
  it('une copie coupée pendant sa création porte sa fiche : rien ne la rend, ni n’y touche ; l’ouverture suivante la refait', async () => {
    const t = await temoin()
    const coupure = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true,
      runGit: coupureDeLaCreation(await defaultGitRunner())
    })
    expect(coupure).toMatchObject({ ok: false, motif: 'echec' })
    expect(existsSync(join(racineDe(t), `en-creation__${TACHE}`))).toBe(true)
    expect(await entrer(t)).toMatchObject({ ok: false, motif: 'creation-coupee' })
    expect(await retirer(t)).toMatchObject({ ok: false, motif: 'creation-coupee' })
    expect(existsSync(copieDe(t))).toBe(true)

    const reprise = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    if (!reprise.ok) throw new Error(`reprise refusée : ${reprise.raison}`)
    expect(reprise.deja).toBe(false)
    expect(readFileSync(join(copieDe(t), 'a.txt'), 'utf8')).toBe('un\ndeux\ntrois\n')
    expect(existsSync(join(racineDe(t), `en-creation__${TACHE}`))).toBe(false)
    // La copie reprise tient encore après un ménage des enregistrements git du dépôt.
    await git(t.depot, 'worktree', 'prune')
    expect((await git(copieDe(t), 'rev-parse', 'HEAD')).trim()).toBe(reprise.base)
  })

  // Sans copie, il n'y a rien à entrer ni à retirer : le refus le dit sans toucher au dépôt.
  it('sans copie pour cette tâche : entrer refuse copie-absente, et retirer constate qu’elle est déjà absente', async () => {
    const t = await temoin()
    expect(existsSync(copieDe(t))).toBe(false)
    expect(await entrer(t)).toMatchObject({ ok: false, motif: 'copie-absente' })
    expect(await retirer(t)).toEqual({ ok: true, etat: 'deja-absente' })
    expect(existsSync(copieDe(t))).toBe(false)
  })

  // une copie que le dépôt ne reconnaît pas ne doit jamais être rendue ouverte, et un appel git muet ne doit pas tenir la file.
  it('une copie que le dépôt ne reconnaît pas n’est jamais rendue ouverte : le refus la nomme, et sa réparation la rend ouverte', async () => {
    const t = await temoin()
    await ouvrir(t)
    // Le dépôt ne tient plus ce dossier pour sa copie : l'enregistrement git de la tâche pointe ailleurs.
    const enregistrement = readdirSync(join(t.depot, '.git', 'worktrees'))[0] as string
    writeFileSync(
      join(t.depot, '.git', 'worktrees', enregistrement, 'gitdir'),
      `${join(t.racine, 'ailleurs', '.git')}\n`
    )

    const refusee = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    expect(refusee).toMatchObject({ ok: false, motif: 'enregistrement-absent' })
    if (refusee.ok) throw new Error('ouverture acceptée à tort')
    expect(refusee.raison).toContain(copieDe(t))
    expect(refusee.raison).toContain('worktree repair')

    await git(t.depot, 'worktree', 'repair', copieDe(t))
    const reprise = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    if (!reprise.ok) throw new Error(`reprise refusée : ${reprise.raison}`)
    expect(reprise.deja).toBe(true)
    await git(t.depot, 'worktree', 'prune')
    expect((await git(copieDe(t), 'rev-parse', 'HEAD')).trim()).toBe(reprise.base)
  })

  it('un appel git qui ne répond pas refuse le geste après son délai, et ne bloque pas le geste suivant', async () => {
    const t = await temoin()
    const gitReel = await defaultGitRunner()
    const muet = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true,
      delaiGitMs: 2000,
      runGit: async (args, cwd, options) => {
        if (args.includes('worktree') && args.includes('add')) return new Promise<string>(() => {})
        return gitReel(args, cwd, options)
      }
    })
    expect(muet).toMatchObject({ ok: false, motif: 'echec' })
    if (muet.ok) throw new Error('ouverture acceptée à tort')
    expect(muet.raison).toContain('pas répondu')
    expect(existsSync(copieDe(t))).toBe(false)

    const suivante = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    expect(suivante.ok).toBe(true)
  })

  it('une base posée sans copie avance à la photo du dépôt, et la copie s’ouvre à cette photo', async () => {
    const t = await temoin()
    await ouvrir(t)
    const premiere = await lireLaBaseDuFil({ dossier: t.depot, conversationId: TACHE })
    expect(await retirer(t)).toEqual({ ok: true, etat: 'retiree' })
    expect(await lireLaBaseDuFil({ dossier: t.depot, conversationId: TACHE })).toBe(premiere)

    writeFileSync(join(t.depot, 'a.txt'), 'un\nDEUX\ntrois\n')
    const reprise = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    if (!reprise.ok) throw new Error(`ouverture refusée : ${reprise.raison}`)
    expect(reprise.deja).toBe(false)
    expect(reprise.base).not.toBe(premiere)
    expect(await lireLaBaseDuFil({ dossier: t.depot, conversationId: TACHE })).toBe(reprise.base)
    expect(readFileSync(join(reprise.chemin, 'a.txt'), 'utf8')).toBe('un\nDEUX\ntrois\n')
  })

  // Une ouverture qui rend une copie existante relie quand même les dépendances : le dépôt peut recevoir ses modules après l'ouverture.
  it('une copie déjà ouverte reçoit le lien des dépendances que le dépôt a depuis : l’ouverture suivante le pose', async () => {
    const t = await temoin()
    await ouvrir(t)
    mkdirSync(join(t.depot, 'node_modules', 'paquet'), { recursive: true })
    writeFileSync(join(t.depot, 'node_modules', 'paquet', 'index.txt'), 'module')

    const reprise = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    if (!reprise.ok) throw new Error(`reprise refusée : ${reprise.raison}`)
    expect(reprise.deja).toBe(true)
    expect(lstatSync(join(copieDe(t), 'node_modules')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(copieDe(t), 'node_modules', 'paquet', 'index.txt'), 'utf8')).toBe(
      'module'
    )
  })

  // Le lien des dépendances se pose à la création : la copie ouverte peut lancer ses tests sans geste de plus.
  it('une copie créée a déjà son lien des dépendances dès son ouverture', async () => {
    const t = await temoin()
    mkdirSync(join(t.depot, 'node_modules', 'paquet'), { recursive: true })
    writeFileSync(join(t.depot, 'node_modules', 'paquet', 'index.txt'), 'module')

    const ouverte = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    if (!ouverte.ok) throw new Error(`ouverture refusée : ${ouverte.raison}`)
    expect(ouverte.deja).toBe(false)
    expect(lstatSync(join(copieDe(t), 'node_modules')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(copieDe(t), 'node_modules', 'paquet', 'index.txt'), 'utf8')).toBe(
      'module'
    )
  })

  // Le seuil de la longueur : la copie de 215 caractères s'ouvre et se retire, celle de 216 est refusée sans rien créer.
  it('une copie de 215 caractères s’ouvre et se retire ; une de 216 est refusée sans rien créer', async () => {
    const t = await temoin()
    const dossierDeDonnees = (longueur: number): string => join(t.racine, 'x'.repeat(longueur))
    const copieDeLongueur = (longueur: number): string =>
      dossierDeCopieDeTache(racineDesCopiesDeTaches(dossierDeDonnees(longueur)), TACHE) as string
    // Un nom de dossier plus long d'un caractère rend la copie plus longue d'un caractère.
    const base = copieDeLongueur(1).length
    const dd215 = dossierDeDonnees(1 + (215 - base))
    const dd216 = dossierDeDonnees(1 + (216 - base))
    expect(copieDeLongueur(1 + (215 - base)).length).toBe(215)

    const ouverte = await ouvrirLaCopieDeTache({
      dossierDeDonnees: dd215,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    if (!ouverte.ok) throw new Error(`ouverture refusée : ${ouverte.raison}`)
    expect(ouverte.chemin.length).toBe(215)
    expect(
      await retirerLaCopieDeTache({
        dossierDeDonnees: dd215,
        depot: t.depot,
        tache: TACHE,
        sansDistant: true,
        tachesQuiLUtilisent: () => []
      })
    ).toEqual({ ok: true, etat: 'retiree' })

    const refusee = await ouvrirLaCopieDeTache({
      dossierDeDonnees: dd216,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    expect(refusee).toMatchObject({ ok: false, motif: 'chemin-trop-long' })
    expect(existsSync(racineDesCopiesDeTaches(dd216))).toBe(false)
  })

  it('rouvrir une copie déjà liée garde son lien, sans le refaire ; un dépôt sans node_modules ne crée aucun lien', async () => {
    const t = await temoin()
    mkdirSync(join(t.depot, 'node_modules', 'paquet'), { recursive: true })
    writeFileSync(join(t.depot, 'node_modules', 'paquet', 'index.txt'), 'module')
    await ouvrir(t)

    const seconde = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    expect(seconde).toMatchObject({ ok: true, deja: true, dependances: { fait: 'deja-presentes' } })
    expect(lstatSync(join(copieDe(t), 'node_modules')).isSymbolicLink()).toBe(true)
  })

  it('rouvrir une copie quand le dépôt n’a pas de node_modules ne crée aucun lien', async () => {
    const t = await temoin()
    await ouvrir(t)

    const seconde = await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true
    })
    expect(seconde).toMatchObject({ ok: true, deja: true, dependances: { fait: 'rien-a-lier' } })
    expect(existsSync(join(copieDe(t), 'node_modules'))).toBe(false)
  })

  // Deux gestes sur une même tâche passent l'un après l'autre : la seconde ne trouve jamais la base ou la copie de la première à moitié posées.
  it('deux ouvertures simultanées de la même tâche ne se gênent pas : la seconde reprend la copie de la première', async () => {
    const t = await temoin()
    const gitReel = await defaultGitRunner()
    const lente: GitRunner = async (args, cwd, options) => {
      if (args.includes('worktree') && args.includes('add'))
        await new Promise((resolve) => setTimeout(resolve, 300))
      return gitReel(args, cwd, options)
    }
    const entree = {
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true as const,
      runGit: lente
    }

    const [premiere, seconde] = await Promise.all([
      ouvrirLaCopieDeTache(entree),
      ouvrirLaCopieDeTache(entree)
    ])
    expect(premiere).toMatchObject({ ok: true, deja: false })
    expect(seconde).toMatchObject({ ok: true, deja: true })
    expect(readFileSync(join(copieDe(t), 'a.txt'), 'utf8')).toBe('un\ndeux\ntrois\n')
  })
})

describe('entrer — le travail de la copie entre dans la branche, sans toucher au reste', () => {
  it('fait entrer le travail, et un second passage sans changement n’ajoute rien', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nDEUX\ntrois\n')

    const premier = await entrer(t)
    expect(premier).toMatchObject({ ok: true, etat: 'entree', fichiers: ['a.txt'] })
    expect(readFileSync(join(t.depot, 'a.txt'), 'utf8')).toBe('un\nDEUX\ntrois\n')
    const teteApres = await tete(t.depot)
    const commitsApres = await nombreDeCommits(t.depot)

    const second = await entrer(t)
    expect(second).toMatchObject({ ok: true, etat: 'rien-a-entrer' })
    expect(await tete(t.depot)).toBe(teteApres)
    expect(await nombreDeCommits(t.depot)).toBe(commitsApres)
  })

  it('fusionne à trois voies : un changement de la branche absent de la copie est gardé', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nDEUX\ntrois\n')
    await commitDansLaBranche(t.depot, 'b.txt', 'b\nDE LA BRANCHE\n')

    const resultat = await entrer(t)
    expect(resultat).toMatchObject({ ok: true, etat: 'entree' })
    expect(readFileSync(join(t.depot, 'b.txt'), 'utf8')).toBe('b\nDE LA BRANCHE\n')
    expect(readFileSync(join(t.depot, 'a.txt'), 'utf8')).toBe('un\nDEUX\ntrois\n')
    expect(await git(t.depot, 'status', '--porcelain')).toBe('')
  })

  it('un conflit avec la branche garde la copie et laisse la branche en place', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nCOPIE\ntrois\n')
    await commitDansLaBranche(t.depot, 'a.txt', 'un\nBRANCHE\ntrois\n')
    const teteAvant = await tete(t.depot)

    const resultat = await entrer(t)
    expect(resultat).toMatchObject({ ok: false, motif: 'conflit', fichiers: ['a.txt'] })
    expect(await tete(t.depot)).toBe(teteAvant)
    expect(readFileSync(join(t.depot, 'a.txt'), 'utf8')).toBe('un\nBRANCHE\ntrois\n')
    expect(readFileSync(join(copie, 'a.txt'), 'utf8')).toBe('un\nCOPIE\ntrois\n')
    expect(existsSync(copie)).toBe(true)
  })

  it('un commit posé sur la branche pendant la fusion à blanc survit à l’entrée, qui refuse et garde la copie', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nDEUX\ntrois\n')
    const gitReel = await defaultGitRunner()
    let autreFilPasse = false
    const resultat = await entrerLeTravailDeLaCopie({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true,
      runGit: async (args, cwd, options) => {
        const sortie = await gitReel(args, cwd, options)
        // Un autre fil publie sur la branche juste après le calcul à blanc, avant l'avance.
        if (!autreFilPasse && args[0] === 'merge-tree') {
          autreFilPasse = true
          await commitDansLaBranche(t.depot, 'autre.txt', 'venu d’un autre fil\n')
        }
        return sortie
      }
    })
    expect(autreFilPasse).toBe(true)
    expect(resultat).toMatchObject({ ok: false, motif: 'echec' })
    expect(await git(t.depot, 'show', 'HEAD:autre.txt')).toBe('venu d’un autre fil\n')
    expect(existsSync(copie)).toBe(true)

    // Une entrée suivante fait entrer le travail de la copie, sans effacer l'autre commit.
    expect(await entrer(t)).toMatchObject({ ok: true, etat: 'entree' })
    expect(await git(t.depot, 'show', 'HEAD:autre.txt')).toBe('venu d’un autre fil\n')
    expect(await git(t.depot, 'show', 'HEAD:a.txt')).toBe('un\nDEUX\ntrois\n')
  })

  it('refuse un fichier visé modifié et non commité dans le dossier partagé, octet pour octet', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nCOPIE\ntrois\n')
    writeFileSync(join(t.depot, 'a.txt'), 'un\ndeux\ntrois\nNON COMMITÉ\n')
    const octetsAvant = readFileSync(join(t.depot, 'a.txt'))
    const teteAvant = await tete(t.depot)

    const resultat = await entrer(t)
    expect(resultat).toMatchObject({ ok: false, motif: 'modifie-non-commite', fichiers: ['a.txt'] })
    expect(readFileSync(join(t.depot, 'a.txt')).equals(octetsAvant)).toBe(true)
    expect(await tete(t.depot)).toBe(teteAvant)
    expect(readFileSync(join(copie, 'a.txt'), 'utf8')).toBe('un\nCOPIE\ntrois\n')
  })

  // `status` ne liste pas les fichiers ignorés : un fichier ignoré que la fusion écraserait doit être vérifié à part.
  it('refuse un fichier ignoré du dossier partagé que l’entrée écraserait : rien n’y est écrit, la copie reste', async () => {
    const t = await temoin()
    // La règle qui ignore precieux.txt est dans la branche ; la copie la retire, puis ajoute le fichier.
    writeFileSync(join(t.depot, '.gitignore'), 'node_modules/\nprecieux.txt\n')
    await git(t.depot, 'add', '--', '.gitignore')
    await git(t.depot, 'commit', '-q', '-m', 'ignore precieux.txt')
    const copie = await ouvrir(t)
    writeFileSync(join(t.depot, 'precieux.txt'), 'à moi, non commité\n')
    const octetsAvant = readFileSync(join(t.depot, 'precieux.txt'))
    writeFileSync(join(copie, '.gitignore'), 'node_modules/\n')
    writeFileSync(join(copie, 'precieux.txt'), 'copie\n')
    const teteAvant = await tete(t.depot)

    const resultat = await entrer(t)
    expect(resultat).toMatchObject({
      ok: false,
      motif: 'modifie-non-commite',
      fichiers: ['precieux.txt']
    })
    expect(readFileSync(join(t.depot, 'precieux.txt')).equals(octetsAvant)).toBe(true)
    expect(await tete(t.depot)).toBe(teteAvant)
    expect(readFileSync(join(copie, 'precieux.txt'), 'utf8')).toBe('copie\n')
    expect(existsSync(copie)).toBe(true)
  })

  // Un fichier ignoré créé entre le contrôle et la fusion n'est pas écrasé : la fusion refuse plutôt que de l'écraser.
  it('refuse un fichier ignoré créé dans le dossier partagé après le contrôle, juste avant la fusion : il n’est pas écrasé', async () => {
    const t = await temoin()
    writeFileSync(join(t.depot, '.gitignore'), 'node_modules/\nprecieux.txt\n')
    await git(t.depot, 'add', '--', '.gitignore')
    await git(t.depot, 'commit', '-q', '-m', 'ignore precieux.txt')
    const copie = await ouvrir(t)
    writeFileSync(join(copie, '.gitignore'), 'node_modules/\n')
    writeFileSync(join(copie, 'precieux.txt'), 'copie\n')
    const teteAvant = await tete(t.depot)
    const gitReel = await defaultGitRunner()
    let creeJusteAvantLaFusion = false
    const resultat = await entrerLeTravailDeLaCopie({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true,
      runGit: async (args, cwd, options) => {
        // Le contrôle des ignorés a déjà passé : le fichier apparaît dans le dossier partagé, au moment de la fusion.
        if (!creeJusteAvantLaFusion && args.includes('--ff-only')) {
          creeJusteAvantLaFusion = true
          writeFileSync(join(t.depot, 'precieux.txt'), 'à moi, non commité\n')
        }
        return gitReel(args, cwd, options)
      }
    })
    expect(creeJusteAvantLaFusion).toBe(true)
    expect(resultat).toMatchObject({ ok: false, motif: 'echec' })
    expect(readFileSync(join(t.depot, 'precieux.txt'), 'utf8')).toBe('à moi, non commité\n')
    expect(await tete(t.depot)).toBe(teteAvant)
    expect(existsSync(copie)).toBe(true)
  })

  it('un fichier ignoré créé juste avant la fusion, que l’entrée n’écrit pas, reste intact et l’entrée passe', async () => {
    const t = await temoin()
    writeFileSync(join(t.depot, '.gitignore'), 'node_modules/\nprecieux.txt\nlibre.txt\n')
    await git(t.depot, 'add', '--', '.gitignore')
    await git(t.depot, 'commit', '-q', '-m', 'ignore precieux.txt et libre.txt')
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nDEUX\ntrois\n')
    const gitReel = await defaultGitRunner()
    let creeJusteAvantLaFusion = false
    const resultat = await entrerLeTravailDeLaCopie({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true,
      runGit: async (args, cwd, options) => {
        if (!creeJusteAvantLaFusion && args.includes('--ff-only')) {
          creeJusteAvantLaFusion = true
          writeFileSync(join(t.depot, 'libre.txt'), 'libre, non commité\n')
        }
        return gitReel(args, cwd, options)
      }
    })
    expect(creeJusteAvantLaFusion).toBe(true)
    expect(resultat).toMatchObject({ ok: true, etat: 'entree', fichiers: ['a.txt'] })
    expect(readFileSync(join(t.depot, 'libre.txt'), 'utf8')).toBe('libre, non commité\n')
    expect(readFileSync(join(t.depot, 'a.txt'), 'utf8')).toBe('un\nDEUX\ntrois\n')
  })

  it('un fichier ignoré du dossier partagé que l’entrée n’écrit pas reste intact, et l’entrée passe', async () => {
    const t = await temoin()
    writeFileSync(join(t.depot, '.gitignore'), 'node_modules/\nprecieux.txt\n')
    await git(t.depot, 'add', '--', '.gitignore')
    await git(t.depot, 'commit', '-q', '-m', 'ignore precieux.txt')
    const copie = await ouvrir(t)
    writeFileSync(join(t.depot, 'precieux.txt'), 'à moi, non commité\n')
    const octetsAvant = readFileSync(join(t.depot, 'precieux.txt'))
    writeFileSync(join(copie, 'a.txt'), 'un\nDEUX\ntrois\n')

    const resultat = await entrer(t)
    expect(resultat).toMatchObject({ ok: true, etat: 'entree', fichiers: ['a.txt'] })
    expect(readFileSync(join(t.depot, 'precieux.txt')).equals(octetsAvant)).toBe(true)
    expect(readFileSync(join(t.depot, 'a.txt'), 'utf8')).toBe('un\nDEUX\ntrois\n')
  })

  it('un chemin ignoré du dossier partagé, que l’entrée écrit sans qu’aucun fichier n’y soit posé, entre sans refus', async () => {
    const t = await temoin()
    writeFileSync(join(t.depot, '.gitignore'), 'node_modules/\nprecieux.txt\n')
    await git(t.depot, 'add', '--', '.gitignore')
    await git(t.depot, 'commit', '-q', '-m', 'ignore precieux.txt')
    const copie = await ouvrir(t)
    writeFileSync(join(copie, '.gitignore'), 'node_modules/\n')
    writeFileSync(join(copie, 'precieux.txt'), 'copie\n')

    const resultat = await entrer(t)
    expect(resultat).toMatchObject({ ok: true, etat: 'entree' })
    expect(readFileSync(join(t.depot, 'precieux.txt'), 'utf8')).toBe('copie\n')
  })

  it('laisse intacts, octet pour octet, un fichier non commité non visé et un travail déjà indexé', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nCOPIE\ntrois\n')
    writeFileSync(join(t.depot, 'b.txt'), 'b\nà moi, non commité\n')
    writeFileSync(join(t.depot, 'c.txt'), 'indexé par un autre travail\n')
    await git(t.depot, 'add', '--', 'c.txt')
    const bAvant = readFileSync(join(t.depot, 'b.txt'))

    const resultat = await entrer(t)
    expect(resultat).toMatchObject({ ok: true, etat: 'entree', fichiers: ['a.txt'] })
    expect(readFileSync(join(t.depot, 'b.txt')).equals(bAvant)).toBe(true)
    expect(readFileSync(join(t.depot, 'a.txt'), 'utf8')).toBe('un\nCOPIE\ntrois\n')
    expect(await git(t.depot, 'diff', '--cached', '--name-only')).toBe('c.txt\n')
  })

  it('refuse sans base posée, et ne touche ni la branche ni la copie', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nCOPIE\ntrois\n')
    await git(t.depot, 'update-ref', '-d', refDeBaseDuFil(TACHE) as string)
    const teteAvant = await tete(t.depot)

    const resultat = await entrer(t)
    expect(resultat).toMatchObject({ ok: false, motif: 'base-absente' })
    expect(await tete(t.depot)).toBe(teteAvant)
    expect(readFileSync(join(copie, 'a.txt'), 'utf8')).toBe('un\nCOPIE\ntrois\n')
  })

  it('ne pousse rien vers le distant témoin, ni à l’ouverture ni à l’entrée', async () => {
    const t = await temoin()
    const distantAvant = await git(t.bare, 'for-each-ref', '--format=%(refname) %(objectname)')
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nCOPIE\ntrois\n')
    expect(await entrer(t)).toMatchObject({ ok: true, etat: 'entree' })
    expect(await git(t.bare, 'for-each-ref', '--format=%(refname) %(objectname)')).toBe(
      distantAvant
    )
  })

  it('refuse un terme d’entreprise dans le contenu : rien n’entre, la branche et la copie restent', async () => {
    const t = await temoin()
    poserUnProfil(t.depot, PROFIL_VALIDE)
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nzorglub\ntrois\n')
    const teteAvant = await tete(t.depot)

    const resultat = await entrer(t)
    expect(resultat).toMatchObject({ ok: false, motif: 'separation' })
    expect(await tete(t.depot)).toBe(teteAvant)
    expect(readFileSync(join(t.depot, 'a.txt'), 'utf8')).toBe('un\ndeux\ntrois\n')
    expect(readFileSync(join(copie, 'a.txt'), 'utf8')).toBe('un\nzorglub\ntrois\n')
  })

  it('refuse un message de commit qui porte un terme d’entreprise, sans poser de commit', async () => {
    const t = await temoin()
    poserUnProfil(t.depot, PROFIL_VALIDE)
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nDEUX\ntrois\n')
    const teteAvant = await tete(t.depot)

    const resultat = await entrerLeTravailDeLaCopie({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true,
      messageDuCommit: 'feat : la ligne zorglub'
    })
    expect(resultat).toMatchObject({ ok: false, motif: 'separation' })
    expect(await tete(t.depot)).toBe(teteAvant)
    expect(readFileSync(join(t.depot, 'a.txt'), 'utf8')).toBe('un\ndeux\ntrois\n')
  })

  it('son jumeau, un contenu et un message propres, entre sous le même profil', async () => {
    const t = await temoin()
    poserUnProfil(t.depot, PROFIL_VALIDE)
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nDEUX\ntrois\n')

    const resultat = await entrerLeTravailDeLaCopie({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true,
      messageDuCommit: 'feat : la ligne propre'
    })
    expect(resultat).toMatchObject({ ok: true, etat: 'entree', fichiers: ['a.txt'] })
    expect(readFileSync(join(t.depot, 'a.txt'), 'utf8')).toBe('un\nDEUX\ntrois\n')
  })

  it('un profil mal formé ne bloque pas l’entrée, et l’avertissement reste dans le résultat', async () => {
    const t = await temoin()
    poserUnProfil(t.depot, '{ pas du json')
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nDEUX\ntrois\n')

    const resultat = await entrer(t)
    if (!resultat.ok || resultat.etat !== 'entree') throw new Error('entrée attendue')
    expect(resultat.avertissement).toContain('mal formé')
    expect(readFileSync(join(t.depot, 'a.txt'), 'utf8')).toBe('un\nDEUX\ntrois\n')
  })
})

describe('retirer — seulement une copie sans écart et sans utilisateur', () => {
  it('retire une copie propre sans laisser ni dossier ni enregistrement git, et un second retrait ne fait rien', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)

    expect(await retirer(t)).toMatchObject({ ok: true, etat: 'retiree' })
    expect(existsSync(copie)).toBe(false)
    expect(existsSync(join(racineDe(t), `a-supprimer__${TACHE}`))).toBe(false)
    const admin = join(t.depot, '.git', 'worktrees')
    expect(existsSync(admin) ? readdirSync(admin) : []).toEqual([])
    expect(await retirer(t)).toMatchObject({ ok: true, etat: 'deja-absente' })
  })

  it('garde une copie qui porte un écart, et nomme le fichier', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)
    writeFileSync(join(copie, 'a.txt'), 'un\nNON PUBLIÉ\ntrois\n')

    expect(await retirer(t)).toMatchObject({ ok: false, motif: 'ecart', fichiers: ['a.txt'] })
    expect(readFileSync(join(copie, 'a.txt'), 'utf8')).toBe('un\nNON PUBLIÉ\ntrois\n')
  })

  it('garde une copie encore utilisée par une tâche', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)

    expect(await retirer(t, ['tache-2'])).toMatchObject({ ok: false, motif: 'utilisee' })
    expect(existsSync(copie)).toBe(true)
  })

  it('garde une copie sans base, faute de pouvoir prouver que rien ne serait perdu', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)
    await git(t.depot, 'update-ref', '-d', refDeBaseDuFil(TACHE) as string)

    expect(await retirer(t)).toMatchObject({ ok: false, motif: 'base-absente' })
    expect(existsSync(copie)).toBe(true)
  })

  it('ne suit jamais un lien : la cible d’une jonction node_modules survit au retrait', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)
    const externe = join(t.racine, 'modules-externes')
    mkdirSync(externe)
    writeFileSync(join(externe, 'precieux.txt'), 'à conserver')
    symlinkSync(externe, join(copie, 'node_modules'), 'junction')

    expect(await retirer(t)).toMatchObject({ ok: true, etat: 'retiree' })
    expect(existsSync(copie)).toBe(false)
    expect(readFileSync(join(externe, 'precieux.txt'), 'utf8')).toBe('à conserver')
  })

  it('le lien node_modules posé à l’ouverture ne compte pas comme écart, et le retrait laisse les vrais modules', async () => {
    const t = await temoin()
    mkdirSync(join(t.depot, 'node_modules', 'paquet'), { recursive: true })
    writeFileSync(join(t.depot, 'node_modules', 'paquet', 'index.txt'), 'module')
    const copie = await ouvrir(t)

    expect(await retirer(t)).toMatchObject({ ok: true, etat: 'retiree' })
    expect(existsSync(copie)).toBe(false)
    expect(readFileSync(join(t.depot, 'node_modules', 'paquet', 'index.txt'), 'utf8')).toBe(
      'module'
    )
  })
})

describe('reprendre — finit une suppression coupée', () => {
  it('finit une suppression coupée et range l’enregistrement git', async () => {
    const t = await temoin()
    const copie = await ouvrir(t)
    // La suppression coupée : le dossier décroché, avec une partie des fichiers déjà effacés.
    const decroche = join(racineDe(t), `a-supprimer__${TACHE}`)
    renameSync(copie, decroche)
    unlinkSync(join(decroche, 'a.txt'))

    const bilan = await reprendreLesSuppressionsCoupees({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      sansDistant: true
    })
    expect(bilan).toEqual({ reprises: [decroche], echecs: [] })
    expect(existsSync(decroche)).toBe(false)
    const admin = join(t.depot, '.git', 'worktrees')
    expect(existsSync(admin) ? readdirSync(admin) : []).toEqual([])
    expect(readFileSync(join(t.depot, 'a.txt'), 'utf8')).toBe('un\ndeux\ntrois\n')
  })

  it('reprendre finit une ouverture coupée, et range son enregistrement git', async () => {
    const t = await temoin()
    await ouvrirLaCopieDeTache({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      tache: TACHE,
      sansDistant: true,
      runGit: coupureDeLaCreation(await defaultGitRunner())
    })

    const bilan = await reprendreLesSuppressionsCoupees({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      sansDistant: true
    })
    expect(bilan.echecs).toEqual([])
    expect(readdirSync(racineDe(t))).toEqual([])
    const admin = join(t.depot, '.git', 'worktrees')
    expect(existsSync(admin) ? readdirSync(admin) : []).toEqual([])
  })

  it('ne suit pas un lien posé à la place d’une suppression coupée', async () => {
    const t = await temoin()
    mkdirSync(racineDe(t), { recursive: true })
    const externe = join(t.racine, 'externe-reprise')
    mkdirSync(externe)
    writeFileSync(join(externe, 'precieux.txt'), 'à conserver')
    symlinkSync(externe, join(racineDe(t), `a-supprimer__${TACHE}`), 'junction')

    const bilan = await reprendreLesSuppressionsCoupees({
      dossierDeDonnees: t.donnees,
      depot: t.depot,
      sansDistant: true
    })
    expect(bilan.reprises).toEqual([])
    expect(bilan.echecs).toHaveLength(1)
    expect(readFileSync(join(externe, 'precieux.txt'), 'utf8')).toBe('à conserver')
  })
})
