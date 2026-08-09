import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureWorkspaceMutationSnapshot,
  captureWorkspacePathGenerationMarker
} from '../providers/workspace-mutation-evidence'
import { appendConversationFileTrace } from './conversation-file-trace-spool'
import { readConversationGitDiff, readConversationGitState } from './conversation-git-state'

const roots: string[] = []

function initRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'autowin-conversation-git-'))
  roots.push(root)
  execFileSync('git', ['init'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@autowin.local'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Autowin Test'], { cwd: root })
  writeFileSync(join(root, 'foo.ts'), 'initial\n', 'utf8')
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: root })
  return root
}

async function trace(
  conversationId: string,
  workspaceRoot: string,
  spoolBase: string
): Promise<void> {
  const fingerprint = (await captureWorkspaceMutationSnapshot(workspaceRoot)).get('foo.ts')
  if (!fingerprint) throw new Error('fingerprint de test absent')
  const generationMarker = await captureWorkspacePathGenerationMarker(workspaceRoot, 'foo.ts')
  appendConversationFileTrace(
    {
      timestamp: new Date().toISOString(),
      conversationId,
      workspaceRoot,
      source: 'subagent',
      paths: ['foo.ts'],
      pathFingerprints: { 'foo.ts': fingerprint },
      pathGenerationMarkers: { 'foo.ts': generationMarker }
    },
    spoolBase
  )
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('conversation Git state', () => {
  it('ne ressuscite pas A quand B remodifie le même fichier', async () => {
    const repo = initRepo()
    const spool = mkdtempSync(join(tmpdir(), 'autowin-conversation-spool-'))
    roots.push(spool)
    writeFileSync(join(repo, 'foo.ts'), 'modifié par A\n', 'utf8')
    await trace('conv-a', repo, spool)
    execFileSync('git', ['restore', '--', 'foo.ts'], { cwd: repo })
    writeFileSync(join(repo, 'foo.ts'), 'modifié par B\n', 'utf8')
    await trace('conv-b', repo, spool)

    expect((await readConversationGitState('conv-a', repo, spool)).state?.changes).toEqual([])
    expect((await readConversationGitState('conv-b', repo, spool)).state?.changes).toEqual([
      expect.objectContaining({ path: 'foo.ts' })
    ])
    expect((await readConversationGitDiff('conv-a', 'foo.ts', repo, spool)).available).toBe(false)
    const diffB = await readConversationGitDiff('conv-b', 'foo.ts', repo, spool)
    expect(diffB.available, diffB.error).toBe(true)
    expect(diffB.diff).toContain('modifié par B')
  })

  it('lit le diff encore présent dans le vrai worktree du sous-agent', async () => {
    const repo = initRepo()
    const spool = mkdtempSync(join(tmpdir(), 'autowin-worktree-spool-'))
    roots.push(spool)
    const worktree = `${repo}-agent`
    roots.push(worktree)
    execFileSync('git', ['worktree', 'add', '-b', 'agent-test', worktree], { cwd: repo })
    writeFileSync(join(worktree, 'foo.ts'), 'modifié dans le worktree\n', 'utf8')
    await trace('conv-agent', worktree, spool)

    const state = await readConversationGitState('conv-agent', repo, spool)
    expect(state.state?.changes).toEqual([
      expect.objectContaining({
        path: 'foo.ts',
        workspaceRoot: expect.stringContaining('autowin-conversation-git-')
      })
    ])
    const worktreeDiff = await readConversationGitDiff(
      'conv-agent',
      'foo.ts',
      worktree,
      spool
    )
    expect(worktreeDiff.available, worktreeDiff.error).toBe(true)
    expect(worktreeDiff.diff).toContain('modifié dans le worktree')
  })

  it('conserve le fichier attribué pendant git add puis restore --staged', async () => {
    const repo = initRepo()
    const spool = mkdtempSync(join(tmpdir(), 'autowin-stage-spool-'))
    roots.push(spool)
    writeFileSync(join(repo, 'foo.ts'), 'modifié puis staged\n', 'utf8')
    await trace('conv-stage', repo, spool)

    execFileSync('git', ['add', '--', 'foo.ts'], { cwd: repo })
    expect((await readConversationGitState('conv-stage', repo, spool)).state?.changes).toEqual([
      expect.objectContaining({ path: 'foo.ts', staged: true })
    ])

    execFileSync('git', ['restore', '--staged', '--', 'foo.ts'], { cwd: repo })
    expect((await readConversationGitState('conv-stage', repo, spool)).state?.changes).toEqual([
      expect.objectContaining({ path: 'foo.ts', staged: false })
    ])
  })

  it('conserve A et B dans une même génération causale suivie', async () => {
    const repo = initRepo()
    const spool = mkdtempSync(join(tmpdir(), 'autowin-chain-spool-'))
    roots.push(spool)
    writeFileSync(join(repo, 'foo.ts'), 'modifié par A\n', 'utf8')
    const fingerprintA = (await captureWorkspaceMutationSnapshot(repo)).get('foo.ts')
    if (!fingerprintA) throw new Error('empreinte A absente')
    const generationA = await captureWorkspacePathGenerationMarker(repo, 'foo.ts')
    appendConversationFileTrace(
      {
        timestamp: new Date().toISOString(),
        conversationId: 'conv-a',
        workspaceRoot: repo,
        source: 'edit_file',
        paths: ['foo.ts'],
        pathFingerprints: { 'foo.ts': fingerprintA },
        pathBaseFingerprints: { 'foo.ts': null },
        pathBaseGenerationMarkers: { 'foo.ts': null },
        pathGenerationMarkers: { 'foo.ts': generationA }
      },
      spool
    )
    writeFileSync(join(repo, 'foo.ts'), 'modifié par A\najouté par B\n', 'utf8')
    const fingerprintAB = (await captureWorkspaceMutationSnapshot(repo)).get('foo.ts')
    if (!fingerprintAB) throw new Error('empreinte A+B absente')
    const generationAB = await captureWorkspacePathGenerationMarker(repo, 'foo.ts')
    appendConversationFileTrace(
      {
        timestamp: new Date().toISOString(),
        conversationId: 'conv-b',
        workspaceRoot: repo,
        source: 'edit_file',
        paths: ['foo.ts'],
        pathFingerprints: { 'foo.ts': fingerprintAB },
        pathBaseFingerprints: { 'foo.ts': fingerprintA },
        pathBaseGenerationMarkers: { 'foo.ts': generationA },
        pathGenerationMarkers: { 'foo.ts': generationAB }
      },
      spool
    )

    expect((await readConversationGitState('conv-a', repo, spool)).state?.changes).toHaveLength(1)
    expect((await readConversationGitState('conv-b', repo, spool)).state?.changes).toHaveLength(1)
  })

  it('n attribue pas à A une réécriture externe identique après restauration', async () => {
    const repo = initRepo()
    const spool = mkdtempSync(join(tmpdir(), 'autowin-aba-spool-'))
    roots.push(spool)
    writeFileSync(join(repo, 'foo.ts'), 'état X\n', 'utf8')
    await trace('conv-a', repo, spool)
    expect((await readConversationGitState('conv-a', repo, spool)).state?.changes).toHaveLength(1)

    execFileSync('git', ['restore', '--', 'foo.ts'], { cwd: repo })
    writeFileSync(join(repo, 'foo.ts'), 'état X\n', 'utf8')

    expect((await readConversationGitState('conv-a', repo, spool)).state?.changes).toEqual([])
    expect((await readConversationGitDiff('conv-a', 'foo.ts', repo, spool)).available).toBe(false)

    const externalBase = await captureWorkspaceMutationSnapshot(repo)
    writeFileSync(join(repo, 'foo.ts'), 'état Y par B\n', 'utf8')
    const fingerprintB = (await captureWorkspaceMutationSnapshot(repo)).get('foo.ts')
    const generationB = await captureWorkspacePathGenerationMarker(repo, 'foo.ts')
    if (!fingerprintB) throw new Error('empreinte B absente')
    appendConversationFileTrace(
      {
        timestamp: new Date().toISOString(),
        conversationId: 'conv-b',
        workspaceRoot: repo,
        source: 'edit_file',
        paths: ['foo.ts'],
        pathFingerprints: { 'foo.ts': fingerprintB },
        pathBaseFingerprints: { 'foo.ts': externalBase.get('foo.ts') ?? null },
        pathGenerationMarkers: { 'foo.ts': generationB },
        pathBaseGenerationMarkers: {
          'foo.ts': externalBase.generationMarkers.get('foo.ts') ?? null
        }
      },
      spool
    )

    expect((await readConversationGitState('conv-a', repo, spool)).state?.changes).toEqual([])
    expect((await readConversationGitState('conv-b', repo, spool)).state?.changes).toEqual([
      expect.objectContaining({ path: 'foo.ts' })
    ])
  })

  it('garde une suppression malgré une mutation voisine puis invalide son propre ABA', async () => {
    const repo = initRepo()
    const spool = mkdtempSync(join(tmpdir(), 'autowin-delete-generation-spool-'))
    roots.push(spool)
    mkdirSync(join(repo, 'dir'))
    writeFileSync(join(repo, 'dir', 'foo.ts'), 'foo\n', 'utf8')
    writeFileSync(join(repo, 'dir', 'bar.ts'), 'bar\n', 'utf8')
    execFileSync('git', ['add', '.'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'add directory'], { cwd: repo })

    rmSync(join(repo, 'dir', 'foo.ts'))
    const deleted = await captureWorkspaceMutationSnapshot(repo)
    const deletedFingerprint = deleted.get('dir/foo.ts')
    const deletedGeneration = deleted.generationMarkers.get('dir/foo.ts')
    if (!deletedFingerprint || !deletedGeneration) throw new Error('suppression non observée')
    appendConversationFileTrace(
      {
        timestamp: new Date().toISOString(),
        conversationId: 'conv-delete',
        workspaceRoot: repo,
        source: 'edit_file',
        paths: ['dir/foo.ts'],
        pathFingerprints: { 'dir/foo.ts': deletedFingerprint },
        pathBaseFingerprints: { 'dir/foo.ts': null },
        pathGenerationMarkers: { 'dir/foo.ts': deletedGeneration },
        pathBaseGenerationMarkers: { 'dir/foo.ts': null }
      },
      spool
    )

    renameSync(join(repo, 'dir', 'bar.ts'), join(repo, 'dir', 'bar-renamed.ts'))
    expect(
      (await readConversationGitState('conv-delete', repo, spool)).state?.changes
    ).toEqual([expect.objectContaining({ path: 'dir/foo.ts', status: 'deleted' })])

    execFileSync('git', ['restore', '--', 'dir/foo.ts'], { cwd: repo })
    rmSync(join(repo, 'dir', 'foo.ts'))
    expect((await readConversationGitState('conv-delete', repo, spool)).state?.changes).toEqual([])
  })

  it('rend une suppression non attribuable après une lacune entre deux processus', () => {
    const repo = initRepo()
    const spool = mkdtempSync(join(tmpdir(), 'autowin-delete-restart-spool-'))
    const appData = mkdtempSync(join(tmpdir(), 'autowin-delete-restart-appdata-'))
    roots.push(spool, appData)
    mkdirSync(join(repo, 'dir'))
    writeFileSync(join(repo, 'dir', 'foo.ts'), 'foo\n', 'utf8')
    execFileSync('git', ['add', '.'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'add deleted file'], { cwd: repo })
    rmSync(join(repo, 'dir', 'foo.ts'))
    const tsxCli = createRequire(import.meta.url).resolve('tsx/cli')
    const probe = join(process.cwd(), 'scripts', 'conversation-delete-restart-probe.ts')
    const env = { ...process.env, APPDATA: appData }

    const firstProcess = JSON.parse(
      execFileSync(process.execPath, [tsxCli, probe, 'trace', repo, spool], {
        env,
        encoding: 'utf8'
      })
    ) as { generationMarker: string }
    const secondProcess = JSON.parse(
      execFileSync(process.execPath, [tsxCli, probe, 'verify', repo, spool], {
        env,
        encoding: 'utf8'
      })
    ) as { before: string[]; after: string[] }

    expect(firstProcess.generationMarker).toMatch(/^missing:[0-9a-f-]+:0$/)
    expect(secondProcess).toEqual({ before: [], after: [] })
  })
})
