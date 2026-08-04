import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { ChatArtifact } from '../../shared/artifacts'
import type { Conversation } from './conversations'
import {
  ChatArtifactPreviewBudget,
  materializeChatArtifact,
  materializeUserImageArtifact,
  readConversationArtifact,
  removeConversationArtifacts,
  revealableConversationArtifactPath
} from './chat-artifact-store'

function artifact(overrides: Partial<ChatArtifact> = {}): ChatArtifact {
  return {
    id: 'artifact-1',
    name: 'result.txt',
    mimeType: 'text/plain',
    kind: 'text',
    size: 5,
    createdAt: 1,
    encoding: 'utf8',
    content: 'hello',
    source: { provider: 'codex' },
    ...overrides
  }
}

function conversation(value: ChatArtifact): Conversation {
  return {
    id: 'conv-1',
    title: 'test',
    category: 'codex',
    provider: 'codex',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      {
        role: 'assistant',
        content: '',
        ts: 1,
        turnId: 'turn-1',
        parts: [{ kind: 'artifact', artifact: value }]
      }
    ]
  }
}

describe('chat artifact store', () => {
  it('matérialise et relit l’image utilisateur originale depuis son message', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-user-image-'))
    const stored = materializeUserImageArtifact(
      {
        name: 'preuve.png',
        mimeType: 'image/png',
        size: 3,
        content: 'YWJj'
      },
      'conv-1',
      'turn-user',
      base
    )
    const userConversation: Conversation = {
      id: 'conv-1',
      title: 'test',
      category: 'claude',
      provider: 'claude',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          role: 'user',
          content: 'Regarde',
          ts: 1,
          attachments: [
            {
              name: 'preuve.png',
              mimeType: 'image/png',
              size: 3,
              turnId: 'turn-user',
              artifact: stored
            }
          ]
        }
      ]
    }

    expect(stored.content).toBeUndefined()
    expect(readFileSync(stored.path!)).toEqual(Buffer.from('abc'))
    expect(readConversationArtifact(userConversation, 'turn-user', stored.id, base)).toMatchObject({
      ok: true,
      encoding: 'base64',
      content: 'YWJj'
    })
  })

  it('distingue deux images aux mêmes octets mais portant des noms différents', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-user-images-'))
    const first = materializeUserImageArtifact(
      { name: 'avant.png', mimeType: 'image/png', size: 3, content: 'YWJj' },
      'conv-1',
      'turn-user',
      base
    )
    const second = materializeUserImageArtifact(
      { name: 'apres.png', mimeType: 'image/png', size: 3, content: 'YWJj' },
      'conv-1',
      'turn-user',
      base
    )
    const userConversation: Conversation = {
      id: 'conv-1',
      title: 'test',
      category: 'claude',
      provider: 'claude',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          role: 'user',
          content: 'Compare',
          ts: 1,
          attachments: [
            {
              name: 'avant.png',
              mimeType: 'image/png',
              size: 3,
              turnId: 'turn-user',
              artifact: first
            },
            {
              name: 'apres.png',
              mimeType: 'image/png',
              size: 3,
              turnId: 'turn-user',
              artifact: second
            }
          ]
        }
      ]
    }

    expect(first.id).not.toBe(second.id)
    expect(first.path).not.toBe(second.path)
    expect(
      readConversationArtifact(userConversation, 'turn-user', first.id, base).artifact?.name
    ).toBe('avant.png')
    expect(
      readConversationArtifact(userConversation, 'turn-user', second.id, base).artifact?.name
    ).toBe('apres.png')
  })

  it('matérialise le contenu inline hors de la conversation puis le relit par identité', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-artifact-'))
    const stored = materializeChatArtifact(artifact(), 'conv-1', 'turn-1', base)

    expect(stored.content).toBeUndefined()
    expect(stored.path).toContain('chat-artifacts')
    expect(readFileSync(stored.path!, 'utf8')).toBe('hello')
    expect(
      readConversationArtifact(conversation(stored), 'turn-1', 'artifact-1', base)
    ).toMatchObject({ ok: true, encoding: 'utf8', content: 'hello' })
  })

  it('copie un fichier supplier avant disparition du worktree', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-artifact-'))
    const supplier = join(base, 'supplier')
    mkdirSync(supplier)
    const source = join(supplier, 'image.png')
    writeFileSync(source, Buffer.from([137, 80, 78, 71]))

    const stored = materializeChatArtifact(
      artifact({
        name: 'image.png',
        mimeType: 'image/png',
        kind: 'image',
        content: undefined,
        encoding: undefined,
        path: source,
        size: 4
      }),
      'conv-1',
      'turn-1',
      base
    )

    expect(stored.path).not.toBe(source)
    expect(
      readConversationArtifact(conversation(stored), 'turn-1', 'artifact-1', base)
    ).toMatchObject({ ok: true, encoding: 'base64', content: 'iVBORw==' })
  })

  it('refuse la lecture et la révélation d’un chemin arbitraire injecté dans la conversation', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-artifact-'))
    const outside = join(base, 'secret.txt')
    writeFileSync(outside, 'secret')
    const tainted = artifact({ content: undefined, encoding: undefined, path: outside })

    expect(
      readConversationArtifact(conversation(tainted), 'turn-1', 'artifact-1', base)
    ).toMatchObject({
      ok: false,
      error: 'Chemin d’artefact non autorisé'
    })
    expect(
      revealableConversationArtifactPath(conversation(tainted), 'turn-1', 'artifact-1', base)
    ).toBeUndefined()
  })

  it('ne permet pas de lire un artefact avec le mauvais tour ou identifiant', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-artifact-'))
    const stored = materializeChatArtifact(artifact(), 'conv-1', 'turn-1', base)
    expect(
      readConversationArtifact(conversation(stored), 'turn-other', 'artifact-1', base).ok
    ).toBe(false)
    expect(readConversationArtifact(conversation(stored), 'turn-1', 'other', base).ok).toBe(false)
  })

  it('conserve deux identifiants distincts même si leur forme lisible se normalise pareil', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-artifact-'))
    const first = materializeChatArtifact(
      artifact({ id: 'a/b', content: 'FIRST' }),
      'conv-1',
      'turn-1',
      base
    )
    const second = materializeChatArtifact(
      artifact({ id: 'a\\b', content: 'SECOND' }),
      'conv-1',
      'turn-1',
      base
    )

    expect(first.path).not.toBe(second.path)
    expect(readFileSync(first.path!, 'utf8')).toBe('FIRST')
    expect(readFileSync(second.path!, 'utf8')).toBe('SECOND')
  })

  it('borne cumulativement les previews d’une conversation et ne refacture pas une relecture', () => {
    const budget = new ChatArtifactPreviewBudget(10)
    const scope = '7:conv-1'

    expect(budget.reserve(scope, 'a', 6)).toBe(true)
    expect(budget.remaining(scope, 'b')).toBe(4)
    expect(budget.reserve(scope, 'b', 5)).toBe(false)
    expect(budget.reserve(scope, 'a', 6)).toBe(true)
    budget.clearRenderer(7)
    expect(budget.remaining(scope, 'b')).toBe(10)
  })

  it('refuse la lecture avant allocation quand le budget cumulé restant est insuffisant', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-artifact-'))
    const stored = materializeChatArtifact(artifact(), 'conv-1', 'turn-1', base)
    expect(
      readConversationArtifact(conversation(stored), 'turn-1', 'artifact-1', base, 4)
    ).toMatchObject({ ok: false, error: 'Budget cumulé des aperçus atteint' })
    expect(
      readConversationArtifact(conversation(artifact()), 'turn-1', 'artifact-1', base, 4)
    ).toMatchObject({ ok: false, error: 'Budget cumulé des aperçus atteint' })
  })

  it('supprime uniquement le dossier d’artefacts de la conversation retirée', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-artifact-'))
    const first = materializeChatArtifact(artifact(), 'conv-1', 'turn-1', base)
    const second = materializeChatArtifact(artifact({ id: 'artifact-2' }), 'conv-2', 'turn-2', base)
    removeConversationArtifacts('conv-1', base)
    expect(readConversationArtifact(conversation(first), 'turn-1', 'artifact-1', base).ok).toBe(
      false
    )
    expect(second.path && readFileSync(second.path, 'utf8')).toBe('hello')
  })
})
