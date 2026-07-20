import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExecutionWorkspace } from './os'

describe('resolveExecutionWorkspace', () => {
  it('préfère le dépôt courant au package Electron sous node_modules', () => {
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
