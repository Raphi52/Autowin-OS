/**
 * La DUREE DU RAISONNEMENT survit au rechargement (conv-162, 2026-10-10 : « enregistre la durée du
 * raisonnement avec le tour pour que le compteur de secondes de la capsule reste affiché après un
 * rechargement de la conversation »).
 *
 * Chemin couvert, du tour au fil : evenement `reasoning-duration` -> etat du tour -> message du store
 * -> validation du fichier disque -> message relu (`hydrateStoredAssistant`). La capsule elle-meme
 * est couverte par ThinkingBlock.chrono-r5.test.tsx.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createChatTurn, reduceChatTurn } from './chat-turn'
import { applyTurnEventToMessages, type Msg } from '../main/store/conversations'
import { hydrateStoredAssistant } from '../renderer/src/components/chat-view-model'
import { ConversationPersistenceError, loadConversations } from '../main/store/conversations-disk'

const racine = mkdtempSync(join(tmpdir(), 'autowin-duree-raisonnement-'))
afterAll(() => rmSync(racine, { recursive: true, force: true }))

/** Une conversation sur disque dont le message assistant porte `reasoningMs`. */
function ecrire(nom: string, reasoningMs: unknown): string {
  const path = join(racine, `${nom}.json`)
  writeFileSync(
    path,
    JSON.stringify([
      {
        schemaVersion: 3,
        id: 'conv-1',
        title: 'Durée',
        category: 'codex',
        provider: 'codex',
        messages: [
          { role: 'user', content: 'q', ts: 1 },
          {
            role: 'assistant',
            content: 'r',
            ts: 2,
            turnId: 't1',
            status: 'completed',
            parts: [],
            reasoningMs
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

describe('la durée du raisonnement survit au rechargement', () => {
  it('se pose sur le tour, arrondie, sans toucher au statut ni à la réponse', () => {
    const clos = reduceChatTurn(createChatTurn('t1'), { kind: 'done' })
    const avecDuree = reduceChatTurn(clos, { kind: 'reasoning-duration', ms: 31_400.6 })
    expect(avecDuree.reasoningMs).toBe(31_401)
    expect(avecDuree.status).toBe('completed')
    expect(avecDuree.parts).toEqual(clos.parts)
  })

  it("ignore une valeur qui n'est pas une durée", () => {
    const tour = createChatTurn('t1')
    for (const ms of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(reduceChatTurn(tour, { kind: 'reasoning-duration', ms }).reasoningMs).toBeUndefined()
  })

  it('atterrit sur le message du tour, puis se relit après hydratation', () => {
    const messages: Msg[] = [
      { role: 'assistant', content: '', ts: 1, turnId: 't1', status: 'completed', parts: [] }
    ]
    applyTurnEventToMessages(messages, 't1', { kind: 'reasoning-duration', ms: 12_000 })
    expect(messages[0].reasoningMs).toBe(12_000)
    // Un evenement suivant (ici le journal d'actions) ne doit pas effacer la duree deja posee.
    applyTurnEventToMessages(messages, 't1', { kind: 'actions-log', lines: ['Read · a'] })
    expect(messages[0].reasoningMs).toBe(12_000)

    const relu = hydrateStoredAssistant({
      content: '',
      parts: [],
      status: 'completed',
      reasoningMs: messages[0].reasoningMs
    })
    expect(relu.reasoningMs).toBe(12_000)
  })

  it('se relit depuis le fichier des conversations', () => {
    const [conversation] = loadConversations(ecrire('valide', 31_401))
    expect(conversation!.messages[1]!.reasoningMs).toBe(31_401)
  })

  it('refuse un fichier dont la durée a été corrompue, comme les autres champs du tour', () => {
    expect(() => loadConversations(ecrire('corrompu', 'douze'))).toThrow(
      ConversationPersistenceError
    )
  })

  it("n'invente aucune durée pour un tour ancien qui n'en a pas", () => {
    expect(hydrateStoredAssistant({ content: 'x' }).reasoningMs).toBeUndefined()
    const messages: Msg[] = [
      { role: 'assistant', content: '', ts: 1, turnId: 't1', status: 'completed', parts: [] }
    ]
    applyTurnEventToMessages(messages, 't1', { kind: 'reasoning', text: 'pensée' })
    expect('reasoningMs' in messages[0]).toBe(false)
  })
})
