import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { attendreFichier } from '../gel/ecriture-hors-fil'
import { WorktreeRunStateStore, type WorktreeRunRecord } from './worktree-run-state'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'autowin-worktree-state-'))
  roots.push(root)
  return root
}

function record(root: string, overrides: Partial<WorktreeRunRecord> = {}): WorktreeRunRecord {
  return {
    version: 1,
    repoId: 'repo-a',
    runId: 'run-red',
    agentName: 'Builder',
    role: 'build',
    task: 'corrige le cycle',
    worktreePath: join(root, 'agent__run-red'),
    baseBranch: 'main',
    baseSha: '1'.repeat(40),
    verdict: 'red',
    publication: 'not-requested',
    files: [{ path: 'src/main/app/os.ts', kind: 'mod' }],
    createdAtMs: 10,
    updatedAtMs: 20,
    ...overrides
  }
}

afterEach(async () => {
  // Une écriture encore en vol recréerait le dossier après son effacement.
  await attendreFichier()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('WorktreeRunStateStore', () => {
  it('conserve un verdict rouge à travers deux redémarrages', () => {
    const root = tempRoot()
    new WorktreeRunStateStore(root, 'repo-a').save(record(root))

    const firstRestart = new WorktreeRunStateStore(root, 'repo-a')
    expect(firstRestart.get('run-red')).toMatchObject({
      verdict: 'red',
      publication: 'not-requested'
    })

    const secondRestart = new WorktreeRunStateStore(root, 'repo-a')
    expect(secondRestart.get('run-red')).toMatchObject({
      verdict: 'red',
      publication: 'not-requested'
    })
  })

  it('inventorie un manifeste déposé par un autre magasin et pas encore posé', async () => {
    const root = tempRoot()
    const ecrivain = new WorktreeRunStateStore(root, 'repo-a')
    ecrivain.save(record(root))
    ecrivain.save(record(root, { runId: 'run-gone', worktreePath: join(root, 'agent__run-gone') }))
    ecrivain.remove('run-gone')

    // Même processus, autre instance : c'est ce que fait un redémarrage simulé, ou un second lecteur.
    const relecteur = new WorktreeRunStateStore(root, 'repo-a')
    expect(relecteur.list().map((r) => r.runId)).toEqual(['run-red'])
    await attendreFichier()
    expect(relecteur.list().map((r) => r.runId)).toEqual(['run-red'])
  })

  it('refuse fail-closed un manifeste corrompu ou attribué à un autre dépôt', () => {
    const root = tempRoot()
    const store = new WorktreeRunStateStore(root, 'repo-a')
    mkdirSync(join(root, '.runs'), { recursive: true })
    writeFileSync(
      store.pathFor('foreign'),
      JSON.stringify(
        record(root, {
          runId: 'foreign',
          repoId: 'repo-b',
          worktreePath: join(root, 'agent__foreign')
        })
      )
    )
    writeFileSync(store.pathFor('broken'), '{')
    writeFileSync(
      store.pathFor('invalid-verdict'),
      JSON.stringify(
        record(root, {
          runId: 'invalid-verdict',
          verdict: 'red',
          worktreePath: join(root, 'agent__invalid-verdict')
        }) as unknown
      ).replace('"verdict":"red"', '"verdict":"magically-green"')
    )

    expect(store.get('foreign')).toMatchObject({
      runId: 'foreign',
      verdict: 'unknown',
      publication: 'blocked'
    })
    expect(store.get('broken')).toMatchObject({
      runId: 'broken',
      verdict: 'unknown',
      publication: 'blocked'
    })
    expect(store.get('invalid-verdict')).toMatchObject({
      runId: 'invalid-verdict',
      verdict: 'unknown',
      publication: 'blocked'
    })
  })

  it('refuse fail-closed un manifeste vert forge sans contexte Git publiable', () => {
    const root = tempRoot()
    const store = new WorktreeRunStateStore(root, 'repo-a')
    mkdirSync(join(root, '.runs'), { recursive: true })
    writeFileSync(
      store.pathFor('forged-green'),
      JSON.stringify(
        record(root, {
          runId: 'forged-green',
          worktreePath: '',
          baseBranch: '',
          baseSha: '',
          verdict: 'green',
          publication: 'pending'
        })
      )
    )

    expect(store.get('forged-green')).toMatchObject({
      runId: 'forged-green',
      verdict: 'unknown',
      publication: 'blocked'
    })
  })
})

const REPO_REEL = '5a94588848d48682'
const RUN_REEL = 'run-0f53aab5f9e7-1'

/**
 * Copie fidèle d'un état réel `.runs/*.json` (version 1, publication bloquée après une fusion
 * refusée). Seuls changent la demande (`task`) et les noms des 85 fichiers exclus, remplacés par
 * des noms neutres : leur nombre et le drapeau `excludedDirtyFilesTruncated` restent ceux du
 * fichier. `worktreePath` est fourni par chaque test.
 */
function etatVersion1Reel(runId: string, worktreePath: string): WorktreeRunRecord {
  return {
    version: 1,
    repoId: REPO_REEL,
    runId,
    agentName: 'Agent',
    role: 'build',
    task: 'tâche anonymisée',
    conversationId: 'conv-1575',
    turnId: 'e6a25890-07ef-4f08-b2ae-8a3503f22575',
    worktreePath,
    worktreeAvailable: true,
    baseBranch: 'main',
    baseSha: '2ec16d76de5893019ad435d45930b1520c12d295',
    sourceSha: '2ec16d76de5893019ad435d45930b1520c12d295',
    canonicalBaseRef: 'origin/main',
    excludedDirtyFiles: Array.from({ length: 85 }, (_, i) => `src/main/fichier-${i + 1}.ts`),
    excludedDirtyFileCount: 85,
    excludedDirtyFilesTruncated: false,
    verdict: 'green',
    publication: 'blocked',
    files: [],
    publishedSha: 'b8ceae1d0b9a1075c25c874ddc8d43333d8b0138',
    publicationAgentSha: '44045840c57c3123ada0c588782fadeadcc25f3a',
    publicationBaseSha: '6ae802ee907b16c0099a0ffdfb9fdd3a0045f9ac',
    causalPublicationDeliveredAtMs: 1793871874609,
    attentionReason: 'merge-failed',
    detail:
      'La copie D:\\AutoWinOS\\.autowin-data\\autowin-os\\worktrees\\5a94588848d48682\\agent__run-0f53aab5f9e7-1 n’est pas une racine de travail : git remonte sur d:/autowinos (arbre partagé) — aucune écriture n’y est faite.',
    retryCount: 0,
    createdAtMs: 1793868028323,
    updatedAtMs: 1794131145608
  }
}

function ecrireEtatBrut(racine: string, etat: WorktreeRunRecord): string {
  mkdirSync(join(racine, '.runs'), { recursive: true })
  const chemin = join(racine, '.runs', `${etat.runId}.json`)
  writeFileSync(chemin, JSON.stringify(etat, null, 2))
  return chemin
}

describe('racine unique des copies : relecture d’un état version 1', () => {
  it('rend un état hérité sous la nouvelle racine, sans toucher aux autres champs', () => {
    const donnees = tempRoot()
    const ancienne = join(donnees, 'worktrees', REPO_REEL)
    const nouvelle = join(donnees, 'copies-de-taches')
    const etat = etatVersion1Reel(RUN_REEL, join(ancienne, `agent__${RUN_REEL}`))
    ecrireEtatBrut(ancienne, etat)

    const lu = new WorktreeRunStateStore(ancienne, REPO_REEL, {
      racineCopiesDeTaches: nouvelle
    }).get(RUN_REEL)
    expect(lu).toEqual({ ...etat, worktreePath: join(nouvelle, RUN_REEL) })
  })

  it('lit sans réécrire le fichier : relire ne déplace rien sur le disque', () => {
    const donnees = tempRoot()
    const ancienne = join(donnees, 'worktrees', REPO_REEL)
    const nouvelle = join(donnees, 'copies-de-taches')
    const chemin = ecrireEtatBrut(
      ancienne,
      etatVersion1Reel(RUN_REEL, join(ancienne, `agent__${RUN_REEL}`))
    )
    const avant = readFileSync(chemin, 'utf8')

    new WorktreeRunStateStore(ancienne, REPO_REEL, { racineCopiesDeTaches: nouvelle }).get(RUN_REEL)
    expect(readFileSync(chemin, 'utf8')).toBe(avant)
  })

  it('sans nouvelle racine, le même état reste sous l’ancienne : rien ne bouge avant le déménagement', () => {
    const donnees = tempRoot()
    const ancienne = join(donnees, 'worktrees', REPO_REEL)
    const etat = etatVersion1Reel(RUN_REEL, join(ancienne, `agent__${RUN_REEL}`))
    ecrireEtatBrut(ancienne, etat)

    expect(new WorktreeRunStateStore(ancienne, REPO_REEL).get(RUN_REEL)).toEqual(etat)
  })

  it('une écriture sous la nouvelle racine se relit à l’identique', () => {
    const donnees = tempRoot()
    const ancienne = join(donnees, 'worktrees', REPO_REEL)
    const nouvelle = join(donnees, 'copies-de-taches')
    const options = { racineCopiesDeTaches: nouvelle }
    const etat = etatVersion1Reel(RUN_REEL, join(nouvelle, RUN_REEL))
    new WorktreeRunStateStore(ancienne, REPO_REEL, options).save(etat)

    expect(new WorktreeRunStateStore(ancienne, REPO_REEL, options).get(RUN_REEL)).toEqual(etat)
  })

  it('un état déjà sous la nouvelle racine sur disque est laissé intact', () => {
    const donnees = tempRoot()
    const ancienne = join(donnees, 'worktrees', REPO_REEL)
    const nouvelle = join(donnees, 'copies-de-taches')
    const etat = etatVersion1Reel(RUN_REEL, join(nouvelle, RUN_REEL))
    ecrireEtatBrut(ancienne, etat)

    expect(
      new WorktreeRunStateStore(ancienne, REPO_REEL, { racineCopiesDeTaches: nouvelle }).get(
        RUN_REEL
      )
    ).toEqual(etat)
  })

  it('un chemin qui désigne un autre bureau reste illisible, même sous la nouvelle racine', () => {
    const donnees = tempRoot()
    const ancienne = join(donnees, 'worktrees', REPO_REEL)
    const nouvelle = join(donnees, 'copies-de-taches')
    ecrireEtatBrut(
      ancienne,
      etatVersion1Reel(RUN_REEL, join(ancienne, 'agent__run-UN-AUTRE-BUREAU'))
    )

    expect(
      new WorktreeRunStateStore(ancienne, REPO_REEL, { racineCopiesDeTaches: nouvelle }).get(
        RUN_REEL
      )
    ).toMatchObject({ publication: 'blocked', attentionReason: 'state-unreadable' })
  })

  it('une écriture sous l’ancienne racine est refusée une fois la nouvelle racine active', () => {
    const donnees = tempRoot()
    const ancienne = join(donnees, 'worktrees', REPO_REEL)
    const nouvelle = join(donnees, 'copies-de-taches')
    const store = new WorktreeRunStateStore(ancienne, REPO_REEL, { racineCopiesDeTaches: nouvelle })

    expect(() =>
      store.save(etatVersion1Reel(RUN_REEL, join(ancienne, `agent__${RUN_REEL}`)))
    ).toThrow('Manifeste de bureau invalide')
  })
})
