import { execFile } from 'node:child_process'
import {
  appendFileSync,
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
import {
  COMMANDE_CONV_932,
  COMMANDE_CONV_933
} from '../activity/commandes-ecriture-2026-10-13.fixture'
import {
  readRecentConversationFileTraces,
  type ConversationFileTrace
} from '../activity/conversation-file-trace-spool'
import { appendCallMutationTraces } from '../activity/trace-workspace-mutation'
import { photographierDebutDeTour, publierTourDeChat } from './chat-turn-publication'
import { exactLineFingerprint } from '../fichiers/exact-line-fingerprint'
import { claudeToolEvidenceKind } from '../providers/claude'
import type { ExecutionEvidence } from '../providers/types'
import type { GitRunner } from '../runs/run-autoclose'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { avancerLaBaseDuFil } from '../git/photo-du-code'
import { WorktreeManager } from '../store/worktree-manager'

/** Vrais dépôts git en tmp : sous charge parallèle, le budget vitest par défaut (5 s) est trop court. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const run = promisify(execFile)
const realGit: GitRunner = async (args, cwd) => (await run('git', args, { cwd })).stdout

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) supprimerArbre(d)
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
    // Titre `type(zone): phrase (conv-N)` (AGENTS.md) : zone = le fichier publié.
    expect(subject).toBe('feat(mine): ajoute la constante a (conv-A)')
    // Le travail de l'autre fil est intact, toujours en attente.
    expect(await enAttente(repo)).toContain('base.txt')
  })

  it('titre le commit avec la 1re action de « ✅ Fait », pas la demande elliptique (conv-1069)', async () => {
    // L'entrée qui ferait échouer ce test si la correction était fausse : la demande « vazy ».
    const { repo } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'mine.ts'), 'export const a = 1\n')

    await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'vazy',
      compteRendu:
        '### ✅ Fait\n1. **Corrigé** la constante `a` qui manquait\n\n📍 Maintenant : vert',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          paths: ['mine.ts'],
          pathLineFingerprints: { 'mine.ts': lignes('export const a = 1') }
        })
      ]
    })

    const subject = (await run('git', ['log', '-1', '--format=%s'], { cwd: repo })).stdout.trim()
    expect(subject).toBe('fix(mine): Corrigé la constante a qui manquait (conv-A)')
  })

  it('réponse en anglais : le titre du commit vient de la demande, pas du « ✅ Fait » (conv-1581)', async () => {
    // L'entrée qui ferait échouer ce test si la correction était fausse : le « ✅ Fait » anglais
    // « Created D:\…\mine.ts » — un titre encore recopié de la réponse commence par « Created ».
    const { repo } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'mine.ts'), 'export const a = 1\n')

    await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute la constante a au module',
      compteRendu: '### ✅ Fait\n1. Created D:\\depot\\mine.ts with the missing constant\n',
      langueDuCompteRendu: 'en',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          paths: ['mine.ts'],
          pathLineFingerprints: { 'mine.ts': lignes('export const a = 1') }
        })
      ]
    })

    const subject = (await run('git', ['log', '-1', '--format=%s'], { cwd: repo })).stdout.trim()
    expect(subject).toBe('feat(mine): ajoute la constante a au module (conv-A)')
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
    // Le refus NOMME le fil qui tient le fichier : sans lui, l'utilisateur ne sait pas
    // quelle conversation finir ou commiter pour débloquer la publication.
    expect(report?.exclus?.[0].fils).toEqual(['conv-B'])
    expect((await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout).toBe(headAvant)
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['base.txt', 'partage.ts'])
    expect(await enAttente(repo)).toContain('partage.ts')
  })

  /*
   * VÉCU LE 2026-10-01 (a7602f5c) : le tour a publié `src/main/commands/commands.ts`, qui importait
   * `../shared/heredocs` ; ce fichier, créé par un tour PRÉCÉDENT du même fil, n'avait jamais été
   * commité. Les tests passaient dans la copie de travail complète ; sur main le build échouait
   * (« Could not resolve »), et l'app d'un collègue ne démarrait plus. Annulé par 65b6c2b3.
   */
  it('laisse en attente un fichier qui importe un fichier local resté hors du commit (a7602f5c)', async () => {
    const { repo, remote } = await depot()
    // Tour précédent : un module NON SUIVI, jamais commité.
    writeFileSync(join(repo, 'aide.ts'), 'export const aide = 2\n')
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    const headAvant = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout
    // Ce tour : un fichier qui l'importe, entièrement réclamé par le fil.
    writeFileSync(join(repo, 'mine.ts'), "import { aide } from './aide'\nexport const a = aide\n")

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'utilise aide',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          paths: ['mine.ts'],
          pathLineFingerprints: {
            'mine.ts': lignes("import { aide } from './aide'", 'export const a = aide')
          }
        })
      ]
    })

    expect(report).toMatchObject({
      project: { status: 'skipped', reason: 'unattributed' },
      exclus: [{ path: 'mine.ts', motif: 'import-hors-commit', importsHorsCommit: ['aide.ts'] }]
    })
    expect((await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout).toBe(headAvant)
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['base.txt', 'partage.ts'])
  })

  it('publie ensemble un fichier et le module qu’il importe quand le tour a écrit les deux', async () => {
    const { repo, remote } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'aide.ts'), 'export const aide = 2\n')
    // Import d'un module SUIVI et propre (`partage.ts`) : il est dans le commit précédent.
    writeFileSync(
      join(repo, 'mine.ts'),
      "import { aide } from './aide.js'\nimport { partage } from './partage'\nexport const a = aide + partage\n"
    )

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute aide',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          paths: ['aide.ts', 'mine.ts'],
          pathLineFingerprints: {
            'aide.ts': lignes('export const aide = 2'),
            'mine.ts': lignes(
              "import { aide } from './aide.js'",
              "import { partage } from './partage'",
              'export const a = aide + partage'
            )
          }
        })
      ]
    })

    expect(report).toMatchObject({ project: { status: 'pushed', files: 2 } })
    expect((await fichiersDuDernierCommitDistant(remote)).sort()).toEqual(['aide.ts', 'mine.ts'])
  })

  /**
   * Vécu le 2026-10-19 (ba71a03e) : le tour a publié SEUL
   * `ChatView.cadrage-hypotheses.test.tsx`. `ChatView.tsx`, que ce test vérifie, était le travail du
   * même fil (écrit par un script `node - <<'EOF'`, sans preuve par lignes) et restait en attente
   * (« modifie-avant-le-tour »). Le contrôle des imports n'a rien vu : le test importe
   * `ChatView.harness.tsx`, propre, qui importe `ChatView.tsx`. main a reçu un test sans son code.
   */
  async function vueCommitee(repo: string): Promise<void> {
    writeFileSync(join(repo, 'vue.ts'), 'export const vue = 0\n')
    writeFileSync(
      join(repo, 'vue.harness.ts'),
      "import { vue } from './vue'\nexport const monter = (): number => vue\n"
    )
    writeFileSync(
      join(repo, 'vue.cadrage.test.ts'),
      "import { monter } from './vue.harness'\nexport const t0 = monter()\n"
    )
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-m', 'vue'], { cwd: repo })
    await run('git', ['push', 'origin', 'travail'], { cwd: repo })
  }

  it('laisse en attente un test qui atteint, par un intermédiaire, le travail du fil resté hors du commit (ba71a03e)', async () => {
    const { repo, remote } = await depot()
    await vueCommitee(repo)
    // Tour précédent DU MÊME FIL : `vue.ts` réécrit par un script, aucune ligne réclamée.
    writeFileSync(join(repo, 'vue.ts'), 'export const vue = 1\n')
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    const headAvant = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout
    const distantAvant = await fichiersDuDernierCommitDistant(remote)
    // Ce tour : le script retouche `vue.ts`, le test est complété par l'outil d'édition.
    writeFileSync(join(repo, 'vue.ts'), 'export const vue = 2\n')
    appendFileSync(join(repo, 'vue.cadrage.test.ts'), 'export const t1 = monter() === 2\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'garde le repli par conversation',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, { turnId: 'tour-A-0000', timestamp: AVANT, paths: ['vue.ts'] }),
        trace(repo, { paths: ['vue.ts'] }),
        trace(repo, {
          paths: ['vue.cadrage.test.ts'],
          pathLineFingerprints: {
            'vue.cadrage.test.ts': lignes('export const t1 = monter() === 2')
          }
        })
      ]
    })

    expect(report?.project).toMatchObject({ status: 'skipped', reason: 'unattributed' })
    expect(report?.exclus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'vue.ts', motif: 'modifie-avant-le-tour' }),
        expect.objectContaining({
          path: 'vue.cadrage.test.ts',
          motif: 'import-hors-commit',
          importsHorsCommit: ['vue.ts']
        })
      ])
    )
    expect((await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout).toBe(headAvant)
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(distantAvant)
  })

  it('publie un test et le code qu’il atteint par un intermédiaire quand les deux partent', async () => {
    const { repo, remote } = await depot()
    await vueCommitee(repo)
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'vue.ts'), 'export const vue = 2\n')
    appendFileSync(join(repo, 'vue.cadrage.test.ts'), 'export const t1 = monter() === 2\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'garde le repli par conversation',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          paths: ['vue.ts', 'vue.cadrage.test.ts'],
          pathLineFingerprints: {
            'vue.ts': lignes('export const vue = 2'),
            'vue.cadrage.test.ts': lignes('export const t1 = monter() === 2')
          }
        })
      ]
    })

    expect(report).toMatchObject({ project: { status: 'pushed', files: 2 } })
    expect((await fichiersDuDernierCommitDistant(remote)).sort()).toEqual([
      'vue.cadrage.test.ts',
      'vue.ts'
    ])
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
    // Mesuré le 2026-09-30 (commits 5fb0730d, bb8e6c0c) : un fil crée un fichier PENDANT le tour.
    // Ses traces ne sont écrites qu'à la fin de son appel au modèle (10:51:52), après la
    // publication (10:32:31) : aucune trace concurrente, donc le repli publiait au nom
    // le travail. Le fichier prouvé par ses lignes, lui, part quand même.
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

