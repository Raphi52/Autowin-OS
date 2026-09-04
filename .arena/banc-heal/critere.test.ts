/*
  CRITERE DETERMINISTE du banc /arena /heal — NE PAS MODIFIER (recopie depuis une source neuve
  a chaque verification). Defaut vise : persistOrchestrationStep re-BALAYE la liste complete des
  evenements du fil PLUSIEURS fois par appel (filtre du tour, filtre du run, filtre du groupe,
  puis copies inversees par dependance). Cout par appel = O(4 x evenements) alors qu'un seul
  parcours suffit ; sur un tour long la liste grandit a chaque pas.
  Le compteur ci-dessous compte les LECTURES de champ sur les evenements : aucune horloge,
  aucun bruit machine.
*/
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { persistOrchestrationStep } from './orchestration-observability'

let acces = 0

function evenement(i: number, tour: string, exec: Record<string, unknown> | undefined): unknown {
  const socle = {
    schema: 'autowin.trace/v1',
    id: `e${i}`,
    parentId: `p${i}`,
    conversationId: 'conv-arena',
    timestamp: new Date(1_700_000_000_000 + i).toISOString(),
    sequence: i,
    type: 'handoff',
    status: 'completed',
    actor: { id: 'a', kind: 'agent', label: 'a' },
    channel: 'internal',
    payloads: [{ kind: 'app-state', content: 'x' }]
  }
  return Object.defineProperties(socle, {
    turnId: {
      enumerable: true,
      get() {
        acces++
        return tour
      }
    },
    execution: {
      enumerable: true,
      get() {
        acces++
        return exec
      }
    },
    run: {
      enumerable: true,
      get() {
        acces++
        return undefined
      }
    }
  })
}

function banc(evenements: unknown[]): {
  poser: (step: Record<string, unknown>) => Record<string, unknown> | undefined
} {
  const promptRoot = mkdtempSync(join(tmpdir(), 'arena-heal-'))
  const ajoutes: Record<string, unknown>[] = []
  let seq = 10_000
  const faux = {
    readConversation: () => evenements,
    nextSequence: () => seq++,
    append: (e: Record<string, unknown>) => ajoutes.push(e)
  }
  return {
    poser: (step) => {
      acces = 0
      persistOrchestrationStep(
        step as never,
        { conversationId: 'conv-arena', turnId: 'turn-1', iteration: 1, runId: 'run-1' },
        promptRoot,
        faux as never
      )
      return ajoutes.at(-1)
    }
  }
}

const pas = (exec: Record<string, unknown>): Record<string, unknown> => ({
  step: 'exec',
  role: 'build',
  status: 'completed',
  provider: 'claude',
  model: 'sonnet',
  execution: exec,
  prompt: 'p',
  response: 'r'
})

const N = 400
const pleins = Array.from({ length: N }, (_, i) =>
  evenement(i, 'turn-1', { runId: 'run-1', groupId: 'g1', taskId: `t${i}`, attemptId: `a${i}` })
)

describe('critere /arena /heal — un seul parcours des evenements par pas persiste', () => {
  it('C1 (charge) : un pas ne lit pas la liste plus de 2 fois', () => {
    const b = banc(pleins)
    b.poser(pas({ runId: 'run-1', groupId: 'g1', taskId: 'tN', attemptId: 'aN' }))
    expect(acces).toBeLessThanOrEqual(2 * N)
  })

  it('C2 (non-regression) : le parent reste le premier du groupe', () => {
    const b = banc(pleins)
    const ev = b.poser(pas({ runId: 'run-1', groupId: 'g1', taskId: 'tN', attemptId: 'aN' }))
    expect(ev?.parentId).toBe('p0')
  })

  it('C3 (non-regression) : une dependance l_emporte sur le groupe', () => {
    const b = banc(pleins)
    const ev = b.poser(
      pas({ runId: 'run-1', groupId: 'g1', taskId: 'tN', attemptId: 'aN', dependencyIds: ['t7'] })
    )
    expect(ev?.parentId).toBe('e7')
  })

  it('C4 (cas limite) : aucun evenement, aucun plantage, aucun parent', () => {
    const b = banc([])
    const ev = b.poser(pas({ runId: 'run-1', taskId: 'tN', attemptId: 'aN' }))
    expect(ev?.parentId).toBeUndefined()
  })

  it('C5 (cas limite) : un autre tour et un autre run ne polluent pas le parent', () => {
    const melange = [
      evenement(90, 'turn-AUTRE', { runId: 'run-1', taskId: 't90' }),
      evenement(91, 'turn-1', { runId: 'run-AUTRE', taskId: 't91' }),
      evenement(92, 'turn-1', { runId: 'run-1', taskId: 't92' }),
      evenement(93, 'turn-AUTRE', { runId: 'run-1', taskId: 't93' })
    ]
    const b = banc(melange)
    const ev = b.poser(pas({ runId: 'run-1', taskId: 'tN', attemptId: 'aN' }))
    expect(ev?.parentId).toBe('e92')
  })
})
