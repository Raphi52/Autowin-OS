import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  autowinAppDataRoot,
  ensureAutowinAppData,
  legacyAppDataRoot,
  migrateLegacyAppData,
  migrateLegacyAppDataDetailed,
  resolveAutowinAppDataBase
} from './app-data'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'autowin-appdata-'))
  roots.push(root)
  return root
}

function put(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function fingerprint(root: string): Record<string, string> {
  const result: Record<string, string> = {}
  const visit = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        result[relative(root, path).replaceAll('\\', '/')] = createHash('sha256')
          .update(readFileSync(path))
          .digest('hex')
      }
    }
  }
  visit(root)
  return result
}

describe('migration APPDATA Autowin OS', () => {
  it('copies every missing supported store byte-for-byte and keeps the legacy sources', () => {
    const base = fixtureRoot()
    const legacy = legacyAppDataRoot(base)
    const target = autowinAppDataRoot(base)
    const fixtures = {
      'roles.json': '{"orchestrator":{"provider":"claude"}}',
      'auth.json': '{"accessToken":"fixture-only"}',
      'conversations.json': '[{"id":"conv-1"}]',
      'agent-topology.json': '{"version":1}',
      'activity/conv-1.jsonl': '{"kind":"chat"}\n',
      'runs/conv-1/task-workspace/RUN.md': 'status: green\n',
      'trace/events.jsonl': '{"ok":true}\n'
    }
    for (const [name, content] of Object.entries(fixtures)) put(join(legacy, name), content)
    put(join(legacy, 'Cache', 'ignored.bin'), 'cache')

    migrateLegacyAppData(base)

    for (const [name, content] of Object.entries(fixtures)) {
      expect(readFileSync(join(target, name), 'utf8')).toBe(content)
      expect(readFileSync(join(legacy, name), 'utf8')).toBe(content)
    }
    expect(existsSync(join(target, 'Cache', 'ignored.bin'))).toBe(false)
  })

  it('never overwrites a divergent target and is idempotent', () => {
    const base = fixtureRoot()
    const legacy = legacyAppDataRoot(base)
    const target = autowinAppDataRoot(base)
    put(join(legacy, 'conversations.json'), '[{"title":"legacy"}]')
    put(join(legacy, 'activity', 'shared.jsonl'), 'legacy\n')
    put(join(legacy, 'activity', 'legacy-only.jsonl'), 'legacy-only\n')
    put(join(target, 'conversations.json'), '[{"title":"current"}]')
    put(join(target, 'activity', 'shared.jsonl'), 'current\n')

    migrateLegacyAppData(base)
    const first = fingerprint(target)
    migrateLegacyAppData(base)

    expect(readFileSync(join(target, 'conversations.json'), 'utf8')).toBe('[{"title":"current"}]')
    expect(readFileSync(join(target, 'activity', 'shared.jsonl'), 'utf8')).toBe('current\n')
    expect(readFileSync(join(target, 'activity', 'legacy-only.jsonl'), 'utf8')).toBe(
      'legacy-only\n'
    )
    expect(fingerprint(target)).toEqual(first)
    expect(readFileSync(join(legacy, 'conversations.json'), 'utf8')).toContain('legacy')
  })

  it('leaves a new-only profile unchanged and creates an empty canonical root', () => {
    const base = fixtureRoot()
    const target = autowinAppDataRoot(base)
    put(join(target, 'roles.json'), '{"provider":"current"}')
    const before = fingerprint(target)

    expect(migrateLegacyAppData(base)).toBe(0)
    expect(fingerprint(target)).toEqual(before)

    const emptyBase = fixtureRoot()
    const emptyTarget = ensureAutowinAppData(emptyBase)
    expect(emptyTarget).toBe(autowinAppDataRoot(emptyBase))
    expect(existsSync(emptyTarget)).toBe(true)
  })

  it('does not rewrite identical old and new files', () => {
    const base = fixtureRoot()
    const legacy = legacyAppDataRoot(base)
    const target = autowinAppDataRoot(base)
    put(join(legacy, 'conversations.json'), '[{"title":"same"}]')
    put(join(target, 'conversations.json'), '[{"title":"same"}]')
    const before = fingerprint(target)

    expect(migrateLegacyAppData(base)).toBe(0)
    expect(fingerprint(target)).toEqual(before)
    expect(readFileSync(join(legacy, 'conversations.json'), 'utf8')).toBe('[{"title":"same"}]')
  })

  it('keeps both sides when a file and directory collide', () => {
    const base = fixtureRoot()
    const legacy = legacyAppDataRoot(base)
    const target = autowinAppDataRoot(base)
    put(join(legacy, 'activity', 'legacy.jsonl'), 'legacy\n')
    put(join(target, 'activity'), 'current-file')
    put(join(legacy, 'roles.json'), 'legacy-role')
    mkdirSync(join(target, 'roles.json'), { recursive: true })

    const report = migrateLegacyAppDataDetailed(base)
    expect(report.outcomes.filter((outcome) => outcome.status === 'failed')).toEqual([])
    expect(report.outcomes.filter((outcome) => outcome.status === 'target-kept')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ store: 'activity' }),
        expect.objectContaining({ store: 'roles.json' })
      ])
    )
    expect(readFileSync(join(target, 'activity'), 'utf8')).toBe('current-file')
    expect(readFileSync(join(legacy, 'activity', 'legacy.jsonl'), 'utf8')).toBe('legacy\n')
    expect(readFileSync(join(legacy, 'roles.json'), 'utf8')).toBe('legacy-role')
    expect(existsSync(join(target, 'roles.json'))).toBe(true)
  })

  it('ignores the isolated root in packaged builds', () => {
    const isolated = join(fixtureRoot(), 'isolated')
    const environment = {
      AUTOWIN_ISOLATED_TEST_INSTANCE: '1',
      AUTOWIN_TEST_APP_DATA_ROOT: isolated
    }

    expect(resolveAutowinAppDataBase('C:\\real-appdata', true, environment)).toBe(
      'C:\\real-appdata'
    )
    expect(resolveAutowinAppDataBase('C:\\real-appdata', false, environment)).toBe(isolated)
  })
})
