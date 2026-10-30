import { describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { runBrainGraph, runBrainRead, tracerLectureBrain } from './brain-graph-command'
import type { BrainTrace } from './activity/brain-trace-spool'
import { decideRemember, parseSupersedes } from './brain-remember'

const signed = (context: string, token = 'jeton'): Record<string, unknown> => {
  const authenticated = JSON.stringify({ context })
  return {
    service: 'autowin-brain',
    protocol: 2,
    authenticated,
    signature: createHmac('sha256', token)
      .update(`autowin-brain\n2\n${authenticated}`, 'utf8')
      .digest('hex')
  }
}

const reply = (body: unknown, status = 200): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

const deps = (fetchFn: typeof fetch) => ({ token: 'jeton', origin: 'http://127.0.0.1:1', fetchFn })

describe('brain_graph', () => {
  it('envoie entité, sens, profondeur bornée et corpus, et rend le résultat vérifié', async () => {
    const graph = JSON.stringify({ entity: 'svc', found: true, results: [{ entity: 'ctl' }] })
    const fetchFn = reply(signed(graph))
    const out = await runBrainGraph(
      { entity: 'OrderService', direction: 'dependencies', depth: 9 },
      { ...deps(fetchFn), corpus: ['knowledge/domain/'] }
    )
    expect(out).toMatchObject({ found: true, status: 'found', knowledge: graph })
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('http://127.0.0.1:1/graph')
    expect(JSON.parse(init.body)).toEqual({
      entity: 'OrderService',
      direction: 'dependencies',
      depth: 3,
      corpus: ['knowledge/domain/']
    })
  })

  it('distingue une entité inconnue et refuse une signature fausse', async () => {
    const unknown = await runBrainGraph(
      { entity: 'x' },
      deps(reply(signed(JSON.stringify({ found: false, results: [] }))))
    )
    expect(unknown).toMatchObject({ found: false, status: 'empty' })
    const forged = await runBrainGraph({ entity: 'x' }, deps(reply(signed('{}', 'autre'))))
    expect(forged.status).toBe('invalid')
    expect((await runBrainGraph({}, deps(reply({})))).status).toBe('not-requested')
  })
})

describe('brain_read', () => {
  it('rend la note et nomme un refus du serveur', async () => {
    const ok = await runBrainRead({ path: 'knowledge/domain/a.md' }, deps(reply(signed('# A'))))
    expect(ok).toMatchObject({ found: true, knowledge: '# A' })
    const refused = await runBrainRead(
      { path: 'secret.md' },
      deps(reply({ error: 'path must name a note under knowledge/' }, 400))
    )
    expect(refused).toMatchObject({ found: false, status: 'unavailable' })
    expect(refused.note).toContain('knowledge/')
  })

  it('demande la note ENTIÈRE et la rend sans coupe, même très longue', async () => {
    const note = `# Longue\n${'x'.repeat(50_000)}FIN-DE-NOTE`
    const fetchFn = reply(signed(note))
    const out = await runBrainRead({ path: 'knowledge/domain/longue.md' }, deps(fetchFn))
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ path: 'knowledge/domain/longue.md', entier: true })
    expect(out.knowledge).toBe(note)
  })
})

describe('remember supersedes', () => {
  it('garde les uids bien formés et écarte le reste', () => {
    expect(parseSupersedes('autowin-os/old-rule, ../x')).toEqual(['autowin-os/old-rule'])
    const decision = decideRemember({
      title: 'Le port Brain par défaut est 8765',
      fact: 'Le serveur Brain écoute par défaut sur le port 8765 en loopback.',
      type: 'decision',
      scope: 'autowin-os',
      source: 'git:brain/tooling/brain_server.py@9218eaf',
      supersedes: ['autowin-os/old-rule']
    })
    expect(decision.allowed && decision.supersedes).toEqual(['autowin-os/old-rule'])
  })
})
describe('trace des lectures Brain (conv-1303)', () => {
  it('trace brain_read avec le chemin ouvert, la taille injectée et le tour', () => {
    const traces: BrainTrace[] = []
    tracerLectureBrain(
      'brain_read',
      { path: 'perso:knowledge\\lessons\\x.md' },
      { found: true, status: 'found', knowledge: 'contenu de note' },
      { conversationId: 'conv-1', turnId: 't-1', durationMs: 42 },
      (t) => traces.push(t)
    )
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      conversationId: 'conv-1',
      turnId: 't-1',
      kind: 'lecture',
      point: 'command-brain-read',
      query: 'brain_read: perso:knowledge/lessons/x.md',
      found: true,
      status: 'found',
      durationMs: 42,
      injectedChars: 15,
      notes: ['perso:knowledge/lessons/x.md']
    })
  })

  it('trace brain_graph sans chemin de note, et rien sans conversation', () => {
    const traces: BrainTrace[] = []
    const vide = { found: false, status: 'not-requested' as const, knowledge: '' }
    tracerLectureBrain('brain_graph', { entity: 'svc' }, vide, { conversationId: 'c' }, (t) =>
      traces.push(t)
    )
    tracerLectureBrain('brain_read', { path: 'k.md' }, vide, {}, (t) => traces.push(t))
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      query: 'brain_graph: svc',
      status: 'empty',
      injectedChars: 0
    })
    expect(traces[0].notes).toBeUndefined()
  })
})
// fix-ok: l'echantillon de test etait refuse par la politique existante ; reutilise le fait d'exemple des autres tests
