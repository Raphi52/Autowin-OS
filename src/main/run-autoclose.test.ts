import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  autoCloseBranch,
  autoCloseRun,
  captureCloseBaseline,
  closeGreenRunOnDisk,
  detectSecret,
  parsePorcelainPaths,
  type GitRunner
} from './run-autoclose'

/** Vrais dépôts git en tmp : sous charge parallèle, le budget vitest par défaut (5 s) est trop court. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const run = promisify(execFile)
/** Vrai git (pas un mock) : c'est le comportement de git qu'on veut prouver, pas notre idée de git. */
const realGit: GitRunner = async (args, cwd) => (await run('git', args, { cwd })).stdout

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('defaultGitRunner — processus invisible', () => {
  it('masque les commandes Git non interactives sous Windows', () => {
    const source = readFileSync(join(__dirname, 'run-autoclose.ts'), 'utf8')
    const runner = source.slice(
      source.indexOf('async function defaultGitRunner'),
      source.indexOf('export interface AutoCloseReport')
    )

    expect(runner).toContain('windowsHide: true')
  })
})

/** Dépôt de travail + un « distant » local (bare) pour observer un vrai push. */
async function repoWithRemote(): Promise<{ repo: string; remote: string }> {
  const root = mkdtempSync(join(tmpdir(), 'autowin-autoclose-'))
  dirs.push(root)
  const repo = join(root, 'work')
  const remote = join(root, 'remote.git')
  mkdirSync(repo)
  await run('git', ['init', '--bare', remote])
  await run('git', ['init', '-b', 'travail'], { cwd: repo })
  await run('git', ['config', 'user.email', 't@t.t'], { cwd: repo })
  await run('git', ['config', 'user.name', 'T'], { cwd: repo })
  writeFileSync(join(repo, 'base.txt'), 'base\n')
  await run('git', ['add', '-A'], { cwd: repo })
  await run('git', ['commit', '-m', 'base'], { cwd: repo })
  await run('git', ['remote', 'add', 'origin', remote], { cwd: repo })
  return { repo, remote }
}

