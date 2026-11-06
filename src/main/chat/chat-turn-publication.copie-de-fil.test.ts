import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationFileTrace } from '../activity/conversation-file-trace-spool'
import {
  partageLeDepot,
  photographierDebutDeTour,
  publierTourDeChat
} from './chat-turn-publication'
import type { GitRunner } from '../runs/run-autoclose'
import { supprimerArbre } from '../fichiers/fs-supprimer'

/*
 * UN TOUR QUI TOURNE DANS SA COPIE NE RETIENT PAS LA PUBLICATION D'UN FIL RESTÉ DANS LE DÉPÔT.
 *
 * La copie d'un fil vit SOUS le dossier du dépôt (`<dépôt>\.autowin-data\autowin-os\…`, ignoré par
 * git). Comparé par simple chemin, son dossier « est dans » le dépôt : la publication d'un fil
 * encore dans le dépôt mettait alors de côté, motif `autre-fil-en-cours`, tout fichier qu'elle ne
 * prouvait que par le repli « aucun autre tour en cours ». Or la copie a son propre arbre de
 * travail : ce que son tour écrit y reste, et n'entre dans le dépôt que par la porte.
 *
 * Entrée qui ferait échouer ces tests si la correction était fausse : un dossier ORDINAIRE sous
 * `.autowin-data` (sans `.git`) doit TOUJOURS retenir la publication. Une correction qui écarterait
 * tout ce qui est sous `.autowin-data`, ou tout sous-dossier du dépôt, le laisserait passer.
 */

/** Vrais dépôts git en tmp : sous charge parallèle, le budget vitest par défaut (5 s) est trop court. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const run = promisify(execFile)
const realGit: GitRunner = async (args, cwd) => (await run('git', args, { cwd })).stdout

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) supprimerArbre(d)
})

const DEBUT = 1_000_000
const PENDANT = new Date(DEBUT + 5_000).toISOString()

/**
 * Dépôt sur `travail` avec un « distant » local, et la COPIE d'un autre fil rangée comme celles de
 * l'app : copie git liée, détachée, sous le dossier de données ignoré du dépôt.
 */
async function depotAvecCopie(): Promise<{
  repo: string
  remote: string
  copie: string
  ordinaire: string
}> {
  const root = mkdtempSync(join(tmpdir(), 'autowin-chat-pub-copie-'))
  dirs.push(root)
  const repo = join(root, 'work')
  const remote = join(root, 'remote.git')
  mkdirSync(repo)
  await run('git', ['init', '--bare', remote])
  await run('git', ['init', '-b', 'travail'], { cwd: repo })
  await run('git', ['config', 'user.email', 't@t.t'], { cwd: repo })
  await run('git', ['config', 'user.name', 'T'], { cwd: repo })
  writeFileSync(join(repo, '.gitignore'), '.autowin-data\n')
  writeFileSync(join(repo, 'partage.ts'), 'export const partage = 0\n')
  await run('git', ['add', '-A'], { cwd: repo })
  await run('git', ['commit', '-m', 'base'], { cwd: repo })
  await run('git', ['remote', 'add', 'origin', remote], { cwd: repo })
  await run('git', ['push', 'origin', 'travail'], { cwd: repo })
  const donnees = join(repo, '.autowin-data', 'autowin-os')
  const copie = join(donnees, 'retours-de-tour', 'essai__conv-B-1-1')
  mkdirSync(dirname(copie), { recursive: true })
  await run('git', ['worktree', 'add', '--detach', copie, 'HEAD'], { cwd: repo })
  mkdirSync(join(copie, 'src'))
  // Un dossier de données SANS arbre de travail à lui : git y travaille sur le dépôt.
  const ordinaire = join(donnees, 'brouillon')
  mkdirSync(ordinaire)
  return { repo, remote, copie, ordinaire }
}

/** Trace du fil A sans lignes ni commande nommée : seul le repli « aucun autre tour en cours » le prouve. */
function traceSansPreuve(repo: string): ConversationFileTrace {
  return {
    timestamp: PENDANT,
    conversationId: 'conv-A',
    turnId: 'tour-A-0001',
    workspaceRoot: repo,
    source: 'chat_tool',
    paths: ['partage.ts']
  }
}

async function fichiersDuDernierCommitDistant(remote: string): Promise<string[]> {
  return (await run('git', ['show', '--name-only', '--format=', 'travail'], { cwd: remote })).stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function publierPendantUnTourDans(
  repo: string,
  dossierDeLAutreTour: string
): ReturnType<typeof publierTourDeChat> {
  const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
  writeFileSync(join(repo, 'partage.ts'), 'export const partage = 4\n')
  return publierTourDeChat({
    conversationId: 'conv-A',
    turnId: 'tour-A-0001',
    request: 'modifie partage',
    debut,
    runGit: realGit,
    autresToursEnCours: [dossierDeLAutreTour],
    traces: [traceSansPreuve(repo)]
  })
}

describe('publication d’un fil du dépôt pendant le tour d’un fil en copie', () => {
  it('ne met rien de côté « autre-fil-en-cours » quand l’autre tour tourne dans sa copie', async () => {
    const { repo, remote, copie } = await depotAvecCopie()

    const report = await publierPendantUnTourDans(repo, copie)

    expect(report?.exclus).toBeUndefined()
    expect(report).toMatchObject({ project: { status: 'pushed', files: 1 } })
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['partage.ts'])
  })

  it('ni quand il tourne dans un sous-dossier de sa copie', async () => {
    const { repo, remote, copie } = await depotAvecCopie()

    const report = await publierPendantUnTourDans(repo, join(copie, 'src'))

    expect(report?.exclus).toBeUndefined()
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['partage.ts'])
  })

  it('jumeau : un tour dans un dossier ordinaire sous le dossier de données retient toujours le fichier', async () => {
    const { repo, ordinaire } = await depotAvecCopie()

    const report = await publierPendantUnTourDans(repo, ordinaire)

    expect(report?.exclus).toEqual([
      expect.objectContaining({ path: 'partage.ts', motif: 'autre-fil-en-cours' })
    ])
  })

  it('jumeau : un tour dans le dépôt lui-même retient toujours le fichier', async () => {
    const { repo } = await depotAvecCopie()

    const report = await publierPendantUnTourDans(repo, repo)

    expect(report?.exclus).toEqual([
      expect.objectContaining({ path: 'partage.ts', motif: 'autre-fil-en-cours' })
    ])
  })
})

describe('partageLeDepot — qui peut écrire dans l’arbre de travail du dépôt', () => {
  it('une copie de fil, ou un de ses sous-dossiers, ne partage pas le dépôt', async () => {
    const { repo, copie } = await depotAvecCopie()

    expect(partageLeDepot(repo, copie)).toBe(false)
    expect(partageLeDepot(repo, join(copie, 'src'))).toBe(false)
  })

  it('le dépôt, ses sous-dossiers ordinaires et un dossier qui le contient le partagent', async () => {
    const { repo, ordinaire } = await depotAvecCopie()

    expect(partageLeDepot(repo, repo)).toBe(true)
    expect(partageLeDepot(repo, join(repo, 'src'))).toBe(true)
    expect(partageLeDepot(repo, ordinaire)).toBe(true)
    expect(partageLeDepot(repo, dirname(repo))).toBe(true)
  })

  it('un dossier hors du dépôt ne le partage pas', async () => {
    const { repo } = await depotAvecCopie()
    const ailleurs = mkdtempSync(join(tmpdir(), 'autowin-chat-pub-copie-ailleurs-'))
    dirs.push(ailleurs)

    expect(partageLeDepot(repo, ailleurs)).toBe(false)
  })
})