/**
 * LES TESTS DES FICHIERS DU TOUR SONT REJOUÉS AVANT DE POUSSER.
 *
 * Mesuré le 2026-10-01 : le commit automatique `b6d2a3fc` a poussé une modification de
 * `src/main/index.ts` sans rejouer aucun test, et `chat-ipc-contract.test.ts` est resté rouge sur
 * main pendant 20 h — son correctif dormait dans la copie de travail d'un autre run.
 */
describe('enchaînement auto du chat — vérification avant de pousser', () => {
  async function tourQuiModifieMine(): Promise<{
    repo: string
    remote: string
    debut: Awaited<ReturnType<typeof photographierDebutDeTour>>
    traces: ConversationFileTrace[]
  }> {
    const { repo, remote } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'mine.ts'), 'export const a = 1\n')
    const traces = [
      trace(repo, {
        paths: ['mine.ts'],
        pathLineFingerprints: { 'mine.ts': lignes('export const a = 1') }
      })
    ]
    return { repo, remote, debut, traces }
  }

  it('tests ROUGES : rien n’est commité ni poussé, et chaque fichier est nommé avec le test en échec', async () => {
    const { repo, remote, debut, traces } = await tourQuiModifieMine()
    const headAvant = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout
    const verifier = vi.fn(async () => ({
      statut: 'echec' as const,
      commande: 'vitest related mine.ts --run',
      detail: '1 test en échec',
      testsEnEchec: ['mine.test.ts']
    }))

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute a',
      debut,
      runGit: realGit,
      traces,
      verifierAvantPublication: verifier
    })

    // La vérification porte sur les fichiers QUE le tour allait publier, dans une copie propre de ce
    // qui part — jamais dans l'arbre partagé (973b70e2, voir le test suivant).
    expect(verifier).toHaveBeenCalledTimes(1)
    const [racineVerifiee, fichiersVerifies] = verifier.mock.calls[0] as unknown as [
      string,
      string[]
    ]
    expect(racineVerifiee).not.toBe(realpathSync.native(repo))
    // Refermée après la vérification, rouge compris.
    expect(existsSync(racineVerifiee)).toBe(false)
    expect(fichiersVerifies).toEqual(['mine.ts'])
    expect(report).toMatchObject({
      project: { status: 'skipped', reason: 'tests-rouges' },
      exclus: [{ path: 'mine.ts', motif: 'tests-rouges', testsEnEchec: ['mine.test.ts'] }],
      verification: { statut: 'echec' }
    })
    expect((await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout).toBe(headAvant)
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['base.txt', 'partage.ts'])
    expect(await enAttente(repo)).toContain('mine.ts')
  })

  /*
   * Vécu le 2026-10-22 : `973b70e2` a publié un test de style sans
   * le CSS qu'il lit, et `b86a144e` du code sans son test. Les fichiers restés dehors
   * avaient aussi été modifiés par d'autres fils. Rejoués dans l'arbre partagé, où ils étaient
   * encore là, les tests étaient verts. Ils doivent juger CE QUI PART, comme le typage.
   */
  it('les tests jugent CE QUI PART : dernier commit + fichiers publiés, jamais l’arbre partagé (973b70e2)', async () => {
    const { repo, remote } = await depot()
    // Un autre fil a modifié `partage.ts` avant le tour : le tour y touche aussi, il reste en attente.
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 1\n')
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 2\n')
    writeFileSync(join(repo, 'mine.ts'), 'export const a = 1\n')
    const vu: { racine: string; mine: string; partage: string }[] = []
    // Fins de ligne ramenées à LF : sans `.gitattributes`, un `core.autocrlf=true` du poste extrait
    // la copie en CRLF — sans rapport avec ce qu'on mesure ici (quel CONTENU voient les tests).
    const lire = (chemin: string): string => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')
    const verifier = vi.fn(async (racine: string) => {
      vu.push({
        racine: realpathSync.native(racine),
        mine: lire(join(racine, 'mine.ts')),
        partage: lire(join(racine, 'partage.ts'))
      })
      return { statut: 'vert' as const, commande: 'vitest related mine.ts --run', testsJoues: 1 }
    })

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute a',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          paths: ['mine.ts'],
          pathLineFingerprints: { 'mine.ts': lignes('export const a = 1') }
        }),
        trace(repo, { paths: ['partage.ts'] })
      ],
      verifierAvantPublication: verifier
    })

    expect(vu).toHaveLength(1)
    expect(vu[0].racine).not.toBe(realpathSync.native(repo))
    expect(vu[0].mine).toBe('export const a = 1\n')
    // Le dernier commit, pas l'arbre partagé : `partage.ts` ne part pas, les tests ne le voient pas.
    expect(vu[0].partage).toBe('export const partage = 0\n')
    expect(report).toMatchObject({
      project: { status: 'pushed', files: 1 },
      exclus: [{ path: 'partage.ts', motif: 'modifie-avant-le-tour' }],
      verification: { statut: 'vert' }
    })
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['mine.ts'])
    // La copie est refermée et désinscrite ; l'arbre partagé n'a pas bougé.
    expect(existsSync(vu[0].racine)).toBe(false)
    const copies = (await run('git', ['worktree', 'list', '--porcelain'], { cwd: repo })).stdout
    expect(copies.match(/^worktree /gm)).toHaveLength(1)
    expect(readFileSync(join(repo, 'partage.ts'), 'utf8')).toBe('export const partage = 2\n')
  })

  it('copie propre impossible : les tests ne sont pas joués, la publication part et le rapport dit pourquoi', async () => {
    const { remote, debut, traces } = await tourQuiModifieMine()
    const verifier = vi.fn()

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute a',
      debut,
      runGit: realGit,
      traces,
      verifierAvantPublication: verifier,
      ouvrirCopie: async () => {
        throw new Error('worktree add refusé')
      }
    })

    expect(verifier).not.toHaveBeenCalled()
    expect(report).toMatchObject({
      project: { status: 'pushed', files: 1 },
      verification: {
        statut: 'non-verifie',
        raison: expect.stringContaining(
          'copie propre du dernier commit impossible : worktree add refusé'
        )
      }
    })
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['mine.ts'])
  })

  // Vécu le 2026-10-15 (`9d6bb850`) : un fichier publié sans son appelant a cassé la
  // compilation de main, alors que les tests rejoués dans l'arbre partagé étaient verts.
  it('typage ROUGE de ce qui part : rien n’est commité, les tests ne sont pas joués, chaque fichier nomme l’erreur', async () => {
    const { repo, remote, debut, traces } = await tourQuiModifieMine()
    const headAvant = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout
    const erreur = "src/main/index.ts: TS2345: Argument of type '{ shell: ShellRaccourci; }' is not assignable"
    const typer = vi.fn(async () => ({
      statut: 'echec' as const,
      projets: ['node' as const],
      commande: 'tsc --noEmit -p tsconfig.node.json --composite false',
      erreurs: [erreur]
    }))
    const verifier = vi.fn()

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute a',
      debut,
      runGit: realGit,
      traces,
      typerAvantPublication: typer,
      verifierAvantPublication: verifier
    })

    const [depotType, fichiersTypes] = typer.mock.calls[0] as unknown as [string, string[]]
    expect(realpathSync.native(depotType)).toBe(realpathSync.native(repo))
    expect(fichiersTypes).toEqual(['mine.ts'])
    expect(verifier).not.toHaveBeenCalled()
    expect(report).toMatchObject({
      project: { status: 'skipped', reason: 'typage-rouge', detail: expect.stringContaining('1 erreur de typage nouvelle') },
      exclus: [{ path: 'mine.ts', motif: 'typage-rouge', erreursDeTypage: [erreur] }],
      typage: { statut: 'echec' }
    })
    expect((await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout).toBe(headAvant)
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['base.txt', 'partage.ts'])
    expect(await enAttente(repo)).toContain('mine.ts')
  })

  it('typage VERT : les tests suivent, la publication part, et le rapport dit que ce qui part a été typé', async () => {
    const { remote, debut, traces } = await tourQuiModifieMine()

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute a',
      debut,
      runGit: realGit,
      traces,
      typerAvantPublication: async () => ({ statut: 'vert' as const, projets: ['node' as const] }),
      verifierAvantPublication: async () => ({
        statut: 'vert' as const,
        commande: 'vitest related mine.ts --run',
        testsJoues: 3
      })
    })

    expect(report).toMatchObject({
      project: { status: 'pushed', files: 1 },
      typage: { statut: 'vert', projets: ['node'] },
      verification: { statut: 'vert' }
    })
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['mine.ts'])
  })

  it('tests VERTS : publication comme avant, et le rapport dit ce qui a été rejoué', async () => {
    const { remote, debut, traces } = await tourQuiModifieMine()

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute a',
      debut,
      runGit: realGit,
      traces,
      verifierAvantPublication: async () => ({
        statut: 'vert' as const,
        commande: 'vitest related mine.ts --run',
        testsJoues: 3
      })
    })

    expect(report).toMatchObject({
      project: { status: 'pushed', files: 1 },
      verification: { statut: 'vert', testsJoues: 3 }
    })
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['mine.ts'])
  })

  it('aucun test ciblable : publication comme avant, mais le rapport le dit au lieu de se taire', async () => {
    const { remote, debut, traces } = await tourQuiModifieMine()

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute a',
      debut,
      runGit: realGit,
      traces,
      verifierAvantPublication: async () => ({
        statut: 'non-verifie' as const,
        raison: 'aucun test ciblable pour notes.md'
      })
    })

    expect(report).toMatchObject({
      project: { status: 'pushed', files: 1 },
      verification: { statut: 'non-verifie', raison: 'aucun test ciblable pour notes.md' }
    })
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['mine.ts'])
  })

  it('n’appelle pas la vérification quand le tour n’a rien à publier', async () => {
    const { repo } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    const verifier = vi.fn()

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'rien',
      debut,
      runGit: realGit,
      traces: [],
      verifierAvantPublication: verifier
    })

    expect(report).toBeUndefined()
    expect(verifier).not.toHaveBeenCalled()
  })
})

