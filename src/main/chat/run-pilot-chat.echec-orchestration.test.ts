import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { creerPlan, lirePlanDeLots, marquerLance, noterFinDeTour } from '../../shared/plan-de-lots'
import { ConversationStore } from '../store/conversations'
import { createRunPilotChat, issueDuResultat, type RunPilotChatDeps } from './run-pilot-chat'

/**
 * UN LOT COUPÉ PAR LA LIMITE D'USAGE N'EST PLUS « FAIT » (plan-c21413ba, 2026-10-28).
 *
 * Le tour du lot 1 du thème Golden (tour 5bdd19cc) a fini SANS erreur : son
 * `orchestrate` avait buté sur la limite, le tour a répondu « Échec du workflow : … ». Le journal
 * du tour portait l'issue `failed`, mais le résultat du tour ne la transmettait pas : le plan de
 * lots n'en voyait que `ok: true` et notait le lot « fait ». Ici, le VRAI tour de chat tourne
 * (vrai stockage, faux modèle qui clôt sur cette issue) jusqu'au plan.
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

// Recopié de turn-journals/conv-1237/5bdd19cc-….jsonl (événement `outcome`).
const MUR =
  "Fan-out build (rôle subagent) : aucun modèle n'a produit de sortie\n• claude (claude-opus-5-5) : Claude a interrompu l'appel : You've hit your weekly limit · resets 4am (Europe/Paris)"
const TEXTE = `Échec du workflow : ${MUR}`

async function tourQuiFinitSur(outcome: Record<string, unknown> | undefined) {
  let t = 1000
  const store = new ConversationStore(() => t++)
  const fil = store.create({ title: 'Lot 1/6', provider: 'claude' })
  const pilot = {
    chat: vi.fn(async (_messages: unknown, surEvenement: (e: unknown) => void) => {
      surEvenement({ kind: 'delta', streamId: '0:0', text: TEXTE })
      surEvenement({ kind: 'done', text: TEXTE, ...(outcome ? { outcome } : {}) })
      return { text: TEXTE }
    })
  }
  const os = avecRepli({
    waitUntilReady: async () => {},
    roles: { getBinding: () => ({ provider: 'claude', model: 'modele-test' }) },
    conversations: store,
    executionSupervisor: { currentSignal: () => undefined },
    runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) => lancer()
  })
  const deps = avecRepli({
    os,
    pilot,
    pendingDirectives: new Map<string, string[]>(),
    turnJournalRoot: mkdtempSync(join(tmpdir(), 'autowin-echec-orchestration-')),
    isolatedTestInstance: false,
    broadcast: vi.fn(),
    drainPendingDirectives: () => [],
    askModelQuestion: vi.fn(),
    notifyWatchdogWorkflowIncident: vi.fn(),
    watchdogEngine: () => undefined
  }) as unknown as RunPilotChatDeps
  const resultat = await createRunPilotChat(deps)(
    undefined,
    [{ role: 'user', content: '/build lot 1' }],
    fil.id
  )
  return { fil: fil.id, resultat }
}

function planAvecLeLotDans(fil: string) {
  const lu = lirePlanDeLots({
    plafondTours: 3,
    lots: [{ demande: '/build lot 1' }, { demande: '/build lot 2' }]
  })
  if (!lu.ok) throw new Error(lu.erreur)
  const plan = { ...creerPlan(lu.plan, { id: 'plan-1', chef: 'conv-chef', maintenant: 1 }) }
  return marquerLance({ ...plan, statut: 'en-cours' }, 1, fil, 2)
}

describe('tour de chat → plan de lots : l’orchestration coupée par la limite d’usage', () => {
  it('le tour reste ok, mais son issue porte l’erreur ; le lot passe en échec et rend son tour', async () => {
    const { fil, resultat } = await tourQuiFinitSur({ status: 'failed', valid: false, error: MUR })
    expect(resultat.ok).toBe(true)
    const issue = issueDuResultat(resultat)
    expect(issue.echecOrchestration).toBe(MUR)

    const plan = planAvecLeLotDans(fil)
    expect(plan.toursLances).toBe(1)
    const note = noterFinDeTour(plan, fil, issue, 3)
    expect(note.lot?.etat).toBe('echec')
    expect(note.plan.statut).toBe('suspendu-quota')
    expect(note.plan.toursLances).toBe(0)
  })

  /*
   * Refus du contrôle final : l'issue est `failed` SANS `error`, les motifs sont dans `gateReasons`
   * (forme recopiée du journal du lot 4 du plan du coffre à clés). Le lot était noté « fait », donc
   * impossible à relancer, alors que son travail était resté dans sa copie.
   */
  it('un refus du contrôle final, sans champ error, met aussi le lot en échec', async () => {
    const motif =
      'Promis mais pas fait : « Cible nommee dans la demande reellement modifiee : src/main/ipc/chat.ts ».'
    const { fil, resultat } = await tourQuiFinitSur({
      status: 'failed',
      valid: false,
      gateBlocked: true,
      gateReasons: [motif]
    })
    const issue = issueDuResultat(resultat)
    expect(issue.echecOrchestration).toContain(motif)
    const note = noterFinDeTour(planAvecLeLotDans(fil), fil, issue, 3)
    expect(note.lot?.etat).toBe('echec')
    expect(note.lot?.raison).toMatch(/Promis mais pas fait/)
  })

  /*
   * Blocage à l'intégration : le travail est vérifié dans sa copie, mais le report dans le dossier
   * principal est refusé parce que d'autres fils y ont des fichiers non commités. Issue recopiée du
   * journal du lot 1 du plan des dérogations du linter (06/11, 10:31). Le lot ne doit être ni
   * « fait » (son travail n'est pas arrivé) ni pris pour une coupure de quota. Depuis le 06/11 au
   * soir, il ATTEND SA PUBLICATION au lieu d'échouer : relancé, il refaisait tout pour le même refus.
   */
  it('un blocage d’intégration, sans champ error, n’est pas noté fait : le lot attend sa publication', async () => {
    const blocage =
      'blocage d’intégration: base-dirty — cause: des fichiers non committés de la base bloquent la publication — fichiers en cause: src/renderer/src/components/ChatView.tsx'
    const { fil, resultat } = await tourQuiFinitSur({
      status: 'failed',
      valid: false,
      gateBlocked: true,
      gateReasons: ['intégration locale non terminée', blocage]
    })
    const issue = issueDuResultat(resultat)
    expect(issue.echecOrchestration).toContain('base-dirty')
    const note = noterFinDeTour(planAvecLeLotDans(fil), fil, issue, 3)
    expect(note.lot?.etat).toBe('attend-publication')
    expect(note.lot?.raison).toMatch(/src\/renderer\/src\/components\/ChatView\.tsx/)
    expect(note.plan.statut).not.toBe('suspendu-quota')
  })

  it('une orchestration réussie ne porte aucune erreur : le lot est fait', async () => {
    const { fil, resultat } = await tourQuiFinitSur({ status: 'succeeded', valid: true })
    const issue = issueDuResultat(resultat)
    expect(issue.echecOrchestration).toBeUndefined()
    expect(noterFinDeTour(planAvecLeLotDans(fil), fil, issue, 3).lot?.etat).toBe('fait')
  })
})
