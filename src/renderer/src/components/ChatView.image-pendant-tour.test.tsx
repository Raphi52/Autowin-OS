// @vitest-environment happy-dom
/*
 * UNE IMAGE TAPEE PENDANT UN TOUR DOIT PARTIR (constate le 2026-09-04 : « les images partent pas »).
 *
 * Cause reelle : pendant un tour, le message ORIENTE le tour en cours via l'injection, qui ne
 * transporte qu'un TEXTE. Les pieces jointes restaient donc dans le composer et n'etaient jamais
 * envoyees. Depuis le 2026-09-23, les pieces jointes voyagent AVEC l'injection (le main les ecrit
 * sur disque et ajoute leurs chemins au texte) ; la file ne sert plus que de repli si l'injection
 * est refusee.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

vi.mock('./chat-attachments', async (importOriginal) => {
  const original = await importOriginal<typeof import('./chat-attachments')>()
  return {
    ...original,
    encodeAttachment: vi.fn(async (file: File) => ({
      name: file.name,
      mimeType: file.type,
      size: file.size,
      kind: 'image' as const,
      content: 'YWJj',
      thumbnail: 'data:image/jpeg;base64,bWluaQ=='
    }))
  }
})

describe('ChatView — image tapee pendant un tour', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  async function tourAvecImage(injectDirective: ReturnType<typeof vi.fn>): Promise<{
    appels: unknown[][]
    finir: () => Promise<void>
  }> {
    let finirLeTour: (() => void) | null = null
    const premierTour = new Promise<{ ok: boolean }>((resolve) => {
      finirLeTour = () => resolve({ ok: true })
    })
    const appels: unknown[][] = []
    const pilotChat = vi.fn((...args: unknown[]) => {
      appels.push(args)
      return appels.length === 1 ? premierTour : Promise.resolve({ ok: true })
    })
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat,
      injectDirective
    })
    h = await mountChat(api)
    await h.click('.conv-pick')
    await h.type('premier')
    await h.click('.composer-send')
    const file = new File(['abc'], 'capture.png', { type: 'image/png' })
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { configurable: true, value: { files: [file] } })
    await act(async () => {
      h!.textarea().dispatchEvent(paste)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await h.type('regarde ca')
    await h.click('.composer-send')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    return {
      appels,
      finir: async () => {
        await act(async () => {
          finirLeTour?.()
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
      }
    }
  }

  it('INJECTE le message avec son image dans le tour en cours, sans attendre sa fin', async () => {
    const injectDirective = vi.fn().mockResolvedValue({ ok: true, messageId: 'm1' })
    const { appels, finir } = await tourAvecImage(injectDirective)

    expect(injectDirective).toHaveBeenCalledTimes(1)
    const [, texte, jointes] = injectDirective.mock.calls[0] as [string, string, Array<{ name: string }>]
    expect(texte).toBe('regarde ca')
    expect(jointes.map((j) => j.name)).toEqual(['capture.png'])

    // Rien ne doit repartir en fin de tour : le message est deja arrive.
    await finir()
    expect(appels.length).toBe(1)
  })

  it('si l’injection est refusee, le message part EN FILE avec son image en fin de tour', async () => {
    const injectDirective = vi.fn().mockResolvedValue({ ok: false })
    const { appels, finir } = await tourAvecImage(injectDirective)
    await finir()

    expect(appels.length).toBe(2)
    const messages = appels[1][0] as Array<{
      role: string
      content: string
      attachments?: Array<{ name: string }>
    }>
    const dernier = messages.at(-1)
    expect(dernier?.content).toContain('regarde ca')
    expect(dernier?.attachments?.map((a) => a.name)).toEqual(['capture.png'])
  })
})
