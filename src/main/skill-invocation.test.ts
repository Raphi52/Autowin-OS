import { describe, expect, it, vi } from 'vitest'
import { invokedSkillId, skillInstruction } from './skill-pipeline'
import { bundledSkillsRoot } from './native-registry'
import { buildTurnMessages } from './chat-turn-messages'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * SKILL HORS-PHASE ATTEIGNABLE — `remake` était exposée dans SLASH_COMMANDS du renderer alors que le
 * mot n'apparaissait NULLE PART dans src/main : l'étiquette promettait un contrat que l'app ne chargeait
 * pas. Le correctif sépare deux propriétés que le code confondait — « est une phase du pipeline » et
 * « a un corps injectable » — sans transformer PipelinePhase en union de 8.
 */
describe('invocation d’une skill par son nom', () => {
  it('reconnaît la skill invoquée en TÊTE du message', () => {
    expect(invokedSkillId('/remake le module de scroll')).toBe('remake')
    expect(invokedSkillId('  /judge ce livrable')).toBe('judge')
    expect(invokedSkillId('/remake')).toBe('remake')
  })

  it('ne se déclenche PAS sur une mention au fil du texte', () => {
    expect(invokedSkillId('regarde /remake quand tu peux')).toBeUndefined()
    expect(invokedSkillId('bonjour')).toBeUndefined()
    expect(invokedSkillId('')).toBeUndefined()
  })

  it('rend le corps d’une skill HORS-PHASE depuis le dépôt', () => {
    const body = skillInstruction('remake', [bundledSkillsRoot()!])
    expect(body).toContain('FROZEN PERIMETER') // garde-fou distinctif de remake
    expect(body).toContain('No signal, no remake')
    expect(body).not.toContain('name: remake') // frontmatter retiré
  })

  it('rend une chaîne vide pour une skill inconnue, sans jeter', () => {
    expect(skillInstruction('skill-qui-nexiste-pas', [bundledSkillsRoot()!])).toBe('')
  })

  it('le corps de la skill voyage dans le MESSAGE, pas dans le prompt système', () => {
    const entries = buildTurnMessages({
      snapshot: { tab: 'chat' },
      brainContext: '',
      memoryEcho: '',
      skillBody: 'CORPS-DE-LA-SKILL',
      history: [{ role: 'user', content: '/remake ceci' }]
    })
    expect(entries.join('\n')).toContain('CORPS-DE-LA-SKILL')
  })
})

describe('le pilote injecte la skill invoquée', () => {
  it('/remake dans le chat → le contrat de la skill part RÉELLEMENT au modèle', async () => {
    const captured: string[] = []
    const registry = {
      send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions) => {
        captured.push(messages.at(-1)?.content ?? '')
        return { text: 'ok' } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
      honoursSessionResume: vi.fn(() => false)
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
    const bus = { catalog: vi.fn(() => []), snapshotForPrompt: vi.fn(async () => ({})), exec: vi.fn() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pilot = new AgentPilot(registry as any, roles as any, bus as any)

    await pilot.chat(
      [{ role: 'user', content: '/remake le module de scroll' }] as Message[],
      () => {},
      undefined,
      1,
      'conv-remake'
    )

    expect(captured[0]).toContain('FROZEN PERIMETER')
  })

  it('un message ordinaire n’embarque AUCUN corps de skill (le coût reste payé à la demande)', async () => {
    const captured: string[] = []
    const registry = {
      send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions) => {
        captured.push(messages.at(-1)?.content ?? '')
        return { text: 'ok' } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
      honoursSessionResume: vi.fn(() => false)
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
    const bus = { catalog: vi.fn(() => []), snapshotForPrompt: vi.fn(async () => ({})), exec: vi.fn() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pilot = new AgentPilot(registry as any, roles as any, bus as any)

    await pilot.chat(
      [{ role: 'user', content: 'bonjour, comment ça va ?' }] as Message[],
      () => {},
      undefined,
      1,
      'conv-normale'
    )

    expect(captured[0]).not.toContain('FROZEN PERIMETER')
  })
})
