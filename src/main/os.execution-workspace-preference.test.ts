import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveExecutionWorkspace } from './os'
import {
  readExecutionWorkspacePreference,
  writeExecutionWorkspacePreference
} from './execution-workspace-preference'
import { AUTOWIN_WORKSPACE_ENV } from '../shared/app-identity'

function repo(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `autowin-${name}-`))
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, 'package.json'), '{}')
  return root
}

describe('dossier de travail choisi depuis l’interface', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('le choix persisté l’emporte sur la détection depuis le dossier courant', () => {
    vi.stubEnv(AUTOWIN_WORKSPACE_ENV, '')
    const detected = repo('detecte')
    const chosen = repo('choisi')
    const file = join(mkdtempSync(join(tmpdir(), 'autowin-pref-')), 'execution-workspace.json')

    expect(writeExecutionWorkspacePreference(chosen, file)).toBe(chosen)
    expect(readExecutionWorkspacePreference(file)).toBe(chosen)
    expect(resolveExecutionWorkspace({ cwd: detected, preferenceFile: file })).toBe(chosen)
  })

  it('un choix dont le dossier a disparu ne change rien au comportement actuel', () => {
    vi.stubEnv(AUTOWIN_WORKSPACE_ENV, '')
    const detected = repo('detecte2')
    const file = join(mkdtempSync(join(tmpdir(), 'autowin-pref-')), 'execution-workspace.json')
    writeExecutionWorkspacePreference(join(detected, 'disparu'), file)

    expect(readExecutionWorkspacePreference(file)).toBeUndefined()
    expect(resolveExecutionWorkspace({ cwd: detected, preferenceFile: file })).toBe(detected)
  })

  it('la variable d’environnement reste prioritaire sur le choix persisté', () => {
    const forced = repo('force')
    const chosen = repo('choisi2')
    const file = join(mkdtempSync(join(tmpdir(), 'autowin-pref-')), 'execution-workspace.json')
    writeExecutionWorkspacePreference(chosen, file)

    expect(
      resolveExecutionWorkspace({ configured: forced, cwd: chosen, preferenceFile: file })
    ).toBe(forced)
  })
})
