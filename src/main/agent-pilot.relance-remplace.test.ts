import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'
import { createChatTurn, reduceChatTurn, type ChatTurnEvent } from '../shared/chat-turn'

/**
 * UNE RELANCE QUI FAIT REFAIRE LA REPONSE LA REMPLACE — ELLE NE S'Y AJOUTE PAS (D2, conv-267).
 *
 * Mesure du 2026-10-11 sur de vrais tours (copie du chantier « outils directs du chat ») : le texte
 * de chaque appel au modele part en direct dans la bulle. Quand la garde « conclusion absente » ou
 * « chiffre non verifie » relance le modele pour qu'il REFASSE sa reponse, l'ancienne restait
 * affichee et la nouvelle s'y ajoutait : la premiere phrase deux fois (2 tours sur 2), puis deux
 * blocs « ✅ Fait » sur un tour qui demandait un nombre. Le moteur rendait pourtant UNE reponse
 * (`done`) : le doublon naissait dans le fil, qui assemble les flux diffuses.
 *
 * L'oracle est donc le VRAI reducteur du fil (`reduceChatTurn`), nourri des evenements du pilote :
 * c'est lui qui construit ce que l'utilisateur lit, et ce qui est enregistre.
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

/** Ce que le fil affiche : les evenements du pilote passes dans le reducteur du fil. */
function texteDuFil(events: PilotEvent[]): string {
  let etat = createChatTurn('tour-test')
  for (const e of events) {
    const ev = e as { kind: string; streamId?: string; text?: string; iteration?: number }
    let tourEvent: ChatTurnEvent | undefined
    if (ev.kind === 'delta' && ev.text && ev.streamId)
      tourEvent = { kind: 'delta', streamId: ev.streamId, text: ev.text }
    else if (ev.kind === 'stream-reset' && ev.streamId)
      tourEvent = { kind: 'stream-reset', streamId: ev.streamId }
    // Meme correspondance que le fil (chat-view-model.ts) pour un texte non diffuse.
    else if (ev.kind === 'think' && ev.text)
      tourEvent = { kind: 'delta', streamId: `fallback:${ev.iteration ?? 0}`, text: ev.text }
    if (tourEvent) etat = reduceChatTurn(etat, tourEvent)
  }
  return etat.parts
    .filter((p): p is Extract<typeof p, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n')
}

const occurrences = (texte: string, motif: string): number => texte.split(motif).length - 1

async function jouer(
  demande: string,
  reponses: string[]
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
      // Diffusion EN DIRECT, comme le CLI : c'est elle qui remplit la bulle avant toute garde.
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
    exec: vi.fn().mockResolvedValue({ ok: true, data: { tab: 'chat', stored: true } })
  }
  const events: PilotEvent[] = []
  await new AgentPilot(registry as never, roles as never, bus as never).chat(
    [{ role: 'user', content: demande }],
    (event) => events.push(event),
    undefined,
    6,
    'conv-relance-remplace',
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
  return { fil: texteDuFil(events), appels: send.mock.calls.length, consignes }
}

const CLOTURE =
  '\n\n✅ Fait\n1. Lu l’état de l’app.\n\n📍 Maintenant : répondu.\n⏳ Reste à faire : aucune étape.\n👉 Recommandé : aucune suite.'

describe('relance de forme — la nouvelle réponse REMPLACE l’ancienne dans le fil', () => {
  it('conclusion absente : la phrase sans clôture n’est plus affichée deux fois', async () => {
    const { fil, appels, consignes } = await jouer('quel onglet est actif ?', [
      'Je regarde.<cmd>{"name":"get_state","args":{}}</cmd>',
      'L’onglet actif est chat.',
      `L’onglet actif est chat.${CLOTURE}`
    ])
    expect(appels).toBe(3)
    expect(consignes.at(-1)).toContain('ta réponse ne CONCLUT pas')
    expect(occurrences(fil, 'L’onglet actif est chat.')).toBe(1)
    expect(occurrences(fil, '✅ Fait')).toBe(1)
    // Le modele sait que sa reponse REMPLACE la precedente : il la redonne en entier.
    expect(consignes.at(-1)).toContain('REMPLACE')
    // Le texte d'un appel NON relance reste : seule la reponse refaite est remplacee.
    expect(fil).toContain('Je regarde.')
  })

  it('chiffre non vérifié : la réponse vérifiée remplace la première, sans second bloc', async () => {
    const { fil, appels, consignes } = await jouer('combien de fichiers dans src ?', [
      `Il y a 12 fichiers dans src.`,
      `Il y a 12 fichiers dans src, nombre relu.`
    ])
    expect(appels).toBe(2)
    expect(consignes.at(-1)).toContain('SANS avoir appelé la moindre commande')
    expect(occurrences(fil, 'Il y a 12 fichiers dans src')).toBe(1)
    expect(fil).toContain('nombre relu')
    expect(consignes.at(-1)).toContain('REMPLACE')
  })

  it('conclusion absente après un dépôt mémoire : même remplacement, troisième point de relance', async () => {
    const { fil, appels, consignes } = await jouer('retiens que le port est 9240', [
      'Leçon déposée : le port est 9240.<cmd>{"name":"remember","args":{"type":"domain"}}</cmd>',
      `Leçon déposée : le port est 9240.${CLOTURE}`
    ])
    expect(appels).toBe(2)
    expect(consignes.at(-1)).toContain('ta réponse ne CONCLUT pas')
    expect(occurrences(fil, 'Leçon déposée : le port est 9240.')).toBe(1)
    expect(occurrences(fil, '✅ Fait')).toBe(1)
  })
})
