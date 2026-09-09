import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { AppCommandBus } from './commands'

/**
 * LE BOUTON STOP DOIT ATTEINDRE LE PROGRAMME LANCE PAR `run`.
 *
 * DEFAUT VECU (conv-384, 2026-09-09). L'agent lance `dotnet run` sur une application a fenetre :
 * ce programme ne rend JAMAIS la main. Le tour reste bloque dans `spawnVerify`, dont la seule
 * sortie prematuree etait l'horloge `verifyTimeoutMs()`. L'utilisateur clique Stop : rien. Il
 * ecrit un message : personne ne le lit, le tour precedent occupe encore la place. De son point de
 * vue le bouton est casse -- en realite il n'etait relie a rien de ce cote.
 *
 * `abortOrchestration` coupait les orchestrations, `activeChatTurns` les tours de chat ; ni l'un
 * ni l'autre n'atteignait l'enfant lance par `run`.
 *
 * Ce test exerce le VRAI `spawnVerify`, avec un vrai process : c'est la seule facon de prouver la
 * mise a mort. Un `spawnVerify` mocke (comme dans `commands.run-autorisation.test.ts`) prouverait
 * seulement qu'on lui passe un argument.
 */
type Message = { role: 'user' | 'assistant'; content: string }

function busAvecFil(messages: Message[]): AppCommandBus {
  const os = {
    executionWorkspace: process.cwd(),
    conversations: {
      get: () => ({ id: 'conv-1', messages }),
      list: () => [],
      attachRun: () => undefined
    },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 })
  }
  return new AppCommandBus(os as never, () => {})
}

/** Une commande qui occupe le terrain assez longtemps pour qu'un Stop ait un sens. */
const COMMANDE_LONGUE = process.platform === 'win32' ? 'ping -n 30 127.0.0.1' : 'sleep 30'
const BINAIRE = process.platform === 'win32' ? 'ping' : 'sleep'

const fil = (): Message[] => [
  { role: 'user', content: `Autorise les commandes ${BINAIRE}` }
]

describe('run — le Stop de l’utilisateur coupe le programme lancé', () => {
  // Le droit est memorise hors conversation : chaque cas part d'une racine de donnees neuve.
  beforeEach(() => configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'autowin-stop-'))))

  it('rend la main tout de suite quand le tour est interrompu, au lieu d’attendre le plafond', async () => {
    const bus = busAvecFil(fil())
    const controller = new AbortController()
    bus.signalDuTour = () => controller.signal

    const debut = Date.now()
    const promesse = bus.exec('run', { commande: COMMANDE_LONGUE }, 'conv-1')
    // Laisse le process demarrer pour de bon : couper avant le spawn ne prouverait rien.
    await new Promise((resolve) => setTimeout(resolve, 500))
    controller.abort('user')

    // `exec` enveloppe : le verdict de la commande vit dans `data`, pas a la racine.
    const resultat = (await promesse).data as { exitCode?: number | null; detail?: string }
    const ecoule = Date.now() - debut

    // La commande dure 30 s ; le plafond est bien plus haut encore. Revenir en quelques secondes
    // ne peut donc venir que de la mise a mort.
    expect(ecoule).toBeLessThan(10_000)
    expect(resultat.exitCode).toBeNull()
    expect(String(resultat.detail)).toContain('arret demande')
  }, 20_000)

  it('ne change RIEN quand aucun signal n’est câblé : une commande courte va au bout', async () => {
    const bus = busAvecFil([{ role: 'user', content: `Autorise les commandes ${BINAIRE}` }])
    // `signalDuTour` non cable — c'est l'etat d'avant la correction, il doit rester intact.
    const bref = process.platform === 'win32' ? 'ping -n 1 127.0.0.1' : 'sleep 0'

    const resultat = (await bus.exec('run', { commande: bref }, 'conv-1')).data as {
      exitCode?: number | null
      detail?: string
    }

    expect(resultat.exitCode).toBe(0)
    expect(String(resultat.detail)).not.toContain('arret demande')
  }, 20_000)
})
