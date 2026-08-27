import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * Une image jointe a un tour PASSE doit rester visible au tour suivant.
 *
 * Symptome vecu (2026-08-27) : l'utilisateur joint une image, en reparle au tour suivant, et
 * l'orchestrateur repond qu'aucune image ne lui est parvenue. L'image etait bien dans
 * l'historique recu par le pilote — mais seul `history.at(-1)` portait ses pieces jointes dans
 * le prompt, donc toute piece jointe d'un tour anterieur etait jetee en silence.
 */
describe('AgentPilot — pieces jointes de l historique', () => {
  const image = (name: string, content: string) => ({
    name,
    mimeType: 'image/png',
    kind: 'image' as const,
    size: 3,
    content
  })

  const harness = () => {
    const sent: Message[][] = []
    const registry = {
      send: vi.fn(
        async (
          _provider: string,
          messages: Message[],
          _options: SendOptions
        ): Promise<SendResult> => {
          sent.push(messages)
          return { text: 'Vu.', provider: 'codex', systemInjected: true } as SendResult
        }
      ),
      describePrompt: vi.fn(() => ({ provider: 'codex', messages: [], transport: 'test' }))
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'codex', model: 'gpt-test' })) }
    const bus = {
      catalog: vi.fn(() => []),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn()
    }
    return { sent, registry, roles, bus }
  }

  it('transmet une image jointe a un message ANTERIEUR', async () => {
    const { sent, registry, roles, bus } = harness()

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [
        { role: 'user', content: 'Voici la maquette', attachments: [image('maquette.png', 'YWJj')] },
        { role: 'assistant', content: 'Bien recu.' },
        { role: 'user', content: 'reprends la palette de l image' }
      ] as never,
      () => {},
      undefined,
      1,
      'conv-image-passee'
    )

    const attachments = sent.at(0)?.[0]?.attachments ?? []
    expect(attachments.map((a) => a.name)).toContain('maquette.png')
  })

  it('donne la priorite a la piece jointe du tour courant et borne le total a 8', async () => {
    const { sent, registry, roles, bus } = harness()
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: 'user' as const,
      content: `tour ${i}`,
      attachments: [image(`vieille-${i}.png`, `Y${i}`)]
    }))
    history.push({
      role: 'user' as const,
      content: 'et celle-ci',
      attachments: [image('courante.png', 'Zzz')]
    })

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      history as never,
      () => {},
      undefined,
      1,
      'conv-image-bornee'
    )

    const names = (sent.at(0)?.[0]?.attachments ?? []).map((a) => a.name)
    expect(names.length).toBeLessThanOrEqual(8)
    expect(names).toContain('courante.png')
    // La plus ANCIENNE est celle qu'on sacrifie, jamais la plus recente.
    expect(names).not.toContain('vieille-0.png')
  })

  it('ne duplique pas une piece jointe presente deux fois dans le fil', async () => {
    const { sent, registry, roles, bus } = harness()

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [
        { role: 'user', content: 'la voila', attachments: [image('memo.png', 'YWJj')] },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'je la remets', attachments: [image('memo.png', 'YWJj')] }
      ] as never,
      () => {},
      undefined,
      1,
      'conv-image-doublon'
    )

    const names = (sent.at(0)?.[0]?.attachments ?? []).map((a) => a.name)
    expect(names.filter((n) => n === 'memo.png')).toHaveLength(1)
  })

  it('ecarte une piece jointe sans binaire et se replie sur sa miniature', async () => {
    const { sent, registry, roles, bus } = harness()

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [
        // Fil REHYDRATE depuis le disque : `AttachmentMeta` ne persiste pas le contenu original.
        {
          role: 'user',
          content: 'la maquette d hier',
          attachments: [
            { name: 'perdue.png', mimeType: 'image/png', kind: 'image', size: 9 },
            {
              name: 'gardee.png',
              mimeType: 'image/png',
              kind: 'image',
              size: 9,
              thumbnail: 'data:image/png;base64,bWluaQ=='
            }
          ]
        },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'et la palette ?' }
      ] as never,
      () => {},
      undefined,
      1,
      'conv-image-rehydratee'
    )

    const jointes = sent.at(0)?.[0]?.attachments ?? []
    // Aucune piece jointe vide ne part : elle ferait ecrire un fichier de 0 octet chez le provider.
    expect(jointes.every((a) => (a.content ?? '').length > 0)).toBe(true)
    expect(jointes.map((a) => a.name)).not.toContain('perdue.png')
    const miniature = jointes.find((a) => a.name.startsWith('gardee.png'))
    expect(miniature?.content).toBe('bWluaQ==')
    // Jamais presentee comme l original.
    expect(miniature?.name).toContain('miniature')
  })
})
