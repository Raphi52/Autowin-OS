import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { AuthoritySas } from './authority/sas'
import { APP_DESTINATIONS } from '../shared/navigation'

function fakeOs(): any {
  const conversations = new Map<
    string,
    { id: string; title: string; category: string; provider: string }
  >()
  const calls = { setRole: 0, attachRun: 0, runTask: 0 }
  conversations.set('conv-1', {
    id: 'conv-1',
    title: 'A garder',
    category: 'claude',
    provider: 'claude'
  })
  return {
    conversations: {
      get: (id: string) => conversations.get(id),
      remove: (id: string) => conversations.delete(id),
      list: () => [...conversations.values()],
      attachRun: () => {
        calls.attachRun += 1
        return { id: 'conv-1', runPaths: [] }
      }
    },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}) },
    authority: new AuthoritySas(),
    runsWithGate: () => [],
    budget: () => ({ spent: 0 }),
    setRole: () => {
      calls.setRole += 1
      return {}
    },
    listBrains: () => [],
    loadBrainGraph: () => ({ nodes: [], links: [] }),
    runTask: async () => {
      calls.runTask += 1
      return { gateBlocked: false, valid: true, costUsd: 0, result: '' }
    },
    chat: async () => ({ text: '', provider: 'claude', systemInjected: false }),
    calls
  }
}

describe('AppCommandBus orchestration cancel (#2)', () => {
  it('register → abort coupe le signal ; clear le retire (le chemin direct devient stoppable)', () => {
    const bus = new AppCommandBus(fakeOs(), () => {})
    // Avant : aucune orchestration → abort est un no-op honnête.
    expect(bus.abortOrchestration('conv-1')).toBe(false)
    // register arme un AbortController dans le MÊME registre que le chemin interne.
    const controller = bus.registerOrchestration('conv-1')
    expect(controller.signal.aborted).toBe(false)
    // abort le coupe réellement.
    expect(bus.abortOrchestration('conv-1')).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    // clear le retire → un nouvel abort ne trouve plus rien.
    bus.clearOrchestration('conv-1')
    expect(bus.abortOrchestration('conv-1')).toBe(false)
  })

  it('register coupe une orchestration précédente pendante sur la même conversation', () => {
    const bus = new AppCommandBus(fakeOs(), () => {})
    const first = bus.registerOrchestration('conv-1')
    const second = bus.registerOrchestration('conv-1')
    expect(first.signal.aborted).toBe(true) // l'ancienne est coupée
    expect(second.signal.aborted).toBe(false)
  })

  it('abortAllOrchestrations coupe et vide tout le registre (filet de crash, Faithful minor)', () => {
    const bus = new AppCommandBus(fakeOs(), () => {})
    const a = bus.registerOrchestration('conv-1')
    const b = bus.registerOrchestration('conv-2')
    bus.abortAllOrchestrations()
    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(true)
    // Registre vidé → plus rien à couper.
    expect(bus.abortOrchestration('conv-1')).toBe(false)
    expect(bus.abortOrchestration('conv-2')).toBe(false)
  })

  it('clearOrchestration par IDENTITÉ : le finally d’un run écrasé n’efface pas le run courant (Corrector #2)', () => {
    const bus = new AppCommandBus(fakeOs(), () => {})
    const a = bus.registerOrchestration('conv-1') // run A
    const b = bus.registerOrchestration('conv-1') // run B écrase A (A.abort())
    // Le finally de A arrive APRÈS et ne doit PAS supprimer l'entrée de B.
    bus.clearOrchestration('conv-1', a)
    // Le cancel doit toujours couper B (entrée préservée).
    expect(bus.abortOrchestration('conv-1')).toBe(true)
    expect(b.signal.aborted).toBe(true)
  })
})

