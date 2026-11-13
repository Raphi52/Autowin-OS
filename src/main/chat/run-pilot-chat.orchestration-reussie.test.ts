import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  creerPlan,
  lirePlanDeLots,
  marquerLance,
  noterFinDeTour,
  type PlanDeLots
} from '../../shared/plan-de-lots'
import { ConversationStore } from '../store/conversations'
import { createRunPilotChat, issueDuResultat, type RunPilotChatDeps } from './run-pilot-chat'

/*
 * UN TRAVAIL VALIDÉ DANS LE FIL D'UN LOT EN ÉCHEC LE RATTRAPE (2026-11-06).
 *
 * Le plan ne distinguait pas, dans le fil d'un lot déjà noté, un travail validé par le contrôle
 * final d'une simple réponse : le résultat du tour ne portait que l'échec d'un `orchestrate`, jamais
 * sa réussite. Ici le VRAI tour de chat tourne (vrai stockage, faux modèle qui clôt sur l'issue)
 * jusqu'au plan, pour que la réussite vienne bien de l'issue de l'orchestration.
 */
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
vi.mock('../app/renderer-emit', () => ({ emitToLiveWindows: () => {} }))

/** Accepte tout appel et rend un objet du même genre : les dépendances non observées. */
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

const TEXTE = '✅ Workflow terminé · statut succeeded'

async function tourQuiFinitSur(outcome: Record<string, unknown> | undefined) {
  let t = 1000
  const store = new ConversationStore(() => t++)
  const fil = store.create({ title: 'Lot 3/6', provider: 'claude' })
  const pilot = {
    chat: vi.fn(async (_messages: unknown, surEvenement: (e: unknown) => void) => {
      surEvenement({ kind: 'delta', streamId: '0:0', text: TEXTE })
      surEvenement({ kind: 'done', text: TEXTE, ...(outcome ? { outcome } : {}) })
      return { text: TEXTE }
    })
  }
  const os = avecRepli({
    waitUntilReady: async () => {},
    roles: {
      bindingDesPetitesTaches: () => ({ provider: 'claude', model: 'claude-haiku-5-5' }),
      routageChatLectureSeuleActif: () => false,
      getBinding: () => ({ provider: 'claude', model: 'modele-test' })
    },
    conversations: store,
    executionSupervisor: { currentSignal: () => undefined },
    runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) => lancer()
  })
  const deps = avecRepli({
    os,
    pilot,
    pendingDirectives: new Map<string, string[]>(),
    turnJournalRoot: mkdtempSync(join(tmpdir(), 'autowin-orchestration-reussie-')),
    isolatedTestInstance: false,
    broadcast: vi.fn(),
    drainPendingDirectives: () => [],
    notifyWatchdogWorkflowIncident: vi.fn(),
    watchdogEngine: () => undefined
  }) as unknown as RunPilotChatDeps
  const resultat = await createRunPilotChat(deps)(
    undefined,
    [{ role: 'user', content: 'reprends le lot 3' }],
    fil.id
  )
  return { fil: fil.id, resultat }
}

/** Un plan dont le lot 1, parti dans `fil`, a été refusé par le contrôle final. */
function planAvecLeLotEnEchecDans(fil: string): PlanDeLots {
  const lu = lirePlanDeLots({
    plafondTours: 3,
    lots: [
      { demande: '/build lot 1', critere: 'le résultat se constate et ses tests passent' },
      { demande: '/build lot 2', critere: 'le résultat se constate et ses tests passent' }
    ]
  })
  if (!lu.ok) throw new Error(lu.erreur)
  const plan = creerPlan(lu.plan, { id: 'plan-1', chef: 'conv-chef', maintenant: 1 })
  const lance = marquerLance({ ...plan, statut: 'en-cours' }, 1, fil, 2)
  return noterFinDeTour(
    lance,
    fil,
    { ok: true, echecOrchestration: 'refusé par le contrôle final : Promis mais pas fait' },
    3
  ).plan
}

describe('tour de chat → plan de lots : le travail validé dans le fil d’un lot en échec', () => {
  it('l’issue porte la réussite de l’orchestration, et le lot en échec est rendu au chef', async () => {
    const { fil, resultat } = await tourQuiFinitSur({ status: 'succeeded', valid: true })
    const issue = issueDuResultat(resultat)
    expect(issue.orchestrationReussie).toBe(true)
    expect(issue.echecOrchestration).toBeUndefined()

    const plan = planAvecLeLotEnEchecDans(fil)
    expect(plan.lots[0].etat).toBe('echec')
    const note = noterFinDeTour(plan, fil, issue, 4)
    expect(note.effet).toBe('note')
    expect(note.lot?.etat).toBe('a-recevoir')
  })

  it('jumeau : une orchestration refusée ne porte pas de réussite, le lot reste en échec', async () => {
    const { fil, resultat } = await tourQuiFinitSur({
      status: 'failed',
      valid: false,
      gateBlocked: true,
      gateReasons: ['Promis mais pas fait']
    })
    const issue = issueDuResultat(resultat)
    expect(issue.orchestrationReussie).toBeUndefined()
    const plan = planAvecLeLotEnEchecDans(fil)
    expect(noterFinDeTour(plan, fil, issue, 4).plan).toBe(plan)
  })

  it('jumeau : un tour sans orchestration ne porte pas de réussite', async () => {
    const { resultat } = await tourQuiFinitSur(undefined)
    expect(issueDuResultat(resultat).orchestrationReussie).toBeUndefined()
  })
})
