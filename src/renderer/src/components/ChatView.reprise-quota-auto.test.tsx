// @vitest-environment happy-dom
/**
 * LA REPRISE S'ARME TOUTE SEULE À L'HEURE DU RETOUR DE QUOTA — ET LE DIT.
 *
 * Le bouton de reprise groupée (2026-09-05) suppose d'être devant l'écran au bon moment. L'heure du
 * retour est pourtant connue et n'était jusqu'ici qu'AFFICHÉE (`resetsAt`, src/main/model-quotas.ts).
 * Ce qui se verrouille ici, c'est le contrat visible : l'app ANNONCE la reprise avec son heure, et
 * « ne pas reprendre » l'annule pour de bon — une reprise silencieuse serait indiscernable d'un bug.
 */
import { describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat } from './ChatView.harness'
import { MARGE_APRES_RESET_MS } from './reprise-quota-planifiee'

installRafShim()

const coupee = (id: string): Record<string, unknown> => ({
  ...conversation(id),
  lastMessageRole: 'assistant',
  lastAssistantStatus: 'failed',
  lastAssistantError: "You've hit your session limit · resets 7:10pm"
})

/** Un retour de quota annoncé DANS le futur : le minuteur doit s'armer, pas partir. */
function quotasAvecReset(dansMs: number): Record<string, unknown> {
  return {
    observedAt: new Date().toISOString(),
    summary: { status: 'critical' },
    models: [
      {
        modelId: 'claude',
        model: 'claude-opus',
        label: 'Opus',
        provider: 'claude',
        shared: false,
        status: 'available',
        source: 'test',
        windows: [
          {
            id: 'five-hour',
            label: '5 h',
            usedPercent: 100,
            remainingPercent: 0,
            resetsAt: new Date(Date.now() + dansMs).toISOString()
          }
        ]
      }
    ]
  }
}

const auto = (c: HTMLElement): HTMLElement | null =>
  c.querySelector('[data-testid="conv-reprise-quota-auto"]')

describe('reprise automatique au retour du quota', () => {
  it("ANNONCE l'heure de reprise quand des fils sont coupés et que le reset est connu", async () => {
    const vue = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A'), coupee('B')]),
        modelQuotas: vi.fn().mockResolvedValue(quotasAvecReset(70 * 60_000))
      })
    )
    await vi.waitFor(() => expect(auto(vue.container)).not.toBeNull())
    expect(auto(vue.container)?.textContent).toContain('automatiquement à')
    await vue.unmount()
  })

  it('« ne pas reprendre » ANNULE la reprise programmée — le libellé disparaît', async () => {
    const resumePilotChat = vi.fn().mockResolvedValue({ ok: true, cancelled: false, turnId: 't' })
    const vue = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([coupee('B')]),
        modelQuotas: vi.fn().mockResolvedValue(quotasAvecReset(70 * 60_000)),
        resumePilotChat
      })
    )
    await vi.waitFor(() => expect(auto(vue.container)).not.toBeNull())

    await vue.click('[data-testid="conv-reprise-quota-auto-annuler"]')
    await vi.waitFor(() => expect(auto(vue.container)).toBeNull())
    // Le refus est un verrou : rien ne doit partir, ni maintenant ni plus tard.
    expect(resumePilotChat).not.toHaveBeenCalled()
    await vue.unmount()
  })

  it("CAS LIMITE — aucune conversation coupée : aucune reprise n'est annoncée", async () => {
    const vue = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        modelQuotas: vi.fn().mockResolvedValue(quotasAvecReset(70 * 60_000))
      })
    )
    expect(auto(vue.container)).toBeNull()
    await vue.unmount()
  })

  it("CAS LIMITE — heure de reset inconnue : rien n'est promis", async () => {
    const vue = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([coupee('B')]),
        modelQuotas: vi.fn().mockResolvedValue({
          observedAt: new Date().toISOString(),
          summary: { status: 'critical' },
          models: []
        })
      })
    )
    expect(auto(vue.container)).toBeNull()
    await vue.unmount()
  })

  it("À L'HEURE DITE, la reprise PART vraiment — sinon l'annonce est un mensonge", async () => {
    const resumePilotChat = vi.fn().mockResolvedValue({ ok: true, cancelled: false, turnId: 't' })
    // Le temps est SIMULÉ, et installé AVANT le montage : le minuteur doit être créé sur l'horloge
    // simulée, sinon l'avance ne le touche pas. `toFake` se limite aux minuteurs — remplacer
    // requestAnimationFrame casserait le shim de rendu de la vue.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const vue = await mountChat(
        chatApi({
          conversations: vi.fn().mockResolvedValue([coupee('B')]),
          modelQuotas: vi.fn().mockResolvedValue(quotasAvecReset(50)),
          resumePilotChat
        })
      )
      await vi.waitFor(() => expect(auto(vue.container)).not.toBeNull())
      // Une marge d'une minute suit l'heure annoncée : sans elle, on repartirait pile sur le mur.
      await vi.advanceTimersByTimeAsync(MARGE_APRES_RESET_MS + 2_000)
      await vi.waitFor(() => expect(resumePilotChat).toHaveBeenCalledTimes(1))
      await vue.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
