/**
 * Les FICHIERS ÉCRITS PAR UN TOUR sont gardés avec sa réponse. Une liste VIDE est un fait (« ce tour
 * n'a rien écrit »), une liste ABSENTE veut dire « on ne sait pas » : les deux ne doivent se
 * confondre à aucune étape, sinon la carte du fil dirait « rien à vérifier » d'un tour ancien.
 *
 * Chemin couvert : événement `fichiers-ecrits` -> état du tour -> message du store -> validation du
 * fichier disque -> message relu ; et en direct : événement du pilote -> message vivant.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  FICHIERS_ECRITS_MAX,
  createChatTurn,
  lireFichiersEcrits,
  reduceChatTurn
} from './chat-turn'
import { applyTurnEventToMessages, type Msg } from '../main/store/conversations'
import {
  hydrateStoredAssistant,
  reduceAssistantPilotEvent
} from '../renderer/src/components/chat-view-model'
import { ConversationPersistenceError, loadConversations } from '../main/store/conversations-disk'

const racine = mkdtempSync(join(tmpdir(), 'autowin-fichiers-ecrits-'))
afterAll(() => rmSync(racine, { recursive: true, force: true }))

function ecrire(nom: string, fichiersEcrits: unknown): string {
  const path = join(racine, `${nom}.json`)
  writeFileSync(
    path,
    JSON.stringify([
      {
        schemaVersion: 3,
        id: 'conv-1',
        title: 'Fichiers',
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
            ...(fichiersEcrits === undefined ? {} : { fichiersEcrits })
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

const vivant = (): Msg[] => [
  { role: 'assistant', content: '', ts: 1, turnId: 't1', status: 'streaming', parts: [] }
]

describe('les fichiers écrits par un tour suivent sa réponse', () => {
  it('un tour neuf ne sait rien : la liste est absente, pas vide', () => {
    expect(createChatTurn('t1').fichiersEcrits).toBeUndefined()
  })

  it('une liste vide reçue devient un fait gardé', () => {
    const tour = reduceChatTurn(createChatTurn('t1'), { kind: 'fichiers-ecrits', chemins: [] })
    expect(tour.fichiersEcrits).toEqual([])
  })

  it('les appels d’un même tour se cumulent, sans doublon ni barre oblique inversée', () => {
    let tour = reduceChatTurn(createChatTurn('t1'), { kind: 'fichiers-ecrits', chemins: [] })
    tour = reduceChatTurn(tour, { kind: 'fichiers-ecrits', chemins: ['src\\a.ts', 'src/b.ts'] })
    tour = reduceChatTurn(tour, { kind: 'fichiers-ecrits', chemins: ['src/a.ts', ' '] })
    expect(tour.fichiersEcrits).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('la liste reste bornée', () => {
    const chemins = Array.from({ length: FICHIERS_ECRITS_MAX + 20 }, (_, n) => `src/f${n}.ts`)
    const tour = reduceChatTurn(createChatTurn('t1'), { kind: 'fichiers-ecrits', chemins })
    expect(tour.fichiersEcrits).toHaveLength(FICHIERS_ECRITS_MAX)
  })

  it('la lecture tolérante jette ce qui n’est pas un chemin et rend « inconnu » sans tableau', () => {
    expect(lireFichiersEcrits(['a.ts', 3, null, ''])).toEqual(['a.ts'])
    expect(lireFichiersEcrits('a.ts')).toBeUndefined()
    expect(lireFichiersEcrits(undefined)).toBeUndefined()
  })

  it('une liste VIDE traverse le message enregistré, le disque et la relecture', () => {
    const messages = vivant()
    applyTurnEventToMessages(messages, 't1', { kind: 'fichiers-ecrits', chemins: [] })
    expect(messages[0].fichiersEcrits).toEqual([])
    // Un événement suivant ne l'efface pas.
    applyTurnEventToMessages(messages, 't1', { kind: 'delta', streamId: 's', text: 'ok' })
    expect(messages[0].fichiersEcrits).toEqual([])
    const relu = hydrateStoredAssistant({
      content: '',
      parts: [],
      status: 'completed',
      fichiersEcrits: []
    })
    expect(relu.fichiersEcrits).toEqual([])
    const [conversation] = loadConversations(ecrire('vide', []))
    expect(conversation!.messages[1]!.fichiersEcrits).toEqual([])
  })

  it('une liste pleine traverse aussi ; absente, elle le reste', () => {
    const messages = vivant()
    applyTurnEventToMessages(messages, 't1', { kind: 'fichiers-ecrits', chemins: ['src/a.ts'] })
    expect(messages[0].fichiersEcrits).toEqual(['src/a.ts'])
    const [pleine] = loadConversations(ecrire('pleine', ['src/a.ts']))
    expect(pleine!.messages[1]!.fichiersEcrits).toEqual(['src/a.ts'])
    const [absente] = loadConversations(ecrire('absente', undefined))
    expect('fichiersEcrits' in absente!.messages[1]!).toBe(false)
    expect(
      'fichiersEcrits' in hydrateStoredAssistant({ content: 'x', parts: [], status: 'completed' })
    ).toBe(false)
  })

  it('un fichier disque dont la liste n’est pas une liste de chemins est refusé', () => {
    expect(() => loadConversations(ecrire('faux', [12]))).toThrow(ConversationPersistenceError)
    expect(() => loadConversations(ecrire('faux-2', 'src/a.ts'))).toThrow(
      ConversationPersistenceError
    )
  })

  it('en direct, le message vivant les reçoit et les garde à la clôture', () => {
    const debut = hydrateStoredAssistant({ content: '', parts: [], status: 'streaming' })
    const apres = reduceAssistantPilotEvent(
      { ...debut, turnId: 't1' },
      { kind: 'fichiers-ecrits', data: [], turnId: 't1' }
    )
    expect(apres.fichiersEcrits).toEqual([])
    const clos = reduceAssistantPilotEvent(apres, { kind: 'done', text: 'fini', turnId: 't1' })
    expect(clos.fichiersEcrits).toEqual([])
  })
})
