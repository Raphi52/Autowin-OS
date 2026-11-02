import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { ConversationStore } from '../store/conversations'
import { etatDeRepriseDuFil } from './reprise-fil-apres-quota'
import { createRunPilotChat, type RunPilotChatDeps } from './run-pilot-chat'

/**
 * SEUL UN TOUR OUVERT DEPUIS LE CHAT REPART SEUL APRÈS UNE COUPURE (conv-1423, 2026-11-01).
 *
 * Le contrôle final a trouvé `conv-879` (Assistant mails, coupé pendant un mail) annoncé « repart
 * seul ». Un tour de règle y est borné (`chat-dispatch.ts:232-246`), la reprise, elle, n'a aucune
 * borne. Ici, le VRAI tour de chat tourne sur le vrai stockage, avec un faux modèle coupé par le
 * quota, et la VRAIE décision lit ce qu'il a écrit : le fait et sa lecture ne peuvent pas diverger.
 *
 * fix-ok: `etatDeRepriseDuFil` ne lisait rien de l'origine du tour coupé, et aucun tour n'en écrivait
 * rien : `conv-879` sortait « attente » (essai du contrôle final).
 */
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
vi.mock('../renderer-emit', () => ({ emitToLiveWindows: () => undefined }))

/** Accepte tout appel : les dépendances que ce test n'observe pas (traces, coûts, tâches). */
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

const COUPE_A = Date.parse('2026-11-01T10:00:00+01:00')
const MUR = "You've hit your 5-hour limit · resets 11pm (Europe/Paris)"
/** Une fenêtre : le tour ne s'en sert que pour poser une question, jamais ici. */
const FENETRE = {} as WebContents
/** Les bornes d'une règle mail, telles que `chat-dispatch.ts` les donne : le cas de `conv-879`. */
const BORNES_DE_REGLE = { readOnly: false, maxIterations: 6, background: true, maxBudgetUsd: 0.5 }

function banc(chat: () => Promise<unknown>): {
  store: ConversationStore
  filId: string
  lancer: ReturnType<typeof createRunPilotChat>
} {
  const store = new ConversationStore(() => COUPE_A)
  const fil = store.create({ title: 'B', provider: 'codex' })
  const os = avecRepli({
    waitUntilReady: async () => {},
    roles: { getBinding: () => ({ provider: 'codex', model: 'modele-test' }) },
    conversations: store,
    executionSupervisor: { currentSignal: () => undefined },
    runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) => lancer()
  })
  const deps = avecRepli({
    os,
    pilot: { chat },
    pendingDirectives: new Map<string, string[]>(),
    turnJournalRoot: mkdtempSync(join(tmpdir(), 'autowin-origine-du-tour-')),
    isolatedTestInstance: false,
    broadcast: vi.fn(),
    drainPendingDirectives: () => [],
    askModelQuestion: vi.fn(),
    notifyWatchdogWorkflowIncident: vi.fn(),
    watchdogEngine: () => undefined
  }) as unknown as RunPilotChatDeps
  return { store, filId: fil.id, lancer: createRunPilotChat(deps) }
}

const reponseFinie = async (): Promise<{ text: string }> => ({ text: 'fait' })
const coupeParLeQuota = async (): Promise<never> => {
  throw new Error(MUR)
}

/** La vraie décision, sur le vrai fil enregistré. */
function etatSurDisque(store: ConversationStore, id: string): unknown {
  return etatDeRepriseDuFil({
    fil: store.get(id)!,
    maintenant: COUPE_A + 60_000,
    planDeLots: () => false,
    runAReprendre: () => false
  })
}

