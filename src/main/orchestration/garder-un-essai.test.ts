import { execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { avancerLaBaseDuFil, lireLaBaseDuFil, ouvrirCopiesDEssai } from '../git/photo-du-code'
import {
  ecartDeLEssai,
  estUnPassageDePorte,
  garderLEssai,
  garderLeTravailDuFil,
  lireNomDEssai,
  type PublicationDUneCopie
} from './garder-un-essai'
import { WorktreeManager, type FinalizeResult } from '../store/worktree-manager'

/**
 * « ESSAIE 3 FAÇONS » : COMPARER, PUIS GARDER CELLE-CI (2026-10-21 — idée 6).
 *
 * Chaque façon travaille dans sa copie séparée, ouverte à une PHOTO du code (`ouvrirCopiesDEssai`).
 * Cette photo prend le dossier partagé tel quel, y compris le travail NON COMMITÉ des autres fils.
 * Ce que la façon a changé, c'est donc l'écart entre sa copie et la photo — jamais entre sa copie et
 * `main`, qui compterait le travail des autres comme le sien.
 *
 * « Garder celle-ci » passe par le chemin de publication d'une copie (`os.worktrees`, simulé ici) :
 * une copie NEUVE sur la base, l'écart de la façon fusionné dedans à trois voies, puis la
 * publication ordinaire, avec sa garde des fichiers non commités. Rien n'est écrit dans le dossier
 * partagé par ce module.
 *
 * Les entrées qui feraient échouer une version fausse :
 *  - un fichier MODIFIÉ ET NON COMMITÉ par un autre fil avant l'essai (`autre.txt`) : il est dans la
 *    photo ; une version qui compare à `main` le compterait dans l'écart et le PUBLIERAIT ;
 *  - un fichier ignoré écrit par la façon (`ignore/`) : il n'est pas du code à garder ;
 *  - `main` qui a changé LA MÊME LIGNE depuis l'essai : conflit nommé, rien de publié, copie rendue ;
 *  - un refus « fichier non commité dans le dossier partagé » : c'est une ATTENTE, pas un échec ;
 *  - un chemin de copie hors du dossier des essais : refusé avant toute commande git.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const run = promisify(execFile)
const git = async (cwd: string, ...args: string[]): Promise<string> =>
  (await run('git', args, { cwd })).stdout

const dossiers: string[] = []
afterEach(() => {
  for (const dossier of dossiers.splice(0)) supprimerArbre(dossier)
})

async function depotAvecEssais(nombre = 2): Promise<{
  repo: string
  retours: string
  copies: string[]
}> {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-garder-'))
  dossiers.push(racine)
  const repo = join(racine, 'depot')
  mkdirSync(repo)
  await git(repo, 'init', '-b', 'main')
  await git(repo, 'config', 'user.name', 'Test')
  await git(repo, 'config', 'user.email', 'test@example.invalid')
  writeFileSync(join(repo, 'a.txt'), 'ligne 1\nligne 2\nligne 3\n')
  writeFileSync(join(repo, 'c.txt'), 'à supprimer\n')
  writeFileSync(join(repo, 'autre.txt'), 'version commitée\n')
  writeFileSync(join(repo, '.gitignore'), 'ignore/\n')
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-m', 'base')
  // Le travail en cours d'un AUTRE fil, non commité, au moment de l'essai.
  writeFileSync(join(repo, 'autre.txt'), 'travail non commité d’un autre fil\n')
  const retours = join(racine, 'retours-de-tour')
  const essai = await ouvrirCopiesDEssai({
    dossier: repo,
    conversationId: 'conv-1',
    dossierDesRetours: retours,
    nombre,
    quand: 1_000
  })
  if (!essai.ok) throw new Error(essai.raison)
  return { repo, retours, copies: essai.chemins }
}

/** La façon 1 : une ligne changée, un fichier ajouté, un supprimé, un fichier ignoré écrit. */
function travaillerDansLaCopie(copie: string): void {
  writeFileSync(join(copie, 'a.txt'), 'ligne 1 — façon 1\nligne 2\nligne 3\n')
  writeFileSync(join(copie, 'b.txt'), 'nouveau\n')
  rmSync(join(copie, 'c.txt'))
  mkdirSync(join(copie, 'ignore'))
  writeFileSync(join(copie, 'ignore', 'cache.txt'), 'jetable\n')
}

/**
 * Le chemin de publication d'une copie, en petit : une copie neuve détachée sur `main`, puis à la
 * fermeture un commit de ce qu'elle porte. `issue` impose ce que la publication répond.
 */
function publicationSimulee(
  repo: string,
  issue?: (copie: string) => Promise<FinalizeResult | undefined>
): PublicationDUneCopie & {
  appels: Array<{ runId: string; publier: boolean }>
  copie: () => string
} {
  const appels: Array<{ runId: string; publier: boolean }> = []
  let chemin = ''
  return {
    appels,
    copie: () => chemin,
    // fix-ok: cause mesurée par `npm run typecheck` (TS6133) — `runId` n'était pas lu ici.
    ouvrir: async () => {
      chemin = mkdtempSync(join(tmpdir(), 'autowin-garder-copie-'))
      dossiers.push(chemin)
      rmSync(chemin, { recursive: true, force: true })
      await git(repo, 'worktree', 'add', '--detach', chemin, 'main')
      return chemin
    },
    fermer: async (runId, publier) => {
      appels.push({ runId, publier })
      if (!publier) return { outcome: 'nothing', agentId: runId }
      if (issue) return issue(chemin)
      await git(chemin, 'add', '-A')
      await git(chemin, 'commit', '-m', `agent ${runId}`)
      const sha = (await git(chemin, 'rev-parse', 'HEAD')).trim()
      return { outcome: 'merged', agentId: runId, committed: true, publishedSha: sha }
    }
  }
}

describe('lireNomDEssai — seule une copie d’essai, au bon endroit, est reconnue', () => {
  const retours = join(tmpdir(), 'retours-de-tour')
  it('lit le fil, l’instant, le rang et la référence de la photo du nom de la copie', () => {
    expect(lireNomDEssai(join(retours, 'essai__conv-1038-1700-3'), retours)).toEqual({
      fil: 'conv-1038',
      quand: 1700,
      rang: 3,
      ref: 'refs/autowin/tour/conv-1038/1700'
    })
  })
  // 2026-10-21 : le nom d'une copie accepte tout fil (`(.+)`), la référence de photo non
  // (`ID_SUR`). L'écart utilisait `refDePhoto(...) as string` en comptant sur cette garde : sans elle,
  // git aurait été interrogé sur `null^{commit}` et l'utilisateur aurait lu « la photo n'existe plus ».
  // Entrées qui font échouer une version fausse : un fil avec une ESPACE, un fil avec `..`.
  // check: version fausse réinjectée (`ref: ref as string`, garde retirée) → ce cas rouge, 1/12.
  it('refuse, avant toute commande git, un fil que le nom accepte mais pas la référence de photo', async () => {
    for (const nom of ['essai__conv 1038-1700-1', 'essai__conv..1038-1700-1']) {
      expect(lireNomDEssai(join(retours, nom), retours)).toBeNull()
      const runGit = vi.fn(async () => '')
      const ecart = await ecartDeLEssai({
        copie: join(retours, nom),
        dossierDesRetours: retours,
        runGit
      })
      expect(ecart).toEqual({
        ok: false,
        raison: 'Ce dossier n’est pas une copie d’« Essaie 3 façons ».'
      })
      expect(runGit).not.toHaveBeenCalled()
    }
  })
  it('refuse une copie de « revenir à ce tour », un chemin hors du dossier, un sous-dossier', () => {
    expect(lireNomDEssai(join(retours, 'retour__conv-1-1700'), retours)).toBeNull()
    expect(lireNomDEssai(join(retours, '..', 'essai__conv-1-1700-1'), retours)).toBeNull()
    expect(lireNomDEssai(join(retours, 'x', 'essai__conv-1-1700-1'), retours)).toBeNull()
    expect(lireNomDEssai(join(retours, 'essai__conv/1-1700-1'), retours)).toBeNull()
  })
})

describe('ecartDeLEssai — ce que CETTE façon a changé, depuis la photo', () => {
  it('compte ses fichiers et ses lignes, sans le travail non commité des autres ni l’ignoré', async () => {
    const { retours, copies } = await depotAvecEssais()
    travaillerDansLaCopie(copies[0])
    const ecart = await ecartDeLEssai({ copie: copies[0], dossierDesRetours: retours })
    expect(ecart.ok).toBe(true)
    if (!ecart.ok) return
    expect(ecart.fichiers).toEqual([
      { chemin: 'a.txt', ajouts: 1, retraits: 1 },
      { chemin: 'b.txt', ajouts: 1, retraits: 0 },
      { chemin: 'c.txt', ajouts: 0, retraits: 1 }
    ])
    expect(ecart.ajouts).toBe(2)
    expect(ecart.retraits).toBe(2)
    // L'écart porte l'essai qu'il a lu : « Garder » n'a plus à le relire ni à le convertir.
    // check: rouge avant le correctif (`ecart.nom` absent), vert après — vitest code 0.
    expect(ecart.nom).toMatchObject({
      rang: 1,
      ref: expect.stringMatching(/^refs\/autowin\/tour\//u)
    })
  })

  it('une façon qui n’a rien touché a un écart vide', async () => {
    const { retours, copies } = await depotAvecEssais()
    const ecart = await ecartDeLEssai({ copie: copies[1], dossierDesRetours: retours })
    expect(ecart).toMatchObject({ ok: true, fichiers: [], ajouts: 0, retraits: 0 })
  })

  it('l’index de la copie n’est pas touché par la mesure', async () => {
    const { retours, copies } = await depotAvecEssais()
    travaillerDansLaCopie(copies[0])
    const avant = await git(copies[0], 'status', '--porcelain')
    await ecartDeLEssai({ copie: copies[0], dossierDesRetours: retours })
    expect(await git(copies[0], 'status', '--porcelain')).toBe(avant)
  })

  it('un chemin hors du dossier des essais est refusé', async () => {
    const { repo, retours } = await depotAvecEssais(1)
    expect(await ecartDeLEssai({ copie: repo, dossierDesRetours: retours })).toMatchObject({
      ok: false
    })
  })
})

describe('garderLEssai — « Garder celle-ci » par le chemin de publication d’une copie', () => {
  it('publie l’écart de la façon, et RIEN du travail non commité des autres', async () => {
    const { repo, retours, copies } = await depotAvecEssais()
    travaillerDansLaCopie(copies[0])
    const statutAvant = await git(repo, 'status', '--porcelain')
    const publication = publicationSimulee(repo)
    const garde = await garderLEssai({
      copie: copies[0],
      dossierDesRetours: retours,
      publication,
      runId: 'essai-test-1'
    })
    expect(garde).toMatchObject({ ok: true, etat: 'publie' })
    if (!garde.ok || garde.etat !== 'publie') return
    expect(garde.fichiers).toEqual(['a.txt', 'b.txt', 'c.txt'])
    const sha = garde.sha ?? ''
    expect(await git(repo, 'show', `${sha}:a.txt`)).toBe('ligne 1 — façon 1\nligne 2\nligne 3\n')
    expect(await git(repo, 'show', `${sha}:b.txt`)).toBe('nouveau\n')
    expect(await git(repo, 'ls-tree', '--name-only', sha)).not.toContain('c.txt')
    // Le travail non commité de l'autre fil N'EST PAS publié : la version commitée reste.
    expect(await git(repo, 'show', `${sha}:autre.txt`)).toBe('version commitée\n')
    expect(await git(repo, 'ls-tree', '-r', '--name-only', sha)).not.toContain('ignore/cache.txt')
    // Le dossier partagé n'a pas bougé : ni son état git, ni le fichier de l'autre fil.
    expect(await git(repo, 'status', '--porcelain')).toBe(statutAvant)
    expect(readFileSync(join(repo, 'autre.txt'), 'utf8')).toBe(
      'travail non commité d’un autre fil\n'
    )
    expect(publication.appels).toEqual([{ runId: 'essai-test-1', publier: true }])
  })

  it('main a changé la MÊME ligne depuis l’essai : conflit nommé, rien de publié', async () => {
    const { repo, retours, copies } = await depotAvecEssais()
    travaillerDansLaCopie(copies[0])
    writeFileSync(join(repo, 'a.txt'), 'ligne 1 — changée dans main\nligne 2\nligne 3\n')
    await git(repo, 'commit', '-m', 'main bouge', '--', 'a.txt')
    const publication = publicationSimulee(repo)
    const garde = await garderLEssai({
      copie: copies[0],
      dossierDesRetours: retours,
      publication,
      runId: 'essai-test-2'
    })
    expect(garde.ok).toBe(false)
    if (garde.ok) return
    expect(garde.raison).toContain('a.txt')
    // La copie neuve est rendue sans publication.
    expect(publication.appels).toEqual([{ runId: 'essai-test-2', publier: false }])
  })

  // Ailleurs = séparé par une ligne inchangée. check: `git merge-file` rend 1 sur deux lignes
  // VOISINES changées et 0 quand une ligne inchangée les sépare (mesuré le 2026-10-21).
  it('un changement de main AILLEURS dans le fichier se fusionne', async () => {
    const { repo, retours, copies } = await depotAvecEssais()
    travaillerDansLaCopie(copies[0])
    writeFileSync(join(repo, 'a.txt'), 'ligne 1\nligne 2\nligne 3 — main\n')
    await git(repo, 'commit', '-m', 'main bouge ailleurs', '--', 'a.txt')
    const publication = publicationSimulee(repo)
    const garde = await garderLEssai({
      copie: copies[0],
      dossierDesRetours: retours,
      publication,
      runId: 'essai-test-3'
    })
    expect(garde).toMatchObject({ ok: true, etat: 'publie' })
    if (!garde.ok || garde.etat !== 'publie') return
    expect(await git(repo, 'show', `${garde.sha}:a.txt`)).toBe(
      'ligne 1 — façon 1\nligne 2\nligne 3 — main\n'
    )
  })

  it('un fichier non commité dans le dossier partagé : la publication ATTEND, ce n’est pas un échec', async () => {
    const { repo, retours, copies } = await depotAvecEssais()
    travaillerDansLaCopie(copies[0])
    const publication = publicationSimulee(repo, async () => ({
      outcome: 'blocked',
      agentId: 'essai-test-4',
      files: ['a.txt'],
      reason: 'base-dirty',
      stagedRef: 'refs/autowin/attente/essai-test-4'
    }))
    const garde = await garderLEssai({
      copie: copies[0],
      dossierDesRetours: retours,
      publication,
      runId: 'essai-test-4'
    })
    expect(garde).toMatchObject({ ok: true, etat: 'en-attente', fichiers: ['a.txt'] })
  })

  it('une façon qui n’a rien changé n’ouvre aucune copie', async () => {
    const { repo, retours, copies } = await depotAvecEssais()
    const publication = publicationSimulee(repo)
    const garde = await garderLEssai({
      copie: copies[1],
      dossierDesRetours: retours,
      publication,
      runId: 'essai-test-5'
    })
    expect(garde.ok).toBe(false)
    expect(publication.copie()).toBe('')
    expect(publication.appels).toEqual([])
  })
})

/**
 * LA PORTE D'UN FIL EN COPIE : « Garder » en fin de tour, base = la base du fil (`photo-du-code.ts`,
 * `lireLaBaseDuFil`), qui AVANCE à chaque passage. Tout ce que la copie porte appartient au fil :
 * rien n'est à prouver, seul l'écart depuis la base entre dans main.
 *
 * La publication est la VRAIE (`WorktreeManager` : copie neuve sur main, puis finalisation en avance
 * rapide), pas une imitation : « le travail arrive dans main » se lit dans la branche ET le dossier.
 *
 * Les entrées qui feraient échouer une version fausse :
 *  - main a reçu le travail d'un AUTRE fil depuis la copie : une version qui pose l'arbre de la copie
 *    sur main au lieu de fusionner à trois voies le déferait ;
 *  - un second passage : une base qui n'avance pas republierait les fichiers du premier ;
 *  - la base avance jusqu'à l'arbre de la COPIE : prise sur main, elle avalerait le travail des autres ;
 *  - un conflit avec main, un passage sans changement, une base disparue : trois refus distincts,
 *    aucun n'écrit dans main, et une base absente ne publie JAMAIS toute la copie.
 */
describe('garderLeTravailDuFil — la porte d’un fil en copie vers main', () => {
  async function filEnCopie(): Promise<{ repo: string; copie: string; base: string }> {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-porte-'))
    dossiers.push(racine)
    const repo = join(racine, 'depot')
    mkdirSync(repo)
    await git(repo, 'init', '-b', 'main')
    await git(repo, 'config', 'user.name', 'Test')
    await git(repo, 'config', 'user.email', 'test@example.invalid')
    await git(repo, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(repo, 'a.txt'), 'ligne 1\nligne 2\nligne 3\n')
    writeFileSync(join(repo, 'c.txt'), 'à supprimer\n')
    writeFileSync(join(repo, 'autre.txt'), 'version commitée\n')
    writeFileSync(join(repo, '.gitignore'), 'ignore/\n')
    await git(repo, 'add', '-A')
    await git(repo, 'commit', '-m', 'base')
    const copie = join(racine, 'copies', 'conv-1')
    await git(repo, 'worktree', 'add', '--detach', copie, 'main')
    const base = await avancerLaBaseDuFil({
      dossier: copie,
      conversationId: 'conv-1',
      depuis: null,
      vers: 'HEAD'
    })
    if (!base.ok) throw new Error(base.raison)
    return { repo, copie, base: base.sha }
  }

  /** Le chemin de publication d'une copie de l'app, sur un vrai `WorktreeManager`. */
  function publicationReelle(repo: string): PublicationDUneCopie & { ouvertes: string[] } {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-porte-wt-'))
    dossiers.push(racine)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })
    const ouvertes: string[] = []
    return {
      ouvertes,
      ouvrir: async (runId) => {
        ouvertes.push(runId)
        return wm.acquire(runId)
      },
      fermer: async (runId, publier) => {
        if (publier) return wm.finalize(runId)
        wm.discard(runId)
        return undefined
      }
    }
  }

  const commitsEntres = async (repo: string, depuis: string): Promise<string[]> =>
    (await git(repo, 'rev-list', `${depuis}..main`)).split('\n').filter(Boolean)

  it('le travail du fil arrive dans main par la fusion à trois voies, et la base du fil avance', async () => {
    const { repo, copie, base } = await filEnCopie()
    // Un autre fil a fait entrer son travail dans main depuis la naissance de la copie.
    writeFileSync(join(repo, 'autre.txt'), 'travail d’un autre fil, déjà dans main\n')
    await git(repo, 'commit', '-m', 'autre fil', '--', 'autre.txt')
    const mainAvant = (await git(repo, 'rev-parse', 'main')).trim()
    travaillerDansLaCopie(copie)

    const garde = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(a): change la ligne 1 (conv-1)',
      publication: publicationReelle(repo),
      runId: 'porte-test-1'
    })

    expect(garde).toMatchObject({ ok: true, etat: 'publie', fichiers: ['a.txt', 'b.txt', 'c.txt'] })
    if (!garde.ok || garde.etat !== 'publie') return
    // Dans main : la branche ET le dossier, sans le fichier ignoré, avec le travail de l'autre fil.
    expect(await git(repo, 'show', 'main:a.txt')).toBe('ligne 1 — façon 1\nligne 2\nligne 3\n')
    // fix-ok: cause mesurée — le git système de ce poste extrait en CRLF (`git config --system
    // core.autocrlf` = true) : le dossier lit `nouveau\r\n`, la branche `nouveau\n`. Seul le contenu compte.
    expect(readFileSync(join(repo, 'b.txt'), 'utf8').replace(/\r\n/gu, '\n')).toBe('nouveau\n')
    expect(existsSync(join(repo, 'c.txt'))).toBe(false)
    expect(await git(repo, 'ls-tree', '-r', '--name-only', 'main')).not.toContain(
      'ignore/cache.txt'
    )
    expect(await git(repo, 'show', 'main:autre.txt')).toBe(
      'travail d’un autre fil, déjà dans main\n'
    )
    expect(await git(repo, 'status', '--porcelain')).toBe('')
    // La base avance au commit de ce que la COPIE portait (sa version d'`autre.txt`), fils de l'ancienne.
    const nouvelleBase = await lireLaBaseDuFil({ dossier: copie, conversationId: 'conv-1' })
    expect(nouvelleBase).toBe(garde.passage)
    expect(nouvelleBase).not.toBe(base)
    expect(garde.base).toEqual({ ok: true, sha: nouvelleBase })
    expect((await git(repo, 'rev-parse', `${nouvelleBase}^`)).trim()).toBe(base)
    expect(await git(repo, 'show', `${nouvelleBase}:autre.txt`)).toBe('version commitée\n')
    expect(await commitsEntres(repo, mainAvant)).toHaveLength(1)
  })

  it('chaque commit de la porte finit par la ligne `Porte: conv-NNN`, que `git log --grep` retrouve', async () => {
    const { repo, copie } = await filEnCopie()
    const mainAvant = (await git(repo, 'rev-parse', 'main')).trim()
    const publication = publicationReelle(repo)
    travaillerDansLaCopie(copie)
    await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(a): premier passage (conv-1)',
      publication,
      runId: 'porte-test-2a'
    })
    writeFileSync(join(copie, 'd.txt'), 'second passage\n')
    await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(d): second passage (conv-1)',
      publication,
      runId: 'porte-test-2b'
    })

    const commits = await commitsEntres(repo, mainAvant)
    expect(commits).toHaveLength(2)
    for (const sha of commits) {
      const lignes = (await git(repo, 'log', '-1', '--format=%B', sha)).trimEnd().split('\n')
      expect(lignes.at(-1)).toBe('Porte: conv-1')
    }
    expect((await git(repo, 'log', '-1', '--format=%s', commits[0])).trim()).toBe(
      'feat(d): second passage (conv-1)'
    )
    const trouves = (await git(repo, 'log', 'main', '--format=%H', '--grep=^Porte: conv-1$'))
      .split('\n')
      .filter(Boolean)
    expect(trouves.sort()).toEqual([...commits].sort())
  })

  it('un second passage ne publie que l’écart depuis le premier', async () => {
    const { repo, copie } = await filEnCopie()
    const publication = publicationReelle(repo)
    travaillerDansLaCopie(copie)
    const premier = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(a): premier passage (conv-1)',
      publication,
      runId: 'porte-test-3a'
    })
    expect(premier).toMatchObject({ ok: true, etat: 'publie' })
    // Entre les deux passages, main change la ligne 3 d'`a.txt` : le second ne doit pas la défaire.
    writeFileSync(join(repo, 'a.txt'), 'ligne 1 — façon 1\nligne 2\nligne 3 — main\n')
    await git(repo, 'commit', '-m', 'main bouge', '--', 'a.txt')
    writeFileSync(join(copie, 'd.txt'), 'second passage\n')

    const second = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(d): second passage (conv-1)',
      publication,
      runId: 'porte-test-3b'
    })

    expect(second).toMatchObject({ ok: true, etat: 'publie', fichiers: ['d.txt'] })
    expect(
      (await git(repo, 'show', '--name-only', '--format=', 'main')).split('\n').filter(Boolean)
    ).toEqual(['d.txt'])
    expect(await git(repo, 'show', 'main:a.txt')).toBe(
      'ligne 1 — façon 1\nligne 2\nligne 3 — main\n'
    )
    expect(await lireLaBaseDuFil({ dossier: copie, conversationId: 'conv-1' })).toBe(
      second.ok && second.etat === 'publie' ? second.passage : 'aucun passage'
    )
  })

  it('conflit avec main : refus qui nomme les fichiers, rien n’entre dans main, la base ne bouge pas', async () => {
    const { repo, copie, base } = await filEnCopie()
    writeFileSync(join(repo, 'a.txt'), 'ligne 1 — changée dans main\nligne 2\nligne 3\n')
    await git(repo, 'commit', '-m', 'main bouge', '--', 'a.txt')
    const mainAvant = (await git(repo, 'rev-parse', 'main')).trim()
    travaillerDansLaCopie(copie)
    const publication = publicationReelle(repo)

    const garde = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(a): change la ligne 1 (conv-1)',
      publication,
      runId: 'porte-test-4'
    })

    expect(garde).toMatchObject({ ok: false, motif: 'conflit', fichiers: ['a.txt'] })
    if (garde.ok) return
    expect(garde.raison).toContain('a.txt')
    expect((await git(repo, 'rev-parse', 'main')).trim()).toBe(mainAvant)
    expect(await git(repo, 'status', '--porcelain')).toBe('')
    expect(await lireLaBaseDuFil({ dossier: copie, conversationId: 'conv-1' })).toBe(base)
    // Le travail du fil reste dans sa copie.
    expect(readFileSync(join(copie, 'b.txt'), 'utf8')).toBe('nouveau\n')
  })

  it('passage sans changement : refus « rien à garder », aucune copie de publication ouverte', async () => {
    const { repo, copie } = await filEnCopie()
    const publication = publicationReelle(repo)
    // Seul un fichier ignoré a bougé : ce n'est pas du code à garder.
    mkdirSync(join(copie, 'ignore'))
    writeFileSync(join(copie, 'ignore', 'cache.txt'), 'jetable\n')

    const garde = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'chore: rien (conv-1)',
      publication,
      runId: 'porte-test-5'
    })

    expect(garde).toMatchObject({ ok: false, motif: 'rien-a-garder' })
    if (garde.ok) return
    expect(garde.raison).toContain('rien à garder')
    expect(publication.ouvertes).toEqual([])
  })

  it('base disparue : refus avec la raison, jamais la copie entière publiée', async () => {
    const { repo, copie } = await filEnCopie()
    travaillerDansLaCopie(copie)
    await git(repo, 'update-ref', '-d', 'refs/autowin/base-de-fil/conv-1')
    const mainAvant = (await git(repo, 'rev-parse', 'main')).trim()
    const publication = publicationReelle(repo)

    const garde = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(a): change la ligne 1 (conv-1)',
      publication,
      runId: 'porte-test-6'
    })

    expect(garde).toMatchObject({ ok: false, motif: 'base-absente' })
    if (garde.ok) return
    expect(garde.raison).toContain('base')
    expect(publication.ouvertes).toEqual([])
    expect((await git(repo, 'rev-parse', 'main')).trim()).toBe(mainAvant)
  })

  it('le titre se tire des fichiers du passage, et le passage se reconnaît comme porte', async () => {
    const { repo, copie } = await filEnCopie()
    travaillerDansLaCopie(copie)
    const publication = publicationReelle(repo)

    await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: (fichiers) => `feat: ${fichiers.join(' ')} (conv-1)`,
      publication
    })

    expect((await git(repo, 'log', '-1', '--format=%s', 'main')).trim()).toBe(
      'feat: a.txt b.txt c.txt (conv-1)'
    )
    expect(publication.ouvertes).toHaveLength(1)
    expect(estUnPassageDePorte(publication.ouvertes[0] ?? '')).toBe(true)
    // Les autres publications d'une copie gardent leur envoi vers le distant.
    expect(estUnPassageDePorte('essai-1000-1-abc')).toBe(false)
    expect(estUnPassageDePorte('run-ea7117339b80-1')).toBe(false)
  })
})

