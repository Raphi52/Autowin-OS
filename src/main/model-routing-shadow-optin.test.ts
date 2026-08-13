import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createShadowRoutingRuntime, resolveShadowRoutingEnabled } from './model-routing-shadow'
import {
  DEFAULT_SHADOW_ROUTING_PILOT,
  loadShadowRoutingPilotSetting,
  saveShadowRoutingPilotSetting
} from './model-routing-shadow-setting'

function observationsPath(label: string): string {
  return join(
    mkdtempSync(join(tmpdir(), `autowin-shadow-optin-${label}-`)),
    'observations-v1.jsonl'
  )
}

const ENV = 'AUTOWIN_MODEL_ROUTING_SHADOW_ENABLED'

describe('opt-in du pilote de routage shadow — table de precedence', () => {
  it('env ON force le pilote meme si le reglage persistant est OFF', () => {
    for (const flag of ['1', 'true', 'TRUE', ' true ']) {
      expect(resolveShadowRoutingEnabled({ [ENV]: flag }, false)).toBe(true)
    }
    const path = observationsPath('env-on')

    const runtime = createShadowRoutingRuntime(path, { [ENV]: '1' }, false)

    expect(runtime.enabled).toBe(true)
  })

  it('env OFF force l arret meme si le reglage persistant est ON, sans materialiser de fichier', () => {
    for (const flag of ['0', 'false', 'FALSE', ' 0 ']) {
      expect(resolveShadowRoutingEnabled({ [ENV]: flag }, true)).toBe(false)
    }
    const path = observationsPath('env-off')

    const runtime = createShadowRoutingRuntime(path, { [ENV]: '0' }, true)

    expect(runtime).toEqual({ enabled: false })
    expect(existsSync(path)).toBe(false)
  })

  it('sans env, le reglage persistant ON active le pilote', () => {
    expect(resolveShadowRoutingEnabled({}, true)).toBe(true)
    const path = observationsPath('reglage-on')

    const runtime = createShadowRoutingRuntime(path, {}, true)

    expect(runtime.enabled).toBe(true)
    if (!runtime.enabled) throw new Error('runtime shadow attendu actif')
    expect(runtime.observer).toBeDefined()
    // Le store existe mais n'ecrit rien avant la premiere observation.
    expect(existsSync(path)).toBe(false)
  })

  it('sans env, le reglage persistant OFF laisse le pilote inerte sans creer de fichier', () => {
    expect(resolveShadowRoutingEnabled({}, false)).toBe(false)
    const path = observationsPath('reglage-off')

    const runtime = createShadowRoutingRuntime(path, {}, false)

    expect(runtime).toEqual({ enabled: false })
    expect(existsSync(path)).toBe(false)
  })

  it('sans env ni reglage, le defaut reste OFF sans creer de fichier', () => {
    expect(resolveShadowRoutingEnabled({}, undefined)).toBe(false)
    expect(resolveShadowRoutingEnabled({})).toBe(false)
    const path = observationsPath('rien')

    const runtime = createShadowRoutingRuntime(path, {})

    expect(runtime).toEqual({ enabled: false })
    expect(existsSync(path)).toBe(false)
  })

  it('une valeur d env non reconnue ou vide laisse decider le reglage persistant', () => {
    expect(resolveShadowRoutingEnabled({ [ENV]: 'peut-etre' }, true)).toBe(true)
    expect(resolveShadowRoutingEnabled({ [ENV]: '' }, true)).toBe(true)
    expect(resolveShadowRoutingEnabled({ [ENV]: 'peut-etre' }, false)).toBe(false)
    expect(resolveShadowRoutingEnabled({ [ENV]: '   ' })).toBe(false)
  })
})

describe('reglage persistant du pilote shadow', () => {
  it('vaut OFF par defaut sans creer le fichier de reglage', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-shadow-setting-default-'))
    const path = join(root, 'model-routing-shadow-pilot.json')

    expect(loadShadowRoutingPilotSetting(path)).toEqual({ enabled: false })
    expect(DEFAULT_SHADOW_ROUTING_PILOT).toEqual({ enabled: false })
    expect(existsSync(path)).toBe(false)
  })

  it('persiste l opt-in puis le retrait, et se relit apres redemarrage', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-shadow-setting-roundtrip-'))
    const path = join(root, 'model-routing-shadow-pilot.json')

    expect(saveShadowRoutingPilotSetting(path, true)).toEqual({ enabled: true })
    expect(loadShadowRoutingPilotSetting(path)).toEqual({ enabled: true })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ enabled: true })

    expect(saveShadowRoutingPilotSetting(path, false)).toEqual({ enabled: false })
    expect(loadShadowRoutingPilotSetting(path)).toEqual({ enabled: false })
  })

  it('refuse une valeur non booleenne sans ecrire', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-shadow-setting-invalide-'))
    const path = join(root, 'model-routing-shadow-pilot.json')

    expect(() => saveShadowRoutingPilotSetting(path, 'oui')).toThrow(/bool/i)
    expect(existsSync(path)).toBe(false)
  })

  it('retombe sur OFF si le fichier de reglage est illisible', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-shadow-setting-corrompu-'))
    const path = join(root, 'model-routing-shadow-pilot.json')
    writeFileSync(path, '{ pas du json', 'utf8')

    expect(loadShadowRoutingPilotSetting(path)).toEqual({ enabled: false })
  })
})

describe('cablage du pilote shadow dans le process principal', () => {
  const main = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

  it('alimente le runtime avec le reglage persistant, reassignable pour le sink de trace', () => {
    expect(main).toMatch(/let shadowRoutingRuntime = createShadowRoutingRuntime\(/)
    expect(main).toMatch(/loadShadowRoutingPilotSetting\(shadowRoutingPilotPath\)\.enabled/)
    expect(main).toMatch(/if \(shadowRoutingRuntime\.enabled\) shadowRoutingRuntime\.observer/)
  })

  it('expose la bascule par IPC et reconstruit le runtime a l enregistrement', () => {
    expect(main).toMatch(/ipcMain\.handle\('os:shadowRoutingPilot:get'/)
    expect(main).toMatch(/ipcMain\.handle\('os:shadowRoutingPilot:set'/)
    expect(main).toMatch(
      /saveShadowRoutingPilotSetting\(shadowRoutingPilotPath[\s\S]{0,400}shadowRoutingRuntime = createShadowRoutingRuntime\(/
    )
  })

  it('renvoie l utilisateur au reglage de l app, pas a une variable d environnement', () => {
    const reason = /reason:\s*'([^']*[Rr]outeur shadow[^']*)'/.exec(main)?.[1]
    expect(reason).toBeDefined()
    expect(reason).toMatch(/Settings/)
    expect(reason).not.toMatch(/AUTOWIN_MODEL_ROUTING_SHADOW_ENABLED/)
  })

  it('expose la bascule sur les deux contrats preload', () => {
    for (const relative of ['../preload/index.ts', '../preload/index.d.ts']) {
      const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
      expect(source).toMatch(/shadowRoutingPilot/)
      expect(source).toMatch(/setShadowRoutingPilot/)
    }
  })
})
