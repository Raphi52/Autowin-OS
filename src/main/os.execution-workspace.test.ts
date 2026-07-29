import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveExecutionWorkspace } from './os'
import { AUTOWIN_WORKSPACE_ENV } from '../shared/app-identity'

describe('resolveExecutionWorkspace', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('préfère le dépôt courant au package Electron sous node_modules', () => {
    // Hermétique : le runtime Autowin exporte AUTOWIN_OS_WORKSPACE, qui est prioritaire
    // par conception (configuré > dépôt courant) et masquerait la priorité testée ici.
    vi.stubEnv(AUTOWIN_WORKSPACE_ENV, '')
    const repo = mkdtempSync(join(tmpdir(), 'autowin-exec-workspace-'))
    mkdirSync(join(repo, '.git'))
    writeFileSync(join(repo, 'package.json'), '{}')
    const electron = join(repo, 'node_modules', 'electron', 'dist', 'electron.exe')
    mkdirSync(join(repo, 'node_modules', 'electron', 'dist'), { recursive: true })
    writeFileSync(electron, '')

    expect(
      resolveExecutionWorkspace({ cwd: repo, execPath: electron, configured: undefined })
    ).toBe(repo)
  })
})
