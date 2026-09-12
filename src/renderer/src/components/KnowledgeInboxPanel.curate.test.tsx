// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeInboxPanel, type InboxCandidateView } from './KnowledgeInboxPanel'

/**
 * La file d'attente se VIDE par la skill `curate`, pas à la main fiche par fiche. Le bouton doit donc
 * ouvrir une conversation et y ENVOYER la commande : un bouton qui se contente d'ouvrir un brouillon
 * ferait refaire à l'utilisateur le geste qu'il vient de faire.
 */

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const flush = (): Promise<void> =>
  act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })

function candidate(id: string): InboxCandidateView {
  return {
    id,
    file: `C:/brain/inbox/${id}.md`,
    title: id,
    body: 'corps',
    bodyTruncated: false,
    nearDuplicates: [],
    warnings: []
  }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('KnowledgeInboxPanel — bouton /curate', () => {
  it('crée une conversation et y envoie /curate avec le nombre de candidats', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listInbox: vi.fn().mockResolvedValue([candidate('a'), candidate('b')]),
      roles: vi.fn().mockResolvedValue({ orchestrator: { provider: 'claude' } }),
      conversationsCreate: vi.fn().mockResolvedValue({ id: 'conv-9' }),
      appCommand: vi.fn().mockResolvedValue(undefined)
    }
    const sent: Array<{ conversationId?: string; prompt?: string; send?: boolean }> = []
    window.addEventListener('autowin:prefill-conversation', (event) => {
      sent.push((event as CustomEvent).detail)
    })

    await act(async () => {
      root.render(<KnowledgeInboxPanel brainPath="C:/brain" />)
    })
    await flush()

    const button = [...container.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('/curate')
    )
    expect(button).toBeTruthy()
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    expect(sent).toHaveLength(1)
    expect(sent[0]?.conversationId).toBe('conv-9')
    expect(sent[0]?.send).toBe(true)
    expect(sent[0]?.prompt).toContain('/curate')
    expect(sent[0]?.prompt).toContain('2 candidats')
  })
})
