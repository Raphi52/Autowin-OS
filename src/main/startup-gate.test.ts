import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { interfaceVisible, signalerInterfaceVisible } from './startup-gate'

/**
 * La garde de démarrage, et le défaut précis qu'elle remplace.
 *
 * MESURÉ : la réconciliation des copies git est synchrone et dure ~23 s. Faite dans le constructeur,
 * elle retardait `app.whenReady` à 26 047 ms — reportée de 1 500 ms par une minuterie, elle le
 * retardait ENCORE à 26 047 ms, parce qu'un délai ne garantit aucun ordonnancement : le travail
 * tombait juste avant la micro-tâche de `whenReady`. Test d'inversion (report à 45 s) : `whenReady` à
 * 1 545 ms. C'est ce minutage aveugle que ces tests interdisent de revenir.
 */

describe('garde de démarrage', () => {
  it('se résout quand la fenêtre est signalée visible', async () => {
    signalerInterfaceVisible()
    await expect(interfaceVisible).resolves.toBeUndefined()
  })

  it('est idempotente : `ready-to-show` peut être émis plusieurs fois', () => {
    expect(() => {
      signalerInterfaceVisible()
      signalerInterfaceVisible()
    }).not.toThrow()
  })

  it('garde un filet, sinon un démarrage sans fenêtre ne récupérerait JAMAIS les runs', () => {
    // Les pilotes de fumée et les scénarios sans fenêtre n'émettent jamais `ready-to-show`. Un
    // démarrage rapide au prix d'un état jamais restauré serait une régression, pas un gain.
    const source = readFileSync(join(__dirname, 'startup-gate.ts'), 'utf8')
    expect(source).toMatch(/const FILET_MS = 20_000/)
    expect(source).toMatch(/setTimeout\(resolve, FILET_MS\)/)
    // Sans `unref`, ce minuteur retiendrait tout seul un processus prêt à sortir.
    expect(source).toMatch(/filet\.unref\?\.\(\)/)
  })
})

describe('le report de la réconciliation attend un ÉVÉNEMENT, jamais un délai', () => {
  const coordinateur = readFileSync(join(__dirname, 'store/run-worktree-coordinator.ts'), 'utf8')
  const os = readFileSync(join(__dirname, 'os.ts'), 'utf8')
  const index = readFileSync(join(__dirname, 'index.ts'), 'utf8')

  it('le coordinateur n’expose aucun report exprimé en millisecondes', () => {
    expect(coordinateur).toContain('deferRecoveryUntil?: Promise<unknown>')
    expect(coordinateur).not.toMatch(/deferRecoveryMs/)
  })

  it('un rejet de la garde ne fait pas sauter la récupération', () => {
    // Les deux branches de `then` réconcilient : une garde en échec doit dégrader vers « tout de
    // suite », jamais vers « jamais ».
    expect(coordinateur).toMatch(
      /\(\) => this\.reconcileExistingAsync\(\),\s*\(\) => this\.reconcileExistingAsync\(\)/
    )
  })

  it('la branche différée passe par la variante NON BLOQUANTE', () => {
    // MESURÉ : le balayage des copies abandonnées pesait 19,7 s des 23 s, et balayait 0 copie. Derrière
    // une interface chargée, ce travail synchrone gelait quand même tous les IPC.
    expect(coordinateur).toContain('private async reconcileExistingAsync()')
    expect(coordinateur).toContain('await this.manager.reconcileResiduesAsync()')
  })

  it('reste SYNCHRONE quand aucune garde n’est fournie', () => {
    // C'est le contrat que lisent les tests du coordinateur : construire, puis lire l'état réconcilié.
    expect(coordinateur).toMatch(/} else {\s*this\.reconcileExisting\(\)\s*}/)
  })

  it('la production branche la garde, et seule la production', () => {
    expect(os).toContain("import { interfaceVisible } from './startup-gate'")
    expect(os).toContain('deferRecoveryUntil: interfaceVisible')
  })

  it('le signal part du CHARGEMENT de l’interface, pas de `ready-to-show`', () => {
    // MESURÉ : signalé à `ready-to-show`, le travail synchrone occupait le fil principal avant même
    // que `loadURL` soit demandé — écran d'attente à 6,5 s, interface réelle à 32,8 s. Reculer ce
    // signal d'un cran annulerait tout le gain.
    expect(index).toMatch(
      /webContents\.once\('did-finish-load', \(\) => \{\s*jalonDemarrage\('interface chargée'\)\s*signalerInterfaceVisible\(\)/
    )
    // ET l'écoute doit être posée DANS `chargerInterface`. Posée à la création de la fenêtre, elle
    // captait le `did-finish-load` de l'écran d'attente — MESURÉ, elle partait à 7 149 ms et le gain
    // était nul. C'est l'erreur exacte qui a été commise ici.
    const charger = index.indexOf('const chargerInterface = ()')
    // On cherche l'occurrence qui suit `chargerInterface` : le fichier en contient une autre, pour une
    // fenêtre sans rapport, et la viser donnait un faux échec.
    const ecoute = index.indexOf("webContents.once('did-finish-load'", charger)
    expect(charger).toBeGreaterThan(-1)
    expect(ecoute).toBeGreaterThan(charger)
    // La borne haute : l'écoute est bien DANS la fonction, pas quelque part plus loin dans le fichier.
    expect(ecoute).toBeLessThan(index.indexOf('mainWindow.loadURL(', charger))
    const readyToShow = index.indexOf("mainWindow.on('ready-to-show'")
    const finDeBloc = index.indexOf('})', readyToShow)
    expect(index.slice(readyToShow, finDeBloc)).not.toContain('signalerInterfaceVisible')
  })
})