describe('autoCloseRun — publication d’un run vert', () => {
  it('commite et publie sur la branche dédiée SANS déplacer le HEAD local', async () => {
    const { repo, remote } = await repoWithRemote()
    writeFileSync(join(repo, 'nouveau.ts'), 'export const x = 1\n')

    const res = await autoCloseRun({
      repo,
      branch: autoCloseBranch('run-42'),
      message: 'clôture auto',
      runGit: realGit
    })

    expect(res).toMatchObject({ status: 'pushed', branch: 'auto/run-42' })
    // La branche locale n'a PAS changé : l'utilisateur reste où il travaillait.
    expect((await run('git', ['branch', '--show-current'], { cwd: repo })).stdout.trim()).toBe(
      'travail'
    )
    // Le distant a bien reçu la branche dédiée…
    const remoteBranches = (await run('git', ['branch'], { cwd: remote })).stdout
    expect(remoteBranches).toContain('auto/run-42')
    // …et RIEN sur main/master.
    expect(remoteBranches).not.toContain('main')
    expect(remoteBranches).not.toContain('master')
  })

  it('REFUSE de publier sur main (garde d’équipe, non contournable par l’appelant)', async () => {
    const { repo } = await repoWithRemote()
    writeFileSync(join(repo, 'x.ts'), 'x\n')
    const git = vi.fn(realGit)

    const res = await autoCloseRun({ repo, branch: 'main', message: 'm', runGit: git })

    expect(res).toMatchObject({ status: 'skipped', reason: 'protected-branch' })
    expect(git).not.toHaveBeenCalled() // refus AVANT toute commande git
  })

  it('ne commite QUE les chemins demandés (dépôt partagé : le reste n’est pas emporté)', async () => {
    const { repo } = await repoWithRemote()
    writeFileSync(join(repo, 'du-run.md'), '# produit par le run\n')
    writeFileSync(join(repo, 'autrui.md'), '# travail de quelqu_un d_autre\n')

    const res = await autoCloseRun({
      repo,
      branch: 'auto/run-7',
      message: 'notes du run',
      paths: ['du-run.md'],
      push: false,
      runGit: realGit
    })

    expect(res).toMatchObject({ status: 'committed', files: 1 })
    const committed = (
      await run('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo })
    ).stdout
    expect(committed).toContain('du-run.md')
    expect(committed).not.toContain('autrui.md')
    // Le fichier d'autrui reste non suivi, intact.
    expect((await run('git', ['status', '--porcelain'], { cwd: repo })).stdout).toContain(
      'autrui.md'
    )
  })

  it('ne crée pas de commit vide quand le run n’a rien changé', async () => {
    const { repo } = await repoWithRemote()
    const res = await autoCloseRun({ repo, branch: 'auto/run-1', message: 'm', runGit: realGit })
    expect(res).toMatchObject({ status: 'skipped', reason: 'no-changes' })
  })

  it('BLOQUE la publication si un secret apparaît dans ce qui serait publié', async () => {
    const { repo } = await repoWithRemote()
    writeFileSync(join(repo, 'base.txt'), 'base\nAKIAIOSFODNN7EXAMPLE\n')

    const res = await autoCloseRun({ repo, branch: 'auto/run-9', message: 'm', runGit: realGit })

    expect(res).toMatchObject({ status: 'skipped', reason: 'secret-detected' })
    // Rien n'a été commité.
    expect(
      (await run('git', ['log', '--oneline'], { cwd: repo })).stdout.trim().split('\n')
    ).toHaveLength(1)
  })

  it('une défaillance git devient un échec rapporté, jamais une exception', async () => {
    const res = await autoCloseRun({
      repo: join(tmpdir(), 'depot-inexistant-autowin'),
      branch: 'auto/run-3',
      message: 'm',
      runGit: realGit
    })
    expect(res.status).toBe('failed')
  })
})

describe('périmètre du run (ce qui traînait AVANT n’est pas publié)', () => {
  it('ne commite que le delta produit par le run, pas les modifications préexistantes', async () => {
    const { repo } = await repoWithRemote()
    const brain = (await repoWithRemote()).repo
    // Travail d'une AUTRE session, déjà en cours avant le run, dans les deux dépôts.
    writeFileSync(join(repo, 'travail-concurrent.ts'), 'const autre = 1\n')
    writeFileSync(join(brain, 'note-en-attente.md'), '# pas de ce run\n')

    const baseline = await captureCloseBaseline(repo, brain, realGit)
    expect(baseline.project).toContain('travail-concurrent.ts')
    expect(baseline.brain).toContain('note-en-attente.md')

    // Puis le run produit SES fichiers.
    writeFileSync(join(repo, 'du-run.ts'), 'export const y = 2\n')
    writeFileSync(join(brain, 'du-run.md'), '# produit par le run\n')

    const report = await closeGreenRunOnDisk({
      runId: 'run-77',
      task: 'ajoute deux fichiers',
      projectRepo: repo,
      brainRepo: brain,
      baseline,
      runGit: realGit
    })

    expect(report.project).toMatchObject({ status: 'pushed', files: 1 })
    expect(report.brain).toMatchObject({ status: 'pushed', files: 1 })
    for (const [dir, mine, autrui] of [
      [repo, 'du-run.ts', 'travail-concurrent.ts'],
      [brain, 'du-run.md', 'note-en-attente.md']
    ] as const) {
      const committed = (
        await run('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: dir })
      ).stdout
      expect(committed).toContain(mine)
      expect(committed).not.toContain(autrui) // le travail d'autrui reste non commité
    }
  })

  it('sans delta (le run n’a rien produit), rien n’est publié', async () => {
    const { repo } = await repoWithRemote()
    const brain = (await repoWithRemote()).repo
    writeFileSync(join(repo, 'preexistant.ts'), 'x\n')
    const baseline = await captureCloseBaseline(repo, brain, realGit)

    const report = await closeGreenRunOnDisk({
      runId: 'run-78',
      task: 'ne touche rien',
      projectRepo: repo,
      brainRepo: brain,
      baseline,
      runGit: realGit
    })

    expect(report.project).toMatchObject({ status: 'skipped', reason: 'no-changes' })
    expect(report.brain).toMatchObject({ status: 'skipped', reason: 'no-changes' })
  })
})

describe('travail DÉJÀ COMMITÉ par la fusion du worktree (arbre propre)', () => {
  /** Rejoue la vraie séquence : la fusion committe le travail de l'agent, l'arbre reste propre. */
  async function mergedByWorktree(repo: string, runId: string, file = 'du-run.ts'): Promise<void> {
    writeFileSync(join(repo, file), 'export const y = 2\n')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-m', `agent ${runId}-1`], { cwd: repo })
  }

  it('publie le run alors que `git status` ne montre RIEN (le trou observé en réel)', async () => {
    const { repo, remote } = await repoWithRemote()
    const brain = (await repoWithRemote()).repo
    const baseline = await captureCloseBaseline(repo, brain, realGit)
    await mergedByWorktree(repo, 'run-77')

    // L'arbre est propre : c'est précisément l'état qui faisait sortir la clôture en « no-changes ».
    expect((await run('git', ['status', '--porcelain'], { cwd: repo })).stdout.trim()).toBe('')

    const report = await closeGreenRunOnDisk({
      runId: 'run-77',
      task: 'ajoute un fichier',
      projectRepo: repo,
      brainRepo: brain,
      baseline,
      runGit: realGit
    })

    expect(report.project).toMatchObject({ status: 'pushed', branch: 'auto/run-77', files: 1 })
    expect((await run('git', ['branch'], { cwd: remote })).stdout).toContain('auto/run-77')
  })

  it('publie la plage Git exacte même si le commit agent porte un sujet conventionnel', async () => {
    const { repo, remote } = await repoWithRemote()
    const brain = (await repoWithRemote()).repo
    const baseline = await captureCloseBaseline(repo, brain, realGit)
    writeFileSync(join(repo, 'du-run.ts'), 'export const y = 2\n')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-m', 'feat: add the requested behavior'], { cwd: repo })
    const publishedSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    writeFileSync(join(repo, 'autrui.ts'), 'export const foreign = true\n')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-m', 'chore: concurrent local work'], { cwd: repo })

    const report = await closeGreenRunOnDisk({
      runId: 'run-conventional',
      task: 'ajoute un fichier',
      projectRepo: repo,
      brainRepo: brain,
      baseline,
      projectPublication: { baseSha: baseline.projectHead!, publishedSha },
      runGit: realGit
    })

    expect(report.project).toMatchObject({
      status: 'pushed',
      branch: 'auto/run-conventional',
      files: 1
    })
    expect(
      (
        await run('git', ['rev-parse', 'refs/heads/auto/run-conventional'], { cwd: remote })
      ).stdout.trim()
    ).toBe(publishedSha)
  })

  it('refuse un secret ajouté puis supprimé dans un commit intermédiaire', async () => {
    const { repo, remote } = await repoWithRemote()
    const brain = (await repoWithRemote()).repo
    const baseline = await captureCloseBaseline(repo, brain, realGit)
    const secretPath = join(repo, 'ephemeral.env')
    writeFileSync(secretPath, 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n')
    await run('git', ['add', 'ephemeral.env'], { cwd: repo })
    await run('git', ['commit', '-m', 'feat: temporary credentials'], { cwd: repo })
    rmSync(secretPath)
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-m', 'fix: remove temporary credentials'], { cwd: repo })
    const publishedSha = (await realGit(['rev-parse', 'HEAD'], repo)).trim()

    const report = await closeGreenRunOnDisk({
      runId: 'run-secret-history',
      task: 'publie deux commits',
      projectRepo: repo,
      brainRepo: brain,
      baseline,
      projectPublication: { baseSha: baseline.projectHead!, publishedSha },
      runGit: realGit
    })

    expect(report.project).toMatchObject({ status: 'skipped', reason: 'secret-detected' })
    expect(await realGit(['branch'], remote)).not.toContain('auto/run-secret-history')
  })

  it('s’abstient si l’historique contient le commit d’une AUTRE session', async () => {
    const { repo, remote } = await repoWithRemote()
    const brain = (await repoWithRemote()).repo
    const baseline = await captureCloseBaseline(repo, brain, realGit)
    await mergedByWorktree(repo, 'run-88')
    // Une autre session committe sur la même base pendant le run.
    writeFileSync(join(repo, 'autrui.ts'), 'const autre = 1\n')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-m', 'travail d_une autre session'], { cwd: repo })

    const report = await closeGreenRunOnDisk({
      runId: 'run-88',
      task: 'ajoute un fichier',
      projectRepo: repo,
      brainRepo: brain,
      baseline,
      runGit: realGit
    })

    expect(report.project).toMatchObject({ status: 'skipped', reason: 'concurrent-commits' })
    expect((await run('git', ['branch'], { cwd: remote })).stdout).not.toContain('auto/run-88')
  })

  it('refuse une plage attestée dont le commit publié est introuvable', async () => {
    const { repo, remote } = await repoWithRemote()
    const brain = (await repoWithRemote()).repo
    const baseline = await captureCloseBaseline(repo, brain, realGit)

    const report = await closeGreenRunOnDisk({
      runId: 'run-invalid-range',
      task: 'publie une plage impossible',
      projectRepo: repo,
      brainRepo: brain,
      baseline,
      projectPublication: {
        baseSha: baseline.projectHead!,
        publishedSha: 'f'.repeat(40)
      },
      runGit: realGit
    })

    expect(report.project).toMatchObject({
      status: 'skipped',
      reason: 'invalid-publication-range'
    })
    expect((await run('git', ['branch'], { cwd: remote })).stdout).not.toContain(
      'auto/run-invalid-range'
    )
  })

  it('un run vert qui n’a produit AUCUN commit ne publie rien', async () => {
    const { repo } = await repoWithRemote()
    const brain = (await repoWithRemote()).repo
    const baseline = await captureCloseBaseline(repo, brain, realGit)

    const report = await closeGreenRunOnDisk({
      runId: 'run-99',
      task: 'ne touche rien',
      projectRepo: repo,
      brainRepo: brain,
      baseline,
      runGit: realGit
    })

    expect(report.project).toMatchObject({ status: 'skipped', reason: 'no-changes' })
  })
})

describe('dossier NON SUIVI (le cas Brain : notes déposées dans inbox/)', () => {
  it('une reprise sans baseline publie le projet atteste mais ne touche jamais au Brain partage', async () => {
    const { repo } = await repoWithRemote()
    const brain = (await repoWithRemote()).repo
    const baseSha = (await realGit(['rev-parse', 'HEAD'], repo)).trim()
    const brainHead = (await realGit(['rev-parse', 'HEAD'], brain)).trim()
    writeFileSync(join(repo, 'recovered.txt'), 'publication recuperee\n')
    await realGit(['add', 'recovered.txt'], repo)
    await realGit(['commit', '-m', 'feat: recovered project'], repo)
    const publishedSha = (await realGit(['rev-parse', 'HEAD'], repo)).trim()
    writeFileSync(join(brain, 'brouillon-autrui.md'), '# ne jamais aspirer\n')

    const report = await closeGreenRunOnDisk({
      runId: 'run-recovered-safe',
      task: 'reprend le projet',
      projectRepo: repo,
      brainRepo: brain,
      projectPublication: { baseSha, publishedSha },
      recoveredWithoutBrainBaseline: true,
      runGit: realGit
    })

    expect(report.project).toMatchObject({ status: 'pushed', branch: 'auto/run-recovered-safe' })
    expect(report.brain).toMatchObject({
      status: 'skipped',
      reason: 'recovery-baseline-missing'
    })
    expect((await realGit(['rev-parse', 'HEAD'], brain)).trim()).toBe(brainHead)
    expect(await realGit(['status', '--porcelain', '-uall'], brain)).toContain(
      'brouillon-autrui.md'
    )
  })

  it('publie la note du run sans emporter le brouillon d’une autre session', async () => {
    const { repo } = await repoWithRemote()
    const brain = (await repoWithRemote()).repo
    // `inbox/` n'est pas suivi : git le replie en `?? inbox/` sans -uall, ce qui rendait le delta
    // vide (rien publié) — et un add du dossier aurait emporté le brouillon voisin.
    mkdirSync(join(brain, 'inbox'))
    writeFileSync(join(brain, 'inbox', 'autrui-en-cours.md'), '# brouillon d_une autre session\n')

    const baseline = await captureCloseBaseline(repo, brain, realGit)
    writeFileSync(join(brain, 'inbox', 'note-du-run.md'), '# produit par le run\n')

    const report = await closeGreenRunOnDisk({
      runId: 'run-brain-1',
      task: 'dépose une note',
      projectRepo: repo,
      brainRepo: brain,
      baseline,
      runGit: realGit
    })

    expect(report.brain).toMatchObject({ status: 'pushed', files: 1 })
    const committed = (
      await run('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: brain })
    ).stdout
    expect(committed).toContain('note-du-run.md')
    expect(committed).not.toContain('autrui-en-cours.md')
    // Le brouillon d'autrui reste non suivi, intact.
    expect((await run('git', ['status', '--porcelain', '-uall'], { cwd: brain })).stdout).toContain(
      'autrui-en-cours.md'
    )
  })
})

describe('helpers', () => {
  it('detectSecret repère les motifs sensibles usuels', () => {
    expect(detectSecret('rien de spécial')).toBeUndefined()
    expect(detectSecret('AKIAIOSFODNN7EXAMPLE')).toBe('clé AWS')
    expect(detectSecret('-----BEGIN RSA PRIVATE KEY-----')).toBe('clé privée')
  })

  it('parsePorcelainPaths conserve les chemins exacts du format porcelain -z', () => {
    expect(
      parsePorcelainPaths(
        [
          ' M café -> littéral.ts',
          'R  nouveau\nnom.ts',
          'ancien "nom".ts',
          '?? ligne\nsuivante.txt',
          '?? guillemet"brut.ts',
          ''
        ].join('\0')
      )
    ).toEqual([
      'café -> littéral.ts',
      'nouveau\nnom.ts',
      'ligne\nsuivante.txt',
      'guillemet"brut.ts'
    ])
  })

  it('autoCloseBranch produit un nom sûr, jamais protégé', () => {
    expect(autoCloseBranch('run-ns-12')).toBe('auto/run-ns-12')
    expect(autoCloseBranch('run/étrange espace')).toMatch(/^auto\/run-/)
  })
})