/**
 * LE BRANCHEMENT DANS LE PROCESSUS PRINCIPAL, lu dans son code (le constructeur de l'app ne se joue
 * pas en test). Mesuré : une copie publiée par `endAsync({ merge: true })` appelle
 * `onRecoveredPublication`, qui pousse main vers le distant quand l'enchaînement auto est allumé.
 * Une garde par lecture de source prouve seulement que le câblage n'est pas ABSENT.
 */
describe('la porte branchée dans le processus principal', () => {
  const source = ((): string => {
    const racine = join(process.cwd(), 'src', 'main')
    for (const nom of readdirSync(racine, { recursive: true, encoding: 'utf8' })) {
      if (!nom.endsWith('.ts') || nom.endsWith('.test.ts')) continue
      const texte = readFileSync(join(racine, nom), 'utf8')
      if (texte.includes('onRecoveredPublication: async')) return texte
    }
    return ''
  })()

  it('la publication d’un passage de porte n’enchaîne aucun envoi vers le distant', () => {
    const rappel = source.slice(source.indexOf('onRecoveredPublication: async'))
    const garde = rappel.indexOf('!estUnPassageDePorte(publication.runId)')
    expect(garde).toBeGreaterThan(-1)
    expect(garde).toBeLessThan(rappel.indexOf('closeGreenRunOnDisk('))
  })

  it('la fin de tour du chat reçoit la porte, montée sur la publication d’une copie', () => {
    const appel = source.slice(source.indexOf('await publierTourDeChat({')).slice(0, 1500)
    expect(appel).toMatch(/porte: \{\s*depot,\s*publication: \{/u)
    expect(appel).toContain('worktrees.endAsync(runId, { merge: publier })')
  })
})
