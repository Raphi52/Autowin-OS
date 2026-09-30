import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationFileTrace } from './activity/conversation-file-trace-spool'
import { photographierDebutDeTour, publierTourDeChat } from './chat-turn-publication'
import { exactLineFingerprint } from './exact-line-fingerprint'
import type { GitRunner } from './run-autoclose'

/** Vrais dépôts git en tmp : sous charge parallèle, le budget vitest par défaut (5 s) est trop court. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const run = promisify(execFile)
const realGit: GitRunner = async (args, cwd) => (await run('git', args, { cwd })).stdout

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Dépôt de travail sur la branche `travail` + un « distant » local (bare) pour observer le push. */
async function depot(): Promise<{ repo: string; remote: string }> {
  // Nom court Windows volontairement conservé côté trace : le module doit le rapprocher de git.
  const root = mkdtempSync(join(tmpdir(), 'autowin-chat-pub-'))
  dirs.push(root)
  const repo = join(root, 'work')
  const remote = join(root, 'remote.git')
  mkdirSync(repo)
  await run('git', ['init', '--bare', remote])
  await run('git', ['init', '-b', 'travail'], { cwd: repo })
  await run('git', ['config', 'user.email', 't@t.t'], { cwd: repo })
  await run('git', ['config', 'user.name', 'T'], { cwd: repo })
  writeFileSync(join(repo, 'base.txt'), 'base\n')
  writeFileSync(join(repo, 'partage.ts'), 'export const partage = 0\n')
  await run('git', ['add', '-A'], { cwd: repo })
  await run('git', ['commit', '-m', 'base'], { cwd: repo })
  await run('git', ['remote', 'add', 'origin', remote], { cwd: repo })
  await run('git', ['push', 'origin', 'travail'], { cwd: repo })
  return { repo, remote }
}

const DEBUT = 1_000_000
const PENDANT = new Date(DEBUT + 5_000).toISOString()
const AVANT = new Date(DEBUT - 5_000).toISOString()

function trace(
  repo: string,
  partial: Partial<ConversationFileTrace> & Pick<ConversationFileTrace, 'paths'>
): ConversationFileTrace {
  return {
    timestamp: PENDANT,
    conversationId: 'conv-A',
    turnId: 'tour-A-0001',
    workspaceRoot: repo,
    source: 'chat_tool',
    ...partial
  }
}

const lignes = (...contenu: string[]): string[] => contenu.map(exactLineFingerprint)

