import { describe, expect, it } from 'vitest'
import { WatchdogEngine, type WatchdogDispatch } from './watchdog-engine'
import type { ScheduledTask, WatchdogSignal } from './types'

/**
 * LA GARDE DE LARGEUR NE POUVAIT PAS MORDRE — et personne ne le voyait.
 *
 * `maxPerRoot` existe pour rattacher une cascade a UNE cause : « une panne unique fait echouer des
 * dizaines d'orchestrations », dit le semis. Mais pour un evenement de PREMIER niveau il n'y a
 * aucune racine heritee, et le moteur fabriquait alors la racine en collant l'horodatage a la
 * signature. Chaque reveil devenait donc sa propre cause racine, et le compteur de largeur valait 1,
 * pour toujours.
 *
 * Mesure du 2026-09-07 : les neuf reveils enregistres dans `scheduled-tasks.json` portaient neuf
 * racines distinctes, toutes terminees par `@<millisecondes>`. Le plafond de largeur 3 de la regle
 * auto-kaizen n'a jamais pu refuser un seul reveil.
 *
 * POURQUOI AUCUN TEST NE L'AVAIT VU : l'horloge de `watchdog-engine.test.ts` rend une constante
 * (`now: () => 1_000_000`). Avec une horloge figee, l'horodatage colle a la signature est le meme a
 * chaque appel et la racine reste stable — le defaut disparait exactement dans le seul endroit ou on
 * l'aurait attrape. Ce test fait donc AVANCER l'horloge : c'est tout ce qui manquait.
 *
 * `admit(signature, depth, rootSignature = signature)` dit deja quelle est la bonne valeur par
 * defaut : la signature elle-meme. Le correctif rend cette intention au moteur, il n'en invente pas
 * une autre.
 */
function spy(): WatchdogDispatch & { calls: WatchdogSignal[] } {
  const calls: WatchdogSignal[] = []
  return {
    calls,
    async runWatchdog(_taskId, signal) {
      calls.push(signal)
      return true
    }
  }
}

function regleSurEvenement(): ScheduledTask {
  return {
    id: 'task-1',
    title: 'Surveiller les rouges',
    prompt: 'Analyse cet incident.',
    enabled: true,
    mode: 'active-only',
    destination: { kind: 'new', title: 'Incidents', category: 'ops', provider: 'claude' },
    watchdog: {
      source: { kind: 'app-event', events: ['orchestration-red'] },
      action: 'orchestration',
      guards: {
        // Zero : on eprouve la LARGEUR, pas la fenetre d'apaisement.
        dedupWindowMs: 0,
        maxTriggersPerHour: 100,
        maxChainDepth: 0,
        maxPerRoot: 1
      }
    },
    nextRunAt: null,
    createdAt: 0,
    updatedAt: 0
  }
}

/** Une horloge qui AVANCE — la difference avec les tests existants, et tout le defaut. */
function horlogeQuiAvance(pasMs: number) {
  let maintenant = 1_000_000
  return {
    now: () => (maintenant += pasMs),
    setTimer: () => undefined,
    clearTimer: () => undefined
  }
}

describe('WatchdogEngine — la racine d’un evenement de premier niveau', () => {
  it('reste la MEME d’un reveil a l’autre, donc le plafond de largeur mord', async () => {
    const dispatch = spy()
    const task = regleSurEvenement()
    const engine = new WatchdogEngine(() => [task], dispatch, horlogeQuiAvance(500))
    await engine.start()

    await engine.notifyAppEvent('orchestration-red', 'run : run-abc conversation : conv-21')
    await engine.notifyAppEvent('orchestration-red', 'run : run-abc conversation : conv-21')

    expect(dispatch.calls).toHaveLength(1)
    expect(engine.lastSuppression(task.id)).toBe('root-width')
  })

  it('deux incidents DIFFERENTS gardent chacun leur racine', async () => {
    const dispatch = spy()
    const task = regleSurEvenement()
    const engine = new WatchdogEngine(() => [task], dispatch, horlogeQuiAvance(500))
    await engine.start()

    await engine.notifyAppEvent('orchestration-red', 'run : run-abc conversation : conv-21')
    await engine.notifyAppEvent('orchestration-red', 'run : run-zzz conversation : conv-43')

    expect(dispatch.calls).toHaveLength(2)
    expect(dispatch.calls[0].rootSignature).not.toBe(dispatch.calls[1].rootSignature)
  })

  it('la racine ne porte plus d’horodatage : elle nomme la cause, pas l’instant', async () => {
    const dispatch = spy()
    const task = regleSurEvenement()
    const engine = new WatchdogEngine(() => [task], dispatch, horlogeQuiAvance(500))
    await engine.start()

    await engine.notifyAppEvent('orchestration-red', 'run : run-abc conversation : conv-21')

    expect(dispatch.calls).toHaveLength(1)
    expect(dispatch.calls[0].rootSignature).toBe(dispatch.calls[0].signature)
  })
})
