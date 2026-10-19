import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppCommandBus, outilOffert } from './commands'
import { listNativeRegistry, setNativeEnablement } from './native-registry'
import { amorcerRegistreOutils } from './registre-outils'
import { sourceProcessPrincipal } from './source-process-principal.test-helpers'

/**
 * UN OUTIL COUPÉ À L'ÉCRAN DOIT LE RESTER APRÈS UN REDÉMARRAGE (conv-353).
 *
 * L'interrupteur vit dans l'écran « Skills · Hooks · Gates · Mods · Tools » (CapabilitiesView) et
 * s'enregistre dans le registre natif. Au démarrage, `index.ts` construit le bus avec un filtre qui
 * LIT ce registre, puis ré-amorce le registre. Ce fichier rejoue ce démarrage sur un registre jetable.
 */
function demarrer(base: string): AppCommandBus {
  // Même lecture que `capabilityEnabled('tools', name)` (capability-controls.ts), registre jetable.
  const interrupteur = (name: string): boolean | undefined =>
    listNativeRegistry('tools', base).find((item) => item.id === name)?.enabled
  const bus = new AppCommandBus(
    {} as never,
    () => {},
    undefined,
    undefined,
    (name) => outilOffert(name, interrupteur(name))
  )
  // Amorçage : la MÊME fonction que index.ts (le garde en bas de fichier le tient).
  amorcerRegistreOutils(base)
  return bus
}

describe('registre des outils : un interrupteur survit au redémarrage', () => {
  let base: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'registre-outils-'))
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('un outil coupé reste coupé ET listé à chaque redémarrage', () => {
    demarrer(base)
    // L'utilisateur coupe `verify` à l'écran.
    setNativeEnablement('tools', 'verify', false, base)

    const etats = [1, 2, 3].map((demarrage) => {
      const bus = demarrer(base)
      const ligne = listNativeRegistry('tools', base).find((item) => item.id === 'verify')
      return {
        demarrage,
        listeALEcran: ligne !== undefined,
        coupe: ligne?.enabled === false,
        offertAuxAgents: bus.catalog().some((command) => command.name === 'verify')
      }
    })
    expect(etats).toEqual(
      [1, 2, 3].map((demarrage) => ({
        demarrage,
        listeALEcran: true,
        coupe: true,
        offertAuxAgents: false
      }))
    )
  })

  it('un outil coupé puis rallumé est de nouveau offert au démarrage suivant', () => {
    demarrer(base)
    setNativeEnablement('tools', 'verify', false, base)
    demarrer(base)
    // L'écran rallume par `setCapabilityEnabled`, qui REFUSE un id absent du registre
    // (« Capacité inconnue », capability-controls.ts) : la ligne doit donc encore exister.
    expect(listNativeRegistry('tools', base).map((item) => item.id)).toContain('verify')
    setNativeEnablement('tools', 'verify', true, base)
    const offerts = demarrer(base)
      .catalog()
      .map((command) => command.name)
    expect(offerts).toContain('verify')
  })

  it('un outil débranché dans le code n’apparaît pas à l’écran comme un interrupteur', () => {
    demarrer(base)
    expect(listNativeRegistry('tools', base).map((item) => item.id)).not.toContain('graphify')
  })

  it('index.ts amorce par amorcerRegistreOutils, jamais depuis bus.catalog() filtré', () => {
    const source = sourceProcessPrincipal()
    expect(source).toMatch(/^amorcerRegistreOutils\(\)/m)
    expect(source).not.toMatch(/seedRegistrySnapshot\(\{\s*tools:\s*bus\.catalog\(\)/)
  })
})
