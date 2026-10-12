import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * UNE VIDÉO MONTRÉE PAR COMMANDE ARRIVE DANS LE FIL, JAMAIS DANS LE PROMPT (conv-253, 2026-10-11).
 *
 * `attachments` d'un résultat de commande part dans le prochain message du modèle ; seules les
 * IMAGES y sont republiées comme carte. Une vidéo ne doit suivre ni l'un ni l'autre chemin : elle
 * passe par le champ `artifacts`, rendu dans le fil et absent du prompt.
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER une mauvaise correction : élargir le filtre « images seules » des
 * `attachments` pour y faire passer la vidéo enverrait le film au modèle (2e envoi ci-dessous).
 */
describe('AgentPilot — show_video', () => {
  const carte = {
    id: 'video-b6',
    name: 'film.mp4',
    mimeType: 'video/mp4',
    kind: 'video' as const,
    size: 947729,
    createdAt: 1,
    path: 'D:\\Autowin\\artifacts\\video-b6-clavier\\film.mp4',
    fps: 30,
    source: {
      provider: 'autowin',
      tool: 'show_video',
      originalPath: 'D:\\Autowin\\artifacts\\video-b6-clavier\\film.mp4'
    }
  }

  it('émet la carte vidéo dans le fil et n’envoie rien de la vidéo au modèle', async () => {
    const envois: Message[][] = []
    let tour = 0
    const registry = {
      send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
        envois.push(messages)
        tour += 1
        return {
          text:
            tour === 1
              ? '<cmd>{"name":"show_video","args":{"path":"artifacts/video-b6-clavier/film.mp4","fps":30}}</cmd>'
              : 'Le film est dans le fil.',
          provider: 'codex',
          systemInjected: true
        } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'codex', messages: [], transport: 'test' }))
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'codex', model: 'gpt-test' })) }
    const bus = {
      catalog: vi.fn(() => [{ name: 'show_video', description: 'montrer', args: {} }]),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn(async () => ({
        ok: true,
        data: { montre: true, nom: 'film.mp4' },
        artifacts: [carte]
      }))
    }
    const events: Array<{ kind: string; artifact?: Record<string, unknown> }> = []
    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'montre le film' }],
      (event) => events.push(event as never),
      undefined,
      3,
      'conv-video'
    )

    const cartes = events.filter((event) => event.kind === 'artifact').map((e) => e.artifact)
    expect(cartes).toEqual([expect.objectContaining({ id: 'video-b6', kind: 'video', fps: 30 })])
    expect(envois.length).toBeGreaterThanOrEqual(2)
    const suite = envois.slice(1).flat()
    expect(suite.some((message) => (message.attachments ?? []).length > 0)).toBe(false)
  })
})
