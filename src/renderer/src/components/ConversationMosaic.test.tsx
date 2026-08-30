// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ConversationMosaic } from './ConversationMosaic'
import type { Conv } from './chat-view-types'

const conv = (id: string, title: string): Conv => ({ id, title, provider: 'claude', updatedAt: 0 })

function monter(node: React.JSX.Element): HTMLElement {
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  act(() => {
    createRoot(hote).render(node)
  })
  return hote
}

describe('ConversationMosaic', () => {
  it('rend une tuile par conversation et marque l active', () => {
    const hote = monter(
      <ConversationMosaic
        conversations={[conv('a', 'Alpha'), conv('b', 'Beta')]}
        activeId="b"
        onOpen={vi.fn()}
      />
    )
    expect(hote.querySelectorAll('.conv-tile')).toHaveLength(2)
    expect(hote.querySelector('[data-conv-id="b"]')?.getAttribute('aria-current')).toBe('page')
    expect(hote.querySelector('[data-conv-id="a"]')?.getAttribute('aria-current')).toBeNull()
  })

  it('ouvre la conversation cliquee', () => {
    const onOpen = vi.fn()
    const hote = monter(
      <ConversationMosaic conversations={[conv('a', 'Alpha')]} activeId={null} onOpen={onOpen} />
    )
    act(() => {
      hote.querySelector<HTMLButtonElement>('[data-conv-id="a"]')!.click()
    })
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })
})
