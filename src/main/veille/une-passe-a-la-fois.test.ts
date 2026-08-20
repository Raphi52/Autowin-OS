import { describe, expect, it } from 'vitest'
import { registerVeilleIpc } from './veille-ipc'
import { dispatcherAvecVeille } from './dispatch-veille'
import { unePasseALaFois } from './une-passe-a-la-fois'
import type { ResultatPasse } from './passe'
import type { ScheduledTask, TaskOccurrence } from '../task-manager/types'
import type { TaskDispatcher } from '../task-manager/task-scheduler'

/**
 * LE DEFAUT : deux chemins atteignent la MEME passe de veille et ne se voient pas.
 *
 * `veille-ipc` porte bien une garde de simultaneite, mais elle est INTERNE au module : elle ne dedoublonne
 * que l'IPC contre lui-meme. Le planificateur, lui, appelle `genererCandidatsInternesVisibles`
 * directement dans son `executerPasse` (`index.ts:4828`) et passe donc a cote. Cliquer « En generer
 * plus » pendant qu'une veille planifiee tourne lance un SECOND fan-out de scouts sur le meme stock.
 *
 * Le remede est la garde PARTAGEE : un seul `unePasseALaFois` enrobe la generation, et les deux
 * chemins recoivent la version enrobee — ils rejoignent la passe en cours au lieu d'en ouvrir une.
 */
describe('veille — une passe a la fois, tous chemins confondus', () => {
  /** Un IPC minimal : on retient le gestionnaire pour l'appeler comme le renderer le ferait. */
  const ipcFactice = (): {
    ipc: { handle: (c: string, h: (e: unknown, ...a: unknown[]) => unknown) => void }
    appeler: (canal: string, ...args: unknown[]) => unknown
  } => {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
    return {
      ipc: { handle: (c, h) => void handlers.set(c, h) },
      appeler: (canal, ...args) => handlers.get(canal)?.({ senderFrame: {} }, ...args)
    }
  }

  const tache = { id: 't', action: 'veille' } as unknown as ScheduledTask
  const occurrence = {} as TaskOccurrence
  const suivant: TaskDispatcher = {
    run: async () => ({ status: 'completed', error: undefined, outcome: undefined })
  } as unknown as TaskDispatcher

  it('le clic « En generer plus » rejoint la passe planifiee au lieu d’en lancer une seconde', async () => {
    let generations = 0
    const liberateurs: Array<() => void> = []
    // TOUS les resolveurs sont gardes : n'en retenir qu'un laissait la premiere passe pendante et
    // le test partait en timeout au lieu de dire ce qu'il mesure.
    const libererTout = (): void => liberateurs.splice(0).forEach((l) => l())
    const generationLente = (): Promise<ResultatPasse> => {
      generations += 1
      return new Promise<ResultatPasse>((resoudre) => {
        liberateurs.push(() =>
          resoudre({ retenus: 1, refuses: [], echecs: [] } as unknown as ResultatPasse)
        )
      })
    }

    // LA garde partagee : une seule instance, donnee aux DEUX chemins.
    const generer = unePasseALaFois(generationLente)

    const { ipc, appeler } = ipcFactice()
    registerVeilleIpc({ ipc, assertTrusted: () => {}, genererInterne: generer } as never)
    const dispatcher = dispatcherAvecVeille({ suivant, executerPasse: generer })

    // Le planificateur part le premier, puis l'utilisateur clique pendant que ca tourne.
    const cotePlanificateur = dispatcher.run(tache, occurrence)
    const coteClic = appeler('veille:generer', 'conv-1') as Promise<unknown>
    await Promise.resolve()

    expect(generations).toBe(1)
    libererTout()
    await Promise.all([cotePlanificateur, coteClic])
    // Le rearmement passe par un `.then` interne : on vide la file de micro-taches jusqu'au tour
    // suivant de la boucle, sinon on mesure l'etat d'AVANT et non celui d'apres. `setImmediate` et
    // non un compte arbitraire de `Promise.resolve()` : le nombre de tours n'est pas un contrat.
    await new Promise<void>((resoudre) => setImmediate(resoudre))

    // Et la garde se REARME : la passe suivante repart pour de vrai. `executer` est appele dans une
    // MICRO-TACHE, donc on lui laisse son tour AVANT de compter — mesurer juste apres l'appel
    // synchrone lisait 1 et accusait la garde a tort.
    const apres = generer()
    await Promise.resolve()
    expect(generations).toBe(2)
    libererTout()
    await apres
  })
  /**
   * LE DEFAUT LUI-MEME, reproduit sur le cablage d'AVANT : la garde interne de `veille-ipc` ne voit
   * pas le planificateur. Ce test echoue si l'on croit la garde interne suffisante — il documente
   * pourquoi elle ne l'est pas, et reste vert apres le remede parce qu'il decrit l'ancien cablage.
   */
  it('la garde interne de l’IPC seule NE protege PAS du planificateur', async () => {
    let generations = 0
    const liberateurs: Array<() => void> = []
    // TOUS les resolveurs sont gardes : n'en retenir qu'un laissait la premiere passe pendante et
    // le test partait en timeout au lieu de dire ce qu'il mesure.
    const libererTout = (): void => liberateurs.splice(0).forEach((l) => l())
    const generationLente = (): Promise<ResultatPasse> => {
      generations += 1
      return new Promise<ResultatPasse>((resoudre) => {
        liberateurs.push(() =>
          resoudre({ retenus: 1, refuses: [], echecs: [] } as unknown as ResultatPasse)
        )
      })
    }

    // Cablage d'avant : chaque chemin recoit la fonction BRUTE, la seule garde etant celle de l'IPC.
    const { ipc, appeler } = ipcFactice()
    registerVeilleIpc({ ipc, assertTrusted: () => {}, genererInterne: generationLente } as never)
    const dispatcher = dispatcherAvecVeille({ suivant, executerPasse: generationLente })

    const cotePlanificateur = dispatcher.run(tache, occurrence)
    const coteClic = appeler('veille:generer', 'conv-1') as Promise<unknown>
    await Promise.resolve()

    // DEUX fan-outs sur le meme stock : c'est exactement ce que la garde partagee supprime.
    expect(generations).toBe(2)
    libererTout()
    await Promise.all([cotePlanificateur, coteClic]).catch(() => undefined)
  })

})
