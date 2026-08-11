import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gitLogShaBatchExec, resolveHeadShas } from './brain-source-sha'
import { sourceLocatorProblem } from './brain-remember'

let workspace = ''

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'sha-resolver-'))
  mkdirSync(join(workspace, 'src', 'main'), { recursive: true })
  writeFileSync(join(workspace, 'src', 'main', 'index.ts'), 'export {}\n', 'utf8')
})

describe('resolveHeadShas — resolution groupee pour la revue inbox', () => {
  it('associe les chemins aux vrais commits renvoyes par Git', () => {
    writeFileSync(join(workspace, '@@marker.ts'), 'export {}\n', 'utf8')
    execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'brain-inbox@test.local'], { cwd: workspace })
    execFileSync('git', ['config', 'user.name', 'Brain Inbox Test'], { cwd: workspace })
    execFileSync('git', ['add', 'src/main/index.ts', '@@marker.ts'], { cwd: workspace })
    execFileSync('git', ['commit', '-m', 'index'], { cwd: workspace, stdio: 'ignore' })
    const expected = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: workspace,
      encoding: 'utf8'
    }).trim()

    const resolved = gitLogShaBatchExec()(workspace, ['src/main/index.ts', '@@marker.ts'], 3_000)
    expect(resolved.get('src/main/index.ts')).toBe(expected)
    expect(resolved.get('@@marker.ts')).toBe(expected)

    const relativeAlias = 'SRC/./MAIN/INDEX.TS'
    const absoluteAlias = join(workspace, 'SRC', 'MAIN', 'INDEX.TS').replace(/\\/g, '/')
    const aliases = resolveHeadShas([workspace], [relativeAlias, absoluteAlias])
    expect(aliases.get(relativeAlias)).toBe(expected)
    expect(aliases.get(absoluteAlias)).toBe(expected)
  })

  it('groupe 120 chemins en trois appels git bornes de 50', () => {
    const paths = Array.from({ length: 120 }, (_, index) => `src/main/file-${index}.ts`)
    for (const path of paths) {
      mkdirSync(join(workspace, path, '..'), { recursive: true })
      writeFileSync(join(workspace, path), 'export {}\n', 'utf8')
    }
    const exec = vi.fn(
      (_workspace: string, batch: readonly string[]) =>
        new Map(batch.map((path) => [path, `sha-${path}`]))
    )

    const resolved = resolveHeadShas([workspace], paths, exec)

    expect(exec).toHaveBeenCalledTimes(3)
    expect(exec.mock.calls.map((call) => call[1].length)).toEqual([50, 50, 20])
    expect(resolved.size).toBe(120)
    expect(resolved.get('src/main/file-119.ts')).toBe('sha-src/main/file-119.ts')
  })

  it('dedoublonne et refuse les chemins invalides ou absents sans lancer git', () => {
    const exec = vi.fn(
      (_workspace: string, _paths: readonly string[], _timeoutMs: number) =>
        new Map<string, string>()
    )
    const resolved = resolveHeadShas(
      [workspace],
      [
        '',
        '/etc/passwd',
        '../../secret',
        'src/absent.ts',
        'src/main/index.ts',
        'src/main/index.ts'
      ],
      exec
    )
    expect(exec).toHaveBeenCalledOnce()
    expect(exec.mock.calls[0].slice(0, 2)).toEqual([workspace, ['src/main/index.ts']])
    expect(exec.mock.calls[0][2]).toBeGreaterThan(0)
    expect(exec.mock.calls[0][2]).toBeLessThanOrEqual(2_500)
    expect([...resolved.keys()]).toEqual([])
  })

  it('coupe un lot de 2,6 s pour respecter un budget global de 2,5 secondes', () => {
    const paths = Array.from({ length: 100 }, (_, index) => `src/main/budget-${index}.ts`)
    for (const path of paths) {
      mkdirSync(join(workspace, path, '..'), { recursive: true })
      writeFileSync(join(workspace, path), 'export {}\n', 'utf8')
    }
    let clock = 0
    const timeouts: number[] = []
    const exec = vi.fn((_workspace: string, batch: readonly string[], timeoutMs: number) => {
      timeouts.push(timeoutMs)
      clock += 2_600
      return new Map(batch.map((path) => [path, `sha-${path}`]))
    })

    resolveHeadShas([workspace], paths, exec, () => clock)

    expect(timeouts).toEqual([2_500])
  })

  it('normalise un locator Git absolu contenu dans un workspace avec espaces', () => {
    const spacedWorkspace = join(workspace, 'Repo With Space')
    const file = join(spacedWorkspace, 'src', 'main', 'absolute.ts')
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, 'export {}\n', 'utf8')
    const locatorPath = file.replace(/\\/g, '/')
    expect(sourceLocatorProblem(`git:${locatorPath}@abcdef1`)).toBeUndefined()
    const exec = vi.fn(
      (_workspace: string, batch: readonly string[]) =>
        new Map(batch.map((path) => [path, 'abcdef1234567890']))
    )

    const resolved = resolveHeadShas([spacedWorkspace], [locatorPath], exec, () => 0)

    expect(exec.mock.calls[0].slice(0, 2)).toEqual([spacedWorkspace, ['src/main/absolute.ts']])
    expect(resolved.get(locatorPath)).toBe('abcdef1234567890')
  })
})
afterEach(() => rmSync(workspace, { recursive: true, force: true }))
