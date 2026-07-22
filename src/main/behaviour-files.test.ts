import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { listBehaviourFiles, readBehaviourFile } from './behaviour-files'

vi.mock('./capability-controls', () => ({
  listCapabilities: vi.fn(async (kind: string) =>
    kind === 'skills' ? [{ id: 'always-visible', enabled: true }] : []
  )
}))

type TestOptions = {
  workspaceRoot: string
  contextRoot: string
  homeRoot: string
}

type Instruction = Awaited<ReturnType<typeof listBehaviourFiles>>[number]

const sandboxes: string[] = []

function sandbox(): string {
  const path = mkdtempSync(join(tmpdir(), 'behaviour-files-'))
  sandboxes.push(path)
  return path
}

function put(path: string, contents = path): string {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents, 'utf8')
  return path
}

function options(root: string, context = join(root, 'workspace', 'projectA')): TestOptions {
  return {
    workspaceRoot: join(root, 'workspace'),
    contextRoot: context,
    homeRoot: join(root, 'home')
  }
}

function normalized(path: string): string {
  return path.replaceAll('\\', '/')
}

function select(files: Instruction[], engine: Instruction['engine']): Instruction[] {
  return files.filter((file) => file.engine === engine)
}

afterEach(() => {
  for (const path of sandboxes.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('behaviour instruction map', () => {
  it('resolves the Codex chain global -> workspace -> selected project and keeps siblings conditional', async () => {
    const root = sandbox()
    const opts = options(root)
    const global = put(join(opts.homeRoot, '.codex', 'AGENTS.md'))
    const workspaceBase = put(join(opts.workspaceRoot, 'AGENTS.md'))
    const workspaceOverride = put(join(opts.workspaceRoot, 'AGENTS.override.md'))
    const projectA = put(join(opts.contextRoot, 'AGENTS.md'))
    const projectB = put(join(opts.workspaceRoot, 'projectB', 'AGENTS.md'))
    const projectBOverride = put(join(opts.workspaceRoot, 'projectB', 'AGENTS.override.md'))

    const codex = select(await listBehaviourFiles(opts), 'codex')
    const active = codex.filter((file) => file.state === 'active')

    expect(active.map((file) => normalized(file.path))).toEqual([
      normalized(global),
      normalized(workspaceOverride),
      normalized(projectA)
    ])
    expect(codex.find((file) => file.path === projectBOverride)?.state).toBe('conditional')
    expect(codex.find((file) => file.path === projectB)?.state).toBe('shadowed')
    expect(codex.find((file) => file.path === workspaceBase)?.state).not.toBe('active')
    expect(codex.find((file) => file.path === workspaceOverride)?.reason).toMatch(
      /override|priorit/i
    )

    const selectedProjectB = select(
      await listBehaviourFiles({ ...opts, contextRoot: join(opts.workspaceRoot, 'projectB') }),
      'codex'
    )
    expect(selectedProjectB.find((file) => file.path === projectBOverride)?.state).toBe('active')
    expect(selectedProjectB.find((file) => file.path === projectB)?.state).toBe('shadowed')
  })

  it('resolves Claude user memory and ancestors while a sibling remains conditional', async () => {
    const root = sandbox()
    const opts = options(root)
    const global = put(join(opts.homeRoot, '.claude', 'CLAUDE.md'))
    const workspace = put(join(opts.workspaceRoot, 'CLAUDE.md'))
    const projectA = put(join(opts.contextRoot, 'CLAUDE.local.md'))
    const projectB = put(join(opts.workspaceRoot, 'projectB', 'CLAUDE.md'))

    const claude = select(await listBehaviourFiles(opts), 'claude')

    expect(
      claude.filter((file) => file.state === 'active').map((file) => normalized(file.path))
    ).toEqual([normalized(global), normalized(workspace), normalized(projectA)])
    expect(claude.find((file) => file.path === projectB)?.state).toBe('conditional')
  })

  it('does not leak a manifest between two successive workspaces', async () => {
    const root = sandbox()
    const workspaceA = join(root, 'workspace-a')
    const workspaceB = join(root, 'workspace-b')
    const homeRoot = join(root, 'home')
    const onlyA = put(join(workspaceA, 'AGENTS.md'))
    const onlyB = put(join(workspaceB, 'CLAUDE.md'))

    await listBehaviourFiles({ workspaceRoot: workspaceA, contextRoot: workspaceA, homeRoot })
    const second = await listBehaviourFiles({
      workspaceRoot: workspaceB,
      contextRoot: workspaceB,
      homeRoot
    })

    expect(second.some((file) => file.path === onlyA)).toBe(false)
    expect(second.some((file) => file.path === onlyB)).toBe(true)
  })

  it('excludes dependency, VCS, audit and internal Claude worktree trees', async () => {
    const root = sandbox()
    const opts = options(root, join(root, 'workspace'))
    const visible = put(join(opts.workspaceRoot, 'app', 'AGENTS.md'))
    const excluded = [
      put(join(opts.workspaceRoot, 'node_modules', 'pkg', 'AGENTS.md')),
      put(join(opts.workspaceRoot, '.git', 'nested', 'CLAUDE.md')),
      put(join(opts.workspaceRoot, 'Audit', 'run', 'AGENTS.md')),
      put(join(opts.workspaceRoot, 'aUdIt', 'run', 'CLAUDE.md')),
      put(join(opts.workspaceRoot, 'Node_Modules', 'pkg', 'AGENTS.md')),
      put(join(opts.workspaceRoot, 'PLUGINS', 'internal', 'CLAUDE.md')),
      put(join(opts.workspaceRoot, '.Git', 'nested', 'AGENTS.md')),
      put(join(opts.workspaceRoot, '.claude', 'worktrees', 'branch', 'CLAUDE.md'))
    ]

    const files = await listBehaviourFiles(opts)
    const relativePaths = files.map((file) => normalized(relative(opts.workspaceRoot, file.path)))

    expect(relativePaths).toContain(normalized(relative(opts.workspaceRoot, visible)))
    for (const path of excluded) {
      expect(relativePaths).not.toContain(normalized(relative(opts.workspaceRoot, path)))
    }
  })

  it('keeps every engine anchor (codex, claude, autowin) when discovery exceeds the cap', async () => {
    const root = sandbox()
    const opts = options(root, join(root, 'workspace'))
    put(join(opts.homeRoot, '.codex', 'AGENTS.md'))
    put(join(opts.homeRoot, '.claude', 'CLAUDE.md'))
    put(join(opts.workspaceRoot, 'AGENTS.md'))
    put(join(opts.workspaceRoot, 'CLAUDE.md'))
    for (let index = 0; index < 520; index += 1) {
      put(join(opts.workspaceRoot, `codex-${String(index).padStart(3, '0')}`, 'AGENTS.md'))
    }

    const files = await listBehaviourFiles({
      ...opts,
      localAppDataRoot: join(root, 'local-app-data')
    })

    expect(files.length).toBeLessThanOrEqual(500)
    // Engine natif « autowin » (fichiers d'instruction génériques du contexte) + codex + claude.
    expect(new Set(files.map((file) => file.engine))).toEqual(
      new Set(['codex', 'claude', 'autowin'])
    )
    expect(files.some((file) => file.engine === 'claude' && file.scope === 'global')).toBe(true)
    expect(files.some((file) => file.engine === 'autowin')).toBe(true)
  }, 15_000)

  it('discovers mixed-case instruction names on Windows', async () => {
    const root = sandbox()
    const opts = options(root, join(root, 'workspace'))
    const context = join(opts.workspaceRoot, 'mixed-case')
    const base = put(join(context, 'Agents.md'))
    const override = put(join(context, 'AGENTS.Override.md'))
    const claude = put(join(context, 'claude.local.md'))

    const files = await listBehaviourFiles(opts)
    expect(files.find((file) => file.path === override)?.state).toBe('conditional')
    expect(files.find((file) => file.path === base)?.state).toBe('shadowed')
    expect(files.find((file) => file.path === claude)?.state).toBe('conditional')
  })

  it('falls back to the approved workspace when a context junction targets outside it', async () => {
    const root = sandbox()
    const workspaceRoot = join(root, 'workspace')
    const outside = join(root, 'outside')
    const workspaceFile = put(join(workspaceRoot, 'AGENTS.md'))
    const outsideFile = put(join(outside, 'AGENTS.md'))
    const junction = join(workspaceRoot, 'external-context')
    symlinkSync(outside, junction, 'junction')

    const files = await listBehaviourFiles({
      workspaceRoot,
      contextRoot: junction,
      homeRoot: join(root, 'home')
    })

    expect(files.find((file) => file.path === workspaceFile)?.state).toBe('active')
    expect(files.some((file) => file.path === outsideFile)).toBe(false)
  })

  it('revalidates size at read time and confines an id to its requested workspace', async () => {
    const root = sandbox()
    const workspaceA = join(root, 'workspace-a')
    const workspaceB = join(root, 'workspace-b')
    const homeRoot = join(root, 'home')
    const pathA = put(join(workspaceA, 'AGENTS.md'), 'small')
    const optsA = { workspaceRoot: workspaceA, contextRoot: workspaceA, homeRoot }
    const manifestA = await listBehaviourFiles(optsA)
    const fileA = manifestA.find((file) => file.path === pathA)
    expect(fileA).toBeDefined()

    writeFileSync(pathA, 'x'.repeat(512_001), 'utf8')
    await expect(readBehaviourFile(fileA!.id, optsA)).rejects.toThrow(/volumineux|512/i)

    mkdirSync(workspaceB, { recursive: true })
    await expect(
      readBehaviourFile(fileA!.id, {
        workspaceRoot: workspaceB,
        contextRoot: workspaceB,
        homeRoot
      })
    ).rejects.toThrow(/inconnu|autoris|workspace|racine/i)
  })
})
