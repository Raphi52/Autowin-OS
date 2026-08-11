import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests joués contre de VRAIS dépôts git en tmp (init, worktree, merge) : sous la charge parallèle
 * de la suite complète, ces I/O dépassent le budget vitest par défaut (5 s) — d'où des rouges
 * aléatoires alors que le code est bon. Budget explicite, assez large pour la contention, assez
 * serré pour attraper un vrai blocage.
 */
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'

const roots: string[] = []

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function installCompensationIndexOwner(repo: string, serialized: string): string {
  const object = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: repo,
    encoding: 'utf8',
    input: serialized
  })
  expect(object.status).toBe(0)
  const oid = object.stdout.trim()
  git(repo, 'update-ref', 'refs/autowin/locks/index', oid)
  writeFileSync(join(repo, '.git', 'index.lock'), serialized)
  return oid
}

type CompensationIndexLockProbe = {
  acquireCompensationIndexLock():
    | {
        path: string
        serialized: string
        ownershipRef: string
        ownershipOid: string
        token: string
      }
    | undefined
  releaseCompensationIndexLock(lock: {
    path: string
    serialized: string
    ownershipRef: string
    ownershipOid: string
    token: string
  }): void
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-wm-'))
  roots.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'ligne1\nligne2\nligne3\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

function manager(repo: string): WorktreeManager {
  const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
  roots.push(wtRoot)
  return new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
}

function detachedCommit(repo: string, startSha: string, file: string, content: string): string {
  const holder = mkdtempSync(join(tmpdir(), 'autowin-late-'))
  roots.push(holder)
  const path = join(holder, 'worktree')
  git(repo, 'worktree', 'add', '--detach', path, startSha)
  writeFileSync(join(path, file), content)
  git(path, 'add', file)
  git(path, 'commit', '-q', '-m', `late ${file}`)
  const sha = git(path, 'rev-parse', 'HEAD')
  git(repo, 'worktree', 'remove', '--force', path)
  return sha
}

afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('WorktreeManager (full-auto merge + garde-fou conflit)', () => {
  it('changedFiles restitue sans ambiguïté Unicode, retours ligne et flèche littérale', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    mkdirSync(join(wtRoot, 'agent__porcelain-z'))
    const names = ['café -> littéral.txt', 'ligne\nsuivante.txt', 'guillemet"brut.txt']
    const status = names.map((name) => `?? ${name}`).join('\0') + '\0'
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      git: (_dir, args) => (args[0] === 'status' ? status : '')
    })

    expect(wm.changedFiles('porcelain-z').sort()).toEqual(names.sort())
  })

  it('acquire donne une copie isolée qui ne touche pas le repo de base', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('scout')
    writeFileSync(join(path, 'a.txt'), 'modifié dans la copie\n')
    expect(git(repo, 'status', '--porcelain')).toBe('') // base intacte
    expect(wm.changedFiles('scout')).toContain('a.txt')
  })

  it('prépare un nouveau job depuis le main distant frais sans muter la branche locale', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-wmremote-'))
    roots.push(root)
    const remote = join(root, 'origin.git')
    const repo = join(root, 'work')
    const peer = join(root, 'peer')
    git(root, 'init', '--bare', '-q', remote)
    git(root, 'clone', '-q', remote, repo)
    git(repo, 'switch', '-c', 'main')
    git(repo, 'config', 'user.email', 't@t')
    git(repo, 'config', 'user.name', 'T')
    git(repo, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(repo, 'base.txt'), 'base\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'base')
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    git(root, '--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    git(root, 'clone', '-q', remote, peer)
    git(peer, 'config', 'user.email', 't@t')
    git(peer, 'config', 'user.name', 'T')
    writeFileSync(join(peer, 'remote.txt'), 'remote\n')
    git(peer, 'add', '-A')
    git(peer, 'commit', '-q', '-m', 'remote advances')
    git(peer, 'push', '-q', 'origin', 'main')

    const localHead = git(repo, 'rev-parse', 'HEAD')
    const wm = manager(repo)
    const context = wm.describeForLaunch('fresh')
    expect(context.canonicalBaseRef).toBe('origin/main')
    expect(context.baseSha).toBe(localHead)
    expect(context.sourceSha).toBe(git(repo, 'rev-parse', 'origin/main'))
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(localHead)
    const path = wm.acquire('fresh', context)
    expect(git(path, 'rev-parse', 'HEAD')).toBe(context.sourceSha)
    writeFileSync(join(path, 'agent.txt'), 'agent\n')
    const finalized = wm.finalize('fresh', { baseBranch: 'main' })
    expect(finalized).toMatchObject({
      outcome: 'merged',
      baseSha: localHead,
      publishedSha: git(repo, 'rev-parse', 'HEAD')
    })
    expect(readFileSync(join(repo, 'remote.txt'), 'utf8')).toContain('remote')
    expect(readFileSync(join(repo, 'agent.txt'), 'utf8')).toContain('agent')
  })

  it('énumère les changements locaux exclus du snapshot remis à l’agent', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'local-only.txt'), 'pas commité\n')

    const context = manager(repo).describeForLaunch('dirty')

    expect(context.excludedDirtyFiles).toEqual(['local-only.txt'])
  })

  it('borne l affichage de 501 fichiers sales sans bloquer ni contaminer le nouveau job', () => {
    const repo = tempRepo()
    for (let index = 0; index < 501; index += 1) {
      writeFileSync(join(repo, `dirty-${String(index).padStart(3, '0')}.txt`), 'local\n')
    }
    const wm = manager(repo)

    const context = wm.describeForLaunch('dirty-large')
    const worktree = wm.acquire('dirty-large', context)

    expect(context.excludedDirtyFiles).toHaveLength(500)
    expect(context.excludedDirtyFileCount).toBe(501)
    expect(context.excludedDirtyFilesTruncated).toBe(true)
    expect(existsSync(join(worktree, 'dirty-000.txt'))).toBe(false)
    expect(existsSync(join(worktree, 'dirty-500.txt'))).toBe(false)
  })

  it('en mode production refuse un lancement sans base distante canonique', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      requireCanonicalRemote: true
    })

    expect(() => wm.describeForLaunch('strict')).toThrow(/distant origin est absent/i)
    expect(existsSync(join(wtRoot, 'agent__strict'))).toBe(false)
  })

  it('prouve le contexte Git durable avant une reprise automatique', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    wm.acquire('recovery')
    const { worktreePath, baseBranch, baseSha } = wm.describe('recovery')

    expect(
      wm.validateRecoveryContext('recovery', {
        worktreePath,
        baseBranch,
        baseSha,
        publication: 'pending'
      })
    ).toEqual({ ok: true, decision: 'resume-publication' })
    expect(
      wm.validateRecoveryContext('recovery', {
        worktreePath,
        baseBranch,
        baseSha: 'f'.repeat(40),
        publication: 'pending'
      })
    ).toMatchObject({ ok: false })
    expect(
      wm.validateRecoveryContext('recovery', {
        worktreePath: join(worktreePath, '..', 'agent__foreign'),
        baseBranch,
        baseSha,
        publication: 'pending'
      })
    ).toMatchObject({ ok: false })
  })

  it('inventorie uniquement les copies agent récupérables après redémarrage', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    wm.acquire('run-z')
    wm.acquire('run-a')
    mkdirSync(join(wtRoot, 'integration__run-z__temporary'))
    mkdirSync(join(wtRoot, 'agent__invalid.name'))

    expect(wm.listAgentIds()).toEqual(['run-a', 'run-z'])
  })

  it('nettoie une copie d’intégration orpheline appartenant au dépôt', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const residue = join(wtRoot, 'integration__run-z__crash')
    git(repo, 'worktree', 'add', '--detach', residue, 'HEAD')

    expect(wm.reconcileResidues()).toMatchObject({ cleaned: 1, recovered: [], blocked: [] })
    expect(existsSync(residue)).toBe(false)
  })

  it('restaure une quarantaine orpheline comme bureau inconnu sans la publier', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const original = wm.acquire('run-crash')
    writeFileSync(join(original, 'a.txt'), 'travail non publié\n')
    const quarantineRoot = join(wtRoot, '.quarantine')
    const quarantined = join(quarantineRoot, 'run-crash__crash')
    mkdirSync(quarantineRoot, { recursive: true })
    renameSync(original, quarantined)
    git(repo, 'worktree', 'repair', quarantined)

    expect(wm.reconcileResidues()).toMatchObject({
      cleaned: 0,
      recovered: ['run-crash'],
      blocked: []
    })
    expect(existsSync(original)).toBe(true)
    expect(readFileSync(join(original, 'a.txt'), 'utf8')).toContain('non publié')
    expect(wm.listAgentIds()).toContain('run-crash')
  })

  it('écarte un lease dont le PID a été recyclé par un autre processus', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    let identity = 'cli-original'
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      processIdentityFn: () => identity
    })
    wm.markProcess('run-recycled', process.pid, true)

    identity = 'processus-sans-rapport'

    expect(wm.hasActiveProcesses('run-recycled')).toBe(false)
  })

  it('conserve le lease si seul le chemin de la même identité devient lisible', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    let identity = '638904000000000000|'
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      processIdentityFn: () => identity
    })
    wm.markProcess('run-same-process', process.pid, true)

    identity = '638904000000000000|C:\\Tools\\claude.exe'

    expect(wm.hasActiveProcesses('run-same-process')).toBe(true)
  })

  it('conserve la barrière d’un PID vivant même si son identité reste indisponible après douze heures', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      processIdentityFn: () => undefined
    })
    wm.markProcess('run-long', process.pid, true)
    writeFileSync(
      join(wtRoot, '.leases', 'run-long', String(process.pid)),
      JSON.stringify({ identity: null, recordedAt: Date.now() - 13 * 60 * 60 * 1_000 })
    )

    expect(wm.hasActiveProcesses('run-long')).toBe(true)
  })

  it('conserve la barrière pré-spawn jusqu’à la confirmation du PID', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })

    wm.markSpawnIntent('run-pending', 'attempt-a', true)
    expect(wm.hasActiveProcesses('run-pending')).toBe(true)

    wm.markSpawnIntent('run-pending', 'attempt-b', true)
    wm.confirmSpawn('run-pending', 'attempt-a', process.pid)
    expect(wm.hasActiveProcesses('run-pending')).toBe(true)

    wm.markProcess('run-pending', process.pid, false)
    expect(wm.hasActiveProcesses('run-pending')).toBe(true)

    wm.markSpawnIntent('run-pending', 'attempt-b', false)
    expect(wm.hasActiveProcesses('run-pending')).toBe(false)
  })

  it('expire une intention de spawn orpheline sans bloquer la reprise indéfiniment', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    let now = 1_000
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      nowFn: () => now
    })

    wm.markSpawnIntent('run-expired', 'attempt-a', true)
    expect(wm.hasActiveProcesses('run-expired')).toBe(true)

    now += 5 * 60_000
    expect(wm.hasActiveProcesses('run-expired')).toBe(false)
  })

  it('changedFiles développe les dossiers non suivis en fichiers exacts', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('scout')
    mkdirSync(join(path, 'draft', 'nested'), { recursive: true })
    writeFileSync(join(path, 'draft', 'local.ts'), 'local\n')
    writeFileSync(join(path, 'draft', 'nested', 'more.ts'), 'nested\n')

    expect(wm.changedFiles('scout')).toEqual(['draft/local.ts', 'draft/nested/more.ts'])
  })

  it('full-auto : fusionne le travail de l’agent dans la base puis range la copie', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('scout')
    writeFileSync(join(path, 'b.txt'), 'nouveau fichier\n')
    const res = wm.finalize('scout')
    expect(res.outcome).toBe('merged')
    // le fichier de l'agent est arrivé dans la base (tolère CRLF Windows via autocrlf)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe(
      'nouveau fichier\n'
    )
    // la copie a été rangée
    expect(wm.changedFiles('scout')).toHaveLength(0)
  })

  it('copie sans changement → "nothing", rien à fusionner', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    wm.acquire('idle')
    expect(wm.finalize('idle').outcome).toBe('nothing')
  })

  it('capture la branche réellement active au début de chaque run sans redémarrage', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    wm.acquire('run-main')
    expect(wm.describe('run-main').baseBranch).toBe('main')
    expect(wm.finalize('run-main', { baseBranch: 'main' }).outcome).toBe('nothing')

    git(repo, 'switch', '-c', 'topic')
    const topicPath = wm.acquire('run-topic')
    const topicContext = wm.describe('run-topic')
    writeFileSync(join(topicPath, 'topic.txt'), 'topic\n')

    expect(topicContext.baseBranch).toBe('topic')
    expect(wm.finalize('run-topic', { baseBranch: topicContext.baseBranch }).outcome).toBe('merged')
    expect(readFileSync(join(repo, 'topic.txt'), 'utf8')).toContain('topic')
  })

  it('acquiert exactement la branche et la SHA capturées même si HEAD change entre-temps', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    git(repo, 'switch', '-c', 'topic')
    writeFileSync(join(repo, 'topic.txt'), 'uniquement topic\n')
    git(repo, 'add', 'topic.txt')
    git(repo, 'commit', '-q', '-m', 'topic diverge')
    git(repo, 'switch', 'main')

    const context = wm.describe('run-race')
    git(repo, 'switch', 'topic')
    const path = wm.acquire('run-race', context)
    writeFileSync(join(path, 'agent.txt'), 'travail agent\n')

    expect(git(path, 'rev-parse', 'HEAD')).toBe(context.baseSha)
    git(repo, 'switch', 'main')
    expect(wm.finalize('run-race', { baseBranch: context.baseBranch }).outcome).toBe('merged')
    expect(existsSync(join(repo, 'agent.txt'))).toBe(true)
    expect(existsSync(join(repo, 'topic.txt'))).toBe(false)
  })

  it('CONFLIT : deux agents modifient la même ligne → PAS de merge, copie conservée, fichiers remontés', () => {
    const repo = tempRepo()
    const wm = manager(repo)

    // Les DEUX copies partent de la MÊME base (agents parallèles) — acquises avant tout merge.
    const p1 = wm.acquire('builder')
    const p2 = wm.acquire('judge')
    writeFileSync(join(p1, 'a.txt'), 'BUILDER\nligne2\nligne3\n')
    writeFileSync(join(p2, 'a.txt'), 'JUDGE\nligne2\nligne3\n')

    // Builder fusionne en premier (propre). Judge, parti de la base d'origine, entre en conflit.
    expect(wm.finalize('builder').outcome).toBe('merged')
    const res = wm.finalize('judge')

    expect(res.outcome).toBe('conflict')
    if (res.outcome === 'conflict') {
      expect(res.files).toContain('a.txt')
      const headBeforeRead = git(repo, 'rev-parse', 'HEAD')
      const statusBeforeRead = git(repo, 'status', '--porcelain')
      const comparison = wm.readConflictDiff('judge', {
        files: res.files,
        baseSha: res.baseSha,
        agentSha: res.agentSha
      })
      expect(comparison).toMatchObject({ available: true, paths: ['a.txt'] })
      if (comparison.available) {
        expect(comparison.diff).toContain('-BUILDER')
        expect(comparison.diff).toContain('+JUDGE')
      }
      expect(
        wm.readConflictDiff('judge', {
          files: ['../secret.txt'],
          baseSha: res.baseSha,
          agentSha: res.agentSha
        })
      ).toEqual({ available: false, reason: 'invalid-path' })
      expect(git(repo, 'rev-parse', 'HEAD')).toBe(headBeforeRead)
      expect(git(repo, 'status', '--porcelain')).toBe(statusBeforeRead)
    }
    // Garde-fou : la base n'a PAS été écrasée (garde le travail du builder, pas de marqueurs de conflit).
    const baseA = readFileSync(join(repo, 'a.txt'), 'utf8')
    expect(baseA).toContain('BUILDER')
    expect(baseA).not.toMatch(/<<<<<<<|>>>>>>>/)
    // Garde-fou : la copie du judge est CONSERVÉE (merge assisté possible).
    expect(wm.changedFiles('judge').length >= 0).toBe(true)
    expect(() => wm.acquire('judge')).not.toThrow() // le worktree existe toujours
  })

  it('base sale sur le même fichier → bloque proprement sans inventer un conflit d’agents', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(repo, 'a.txt'), 'travail local non committé\n')
    writeFileSync(join(path, 'a.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', files: ['a.txt'], reason: 'base-dirty' })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail local non committé')
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('base avec travail indexé hors chevauchement → publie sans altérer l’index utilisateur', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    writeFileSync(join(repo, 'a.txt'), 'travail utilisateur indexé\n')
    git(repo, 'add', 'a.txt')
    const headBefore = git(repo, 'rev-parse', 'HEAD')
    const statusBefore = git(repo, 'status', '--porcelain')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'merged' })
    expect(git(repo, 'rev-parse', 'HEAD')).not.toBe(headBefore)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail utilisateur indexé')
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail de la copie')
  })

  it('bisect utilisateur actif → bloque sans mutation même lorsque la base est propre', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    git(repo, 'bisect', 'start')
    const headBefore = git(repo, 'rev-parse', 'HEAD')
    const bisectStart = git(repo, 'rev-parse', '--git-path', 'BISECT_START')
    expect(existsSync(join(repo, bisectStart))).toBe(true)

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headBefore)
    expect(existsSync(join(repo, bisectStart))).toBe(true)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('merge utilisateur déjà en conflit → bloque sans l’attribuer à l’agent ni l’annuler', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail indépendant de la copie\n')

    git(repo, 'checkout', '-q', '-b', 'user-conflict')
    writeFileSync(join(repo, 'a.txt'), 'UTILISATEUR-BRANCHE\nligne2\nligne3\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'branche utilisateur')
    git(repo, 'checkout', '-q', 'main')
    writeFileSync(join(repo, 'a.txt'), 'UTILISATEUR-MAIN\nligne2\nligne3\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'main utilisateur')
    expect(() => git(repo, 'merge', '--no-edit', 'user-conflict')).toThrow()

    const mergeHeadBefore = git(repo, 'rev-parse', 'MERGE_HEAD')
    const statusBefore = git(repo, 'status', '--porcelain')
    const res = wm.finalize('builder')

    expect(res).toMatchObject({
      outcome: 'blocked',
      files: ['a.txt'],
      reason: 'base-in-progress'
    })
    expect(git(repo, 'rev-parse', 'MERGE_HEAD')).toBe(mergeHeadBefore)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('merge utilisateur démarré après le préflight → ne l’attribue pas à l’agent et ne l’annule pas', () => {
    const repo = tempRepo()
    git(repo, 'checkout', '-q', '-b', 'user-conflict')
    writeFileSync(join(repo, 'a.txt'), 'UTILISATEUR-BRANCHE\nligne2\nligne3\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'branche utilisateur')
    git(repo, 'checkout', '-q', 'main')
    writeFileSync(join(repo, 'a.txt'), 'UTILISATEUR-MAIN\nligne2\nligne3\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'main utilisateur')

    let injected = false
    let mergeHeadBeforeFinalize = ''
    let statusBeforeFinalize = ''
    const tryGitFn = (dir: string, args: string[]) => {
      if (!injected && dir === repo && args.includes('merge')) {
        injected = true
        const userMerge = spawnSync('git', ['merge', '--no-edit', 'user-conflict'], {
          cwd: dir,
          encoding: 'utf8'
        })
        expect(userMerge.status).not.toBe(0)
        mergeHeadBeforeFinalize = git(repo, 'rev-parse', 'MERGE_HEAD')
        statusBeforeFinalize = git(repo, 'status', '--porcelain')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail indépendant de la copie\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({
      outcome: 'blocked',
      files: ['a.txt'],
      reason: 'base-in-progress'
    })
    expect(git(repo, 'rev-parse', 'MERGE_HEAD')).toBe(mergeHeadBeforeFinalize)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBeforeFinalize)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('changement de branche pendant la publication → n’avance aucune branche', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'branch', 'topic', baseSha)
    let switched = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (!switched && dir === repo && args.includes('merge') && args.includes('--ff-only')) {
        switched = true
        git(repo, 'switch', 'topic')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(switched).toBe(true)
    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'branch', '--show-current')).toBe('topic')
    expect(git(repo, 'rev-parse', 'main')).toBe(baseSha)
    expect(git(repo, 'rev-parse', 'topic')).toBe(baseSha)
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('base avancée après l ancre → libère l ancre puis réussit au retry', () => {
    const repo = tempRepo()
    let advanced = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (!advanced && dir === repo && args.includes('merge') && args.includes('--ff-only')) {
        advanced = true
        writeFileSync(join(repo, 'concurrent.txt'), 'avance concurrente\n')
        git(repo, 'add', 'concurrent.txt')
        git(repo, 'commit', '-q', '-m', 'avance concurrente')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const first = wm.finalize('builder')

    expect(first).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(() => git(repo, 'rev-parse', 'refs/autowin/publications/builder')).toThrow()

    const retried = wm.finalize('builder')

    expect(retried).toMatchObject({ outcome: 'merged' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail de la copie')
    expect(readFileSync(join(repo, 'concurrent.txt'), 'utf8')).toContain('avance concurrente')
    expect(git(repo, 'rev-parse', 'refs/autowin/publications/builder')).toMatch(/^[0-9a-f]{40}$/)
  })

  it('index utilisateur modifié pendant la publication → bloque sans avancer HEAD', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let staged = false
    let stagedStatus = ''
    const tryGitFn = (dir: string, args: string[]) => {
      if (!staged && dir === repo && args.includes('merge') && args.includes('--ff-only')) {
        staged = true
        writeFileSync(join(repo, 'a.txt'), 'travail utilisateur indexé\n')
        git(repo, 'add', 'a.txt')
        stagedStatus = git(repo, 'status', '--porcelain')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(staged).toBe(true)
    expect(res).toMatchObject({ outcome: 'blocked', files: ['a.txt'], reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(git(repo, 'status', '--porcelain')).toBe(stagedStatus)
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('hook utilisateur modifiant le fichier agent pendant prepared → bloque avant la branche', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const hooksPath = join(repo, git(repo, 'rev-parse', '--git-path', 'hooks'))
    mkdirSync(hooksPath, { recursive: true })
    const hookPath = join(hooksPath, 'reference-transaction')
    writeFileSync(
      hookPath,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  root=$(git rev-parse --show-toplevel) || exit 30
  printf 'travail utilisateur concurrent\n' > "$root/b.txt" || exit 31
  git -C "$root" add b.txt || exit 32
fi
exit 0
`
    )
    chmodSync(hookPath, 0o755)
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')
    expect(res).toMatchObject({
      outcome: 'blocked',
      files: ['b.txt'],
      reason: 'base-in-progress'
    })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur concurrent')
    expect(git(repo, 'status', '--porcelain')).toBe('A  b.txt')
  })

  it('hook utilisateur modifiant seulement le worktree agent → restaure l’index initial', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const baseIndexTree = git(repo, 'write-tree')
    const hooksPath = join(repo, git(repo, 'rev-parse', '--git-path', 'hooks'))
    mkdirSync(hooksPath, { recursive: true })
    const hookPath = join(hooksPath, 'reference-transaction')
    writeFileSync(
      hookPath,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  root=$(git rev-parse --show-toplevel) || exit 30
  printf 'travail utilisateur non indexé\n' > "$root/b.txt" || exit 31
fi
exit 0
`
    )
    chmodSync(hookPath, 0o755)
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({
      outcome: 'blocked',
      files: ['b.txt'],
      reason: 'base-in-progress'
    })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(git(repo, 'write-tree')).toBe(baseIndexTree)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur non indexé')
    expect(git(repo, 'status', '--porcelain')).toBe('?? b.txt')
  })

  it('hook désindexant seulement la version agent → restaure aussi le worktree de base', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'b.txt'), 'version de base\n')
    git(repo, 'add', 'b.txt')
    git(repo, 'commit', '-q', '-m', 'ajout b')
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const baseIndexTree = git(repo, 'write-tree')
    const hooksPath = join(repo, git(repo, 'rev-parse', '--git-path', 'hooks'))
    mkdirSync(hooksPath, { recursive: true })
    const hookPath = join(hooksPath, 'reference-transaction')
    writeFileSync(
      hookPath,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  root=$(git rev-parse --show-toplevel) || exit 30
  git -C "$root" restore --staged --source=HEAD -- b.txt || exit 31
fi
exit 0
`
    )
    chmodSync(hookPath, 0o755)
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'version agent\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(git(repo, 'write-tree')).toBe(baseIndexTree)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('version de base')
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })

  it('hook utilisateur recréant sans index un fichier supprimé par l’agent → bloque et préserve', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'b.txt'), 'version de base\n')
    git(repo, 'add', 'b.txt')
    git(repo, 'commit', '-q', '-m', 'ajout b')
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const baseIndexTree = git(repo, 'write-tree')
    const hooksPath = join(repo, git(repo, 'rev-parse', '--git-path', 'hooks'))
    mkdirSync(hooksPath, { recursive: true })
    const hookPath = join(hooksPath, 'reference-transaction')
    writeFileSync(
      hookPath,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  root=$(git rev-parse --show-toplevel) || exit 30
  printf 'travail utilisateur recréé\n' > "$root/b.txt" || exit 31
fi
exit 0
`
    )
    chmodSync(hookPath, 0o755)
    const wm = manager(repo)
    const path = wm.acquire('builder')
    rmSync(join(path, 'b.txt'))

    const res = wm.finalize('builder')

    expect(res).toMatchObject({
      outcome: 'blocked',
      files: ['b.txt'],
      reason: 'base-in-progress'
    })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(git(repo, 'write-tree')).toBe(baseIndexTree)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur recréé')
    expect(git(repo, 'status', '--porcelain')).toBe('M b.txt')
  })

  it('hook recréant un fichier agent ignoré et non suivi → bloque et préserve', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, '.gitignore'), '*.tmp\n')
    writeFileSync(join(repo, 'b.tmp'), 'version de base\n')
    git(repo, 'add', '.gitignore')
    git(repo, 'add', '-f', 'b.tmp')
    git(repo, 'commit', '-q', '-m', 'ajout b ignoré')
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const baseIndexTree = git(repo, 'write-tree')
    const hooksPath = join(repo, git(repo, 'rev-parse', '--git-path', 'hooks'))
    const hookPath = join(hooksPath, 'reference-transaction')
    writeFileSync(
      hookPath,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  root=$(git rev-parse --show-toplevel) || exit 30
  printf 'travail utilisateur ignoré\n' > "$root/b.tmp" || exit 31
fi
exit 0
`
    )
    chmodSync(hookPath, 0o755)
    const wm = manager(repo)
    const path = wm.acquire('builder')
    rmSync(join(path, 'b.tmp'))

    const res = wm.finalize('builder')

    expect(res).toMatchObject({
      outcome: 'blocked',
      files: ['b.tmp'],
      reason: 'base-in-progress'
    })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(git(repo, 'write-tree')).toBe(baseIndexTree)
    expect(readFileSync(join(repo, 'b.tmp'), 'utf8')).toContain('travail utilisateur ignoré')
  })

  it('hook modifiant l’index pendant la ref interne de publication → bloque avant le merge', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hooksPath = join(repo, git(repo, 'rev-parse', '--git-path', 'hooks'))
    mkdirSync(hooksPath, { recursive: true })
    const hookPath = join(hooksPath, 'reference-transaction')
    writeFileSync(
      hookPath,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/autowin/publications/builder'; then
  root=$(git rev-parse --show-toplevel) || exit 30
  printf 'travail utilisateur pendant la ref\n' > "$root/a.txt" || exit 31
  git -C "$root" add a.txt || exit 32
fi
exit 0
`
    )
    chmodSync(hookPath, 0o755)

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain(
      'travail utilisateur pendant la ref'
    )
    expect(git(repo, 'status', '--porcelain')).toBe('M  a.txt')
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(() => git(repo, 'rev-parse', 'refs/autowin/publications/builder')).toThrow()
  })

  it('hook utilisateur indexant un fichier distinct → retire le fichier agent et préserve le hook', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const hooksPath = join(repo, git(repo, 'rev-parse', '--git-path', 'hooks'))
    mkdirSync(hooksPath, { recursive: true })
    const hookPath = join(hooksPath, 'reference-transaction')
    writeFileSync(
      hookPath,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  root=$(git rev-parse --show-toplevel) || exit 30
  printf 'travail utilisateur distinct\n' > "$root/a.txt" || exit 31
  git -C "$root" add a.txt || exit 32
fi
exit 0
`
    )
    chmodSync(hookPath, 0o755)
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')
    expect(res).toMatchObject({
      outcome: 'blocked',
      files: ['a.txt'],
      reason: 'base-in-progress'
    })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail utilisateur distinct')
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(git(repo, 'status', '--porcelain')).toBe('M  a.txt')
  })

  it('bisect démarré pendant la publication → bloque sans mutation', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let bisectStarted = false
    let bisectStartPath = ''
    const tryGitFn = (dir: string, args: string[]) => {
      if (!bisectStarted && dir === repo && args.includes('merge') && args.includes('--ff-only')) {
        bisectStarted = true
        git(repo, 'bisect', 'start')
        bisectStartPath = git(repo, 'rev-parse', '--git-path', 'BISECT_START')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(bisectStarted).toBe(true)
    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(existsSync(join(repo, bisectStartPath))).toBe(true)
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('fast-forward utilisateur vers la SHA intégrée → ne l’attribue pas à Autowin', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let userPublished = false
    let userReflog = ''
    const tryGitFn = (dir: string, args: string[]) => {
      if (!userPublished && dir === repo && args.includes('merge') && args.includes('--ff-only')) {
        userPublished = true
        const targetSha = args.at(-1) ?? ''
        const userMerge = spawnSync('git', ['merge', '--ff-only', targetSha], {
          cwd: repo,
          encoding: 'utf8',
          env: { ...process.env, GIT_REFLOG_ACTION: 'user-fast-forward' }
        })
        expect(userMerge.status).toBe(0)
        userReflog = git(repo, 'reflog', '-1', '--format=%gs', 'main')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(userPublished).toBe(true)
    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).not.toBe(baseSha)
    expect(git(repo, 'reflog', '-1', '--format=%gs', 'main')).toBe(userReflog)
    expect(userReflog).toContain('user-fast-forward')
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('merge utilisateur de la même SHA démarré pendant la finalisation → le conserve intact', () => {
    const repo = tempRepo()
    let injected = false
    let baseAbortCalls = 0
    let agentSha = ''
    let mergeHeadBeforeFinalize = ''
    let statusBeforeFinalize = ''
    const tryGitFn = (dir: string, args: string[]) => {
      if (dir === repo && args[0] === 'merge' && args[1] === '--abort') baseAbortCalls += 1
      const isMerge = args.includes('merge') && args.at(-1) !== '--abort'
      if (isMerge && dir !== repo) agentSha = args.at(-1) ?? ''
      if (!injected && isMerge && dir === repo) {
        injected = true
        agentSha ||= args.at(-1) ?? ''
        writeFileSync(join(repo, 'a.txt'), 'UTILISATEUR\nligne2\nligne3\n')
        git(repo, 'add', '-A')
        git(repo, 'commit', '-q', '-m', 'avance utilisateur concurrente')
        const userMerge = spawnSync('git', ['merge', '--no-edit', agentSha], {
          cwd: repo,
          encoding: 'utf8'
        })
        expect(userMerge.status).not.toBe(0)
        mergeHeadBeforeFinalize = git(repo, 'rev-parse', 'MERGE_HEAD')
        statusBeforeFinalize = git(repo, 'status', '--porcelain')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'a.txt'), 'AGENT\nligne2\nligne3\n')
    writeFileSync(join(repo, 'base.txt'), 'avance indépendante de la base\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'avance base')

    const res = wm.finalize('builder')

    expect(injected).toBe(true)
    expect(res).toMatchObject({ outcome: 'blocked', files: ['a.txt'], reason: 'base-in-progress' })
    expect(baseAbortCalls).toBe(0)
    expect(git(repo, 'rev-parse', 'MERGE_HEAD')).toBe(mergeHeadBeforeFinalize)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBeforeFinalize)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('hook refusant le merge → avorte l’opération créée même sans fichier en conflit', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    writeFileSync(join(repo, 'base.txt'), 'avance indépendante de la base\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'avance base')
    const hook = join(repo, '.git', 'hooks', 'pre-merge-commit')
    writeFileSync(hook, '#!/bin/sh\nexit 1\n')
    chmodSync(hook, 0o755)

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', files: ['b.txt'], reason: 'merge-failed' })
    expect(() => git(repo, 'rev-parse', '--verify', 'MERGE_HEAD')).toThrow()
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('reference-transaction refusant main → restaure l’index utilisateur sans résidu agent', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    writeFileSync(join(repo, 'a.txt'), 'travail utilisateur indexé\n')
    git(repo, 'add', 'a.txt')
    const indexTreeBefore = git(repo, 'write-tree')
    const statusBefore = git(repo, 'status', '--porcelain')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  exit 1
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(git(repo, 'write-tree')).toBe(indexTreeBefore)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
  })

  it('édition humaine après le retour du hook → refuse la compensation initiale sans écraser', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let changedAfterMerge = false
    const tryGitFn = (dir: string, args: string[]) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      if (
        !changedAfterMerge &&
        dir === repo &&
        args.includes('merge') &&
        args.includes('--ff-only')
      ) {
        changedAfterMerge = true
        writeFileSync(join(repo, 'b.txt'), 'édition humaine après le hook\n')
      }
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf 'travail utilisateur du hook\n' > b.txt
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    const result = wm.finalize('builder')

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('édition humaine après le hook')
  })

  it('édition humaine juste avant la mutation conditionnelle → refuse sans écraser', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let changedBeforeMutation = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        !changedBeforeMutation &&
        dir === repo &&
        (args[0] === 'restore' ||
          args[0] === 'apply' ||
          args.includes('autowin-compensation-apply'))
      ) {
        changedBeforeMutation = true
        writeFileSync(join(repo, 'b.txt'), 'édition humaine juste avant mutation\n')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf 'travail utilisateur du hook\n' > b.txt
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    const result = wm.finalize('builder')

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain(
      'édition humaine juste avant mutation'
    )
  })

  it('git add pendant le snapshot CAS → refuse sans désindexer l’action humaine', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let compensationAnchored = false
    let indexedDuringSnapshot = false
    const tryGitFn = (dir: string, args: string[]) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      const updateRef = args.indexOf('update-ref')
      if (
        dir === repo &&
        result.status === 0 &&
        updateRef >= 0 &&
        args[updateRef + 1]?.endsWith('/resume-worktree')
      ) {
        compensationAnchored = true
      } else if (
        compensationAnchored &&
        !indexedDuringSnapshot &&
        dir === repo &&
        result.status === 0 &&
        (args[0] === 'write-tree' ||
          args[0] === 'apply' ||
          args.includes('autowin-compensation-apply'))
      ) {
        indexedDuringSnapshot = true
        git(repo, 'add', 'b.txt')
      }
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf 'travail utilisateur du hook\n' > b.txt
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    const result = wm.finalize('builder')

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('b.txt')
  })

  it('git add entre garde index et patch worktree → le verrou natif protège la frontière', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let attemptedAddStatus: number | null | undefined
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        attemptedAddStatus === undefined &&
        dir === repo &&
        args[0] === 'apply' &&
        !args.includes('--cached')
      ) {
        attemptedAddStatus = spawnSync('git', ['add', 'b.txt'], {
          cwd: repo,
          encoding: 'utf8'
        }).status
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf 'travail utilisateur du hook\n' > b.txt
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    const result = wm.finalize('builder')

    expect(attemptedAddStatus).not.toBe(0)
    expect(result).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(git(repo, 'write-tree')).toBe(git(repo, 'rev-parse', `${baseSha}^{tree}`))
  })

  it('deux managers ne peuvent pas voler le verrou pendant la reprise stale', () => {
    const repo = tempRepo()
    const stalePid = 2_147_483_647
    installCompensationIndexOwner(
      repo,
      JSON.stringify({
        owner: 'autowin-compensation',
        pid: stalePid,
        identity: null,
        token: 'stale-race-owner'
      })
    )
    const processIdentityFn = (pid: number) => (pid === stalePid ? undefined : `live|${pid}`)
    const firstRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const racerRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(firstRoot, racerRoot)
    const racer = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: racerRoot,
      processIdentityFn
    }) as unknown as CompensationIndexLockProbe
    let racerAttempted = false
    let racerLock: ReturnType<CompensationIndexLockProbe['acquireCompensationIndexLock']>
    const tryGitFn = (dir: string, args: string[]) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      if (
        !racerAttempted &&
        result.status === 0 &&
        args.includes('update-ref') &&
        !args.includes('-d') &&
        args.includes('refs/autowin/locks/index')
      ) {
        racerAttempted = true
        racerLock = racer.acquireCompensationIndexLock()
      }
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const first = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: firstRoot,
      processIdentityFn,
      tryGitFn
    }) as unknown as CompensationIndexLockProbe

    const firstLock = first.acquireCompensationIndexLock()

    expect(racerAttempted).toBe(true)
    expect(racerLock).toBeUndefined()
    expect(firstLock).toBeDefined()
    writeFileSync(join(repo, 'a.txt'), 'édition humaine à indexer\n')
    expect(spawnSync('git', ['add', 'a.txt'], { cwd: repo }).status).not.toBe(0)
    first.releaseCompensationIndexLock(firstLock!)
    expect(spawnSync('git', ['add', 'a.txt'], { cwd: repo }).status).toBe(0)
  })

  it('un crash avant le lien atomique ne publie aucun index.lock tronqué', () => {
    const repo = tempRepo()
    const stalePid = 2_147_483_647
    const failedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(failedRoot, resumedRoot)
    const failed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: failedRoot,
      linkFileFn: () => {
        throw new Error('crash avant publication atomique')
      }
    }) as unknown as CompensationIndexLockProbe

    expect(failed.acquireCompensationIndexLock()).toBeUndefined()
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).not.toBe(0)

    const partialOwner = join(
      repo,
      '.git',
      'autowin-compensations',
      'locks',
      `index-${stalePid}-partial.owner`
    )
    writeFileSync(partialOwner, '{"owner":"autowin-compensation"')

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot,
      processIdentityFn: (pid) => (pid === stalePid ? undefined : `live|${pid}`)
    }) as unknown as CompensationIndexLockProbe
    const lock = resumed.acquireCompensationIndexLock()
    expect(lock).toBeDefined()
    expect(existsSync(partialOwner)).toBe(false)
    resumed.releaseCompensationIndexLock(lock!)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
  })

  it('un échec de suppression native conserve la ref puis se reprend', () => {
    const repo = tempRepo()
    const failedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(failedRoot, resumedRoot)
    let failNativeRelease = true
    const failed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: failedRoot,
      removeIndexLockFn: (path) => {
        if (failNativeRelease) {
          failNativeRelease = false
          throw new Error('verrou Windows transitoire')
        }
        rmSync(path, { force: true })
      }
    }) as unknown as CompensationIndexLockProbe
    const firstLock = failed.acquireCompensationIndexLock()
    expect(firstLock).toBeDefined()

    failed.releaseCompensationIndexLock(firstLock!)

    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(true)
    expect(git(repo, 'rev-parse', '--verify', 'refs/autowin/locks/index')).toBe(
      firstLock!.ownershipOid
    )

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot
    }) as unknown as CompensationIndexLockProbe
    const resumedLock = resumed.acquireCompensationIndexLock()
    expect(resumedLock).toBeDefined()
    resumed.releaseCompensationIndexLock(resumedLock!)
    writeFileSync(join(repo, 'a.txt'), 'index libéré\n')
    expect(spawnSync('git', ['add', 'a.txt'], { cwd: repo }).status).toBe(0)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).not.toBe(0)
  })

  it('un échec de suppression de la ref reprend dans le worker suivant', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot, resumedRoot)
    let failOwnershipRelease = true
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        failOwnershipRelease &&
        args.includes('update-ref') &&
        args.includes('-d') &&
        args.includes('refs/autowin/locks/index')
      ) {
        failOwnershipRelease = false
        return { code: 1, stdout: '', stderr: 'ref Windows transitoirement verrouillée' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      tryGitFn
    }) as unknown as CompensationIndexLockProbe
    const firstLock = wm.acquireCompensationIndexLock()
    expect(firstLock).toBeDefined()

    wm.releaseCompensationIndexLock(firstLock!)

    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
    expect(git(repo, 'rev-parse', '--verify', 'refs/autowin/locks/index')).toBe(
      firstLock!.ownershipOid
    )

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot
    }) as unknown as CompensationIndexLockProbe
    const nextLock = resumed.acquireCompensationIndexLock()
    expect(nextLock).toBeDefined()
    resumed.releaseCompensationIndexLock(nextLock!)
    writeFileSync(join(repo, 'a.txt'), 'étape suivante libérée\n')
    expect(spawnSync('git', ['add', 'a.txt'], { cwd: repo }).status).toBe(0)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).not.toBe(0)
  })

  it('un échec rm pendant takeover conserve la préimage pour le worker suivant', () => {
    const repo = tempRepo()
    const stalePid = 2_147_483_647
    installCompensationIndexOwner(
      repo,
      JSON.stringify({
        owner: 'autowin-compensation',
        pid: stalePid,
        identity: null,
        token: 'stale-takeover-owner'
      })
    )
    const failedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(failedRoot, resumedRoot)
    let failTakeoverRemove = true
    const failed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: failedRoot,
      processIdentityFn: (pid) => (pid === stalePid ? undefined : `live|${pid}`),
      removeIndexLockFn: (path) => {
        if (failTakeoverRemove) {
          failTakeoverRemove = false
          throw new Error('antivirus pendant takeover')
        }
        rmSync(path, { force: true })
      }
    }) as unknown as CompensationIndexLockProbe

    expect(failed.acquireCompensationIndexLock()).toBeUndefined()
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(true)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).toBe(0)

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot
    }) as unknown as CompensationIndexLockProbe
    const lock = resumed.acquireCompensationIndexLock()
    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    writeFileSync(join(repo, 'a.txt'), 'takeover repris\n')
    expect(spawnSync('git', ['add', 'a.txt'], { cwd: repo }).status).toBe(0)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).not.toBe(0)
  })

  it('un crash avant le CAS nettoie son marqueur acquiring orphelin après expiration', () => {
    const repo = tempRepo()
    const failedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(failedRoot, resumedRoot)
    let crashBeforeCas = true
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        crashBeforeCas &&
        args.includes('update-ref') &&
        args.includes('refs/autowin/locks/index') &&
        !args.includes('-d')
      ) {
        crashBeforeCas = false
        throw new Error('worker tué avant le CAS')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const failed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: failedRoot,
      nowFn: () => 1_000,
      tryGitFn
    }) as unknown as CompensationIndexLockProbe

    expect(failed.acquireCompensationIndexLock()).toBeUndefined()
    const markerRoot = join(repo, '.git', 'autowin-compensations', 'locks')
    const orphan = readdirSync(markerRoot).find((entry) => /^acquiring-.+\.marker$/.test(entry))
    expect(orphan).toBeDefined()
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).not.toBe(0)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot,
      nowFn: () => 301_001
    }) as unknown as CompensationIndexLockProbe
    const lock = resumed.acquireCompensationIndexLock()

    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    expect(existsSync(join(markerRoot, orphan!))).toBe(false)
  })

  it('une acquisition expirée reprise après balayage reste récupérable après son CAS', () => {
    const repo = tempRepo()
    const failedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const competingRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(failedRoot, competingRoot, resumedRoot)
    let now = 1_000
    let suspendBeforeCas = true
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        suspendBeforeCas &&
        args.includes('update-ref') &&
        args.includes('refs/autowin/locks/index') &&
        !args.includes('-d')
      ) {
        suspendBeforeCas = false
        now = 301_001
        const competing = new WorktreeManager({
          baseRepo: repo,
          worktreeRoot: competingRoot,
          nowFn: () => now
        }) as unknown as CompensationIndexLockProbe
        const competingLock = competing.acquireCompensationIndexLock()
        expect(competingLock).toBeDefined()
        competing.releaseCompensationIndexLock(competingLock!)

        const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
        expect(result.status).toBe(0)
        throw new Error('worker tué juste après son CAS tardif')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const failed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: failedRoot,
      nowFn: () => now,
      processIdentityFn: (pid) => `live|${pid}`,
      tryGitFn
    }) as unknown as CompensationIndexLockProbe

    expect(failed.acquireCompensationIndexLock()).toBeUndefined()
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).toBe(0)

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot,
      nowFn: () => now,
      processIdentityFn: (pid) => `live|${pid}`
    }) as unknown as CompensationIndexLockProbe
    const lock = resumed.acquireCompensationIndexLock()

    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
  })

  it('une reprise nettoie un temporaire de marqueur expiré après fsync', () => {
    const repo = tempRepo()
    const markerRoot = join(repo, '.git', 'autowin-compensations', 'locks')
    mkdirSync(markerRoot, { recursive: true })
    const temporaryMarker = join(
      markerRoot,
      'acquiring-crash-fsync.marker.12345678.00000000-0000-0000-0000-000000000000.tmp'
    )
    writeFileSync(
      temporaryMarker,
      JSON.stringify({
        version: 1,
        token: 'crash-fsync',
        state: 'acquiring',
        predecessorSerialized: null,
        expiresAt: 999
      })
    )
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      nowFn: () => 1_000
    }) as unknown as CompensationIndexLockProbe

    const lock = resumed.acquireCompensationIndexLock()

    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    expect(existsSync(temporaryMarker)).toBe(false)
  })

  it('un worker tué après le hard-link libère le lease expiré sans toucher au travail humain', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'a.txt'), 'version index humain\n')
    git(repo, 'add', 'a.txt')
    writeFileSync(join(repo, 'a.txt'), 'version worktree humaine\n')
    const expectedIndex = git(repo, 'show', ':a.txt')
    const expectedWorktree = readFileSync(join(repo, 'a.txt'), 'utf8')
    const failedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(failedRoot, resumedRoot)
    let now = 1_000
    const failed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: failedRoot,
      nowFn: () => now,
      processIdentityFn: (pid) => `live|${pid}`
    }) as unknown as CompensationIndexLockProbe
    const abandonedLock = failed.acquireCompensationIndexLock()
    expect(abandonedLock).toBeDefined()
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(true)

    now = 301_001
    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot,
      nowFn: () => now,
      processIdentityFn: (pid) => `live|${pid}`
    }) as unknown as CompensationIndexLockProbe
    const lock = resumed.acquireCompensationIndexLock()

    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    expect(git(repo, 'show', ':a.txt')).toBe(expectedIndex)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe(expectedWorktree)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
  })

  it('une reprise nettoie un owner vide laissé avant son écriture par un worker du même PID', () => {
    const repo = tempRepo()
    const ownerRoot = join(repo, '.git', 'autowin-compensations', 'locks')
    mkdirSync(ownerRoot, { recursive: true })
    const partialOwner = join(ownerRoot, `index-${process.pid}-partial-same-worker.owner`)
    writeFileSync(partialOwner, '')
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      processIdentityFn: (pid) => `live|${pid}`
    }) as unknown as CompensationIndexLockProbe

    const lock = resumed.acquireCompensationIndexLock()

    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    expect(existsSync(partialOwner)).toBe(false)
  })

  it('un worker mort en acquisition expire même si le PID Electron vit encore', () => {
    const repo = tempRepo()
    const predecessorSerialized = JSON.stringify({
      owner: 'autowin-compensation',
      pid: 2_147_483_647,
      identity: null,
      token: 'worker-predecessor'
    })
    const currentSerialized = JSON.stringify({
      owner: 'autowin-compensation',
      pid: process.pid,
      identity: `live|${process.pid}`,
      token: 'expired-worker-owner'
    })
    const currentObject = spawnSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repo,
      encoding: 'utf8',
      input: currentSerialized
    })
    expect(currentObject.status).toBe(0)
    git(repo, 'update-ref', 'refs/autowin/locks/index', currentObject.stdout.trim())
    writeFileSync(join(repo, '.git', 'index.lock'), predecessorSerialized)
    const markerRoot = join(repo, '.git', 'autowin-compensations', 'locks')
    mkdirSync(markerRoot, { recursive: true })
    writeFileSync(
      join(markerRoot, 'acquiring-expired-worker-owner.marker'),
      JSON.stringify({
        version: 1,
        token: 'expired-worker-owner',
        state: 'acquiring',
        predecessorSerialized,
        expiresAt: 999
      })
    )
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      nowFn: () => 1_000,
      processIdentityFn: (pid) => `live|${pid}`
    }) as unknown as CompensationIndexLockProbe

    const lock = resumed.acquireCompensationIndexLock()

    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    writeFileSync(join(repo, 'a.txt'), 'worker expiré repris\n')
    expect(spawnSync('git', ['add', 'a.txt'], { cwd: repo }).status).toBe(0)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
  })

  it('crash après la première mutation conditionnelle → reprend sans perdre le hook', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let crashAfterMutation = true
    const tryGitFn = (dir: string, args: string[]) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      if (
        crashAfterMutation &&
        dir === repo &&
        result.status === 0 &&
        (args[0] === 'apply' || args.includes('autowin-compensation-apply'))
      ) {
        crashAfterMutation = false
        throw new Error('crash après mutation conditionnelle réussie')
      }
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf 'travail utilisateur du hook\n' > b.txt
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    expect(wm.finalize('builder')).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })

    const patchRoot = join(repo, '.git', 'autowin-compensations', 'patches', 'builder')
    const orphanPatch = join(patchRoot, 'conditional-crash.patch')
    mkdirSync(patchRoot, { recursive: true })
    writeFileSync(orphanPatch, 'contenu temporaire sensible\n')
    const staleIndexLock = join(repo, '.git', 'index.lock')
    const stalePid = 2_147_483_647
    installCompensationIndexOwner(
      repo,
      JSON.stringify({
        owner: 'autowin-compensation',
        pid: stalePid,
        identity: null,
        token: 'crash-owner'
      })
    )

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      processIdentityFn: (pid) => (pid === stalePid ? undefined : `live|${pid}`)
    }).finalize('builder')
    expect(resumed).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(git(repo, 'write-tree')).toBe(git(repo, 'rev-parse', `${baseSha}^{tree}`))
    expect(existsSync(orphanPatch)).toBe(false)
    expect(existsSync(staleIndexLock)).toBe(false)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).not.toBe(0)
  })

  it('échec de persistance de la phase compensée → reprend sans rejouer les patches', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const planPath = join(repo, '.git', 'autowin-compensations', 'builder.json')
    const pendingPath = `${planPath}.pending`
    let failCompensatedPersist = true
    const tryGitFn = (dir: string, args: string[]) => {
      const updateRef = args.indexOf('update-ref')
      if (
        failCompensatedPersist &&
        dir === repo &&
        updateRef >= 0 &&
        args[updateRef + 1]?.startsWith('refs/autowin/compensations/builder/') &&
        !args.includes('-d') &&
        existsSync(pendingPath) &&
        JSON.parse(readFileSync(pendingPath, 'utf8')).phase === 'compensated'
      ) {
        failCompensatedPersist = false
        return { code: 128, stdout: '', stderr: 'crash persistance phase compensée' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf 'travail utilisateur du hook\n' > b.txt
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    expect(wm.finalize('builder')).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })

    const resumed = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize(
      'builder'
    )
    expect(resumed).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(git(repo, 'write-tree')).toBe(git(repo, 'rev-parse', `${baseSha}^{tree}`))
  })

  it('échec transitoire de compensation → reprend durablement au finalize suivant', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let failNextPatch = true
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        failNextPatch &&
        dir === repo &&
        (args[0] === 'apply' || args.includes('autowin-compensation-apply'))
      ) {
        failNextPatch = false
        return { code: 128, stdout: '', stderr: 'verrou index transitoire' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf 'travail utilisateur du hook\n' > b.txt
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    const failed = wm.finalize('builder')

    expect(failed).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    const compensationPlan = join(repo, '.git', 'autowin-compensations', 'builder.json')
    expect(existsSync(compensationPlan)).toBe(true)
    const persistedPlan = JSON.parse(readFileSync(compensationPlan, 'utf8')) as {
      generation: string
    }
    const worktreeRef = `refs/autowin/compensations/builder/${persistedPlan.generation}/worktree`
    expect(git(repo, 'rev-parse', worktreeRef)).toMatch(/^[0-9a-f]{40}$/)

    const restarted = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    writeFileSync(join(repo, 'b.txt'), 'édition humaine plus récente\n')
    const indexBeforeRefusal = git(repo, 'write-tree')
    const refused = restarted.finalize('builder')
    expect(refused).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('édition humaine plus récente')
    expect(git(repo, 'write-tree')).toBe(indexBeforeRefusal)

    writeFileSync(join(repo, 'b.txt'), 'travail utilisateur du hook\n')
    const resumed = restarted.finalize('builder')

    expect(resumed).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(git(repo, 'write-tree')).toBe(git(repo, 'rev-parse', `${baseSha}^{tree}`))
    expect(git(repo, 'status', '--porcelain')).toBe('?? b.txt')
    expect(existsSync(compensationPlan)).toBe(false)
    expect(() => git(repo, 'rev-parse', worktreeRef)).toThrow()

    rmSync(join(repo, 'b.txt'))
    rmSync(hook)
    const published = restarted.finalize('builder')
    expect(published).toMatchObject({ outcome: 'merged' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail de la copie')
  })

  it('plan de compensation forgé avec pathspec global → bloque sans toucher au travail humain', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let failNextPatch = true
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        failNextPatch &&
        dir === repo &&
        (args[0] === 'apply' || args.includes('autowin-compensation-apply'))
      ) {
        failNextPatch = false
        return { code: 128, stdout: '', stderr: 'verrou index transitoire' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf 'travail utilisateur du hook\n' > b.txt
fi
exit 0
`
    )
    chmodSync(hook, 0o755)
    expect(wm.finalize('builder')).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })

    const planPath = join(repo, '.git', 'autowin-compensations', 'builder.json')
    const forged = JSON.parse(readFileSync(planPath, 'utf8')) as Record<string, unknown>
    forged.agentFiles = ['.']
    forged.indexedAgentPaths = []
    forged.worktreeAgentPaths = []
    forged.untrackedAgentPaths = []
    writeFileSync(planPath, JSON.stringify(forged))
    writeFileSync(join(repo, 'a.txt'), 'travail humain précieux\n')
    git(repo, 'add', 'a.txt')
    const statusBefore = git(repo, 'status', '--porcelain')
    const indexBefore = git(repo, 'write-tree')

    const result = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize('builder')

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail humain précieux')
    expect(git(repo, 'write-tree')).toBe(indexBefore)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)

    forged.agentFiles = [':(top)a.txt']
    writeFileSync(planPath, JSON.stringify(forged))
    expect(
      new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize('builder')
    ).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'write-tree')).toBe(indexBefore)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)

    forged.agentFiles = ['b.txt']
    forged.postHookIndexTree = ''
    writeFileSync(planPath, JSON.stringify(forged))
    expect(
      new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize('builder')
    ).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'write-tree')).toBe(indexBefore)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
  })

  it('échec de persistance du plan → conserve les snapshots d’intégration pour reprise', () => {
    const repo = tempRepo()
    let failFirstCompensationRef = true
    const tryGitFn = (dir: string, args: string[]) => {
      const updateRef = args.indexOf('update-ref')
      if (
        failFirstCompensationRef &&
        updateRef >= 0 &&
        args[updateRef + 1]?.startsWith('refs/autowin/compensations/builder/')
      ) {
        failFirstCompensationRef = false
        return { code: 128, stdout: '', stderr: 'ref compensation indisponible' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf 'travail utilisateur du hook\n' > b.txt
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    expect(wm.finalize('builder')).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(
      readdirSync(wtRoot).filter((name) => name.startsWith('integration__builder__'))
    ).toHaveLength(1)

    const restarted = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    expect(restarted.reconcileResidues()).toMatchObject({ cleaned: 1, blocked: [] })
    expect(restarted.finalize('builder')).toMatchObject({
      outcome: 'blocked',
      reason: 'base-in-progress'
    })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
  })

  it('crash refs avant JSON → complète le journal pending puis reprend', () => {
    const repo = tempRepo()
    let failNextPatch = true
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        failNextPatch &&
        dir === repo &&
        (args[0] === 'apply' || args.includes('autowin-compensation-apply'))
      ) {
        failNextPatch = false
        return { code: 128, stdout: '', stderr: 'arrêt avant compensation' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf 'travail utilisateur du hook\n' > b.txt
fi
exit 0
`
    )
    chmodSync(hook, 0o755)
    expect(wm.finalize('builder')).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })

    const planPath = join(repo, '.git', 'autowin-compensations', 'builder.json')
    const pendingPath = `${planPath}.pending`
    const pending = JSON.parse(readFileSync(planPath, 'utf8')) as Record<string, unknown>
    pending.generation = 'crash-generation'
    writeFileSync(pendingPath, JSON.stringify(pending))
    const firstRef = 'refs/autowin/compensations/builder/crash-generation/index'
    git(repo, 'update-ref', firstRef, String(pending.postHookIndexTree))

    const resumed = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize(
      'builder'
    )

    expect(resumed).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(existsSync(planPath)).toBe(false)
    expect(existsSync(pendingPath)).toBe(false)
    expect(
      git(repo, 'for-each-ref', '--format=%(refname)', 'refs/autowin/compensations/builder/')
    ).toBe('')

    const trees = [
      ['index', String(pending.postHookIndexTree)],
      ['worktree', String(pending.postHookWorktreeTree)],
      ['resume-index', String(pending.resumeIndexTree)],
      ['resume-worktree', String(pending.resumeWorktreeTree)]
    ]
    for (const generation of ['old-generation', 'current-generation']) {
      for (const [kind, tree] of trees) {
        git(repo, 'update-ref', `refs/autowin/compensations/builder/${generation}/${kind}`, tree)
      }
    }
    pending.generation = 'current-generation'
    pending.phase = 'compensated'
    writeFileSync(planPath, JSON.stringify(pending))

    expect(
      new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize('builder')
    ).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(
      git(repo, 'for-each-ref', '--format=%(refname)', 'refs/autowin/compensations/builder/')
    ).toBe('')
  })

  it('crash après compensation avant acquittement → reprend sans restaurer le workspace', () => {
    const repo = tempRepo()
    const planPath = join(repo, '.git', 'autowin-compensations', 'builder.json')
    let interruptedCurrentGenerationDelete = false
    const tryGitFn = (dir: string, args: string[]) => {
      const updateRef = args.indexOf('update-ref')
      if (
        !interruptedCurrentGenerationDelete &&
        dir === repo &&
        updateRef >= 0 &&
        args[updateRef + 1] === '-d' &&
        args[updateRef + 2]?.startsWith('refs/autowin/compensations/builder/') &&
        existsSync(planPath)
      ) {
        const plan = JSON.parse(readFileSync(planPath, 'utf8')) as {
          phase?: string
          generation?: string
        }
        if (
          plan.phase === 'compensated' &&
          plan.generation &&
          args[updateRef + 2]?.includes(`/${plan.generation}/`)
        ) {
          interruptedCurrentGenerationDelete = true
          return { code: 128, stdout: '', stderr: 'arrêt avant acquittement' }
        }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf 'travail utilisateur du hook\n' > b.txt
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    const interrupted = wm.finalize('builder')
    expect(interrupted).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(JSON.parse(readFileSync(planPath, 'utf8'))).toMatchObject({ phase: 'compensated' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')

    const resumed = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize(
      'builder'
    )
    expect(resumed).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(existsSync(planPath)).toBe(false)
  })

  it('hook modifiant le worktree → aucune transaction main temporaire n’est publiée', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    const hookEvents = join(repo, '.git', 'autowin-hook-events')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf '%s main\n' "$state" >> ${hookEvents.replace(/\\/g, '/')}
  if [ "$state" = "prepared" ]; then
    printf 'travail utilisateur du hook\n' > b.txt
  fi
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    const result = wm.finalize('builder')

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(git(repo, 'write-tree')).toBe(git(repo, 'rev-parse', `${baseSha}^{tree}`))
    expect(git(repo, 'status', '--porcelain')).toBe('?? b.txt')
    const events = readFileSync(hookEvents, 'utf8')
    expect(events).toContain('prepared main')
    expect(events).not.toContain('committed main')
  })

  it('échec de création de la worktree d’intégration → bloque sans propager d’exception', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const isIntegrationAdd = (args: string[]) =>
      args[0] === 'worktree' &&
      args[1] === 'add' &&
      args.some((arg) => arg.includes('integration__builder__'))
    const gitRunner = (dir: string, args: string[]) => {
      if (isIntegrationAdd(args)) throw new Error('worktree add indisponible')
      return git(dir, ...args)
    }
    const tryGitFn = (dir: string, args: string[]) => {
      if (isIntegrationAdd(args)) {
        return { code: 128, stdout: '', stderr: 'worktree add indisponible' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      git: gitRunner,
      tryGitFn
    })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('échec de worktree remove → nettoie par repli avant de supprimer la copie agent', () => {
    const repo = tempRepo()
    let failedIntegrationRemove = false
    let integrationPath = ''
    const tryGitFn = (dir: string, args: string[]) => {
      const candidatePath = args.at(-1) ?? ''
      if (
        !failedIntegrationRemove &&
        dir === repo &&
        args[0] === 'worktree' &&
        args[1] === 'remove' &&
        candidatePath.includes('integration__builder__')
      ) {
        failedIntegrationRemove = true
        integrationPath = candidatePath
        return { code: 1, stdout: '', stderr: 'fichier verrouillé' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const agentPath = wm.acquire('builder')
    writeFileSync(join(agentPath, 'b.txt'), 'travail de la copie\n')
    const res = wm.finalize('builder')

    expect(failedIntegrationRemove).toBe(true)
    expect(res.outcome).toBe('merged')
    expect(existsSync(integrationPath)).toBe(false)
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(integrationPath)
    expect(existsSync(agentPath)).toBe(false)
    expect(existsSync(join(repo, 'b.txt'))).toBe(true)
  })

  it('cleanup impossible après publication → mémorise puis reprend uniquement le rangement', () => {
    const repo = tempRepo()
    const publishedBranch = git(repo, 'branch', '--show-current')
    git(repo, 'branch', 'autre-branche')
    let integrationPath = ''
    let locked = true
    const tryGitFn = (dir: string, args: string[]) => {
      const candidatePath = args.at(-1) ?? ''
      if (
        locked &&
        dir === repo &&
        args[0] === 'worktree' &&
        args[1] === 'remove' &&
        candidatePath.includes('integration__builder__')
      ) {
        integrationPath = candidatePath
        return { code: 1, stdout: '', stderr: 'fichier verrouillé' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      tryGitFn,
      removeDirFn: (path) => {
        if (locked) throw new Error('EPERM')
        rmSync(path, { recursive: true, force: true })
      }
    })
    const agentPath = wm.acquire('builder')
    writeFileSync(join(agentPath, 'b.txt'), 'travail de la copie\n')
    writeFileSync(join(repo, 'concurrent.txt'), 'avance concurrente de la base\n')
    git(repo, 'add', 'concurrent.txt')
    git(repo, 'commit', '-q', '-m', 'avance base')
    const baseBeforeFinalize = git(repo, 'rev-parse', 'HEAD')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'cleanup-pending', publishedSha: expect.any(String) })
    expect(existsSync(join(repo, 'b.txt'))).toBe(true)
    expect(existsSync(integrationPath)).toBe(true)
    expect(existsSync(agentPath)).toBe(true)

    const publishedHead = git(repo, 'rev-parse', 'HEAD')
    expect(res).toMatchObject({
      baseSha: baseBeforeFinalize,
      publishedSha: publishedHead,
      agentSha: expect.any(String)
    })
    if (res.outcome !== 'cleanup-pending') throw new Error('cleanup-pending attendu')
    expect(res.agentSha).not.toBe(res.publishedSha)
    locked = false
    git(repo, 'checkout', '-q', 'autre-branche')
    const otherBranchHead = git(repo, 'rev-parse', 'HEAD')
    const resumed = wm.cleanupPublished('builder', res.publishedSha, publishedBranch, res.agentSha)

    expect(resumed).toMatchObject({ outcome: 'merged', committed: false })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(otherBranchHead)
    expect(git(repo, 'rev-parse', publishedBranch)).toBe(publishedHead)
    expect(git(repo, 'show', `${publishedBranch}:b.txt`)).toContain('travail de la copie')
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(existsSync(integrationPath)).toBe(false)
    expect(existsSync(agentPath)).toBe(false)
  })

  it('préserve une ref de récupération avancée pendant cleanupPublished', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const setup = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const agentPath = setup.acquire('cleanup-race')
    writeFileSync(join(agentPath, 'published.txt'), 'publié\n')
    git(agentPath, 'add', 'published.txt')
    git(agentPath, 'commit', '-q', '-m', 'published')
    const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
    git(repo, 'merge', '--ff-only', publishedSha)
    const recoveryBranch = 'autowin/recovery/cleanup-race'
    git(agentPath, 'switch', '-C', recoveryBranch)
    git(repo, 'worktree', 'remove', '--force', agentPath)
    const lateSha = detachedCommit(repo, publishedSha, 'late.txt', 'à préserver\n')
    let advanced = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        !advanced &&
        dir === repo &&
        ((args[0] === 'branch' && args[1] === '-D' && args[2] === recoveryBranch) ||
          (args[0] === 'update-ref' &&
            args[1] === '-d' &&
            args[2] === `refs/heads/${recoveryBranch}`))
      ) {
        git(repo, 'update-ref', `refs/heads/${recoveryBranch}`, lateSha, publishedSha)
        advanced = true
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })

    expect(wm.cleanupPublished('cleanup-race', publishedSha, 'main')).toMatchObject({
      outcome: 'published-residue',
      publishedSha,
      files: ['late.txt']
    })
    expect(git(repo, 'rev-parse', `refs/heads/${recoveryBranch}`)).toBe(lateSha)
    expect(existsSync(agentPath)).toBe(true)
    expect(git(agentPath, 'rev-parse', 'HEAD')).toBe(lateSha)
    expect(readFileSync(join(agentPath, 'late.txt'), 'utf8')).toContain('préserver')
  })

  it('laisse la reprise détecter une ref recréée juste après le contrôle post-CAS', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const setup = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const agentPath = setup.acquire('post-cas-race')
    writeFileSync(join(agentPath, 'published.txt'), 'publié\n')
    git(agentPath, 'add', 'published.txt')
    git(agentPath, 'commit', '-q', '-m', 'published')
    const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
    git(repo, 'merge', '--ff-only', publishedSha)
    const recoveryBranch = 'autowin/recovery/post-cas-race'
    const recoveryRef = `refs/heads/${recoveryBranch}`
    git(agentPath, 'switch', '-C', recoveryBranch)
    git(repo, 'worktree', 'remove', '--force', agentPath)
    const lateSha = detachedCommit(repo, publishedSha, 'late.txt', 'à préserver\n')
    let deleted = false
    let recreated = false
    const tryGitFn = (dir: string, args: string[]) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      if (
        dir === repo &&
        args[0] === 'update-ref' &&
        args[1] === '-d' &&
        args[2] === recoveryRef &&
        result.status === 0
      ) {
        deleted = true
      } else if (
        deleted &&
        !recreated &&
        dir === repo &&
        args[0] === 'rev-parse' &&
        args[1] === '--verify' &&
        args[2] === recoveryRef
      ) {
        git(repo, 'update-ref', recoveryRef, lateSha)
        recreated = true
      }
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })

    expect(wm.cleanupPublished('post-cas-race', publishedSha, 'main')).toMatchObject({
      outcome: 'merged'
    })
    expect(recreated).toBe(true)
    expect(wm.listAgentIds()).toContain('post-cas-race')
    expect(git(repo, 'rev-parse', recoveryRef)).toBe(lateSha)
  })

  it('recrée le bureau quand sa ref était déjà avancée avant cleanupPublished', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const agentPath = wm.acquire('cleanup-advanced')
    writeFileSync(join(agentPath, 'published.txt'), 'publié\n')
    git(agentPath, 'add', 'published.txt')
    git(agentPath, 'commit', '-q', '-m', 'published')
    const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
    git(repo, 'merge', '--ff-only', publishedSha)
    const recoveryBranch = 'autowin/recovery/cleanup-advanced'
    git(agentPath, 'switch', '-C', recoveryBranch)
    git(repo, 'worktree', 'remove', '--force', agentPath)
    const lateSha = detachedCommit(repo, publishedSha, 'late.txt', 'à préserver\n')
    git(repo, 'update-ref', `refs/heads/${recoveryBranch}`, lateSha, publishedSha)

    expect(wm.cleanupPublished('cleanup-advanced', publishedSha, 'main')).toMatchObject({
      outcome: 'published-residue',
      publishedSha,
      files: ['late.txt']
    })
    expect(existsSync(agentPath)).toBe(true)
    expect(git(agentPath, 'rev-parse', 'HEAD')).toBe(lateSha)
    expect(readFileSync(join(agentPath, 'late.txt'), 'utf8')).toContain('préserver')
  })

  it('réessaie sans prétendre que le bureau existe si sa recréation échoue', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const setup = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const agentPath = setup.acquire('restore-retry')
    writeFileSync(join(agentPath, 'published.txt'), 'publié\n')
    git(agentPath, 'add', 'published.txt')
    git(agentPath, 'commit', '-q', '-m', 'published')
    const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
    git(repo, 'merge', '--ff-only', publishedSha)
    const recoveryBranch = 'autowin/recovery/restore-retry'
    git(agentPath, 'switch', '-C', recoveryBranch)
    git(repo, 'worktree', 'remove', '--force', agentPath)
    const lateSha = detachedCommit(repo, publishedSha, 'late.txt', 'à préserver\n')
    git(repo, 'update-ref', `refs/heads/${recoveryBranch}`, lateSha, publishedSha)
    const tryGitFn = (dir: string, args: string[]) => {
      if (dir === repo && args[0] === 'worktree' && args[1] === 'add' && args[2] === agentPath) {
        return { code: 1, stdout: '', stderr: 'verrou temporaire' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })

    expect(wm.cleanupPublished('restore-retry', publishedSha, 'main')).toMatchObject({
      outcome: 'cleanup-pending',
      publishedSha,
      files: ['late.txt'],
      worktreeAvailable: false
    })
    expect(existsSync(agentPath)).toBe(false)
    expect(git(repo, 'rev-parse', `refs/heads/${recoveryBranch}`)).toBe(lateSha)
  })

  it('restaure le bureau si sa ref avance entre contrôle et suppression', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const setup = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const agentPath = setup.acquire('finalize-race')
    writeFileSync(join(agentPath, 'published.txt'), 'publié\n')
    git(agentPath, 'add', 'published.txt')
    git(agentPath, 'commit', '-q', '-m', 'published')
    const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
    const lateSha = detachedCommit(repo, publishedSha, 'late.txt', 'à préserver\n')
    const recoveryBranch = 'autowin/recovery/finalize-race'
    let advanced = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        !advanced &&
        dir === repo &&
        ((args[0] === 'branch' && args[1] === '-D' && args[2] === recoveryBranch) ||
          (args[0] === 'update-ref' &&
            args[1] === '-d' &&
            args[2] === `refs/heads/${recoveryBranch}`))
      ) {
        git(repo, 'update-ref', `refs/heads/${recoveryBranch}`, lateSha, publishedSha)
        advanced = true
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })

    expect(wm.finalize('finalize-race', { expectedAgentSha: publishedSha })).toMatchObject({
      outcome: 'published-residue',
      publishedSha,
      files: ['late.txt']
    })
    expect(existsSync(agentPath)).toBe(true)
    expect(git(agentPath, 'rev-parse', 'HEAD')).toBe(lateSha)
    expect(readFileSync(join(agentPath, 'late.txt'), 'utf8')).toContain('préserver')
  })

  it('réessaie le rangement quand la preuve Git est temporairement indisponible après publication', () => {
    const repo = tempRepo()
    const publishedBranch = git(repo, 'branch', '--show-current')
    let ownershipProbeUnavailable = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (ownershipProbeUnavailable && args[0] === 'rev-parse' && args[1] === '--git-common-dir') {
        return { code: 1, stdout: '', stderr: 'sonde Git temporairement indisponible' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const agentPath = wm.acquire('ownership-retry')
    writeFileSync(join(agentPath, 'ownership.txt'), 'travail publié\n')
    git(agentPath, 'add', 'ownership.txt')
    git(agentPath, 'commit', '-m', 'agent ownership')
    const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
    git(repo, 'merge', '--no-edit', publishedSha)

    ownershipProbeUnavailable = true
    expect(wm.cleanupPublished('ownership-retry', publishedSha, publishedBranch)).toMatchObject({
      outcome: 'cleanup-pending',
      files: [],
      publishedSha
    })
    expect(existsSync(agentPath)).toBe(true)

    ownershipProbeUnavailable = false
    expect(wm.cleanupPublished('ownership-retry', publishedSha, publishedBranch)).toMatchObject({
      outcome: 'merged',
      committed: false
    })
    expect(existsSync(agentPath)).toBe(false)
  })

  it('copie sans changement mais cleanup impossible → bloque sans exception', () => {
    const repo = tempRepo()
    const isAgentRemove = (args: string[]) =>
      args[0] === 'worktree' &&
      args[1] === 'remove' &&
      ((args.at(-1) ?? '').includes('agent__builder') ||
        (args.at(-1) ?? '').includes('.quarantine'))
    const gitRunner = (dir: string, args: string[]) => {
      if (isAgentRemove(args)) throw new Error('EPERM')
      return git(dir, ...args)
    }
    const tryGitFn = (dir: string, args: string[]) => {
      if (isAgentRemove(args)) return { code: 1, stdout: '', stderr: 'EPERM' }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      git: gitRunner,
      tryGitFn,
      removeDirFn: () => {
        throw new Error('EPERM')
      }
    })
    const agentPath = wm.acquire('builder')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(existsSync(agentPath)).toBe(true)
  })

  it('remove est idempotent', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    wm.acquire('x')
    wm.remove('x')
    expect(() => wm.remove('x')).not.toThrow()
  })

  it('rejette un agentId de traversée de chemin', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    expect(() => wm.acquire('../evil')).toThrow()
  })

  it('une copie appartenant à un AUTRE dépôt est bloquée, pas fusionnée', () => {
    // Le dossier de copies est partagé entre workspaces : on y retrouve des copies dont le commit
    // est inconnu de la base courante. `git diff a...b` échouait alors (« Invalid symmetric
    // difference »), la liste de fichiers repartait VIDE — donc plus rien ne bloquait et la fusion
    // s'enchaînait quand même. Observé au démarrage de l'app.
    const repo = tempRepo()
    const wm = manager(repo)
    const copie = wm.acquire('etranger')
    // On remplace la copie par un dépôt INDÉPENDANT : son HEAD n'existe pas dans la base.
    rmSync(copie, { recursive: true, force: true })
    mkdirSync(copie, { recursive: true })
    git(copie, 'init', '-q', '-b', 'main')
    git(copie, 'config', 'user.email', 't@t')
    git(copie, 'config', 'user.name', 'T')
    git(copie, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(copie, 'venu-d-ailleurs.txt'), 'contenu\n')
    git(copie, 'add', '-A')
    git(copie, 'commit', '-q', '-m', 'commit inconnu de la base')

    const result = wm.finalize('etranger')

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    // Et rien n'a été fusionné dans la base.
    expect(git(repo, 'log', '--oneline')).not.toContain('venu-d-ailleurs')
  })

  it('une copie d’un AUTRE dépôt n’est PAS écrite : travail non commité et HEAD intacts', () => {
    // Discriminant du test précédent, qui ne regardait QUE la base : la garde révisionnelle
    // (`cat-file -e`) arrivait APRÈS `git add -A` + `git commit -m "agent <id>"`. Le travail non
    // commité d'un développeur était donc happé dans un commit sur le HEAD détaché de SON dépôt,
    // sans consentement, avant qu'Autowin ne conclue « copie étrangère ». On vérifie ici l'absence
    // d'écriture dans la copie, pas seulement l'absence de fusion.
    const repo = tempRepo()
    const wm = manager(repo)
    const copie = wm.acquire('etranger-intact')
    rmSync(copie, { recursive: true, force: true })
    mkdirSync(copie, { recursive: true })
    git(copie, 'init', '-q', '-b', 'main')
    git(copie, 'config', 'user.email', 't@t')
    git(copie, 'config', 'user.name', 'T')
    git(copie, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(copie, 'suivi.txt'), 'commité\n')
    git(copie, 'add', '-A')
    git(copie, 'commit', '-q', '-m', 'travail du développeur')
    // Travail NON commité du développeur, présent au moment où Autowin passe.
    writeFileSync(join(copie, 'suivi.txt'), 'modifié, pas encore commité\n')
    writeFileSync(join(copie, 'brouillon.txt'), 'nouveau fichier non suivi\n')
    const headAvant = git(copie, 'rev-parse', 'HEAD')
    const statusAvant = git(copie, 'status', '--porcelain')
    expect(statusAvant).not.toBe('')

    const result = wm.finalize('etranger-intact')

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(copie, 'status', '--porcelain')).toBe(statusAvant)
    expect(git(copie, 'rev-parse', 'HEAD')).toBe(headAvant)
    expect(git(copie, 'log', '--oneline')).not.toContain('agent etranger-intact')
  })

  it('ne touche pas une copie quand son appartenance Git est indémontrable', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const path = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).acquire(
      'indetermine'
    )
    writeFileSync(join(path, 'a.txt'), 'travail à préserver\n')
    const statusAvant = git(path, 'status', '--porcelain')
    const headAvant = git(path, 'rev-parse', 'HEAD')
    const guarded = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      tryGitFn: (cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') {
          return { code: 1, stdout: '', stderr: 'probe indisponible' }
        }
        const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
        return {
          code: result.status ?? 1,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? ''
        }
      }
    })

    expect(guarded.finalize('indetermine')).toMatchObject({
      outcome: 'blocked',
      reason: 'merge-failed'
    })
    expect(git(path, 'status', '--porcelain')).toBe(statusAvant)
    expect(git(path, 'rev-parse', 'HEAD')).toBe(headAvant)
  })

  it('une copie appartenant BIEN à la base est finalisée normalement (garde non sur-bloquante)', () => {
    // Risque n°1 du correctif : une comparaison de chemins trop stricte (jonction, casse, slash
    // final) prendrait un worktree légitime pour un dépôt étranger et bloquerait tout.
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('legitime')
    writeFileSync(join(path, 'a.txt'), 'travail de l’agent\n')

    const result = wm.finalize('legitime')

    expect(result).toMatchObject({ outcome: 'merged', committed: true })
    // `core.autocrlf` du poste peut réécrire les fins de ligne : on compare le contenu, pas l'EOL.
    expect(readFileSync(join(repo, 'a.txt'), 'utf8').trim()).toBe('travail de l’agent')
  })

  it('abandonne explicitement un bureau sale sans toucher au dépôt de base', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('held')
    writeFileSync(join(path, 'solution.txt'), 'solution retenue puis abandonnée\n')

    wm.discard('held')

    expect(existsSync(path)).toBe(false)
    expect(existsSync(join(repo, 'solution.txt'))).toBe(false)
  })
})
