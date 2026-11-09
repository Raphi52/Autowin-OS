import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { arbreDeLaCopie } from '../orchestration/garder-un-essai'
import { defaultGitRunner } from '../runs/run-autoclose'
import { ligneDeMiseAJour, mettreLaCopieDuFilAJour } from './copie-du-fil-a-jour'
import { ouvrirLaCopieDeTache } from '../copies/copie-de-tache'
import { avancerLaBaseDuFil, lireLaBaseDuFil } from './photo-du-code'

/**
 * La copie d'un fil suit main au début de chaque tour, et ne perd jamais rien.
 * Entrées qui doivent faire échouer une version fausse :
 *  - un fichier ajouté, un modifié et un retiré par un autre fil dans main : la copie doit les avoir
 *    tous les trois, retrait compris ;
 *  - un fichier que le fil a créé (non suivi dans la copie) et déjà fait entrer dans main : il doit
 *    devenir suivi, sans rien laisser « modifié » ;
 *  - une copie qui porte un travail pas encore entré dans main : elle ne doit pas bouger d'un octet ;
 *  - après la mise à jour, le passage suivant de la porte ne doit publier QUE le travail du fil.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const run = promisify(execFile)
const git = async (cwd: string, ...args: string[]): Promise<string> =>
  (await run('git', args, { cwd })).stdout.trim()
const lire = (chemin: string): string => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')

const dossiers: string[] = []
afterEach(() => {
  for (const dossier of dossiers.splice(0)) supprimerArbre(dossier)
})

/** Un dépôt sur main et la copie du fil `conv-1`, ouverte et pourvue de sa base. */
async function depotEtCopie(): Promise<{ repo: string; copie: string }> {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-copie-a-jour-'))
  dossiers.push(racine)
  const repo = join(racine, 'depot')
  mkdirSync(repo)
  await git(repo, 'init', '-b', 'main')
  await git(repo, 'config', 'user.name', 'Test')
  await git(repo, 'config', 'user.email', 'test@example.invalid')
  writeFileSync(join(repo, 'a.txt'), 'a d’origine\n')
  writeFileSync(join(repo, 'c.txt'), 'c, bientôt retiré\n')
  writeFileSync(join(repo, '.gitignore'), 'ignore/\n')
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-m', 'base')
  const ouverte = await ouvrirLaCopieDeTache({
    dossierDeDonnees: racine,
    depot: repo,
    tache: 'conv-1',
    sansDistant: true
  })
  if (!ouverte.ok) throw new Error(ouverte.raison)
  return { repo, copie: ouverte.chemin }
}

/** Un autre fil publie dans main : un ajout, une modification, un retrait. */
async function unAutreFilPublie(repo: string): Promise<void> {
  writeFileSync(join(repo, 'a.txt'), 'a modifié par un autre fil\n')
  writeFileSync(join(repo, 'b.txt'), 'b ajouté par un autre fil\n')
  await git(repo, 'rm', '-q', 'c.txt')
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-m', 'autre fil')
}

/** La porte, réduite à ce qui compte ici : main reçoit l'écart du fil, la base avance au passage. */
async function passerLaPorte(repo: string, copie: string): Promise<void> {
  const gitRunner = await defaultGitRunner()
  const base = (await lireLaBaseDuFil({ dossier: copie, conversationId: 'conv-1' })) as string
  const arbre = await arbreDeLaCopie(copie, gitRunner)
  const passage = await git(copie, 'commit-tree', arbre, '-p', base, '-m', 'passage')
  await git(repo, 'merge', '-q', '--no-edit', passage)
  const avancee = await avancerLaBaseDuFil({
    dossier: copie,
    conversationId: 'conv-1',
    depuis: base,
    vers: passage
  })
  expect(avancee.ok).toBe(true)
}

