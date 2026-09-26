// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CLE_MODE_AUTO_CONVS } from './chat-auto-convs'

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * conv-826 (2026-09-26) : ∞ allumé, la suite « quand …/fin.txt existe, compare… » attendait son
 * fichier. L'app a redémarré (10:48, 10:59, 11:10, 11:35, 13:38, 14:13) ; la surveillance, un minuteur
 * de l'écran, est morte, et ∞ — relu du stockage — restait affiché allumé. fin.txt est apparu à
 * 12:38:36, rien n'est parti avant 15:57. Ici : on MONTE l'écran avec ∞ déjà armé dans le stockage,
 * exactement comme au démarrage. Les minuteurs longs (sonde de 5 min) sont accélérés.
 */
const cloture = (suite: string): string =>
  ['✅ Fait', '1. La nuit tourne.', `👉 Recommandé : ${suite}`].join('\n')
const SUITE_FICHIER = 'quand fin.txt existe, comparer les notes de la nuit.'
const H = 3_600_000

function accelererLesLongsMinuteurs(): void {
  const vrai = window.setTimeout.bind(window)
  vi.spyOn(window, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) =>
    vrai(fn, (ms ?? 0) >= 60_000 ? 150 : ms)) as typeof window.setTimeout)
}
const attendre = (ms: number): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })

describe('ChatView — après un redémarrage, ∞ reprend l’attente d’un fichier', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  async function demarrer(
    suite: string,
    ageSaisie: number | null,
    present: () => boolean
  ): Promise<{ pilotChat: ReturnType<typeof vi.fn>; fichierExiste: ReturnType<typeof vi.fn> }> {
    window.localStorage.setItem(CLE_MODE_AUTO_CONVS, JSON.stringify(['A']))
    const fil = [
      {
        role: 'user',
        content: 'Lance la nuit',
        ...(ageSaisie === null ? {} : { ts: Date.now() - ageSaisie })
      },
      { role: 'assistant', content: cloture(suite) }
    ]
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    const fichierExiste = vi.fn(async () => present())
    accelererLesLongsMinuteurs()
    h = await mountChat(
      chatApi({
        pilotChat,
        fichierExiste,
        conversations: vi.fn().mockResolvedValue([conversation('A', fil), conversation('B', [])]),
        conversation: vi.fn(async (id: string) => conversation(id, id === 'A' ? fil : [])),
        onPilotEvent: vi.fn(() => vi.fn())
      })
    )
    return { pilotChat, fichierExiste }
  }
  const envois = (pilotChat: ReturnType<typeof vi.fn>): number =>
    pilotChat.mock.calls.filter((c) => JSON.stringify(c).includes('fin.txt')).length

  it('fil NON affiché : la sonde reprend seule ; absent → rien, présent → la suite part UNE fois', async () => {
    let present = false
    const { pilotChat, fichierExiste } = await demarrer(SUITE_FICHIER, 6 * H, () => present)
    await attendre(400)
    expect(fichierExiste).toHaveBeenCalledWith('fin.txt', undefined)
    expect(envois(pilotChat)).toBe(0)
    present = true
    await attendre(400)
    expect(envois(pilotChat)).toBe(1)
    expect(JSON.stringify(pilotChat.mock.calls.at(-1))).toContain('"A"')
    await attendre(400)
    expect(envois(pilotChat)).toBe(1)
  })

  it('fil rouvert pendant l’attente reprise : toujours UN seul envoi (pas de seconde surveillance)', async () => {
    let present = false
    const { pilotChat } = await demarrer(SUITE_FICHIER, 6 * H, () => present)
    await attendre(50)
    await h!.click('.conv-item .conv-pick')
    await attendre(50)
    present = true
    await attendre(800)
    expect(envois(pilotChat)).toBe(1)
  })

  it('tour plus vieux que 48 h : rien n’est repris, aucune sonde, aucun tour payé', async () => {
    const { pilotChat, fichierExiste } = await demarrer(SUITE_FICHIER, 49 * H, () => true)
    await attendre(600)
    expect(fichierExiste).not.toHaveBeenCalled()
    expect(envois(pilotChat)).toBe(0)
  })

  it('suite immédiate (pas d’attente de fichier) : jamais relancée au démarrage, comme avant', async () => {
    const { pilotChat } = await demarrer('relire fin.txt et comparer les notes.', H, () => true)
    await attendre(600)
    expect(envois(pilotChat)).toBe(0)
  })
})
