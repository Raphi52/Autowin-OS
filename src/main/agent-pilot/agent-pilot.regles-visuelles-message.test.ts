import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { RAPPEL_REGLES_VISUELLES } from '../consignes/chat-pilotage-prompt'
import type { Message, SendOptions, SendResult } from '../providers/types'

/**
 * LE SYSTÈME NE BOUGE PAS QUAND LE TOUR DEVIENT VISUEL.
 *
 * Mesure du 2026-11-08 (`scripts/poids-du-contexte.mjs`, rubrique « Fils repris », croisée avec
 * `prompt-observability/systems/`) : 9 des 17 reprises dont la mémoire de relecture avait cassé
 * à moins d'une heure d'intervalle ne différaient du tour d'avant QUE par le bloc des règles de
 * travail visuel (2 856 caractères), servi en queue du système selon les mots du message. Le système
 * précède tout l'historique : 8,41 $ réécrits ce jour-là pour ~700 tokens « économisés ».
 */
function banc() {
  const systemes: string[] = []
  const messages: string[] = []
  const registry = {
    send: vi.fn(async (_p: string, m: Message[], o: SendOptions): Promise<SendResult> => {
      systemes.push(o.system ?? '')
      messages.push(m.map((x) => x.content).join('\n'))
      return { text: 'ok', sessionId: 'sess-visuel' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    honoursSessionResume: vi.fn(() => true)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => []),
    snapshotForPrompt: vi.fn(async () => ({})),
    exec: vi.fn()
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pilot = new AgentPilot(registry as any, roles as any, bus as any)
  return { pilot, systemes, messages }
}

describe('règles de travail visuel : dans le message du tour, jamais dans le système', () => {
  it('garde le même système entre un tour sans mot visuel et un tour sur un bouton', async () => {
    const { pilot, systemes, messages } = banc()
    const fil: Message[] = [{ role: 'user', content: 'combien de tests dans le dépôt ?' }]
    await pilot.chat(fil, () => {}, undefined, 1, 'conv-visuel-1')
    fil.push(
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'le bouton de la sidebar est mal aligné' }
    )
    await pilot.chat(fil, () => {}, undefined, 1, 'conv-visuel-1')

    // Le premier tour peut relancer le modèle une fois : chaque envoi compte, aucun ne diverge.
    expect(systemes.length).toBeGreaterThanOrEqual(2)
    expect(new Set(systemes).size).toBe(1)
    expect(systemes[0]).not.toContain('PREUVE VISUELLE FRONT')
    expect(messages[0]).not.toContain('PREUVE VISUELLE FRONT')
    const tourVisuel = messages.at(-1) ?? ''
    expect(tourVisuel).toContain('RÈGLES DE TRAVAIL VISUEL')
    expect(tourVisuel).toContain('PREUVE VISUELLE FRONT')
    expect(tourVisuel).toContain('-Id chat-conv-visuel-1')
  })

  it("ne renvoie qu'un rappel d'une ligne à la session reprise qui porte déjà le bloc", async () => {
    const { pilot, messages } = banc()
    const fil: Message[] = [{ role: 'user', content: 'refais l icône de l app' }]
    await pilot.chat(fil, () => {}, undefined, 1, 'conv-visuel-2')
    fil.push(
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'change la couleur du titre en or' }
    )
    await pilot.chat(fil, () => {}, undefined, 1, 'conv-visuel-2')

    expect(messages[0]).toContain('PREUVE VISUELLE FRONT')
    const reprise = messages.at(-1) ?? ''
    expect(reprise).toContain(RAPPEL_REGLES_VISUELLES)
    expect(reprise).not.toContain('PREUVE VISUELLE FRONT')
  })

  it('sert le bloc sur une image jointe sans mot visuel', async () => {
    const { pilot, systemes, messages } = banc()
    await pilot.chat(
      [
        {
          role: 'user',
          content: 'et ça ?',
          attachments: [{ kind: 'image', name: 'a.png', mimeType: 'image/png', content: 'aGk=' }]
        } as Message
      ],
      () => {},
      undefined,
      1,
      'conv-visuel-3'
    )
    expect(messages[0]).toContain('skills/look/SKILL.md')
    expect(systemes[0]).not.toContain('skills/look/SKILL.md')
  })
})
