import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { configureAutowinAppDataBase } from '../app/app-data'
import type { PromptSnapshot } from '../commands/commands'
import type { ChatArtifact } from '../../shared/artifacts'
import {
  reduceAssistantPilotEvent,
  type AssistantPilotEvent,
  type HydratedAssistantMessage
} from '../../renderer/src/components/chat-view-model'

/**
 * UNE RELANCE NE REFAIT QUE LA CONCLUSION : LE RÉCIT DU TRAVAIL RESTE (conv-1401, 2026-10-31).
 *
 * Tour réel 79a873fa : un seul appel de 3 h, son texte entrecoupé de 30 captures. Il finissait sur
 * « je reviens avec le film » ; la relance « tu promets un compte-rendu » a effacé le flux ENTIER
 * (8 384 caractères), alors que le modèle n'a réécrit que sa conclusion. L'utilisateur a perdu le
 * récit de 3 h de travail. Ici : un récit, une capture (un geste au milieu de l'appel), puis la
 * promesse. Seule la promesse doit partir.
 *
 * L'oracle est le VRAI réducteur du fil en direct (`reduceAssistantPilotEvent`), nourri des
 * événements du pilote : ce que l'utilisateur lit pendant le tour.
 */
let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'relance-recit-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

const capture: ChatArtifact = {
  id: 'capture-1',
  name: 'vol.png',
  mimeType: 'image/png',
  kind: 'image',
  size: 1,
  createdAt: 1,
  source: { provider: 'claude', tool: 'Read' }
}

type Morceau = { delta: string } | { delta: ''; artifacts: ChatArtifact[] }

function texteDuFil(events: PilotEvent[]): string {
  let message: HydratedAssistantMessage = {
    role: 'assistant',
    content: '',
    parts: [],
    done: false,
    turnId: 'tour-test'
  } as unknown as HydratedAssistantMessage
  for (const e of events)
    message = reduceAssistantPilotEvent(message, e as unknown as AssistantPilotEvent)
  return message.parts
    .filter((p): p is Extract<typeof p, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n')
}

async function jouer(
  demande: string,
  appels: Morceau[][]
): Promise<{ fil: string; consignes: string[] }> {
  const consignes: string[] = []
  const send = vi.fn(
    async (
      _provider: string,
      messages: { content: string }[],
      _options: unknown,
      onChunk?: (chunk: Morceau) => void
    ) => {
      consignes.push(messages.map((m) => m.content).join('\n'))
      const morceaux = appels.shift() ?? []
      for (const morceau of morceaux) onChunk?.(morceau)
      return { text: morceaux.map((m) => m.delta).join(''), provider: 'claude' }
    }
  )
  const registry = {
    send,
    describePrompt: () => ({
      provider: 'claude',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
  }
  const roles = {
    getBinding: () => ({ provider: 'claude', model: 'claude-test', reasoningEffort: 'low' })
  }
  const bus = {
    catalog: () => [{ name: 'get_state', args: {}, description: 'etat' }],
    snapshotForPrompt,
    exec: vi.fn(async () => ({ ok: true, data: { tab: 'chat' } }))
  }
  const events: PilotEvent[] = []
  await new AgentPilot(registry as never, roles as never, bus as never).chat(
    [{ role: 'user', content: demande }],
    (event) => events.push(event),
    undefined,
    6,
    'conv-relance-recit',
    undefined, // signal
    undefined, // drainDirectives
    undefined, // bindingOverride
    undefined, // turnId
    undefined, // runtimeBinding
    undefined, // recoveredProviderCall
    undefined, // onProviderJournal
    undefined, // sendLimits
    undefined, // routingUserMessageOverride
    undefined, // tourCoupePourCeMessage
    true // exigerExperienceSoignee : la politique que la surface de chat active en vrai
  )
  return { fil: texteDuFil(events), consignes }
}

const CLOTURE =
  '\n\n✅ Fait\n1. Rendu le film.\n\n📍 Maintenant : film rendu.\n⏳ Reste à faire : aucune étape.\n👉 Recommandé : aucune suite.'

describe('relance de forme sur un appel qui a travaillé — seule la conclusion est refaite', () => {
  it('preuve promise : le récit écrit avant la capture reste, seule la promesse part', async () => {
    const { fil, consignes } = await jouer('rends le film', [
      [{ delta: 'Je lance le rendu.<cmd>{"name":"get_state","args":{}}</cmd>' }],
      [
        { delta: 'RECIT-DU-TRAVAIL : les lettres sortent du cercle.' },
        { delta: '', artifacts: [capture] },
        { delta: '\n\nLe rendu tourne, je te tiens au courant dès qu’il a fini.' }
      ],
      [{ delta: `Le rendu est terminé.${CLOTURE}` }]
    ])
    expect(consignes.at(-1)).toContain('PROMET un compte-rendu ultérieur')
    expect(fil).toContain('RECIT-DU-TRAVAIL')
    expect(fil).not.toContain('je te tiens au courant')
    expect(fil).toContain('Le rendu est terminé.')
  })

  it('appel SANS geste : toute la réponse est remplacée, comme avant (D2, conv-267)', async () => {
    const { fil } = await jouer('rends le film', [
      [{ delta: 'Je lance le rendu.<cmd>{"name":"get_state","args":{}}</cmd>' }],
      [{ delta: 'Le rendu tourne, je te tiens au courant dès qu’il a fini.' }],
      [{ delta: `Le rendu est terminé.${CLOTURE}` }]
    ])
    expect(fil).not.toContain('je te tiens au courant')
    expect(fil).toContain('Le rendu est terminé.')
    expect(fil).toContain('Je lance le rendu.')
  })
})
