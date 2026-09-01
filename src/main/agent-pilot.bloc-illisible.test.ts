import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent, type PilotEventVariant } from './agent-pilot'
import type { PromptSnapshot } from './commands'

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

type Delta = Extract<PilotEventVariant, { kind: 'delta' }>
type Reset = Extract<PilotEventVariant, { kind: 'stream-reset' }>
type Resultat = Extract<PilotEventVariant, { kind: 'result' }>

/**
 * CE QUE L'UTILISATEUR VOIT QUAND UNE COMMANDE EST REFUSEE.
 *
 * Vecu le 2026-09-01 (conv-46), capture a l'appui : deux blocs `<cmd>` casses dans le meme tour ont
 * laisse leur JSON ENTIER affiche en plein milieu du fil, et le second n'a meme pas ete signale.
 *
 * Deux causes distinctes, donc deux garanties ici :
 *  1. Le texte est diffuse en direct AVANT d'etre analyse : il porte le bloc BRUT. Le nettoyage du
 *     flux etait conditionne a la presence d'une commande VALIDE (`hasCommand`) — or un bloc casse
 *     n'en produit aucune, donc rien n'etait jamais retire.
 *  2. Le credit « une relance par tour » bridait aussi l'AVERTISSEMENT : le deuxieme bloc casse
 *     disparaissait sans un mot.
 *
 * L'ENTREE QUI CASSERAIT UN FAUX FIX est ici le SECOND bloc : un correctif qui ne traiterait que le
 * premier (celui qui declenche la relance) laisserait ce test rouge.
 */
describe('bloc <cmd> illisible — le fil reste lisible', () => {
  it('efface le bloc brut deja diffuse et signale CHAQUE bloc casse du tour', async () => {
    // Deux JSON tronques d'affilee : accolade fermante manquante, exactement le cas vecu.
    const reponses = [
      'Je depose la lecon.<cmd>{"name":"remember","args":{"title":"x"</cmd>',
      'Je retente.<cmd>{"name":"remember","args":{"title":"y"</cmd>'
    ]
    const send = vi.fn(
      async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        const text = reponses.shift() ?? 'Je ne peux pas deposer la lecon.'
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
      catalog: () => [{ name: 'remember', args: {}, description: 'memoire auxiliaire' }],
      snapshotForPrompt,
      exec: vi.fn()
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'ajoute une note de contrainte dans la memoire' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-bloc-illisible'
    )

    // 1. CHAQUE bloc casse est signale — pas seulement le premier.
    const signalements = events.filter(
      (event): event is Resultat => event.kind === 'result' && event.name === 'commande illisible'
    )
    expect(signalements).toHaveLength(2)
    expect(signalements.every((signalement) => signalement.ok === false)).toBe(true)

    // 2. Aucun flux portant le bloc BRUT ne reste affiche : chacun est efface...
    const deltas = events.filter((event): event is Delta => event.kind === 'delta')
    const fluxAvecBlocBrut = new Set(
      deltas.filter((delta) => delta.text.includes('<cmd>')).map((delta) => delta.streamId)
    )
    const fluxEfffaces = new Set(
      events.filter((event): event is Reset => event.kind === 'stream-reset').map((e) => e.streamId)
    )
    expect(fluxAvecBlocBrut.size).toBe(2)
    for (const flux of fluxAvecBlocBrut) expect(fluxEfffaces.has(flux)).toBe(true)

    // ... et remplace par le SEUL texte parle, sans une ligne de tuyauterie.
    const republies = deltas.filter((delta) => delta.streamId.endsWith(':sans-bloc'))
    expect(republies).toHaveLength(2)
    expect(republies.map((delta) => delta.text)).toEqual(['Je depose la lecon.', 'Je retente.'])

    // Aucune commande n'a ete inventee a partir d'un bloc casse.
    expect(bus.exec).not.toHaveBeenCalled()
  })
})
