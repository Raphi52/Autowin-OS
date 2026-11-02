// @vitest-environment happy-dom
/**
 * Un message qui nomme une skill s'affiche comme n'importe quel message, tel qu'il a été tapé.
 * Conv-1334 (2026-10-30, « enleve le fait que ca fasse un bloc particulier pour les skills c
 * trompeur parfois ») : l'ancien bandeau retirait le préfixe et affichait « KAIZEN » au-dessus du
 * texte, ce qui laissait croire que le message avait déclenché autre chose qu'un tour normal.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

async function rendre(content: string): Promise<HTMLElement> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.appendChild(host)
  const message = { role: 'user', content } as Msg
  await act(async () => {
    createRoot(host).render(createElement(ChatMessageRow, { message, conversationId: 'c' }))
  })
  return host
}

describe('ChatMessageRow — message qui nomme une skill', () => {
  it.each(['/draft le F5', 'kaizen lance une orchestration', '/kaizen'])(
    'garde « %s » tel quel, dans une bulle ordinaire',
    async (texte) => {
      const host = await rendre(texte)
      const bulle = host.querySelector('.msg-body')!
      expect(bulle.className).toBe('msg-body msg-bulle')
      expect(bulle.textContent).toBe(texte)
      expect(bulle.children).toHaveLength(0)
    }
  )
})
