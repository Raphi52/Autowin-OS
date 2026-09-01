// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelActivityLogPane } from './ModelActivityLogPane'
import type { Msg } from './chat-view-types'

const messages = [
  { role: 'user', content: 'lance les tests' },
  {
    role: 'assistant',
    turnId: 'turn-1',
    status: 'completed',
    done: true,
    parts: [{ kind: 'action', name: 'run_tests', ok: true }]
  }
] as unknown as Msg[]

let host: HTMLDivElement
let root: Root

async function monter(): Promise<void> {
  await act(async () => {
    root.render(<ModelActivityLogPane conversationId="conv-1" messages={messages} />)
  })
  // laisse la promesse de lecture du journal se résoudre
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  ;(window as unknown as { api: Record<string, unknown> }).api = {}
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('ModelActivityLogPane — la trace de ce que les modèles ont fait', () => {
  it('affiche les gestes depuis les parts durables quand le journal a été nettoyé', async () => {
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([])
    await monter()
    expect(host.textContent).toContain('run_tests')
    expect(host.textContent).toContain('lance les tests')
  })

  it('préfère le journal du tour : appel modèle, commande et VERDICT', async () => {
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([
        { kind: 'prompt-call', name: 'gpt-5' },
        { kind: 'command', name: 'Bash', actionId: 'c1', args: { command: 'ls' } },
        { kind: 'result', name: 'Bash', actionId: 'c1', ok: false, data: 'exit 1' }
      ])
    await monter()
    expect(host.textContent).toContain('Appel modèle — gpt-5')
    expect(host.textContent).toContain('Bash')
    const ligne = [...host.querySelectorAll('.model-log-row')].find((row) =>
      row.textContent?.includes('Bash')
    )
    expect(ligne?.querySelector('.st-err')).toBeTruthy()
    // UNION : le journal s'AJOUTE aux parts du meme tour, il ne les remplace plus — l'action
    // persistee reste donc lisible, avec sa source.
    expect(host.textContent).toContain('run_tests')
    const persistee = [...host.querySelectorAll('.model-log-row')].find((row) =>
      row.textContent?.includes('run_tests')
    )
    expect(persistee?.querySelector('.model-log-source')?.textContent).toBe('persisté')
  })

  it('horodate chaque geste dont le journal porte l’heure', async () => {
    const at = new Date('2026-09-01T07:05:09').getTime()
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([{ kind: 'command', name: 'Bash', actionId: 'c1', at }])
    await monter()
    const ligne = [...host.querySelectorAll('.model-log-row')].find((row) =>
      row.textContent?.includes('Bash')
    )
    expect(ligne?.querySelector('time')?.textContent).toBe('07:05:09')
  })

  it('un IPC de journal en échec ne vide pas le panneau', async () => {
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockRejectedValue(new Error('ipc down'))
    await monter()
    expect(host.textContent).toContain('run_tests')
  })
})
