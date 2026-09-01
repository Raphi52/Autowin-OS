import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'
import { createChatTurn, reduceChatTurn, type ChatTurnEvent } from '../shared/chat-turn'

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

/**
 * NOTE (2026-08-18) : les prompts de ce fichier sont volontairement NEUTRES (« regarde … »).
 *
 * Ils portaient « scout … », choisi comme simple decor. Depuis que « scout » nomme deterministe­ment
 * la phase (`skill-routing.ts`, arbitrage utilisateur du 2026-08-18), un tel prompt court-circuite le
 * pilote et part en orchestration : ces tests ne testaient plus le streaming mais le routage. Le
 * comportement verifie ici — une commande atteint le bus, aucun faux blocage terminal — est inchange.
 */
/** Le texte du dernier `done` — le seul que l'utilisateur lit. */
function texteDuDone(events: PilotEvent[]): string {
  const done = [...events].reverse().find((e) => e.kind === 'done') as
    { kind: 'done'; text?: string } | undefined
  return done?.text ?? ''
}

describe('AgentPilot chat streaming', () => {
  /*
   * CE TEST A CHANGE D'INVARIANT le 2026-09-01, sur decision utilisateur (conv-52), et il faut le
   * dire. Il verrouillait « ne repaie pas un appel pour un remember refuse » — l'economie. Constat
   * de l'utilisateur sur sa capture (conv-49) : le refus s'affichait, le tour se fermait, et le
   * modele n'apprenait JAMAIS le motif, donc ne pouvait pas ajouter l'argument manquant. Le nouvel
   * invariant : UNE reprise est payee, jamais deux, et le refus qui survit est dit.
   */
  it('un remember auxiliaire refusé est REJOUÉ une fois, pas davantage', async () => {
    const responses = [
      'Scout livré.<cmd>{"name":"remember","args":{"type":"constraint"}}</cmd>',
      'Le dépôt mémoire a échoué.'
    ]
    const send = vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'claude' }))
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
      catalog: () => [{ name: 'remember', args: {}, description: 'mémoire auxiliaire' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: false, error: 'type invalide' })
    }
    const events: PilotEvent[] = []

    /**
     * Le message porte une demande MUTANTE : c'est la seule route où une `<cmd>` atteint le bus,
     * donc la seule où « ne pas repayer un appel » se mesure.
     *
     * Il disait « scout la vue Chat » et ce test était rouge : depuis que le classifieur reconnaît
     * un contrat scout sans slash (`orchestrator.scout-readonly`), ce libellé ouvre un tour
     * `direct-read-only`, où une commande générée est bloquée AVANT le bus par défense en
     * profondeur — comportement délibéré, couvert par `agent-pilot.turn-contract` (« bloque
     * mecaniquement une commande generee dans un tour lecture seule »). Le scénario visé ici
     * n'était donc plus exercé du tout. La garantie testée, elle, est inchangée.
     */
    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'ajoute une note de contrainte dans la memoire' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-remember-cost'
    )

    // UNE reprise, bornee : deux appels au modele, jamais trois.
    expect(send).toHaveBeenCalledTimes(2)
    expect(bus.exec).toHaveBeenCalledTimes(1)
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'result',
        name: 'remember',
        ok: false,
        data: 'type invalide'
      })
    )
    // Le refus SURVIT jusqu'a la cloture : le modele n'a pas rejoue le depot.
    expect(texteDuDone(events)).toContain('NON déposée')
  })

  it('OPEN BAR : une commande émise dans un tour « scout » ATTEINT le bus, et la réponse dite survit', async () => {
    // Ce test asseyait le BLOCAGE d'une commande sur un message « scout » (classé lecture-seule).
    // Open bar (choix utilisateur 2026-08-14) : plus de blocage sur un tour utilisateur — la commande
    // `remember` joue. Le texte dit (« Scout livré. ») reste la réponse finale, jamais une bulle vide.
    const responses = [
      'Scout livré.<cmd>{"name":"remember","args":{"type":"constraint"}}</cmd>',
      'Deuxième appel qui ne devrait pas avoir lieu.'
    ]
    const send = vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'claude' }))
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
      catalog: () => [{ name: 'remember', args: {}, description: 'mémoire auxiliaire' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: {} })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'regarde la vue Chat' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-open-bar-scout'
    )

    // La commande a joué (plus de blocage) — mais un remember auxiliaire ne repaie pas un 2e appel.
    expect(bus.exec).toHaveBeenCalledTimes(1)
    expect(bus.exec.mock.calls[0][0]).toBe('remember')
    expect(send).toHaveBeenCalledTimes(1)
    // Le texte livré reste la réponse finale (jamais une bulle vide).
    expect(events.at(-1)).toMatchObject({ kind: 'done', text: 'Scout livré.' })
  })

  it('demande une conclusion quand la réponse ne contient qu’un remember auxiliaire', async () => {
    const responses = [
      '<cmd>{"name":"remember","args":{"type":"constraint"}}</cmd>',
      'Le dépôt mémoire a échoué, mais le travail demandé est terminé.'
    ]
    const send = vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'claude' }))
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
      catalog: () => [{ name: 'remember', args: {}, description: 'mémoire auxiliaire' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: false, error: 'type invalide' })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'mémorise puis conclus' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-remember-muted'
    )

    expect(send).toHaveBeenCalledTimes(2)
    expect(bus.exec).toHaveBeenCalledTimes(1)
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'result',
        name: 'remember',
        ok: false,
        data: 'type invalide'
      })
    )
    expect(texteDuDone(events)).toContain(
      'Le dépôt mémoire a échoué, mais le travail demandé est terminé.'
    )
    // Le depot n'a pas abouti : la cloture le porte, quel que soit le chemin de sortie.
    expect(texteDuDone(events)).toContain('NON déposée')
  })

  /*
   * CE TEST A CHANGE D'INVARIANT le 2026-08-27, sur decision utilisateur, et il faut le dire.
   *
   * Il verrouillait « clot mecaniquement sans repayer un appel » : le tour se fermait sur l'issue
   * structuree et le modele n'ecrivait jamais la cloture. Constat sur conv-1449 : le pied GABARIT
   * annoncait « Recommandé : faire exécuter le travail si le besoin n'est pas encore réalisé » alors
   * que le run avait joue build ET judge, DoD cochee, status green. Un gabarit qui devine la portee
   * se trompe des que le champ qu'il lit arrive vide — trois mensonges, trois rustines. Le modele
   * reprend donc la parole, au prix ASSUME d'un appel de generation de plus par orchestration.
   *
   * CE QUI RESTE VERROUILLE, et qui etait la vraie valeur de ce test : une seule orchestration par
   * tour, et le rapport PROVISOIRE du worker (« Next: commit final ») reste expurge de ce qui est
   * rendu au modele — c'etait le defaut que la cloture mecanique protegeait.
   */
  it('rend la parole au modèle sans laisser passer le rapport provisoire du worker', async () => {
    const reponses = [
      'Je lance.<cmd>{"name":"orchestrate","args":{"task":"corrige puis teste","phase":"build"}}</cmd>' +
        ' Je lancerai ensuite judge.',
      'Corrigé et testé : 11 tests ciblés verts, le run est fermé.'
    ]
    const send = vi.fn(
      async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        const text = reponses.shift() ?? 'Terminé.'
        onChunk?.({ delta: text })
        return { text, provider: 'codex' }
      }
    )
    const registry = {
      send,
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = {
      catalog: () => [{ name: 'orchestrate', args: {}, description: 'workflow complet' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          status: 'succeeded',
          valid: true,
          gateBlocked: false,
          reused: false,
          runPath: 'C:/runs/conv/build-settings-workspace/RUN.md',
          result: 'Tests cibles 11/11 verts.\nNext: commit final puis livraison.'
        }
      })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'fais tout' }],
      (event) => events.push(event),
      undefined,
      12,
      'conv-1'
    )

    // Le modele reprend la parole : un appel de plus, c'est le prix assume de la cloture ecrite.
    expect(send).toHaveBeenCalledTimes(2)
    // UNE seule orchestration : la garde `orchestrationIssued` n'est pas relachee.
    expect(bus.exec).toHaveBeenCalledTimes(1)
    expect(events.filter((event) => event.kind === 'command')).toHaveLength(1)
    const done = events.find((event) => event.kind === 'done')
    // La cloture affichee est celle du MODELE, plus le pied devine.
    expect(done?.text).toContain('11 tests ciblés verts')
    expect(done?.text).not.toContain('faire exécuter le travail')
    // Ce qui est RENDU au modele : l'issue autoritative, expurgee du « Next: » provisoire du worker.
    const secondAppel = JSON.stringify(send.mock.calls[1]?.[1] ?? '')
    expect(secondAppel).toContain('ISSUE AUTORITATIVE')
    expect(secondAppel).toContain('Tests cibles 11/11 verts.')
    expect(secondAppel).not.toContain('Next:')
    expect(done?.text).not.toContain('commit final')
  })

  it('ne forge pas une clôture verte depuis un outcome incomplet', async () => {
    const text = '<cmd>{"name":"orchestrate","args":{"task":"corrige"}}</cmd>'
    const registry = {
      send: vi.fn(async () => ({ text, provider: 'codex' })),
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = {
      catalog: () => [{ name: 'orchestrate', args: {}, description: 'workflow complet' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { status: 'succeeded' } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'fais tout' }],
      (event) => events.push(event),
      undefined,
      12,
      'conv-malformed'
    )

    const done = events.find((event) => event.kind === 'done')
    expect(done?.text).toContain('résultat terminal rendu')
    expect(done?.text).not.toContain('gate validé')
    expect(done?.text).not.toContain('✅')
  })

  it('ne rend pas visible un faux blocage terminal quand la même itération exécute encore une commande', async () => {
    const responses = [
      '<cmd>{"name":"find_in_files","args":{"pattern":"status","dir":"src"}}</cmd>' +
        '⛔ Bloqué — les commandes de lecture n’ont retourné aucun résultat exploitable.',
      'Synthèse vérifiée après lecture.'
    ]
    const registry = {
      send: vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'claude' })),
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
      catalog: () => [{ name: 'find_in_files', args: {}, description: 'recherche locale' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { trouve: 3 } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'regarde le dépôt' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-premature-blocked'
    )

    expect(bus.exec).toHaveBeenCalledOnce()
    expect(events.map((event) => event.text ?? '').join('')).not.toContain('⛔ Bloqué')
    expect(events.at(-1)).toMatchObject({ kind: 'done', text: 'Synthèse vérifiée après lecture.' })
  })

  it('conserve un vrai blocage terminal rendu sans commande', async () => {
    const registry = {
      send: vi.fn(async () => ({
        text: '⛔ Bloqué — la lecture a réellement échoué.',
        provider: 'claude'
      })),
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
    const bus = { catalog: () => [], snapshotForPrompt }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'lis le fichier absent' }],
      (event) => events.push(event)
    )

    expect(events.at(-1)).toMatchObject({
      kind: 'done',
      text: '⛔ Bloqué — la lecture a réellement échoué.'
    })
  })

  it('rétracte un faux blocage déjà streamé avant de découvrir la commande', async () => {
    const bloque = '⛔ Bloqué — aucune lecture exploitable.'
    const commande = '<cmd>{"name":"find_in_files","args":{"pattern":"status","dir":"src"}}</cmd>'
    const responses = [
      { chunks: [bloque, commande], text: `${bloque}${commande}` },
      { chunks: ['Conclusion vérifiée.'], text: 'Conclusion vérifiée.' }
    ]
    const registry = {
      send: vi.fn(
        async (
          _provider: string,
          _messages: unknown,
          _options: unknown,
          onChunk?: (chunk: { delta: string }) => void
        ) => {
          const response = responses.shift()!
          for (const delta of response.chunks) onChunk?.({ delta })
          return { text: response.text, provider: 'claude' }
        }
      ),
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
      catalog: () => [{ name: 'find_in_files', args: {}, description: 'recherche locale' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { trouve: 3 } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'regarde le dépôt' }],
      (event) => events.push(event)
    )

    const fauxBlocage = events.find((event) => event.kind === 'delta' && event.text === bloque)
    const retrait = events.find(
      (event) => event.kind === 'stream-reset' && event.streamId === fauxBlocage?.streamId
    )
    expect(fauxBlocage).toBeDefined()
    expect(retrait).toBeDefined()
    expect(events.indexOf(retrait!)).toBeGreaterThan(events.indexOf(fauxBlocage!))
    expect(events.at(-1)).toMatchObject({ kind: 'done', text: 'Conclusion vérifiée.' })
  })

  it('retire le paragraphe bloquant après une narration et conserve le texte ordinaire autour', async () => {
    const responses = [
      'Lecture tentée.\n\n⛔ Bloqué — aucun résultat.\n\nJe poursuis.' +
        '<cmd>{"name":"find_in_files","args":{"pattern":"status","dir":"src"}}</cmd>',
      'Conclusion vérifiée.'
    ]
    const registry = {
      send: vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'claude' })),
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
      catalog: () => [{ name: 'find_in_files', args: {}, description: 'recherche locale' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { trouve: 3 } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'regarde le dépôt' }],
      (event) => events.push(event)
    )

    const texteVisible = events.map((event) => event.text ?? '').join('')
    expect(texteVisible).toContain('Lecture tentée.')
    expect(texteVisible).toContain('Je poursuis.')
    expect(texteVisible).not.toContain('⛔ Bloqué')
  })

  it('rétracte la variante Unicode streamée et réémet la narration saine', async () => {
    const prefixe = 'Lecture tentée.\n\n⛔️ Bloqué. Aucun résultat.'
    const commande = '<cmd>{"name":"find_in_files","args":{"pattern":"status","dir":"src"}}</cmd>'
    const responses = [
      { chunks: [prefixe, commande], text: `${prefixe}${commande}` },
      { chunks: [], text: 'Conclusion vérifiée.' }
    ]
    const registry = {
      send: vi.fn(
        async (
          _provider: string,
          _messages: unknown,
          _options: unknown,
          onChunk?: (chunk: { delta: string }) => void
        ) => {
          const response = responses.shift()!
          for (const delta of response.chunks) onChunk?.({ delta })
          return { text: response.text, provider: 'claude' }
        }
      ),
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
      catalog: () => [{ name: 'find_in_files', args: {}, description: 'recherche locale' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { trouve: 3 } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'regarde le dépôt' }],
      (event) => events.push(event)
    )

    const retraitIndex = events.findIndex((event) => event.kind === 'stream-reset')
    expect(retraitIndex).toBeGreaterThan(-1)
    expect(
      events
        .slice(retraitIndex + 1)
        .some((event) => event.kind === 'delta' && event.text?.includes('Lecture tentée.'))
    ).toBe(true)
    expect(
      events
        .slice(retraitIndex + 1)
        .map((event) => event.text ?? '')
        .join('')
    ).not.toContain('⛔️ Bloqué')
  })

  it('préserve une narration en prose qui explique le statut bloqué sans employer le marqueur terminal', async () => {
    const responses = [
      'Le statut « ⛔ Bloqué » signifie une conclusion terminale.' +
        '<cmd>{"name":"find_in_files","args":{"pattern":"status","dir":"src"}}</cmd>',
      'Conclusion vérifiée.'
    ]
    const registry = {
      send: vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'claude' })),
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
      catalog: () => [{ name: 'find_in_files', args: {}, description: 'recherche locale' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { trouve: 3 } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'explique puis inspecte' }],
      (event) => events.push(event)
    )

    expect(events.map((event) => event.text ?? '').join('')).toContain(
      'Le statut « ⛔ Bloqué » signifie une conclusion terminale.'
    )
  })

  it('retire tous les faux blocages, y compris Markdown, sans retirer les libellés expliqués', async () => {
    const texte = [
      'Avant.',
      '⛔ Bloqué — aucun résultat, premier.',
      'Milieu.',
      '⛔ Bloqué — aucun résultat, second.',
      '**⛔ Bloqué** — impossible de continuer, troisième.',
      '## ⛔ Bloqué — recherche échouée, quatrième.',
      '- ⛔ Bloqué — aucun résultat, liste.',
      '> ⛔ Bloqué — aucun résultat, citation.',
      '⛔ Bloqué — accès interdit.',
      '⛔ Bloqué — permissions insuffisantes.',
      'Le libellé « ⛔ Bloqué » est historique.',
      'Une ligne « ⛔ Bloqué : ce libellé est terminal » reste une citation en prose.'
    ].join('\n\n')
    const commande = '<cmd>{"name":"find_in_files","args":{"pattern":"status","dir":"src"}}</cmd>'
    const responses = [`${texte}${commande}`, 'Conclusion vérifiée.']
    const registry = {
      send: vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'claude' })),
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
      catalog: () => [{ name: 'find_in_files', args: {}, description: 'recherche locale' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { trouve: 3 } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'inspecte le dépôt' }],
      (event) => events.push(event)
    )

    const visible = events.map((event) => event.text ?? '').join('')
    expect(visible).toContain('Avant.')
    expect(visible).toContain('Milieu.')
    expect(visible).toContain('Le libellé « ⛔ Bloqué » est historique.')
    expect(visible).toContain(
      'Une ligne « ⛔ Bloqué : ce libellé est terminal » reste une citation en prose.'
    )
    expect(visible).not.toContain('premier.')
    expect(visible).not.toContain('second.')
    expect(visible).not.toContain('troisième.')
    expect(visible).not.toContain('quatrième.')
    expect(visible).not.toContain('liste.')
    expect(visible).not.toContain('citation.')
    expect(visible).not.toContain('accès interdit.')
    expect(visible).not.toContain('permissions insuffisantes.')
  })

  it.each([
    { variante: 'virgule', prefixeMarkdown: '', ponctuation: ',' },
    { variante: 'points de suspension', prefixeMarkdown: '', ponctuation: '…' },
    { variante: 'point d’exclamation', prefixeMarkdown: '', ponctuation: '!' },
    { variante: 'liste Markdown', prefixeMarkdown: '- ', ponctuation: '—' },
    { variante: 'citation Markdown', prefixeMarkdown: '> ', ponctuation: '—' }
  ])(
    'retire un blocage streamé $variante sans dupliquer la narration',
    async ({ prefixeMarkdown, ponctuation }) => {
      const narration = 'Narration saine.'
      const prefixe = `${narration}\n\n${prefixeMarkdown}⛔️ Bloqué${ponctuation} aucun résultat.`
      const commande = '<cmd>{"name":"find_in_files","args":{"pattern":"status","dir":"src"}}</cmd>'
      const responses = [
        { chunks: [prefixe, commande], text: `${prefixe}${commande}` },
        { chunks: [], text: 'Conclusion vérifiée.' }
      ]
      const registry = {
        send: vi.fn(
          async (
            _provider: string,
            _messages: unknown,
            _options: unknown,
            onChunk?: (chunk: { delta: string }) => void
          ) => {
            const response = responses.shift()!
            for (const delta of response.chunks) onChunk?.({ delta })
            return { text: response.text, provider: 'claude' }
          }
        ),
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
        catalog: () => [{ name: 'find_in_files', args: {}, description: 'recherche locale' }],
        snapshotForPrompt,
        exec: vi.fn().mockResolvedValue({ ok: true, data: { trouve: 3 } })
      }
      const events: PilotEvent[] = []

      await new AgentPilot(registry as never, roles as never, bus as never).chat(
        [{ role: 'user', content: 'regarde le dépôt' }],
        (event) => events.push(event)
      )

      const retraitIndex = events.findIndex((event) => event.kind === 'stream-reset')
      const apresRetrait = events.slice(retraitIndex + 1)
      expect(retraitIndex).toBeGreaterThan(-1)
      expect(apresRetrait.map((event) => event.text ?? '').join('')).not.toContain('⛔️ Bloqué')
      expect(
        apresRetrait.filter((event) => event.kind === 'delta' && event.text?.includes(narration))
      ).toHaveLength(1)
    }
  )

  it('emits progressive visible deltas while suppressing fragmented command markup', async () => {
    const responses = [
      {
        chunks: [
          'Je ',
          'réponds. ',
          '<cm',
          'd>{"name":"get_state","args":{"target":"chat"}}</cmd>',
          ' Après action.'
        ],
        text: 'Je réponds. <cmd>{"name":"get_state","args":{"target":"chat"}}</cmd> Après action.'
      },
      { chunks: ['Tout ', 'est bon.'], text: 'Tout est bon.' }
    ]
    const send = vi.fn(
      async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        const response = responses.shift()!
        for (const delta of response.chunks) onChunk?.({ delta })
        return { text: response.text, provider: 'codex' }
      }
    )
    const registry = {
      send,
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = {
      catalog: () => [{ name: 'get_state', args: {}, description: 'state' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { source: 'fixture' } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-1'
    )

    const deltas = events.filter((event) => event.kind === 'delta')
    expect(deltas.length).toBeGreaterThanOrEqual(4)
    expect(deltas.map((event) => event.text).join('')).toBe(
      'Je réponds.  Après action.Tout est bon.'
    )
    expect(JSON.stringify(deltas)).not.toContain('<cmd>')
    expect(JSON.stringify(deltas)).not.toContain('get_state')
    const command = events.find((event) => event.kind === 'command')
    const result = events.find((event) => event.kind === 'result')
    const commandIndex = events.indexOf(command!)
    const resultIndex = events.indexOf(result!)
    const trailingTextIndex = events.findIndex(
      (event) => event.kind === 'delta' && event.text?.includes('Après action')
    )
    expect(command?.actionId).toBeTruthy()
    expect(result?.actionId).toBe(command?.actionId)
    expect(commandIndex).toBeLessThan(resultIndex)
    expect(resultIndex).toBeLessThan(trailingTextIndex)
  })

  it('produces durable text-action-text parts through the real pilot event path', async () => {
    const responses = [
      {
        chunks: ['Avant.', '<cmd>{"name":"get_state","args":{"token":"secret"}}</cmd>', ' Après.'],
        text: 'Avant.<cmd>{"name":"get_state","args":{"token":"secret"}}</cmd> Après.'
      },
      { chunks: [], text: '' }
    ]
    const registry = {
      send: async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        const response = responses.shift()!
        for (const delta of response.chunks) onChunk?.({ delta })
        return { text: response.text, provider: 'codex' }
      },
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = {
      catalog: () => [{ name: 'get_state', args: {}, description: 'state' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { source: 'fixture' } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event)
    )

    let turn = createChatTurn('turn-1')
    for (const event of events) {
      let durable: ChatTurnEvent | undefined
      if (event.kind === 'delta' && event.streamId)
        durable = { kind: 'delta', streamId: event.streamId, text: event.text ?? '' }
      else if (event.kind === 'stream-reset' && event.streamId)
        durable = { kind: 'stream-reset', streamId: event.streamId }
      else if (event.kind === 'command' && event.actionId && event.name)
        durable = {
          kind: 'command',
          actionId: event.actionId,
          name: event.name,
          args: event.args
        }
      else if (event.kind === 'result' && event.actionId && event.name)
        durable = {
          kind: 'result',
          actionId: event.actionId,
          name: event.name,
          ok: event.ok,
          data: event.data
        }
      else if (event.kind === 'done') durable = { kind: 'done' }
      if (durable) turn = reduceChatTurn(turn, durable)
    }

    expect(turn.status).toBe('completed')
    expect(turn.parts.map((part) => part.kind)).toEqual(['text', 'action', 'text'])
    expect(turn.parts[0]).toMatchObject({ kind: 'text', text: 'Avant.' })
    expect(turn.parts[1]).toMatchObject({
      kind: 'action',
      name: 'get_state',
      args: { token: '[masqué]' },
      ok: true,
      data: { source: 'fixture' }
    })
    expect(turn.parts[2]).toMatchObject({ kind: 'text', text: ' Après.' })
  })

  it('resets partial text from a failed provider attempt before retrying', async () => {
    let attempt = 0
    const registry = {
      send: async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        attempt += 1
        onChunk?.({ delta: attempt === 1 ? 'Texte perdu' : 'Texte valide' })
        if (attempt === 1) throw new Error('transport')
        return { text: 'Texte valide', provider: 'codex' }
      },
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshotForPrompt }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event)
    )

    expect(events.map((event) => event.kind)).toContain('stream-reset')
    const failedStream = events.find((event) => event.kind === 'stream-reset')?.streamId
    expect(events.some((event) => event.kind === 'delta' && event.streamId === failedStream)).toBe(
      true
    )
    expect(events.filter((event) => event.kind === 'delta').at(-1)?.text).toBe('Texte valide')
  })

  it('keeps the last partial stream when the final provider attempt fails', async () => {
    let attempt = 0
    const registry = {
      send: async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        attempt += 1
        onChunk?.({ delta: attempt === 1 ? 'Premier partiel' : 'Dernier partiel' })
        throw new Error(`échec ${attempt}`)
      },
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshotForPrompt }
    const events: PilotEvent[] = []

    await expect(
      new AgentPilot(registry as never, roles as never, bus as never).chat(
        [{ role: 'user', content: 'test' }],
        (event) => events.push(event)
      )
    ).rejects.toThrow('échec 2')

    expect(events.filter((event) => event.kind === 'stream-reset')).toHaveLength(1)
    const finalDelta = events.filter((event) => event.kind === 'delta').at(-1)
    expect(finalDelta?.text).toBe('Dernier partiel')
    expect(
      events.some(
        (event) => event.kind === 'stream-reset' && event.streamId === finalDelta?.streamId
      )
    ).toBe(false)
  })

  it.each([
    '<cm',
    '<cmd>{"name":"get_state"',
    '<question>{"question":"privé"',
    '<question>sk-test-123',
    '<QUESTION>sk-test-123'
  ])('never falls back to raw incomplete control markup: %s', async (response) => {
    const registry = {
      send: async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        onChunk?.({ delta: response })
        return { text: response, provider: 'codex' }
      },
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshotForPrompt }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event)
    )

    expect(events.filter((event) => ['delta', 'think'].includes(event.kind))).toEqual([])
    expect(JSON.stringify(events)).not.toContain('sk-test-123')
  })
})
