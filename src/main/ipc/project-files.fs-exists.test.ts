/**
 * Canal `fs:exists` (conv-826) : le mode auto demande au principal si le fichier attendu par une
 * suite « quand X existe » est là, sans payer de tour. Lecture seule : vrai/faux/null, rien d'autre.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)
  }
}))
vi.mock('../ipc-senders', () => ({ assertTrustedRendererSender: () => undefined }))
vi.mock('../project-files', () => ({
  listProjectDir: () => [],
  readProjectFile: () => '',
  writeProjectFile: () => undefined
}))

import { registerProjectFilesIpc } from './project-files'

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fs-exists-'))
  writeFileSync(join(dir, 'fin.txt'), 'x')
  registerProjectFilesIpc({ os: { executionWorkspace: dir } as never })
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('fs:exists', () => {
  const ask = (p: unknown, b?: unknown) => handlers.get('fs:exists')?.({}, p, b)
  it('vrai pour un fichier présent (absolu ou relatif à une base absolue)', async () => {
    expect(await ask(join(dir, 'fin.txt'))).toBe(true)
    expect(await ask('fin.txt', dir)).toBe(true)
  })
  it('faux pour un fichier absent', async () => {
    expect(await ask(join(dir, 'absent.txt'))).toBe(false)
  })
  it('relatif sans base : résolu depuis l’espace de travail, jamais null (conv-826 : null payait un tour)', async () => {
    expect(await ask('fin.txt')).toBe(true)
    expect(await ask('fin.txt', 'relatif')).toBe(true)
    expect(await ask('essais/t4/fin.txt')).toBe(false)
  })
})
