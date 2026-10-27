import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConversationStore } from '../store/conversations'
import { createRunPilotChat, type RunPilotChatDeps } from './run-pilot-chat'

/**
 * LA RÉPONSE EST ENREGISTRÉE SOUS LE TOUR QUE L'ÉCRAN A REÇU EN DIRECT (conv-1147, 2026-10-25).
 *
 * « Lancer en N fils » retrouve sur DISQUE la réponse qui porte la carte par son TOUR, le seul repère
 * qu'une réponse peinte en direct possède (`ChatView.tsx`, `lancerEnFils`). Ce n'est juste que si le
 * tour diffusé à l'écran (`pilot:event`) est celui sous lequel le stockage range la réponse. Le test
 * de la mosaïque, côté écran, ne pouvait pas le prouver : il choisissait lui-même le tour des deux
 * côtés (4e relecture externe). Ici, le VRAI tour de chat tourne : vrai stockage, faux modèle qui
 * écrit une carte, et capture de ce qui part vers l'écran.
 *
 * Ce qui ferait échouer une version fausse : un tour diffusé différent du tour enregistré, une
 * réponse enregistrée sans tour, ou une diffusion avant l'enregistrement (l'écran pourrait alors
 * cliquer sur une carte que le disque n'a pas encore).
 */
const capture = vi.hoisted(() => ({
  emis: [] as Array<{ canal: string; payload: Record<string, unknown> }>,
  /** Ce que le disque porte AU MOMENT de chaque diffusion vers l'écran. */
  disqueAuMoment: [] as Array<unknown[]>,
  lireDisque: (() => []) as () => unknown[]
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
vi.mock('../renderer-emit', () => ({
  emitToLiveWindows: (_fenetres: unknown, canal: string, payload: Record<string, unknown>) => {
    capture.emis.push({ canal, payload })
    capture.disqueAuMoment.push(structuredClone(capture.lireDisque()))
  }
}))

/** Un objet qui accepte tout appel et rend un autre objet du même genre : les dépendances que ce
 * test n'observe pas (traces, coûts, tâches planifiées). */
function souple(): never {
  const fn = (): unknown => souple()
  return new Proxy(fn, {
    get: (_cible, cle) => {
      if (cle === 'then') return undefined
      // Itérable vide : une boucle sur une dépendance non observée ne fait rien.
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

const CARTE =
  'Deux tâches.\n\n```aw-fils\n{"taches":[{"titre":"T1","demande":"fais T1","fichiers":["a.ts"]},' +
  '{"titre":"T2","demande":"fais T2","fichiers":["b.ts"]}]}\n```\n'

describe('tour de chat — la réponse enregistrée porte le tour diffusé en direct', () => {
  it('même tour à l’écran et sur disque, et le disque l’a déjà quand l’écran reçoit la fin', async () => {
    let t = 1000
    const store = new ConversationStore(() => t++)
    const fil = store.create({ title: 'B', provider: 'codex' })
    capture.lireDisque = () => store.messagesOf(fil.id)

    const pilot = {
      chat: vi.fn(async (_messages: unknown, surEvenement: (e: unknown) => void) => {
        surEvenement({ kind: 'delta', streamId: '0:0', text: CARTE })
        surEvenement({ kind: 'done', text: CARTE })
        return { text: CARTE }
      })
    }
    const os = avecRepli({
      waitUntilReady: async () => {},
      roles: { getBinding: () => ({ provider: 'codex', model: 'modele-test' }) },
      conversations: store,
      executionSupervisor: { currentSignal: () => undefined },
      runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) => lancer()
    })
    const deps = avecRepli({
      os,
      pilot,
      pendingDirectives: new Map<string, string[]>(),
      turnJournalRoot: mkdtempSync(join(tmpdir(), 'autowin-tour-enregistre-')),
      isolatedTestInstance: false,
      broadcast: vi.fn(),
      drainPendingDirectives: () => [],
      askModelQuestion: vi.fn(),
      notifyWatchdogWorkflowIncident: vi.fn(),
      watchdogEngine: () => undefined
    }) as unknown as RunPilotChatDeps

    const resultat = await createRunPilotChat(deps)(
      undefined,
      [{ role: 'user', content: 'fais T1 et T2' }],
      fil.id
    )

    // Le tour que l'écran a reçu en direct…
    const enDirect = capture.emis.filter((e) => e.canal === 'pilot:event')
    expect(enDirect.length, 'le tour doit diffuser vers l’écran').toBeGreaterThan(0)
    const toursDiffuses = new Set(enDirect.map((e) => e.payload.turnId))
    expect(toursDiffuses.size).toBe(1)
    const tourDiffuse = [...toursDiffuses][0]
    expect(typeof tourDiffuse).toBe('string')
    expect(enDirect.every((e) => e.payload.conversationId === fil.id)).toBe(true)
    expect(resultat.turnId).toBe(tourDiffuse)

    // … est celui sous lequel le disque range la réponse qui porte la carte.
    const reponse = store.messagesOf(fil.id).find((m) => m.role === 'assistant')
    expect(reponse?.turnId).toBe(tourDiffuse)
    expect(reponse?.messageId).toBeTruthy()
    expect(JSON.stringify(reponse)).toContain('aw-fils')

    // Chaque morceau de texte est sur le disque AVANT d'être montré : l'écran ne montre jamais
    // une carte que le disque n'a pas encore.
    const deltas = capture.emis.flatMap((e, i) =>
      e.canal === 'pilot:event' && e.payload.kind === 'delta' ? [i] : []
    )
    expect(deltas.length).toBeGreaterThan(0)
    for (const i of deltas)
      expect(JSON.stringify(capture.disqueAuMoment[i]), `diffusion n°${i}`).toContain('aw-fils')

    // Et le disque l'avait DÉJÀ quand l'écran a reçu la fin du tour : un clic juste après ne
    // tombe pas sur « réponse introuvable ».
    const rangFin = enDirect.findIndex((e) => e.payload.kind === 'done')
    expect(rangFin, 'la fin du tour doit être diffusée').toBeGreaterThanOrEqual(0)
    const indexFin = capture.emis.indexOf(enDirect[rangFin]!)
    const disqueAlaFin = capture.disqueAuMoment[indexFin] as Array<{
      role: string
      turnId?: string
    }>
    expect(disqueAlaFin.some((m) => m.role === 'assistant' && m.turnId === tourDiffuse)).toBe(true)
  })
})