async function fichiersDuDernierCommitDistant(remote: string): Promise<string[]> {
  return (await run('git', ['show', '--name-only', '--format=', 'travail'], { cwd: remote })).stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function enAttente(repo: string): Promise<string> {
  return (await run('git', ['status', '--porcelain'], { cwd: repo })).stdout
}

describe('enchaînement auto du chat — publication des fichiers du tour', () => {
  it('commite SEULEMENT le fichier écrit par le tour et le pousse sur la branche courante', async () => {
    const { repo, remote } = await depot()
    // Travail d'un autre fil, en attente AVANT le tour : il ne doit pas partir.
    writeFileSync(join(repo, 'base.txt'), 'base\nautre fil\n')
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'mine.ts'), 'export const a = 1\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute la constante a',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          paths: ['mine.ts'],
          pathLineFingerprints: { 'mine.ts': lignes('export const a = 1') }
        }),
        // Bruit mesuré en réel : un autre fil « voit » ce fichier changer pendant son propre tour.
        trace(repo, { conversationId: 'conv-B', turnId: 'tour-B', paths: ['mine.ts'] })
      ]
    })

    expect(report).toMatchObject({
      source: 'chat',
      project: { status: 'pushed', mode: 'direct', branch: 'travail', files: 1 }
    })
    expect(report?.brain).toBeUndefined()
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['mine.ts'])
    const subject = (await run('git', ['log', '-1', '--format=%s'], { cwd: repo })).stdout.trim()
    expect(subject).toBe('auto(conv-A): ajoute la constante a')
    // Le travail de l'autre fil est intact, toujours en attente.
    expect(await enAttente(repo)).toContain('base.txt')
  })

  it('laisse en attente un fichier sans preuve par lignes quand un autre fil y a touché pendant le tour', async () => {
    const { repo, remote } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    const headAvant = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 1\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'modifie partage',
      debut,
      runGit: realGit,
      traces: [
        // Édition en ligne de commande : le journal ne connaît que le chemin, pas les lignes.
        trace(repo, { paths: ['partage.ts'] }),
        trace(repo, { conversationId: 'conv-B', turnId: 'tour-B', paths: ['partage.ts'] })
      ]
    })

    expect(report).toMatchObject({
      project: { status: 'skipped', reason: 'unattributed' },
      exclus: [{ path: 'partage.ts', motif: 'touche-par-un-autre-fil' }]
    })
    expect((await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout).toBe(headAvant)
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['base.txt', 'partage.ts'])
    expect(await enAttente(repo)).toContain('partage.ts')
  })

  it('laisse en attente un fichier sans preuve par lignes déjà modifié avant le tour', async () => {
    const { repo } = await depot()
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 1\n')
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 2\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'modifie partage',
      debut,
      runGit: realGit,
      traces: [trace(repo, { paths: ['partage.ts'] })]
    })

    expect(report).toMatchObject({
      project: { status: 'skipped', reason: 'unattributed' },
      exclus: [{ path: 'partage.ts', motif: 'modifie-avant-le-tour' }]
    })
  })

  it('nomme le nombre de lignes non réclamées d’un fichier écarté, sans l’assouplir', async () => {
    // Mesuré le 2026-09-29 : brain-curation-run.test.ts portait 146 lignes ajoutées, dont 144 écrites
    // par l'outil d'édition du fil et 2 reformatées en ligne de commande. La preuve par lignes est en
    // tout ou rien : il est resté écarté tour après tour, sans que rien dise ce qui manquait.
    const { repo } = await depot()
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 0\nexport const b = 1\n')
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    const headAvant = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout
    writeFileSync(
      join(repo, 'partage.ts'),
      'export const partage = 0\nexport const b = 1\nexport const c = 2\nexport const d = 3\n'
    )

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute c et d',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          paths: ['partage.ts'],
          pathLineFingerprints: { 'partage.ts': lignes('export const c = 2', 'export const d = 3') }
        })
      ]
    })

    expect(report).toMatchObject({
      project: { status: 'skipped', reason: 'unattributed' },
      exclus: [{ path: 'partage.ts', motif: 'modifie-avant-le-tour', lignesNonReclamees: 1 }]
    })
    expect((await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout).toBe(headAvant)
  })

  it('publie un fichier déjà modifié avant le tour dès que TOUTES ses lignes sont réclamées, même par un tour précédent', async () => {
    // Le rattrapage d'un fichier bloqué : réécrire avec l'outil d'édition ses lignes non réclamées.
    const { repo, remote } = await depot()
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 0\nexport const b = 1\n')
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(
      join(repo, 'partage.ts'),
      'export const partage = 0\nexport const b = 1\nexport const c = 2\n'
    )

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute c',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          timestamp: AVANT,
          turnId: 'tour-A-0000',
          paths: ['partage.ts'],
          pathLineFingerprints: { 'partage.ts': lignes('export const b = 1') }
        }),
        trace(repo, {
          paths: ['partage.ts'],
          pathLineFingerprints: { 'partage.ts': lignes('export const c = 2') }
        })
      ]
    })

    expect(report).toMatchObject({ project: { status: 'pushed', files: 1 } })
    expect(report?.exclus).toBeUndefined()
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['partage.ts'])
  })

  it('publie une édition en ligne de commande quand personne d’autre n’a touché au fichier', async () => {
    const { repo, remote } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 3\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'modifie partage',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, { paths: ['partage.ts'] }),
        // Une trace d'un autre fil ANTÉRIEURE au tour n'est pas du travail concurrent.
        trace(repo, {
          conversationId: 'conv-B',
          turnId: 'tour-B',
          paths: ['partage.ts'],
          timestamp: AVANT
        })
      ]
    })

    expect(report).toMatchObject({ project: { status: 'pushed', mode: 'direct', files: 1 } })
    expect(report?.exclus).toBeUndefined()
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['partage.ts'])
  })

  it('laisse en attente un fichier sans preuve par lignes tant qu’un autre fil a un tour en cours dans le dépôt', async () => {
    // Mesuré le 2026-09-30 (commits 5fb0730d, bb8e6c0c) : conv-889 crée un fichier PENDANT le tour de
    // conv-891. Ses traces ne sont écrites qu'à la fin de son appel au modèle (10:51:52), après la
    // publication de conv-891 (10:32:31) : aucune trace concurrente, donc le repli publiait au nom de
    // conv-891 le travail de conv-889. Le fichier prouvé par ses lignes, lui, part quand même.
    const { repo, remote } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    const headAvant = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout
    writeFileSync(join(repo, 'mesure.mts'), 'console.log("conv-B")\n')
    writeFileSync(join(repo, 'mine.ts'), 'export const a = 1\n')
    mkdirSync(join(repo, 'src'))

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'pourquoi ?',
      debut,
      runGit: realGit,
      // Le tour de conv-B tourne encore, rangé dans un sous-dossier du même dépôt.
      autresToursEnCours: [join(repo, 'src')],
      traces: [
        // Comparaison avant/après de conv-A : elle voit le fichier de conv-B changer, sans lignes.
        trace(repo, { paths: ['mesure.mts'] }),
        trace(repo, {
          paths: ['mine.ts'],
          pathLineFingerprints: { 'mine.ts': lignes('export const a = 1') }
        })
      ]
    })

    expect(report).toMatchObject({
      project: { status: 'pushed', files: 1 },
      exclus: [{ path: 'mesure.mts', motif: 'autre-fil-en-cours' }]
    })
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['mine.ts'])
    expect((await run('git', ['rev-parse', 'HEAD~1'], { cwd: repo })).stdout).toBe(headAvant)
    expect(await enAttente(repo)).toContain('mesure.mts')
  })

  it('un tour en cours dans un AUTRE dépôt ne retient pas le repli', async () => {
    const { repo, remote } = await depot()
    const ailleurs = mkdtempSync(join(tmpdir(), 'autowin-chat-pub-ailleurs-'))
    dirs.push(ailleurs)
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 4\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'modifie partage',
      debut,
      runGit: realGit,
      autresToursEnCours: [ailleurs],
      traces: [trace(repo, { paths: ['partage.ts'] })]
    })

    expect(report).toMatchObject({ project: { status: 'pushed', files: 1 } })
    expect(report?.exclus).toBeUndefined()
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['partage.ts'])
  })

  it('ne rend aucun rapport et ne commite rien quand le tour n’a modifié aucun fichier', async () => {
    const { repo } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'autre.ts'), 'export const b = 2\n')
    const headAvant = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'question',
      debut,
      runGit: realGit,
      traces: [
        // Autre tour du même fil, et travail d'une tâche d'agent : ni l'un ni l'autre n'est ce tour.
        trace(repo, { turnId: 'tour-precedent', paths: ['autre.ts'] }),
        trace(repo, { source: 'subagent', paths: ['autre.ts'] })
      ]
    })

    expect(report).toBeUndefined()
    expect((await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout).toBe(headAvant)
  })

  it('sans dépôt git lisible au départ du tour, ne publie rien', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-chat-pub-nogit-'))
    dirs.push(root)
    const debut = await photographierDebutDeTour(root, realGit, DEBUT)
    expect(debut.repo).toBeUndefined()
    expect(await photographierDebutDeTour('', realGit, DEBUT)).toEqual({
      startedAt: DEBUT,
      dirty: []
    })

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'x',
      debut,
      runGit: realGit,
      traces: [trace(root, { paths: ['x.ts'] })]
    })
    expect(report).toBeUndefined()
  })

  it('un git bloqué au départ ne retient pas le tour : pas de photo, donc pas de publication', async () => {
    const bloque: GitRunner = () => new Promise<string>(() => {})
    const debut = await photographierDebutDeTour('D:/nimporte', bloque, DEBUT, 50)
    expect(debut).toEqual({ startedAt: DEBUT, dirty: [] })
  })

  it('reconnaît ses fichiers quand la trace porte le chemin réel et git un autre libellé', async () => {
    const { repo, remote } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'mine.ts'), 'export const c = 3\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'constante c',
      debut,
      runGit: realGit,
      traces: [
        trace(realpathSync.native(repo), {
          paths: ['mine.ts'],
          pathLineFingerprints: { 'mine.ts': lignes('export const c = 3') }
        })
      ]
    })

    expect(report).toMatchObject({ project: { status: 'pushed', files: 1 } })
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['mine.ts'])
  })
})
