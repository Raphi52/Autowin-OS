import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveExecutionWorkspace } from './os'
import {
  alignerEnvPourRelance,
  envPourRelance,
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

/*
 * LE DÉFAUT : au démarrage l'OS republie le dossier résolu dans `AUTOWIN_OS_WORKSPACE` (os.ts), et
 * le redémarrage transmet l'environnement courant au processus suivant (app-restart.ts). Cette
 * variable passant DEVANT le choix persisté, choisir un autre dossier dans les Réglages puis
 * redémarrer repartait sur l'ANCIEN dossier : le réglage semblait ignoré.
 */
describe('envPourRelance — la variable n’est alignée qu’AU redémarrage', () => {
  it('pose le dossier choisi, en chemin absolu', () => {
    expect(envPourRelance({ choisi: 'D:\\Repo\\.' })).toEqual({
      action: 'poser',
      valeur: resolve('D:\\Repo')
    })
  })

  it('RETIRE la variable quand plus aucun choix n’est enregistré — sinon la détection ne reprend jamais', () => {
    expect(envPourRelance({ choisi: undefined })).toEqual({ action: 'retirer' })
  })

  it('ne contredit PAS un lanceur externe qui imposait un dépôt au lancement', () => {
    expect(envPourRelance({ envAuLancement: 'D:\\ImposeParLeBanc', choisi: 'D:\\Repo' })).toEqual({
      action: 'garder'
    })
  })

  it('NOTRE propre republication ne fait pas écran au nouveau choix', () => {
    // Le cas qui gardait le défaut vivant : le processus précédent avait republié le dossier résolu
    // et l'a transmis. Sans le marqueur d'origine, cette valeur passerait pour une consigne externe
    // et l'app repartirait indéfiniment sur l'ancien dossier.
    expect(
      envPourRelance({
        envAuLancement: 'D:\\Ancien',
        envVientDeNous: true,
        choisi: 'D:\\Nouveau'
      })
    ).toEqual({ action: 'poser', valeur: resolve('D:\\Nouveau') })
  })

  it('le redémarrage aligne l’environnement sur le choix', () => {
    vi.stubEnv(AUTOWIN_WORKSPACE_ENV, repo('ancien'))
    const nouveau = repo('nouveau')
    alignerEnvPourRelance(envPourRelance({ choisi: nouveau }))
    expect(process.env[AUTOWIN_WORKSPACE_ENV]).toBe(resolve(nouveau))
  })
})
