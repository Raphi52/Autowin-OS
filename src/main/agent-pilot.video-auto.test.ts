import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatArtifact } from '../shared/artifacts'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * BRANCHEMENT : la vidéo fabriquée pendant le tour et CITÉE dans la réponse arrive dans le lecteur
 * du fil, sans que l'agent appelle `show_video` (conv-253, constat conv-260 du 2026-10-11 : une pub
 * rendue par ffmpeg, seulement nommée, l'utilisateur doit réclamer le lecteur).
 *
 * ffprobe est remplacé : la mesure a ses propres tests (`video-ffprobe.test.ts`) ; ici on prouve
 * que le TOUR produit la carte, une seule fois.
 */
vi.mock('./show-video-command', () => ({
  preparerVideoAMontrer: vi.fn(async (args: Record<string, unknown>) => ({
    ok: true,
    artifact: {
      id: `auto-${String(args.path)}`,
      name: 'pub.mp4',
      mimeType: 'video/mp4',
      kind: 'video',
      size: 6,
      createdAt: 1,
      path: String(args.path)
    },
    resume: {}
  }))
}))

const { AgentPilot } = await import('./agent-pilot')

let racine: string
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'pilot-video-auto-'))
  mkdirSync(join(racine, 'out'), { recursive: true })
})
afterEach(() => rmSync(racine, { recursive: true, force: true }))

function pilote(reponses: Array<string | (() => string)>, execArtifacts: ChatArtifact[] = []) {
  let tour = 0
  const registry = {
    send: vi.fn(async (_p: string, _m: Message[], _o: SendOptions): Promise<SendResult> => {
      const r = reponses[Math.min(tour, reponses.length - 1)]
      tour += 1
      return {
        text: typeof r === 'function' ? r() : r,
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
    exec: vi.fn(async () => ({ ok: true, data: { montre: true }, artifacts: execArtifacts }))
  }
  return new AgentPilot(
    registry as never,
    roles as never,
    bus as never,
    undefined,
    undefined,
    () => racine
  )
}

async function cartesDuTour(p: InstanceType<typeof AgentPilot>): Promise<ChatArtifact[]> {
  const events: Array<{ kind: string; artifact?: ChatArtifact }> = []
  await p.chat([{ role: 'user', content: 'fais la pub' }], (e) => events.push(e as never), undefined, 3)
  return events.filter((e) => e.kind === 'artifact').map((e) => e.artifact as ChatArtifact)
}

describe('AgentPilot — vidéo livrée montrée sans show_video', () => {
  it('la pub rendue pendant le tour et citée arrive dans le lecteur', async () => {
    const chemin = join(racine, 'out', 'pub-v2.mp4')
    const cartes = await cartesDuTour(
      pilote([
        () => {
          writeFileSync(chemin, 'octets') // ffmpeg écrit le fichier PENDANT le tour
          return `La pub est prête : **\`${chemin}\`**. Elle dure 51 s.`
        }
      ])
    )
    expect(cartes).toEqual([expect.objectContaining({ kind: 'video', path: chemin })])
  })

  it('une vidéo ancienne seulement citée ne fait pas de lecteur', async () => {
    const ancienne = join(racine, 'out', 'pub-v1.mp4')
    writeFileSync(ancienne, 'octets')
    const passe = new Date(Date.now() - 3_600_000)
    utimesSync(ancienne, passe, passe)
    expect(await cartesDuTour(pilote([`La v1 est restée à côté : \`${ancienne}\`.`]))).toEqual([])
  })

  it('déjà montrée par show_video plus tôt dans le tour : un seul lecteur', async () => {
    const chemin = join(racine, 'out', 'film.mp4')
    writeFileSync(chemin, 'octets')
    const carteCommande = {
      id: 'carte-commande',
      name: 'film.mp4',
      mimeType: 'video/mp4',
      kind: 'video',
      size: 6,
      createdAt: 1,
      path: chemin
    } as ChatArtifact
    const cartes = await cartesDuTour(
      pilote(
        [
          `<cmd>${JSON.stringify({ name: 'show_video', args: { path: chemin } })}</cmd>`,
          `Le film est dans le fil : \`${chemin}\`.`
        ],
        [carteCommande]
      )
    )
    expect(cartes.map((c) => c.id)).toEqual(['carte-commande'])
  })
})
