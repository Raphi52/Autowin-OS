import { describe, expect, it } from 'vitest'
import {
  installerRaccourciCapture,
  RACCOURCI_CAPTURE_DEFAUT,
  type ApiRaccourcis
} from './raccourci-global'

function fausseApi(dejaPris = false): ApiRaccourcis & { appels: string[]; action?: () => void } {
  const appels: string[] = []
  const api = {
    appels,
    action: undefined as (() => void) | undefined,
    register(acc: string, action: () => void) {
      appels.push(`register:${acc}`)
      api.action = action
      return true
    },
    isRegistered: () => dejaPris,
    unregisterAll: () => appels.push('unregisterAll')
  }
  return api
}

describe('raccourci clavier global', () => {
  it('enregistre la combinaison et déclenche l’action', () => {
    const api = fausseApi()
    let ouvertures = 0
    const r = installerRaccourciCapture(api, () => (ouvertures += 1))
    expect(r.installe).toBe(true)
    expect(api.appels).toEqual([`register:${RACCOURCI_CAPTURE_DEFAUT}`])
    api.action?.()
    expect(ouvertures).toBe(1)
  })

  it('libère la combinaison à la fermeture', () => {
    const api = fausseApi()
    installerRaccourciCapture(api, () => {}).desinstaller()
    expect(api.appels).toContain('unregisterAll')
  })

  it('n’arrache pas une combinaison déjà prise par une autre application', () => {
    const api = fausseApi(true)
    expect(installerRaccourciCapture(api, () => {}).installe).toBe(false)
    expect(api.appels).toEqual([])
  })
})
