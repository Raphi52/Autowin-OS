import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { PromptSnapshot } from '../commands/commands'
import type { RoleBinding } from '../profil/roles'

/**
 * « ULTRATHINK » ENVOYÉ PENDANT LE TOUR : L'APPEL COUPÉ REPART PLUS HAUT, AVEC LE MESSAGE.
 *
 * Le niveau de réflexion du CLI se fixe à son lancement. Quand le message arrive, le réglage du
 * tour monte (`chat/ultrathink-du-tour.ts`) et le contrôle avant outil arrête l'appel en cours, qui
 * rend alors un texte VIDE sans erreur (mesuré sur le CLI 2.1.321, `terminal_reason: hook_stopped`).
 * Ici, la vraie boucle du tour : elle doit relancer le modèle avec le message, au niveau monté.
 * Entrée qui doit faire échouer ce test : une boucle qui clôt le tour sur le texte vide, ou qui
 * relit le réglage une seule fois au début du tour.
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

function pilote(queue: string[], reglageDuTour: RoleBinding) {
  const send = vi.fn(
    async (
      _provider: unknown,
      _messages: Array<{ content: string }>,
      _options: { reasoningEffort?: string }
    ) => ({ text: 'Terminé', provider: 'claude' })
  )
  const registry = {
    send,
    describePrompt: () => ({ provider: 'claude', transport: 'fixture', messages: [], options: {} })
  }
  const bus = {
    catalog: () => [{ name: 'get_state', args: {}, description: 'état' }],
    snapshotForPrompt,
    exec: vi.fn(async () => ({ ok: true, data: {} }))
  }
  const roles = { getBinding: () => ({ provider: 'claude', model: 'opus-test' }) }
  const lancer = (): Promise<unknown> =>
    new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'corrige a.ts' }],
      () => undefined,
      undefined,
      6,
      'conv-ultrathink',
      undefined,
      () => queue.splice(0, queue.length),
      undefined,
      'tour-1',
      reglageDuTour
    )
  return { send, lancer }
}

describe('ultrathink envoyé pendant que le modèle travaille', () => {
  it('l’appel coupé repart avec le message, au niveau de réflexion monté', async () => {
    const queue: string[] = []
    const reglage: RoleBinding = {
      provider: 'claude',
      model: 'opus-test',
      reasoningEffort: 'medium'
    }
    const { send, lancer } = pilote(queue, reglage)
    // Pendant le premier appel : le message arrive, le réglage du tour monte, l'appel est coupé.
    send.mockImplementationOnce(async () => {
      queue.push('ultrathink regarde aussi b.ts')
      reglage.reasoningEffort = 'xhigh'
      return { text: '', provider: 'claude' }
    })
    await lancer()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][2].reasoningEffort).toBe('medium')
    expect(send.mock.calls[1][2].reasoningEffort).toBe('xhigh')
    const second = send.mock.calls[1][1][0].content
    expect(second).toContain('DIRECTIVE INJECTÉE EN COURS DE TOUR')
    expect(second).toContain('ultrathink regarde aussi b.ts')
  })

  it('jumeau : sans montée, l’appel relancé garde le niveau du tour', async () => {
    const queue: string[] = []
    const reglage: RoleBinding = {
      provider: 'claude',
      model: 'opus-test',
      reasoningEffort: 'medium'
    }
    const { send, lancer } = pilote(queue, reglage)
    send.mockImplementationOnce(async () => {
      queue.push('regarde aussi b.ts')
      return { text: '', provider: 'claude' }
    })
    await lancer()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][2].reasoningEffort).toBe('medium')
  })
})