/**
 * FICHIER NOMMÉ PAR UNE COMMANDE SHELL DU TOUR — rejeu des deux cas du 2026-10-13.
 *
 * d7af3730 et dd0c3d6a ont publié le code sans le test que le même tour venait
 * d'écrire. Le test avait été retouché en ligne de commande (`prettier --write`, puis `cat >> …
 * <<'EOF'` et `sed -i`), donc sans preuve par lignes, et un AUTRE fil l'avait seulement VU changer
 * pendant son propre tour (sa comparaison avant/après, sans lignes) : « touche-par-un-autre-fil ».
 * Les commandes rejouées sont les vraies, recopiées des sessions du CLI ; les traces passent par le
 * même chemin qu'en fin d'appel (`appendCallMutationTraces`, puis relecture du journal).
 */
describe('enchaînement auto du chat — fichier nommé par une commande shell du tour', () => {
  const TOUR_932 = '861aad09-5446-4a34-9e32-94eb3da2fbae'
  const TOUR_933 = 'f24b1b7e-5ef7-4cce-9186-9f10bc8a10d9'

  /** Le dépôt du test tel que Git Bash l'écrit (`/c/Users/…`), comme `/d/AutoWinOS` le 13/10. */
  const formeGitBash = (dossier: string): string =>
    process.platform === 'win32'
      ? `/${dossier[0].toLowerCase()}${dossier.slice(2).replaceAll('\\', '/')}`
      : dossier

  /** Ce que `agent-pilot.ts` reçoit du fournisseur Claude pour un appel Bash réussi. */
  const appelBash = (command: string): ExecutionEvidence => ({
    type: 'Bash',
    kind: claudeToolEvidenceKind('Bash', command),
    status: 'completed',
    ok: true,
    summary: `Bash ${command}`,
    command
  })

  /** Trace les commandes comme `agent-pilot.ts` en fin d'appel, puis relit le journal comme `os.ts`. */
  async function tracesDesCommandes(
    conversationId: string,
    turnId: string,
    repo: string,
    commandes: string[]
  ): Promise<ConversationFileTrace[]> {
    const journal = mkdtempSync(join(tmpdir(), 'autowin-chat-pub-journal-'))
    dirs.push(journal)
    await appendCallMutationTraces(
      { conversationId, turnId, workspaceRoot: repo, evidence: commandes.map(appelBash) },
      journal
    )
    return readRecentConversationFileTraces(journal)
  }

  async function commit(repo: string, message: string): Promise<void> {
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-m', message], { cwd: repo })
  }

  it('d7af3730 (conv-932) : le test créé par Write puis reformaté par `prettier --write` part avec le code', async () => {
    const { repo, remote } = await depot()
    mkdirSync(join(repo, 'src', 'main', 'git'), { recursive: true })
    const CONFIG = 'vitest.config.ts'
    const TEST = 'src/main/git/githooks-pre-push.test.ts'
    writeFileSync(
      join(repo, CONFIG),
      "const GIT_LOURDS = [\n  'src/main/runs/run-autoclose.test.ts',\n  'src/main/orchestration/e2e-chaine*.test.ts'\n]\n"
    )
    await commit(repo, 'config')
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)

    // Edit : l'inscription du test dans la configuration, lignes réclamées.
    const inscription = [
      "  'src/main/runs/run-autoclose.test.ts',",
      "  'src/main/git/githooks-pre-push.test.ts',",
      "  'src/main/orchestration/e2e-chaine*.test.ts'"
    ]
    writeFileSync(join(repo, CONFIG), ['const GIT_LOURDS = [', ...inscription, ']', ''].join('\n'))
    // Write : le test tel que le modèle l'a écrit (vraies lignes de 13:08:14Z)…
    const corps = [
      "  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: envPropre(), windowsHide: true })",
      "  return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: r.stderr ?? '' }",
      '}'
    ]
    const ecrit = [
      "import { spawnSync } from 'node:child_process'",
      'function git(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {',
      ...corps
    ]
    // …puis tel que `prettier --write` l'a laissé à 13:10:16Z : 4 lignes que le fil ne réclame plus.
    const reformate = [
      "import { spawnSync } from 'node:child_process'",
      'function git(',
      '  cwd: string,',
      '  args: string[]',
      '): { status: number | null; stdout: string; stderr: string } {',
      ...corps
    ]
    writeFileSync(join(repo, TEST), `${reformate.join('\n')}\n`)

    const nommees = await tracesDesCommandes('conv-932', TOUR_932, repo, [
      COMMANDE_CONV_932.replace('/d/AutoWinOS', formeGitBash(repo))
    ])
    expect(nommees).toMatchObject([{ paths: [TEST], nommeParCommande: true }])

    const report = await publierTourDeChat({
      conversationId: 'conv-932',
      turnId: TOUR_932,
      request: 'refuse tout push vers GitHub qui contient entreprise/',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          conversationId: 'conv-932',
          turnId: TOUR_932,
          paths: [TEST],
          pathLineFingerprints: { [TEST]: lignes(...ecrit) }
        }),
        trace(repo, {
          conversationId: 'conv-932',
          turnId: TOUR_932,
          paths: [CONFIG],
          pathLineFingerprints: { [CONFIG]: lignes(...inscription) }
        }),
        // 13:10:39Z : un fil finit son tour, sa comparaison avant/après VOIT les fichiers.
        trace(repo, { conversationId: 'conv-931', turnId: '8cfd4d8c', paths: [CONFIG, TEST] }),
        ...nommees
      ]
    })

    expect(report?.exclus).toBeUndefined()
    expect(report).toMatchObject({ project: { status: 'pushed', files: 2 } })
    expect((await fichiersDuDernierCommitDistant(remote)).sort()).toEqual([TEST, CONFIG])
  })

  it('dd0c3d6a (conv-933) : le test complété par `cat >> … <<EOF` et `sed -i` part avec le code, malgré un autre tour en cours', async () => {
    const { repo, remote } = await depot()
    mkdirSync(join(repo, 'src', 'main', 'providers'), { recursive: true })
    const CODE = 'src/main/providers/relance-auto-moteur.ts'
    const TEST = 'src/main/providers/relance-auto-moteur.test.ts'
    writeFileSync(
      join(repo, CODE),
      'function resumerErreur(erreur: string): string {\n  return erreur\n}\n'
    )
    writeFileSync(
      join(repo, TEST),
      "import {\n  armerRelanceAutoMoteur,\n  relanceAutoMoteurPermise,\n  type ReglagesRelanceMoteur\n} from './relance-auto-moteur'\n"
    )
    await commit(repo, 'relance')
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)

    // Edit : la fonction exportée sous son nouveau nom, ligne réclamée.
    const exporte = 'export function resumerErreurDeCompilation(erreur: string): string {'
    writeFileSync(join(repo, CODE), `${exporte}\n  return erreur\n}\n`)
    // Effet de la commande réelle : le corps du here-document ajouté, puis l'import complété.
    const commande = COMMANDE_CONV_933.split('\n')
    appendFileSync(join(repo, TEST), `${commande.slice(1, commande.indexOf('EOF')).join('\n')}\n`)
    writeFileSync(
      join(repo, TEST),
      readFileSync(join(repo, TEST), 'utf8').replace(
        '  relanceAutoMoteurPermise,\n',
        '  relanceAutoMoteurPermise,\n  resumerErreurDeCompilation,\n'
      )
    )

    const nommees = await tracesDesCommandes('conv-933', TOUR_933, repo, [COMMANDE_CONV_933])
    expect(nommees).toMatchObject([{ paths: [TEST], nommeParCommande: true }])

    const report = await publierTourDeChat({
      conversationId: 'conv-933',
      turnId: TOUR_933,
      request: "ca me met un bandeau que je comprend pas avec un pbm d'encodage du texte",
      debut,
      runGit: realGit,
      // 13:21:14Z : le tour e4a3c760, parti à 13:20:45Z, tourne encore dans le dépôt.
      autresToursEnCours: [repo],
      traces: [
        trace(repo, {
          conversationId: 'conv-933',
          turnId: TOUR_933,
          paths: [CODE],
          pathLineFingerprints: { [CODE]: lignes(exporte) }
        }),
        // 13:20:04Z et 13:20:51Z : des fils finissent un tour et VOIENT le test changer.
        trace(repo, { conversationId: 'conv-930', turnId: 'c3ede00e', paths: [CODE, TEST] }),
        trace(repo, { conversationId: 'conv-932', turnId: 'e0322299', paths: [CODE, TEST] }),
        ...nommees
      ]
    })

    expect(report?.exclus).toBeUndefined()
    expect(report).toMatchObject({ project: { status: 'pushed', files: 2 } })
    expect((await fichiersDuDernierCommitDistant(remote)).sort()).toEqual([TEST, CODE])
  })

  it('reste écarté quand un AUTRE fil a aussi nommé le fichier dans une commande d’écriture', async () => {
    const { repo } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 5\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'modifie partage',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, { paths: ['partage.ts'], nommeParCommande: true }),
        trace(repo, {
          conversationId: 'conv-B',
          turnId: 'tour-B',
          paths: ['partage.ts'],
          nommeParCommande: true
        })
      ]
    })

    expect(report).toMatchObject({
      project: { status: 'skipped', reason: 'unattributed' },
      exclus: [{ path: 'partage.ts', motif: 'touche-par-un-autre-fil' }]
    })
  })

  it('reste écarté quand un autre fil a réclamé des lignes du fichier pendant le tour', async () => {
    const { repo } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 6\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'modifie partage',
      debut,
      runGit: realGit,
      autresToursEnCours: [repo],
      traces: [
        trace(repo, { paths: ['partage.ts'], nommeParCommande: true }),
        trace(repo, {
          conversationId: 'conv-B',
          turnId: 'tour-B',
          paths: ['partage.ts'],
          pathLineFingerprints: { 'partage.ts': lignes('export const partage = 6') }
        })
      ]
    })

    expect(report).toMatchObject({
      project: { status: 'skipped', reason: 'unattributed' },
      exclus: [{ path: 'partage.ts', motif: 'touche-par-un-autre-fil' }]
    })
  })

  it('une commande d’un tour PRÉCÉDENT du fil ne prouve rien pour ce tour', async () => {
    const { repo } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 7\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'modifie partage',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          turnId: 'tour-A-0000',
          timestamp: AVANT,
          paths: ['partage.ts'],
          nommeParCommande: true
        }),
        trace(repo, { paths: ['partage.ts'] }),
        trace(repo, { conversationId: 'conv-B', turnId: 'tour-B', paths: ['partage.ts'] })
      ]
    })

    expect(report).toMatchObject({
      exclus: [{ path: 'partage.ts', motif: 'touche-par-un-autre-fil' }]
    })
  })

  it('une commande d’écriture ne rattrape pas un fichier déjà modifié avant le tour', async () => {
    const { repo } = await depot()
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 8\n')
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 9\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'modifie partage',
      debut,
      runGit: realGit,
      traces: [trace(repo, { paths: ['partage.ts'], nommeParCommande: true })]
    })

    expect(report).toMatchObject({
      exclus: [{ path: 'partage.ts', motif: 'modifie-avant-le-tour' }]
    })
  })
})

