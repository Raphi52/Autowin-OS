import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * TOUR MUET — un tour qui a AGI doit dire ce qu'il a fait.
 *
 * Constaté sur conv-76 (2026-07-29) : trois messages assistant de 40 à 64 caractères, contenant
 * uniquement « [a exécuté edit_file] [a exécuté verify] ». Aucun texte de l'agent. L'utilisateur a
 * cru que les sous-agents ne se lançaient plus, alors que 18 appels avaient tourné pour 10,05 $ — il
 * n'avait simplement aucun moyen de le savoir.
 *
 * Le prompt demandait DÉJÀ de conclure (« termine par ta réponse en clair SANS commande ») : un
 * correctif déclaratif n'aurait rien garanti. La relance est donc MÉCANIQUE, et bornée à une fois.
 */
function pilot(responses: string[]) {
  const sent: string[] = []
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      sent.push(messages.at(-1)?.content ?? '')
      return { text: responses.shift() ?? '', sessionId: 'sess' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => ({ ok: true, data: { ok: true } }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent }
}

const ask = undefined
const history: Message[] = [{ role: 'user', content: 'fais quelque chose' }]

describe('un tour qui a AGI ne peut plus rester muet', () => {
  it('agir sans rien dire déclenche une RELANCE de conclusion', async () => {
    // 1er appel : une commande, aucun texte. 2e : encore rien. 3e : la conclusion.
    const { pilot: p, sent } = pilot([
      '<cmd>{"name":"get_state","args":{}}</cmd>',
      '',
      'J’ai relu l’état : rien à changer.'
    ])
    const events: string[] = []
    await p.chat(history, (e) => events.push(`${e.kind}:${e.text ?? ''}`), ask, 6, 'conv-A')

    // La relance est explicite et cite ce qui manque a l'utilisateur.
    const relaunch = sent.find((content) => content.includes('tu as agi mais tu n’as rien dit'))
    expect(relaunch).toBeDefined()
    expect(relaunch).toContain('SANS')
    // Le tour finit par un `done` PORTEUR de texte, pas par des etiquettes nues.
    const done = events.find((e) => e.startsWith('done:'))
    expect(done).toContain('rien à changer')
  })

  it('un tour qui PARLE n’est jamais relancé (aucun appel superflu)', async () => {
    const { pilot: p, sent } = pilot([
      'Voilà l’état.<cmd>{"name":"get_state","args":{}}</cmd>',
      'C’est fait : l’état est nominal.'
    ])
    await p.chat(history, () => {}, ask, 6, 'conv-A')
    expect(sent.some((c) => c.includes('tu as agi mais tu n’as rien dit'))).toBe(false)
  })

  it('un tour SANS action et sans texte n’est pas relancé (rien à raconter)', async () => {
    const { pilot: p, sent } = pilot([''])
    await p.chat(history, () => {}, ask, 6, 'conv-A')
    expect(sent.some((c) => c.includes('tu as agi mais tu n’as rien dit'))).toBe(false)
  })

  it('la relance n’a lieu QU’UNE fois, même si le modèle reste muet', async () => {
    const { pilot: p, sent } = pilot([
      '<cmd>{"name":"get_state","args":{}}</cmd>',
      '',
      '',
      '',
      ''
    ])
    await p.chat(history, () => {}, ask, 6, 'conv-A').catch(() => undefined)
    const relaunches = sent.filter((c) => c.includes('tu as agi mais tu n’as rien dit'))
    expect(relaunches).toHaveLength(1)
  })
})

describe('contrat de code — la relance est mécanique et bornée', () => {
  const source = readFileSync(join(__dirname, 'agent-pilot.ts'), 'utf8')

  it('la relance est consommée (un seul essai)', () => {
    expect(source).toContain('conclusionRecoveryAvailable = false')
  })

  it('elle exige qu’une action ait REELLEMENT eu lieu', () => {
    expect(source).toContain('anyActionExecuted = true')
    expect(source).toMatch(/!anySpokenText && anyActionExecuted && conclusionRecoveryAvailable/)
  })

  it('le silence est juge sur le TOUR ENTIER, pas sur la derniere iteration', () => {
    // Bug attrape par agent-pilot.streaming.test.ts : un tour « Avant. <action> Apres. » suivi d'une
    // reponse vide a deja tout dit. Le relancer serait du bavardage paye.
    expect(source).toContain('if (spoken) anySpokenText = true')
    expect(source).not.toMatch(/!spoken && anyActionExecuted/)
  })

  it('la consigne de relance demande les preuves observées, pas une formule', () => {
    const branch = source.slice(source.indexOf('conclusionRecoveryAvailable = false'))
    expect(branch).toContain('exit codes')
    expect(branch).toContain('ce qui reste')
    expect(branch).toContain('a échoué')
  })
})
