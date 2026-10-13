import { describe, expect, it } from 'vitest'
import { runtimeDuRelais, type ContexteRuntimeRelais } from './survivable-spawn'

/**
 * LE RELAIS NE DOIT PAS TENIR ELECTRON (conv-902, 2026-10-12). Le relais survivable des agents
 * tournait sur `process.execPath` -- en dev, `.autowin-data/electron-dev/electron.exe`, dont les DLL
 * sont des liens durs vers `node_modules/electron/dist`. Conçu pour survivre à l'app, il tenait encore
 * l'exe quand le lanceur voulait réinstaller Electron : trois redémarrages de suite ont fini sur
 * « dependances: electron.exe verrouille — reparation sautee » (pid 5304 = le relais de la session
 * qui demandait le redémarrage). En dev, le relais doit donc tourner sur un `node.exe` rangé hors de
 * tout `node_modules`. ENTREES QUI DOIVENT FAIRE ECHOUER : rendre l'exe de dev alors qu'un Node est
 * disponible, élire un `node.exe` d'un `node_modules` (npm install le réécrit aussi), ou toucher
 * l'app installée (un poste client n'a pas forcément Node).
 */
const DEV = 'D:\\AutoWinOS\\.autowin-data\\electron-dev\\electron.exe'
const NODE_SYSTEME = 'C:\\Program Files\\nodejs\\node.exe'

function contexte(
  partiel: Partial<ContexteRuntimeRelais> & { presents?: string[] }
): ContexteRuntimeRelais {
  const presents = new Set((partiel.presents ?? []).map((c) => c.toLowerCase()))
  return {
    execPath: partiel.execPath ?? DEV,
    electron: partiel.electron ?? true,
    env: partiel.env ?? {},
    existe: partiel.existe ?? ((chemin) => presents.has(chemin.toLowerCase()))
  }
}

describe('runtime du relais survivable', () => {
  it('en dev, fait tourner le relais sur le node.exe du PATH, pas sur l’exe de dev', () => {
    const choisi = runtimeDuRelais(
      contexte({
        env: { Path: 'C:\\Windows\\system32;C:\\Program Files\\nodejs\\;C:\\autre' },
        presents: [NODE_SYSTEME, 'C:\\autre\\node.exe']
      })
    )
    expect(choisi.toLowerCase()).toBe(NODE_SYSTEME.toLowerCase())
  })

  it('préfère le Node désigné par npm (npm_node_execpath, puis NODE) à celui du PATH', () => {
    const npm = 'C:\\outils\\node-v24\\node.exe'
    expect(
      runtimeDuRelais(
        contexte({
          env: { npm_node_execpath: npm, NODE: NODE_SYSTEME, Path: 'C:\\Program Files\\nodejs' },
          presents: [npm, NODE_SYSTEME]
        })
      )
    ).toBe(npm)
    expect(
      runtimeDuRelais(
        contexte({ env: { NODE: NODE_SYSTEME, Path: 'C:\\ailleurs' }, presents: [NODE_SYSTEME] })
      )
    ).toBe(NODE_SYSTEME)
  })

  it('n’élit jamais un node.exe rangé dans un node_modules, ni un candidat absent du disque', () => {
    const local = 'D:\\AutoWinOS\\node_modules\\node\\bin\\node.exe'
    const choisi = runtimeDuRelais(
      contexte({
        env: {
          NODE: 'C:\\disparu\\node.exe',
          PATH: 'D:\\AutoWinOS\\node_modules\\node\\bin;C:\\Program Files\\nodejs'
        },
        presents: [local, NODE_SYSTEME]
      })
    )
    expect(choisi.toLowerCase()).toBe(NODE_SYSTEME.toLowerCase())
  })

  it('l’app installée garde son propre exe, même si un Node est disponible', () => {
    const installee = 'C:\\Program Files\\Autowin OS\\Autowin OS.exe'
    expect(
      runtimeDuRelais(
        contexte({ execPath: installee, env: { NODE: NODE_SYSTEME }, presents: [NODE_SYSTEME] })
      )
    ).toBe(installee)
  })

  it('sous un Node ordinaire (tests, scripts), garde l’exe courant', () => {
    const node = 'C:\\nvm\\node.exe'
    expect(
      runtimeDuRelais(
        contexte({
          execPath: node,
          electron: false,
          env: { NODE: NODE_SYSTEME },
          presents: [NODE_SYSTEME]
        })
      )
    ).toBe(node)
  })

  it('en dev sans aucun Node trouvé, retombe sur l’exe de dev plutôt que de refuser le run', () => {
    expect(runtimeDuRelais(contexte({ env: { Path: 'C:\\Windows' }, presents: [] }))).toBe(DEV)
  })
})
