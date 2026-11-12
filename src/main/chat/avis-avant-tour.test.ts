import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConversationStore } from '../store/conversations'
import { creerAvisAvantTour } from './avis-avant-tour'
import { createRunPilotChat, type RunPilotChatDeps } from './run-pilot-chat'

/**
 * « Quand le message copie apparaît, ça fait clignoter mon message envoyé » (2026-11-12).
 *
 * L'annonce « 📂 Ce fil travaille maintenant dans sa propre copie » s'écrivait pendant la
 * préparation du tour, avant que `beginTurn` enregistre le message envoyé ; son rafraîchissement
 * repeignait le fil depuis le disque, sans le message, qui revenait ensuite SOUS l'annonce. Ce test
 * passe par le vrai store et le vrai départ du tour : rouge si l'avis n'entre pas au début du tour.
 */
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
vi.mock('../app/renderer-emit', () => ({ emitToLiveWindows: () => {} }))

function souple(): never {
  const fn = (): unknown => souple()
  return new Proxy(fn, {
    get: (_cible, cle) => {
      if (cle === 'then') return undefined
      if (cle === Symbol.iterator) return () => [][Symbol.iterator]()
      if (cle === Symbol.toPrimitive) return () => ''
      return souple()
    },
    apply: () => souple()
  }) as never
}

const avecRepli = <T extends object>(propres: T): T =>
  new Proxy(propres, {
    get: (cible, cle) => (cle in cible ? cible[cle as keyof T] : souple())
  })

const ANNONCE = '📂 Ce fil travaille maintenant dans sa propre copie de AutoWinOS (D:\\copie).'
const DEMANDE = 'corrige le bouton copier'

type Ligne = { role: string; content: string; turnId?: string }
const lignes = (store: ConversationStore, id: string): Ligne[] =>
  (store.get(id)?.messages ?? []).map((m) => ({
    role: m.role,
    content: String(m.content ?? ''),
    ...(m.turnId ? { turnId: m.turnId } : {})
  }))

function monterLeTour(store: ConversationStore, filId: string) {
  const rafraichir = vi.fn()
  const avis = creerAvisAvantTour({ fil: store, rafraichir })
  let filVuParLeModele: Ligne[] = []
  const pilot = {
    chat: vi.fn(async (_messages: unknown, surEvenement: (e: unknown) => void) => {
      filVuParLeModele = lignes(store, filId)
      surEvenement({ kind: 'done', text: 'corrigé' })
      return { text: 'corrigé' }
    })
  }
  const os = avecRepli({
    waitUntilReady: async () => {},
    roles: {
      bindingDesPetitesTaches: () => ({ provider: 'claude', model: 'claude-haiku-5-5' }),
      routageChatLectureSeuleActif: () => false,
      getBinding: () => ({ provider: 'codex', model: 'modele-test' })
    },
    conversations: store,
    executionSupervisor: { currentSignal: () => undefined },
    runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) => lancer()
  })
  const lancerTour = createRunPilotChat(
    avecRepli({
      os,
      pilot,
      pendingDirectives: new Map<string, string[]>(),
      turnJournalRoot: mkdtempSync(join(tmpdir(), 'autowin-avis-avant-tour-')),
      isolatedTestInstance: false,
      broadcast: vi.fn(),
      drainPendingDirectives: () => [],
      notifyWatchdogWorkflowIncident: vi.fn(),
      watchdogEngine: () => undefined,
      libererLesAvisDAvantTour: (id: string) => avis.liberer(id)
    }) as unknown as RunPilotChatDeps
  )
  return { avis, rafraichir, lancerTour, vuParLeModele: () => filVuParLeModele }
}

describe('avis de l’app écrits pendant la préparation du tour', () => {
  it('passent sous le message envoyé, sans repeindre le fil tant qu’il n’est pas enregistré', async () => {
    let t = 1000
    const store = new ConversationStore(() => t++)
    const fil = store.create({ title: 'copie', provider: 'codex' })
    const { avis, rafraichir, lancerTour, vuParLeModele } = monterLeTour(store, fil.id)

    // Même câblage que `tourCompteDesReception` (ipc/chat.ts) : rétention en tête de la préparation,
    // libération au début du tour, puis à la fin de la préparation.
    avis.retenir(fil.id)
    avis.annoncer(fil.id, ANNONCE)
    // Le message n'est pas encore sur le disque : repeindre maintenant le ferait disparaître.
    expect(rafraichir).not.toHaveBeenCalled()
    expect(lignes(store, fil.id).map((m) => m.content)).not.toContain(ANNONCE)
    await lancerTour(undefined, [{ role: 'user', content: DEMANDE }], fil.id).finally(() =>
      avis.liberer(fil.id)
    )

    // Dès le début du tour, l'avis est entre le message et la réponse encore vierge.
    expect(vuParLeModele().map((m) => [m.role, m.content])).toEqual([
      ['user', DEMANDE],
      ['assistant', ANNONCE],
      ['assistant', '']
    ])
    expect(vuParLeModele()[2].turnId).toBeTruthy()
    expect(rafraichir).toHaveBeenCalledTimes(1)
    const final = lignes(store, fil.id)
    expect(final.map((m) => m.content).slice(0, 2)).toEqual([DEMANDE, ANNONCE])
    expect(final[2].turnId).toBeTruthy()
  })

  it('un tour qui échoue avant de commencer garde ses avis, écrits à la fin de la préparation', async () => {
    let t = 1000
    const store = new ConversationStore(() => t++)
    const fil = store.create({ title: 'refus', provider: 'codex' })
    const rafraichir = vi.fn()
    const avis = creerAvisAvantTour({ fil: store, rafraichir })

    const preparation = async (): Promise<never> => {
      avis.retenir(fil.id)
      avis.annoncer(fil.id, ANNONCE)
      throw new Error('copie impossible')
    }
    await expect(preparation().finally(() => avis.liberer(fil.id))).rejects.toThrow(
      'copie impossible'
    )

    expect(lignes(store, fil.id).map((m) => m.content)).toEqual([ANNONCE])
    expect(rafraichir).toHaveBeenCalledTimes(1)
  })

  it('hors préparation, un avis s’écrit et se montre tout de suite', () => {
    let t = 1000
    const store = new ConversationStore(() => t++)
    const fil = store.create({ title: 'direct', provider: 'codex' })
    const rafraichir = vi.fn()
    creerAvisAvantTour({ fil: store, rafraichir }).annoncer(fil.id, ANNONCE)
    expect(lignes(store, fil.id).map((m) => m.content)).toEqual([ANNONCE])
    expect(rafraichir).toHaveBeenCalledWith(fil.id)
  })
})