describe('AppCommandBus authority policy', () => {
  it('launches ordinary orchestration immediately even when the conversation is in Ask mode', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})

    const result = await bus.exec(
      'orchestrate',
      { task: 'corrige le clic extérieur puis teste' },
      'conv-1',
      'ask'
    )

    expect(result).toMatchObject({ ok: true })
    expect(os.calls.runTask).toBe(1)
    expect(os.authority.pending()).toHaveLength(0)
  })

  it('reuses the pending decision for an identical destructive action', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})

    const first = await bus.exec('remove_conversation', { id: 'conv-1' })
    const second = await bus.exec('remove_conversation', { id: 'conv-1' })

    expect((second.data as { decisionId: string }).decisionId).toBe(
      (first.data as { decisionId: string }).decisionId
    )
    expect(os.authority.pending()).toHaveLength(1)
  })

  it('does not merge destructive decisions whose targets differ', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})

    const first = await bus.exec('remove_conversation', { id: 'conv-1' })
    const second = await bus.exec('remove_conversation', { id: 'conv-2' })

    expect((second.data as { decisionId: string }).decisionId).not.toBe(
      (first.data as { decisionId: string }).decisionId
    )
    expect(os.authority.pending()).toHaveLength(2)
  })

  it('publie les destinations canoniques et autorise la navigation en mode Plan', async () => {
    const events: Array<{ type: string; tab?: string }> = []
    const bus = new AppCommandBus(fakeOs(), (event) => events.push(event))
    const navigate = bus.catalog().find((tool) => tool.name === 'navigate')

    expect(navigate?.args.tab).toBe(APP_DESTINATIONS.map(({ id }) => id).join('|'))
    expect(navigate?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })

    const result = await bus.exec('navigate', { tab: 'router' }, undefined, 'plan')
    expect(result).toMatchObject({
      ok: true,
      data: { tab: 'agent-studio', section: 'routing' }
    })
    expect(events).toContainEqual({ type: 'navigate', tab: 'router' })
    await expect(bus.snapshot()).resolves.toMatchObject({ tab: 'agent-studio' })
  })

  it('snapshotForPrompt : projection minimale — pas de conversations inline, runs bloqués seulement', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})
    const prompt = await bus.snapshotForPrompt()
    // Le poids (liste des conversations) n'est PAS injecté : seul le count.
    expect(prompt).not.toHaveProperty('conversations')
    expect(typeof prompt.conversationsCount).toBe('number')
    // Runs : uniquement les bloqués, et sans le champ `blocked` (redondant après filtre).
    expect(prompt.runsBlocked.every((r) => 'subject' in r && !('blocked' in r))).toBe(true)
    // Champs utiles conservés.
    expect(prompt).toMatchObject({ tab: expect.any(String), providers: expect.any(Array) })
  })

  it('enforces conversation Plan and Auto modes before any mutation', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})

    const planned = await bus.exec('remove_conversation', { id: 'conv-1' }, 'conv-1', 'plan')
    expect(planned).toMatchObject({ ok: false })
    expect(os.conversations.get('conv-1')).toBeTruthy()
    expect(os.authority.pending()).toHaveLength(0)

    const automatic = await bus.exec('remove_conversation', { id: 'conv-1' }, 'conv-1', 'auto')
    expect(automatic).toMatchObject({ ok: true, data: { pendingApproval: true } })
    expect(os.conversations.get('conv-1')).toBeTruthy()
  })

  it('defers deletion until human approval and consumes it once', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})
    const requested = await bus.exec('remove_conversation', { id: 'conv-1' })
    const decisionId = (requested.data as { decisionId: string }).decisionId

    expect(requested.ok).toBe(true)
    expect(os.conversations.get('conv-1')).toBeTruthy()
    await bus.resolveDecision(decisionId, 'approve')
    expect(os.conversations.get('conv-1')).toBeUndefined()
    await expect(bus.resolveDecision(decisionId, 'approve')).rejects.toThrow()
  })

  it('does not expose decision resolution to the model and annotates risk', () => {
    const catalogue = new AppCommandBus(fakeOs(), () => {}).catalog()
    expect(catalogue.some((tool) => tool.name === 'resolve_decision')).toBe(false)
    expect(
      catalogue.find((tool) => tool.name === 'remove_conversation')?.annotations
    ).toMatchObject({
      destructiveHint: true,
      readOnlyHint: false
    })
    expect(catalogue.every((tool) => tool.annotations !== undefined)).toBe(true)
    expect(catalogue.find((tool) => tool.name === 'get_state')?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false
    })
    expect(catalogue.find((tool) => tool.name === 'orchestrate')?.description).toMatch(
      /lire, modifier et tester le code/i
    )
  })

  it('runs reversible actions immediately and reserves approval for deletion', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})
    bus.activeConversationId = 'conv-1'
    await bus.exec('set_role', { role: 'judge', provider: 'codex', model: 'gpt-5' })
    await bus.exec('attach_run', { path: 'C:/private/RUN.md' })
    await bus.exec('orchestrate', { task: 'use token=top-secret' })
    const deletion = await bus.exec('remove_conversation', { id: 'conv-1' })

    expect(os.calls).toMatchObject({ setRole: 1, attachRun: 1, runTask: 1 })
    expect(os.authority.pending()).toHaveLength(1)
    expect(deletion).toMatchObject({ ok: true, data: { pendingApproval: true } })
    expect(os.conversations.get('conv-1')).toBeTruthy()
  })

  it('traces choice and redacted result, then cancels expiry without mutation', async () => {
    let now = 0
    const os = fakeOs()
    os.authority = new AuthoritySas(() => now)
    const entries: Array<{ name: string; args: Record<string, unknown>; ok: boolean }> = []
    const bus = new AppCommandBus(os, () => {})
    bus.trace = (name, args, ok) => entries.push({ name, args, ok })
    await bus.exec('orchestrate', { task: 'Bearer top-secret' })
    expect(entries).toContainEqual(
      expect.objectContaining({ name: 'orchestrate', args: { task: '[redacted]' }, ok: true })
    )
    const expired = await bus.exec('remove_conversation', { id: 'conv-1' })
    now = 15 * 60_000
    expect(bus.sweepExpired()).toHaveLength(1)
    expect(entries).toContainEqual(expect.objectContaining({ name: 'authority_decision' }))
    await expect(bus.resolveDecision((expired.data as any).decisionId, 'approve')).rejects.toThrow()
    expect(os.conversations.get('conv-1')).toBeTruthy()
  })
})