describe('le tour écrit d’où il vient', () => {
  const demande = [{ role: 'user' as const, content: 'corrige a.ts' }]

  it('ouvert depuis une fenêtre : marqué', async () => {
    const { store, filId, lancer } = banc(reponseFinie)
    await lancer(FENETRE, demande, filId)
    expect(store.messagesOf(filId).at(-1)?.runtime?.ouvertDepuisLeChat).toBe(true)
  })

  it('jumeau : le même tour sans fenêtre n’a aucune marque', async () => {
    const { store, filId, lancer } = banc(reponseFinie)
    await lancer(undefined, demande, filId)
    const reponse = store.messagesOf(filId).at(-1)
    expect(reponse?.role).toBe('assistant')
    expect(reponse?.runtime).toBeDefined()
    expect(reponse?.runtime).not.toHaveProperty('ouvertDepuisLeChat')
  })

  it('le bouton « Reprendre » vient d’une fenêtre : sa suite est marquée', async () => {
    const { store, filId, lancer } = banc(reponseFinie)
    await lancer(undefined, demande, filId)
    await lancer(
      FENETRE,
      [...demande, { role: 'user', content: 'continue' }],
      filId,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    )
    expect(store.messagesOf(filId).at(-1)?.runtime?.ouvertDepuisLeChat).toBe(true)
  })

  it('jumeau : une suite sans fenêtre n’est pas marquée', async () => {
    const { store, filId, lancer } = banc(reponseFinie)
    await lancer(FENETRE, demande, filId)
    await lancer(
      undefined,
      [...demande, { role: 'user', content: 'continue' }],
      filId,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    )
    expect(store.messagesOf(filId).at(-1)?.runtime).not.toHaveProperty('ouvertDepuisLeChat')
  })
})

describe('un tour coupé par le quota : la vraie décision sur le vrai fil', () => {
  const mail = [{ role: 'user' as const, content: 'Un mail vient d’arriver, trie-le.' }]

  it('une règle bornée reste à relancer à la main', async () => {
    const { store, filId, lancer } = banc(coupeParLeQuota)
    await lancer(undefined, mail, filId, undefined, undefined, BORNES_DE_REGLE)
    const coupe = store.messagesOf(filId).at(-1)
    expect(coupe?.status).toBe('failed')
    expect(coupe?.error).toContain('5-hour limit')
    expect(etatSurDisque(store, filId)).toEqual({ etat: 'manuelle', raison: 'hors-du-chat' })
  })

  it('une tâche planifiée sans bornes, ou le scout : pareil', async () => {
    const { store, filId, lancer } = banc(coupeParLeQuota)
    await lancer(undefined, mail, filId)
    expect(etatSurDisque(store, filId)).toEqual({ etat: 'manuelle', raison: 'hors-du-chat' })
  })

  it('jumeau : la même coupure dans un tour ouvert depuis le chat repart seule', async () => {
    const { store, filId, lancer } = banc(coupeParLeQuota)
    await lancer(FENETRE, mail, filId)
    expect(etatSurDisque(store, filId)).toMatchObject({ etat: 'attente' })
  })
})

/*
 * Une branche recopie le tour coupé tel quel. Le vrai `fork` compte ici : c'est lui qui dit qu'un tour
 * est copié, et la règle ne vaut que s'il le dit toujours.
 */
describe('une branche posée sur un tour coupé : le vrai `fork` sur le vrai fil', () => {
  const demande = [{ role: 'user' as const, content: 'corrige a.ts' }]
  const coupureDe = (store: ConversationStore, id: string): string =>
    store.messagesOf(id).at(-1)!.messageId!

  it('le fil repart, pas sa branche', async () => {
    const { store, filId, lancer } = banc(coupeParLeQuota)
    await lancer(FENETRE, demande, filId)
    const branche = store.fork(filId, coupureDe(store, filId))
    expect(etatSurDisque(store, filId)).toMatchObject({ etat: 'attente' })
    expect(etatSurDisque(store, branche.id)).toEqual({ etat: 'manuelle', raison: 'branche' })
  })

  it('une branche de branche non plus', async () => {
    const { store, filId, lancer } = banc(coupeParLeQuota)
    await lancer(FENETRE, demande, filId)
    const branche = store.fork(filId, coupureDe(store, filId))
    const sousBranche = store.fork(branche.id, coupureDe(store, branche.id))
    expect(etatSurDisque(store, sousBranche.id)).toEqual({ etat: 'manuelle', raison: 'branche' })
  })

  it('jumeau : un tour coupé DANS la branche est le sien, et il repart', async () => {
    const { store, filId, lancer } = banc(coupeParLeQuota)
    await lancer(FENETRE, demande, filId)
    const branche = store.fork(filId, coupureDe(store, filId))
    await lancer(FENETRE, [...demande, { role: 'user', content: 'essaie autrement' }], branche.id)
    expect(etatSurDisque(store, branche.id)).toMatchObject({ etat: 'attente' })
  })
})
