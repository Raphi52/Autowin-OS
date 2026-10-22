import { execFile } from 'node:child_process'
import {
  appendFileSync,
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
} from './activity/commandes-ecriture-2026-10-13.fixture'
import {
  readRecentConversationFileTraces,
  type ConversationFileTrace
} from './activity/conversation-file-trace-spool'
import { appendShellWriteTraces } from './activity/trace-workspace-mutation'
import { photographierDebutDeTour, publierTourDeChat } from './chat-turn-publication'
import { exactLineFingerprint } from './exact-line-fingerprint'
import { claudeToolEvidenceKind } from './providers/claude'
import type { ExecutionEvidence } from './providers/types'
import type { GitRunner } from './run-autoclose'
import { supprimerArbre } from './fs-supprimer'

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
    // Titre `type(zone): phrase (conv-N)` (AGENTS.md, conv-1069) : zone = le fichier publié.
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
    // Le refus NOMME le fil qui tient le fichier (conv-1083) : sans lui, l'utilisateur ne sait pas
    // quelle conversation finir ou commiter pour débloquer la publication.
    expect(report?.exclus?.[0].fils).toEqual(['conv-B'])
    expect((await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout).toBe(headAvant)
    expect(await fichiersDuDernierCommitDistant(remote)).toEqual(['base.txt', 'partage.ts'])
    expect(await enAttente(repo)).toContain('partage.ts')
  })

  /*
   * VÉCU LE 2026-10-01 (a7602f5c, conv-770) : le tour a publié `src/main/commands.ts`, qui importait
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
   * Vécu le 2026-10-19 (conv-358, ba71a03e) : le tour a publié SEUL
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

/**
 * LES TESTS DES FICHIERS DU TOUR SONT REJOUÉS AVANT DE POUSSER.
 *
 * Mesuré le 2026-10-01 : le commit automatique `b6d2a3fc` (conv-892) a poussé une modification de
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

    // La vérification porte sur les fichiers QUE le tour allait publier, dans le vrai dépôt (chemin
    // RÉEL : sous Windows, le dossier temporaire arrive en nom court, git le rend en nom long).
    expect(verifier).toHaveBeenCalledTimes(1)
    const [depotVerifie, fichiersVerifies] = verifier.mock.calls[0] as unknown as [string, string[]]
    expect(realpathSync.native(depotVerifie)).toBe(realpathSync.native(repo))
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

  // Vécu le 2026-10-15 (`9d6bb850`, conv-954) : un fichier publié sans son appelant a cassé la
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
 * d7af3730 (conv-932) et dd0c3d6a (conv-933) ont publié le code sans le test que le même tour venait
 * d'écrire. Le test avait été retouché en ligne de commande (`prettier --write`, puis `cat >> …
 * <<'EOF'` et `sed -i`), donc sans preuve par lignes, et un AUTRE fil l'avait seulement VU changer
 * pendant son propre tour (sa comparaison avant/après, sans lignes) : « touche-par-un-autre-fil ».
 * Les commandes rejouées sont les vraies, recopiées des sessions du CLI ; les traces passent par le
 * même chemin qu'en fin d'appel (`appendShellWriteTraces`, puis relecture du journal).
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
    await appendShellWriteTraces(
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
    mkdirSync(join(repo, 'src', 'main'), { recursive: true })
    const CONFIG = 'vitest.config.ts'
    const TEST = 'src/main/githooks-pre-push.test.ts'
    writeFileSync(
      join(repo, CONFIG),
      "const GIT_LOURDS = [\n  'src/main/run-autoclose.test.ts',\n  'src/main/e2e-chaine*.test.ts'\n]\n"
    )
    await commit(repo, 'config')
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)

    // Edit : l'inscription du test dans la configuration, lignes réclamées.
    const inscription = [
      "  'src/main/run-autoclose.test.ts',",
      "  'src/main/githooks-pre-push.test.ts',",
      "  'src/main/e2e-chaine*.test.ts'"
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
        // 13:10:39Z : conv-931 finit son tour, sa comparaison avant/après VOIT les fichiers de conv-932.
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
    mkdirSync(join(repo, 'src', 'main'), { recursive: true })
    const CODE = 'src/main/relance-auto-moteur.ts'
    const TEST = 'src/main/relance-auto-moteur.test.ts'
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
      // 13:21:14Z : le tour e4a3c760 de conv-930, parti à 13:20:45Z, tourne encore dans le dépôt.
      autresToursEnCours: [repo],
      traces: [
        trace(repo, {
          conversationId: 'conv-933',
          turnId: TOUR_933,
          paths: [CODE],
          pathLineFingerprints: { [CODE]: lignes(exporte) }
        }),
        // 13:20:04Z et 13:20:51Z : conv-930 et conv-932 finissent un tour et VOIENT le test changer.
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
