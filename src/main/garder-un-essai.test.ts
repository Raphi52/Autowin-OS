import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre } from './fs-supprimer'
import { ouvrirCopiesDEssai } from './photo-du-code'
import {
  ecartDeLEssai,
  garderLEssai,
  lireNomDEssai,
  type PublicationDUneCopie
} from './garder-un-essai'
import type { FinalizeResult } from './store/worktree-manager'

/**
 * « ESSAIE 3 FAÇONS » : COMPARER, PUIS GARDER CELLE-CI (conv-1038, 2026-10-21 — idée 6).
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
  // conv-1038, 2026-10-21 : le nom d'une copie accepte tout fil (`(.+)`), la référence de photo non
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
  // VOISINES changées et 0 quand une ligne inchangée les sépare (mesuré le 2026-10-21, conv-1038).
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
