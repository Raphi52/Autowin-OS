import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  executeGraphifyProcess,
  GRAPHIFY_REQUIREMENTS_SHA256,
  GRAPHIFY_WHEEL_SHA256,
  resolveGraphifyExecutable,
  resolveGraphifyLaunch,
  runGraphify,
  type GraphifyProcessRunner
} from './graphify-command'

const temporaryRoots: string[] = []

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'autowin-graphify-'))
  temporaryRoots.push(root)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'index.ts'), 'export const value = 1\n', 'utf8')
  return root
}

function writeGraph(target: string, nodes: number, links: number): void {
  const output = join(target, 'graphify-out')
  mkdirSync(output, { recursive: true })
  writeFileSync(
    join(output, 'graph.json'),
    JSON.stringify({
      directed: true,
      multigraph: true,
      nodes: Array.from({ length: nodes }, (_, id) => ({ id })),
      links: Array.from({ length: links }, (_, id) => ({ source: id, target: id + 1 })),
      built_at_commit: 'abc123'
    }),
    'utf8'
  )
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('Graphify command runner', () => {
  it('creates a missing graph with local code-only extraction', async () => {
    const root = workspace()
    const calls: Array<{ executable: string; args: string[]; cwd: string }> = []
    const run: GraphifyProcessRunner = async (executable, args, options) => {
      calls.push({ executable, args, cwd: options.cwd })
      writeGraph(root, 2, 1)
      return { stdout: 'done', stderr: '' }
    }

    await expect(runGraphify({ workspaceRoot: root }, { run })).resolves.toMatchObject({
      action: 'created',
      target: '.',
      graph: 'graphify-out/graph.json',
      nodes: 2,
      links: 1,
      builtAtCommit: 'abc123'
    })
    expect(calls).toEqual([
      {
        executable: 'graphify',
        args: ['extract', root, '--code-only', '--no-cluster'],
        cwd: root
      }
    ])
  })

  it('forces Graphify output inside the target instead of inheriting GRAPHIFY_OUT', async () => {
    const root = workspace()
    const outside = mkdtempSync(join(tmpdir(), 'autowin-graphify-outside-'))
    temporaryRoots.push(outside)
    const previous = process.env.GRAPHIFY_OUT
    process.env.GRAPHIFY_OUT = outside
    const run: GraphifyProcessRunner = async (_executable, _args, options) => {
      expect(options.env?.GRAPHIFY_OUT).toBe('graphify-out')
      writeGraph(options.cwd, 2, 1)
      return { stdout: '', stderr: '' }
    }
    try {
      await expect(runGraphify({ workspaceRoot: root }, { run })).resolves.toMatchObject({
        graph: 'graphify-out/graph.json',
        nodes: 2,
        links: 1
      })
      expect(existsSync(join(outside, 'graph.json'))).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.GRAPHIFY_OUT
      else process.env.GRAPHIFY_OUT = previous
    }
  })

  it('updates an existing graph for a workspace subdirectory', async () => {
    const root = workspace()
    const target = join(root, 'packages', 'api')
    mkdirSync(target, { recursive: true })
    writeGraph(target, 1, 0)
    const run = vi.fn<GraphifyProcessRunner>(async () => {
      writeGraph(target, 4, 3)
      return { stdout: 'updated', stderr: '' }
    })

    await expect(
      runGraphify({ workspaceRoot: root, path: 'packages/api' }, { run })
    ).resolves.toMatchObject({
      action: 'updated',
      target: 'packages/api',
      graph: 'packages/api/graphify-out/graph.json',
      nodes: 4,
      links: 3
    })
    expect(run).toHaveBeenCalledWith(
      'graphify',
      ['update', target, '--no-cluster'],
      expect.objectContaining({ cwd: target })
    )
  })

  it('rejects paths outside the workspace before spawning Graphify', async () => {
    const root = workspace()
    const run = vi.fn<GraphifyProcessRunner>()

    await expect(runGraphify({ workspaceRoot: root, path: '../outside' }, { run })).rejects.toThrow(
      'hors du workspace'
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('reports a missing CLI and an invalid generated graph explicitly', async () => {
    const root = workspace()
    const missing: GraphifyProcessRunner = async () => {
      throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    }
    await expect(runGraphify({ workspaceRoot: root }, { run: missing })).rejects.toThrow(
      'CLI Graphify introuvable'
    )

    const invalid: GraphifyProcessRunner = async () => {
      writeGraph(root, 1, 0)
      writeFileSync(join(root, 'graphify-out', 'graph.json'), '{"nodes":{}}', 'utf8')
      return { stdout: '', stderr: '' }
    }
    await expect(runGraphify({ workspaceRoot: root }, { run: invalid })).rejects.toThrow(
      'graphe Graphify invalide'
    )
  })

  it('resolves the CLI from an absolute PATH entry and rejects relative overrides', () => {
    const trusted = mkdtempSync(join(tmpdir(), 'autowin-graphify-bin-'))
    temporaryRoots.push(trusted)
    const executable = join(trusted, process.platform === 'win32' ? 'graphify.exe' : 'graphify')
    writeFileSync(executable, '', { mode: 0o755 })

    expect(resolveGraphifyExecutable(undefined, trusted)).toBe(realpathSync(executable))
    expect(() => resolveGraphifyExecutable('graphify', trusted)).toThrow('chemin absolu')
    expect(() => resolveGraphifyExecutable(undefined, `.${delimiter}${trusted}`)).not.toThrow()
  })

  it('uses the offline installation prepared from the verified GED wheelhouse', () => {
    const tools = mkdtempSync(join(tmpdir(), 'autowin-graphify-tools-'))
    const shared = mkdtempSync(join(tmpdir(), 'autowin-graphify-shared-'))
    const install = mkdtempSync(join(tmpdir(), 'autowin-graphify-install-'))
    temporaryRoots.push(tools, shared, install)
    const graphify = join(tools, process.platform === 'win32' ? 'graphify.exe' : 'graphify')
    writeFileSync(graphify, '', { mode: 0o755 })
    const installedBin = join(
      install,
      '.venv',
      process.platform === 'win32' ? 'Scripts' : 'bin'
    )
    mkdirSync(installedBin, { recursive: true })
    const installedGraphify = join(
      installedBin,
      process.platform === 'win32' ? 'graphify.exe' : 'graphify'
    )
    writeFileSync(installedGraphify, '', { mode: 0o755 })
    writeFileSync(
      join(install, 'installation.json'),
      `\uFEFF${JSON.stringify({
          version: '0.9.11',
          wheelSha256: GRAPHIFY_WHEEL_SHA256,
          requirementsSha256: GRAPHIFY_REQUIREMENTS_SHA256
        })}`,
      'utf8'
    )

    expect(resolveGraphifyLaunch(undefined, tools, shared, install)).toEqual({
      executable: realpathSync(installedGraphify),
      prefixArgs: [],
      source: 'verified-shared'
    })

    expect(resolveGraphifyLaunch(undefined, tools, '', install)).toEqual({
      executable: realpathSync(graphify),
      prefixArgs: [],
      source: 'local'
    })
  })

  it('rejects an unprepared or mismatched shared installation', () => {
    const tools = mkdtempSync(join(tmpdir(), 'autowin-graphify-tools-'))
    const shared = mkdtempSync(join(tmpdir(), 'autowin-graphify-shared-'))
    const install = mkdtempSync(join(tmpdir(), 'autowin-graphify-install-'))
    temporaryRoots.push(tools, shared, install)
    writeFileSync(
      join(install, 'installation.json'),
      JSON.stringify({ version: '0.9.11', wheelSha256: 'tampered' }),
      'utf8'
    )

    expect(() => resolveGraphifyLaunch(undefined, tools, shared, install)).toThrow(
      'bootstrap-deps.ps1'
    )
  })

  it('kills a stalled process at the configured deadline', async () => {
    await expect(
      executeGraphifyProcess(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 10_000)'],
        { cwd: process.cwd(), timeoutMs: 25 }
      )
    ).rejects.toThrow('délai')
  })
})
