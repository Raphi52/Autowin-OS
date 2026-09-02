import { describe, expect, it } from 'vitest'
import { sourceProcessPrincipal } from './source-process-principal.test-helpers'

/**
 * Le corps d'un canal, borne par le canal SUIVANT quel qu'il soit.
 *
 * Bornee par un canal NOMME, la tranche cassait au premier demenagement : les canaux de prerequis
 * ont quitte `index.ts` pour `src/main/ipc/preflight.ts` le 2026-09-02 et `os:roles` ne les suivait
 * plus. Le voisin n'est pas le contrat — la garde AVANT la dependance l'est.
 */
function handlerBody(source: string, channel: string): string {
  const start = source.indexOf(`ipcMain.handle('${channel}'`)
  expect(start).toBeGreaterThanOrEqual(0)
  const suivant = source.indexOf('ipcMain.handle(', start + 1)
  return source.slice(start, suivant < 0 ? undefined : suivant)
}

describe('preflight IPC trust contract', () => {
  it('garde le recheck et la lecture courante avant toute dépendance', () => {
    // La ZONE du process principal, pas un chemin : `index.ts` plus les modules qui en sont sortis.
    const source = sourceProcessPrincipal()
    const recheck = handlerBody(source, 'preflight:recheck')
    const current = handlerBody(source, 'preflight:current')

    expect(recheck).toContain("assertTrustedRendererSender(event, 'Preflight')")
    expect(recheck.indexOf('assertTrustedRendererSender')).toBeLessThan(
      recheck.indexOf('runAppPreflight')
    )
    expect(current).toContain("assertTrustedRendererSender(event, 'Preflight')")
    expect(current.indexOf('assertTrustedRendererSender')).toBeLessThan(
      current.indexOf('getLastAppPreflightResult')
    )
  })
})