/*
 * VÉCU LE 2026-11-05 (tour 68e1eafb) : le fil n'avait fait que LIRE. Pendant son appel,
 * un fil a publié sa part de `git-apres-fil.ts` (commande nommée, puis `update-ref` : l'empreinte
 * du diff passe de 83a7a601 à bcb7dcce). La comparaison avant/après a vu exactement ce
 * passage, l'a tracé à son nom, et le fichier est entré dans SES « laissés en attente » : un `/git`
 * est parti dans un fil qui n'avait rien écrit. Un passage qu'un AUTRE fil a écrit et tracé de bout
 * en bout n'appartient pas au fil qui l'a seulement vu.
 */
describe('enchaînement auto du chat — fichier seulement VU changer par le tour', () => {
  /** Comparaison avant/après d'un appel : ni lignes, ni commande. */
  const vu = (repo: string, avant: string | null, apres: string, partial = {}) =>
    trace(repo, {
      paths: ['partage.ts'],
      pathBaseFingerprints: { 'partage.ts': avant },
      pathFingerprints: { 'partage.ts': apres },
      ...partial
    })

  it('conv-1578 : un passage écrit et tracé par un autre fil ne reste pas en attente pour ce fil', async () => {
    const { repo } = await depot()
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 1\n')
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    const headAvant = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 2\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'quels sont les défauts ?',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          conversationId: 'conv-B',
          turnId: 'tour-B',
          paths: ['partage.ts'],
          nommeParCommande: true,
          pathFingerprints: { 'partage.ts': 'bcb7' }
        }),
        vu(repo, '83a7', 'bcb7', { conversationId: 'conv-B', turnId: 'tour-B' }),
        vu(repo, '83a7', 'bcb7')
      ]
    })

    expect(report).toBeUndefined()
    expect((await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout).toBe(headAvant)
    expect(await enAttente(repo)).toContain('partage.ts')
  })

  it('le passage vu peut être la SUITE de plusieurs écritures de l’autre fil', async () => {
    const { repo } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 3\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'lis le code',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          conversationId: 'conv-B',
          turnId: 'tour-B',
          paths: ['partage.ts'],
          pathLineFingerprints: { 'partage.ts': lignes('export const partage = 3') },
          pathBaseFingerprints: { 'partage.ts': null },
          pathFingerprints: { 'partage.ts': 'p1' }
        }),
        vu(repo, 'p1', 'p2', { conversationId: 'conv-B', turnId: 'tour-B' }),
        vu(repo, null, 'p2')
      ]
    })

    expect(report).toBeUndefined()
  })

  it('la marche tracée par un fil qui a seulement VU le fichier n’explique rien', async () => {
    const { repo } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 7\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'modifie partage',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          conversationId: 'conv-B',
          turnId: 'tour-B',
          paths: ['partage.ts'],
          nommeParCommande: true,
          pathBaseFingerprints: { 'partage.ts': null },
          pathFingerprints: { 'partage.ts': 'q1' }
        }),
        // conv-C a seulement vu q1 → q2 : cette marche peut être une écriture de conv-A.
        vu(repo, 'q1', 'q2', { conversationId: 'conv-C', turnId: 'tour-C' }),
        vu(repo, null, 'q2')
      ]
    })

    expect(report).toMatchObject({
      exclus: [{ path: 'partage.ts', motif: 'touche-par-un-autre-fil' }]
    })
  })

  it('un passage vu que l’autre fil n’explique pas reste en attente, comme avant', async () => {
    const { repo } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 4\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'modifie partage',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          conversationId: 'conv-B',
          turnId: 'tour-B',
          paths: ['partage.ts'],
          nommeParCommande: true,
          pathBaseFingerprints: { 'partage.ts': null },
          pathFingerprints: { 'partage.ts': 'b1' }
        }),
        // Le fil a vu b1 → a2 : la dernière marche n'est tracée par personne d'autre, elle peut être la sienne.
        vu(repo, null, 'a2')
      ]
    })

    expect(report).toMatchObject({
      exclus: [{ path: 'partage.ts', motif: 'touche-par-un-autre-fil', fils: ['conv-B'] }]
    })
  })

  it('un autre fil qui a seulement VU le même passage n’en devient pas l’auteur', async () => {
    const { repo } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 5\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'modifie partage',
      debut,
      runGit: realGit,
      traces: [
        vu(repo, null, 'v1', { conversationId: 'conv-B', turnId: 'tour-B' }),
        vu(repo, null, 'v1')
      ]
    })

    expect(report).toMatchObject({
      exclus: [{ path: 'partage.ts', motif: 'touche-par-un-autre-fil' }]
    })
  })

  it('le fil qui a ÉCRIT le fichier (lignes) le garde, même si un autre fil a tracé le même passage', async () => {
    const { repo } = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'partage.ts'), 'export const partage = 6\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'modifie partage',
      debut,
      runGit: realGit,
      traces: [
        trace(repo, {
          conversationId: 'conv-B',
          turnId: 'tour-B',
          paths: ['partage.ts'],
          nommeParCommande: true,
          pathBaseFingerprints: { 'partage.ts': null },
          pathFingerprints: { 'partage.ts': 'w1' }
        }),
        vu(repo, null, 'w1', {
          pathLineFingerprints: { 'partage.ts': lignes('export const partage = 6') }
        })
      ]
    })

    expect(report?.project).toMatchObject({ status: 'pushed', files: 1 })
  })
})

