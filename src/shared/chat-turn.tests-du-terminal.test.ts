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
import {
  COMMANDE_DE_TEST_MAX,
  TESTS_DU_TERMINAL_MAX,
  commandeJouee,
  createChatTurn,
  lireTestsDuTerminal,
  reduceChatTurn
} from './chat-turn'
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

/*
 * Le dossier d'un test traverse les mêmes étapes que sa commande (conv-1423) : perdu à une seule
 * d'entre elles, le Board reverrait `npm test` et le faux vert reviendrait sans qu'aucun test du
 * lecteur ne le dise.
 *
 * fix-ok: `testDuMaillon` ne garde que le maillon du test, donc le `cd` disparaissait (reproduit par
 * le contrôle final sur `constatsRetenus`) ; et `reduceChatTurn` recopie les champs un par un, donc
 * un champ neuf y serait perdu en silence (lu dans chat-turn.ts, branche `tests-du-terminal`).
 */
describe('le dossier d’un test suit le test jusqu’au fil', () => {
  const AILLEURS = { commande: 'npm test', codeDeSortie: 0, changementDeDossier: 'cd ../autre' }

  it('la commande jouée le nomme ; sans dossier, elle reste la commande', () => {
    expect(commandeJouee(AILLEURS)).toBe('cd ../autre && npm test')
    expect(commandeJouee(VITEST)).toBe('npx vitest run a.test.ts')
  })

  it('traverse la lecture tolérante et l’état du tour', () => {
    expect(lireTestsDuTerminal([AILLEURS])).toEqual([AILLEURS])
    const tour = reduceChatTurn(createChatTurn('t1'), {
      kind: 'tests-du-terminal',
      tests: [AILLEURS],
      at: 10
    })
    expect(tour.testsDuTerminal).toEqual([{ ...AILLEURS, at: 10 }])
  })

  it('un dossier vide n’en est pas un, et un dossier d’un autre type invalide l’entrée', () => {
    expect(lireTestsDuTerminal([{ ...VITEST, changementDeDossier: '  ' }])).toEqual([VITEST])
    expect(lireTestsDuTerminal([{ ...VITEST, changementDeDossier: 12 }])).toEqual([])
  })

  it('un dossier reçu d’ailleurs reste borné, sans ses espaces', () => {
    const [test] = lireTestsDuTerminal([
      { ...VITEST, changementDeDossier: ` cd ${'a'.repeat(COMMANDE_DE_TEST_MAX * 2)}` }
    ])
    expect(test.changementDeDossier).toHaveLength(COMMANDE_DE_TEST_MAX)
    expect(test.changementDeDossier).toMatch(/^cd a/u)
  })

  it('traverse le message enregistré, le fichier disque et la relecture', () => {
    const messages: Msg[] = [
      { role: 'assistant', content: '', ts: 1, turnId: 't1', status: 'streaming', parts: [] }
    ]
    applyTurnEventToMessages(messages, 't1', {
      kind: 'tests-du-terminal',
      tests: [AILLEURS],
      at: 5
    })
    expect(messages[0].testsDuTerminal).toEqual([{ ...AILLEURS, at: 5 }])
    const relu = hydrateStoredAssistant({
      content: '',
      parts: [],
      status: 'completed',
      testsDuTerminal: messages[0].testsDuTerminal
    })
    expect(relu.testsDuTerminal).toEqual([{ ...AILLEURS, at: 5 }])
    const [conversation] = loadConversations(ecrire('dossier', [{ ...AILLEURS, at: 5 }]))
    expect(conversation!.messages[1]!.testsDuTerminal).toEqual([{ ...AILLEURS, at: 5 }])
    const corrompu = ecrire('dossier-faux', [{ ...VITEST, changementDeDossier: 12 }])
    expect(() => loadConversations(corrompu)).toThrow(ConversationPersistenceError)
  })

  it('traverse le message vivant, en direct', () => {
    const vivant = hydrateStoredAssistant({ content: '', parts: [], status: 'streaming' })
    const avec = reduceAssistantPilotEvent(
      { ...vivant, turnId: 't1' },
      { kind: 'tests-du-terminal', turnId: 't1', data: [AILLEURS], at: 7 }
    )
    expect(avec.testsDuTerminal).toEqual([{ ...AILLEURS, at: 7 }])
  })
})

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
