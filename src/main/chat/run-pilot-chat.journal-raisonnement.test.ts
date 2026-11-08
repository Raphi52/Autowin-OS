import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConversationStore } from '../store/conversations'
import { attendreEcrituresJournal, readTurnJournal } from '../runs/turn-journal'
import { createRunPilotChat, type RunPilotChatDeps } from './run-pilot-chat'

/**
 * LE JOURNAL D'UN VRAI TOUR ÉCRIT LA PENSÉE PAR RAFALE, À SA PLACE ENTRE LES GESTES.
 *
 * Mesuré le 2026-11-02 sur les journaux * : 355 683 lignes `reasoning-step` (55 % du poids),
 * une par paquet reçu du modèle. Le regroupement vit dans `journalDuPiloteRegroupe` ; ce test prouve
 * son BRANCHEMENT dans le tour : vrai stockage, vrai journal fichier, faux modèle qui pense en
 * miettes, agit, puis repense.
 *
 * Ce qui ferait échouer une version fausse : 5 lignes de pensée au lieu de 2 (pas de tampon), ou la
 * première rafale écrite APRÈS la commande (tampon vidé après l'écriture durable, ou à la fin).
 */
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
vi.mock('../app/renderer-emit', () => ({ emitToLiveWindows: () => undefined }))

/** Un objet qui accepte tout appel et rend un autre objet du même genre (dépendances non observées). */
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

describe('tour de chat — la pensée regroupée dans le journal fichier', () => {
  it('deux rafales, chacune à sa place autour de la commande', async () => {
    let t = 1000
    const store = new ConversationStore(() => t++)
    const fil = store.create({ title: 'J', provider: 'codex' })
    const racine = mkdtempSync(join(tmpdir(), 'autowin-journal-raisonnement-'))
    try {
      const pilot = {
        chat: vi.fn(async (_messages: unknown, surEvenement: (e: unknown) => void) => {
          for (const morceau of ['Je ', 'lis ', 'le fichier'])
            surEvenement({ kind: 'reasoning', text: morceau, iteration: 0 })
          surEvenement({
            kind: 'command',
            actionId: 'a1',
            name: 'read_file',
            args: { path: 'x' },
            iteration: 0
          })
          surEvenement({
            kind: 'result',
            actionId: 'a1',
            name: 'read_file',
            ok: true,
            iteration: 0
          })
          for (const morceau of ['Je ', 'conclus'])
            surEvenement({ kind: 'reasoning', text: morceau, iteration: 1 })
          surEvenement({ kind: 'delta', streamId: '1:0', text: 'Fini.', iteration: 1 })
          surEvenement({ kind: 'done', text: 'Fini.' })
          return { text: 'Fini.' }
        })
      }
      const os = avecRepli({
        waitUntilReady: async () => {},
        roles: { bindingDesPetitesTaches: () => ({ provider: 'claude', model: 'claude-haiku-5-5' }), routageChatLectureSeuleActif: () => false, getBinding: () => ({ provider: 'codex', model: 'modele-test' }) },
        conversations: store,
        executionSupervisor: { currentSignal: () => undefined },
        runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) =>
          lancer()
      })
      const deps = avecRepli({
        os,
        pilot,
        pendingDirectives: new Map<string, string[]>(),
        turnJournalRoot: racine,
        isolatedTestInstance: false,
        broadcast: vi.fn(),
        drainPendingDirectives: () => [],
        notifyWatchdogWorkflowIncident: vi.fn(),
        watchdogEngine: () => undefined
      }) as unknown as RunPilotChatDeps

      const resultat = await createRunPilotChat(deps)(
        undefined,
        [{ role: 'user', content: 'lis le fichier x' }],
        fil.id
      )
      await attendreEcrituresJournal()
      const journal = readTurnJournal(racine, fil.id, String(resultat.turnId))

      const pensees = journal.filter((e) => e.kind === 'reasoning-step')
      expect(pensees.map((e) => [e.iteration, e.text, e.fragments])).toEqual([
        [0, 'Je lis le fichier', 3],
        [1, 'Je conclus', 2]
      ])
      // Chaque rafale à sa place : la première AVANT la commande, la seconde après le résultat.
      const rang = (predicat: (e: (typeof journal)[number]) => boolean): number =>
        journal.findIndex(predicat)
      const rangCommande = rang((e) => e.kind === 'command')
      const rangResultat = rang((e) => e.kind === 'result')
      expect(rang((e) => e.kind === 'reasoning-step' && e.iteration === 0)).toBeLessThan(
        rangCommande
      )
      expect(rang((e) => e.kind === 'reasoning-step' && e.iteration === 1)).toBeGreaterThan(
        rangResultat
      )
      // Le texte entier de la pensée reste écrit à la clôture, avant la fin du tour.
      const cloture = journal.find((e) => e.kind === 'reasoning')
      expect(cloture?.text).toBe('Je lis le fichierJe conclus')
      expect(rang((e) => e.kind === 'reasoning-step' && e.iteration === 1)).toBeLessThan(
        rang((e) => e.kind === 'done')
      )
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })
})
