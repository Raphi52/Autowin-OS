/**
 * Les TESTS LANCÉS DANS LE TERMINAL DE L'AGENT sont gardés avec le tour (conv-1059, 2026-10-22 :
 * « garde leur code de sortie dans le tour, puis lis-le dans carte-du-fil.ts comme une
 * vérification »).
 *
 * Chemin couvert, du tour au fil : événement `tests-du-terminal` -> état du tour -> message du store
 * -> validation du fichier disque -> message relu (`hydrateStoredAssistant`) ; et en DIRECT :
 * événement du pilote -> message vivant (`reduceAssistantPilotEvent`), sans qu'un événement suivant
 * l'efface. La lecture par la carte est couverte par carte-du-fil.test.ts, la capture des codes par
 * tests-du-terminal.test.ts et claude.tests-du-terminal.test.ts.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { TESTS_DU_TERMINAL_MAX, createChatTurn, reduceChatTurn } from './chat-turn'
import { applyTurnEventToMessages, type Msg } from '../main/store/conversations'
import {
  hydrateStoredAssistant,
  reduceAssistantPilotEvent
} from '../renderer/src/components/chat-view-model'
import { ConversationPersistenceError, loadConversations } from '../main/store/conversations-disk'

const racine = mkdtempSync(join(tmpdir(), 'autowin-tests-du-terminal-'))
afterAll(() => rmSync(racine, { recursive: true, force: true }))

const VITEST = { commande: 'npx vitest run a.test.ts', codeDeSortie: 0 }
const TYPECHECK = { commande: 'npm run typecheck', codeDeSortie: 2 }

function ecrire(nom: string, testsDuTerminal: unknown): string {
  const path = join(racine, `${nom}.json`)
  writeFileSync(
    path,
    JSON.stringify([
      {
        schemaVersion: 3,
        id: 'conv-1',
        title: 'Terminal',
        category: 'claude',
        provider: 'claude',
        messages: [
          { role: 'user', content: 'q', ts: 1 },
          {
            role: 'assistant',
            content: 'r',
            ts: 2,
            turnId: 't1',
            status: 'completed',
            parts: [],
            testsDuTerminal
          }
        ],
        workspaceId: 'workspace-conv-1',
        createdAt: 1,
        updatedAt: 2
      }
    ]),
    'utf8'
  )
  return path
}

describe('les tests du terminal sont gardés avec le tour', () => {
  it('s’ajoutent dans l’ordre, datés, sans toucher au statut ni à la réponse', () => {
    const tour = reduceChatTurn(createChatTurn('t1'), { kind: 'delta', streamId: 's', text: 'x' })
    const un = reduceChatTurn(tour, { kind: 'tests-du-terminal', tests: [TYPECHECK], at: 10 })
    const deux = reduceChatTurn(un, { kind: 'tests-du-terminal', tests: [VITEST], at: 20 })
    expect(deux.testsDuTerminal).toEqual([
      { ...TYPECHECK, at: 10 },
      { ...VITEST, at: 20 }
    ])
    expect(deux.status).toBe('streaming')
    expect(deux.parts).toEqual(tour.parts)
  })

  it('ignore une entrée qui n’est pas un test avec un code entier, et reste borné', () => {
    const tour = createChatTurn('t1')
    const lu = reduceChatTurn(tour, {
      kind: 'tests-du-terminal',
      tests: [
        { commande: '', codeDeSortie: 0 },
        { commande: 'npm test', codeDeSortie: 1.5 },
        { commande: 'npm test', codeDeSortie: Number.NaN }
      ] as never
    })
    expect(lu.testsDuTerminal).toBeUndefined()
    let plein = tour
    for (let i = 0; i < TESTS_DU_TERMINAL_MAX + 5; i += 1)
      plein = reduceChatTurn(plein, {
        kind: 'tests-du-terminal',
        tests: [{ commande: `npm test ${i}`, codeDeSortie: 0 }]
      })
    expect(plein.testsDuTerminal).toHaveLength(TESTS_DU_TERMINAL_MAX)
    expect(plein.testsDuTerminal!.at(-1)!.commande).toBe(`npm test ${TESTS_DU_TERMINAL_MAX + 4}`)
  })

  it('atterrissent sur le message du tour, survivent aux événements suivants, se relisent', () => {
    const messages: Msg[] = [
      { role: 'assistant', content: '', ts: 1, turnId: 't1', status: 'streaming', parts: [] }
    ]
    applyTurnEventToMessages(messages, 't1', { kind: 'tests-du-terminal', tests: [VITEST], at: 5 })
    applyTurnEventToMessages(messages, 't1', { kind: 'done' })
    expect(messages[0].testsDuTerminal).toEqual([{ ...VITEST, at: 5 }])

    const relu = hydrateStoredAssistant({
      content: '',
      parts: [],
      status: 'completed',
      testsDuTerminal: messages[0].testsDuTerminal
    })
    expect(relu.testsDuTerminal).toEqual([{ ...VITEST, at: 5 }])
  })

  it('se relisent depuis le fichier des conversations ; un champ corrompu est refusé', () => {
    const [conversation] = loadConversations(ecrire('valide', [{ ...VITEST, at: 5 }]))
    expect(conversation!.messages[1]!.testsDuTerminal).toEqual([{ ...VITEST, at: 5 }])
    expect(() => loadConversations(ecrire('corrompu', [{ commande: 'npm test' }]))).toThrow(
      ConversationPersistenceError
    )
  })

  it('n’inventent rien pour un tour qui n’a lancé aucun test', () => {
    expect(hydrateStoredAssistant({ content: 'x' }).testsDuTerminal).toBeUndefined()
    const messages: Msg[] = [
      { role: 'assistant', content: '', ts: 1, turnId: 't1', status: 'completed', parts: [] }
    ]
    applyTurnEventToMessages(messages, 't1', { kind: 'reasoning', text: 'pensée' })
    expect('testsDuTerminal' in messages[0]).toBe(false)
  })

  it('arrivent EN DIRECT dans le fil, et un événement suivant ne les efface pas', () => {
    const vivant = hydrateStoredAssistant({ content: '', parts: [], status: 'streaming' })
    const avec = reduceAssistantPilotEvent(
      { ...vivant, turnId: 't1' },
      { kind: 'tests-du-terminal', turnId: 't1', data: [VITEST], at: 7 }
    )
    expect(avec.testsDuTerminal).toEqual([{ ...VITEST, at: 7 }])
    const ensuite = reduceAssistantPilotEvent(avec, {
      kind: 'delta',
      turnId: 't1',
      streamId: 's',
      text: 'fini'
    })
    const clos = reduceAssistantPilotEvent(ensuite, { kind: 'done', turnId: 't1' })
    expect(clos.testsDuTerminal).toEqual([{ ...VITEST, at: 7 }])
  })
})
