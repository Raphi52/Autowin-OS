// @vitest-environment happy-dom
/**
 * Demande utilisateur du 2026-09-12 : « a coté de mon bouton fork je veux un bouton copier pour
 * mettre le message dans mon presse papier ». Le bouton vit dans la MEME barre d'actions que
 * « brancher », des deux cotes du fil (bulle utilisateur et reponse de l'agent).
 *
 * Entree qui ferait echouer une correction fausse : une reponse d'agent faite de PLUSIEURS parts
 * texte — copier ne doit pas se limiter au premier fragment.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'

async function rendre(message: Msg): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(ChatMessageRow, { message, conversationId: 'A' } as never))
  })
  return host
}

describe('bouton copier du fil', () => {
  it('copie tout le texte de la réponse de l’agent dans le presse-papier', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const message = {
      role: 'assistant',
      content: '',
      parts: [
        { kind: 'text', text: 'première partie' },
        { kind: 'action', label: 'Read · a.ts' },
        { kind: 'text', text: 'seconde partie' }
      ],
      done: true,
      messageId: 'm2',
      turnId: 't2'
    } as unknown as Msg
    const host = await rendre(message)
    const bouton = host.querySelector<HTMLButtonElement>('[data-testid="copy-message"]')
    expect(bouton, 'le bouton copier doit exister à côté de brancher').not.toBeNull()
    await act(async () => bouton!.click())
    expect(writeText).toHaveBeenCalledWith('première partie\nseconde partie')
  })

  it('copie aussi une bulle utilisateur', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const message = {
      role: 'user',
      content: 'mon message',
      parts: [],
      done: true,
      messageId: 'm1'
    } as unknown as Msg
    const host = await rendre(message)
    const bouton = host.querySelector<HTMLButtonElement>('[data-testid="copy-message"]')
    expect(bouton).not.toBeNull()
    await act(async () => bouton!.click())
    expect(writeText).toHaveBeenCalledWith('mon message')
  })
})
