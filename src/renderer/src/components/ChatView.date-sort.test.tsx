// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

describe('ChatView — tri des conversations par date', () => {
  let harness: ChatHarness | undefined

  beforeAll(() => installRafShim())
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
    localStorage.clear()
  })

  it('inverse la liste de la plus récente à la plus ancienne', async () => {
    const conversations = [
      {
        id: 'ancienne',
        title: 'Conversation ancienne',
        category: 'codex',
        provider: 'codex',
        updatedAt: 100
      },
      {
        id: 'recente',
        title: 'Conversation récente',
        category: 'codex',
        provider: 'codex',
        updatedAt: 300
      },
      {
        id: 'milieu',
        title: 'Conversation intermédiaire',
        category: 'codex',
        provider: 'codex',
        updatedAt: 200
      }
    ]
    harness = await mountChat(chatApi({ conversations: async () => conversations }))

    const titres = (): string[] =>
      Array.from(harness!.container.querySelectorAll('.conv-label')).map(
        (element) => element.textContent ?? ''
      )

    expect(titres()).toEqual([
      'Conversation récente',
      'Conversation intermédiaire',
      'Conversation ancienne'
    ])

    await harness.click('[aria-label="Trier les conversations des plus anciennes aux plus récentes"]')

    expect(titres()).toEqual([
      'Conversation ancienne',
      'Conversation intermédiaire',
      'Conversation récente'
    ])
  })

  it('trie chronologiquement les conversations appartenant à des projets différents', async () => {
    const conversations = [
      {
        id: 'ancienne-alpha',
        title: 'Conversation ancienne',
        category: 'codex',
        provider: 'codex',
        projectPath: 'C:\\alpha',
        updatedAt: 100
      },
      {
        id: 'recente-beta',
        title: 'Conversation récente',
        category: 'codex',
        provider: 'codex',
        projectPath: 'C:\\beta',
        updatedAt: 300
      },
      {
        id: 'milieu-gamma',
        title: 'Conversation intermédiaire',
        category: 'codex',
        provider: 'codex',
        projectPath: 'C:\\gamma',
        updatedAt: 200
      }
    ]
    harness = await mountChat(chatApi({ conversations: async () => conversations }))

    const titres = (): string[] =>
      Array.from(harness!.container.querySelectorAll('.conv-label')).map(
        (element) => element.textContent ?? ''
      )

    expect(titres()).toEqual([
      'Conversation récente',
      'Conversation intermédiaire',
      'Conversation ancienne'
    ])

    await harness.click('[aria-label="Trier les conversations des plus anciennes aux plus récentes"]')

    expect(titres()).toEqual([
      'Conversation ancienne',
      'Conversation intermédiaire',
      'Conversation récente'
    ])
  })
})
