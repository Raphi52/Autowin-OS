import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), isPackaged: false, getVersion: () => '0.0.0', on: vi.fn() },
  Notification: class {},
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: {}
}))

const { resolveExecutionWorkspace, selectPhaseFanOut } = await import('./os')

describe('selectPhaseFanOut', () => {
  const fanOut = {
    scout: [{ provider: 'a' }],
    frame: [{ provider: 'b' }],
    terrain: [{ provider: 'c' }],
    judge: [{ provider: 'd' }]
  }
  it('rend le bloc des phases scout, frame et terrain', () => {
    expect(selectPhaseFanOut(fanOut, 'scout')).toEqual([{ provider: 'a' }])
    expect(selectPhaseFanOut(fanOut, 'frame')).toEqual([{ provider: 'b' }])
    expect(selectPhaseFanOut(fanOut, 'terrain' as never)).toEqual([{ provider: 'c' }])
  })
  it('rend une liste vide pour les autres phases, judge compris', () => {
    expect(selectPhaseFanOut(fanOut, 'judge' as never)).toEqual([])
    expect(selectPhaseFanOut(fanOut, 'build' as never)).toEqual([])
  })
})

describe('resolveExecutionWorkspace', () => {
  const base = mkdtempSync(join(tmpdir(), 'os-ws-'))
  const absent = join(base, 'aucune-preference.json')
  it('prend le dossier configure s il existe', () => {
    expect(resolveExecutionWorkspace({ configured: base, preferenceFile: absent })).toBe(
      resolve(base)
    )
  })
  it('remonte jusqu au depot git (.git + package.json) depuis le cwd', () => {
    const depot = join(base, 'depot')
    const sous = join(depot, 'a', 'b')
    mkdirSync(join(depot, '.git'), { recursive: true })
    mkdirSync(sous, { recursive: true })
    writeFileSync(join(depot, 'package.json'), '{}')
    expect(
      resolveExecutionWorkspace({
        configured: join(base, 'disparu'),
        preferenceFile: absent,
        cwd: sous
      })
    ).toBe(resolve(depot))
  })
})
