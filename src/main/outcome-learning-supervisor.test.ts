import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OutcomeLearningLedger } from './activity/outcome-learning-ledger'
import { OutcomeLearningSupervisor, parseOutcomeLearningMode } from './outcome-learning-supervisor'
import {
  createIndependentLearningAttestation,
  learningProposalAttestation
} from './outcome-learning-proposal'

function harness(mode: 'off' | 'shadow' | 'inbox' | 'auto' = 'auto') {
  const ledger = new OutcomeLearningLedger(
    join(mkdtempSync(join(tmpdir(), 'autowin-learning-supervisor-')), 'events.jsonl')
  )
  const promote = vi.fn((candidateId: string) => ({
    to: candidateId.replace(/^inbox\//, 'knowledge/')
  }))
  const invalidate = vi.fn(async () => undefined)
  const supervisor = new OutcomeLearningSupervisor({
    ledger,
    mode,
    promote,
    invalidate,
    now: () => '2026-08-11T10:00:00.000Z'
  })
  return { ledger, promote, invalidate, supervisor }
}

function propose(
  supervisor: OutcomeLearningSupervisor,
  patch: Record<string, unknown> = {}
): boolean {
  return supervisor.recordProposal({
    conversationId: 'conv-1',
    turnId: 'turn-1',
    runId: 'run-1',
    outcome: 'success',
    title: 'Leçon prouvée',
    body: 'Le même test est passé après la mutation.',
    type: 'lesson',
    scope: 'autowin-os',
    source: 'session:turn-1',
    tags: [],
    confidence: 'high',
    candidateId: 'inbox/lesson.md',
    stored: true,
    truncated: false,
    ...patch
  } as never)
}

const strongOutcome = {
  conversationId: 'conv-1',
  turnId: 'turn-1',
  runId: 'run-1',
  workspace: 'C:/repo',
  status: 'succeeded' as const,
  valid: true,
  gateBlocked: false,
  reused: false,
  attestedProposalHashes: [
    learningProposalAttestation({
      outcome: 'success',
      title: 'Leçon prouvée',
      body: 'Le même test est passé après la mutation.',
      type: 'lesson',
      scope: 'autowin-os',
      tags: [],
      confidence: 'high'
    })
  ],
  independentProposalAttestations: [
    createIndependentLearningAttestation(
      learningProposalAttestation({
        outcome: 'success',
        title: 'Leçon prouvée',
        body: 'Le même test est passé après la mutation.',
        type: 'lesson',
        scope: 'autowin-os',
        tags: [],
        confidence: 'high'
      }),
      'run-1',
      'judge:test'
    )
  ],
  evidence: [
    {
      type: 'command_execution',
      kind: 'verification' as const,
      status: 'failed',
      ok: false,
      oracleStable: true,
      oracleAttestation: 'manifest:test',
      paths: ['src/main/x.ts'],
      command: 'npm test -- focused',
      exitCode: 1,
      summary: 'red secret=must-not-be-stored'
    },
    {
      type: 'file_change',
      kind: 'mutation' as const,
      status: 'completed',
      ok: true,
      oracleStable: true,
      oracleAttestation: 'manifest:test',
      paths: ['src/main/x.ts'],
      path: 'src/main/x.ts',
      pathFingerprints: { 'src/main/x.ts': 'abc' },
      summary: 'changed'
    },
    {
      type: 'command_execution',
      kind: 'verification' as const,
      status: 'completed',
      ok: true,
      oracleStable: true,
      oracleAttestation: 'manifest:test',
      paths: ['src/main/x.ts'],
      command: 'npm   test -- focused',
      exitCode: 0,
      stdout: 'token=must-not-be-stored',
      summary: 'green'
    },
    {
      type: 'command_execution',
      kind: 'verification' as const,
      status: 'completed',
      ok: true,
      oracleStable: true,
      oracleAttestation: 'manifest:test',
      paths: ['src/main/x.ts'],
      command: 'npm test -- focused',
      exitCode: 0,
      summary: 'green repeated'
    }
  ]
}

describe('OutcomeLearningSupervisor', () => {
  it('active auto par défaut et garde un kill switch fermé', () => {
    expect(parseOutcomeLearningMode(undefined)).toBe('auto')
    expect(parseOutcomeLearningMode(' OFF ')).toBe('off')
    expect(parseOutcomeLearningMode('arbitrary')).toBe('auto')
    const { supervisor } = harness()
    expect(supervisor.setMode('off')).toBe('off')
    expect(supervisor.getMode()).toBe('off')
    expect(propose(supervisor)).toBe(false)
  })

  it('promeut exactement une fois une leçon locale fortement prouvée', async () => {
    const { supervisor, promote, invalidate, ledger } = harness()
    expect(propose(supervisor)).toBe(true)
    await expect(supervisor.observeOutcome(strongOutcome)).resolves.toMatchObject({
      state: 'published',
      knowledgeId: 'knowledge/lesson.md'
    })
    expect(promote).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledTimes(1)
    await supervisor.observeOutcome(strongOutcome)
    expect(promote).toHaveBeenCalledTimes(1)
    expect(ledger.read().events.filter(({ kind }) => kind === 'decision')).toHaveLength(1)
  })

  it('corrèle aussi une leçon déposée après la fin du run', async () => {
    const { supervisor, promote } = harness()
    await expect(supervisor.observeOutcome(strongOutcome)).resolves.toMatchObject({ state: 'none' })
    expect(propose(supervisor)).toBe(true)
    await expect(supervisor.reconcile('conv-1', 'turn-1')).resolves.toMatchObject({
      state: 'published',
      knowledgeId: 'knowledge/lesson.md'
    })
    expect(promote).toHaveBeenCalledTimes(1)
  })

  it('laisse une preuve ambiguë en inbox sans promotion', async () => {
    const { supervisor, promote } = harness()
    propose(supervisor)
    const result = await supervisor.observeOutcome({
      ...strongOutcome,
      evidence: strongOutcome.evidence.slice(1)
    })
    expect(result.state).toBe('inbox')
    expect(promote).not.toHaveBeenCalled()
  })

  it('respecte shadow, inbox-only et off', async () => {
    for (const [mode, state] of [
      ['shadow', 'shadow'],
      ['inbox', 'inbox'],
      ['off', 'off']
    ] as const) {
      const { supervisor, promote } = harness(mode)
      propose(supervisor)
      expect((await supervisor.observeOutcome(strongOutcome)).state).toBe(state)
      expect(promote).not.toHaveBeenCalled()
    }
  })

  it('ne persiste jamais stdout, commandes ou résumés bruts', async () => {
    const { supervisor, ledger } = harness('shadow')
    propose(supervisor)
    await supervisor.observeOutcome(strongOutcome)
    const raw = JSON.stringify(ledger.read().events)
    expect(raw).not.toContain('must-not-be-stored')
    expect(raw).not.toContain('npm test')
    expect(raw).not.toContain('src/main/x.ts')
    const proposalEvent = ledger.read().events.find(({ kind }) => kind === 'proposal')
    const outcomeEvent = ledger.read().events.find(({ kind }) => kind === 'outcome')
    expect(proposalEvent?.kind === 'proposal' ? proposalEvent.value : undefined).toMatchObject({
      authorAgent: 'autowin-os',
      authorModel: 'autowin',
      authorRole: 'orchestrator'
    })
    expect(outcomeEvent?.kind === 'outcome' ? outcomeEvent.value : undefined).toMatchObject({
      observer: 'autowin-os',
      codeFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
  })

  it('borne une proposition à une seule leçon par tour', () => {
    const { supervisor } = harness()
    expect(propose(supervisor)).toBe(true)
    expect(supervisor.hasProposal('conv-1', 'turn-1')).toBe(true)
    expect(propose(supervisor, { title: 'Deuxième' })).toBe(false)
  })

  it('journalise retrait et restauration comme événements compensatoires idempotents', () => {
    const { supervisor } = harness()
    expect(supervisor.recordCuration('retract', 'knowledge/a', '.trash/a')).toBe(true)
    expect(supervisor.recordCuration('retract', 'knowledge/a', '.trash/a')).toBe(false)
    expect(supervisor.recordCuration('restore', 'knowledge/a', '.trash/a')).toBe(true)
    expect(supervisor.recordCuration('supersede', 'knowledge/a', 'knowledge/b', '.trash/a')).toBe(
      true
    )
    expect(supervisor.audit().filter(({ kind }) => kind === 'curation')).toHaveLength(3)
  })

  it('retrouve une curation par identité au-delà de 200 événements et la pagine', () => {
    const { supervisor } = harness()
    supervisor.recordCuration(
      'supersede',
      'knowledge/original',
      'knowledge/replacement',
      '.trash/original'
    )
    const original = supervisor.curationPage(0, 1).events[0]
    for (let index = 0; index < 205; index += 1) {
      supervisor.recordCuration('retract', `knowledge/noise-${index}`, `.trash/noise-${index}`)
    }

    expect(supervisor.audit(200)).not.toContainEqual(original)
    expect(supervisor.eventById(original.value.eventId)).toEqual(original)
    expect(supervisor.curationPage(200, 20)).toMatchObject({ total: 206 })
    expect(supervisor.curationPage(200, 20).events).toContainEqual(original)
  })

  it('dégrade en inbox si la promotion échoue sans retenter', async () => {
    const { ledger } = harness()
    const promote = vi.fn(() => {
      throw new Error('disk full')
    })
    const supervisor = new OutcomeLearningSupervisor({ ledger, mode: 'auto', promote })
    propose(supervisor)
    await expect(supervisor.observeOutcome(strongOutcome)).resolves.toMatchObject({
      state: 'inbox'
    })
    expect(promote).toHaveBeenCalledTimes(1)
  })

  it('ne scelle la décision publish qu’après invalidation et rejoue une panne', async () => {
    const { ledger, promote } = harness()
    const invalidate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('worker down'))
      .mockResolvedValue(undefined)
    const supervisor = new OutcomeLearningSupervisor({ ledger, mode: 'auto', promote, invalidate })
    propose(supervisor)
    await expect(supervisor.observeOutcome(strongOutcome)).resolves.toMatchObject({
      state: 'unknown'
    })
    expect(ledger.read().events.filter(({ kind }) => kind === 'decision')).toHaveLength(0)
    await expect(supervisor.reconcilePending()).resolves.toBeUndefined()
    expect(ledger.read().events.filter(({ kind }) => kind === 'decision')).toHaveLength(1)
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})

/**
 * LE DÉMARRAGE RELISAIT LE JOURNAL ENTIER UNE FOIS PAR TOUR — heal conv-1115, 2026-10-23.
 *
 * Mesuré dans `gels.jsonl` : chaque démarrage tient la fenêtre ~3 s (16 démarrages sur 16), dont
 * 1,1 s dans ~209 `readFileSync` remontés par la carte du bundle à `outcome-learning-ledger.ts:156`
 * < `outcome-learning-supervisor.ts:382`. `reconcilePending` lisait le journal, puis appelait
 * `reconcile` pour CHAQUE tour porteur d'une proposition — et chaque appel relisait et réanalysait
 * tout le journal (6 Mo, 826 lignes sur ce poste), y compris pour les 118 tours sur 158 dont la
 * décision était déjà scellée et pour lesquels `reconcile` rend sans rien écrire.
 */
describe('reconcilePending au démarrage', () => {
  function tourDecide(
    supervisor: OutcomeLearningSupervisor,
    turnId: string
  ): Promise<{ state: string }> {
    propose(supervisor, { turnId, source: `session:${turnId}`, candidateId: `inbox/${turnId}.md` })
    return supervisor.observeOutcome({ ...strongOutcome, turnId })
  }

  it('tours déjà décidés : le journal est lu UNE fois, aucun n’est rejoué', async () => {
    const { supervisor, ledger, promote } = harness()
    for (const turnId of ['turn-a', 'turn-b', 'turn-c', 'turn-d']) {
      await expect(tourDecide(supervisor, turnId)).resolves.toMatchObject({ state: 'published' })
    }
    expect(promote).toHaveBeenCalledTimes(4)
    const lectures = vi.spyOn(ledger, 'read')

    await supervisor.reconcilePending()

    expect(lectures).toHaveBeenCalledTimes(1)
    expect(promote).toHaveBeenCalledTimes(4)
  })

  it('un tour resté sans décision est encore rejoué, et lui seul', async () => {
    const { ledger, promote } = harness()
    const invalidate = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('worker down'))
      .mockResolvedValue(undefined)
    const supervisor = new OutcomeLearningSupervisor({ ledger, mode: 'auto', promote, invalidate })
    await expect(tourDecide(supervisor, 'turn-a')).resolves.toMatchObject({ state: 'published' })
    await expect(tourDecide(supervisor, 'turn-b')).resolves.toMatchObject({ state: 'published' })
    await expect(tourDecide(supervisor, 'turn-c')).resolves.toMatchObject({ state: 'unknown' })
    const decisions = (): number =>
      ledger.read().events.filter(({ kind }) => kind === 'decision').length
    expect(decisions()).toBe(2)
    const lectures = vi.spyOn(ledger, 'read')

    await supervisor.reconcilePending()

    // L'inventaire, puis le rejeu du SEUL tour en attente : sa lecture par `reconcile` et celle de
    // `append`, qui relit pour écarter un doublon avant de sceller la décision. Avant le correctif :
    // 5 (les deux tours décidés étaient relus aussi).
    expect(lectures).toHaveBeenCalledTimes(3)
    lectures.mockRestore()
    expect(decisions()).toBe(3)
    expect(invalidate).toHaveBeenCalledTimes(4)
  })

  /**
   * Second temps du même heal (conv-1115) : sur le journal réel, les 40 tours encore sans décision
   * ont TOUS une proposition sans aucune issue observée (40/40). Pour eux `reconcile` relisait les
   * 6 Mo, ne trouvait aucune décision à prendre et rendait « aucune décision » sans rien écrire —
   * ~1 s perdue à chaque démarrage, pour rien.
   */
  it('tours sans issue observée : aucune relecture, aucune écriture', async () => {
    const { supervisor, ledger, promote } = harness()
    await expect(tourDecide(supervisor, 'turn-a')).resolves.toMatchObject({ state: 'published' })
    for (const turnId of ['turn-b', 'turn-c', 'turn-d']) {
      propose(supervisor, {
        turnId,
        source: `session:${turnId}`,
        candidateId: `inbox/${turnId}.md`
      })
    }
    // Issue d'un AUTRE run que celui de la proposition : elle ne la concerne pas non plus.
    propose(supervisor, { turnId: 'turn-e', source: 'session:turn-e', candidateId: 'inbox/e.md' })
    ledger.append({
      kind: 'outcome',
      value: {
        ...ledger.read().events.find(({ kind }) => kind === 'outcome')!.value,
        eventId: 'outcome:autre-run',
        turnId: 'turn-e',
        runId: 'run-autre'
      } as never
    })
    const avant = ledger.read().events.length
    const lectures = vi.spyOn(ledger, 'read')

    await supervisor.reconcilePending()

    // Avant le correctif : 5 (l'inventaire, puis une relecture par tour sans issue).
    expect(lectures).toHaveBeenCalledTimes(1)
    lectures.mockRestore()
    expect(ledger.read().events).toHaveLength(avant)
    expect(promote).toHaveBeenCalledTimes(1)
  })

  it('un tour dont l’issue arrive après coup est rejoué au démarrage suivant', async () => {
    const { supervisor, ledger, promote } = harness()
    propose(supervisor, { turnId: 'turn-a', source: 'session:turn-a', candidateId: 'inbox/a.md' })
    await supervisor.reconcilePending()
    expect(promote).not.toHaveBeenCalled()

    // L'issue est journalisée sans passer par `observeOutcome` (crash juste après l'écriture).
    const sonde = harness()
    propose(sonde.supervisor, {
      turnId: 'turn-a',
      source: 'session:turn-a',
      candidateId: 'inbox/a.md'
    })
    await sonde.supervisor.observeOutcome({ ...strongOutcome, turnId: 'turn-a' })
    const issue = sonde.ledger.read().events.find(({ kind }) => kind === 'outcome')!
    ledger.append(issue)

    await supervisor.reconcilePending()

    expect(promote).toHaveBeenCalledTimes(1)
    expect(ledger.read().events.filter(({ kind }) => kind === 'decision')).toHaveLength(1)
  })
})
