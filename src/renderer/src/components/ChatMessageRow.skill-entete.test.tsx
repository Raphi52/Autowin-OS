// @vitest-environment happy-dom
/** Bulle envoyee draft G1 : bandeau de skill seulement pour une skill installee, prefixe retire. */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const skills = [{ id: 'draft', description: 'boucle de maquettes' }]

async function rendre(content: string): Promise<HTMLElement> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.appendChild(host)
  const message = { role: 'user', content } as Msg
  await act(async () => {
    createRoot(host).render(
      createElement(ChatMessageRow, { message, conversationId: 'c', skills })
    )
  })
  return host
}

describe('ChatMessageRow — bandeau de skill', () => {
  it('affiche le bandeau et retire le prefixe pour une skill installee', async () => {
    const host = await rendre('/draft le F5')
    const body = host.querySelector('.msg-body')!
    expect(body.classList.contains('msg-bulle')).toBe(true)
    expect(body.classList.contains('avec-skill')).toBe(true)
    expect(host.querySelector('.msg-skill-nom')?.textContent).toBe('draft')
    expect(host.querySelector('.msg-skill-desc')).toBeNull()
    expect(host.querySelector('.msg-skill-texte')?.textContent).toBe('le F5')
  })
  it('garde un message ordinaire en bulle simple, sans bandeau', async () => {
    const host = await rendre('/truc bonjour')
    const body = host.querySelector('.msg-body')!
    expect(body.classList.contains('msg-bulle')).toBe(true)
    expect(body.classList.contains('avec-skill')).toBe(false)
    expect(host.querySelector('.msg-skill-entete')).toBeNull()
    expect(body.textContent).toBe('/truc bonjour')
  })
})