describe('mettreLaCopieDuFilAJour — la copie suit main sans rien perdre', () => {
  it('apporte l’ajout, la modification et le retrait d’un autre fil, puis la base suit main', async () => {
    const { repo, copie } = await depotEtCopie()
    await unAutreFilPublie(repo)
    const main = await git(repo, 'rev-parse', 'HEAD')

    const issue = await mettreLaCopieDuFilAJour({ copie, conversationId: 'conv-1', depot: repo })

    expect(issue).toEqual({ fait: 'mise-a-jour', fichiers: 3, main, base: main })
    expect(lire(join(copie, 'a.txt'))).toBe('a modifié par un autre fil\n')
    expect(lire(join(copie, 'b.txt'))).toBe('b ajouté par un autre fil\n')
    expect(existsSync(join(copie, 'c.txt'))).toBe(false)
    expect(await git(copie, 'rev-parse', 'HEAD')).toBe(main)
    expect(await git(copie, 'status', '--porcelain')).toBe('')
    expect(ligneDeMiseAJour(issue)).toBe(
      '🔄 Copie du fil mise à jour avec main : 3 fichiers venus des autres fils.'
    )
  })

  it('un fichier créé par le fil et déjà entré dans main devient suivi, sans rien laisser modifié', async () => {
    const { repo, copie } = await depotEtCopie()
    writeFileSync(join(copie, 'du-fil.txt'), 'écrit par le fil\n')
    mkdirSync(join(copie, 'ignore'))
    writeFileSync(join(copie, 'ignore', 'cache.txt'), 'ignoré, reste là\n')
    await passerLaPorte(repo, copie)
    await unAutreFilPublie(repo)

    const issue = await mettreLaCopieDuFilAJour({ copie, conversationId: 'conv-1', depot: repo })

    expect(issue.fait).toBe('mise-a-jour')
    expect(lire(join(copie, 'du-fil.txt'))).toBe('écrit par le fil\n')
    expect(lire(join(copie, 'b.txt'))).toBe('b ajouté par un autre fil\n')
    expect(lire(join(copie, 'ignore', 'cache.txt'))).toBe('ignoré, reste là\n')
    expect(await git(copie, 'status', '--porcelain')).toBe('')
  })

  it('après la mise à jour, la porte suivante ne voit QUE le travail du fil', async () => {
    const { repo, copie } = await depotEtCopie()
    await unAutreFilPublie(repo)
    await mettreLaCopieDuFilAJour({ copie, conversationId: 'conv-1', depot: repo })
    writeFileSync(join(copie, 'a.txt'), 'a repris par le fil\n')

    const base = (await lireLaBaseDuFil({ dossier: copie, conversationId: 'conv-1' })) as string
    const arbre = await arbreDeLaCopie(copie, await defaultGitRunner())

    expect(await git(copie, 'diff', '--name-only', base, arbre)).toBe('a.txt')
  })

  it('une copie qui porte du travail pas encore entré dans main ne bouge pas', async () => {
    const { repo, copie } = await depotEtCopie()
    const head = await git(copie, 'rev-parse', 'HEAD')
    const base = await lireLaBaseDuFil({ dossier: copie, conversationId: 'conv-1' })
    writeFileSync(join(copie, 'a.txt'), 'travail du fil, pas publié\n')
    await unAutreFilPublie(repo)

    const issue = await mettreLaCopieDuFilAJour({ copie, conversationId: 'conv-1', depot: repo })

    expect(issue).toEqual({
      fait: 'laissee',
      raison: 'elle porte du travail qui n’est pas encore entré dans main'
    })
    expect(lire(join(copie, 'a.txt'))).toBe('travail du fil, pas publié\n')
    expect(existsSync(join(copie, 'b.txt'))).toBe(false)
    expect(existsSync(join(copie, 'c.txt'))).toBe(true)
    expect(await git(copie, 'rev-parse', 'HEAD')).toBe(head)
    expect(await lireLaBaseDuFil({ dossier: copie, conversationId: 'conv-1' })).toBe(base)
    expect(ligneDeMiseAJour(issue)).toBe(
      '⚠️ Copie du fil pas mise à jour avec main : elle porte du travail qui n’est pas encore entré dans main.'
    )
  })

  it('main n’a pas bougé : rien à faire, rien à dire', async () => {
    const { repo, copie } = await depotEtCopie()
    const issue = await mettreLaCopieDuFilAJour({ copie, conversationId: 'conv-1', depot: repo })
    expect(issue).toEqual({ fait: 'deja-a-jour' })
    expect(ligneDeMiseAJour(issue)).toBeNull()
  })

  it('sans base, la copie reste telle quelle et la raison est rendue', async () => {
    const { repo, copie } = await depotEtCopie()
    const issue = await mettreLaCopieDuFilAJour({ copie, conversationId: 'conv-2', depot: repo })
    expect(issue).toEqual({ fait: 'laissee', raison: 'la copie n’a pas de base' })
  })
})
