import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./loop-skills', () => ({
  listLoopSkills: vi.fn(async () => [
    { id: 'autowin:build', label: 'build', description: '', source: 'autowin', role: 'phase' },
    { id: 'autowin:see', label: 'see', description: '', source: 'autowin', role: 'capability' }
  ]),
  readLoopSkills: vi.fn(
    async () =>
      new Map([
        ['autowin:build', 'BUILD SKILL CONTENT'],
        ['autowin:see', 'SEE CAPABILITY CONTENT']
      ])
  )
}))

import { runSkillLoop } from './loop-runner'

describe('runSkillLoop', () => {
  beforeEach(() => vi.clearAllMocks())

  it('injecte les capacites dans la meme tache et normalise le contrat a une passe', async () => {
    const send = vi.fn(
      async (_provider: string, _messages: unknown, _options: { system: string }) => ({
        text: 'preuve verte'
      })
    )
    const events: string[] = []
    const result = await runSkillLoop(
      {
        steps: [
          {
            id: 'task-1',
            skill: 'autowin:build',
            capabilities: ['autowin:see'],
            prompt: 'Corriger et verifier.'
          }
        ],
        passes: 4,
        stopOnFailure: false,
        carryOutput: false
      },
      { send } as never,
      'test-provider',
      (event) => events.push(event.kind)
    )
    expect(result.completed).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![2].system).toContain('BUILD SKILL CONTENT')
    expect(send.mock.calls[0]![2].system).toContain('SEE CAPABILITY CONTENT')
    expect(events).toEqual(['run-start', 'step-start', 'step-done', 'run-done'])
  })
})