/**
 * UN FIL PASSÉ EN COPIE : sa fin de tour passe par la PORTE (« Garder », `garder-un-essai.ts`), jamais
 * par une branche du tour poussée vers le distant. Avant, la copie détachée (`--detach`) n'avait pas
 * de branche courante, et `autoCloseRun` poussait `auto/<fil>-<tour>` sur GitHub.
 *
 * La copie est rangée DANS le dépôt, comme celles de l'app (`.autowin-data\…`, ignoré par git) : un
 * tour en cours dans le dossier partagé la « contient », ce qui mettait son travail de côté
 * (`autre-fil-en-cours`). Tout ce que la copie porte appartient au fil : aucun motif d'attribution
 * ne s'applique. La publication est la vraie (`WorktreeManager`).
 * fix-ok: cause mesurée — sur le code d'avant, ces tests rougissent par `push origin
 * <sha>:refs/heads/auto/conv-A-tour-A-0` (copie détachée envoyée à `autoCloseRun`) et par trois
 * fichiers mis de côté (modifie-avant-le-tour, touche-par-un-autre-fil, autre-fil-en-cours).
 */
describe('fil passé en copie — la porte vers la branche locale, jamais une branche poussée', () => {
  async function filEnCopie(): Promise<{
    repo: string
    remote: string
    copie: string
    porte: NonNullable<Parameters<typeof publierTourDeChat>[0]['porte']>
  }> {
    const { repo, remote } = await depot()
    await run('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo })
    appendFileSync(join(repo, '.git', 'info', 'exclude'), '.copies/\n')
    const copie = join(repo, '.copies', 'conv-A')
    await run('git', ['worktree', 'add', '--detach', copie, 'travail'], { cwd: repo })
    const base = await avancerLaBaseDuFil({
      dossier: copie,
      conversationId: 'conv-A',
      depuis: null,
      vers: 'HEAD'
    })
    if (!base.ok) throw new Error(base.raison)
    const racine = mkdtempSync(join(tmpdir(), 'autowin-chat-porte-'))
    dirs.push(racine)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })
    return {
      repo,
      remote,
      copie,
      porte: {
        depot: repo,
        publication: {
          ouvrir: async (runId) => wm.acquire(runId),
          fermer: async (runId, publier) => {
            if (publier) return wm.finalize(runId)
            wm.discard(runId)
            return undefined
          }
        }
      }
    }
  }

  /** Le runner réel, qui note chaque commande : un `push`, même refusé, se verrait ici. */
  function gitEspion(): { runGit: GitRunner; pushs: () => string[][] } {
    const commandes: string[][] = []
    return {
      runGit: async (args, cwd) => {
        commandes.push(args)
        return realGit(args, cwd)
      },
      pushs: () => commandes.filter((args) => args.includes('push'))
    }
  }

  const brancheDistantes = async (repo: string): Promise<string[]> =>
    (await run('git', ['ls-remote', '--heads', 'origin'], { cwd: repo })).stdout
      .split('\n')
      .map((ligne) => ligne.split('\t')[1]?.trim())
      .filter((ref): ref is string => Boolean(ref))

  it('fin de tour : le travail entre dans la branche locale par la porte, sans aucun git push', async () => {
    const { repo, copie, porte } = await filEnCopie()
    const debut = await photographierDebutDeTour(copie, realGit, DEBUT)
    writeFileSync(join(copie, 'mine.ts'), 'export const a = 1\n')
    const espion = gitEspion()

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute la constante a',
      debut,
      runGit: espion.runGit,
      traces: [
        trace(copie, {
          paths: ['mine.ts'],
          pathLineFingerprints: { 'mine.ts': lignes('export const a = 1') }
        })
      ],
      porte
    })

    expect(espion.pushs()).toEqual([])
    expect(await brancheDistantes(repo)).toEqual(['refs/heads/travail'])
    expect(report?.project).toMatchObject({ status: 'committed', files: 1 })
    expect((await run('git', ['show', 'travail:mine.ts'], { cwd: repo })).stdout).toBe(
      'export const a = 1\n'
    )
    const corps = (await run('git', ['log', '-1', '--format=%B', 'travail'], { cwd: repo })).stdout
    expect(corps.split('\n')[0]).toBe('feat(mine): ajoute la constante a (conv-A)')
    expect(corps.trimEnd().split('\n').at(-1)).toBe('Porte: conv-A')
  })

  it('copie dont la base a disparu : refus nommé, rien de poussé ni de commité', async () => {
    const { repo, copie, porte } = await filEnCopie()
    await run('git', ['update-ref', '-d', 'refs/autowin/base-de-fil/conv-A'], { cwd: repo })
    const avant = (await run('git', ['rev-parse', 'travail'], { cwd: repo })).stdout.trim()
    const debut = await photographierDebutDeTour(copie, realGit, DEBUT)
    writeFileSync(join(copie, 'mine.ts'), 'export const a = 1\n')
    const espion = gitEspion()

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute la constante a',
      debut,
      runGit: espion.runGit,
      traces: [
        trace(copie, {
          paths: ['mine.ts'],
          pathLineFingerprints: { 'mine.ts': lignes('export const a = 1') }
        })
      ],
      porte
    })

    expect(espion.pushs()).toEqual([])
    expect(await brancheDistantes(repo)).toEqual(['refs/heads/travail'])
    expect(report?.project).toMatchObject({ status: 'skipped', reason: 'porte-refusee' })
    expect(report?.project.status === 'skipped' ? report.project.detail : '').toContain('base')
    expect((await run('git', ['rev-parse', 'travail'], { cwd: repo })).stdout.trim()).toBe(avant)
    // Le travail reste dans la copie, non commité : rien n'a été emporté à sa place.
    expect(await enAttente(copie)).toContain('mine.ts')
    expect((await run('git', ['rev-parse', 'HEAD'], { cwd: copie })).stdout.trim()).toBe(avant)
  })

  it('aucun fichier mis de côté pour touche-par-un-autre-fil, autre-fil-en-cours ou modifie-avant-le-tour', async () => {
    const { repo, copie, porte } = await filEnCopie()
    // Laissé par un tour précédent du fil, dans SA copie : modifié avant ce tour.
    writeFileSync(join(copie, 'base.txt'), 'base\nd’un tour précédent\n')
    const debut = await photographierDebutDeTour(copie, realGit, DEBUT)
    writeFileSync(join(copie, 'partage.ts'), 'export const partage = 1\n')
    writeFileSync(join(copie, 'libre.txt'), 'écrit en ligne de commande\n')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'modifie partage',
      debut,
      runGit: realGit,
      // Un autre fil tourne dans le dossier partagé, qui CONTIENT la copie.
      autresToursEnCours: [repo],
      traces: [
        // La comparaison avant/après du tour, sans lignes : aucune preuve par contenu.
        trace(copie, { paths: ['base.txt', 'partage.ts', 'libre.txt'] }),
        trace(copie, {
          conversationId: 'conv-B',
          turnId: 'tour-B',
          paths: ['partage.ts'],
          pathLineFingerprints: { 'partage.ts': lignes('export const partage = 1') }
        })
      ],
      porte
    })

    expect(report?.exclus).toBeUndefined()
    expect(report?.project).toMatchObject({ status: 'committed', files: 3 })
    expect(
      (await run('git', ['show', '--name-only', '--format=', 'travail'], { cwd: repo })).stdout
        .split('\n')
        .filter(Boolean)
        .sort()
    ).toEqual(['base.txt', 'libre.txt', 'partage.ts'])
  })

  // Le jumeau accepté : la porte branchée ne change rien au tour d'un fil resté dans le dossier partagé.
  it('le dossier partagé lui-même garde la publication d’avant, porte branchée ou non', async () => {
    const { repo, remote, porte } = await filEnCopie()
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
        })
      ],
      porte
    })

    expect(report?.project).toMatchObject({ status: 'pushed', mode: 'direct', branch: 'travail' })
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['mine.ts'])
  })
})
