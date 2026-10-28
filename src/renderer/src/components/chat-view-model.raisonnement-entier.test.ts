import { describe, expect, it } from 'vitest'
import { reduceAssistantPilotEvent, RAISONNEMENT_MAX } from './chat-view-model'
import { createChatTurn, reduceChatTurn, REASONING_MAX } from '../../../shared/chat-turn'

/**
 * Constat utilisateur du 2026-10-28 (conv-1228) : « le texte du raisonnement disparait […] le petit
 * 1 commence a disparaitre comme si y avait un nb de caracteres max ». Le direct ne gardait que les
 * 4 000 DERNIERS caracteres (et le tour enregistre la meme borne) : des qu'une pensee depassait
 * environ 600 mots, son debut — le point « 1. » — sortait du bloc pendant qu'on le lisait. Le
 * fournisseur, lui, garde 20 000 caracteres (`THINKING_CAP`, src/main/providers/thinking.ts).
 */
type Message = Parameters<typeof reduceAssistantPilotEvent>[0]
type Evenement = Parameters<typeof reduceAssistantPilotEvent>[1]

const base = { turnId: 't1', parts: [], done: false } as unknown as Message
const debut = '1. Je relis le symptome.\n'
const suite = 'Je pese chaque piste avant de trancher. '.repeat(150)

describe('le raisonnement reste lisible en entier', () => {
  it('le direct garde le DEBUT d’une pensee de plusieurs milliers de caracteres', () => {
    const un = reduceAssistantPilotEvent(base, {
      kind: 'reasoning',
      text: debut,
      turnId: 't1'
    } as Evenement)
    const deux = reduceAssistantPilotEvent(un, {
      kind: 'reasoning',
      text: suite,
      turnId: 't1'
    } as Evenement)

    expect(debut.length + suite.length).toBeGreaterThan(4_000)
    expect(deux.reasoning?.startsWith('1. Je relis le symptome.')).toBe(true)
  })

  it('le tour enregistre garde lui aussi le debut', () => {
    const tour = reduceChatTurn(createChatTurn('t1'), { kind: 'reasoning', text: debut + suite })
    expect(tour.reasoning?.startsWith('1. Je relis le symptome.')).toBe(true)
  })

  it('direct, tour enregistre et ligne de phase partagent la borne du fournisseur', () => {
    expect(REASONING_MAX).toBe(20_000)
    expect(RAISONNEMENT_MAX).toBe(REASONING_MAX)
  })

  it('borne toujours un raisonnement demesure, en gardant la fin', () => {
    const enorme = reduceAssistantPilotEvent(base, {
      kind: 'reasoning',
      text: `${'a'.repeat(REASONING_MAX)}FIN`,
      turnId: 't1'
    } as Evenement)
    expect(enorme.reasoning).toHaveLength(REASONING_MAX)
    expect(enorme.reasoning?.endsWith('FIN')).toBe(true)
  })
})
