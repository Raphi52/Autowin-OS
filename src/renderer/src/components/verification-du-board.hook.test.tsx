// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CarteDesBesoins } from '../../../shared/carte-des-besoins'
import {
  PAS_DU_SUIVI_MS,
  useVerificationDuBoard,
  type BilanDeVerification
} from './verification-du-board'

/**
 * LE GESTE « VÉRIFIER » DE LA VUE (conv-1136, 2026-10-23). ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : un
 * envoi qui ne passe pas par `chat_send` avec le fil et `/check` (le tour ne partirait pas dans le
 * fil) ; une carte non recalculée après l'envoi (le post-it resterait dans « À vérifier ») ; un
 * recalcul périodique qui continue sans aucun fil suivi, ou qui ne part pas quand un fil tourne.
 */

type Api = { appCommand: (name: string, args?: Record<string, unknown>) => Promise<unknown> }

describe('useVerificationDuBoard', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })
  const montes: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = []
  afterEach(async () => {
    for (const m of montes.splice(0)) {
      await act(async () => m.root.unmount())
      m.el.remove()
    }
    vi.useRealTimers()
    delete (window as unknown as { api?: Api }).api
  })

  const carteVide = { projets: [] } as unknown as CarteDesBesoins

  async function monter(
    charger: () => Promise<void>
  ): Promise<{ verifier: (ids: readonly string[]) => Promise<BilanDeVerification> }> {
    const sortie: {
      verifier?: (ids: readonly string[]) => Promise<BilanDeVerification>
    } = {}
    function Sonde(): null {
      sortie.verifier = useVerificationDuBoard(true, carteVide, charger)
      return null
    }
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    await act(async () => root.render(createElement(Sonde)))
    return { verifier: (ids) => sortie.verifier!(ids) }
  }

  it('envoie /check dans chaque fil par chat_send, puis recalcule la carte', async () => {
    const appCommand = vi.fn(async () => ({ ok: true }))
    ;(window as unknown as { api: Api }).api = { appCommand }
    const charger = vi.fn(async () => {})
    const { verifier } = await monter(charger)
    let bilan: BilanDeVerification | undefined
    await act(async () => {
      bilan = await verifier(['conv-7', 'conv-9'])
    })
    expect(appCommand.mock.calls).toEqual([
      ['chat_send', { conversationId: 'conv-7', message: '/check' }],
      ['chat_send', { conversationId: 'conv-9', message: '/check' }]
    ])
    expect(bilan).toEqual({ lances: ['conv-7', 'conv-9'], echecs: [] })
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('un refus de chat_send est rendu, et rien n’est recalculé ni suivi', async () => {
    vi.useFakeTimers()
    const appCommand = vi.fn(async () => ({ ok: false, error: 'conversation inconnue' }))
    ;(window as unknown as { api: Api }).api = { appCommand }
    const charger = vi.fn(async () => {})
    const { verifier } = await monter(charger)
    let bilan: BilanDeVerification | undefined
    await act(async () => {
      bilan = await verifier(['conv-7'])
    })
    expect(bilan?.echecs).toEqual([{ conversationId: 'conv-7', raison: 'conversation inconnue' }])
    await act(async () => vi.advanceTimersByTime(3 * PAS_DU_SUIVI_MS))
    expect(charger).not.toHaveBeenCalled()
  })

  it('recalcule la carte toutes les 15 s tant qu’un fil lancé est suivi', async () => {
    vi.useFakeTimers()
    const appCommand = vi.fn(async () => ({ ok: true }))
    ;(window as unknown as { api: Api }).api = { appCommand }
    const charger = vi.fn(async () => {})
    const { verifier } = await monter(charger)
    await act(async () => {
      await verifier(['conv-7'])
    })
    expect(charger).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTime(PAS_DU_SUIVI_MS))
    expect(charger).toHaveBeenCalledTimes(2)
  })
})
