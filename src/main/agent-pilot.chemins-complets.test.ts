import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import type { PromptSnapshot } from './commands'
import { createChatTurn, reduceChatTurn, type ChatTurnEvent } from '../shared/chat-turn'

/*
 * Rejeu de conv-1335 à travers le VRAI pilote : la réponse qui cite un chemin relatif est refaite,
 * et le fil n'affiche que la nouvelle. L'oracle est le réducteur du fil, comme pour les autres
 * relances de forme (agent-pilot.relance-remplace.test.ts).
 */
let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'chemins-complets-'))
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

function texteDuFil(events: PilotEvent[]): string {
  let etat = createChatTurn('tour-test')
  for (const e of events) {
    const ev = e as { kind: string; streamId?: string; text?: string; iteration?: number }
    let tourEvent: ChatTurnEvent | undefined
    if (ev.kind === 'delta' && ev.text && ev.streamId)
      tourEvent = { kind: 'delta', streamId: ev.streamId, text: ev.text }
    else if (ev.kind === 'stream-reset' && ev.streamId)
      tourEvent = { kind: 'stream-reset', streamId: ev.streamId }
    else if (ev.kind === 'think' && ev.text)
      tourEvent = { kind: 'delta', streamId: `fallback:${ev.iteration ?? 0}`, text: ev.text }
    if (tourEvent) etat = reduceChatTurn(etat, tourEvent)
  }
  return etat.parts
    .filter((p): p is Extract<typeof p, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n')
}

async function jouer(
  reponses: string[],
  soignee = true
): Promise<{ fil: string; appels: number; consignes: string[] }> {
  const consignes: string[] = []
  const send = vi.fn(
    async (
      _provider: string,
      messages: { content: string }[],
      _options: unknown,
      onChunk?: (chunk: { delta: string }) => void
    ) => {
      consignes.push(messages.map((m) => m.content).join('\n'))
      const text = reponses.shift() ?? ''
      onChunk?.({ delta: text })
      return { text, provider: 'claude' }
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
    catalog: () => [
      { name: 'get_state', args: {}, description: 'etat' },
      { name: 'remember', args: {}, description: 'memoire' }
    ],
    snapshotForPrompt,
    exec: vi.fn(async () => ({ ok: true, data: { stored: true } }))
  }
  const events: PilotEvent[] = []
  await new AgentPilot(registry as never, roles as never, bus as never).chat(
    [{ role: 'user', content: 'il est ou le film ?' }],
    (event) => events.push(event),
    undefined,
    6,
    'conv-chemins-complets',
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
    soignee
  )
  return { fil: texteDuFil(events), appels: send.mock.calls.length, consignes }
}

const RELATIF = 'Le film est ici : `film/sortie/film-rapide/autowin-os-film.mp4`.'
const COMPLET =
  'Le film est ici : `C:\\Users\\camille\\AppData\\Local\\autowin-video\\film\\sortie\\autowin-os-film.mp4`.'
const CLOTURE =
  '\n\n✅ Fait\n1. Lu l’état de l’app.\n\n📍 Maintenant : répondu.\n⏳ Reste à faire : aucune étape.\n👉 Recommandé : aucune suite.'

describe('chemin relatif dans une réponse du chat', () => {
  it('rejeu conv-1335 : la réponse est refaite et le fil ne garde que le chemin complet', async () => {
    const { fil, appels, consignes } = await jouer([RELATIF, COMPLET])
    expect(appels).toBe(2)
    expect(consignes[1]).toContain(
      'chemins incomplets : `film/sortie/film-rapide/autowin-os-film.mp4`'
    )
    expect(fil).toContain('C:\\Users\\camille')
    expect(fil).not.toContain('`film/sortie')
  })

  it('contrôle : une réponse en chemins complets part du premier coup', async () => {
    const { fil, appels } = await jouer([COMPLET])
    expect(appels).toBe(1)
    expect(fil).toContain('C:\\Users\\camille')
  })

  it('une seule relance par tour : un modèle qui recommence ne boucle pas', async () => {
    const { appels, fil } = await jouer([RELATIF, RELATIF, RELATIF])
    expect(appels).toBe(2)
    expect(fil).toContain('film/sortie')
  })

  it('hors surface de chat soignée, rien ne se déclenche', async () => {
    const { appels } = await jouer([RELATIF], false)
    expect(appels).toBe(1)
  })

  it('texte + remember : la réponse est refaite aussi, le cas d’un tour qui finit par retenir', async () => {
    // La clôture est là exprès : sans elle, c'est la garde « conclusion absente » qui relancerait,
    // et ce test passerait sans que le contrôle des chemins ait joué.
    const { fil, appels, consignes } = await jouer([
      `${RELATIF}${CLOTURE}<cmd>{"name":"remember","args":{"title":"t","fact":"f","type":"domain","source":"session:current"}}</cmd>`,
      `${COMPLET}${CLOTURE}`
    ])
    expect(appels).toBe(2)
    expect(consignes[1]).toContain(
      'chemins incomplets : `film/sortie/film-rapide/autowin-os-film.mp4`'
    )
    expect(fil).toContain('C:\\Users\\camille')
    expect(fil).not.toContain('`film/sortie')
  })
})
