import { describe, expect, it } from 'vitest'
import {
  fondreLotDEvenementsPilote,
  hydrateStoredAssistant,
  reduceAssistantPilotEvent,
  RAISONNEMENT_MAX
} from './chat-view-model'
import { createChatTurn, reduceChatTurn, REASONING_MAX } from '../../../shared/chat-turn'

/**
 * Constat utilisateur du 2026-10-28 : « le texte du raisonnement disparait […] le petit
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

describe('le décodage de l’image (skill look) reste à part du raisonnement', () => {
  const enCours = { ...base, status: 'streaming' } as unknown as Message

  it('le décodage arrive dans le message, s’y concatène, et ne touche ni le raisonnement, ni la réponse, ni le statut', () => {
    const un = reduceAssistantPilotEvent(enCours, {
      kind: 'look-decode',
      text: 'The cube ',
      turnId: 't1'
    } as Evenement)
    const deux = reduceAssistantPilotEvent(un, {
      kind: 'look-decode',
      text: 'is red.',
      turnId: 't1'
    } as Evenement)
    expect(deux.lookDecode).toBe('The cube is red.')
    expect(deux.reasoning).toBeUndefined()
    // Décoder une image, c'est penser : le tour reste en cours, il ne se termine pas.
    expect(deux.status).toBe('streaming')
    expect(deux.done).toBe(false)
    // Jamais dans la réponse : c'est ce qui le tient hors de ce que l'app renvoie au modèle.
    expect(deux.parts).toEqual([])
  })

  it('un décodage vide n’ajoute ni champ ni changement', () => {
    const vide = reduceAssistantPilotEvent(enCours, {
      kind: 'look-decode',
      text: '',
      turnId: 't1'
    } as Evenement)
    expect('lookDecode' in vide).toBe(false)
  })

  it('borné comme le raisonnement, en gardant la fin', () => {
    const enorme = reduceAssistantPilotEvent(enCours, {
      kind: 'look-decode',
      text: `${'b'.repeat(REASONING_MAX)}FIN`,
      turnId: 't1'
    } as Evenement)
    expect(enorme.lookDecode).toHaveLength(REASONING_MAX)
    expect(enorme.lookDecode?.endsWith('FIN')).toBe(true)
  })

  it('un décodage qui tient exactement dans la borne n’est pas tronqué', () => {
    const juste = 'c'.repeat(REASONING_MAX)
    const message = reduceAssistantPilotEvent(enCours, {
      kind: 'look-decode',
      text: juste,
      turnId: 't1'
    } as Evenement)
    expect(message.lookDecode).toBe(juste)
  })

  it('le tour relu reprend le décodage dans son bloc, sans le verser dans le raisonnement', () => {
    const relu = hydrateStoredAssistant({
      content: '',
      status: 'completed',
      lookDecode: 'Decoded text.'
    } as Parameters<typeof hydrateStoredAssistant>[0])
    expect(relu.lookDecode).toBe('Decoded text.')
    expect(relu.reasoning).toBeUndefined()
  })
})

describe('un lot de texte qui s’accumule ne perd rien de ce qui le précède', () => {
  const enCours = { ...base, status: 'streaming' } as unknown as Message

  it('un décodage suivi d’un delta dans le même lot reste dans le message', () => {
    const message = { ...enCours } as Message
    fondreLotDEvenementsPilote(message, [
      { kind: 'look-decode', text: 'The cube ', turnId: 't1' } as Evenement,
      { kind: 'delta', streamId: 's1', text: 'Le cube est rouge.', turnId: 't1' } as Evenement
    ])
    expect(message.lookDecode).toBe('The cube ')
  })

  it('un raisonnement suivi d’un delta dans le même lot reste dans le message', () => {
    const message = { ...enCours } as Message
    fondreLotDEvenementsPilote(message, [
      { kind: 'reasoning', text: 'Je compare les formes. ', turnId: 't1' } as Evenement,
      { kind: 'delta', streamId: 's1', text: 'Le cube est rouge.', turnId: 't1' } as Evenement
    ])
    expect(message.reasoning).toBe('Je compare les formes. ')
  })

  it('deux décodages du même lot s’additionnent une seule fois', () => {
    const message = { ...enCours } as Message
    fondreLotDEvenementsPilote(message, [
      { kind: 'look-decode', text: 'The cube ', turnId: 't1' } as Evenement,
      { kind: 'look-decode', text: 'is red.', turnId: 't1' } as Evenement
    ])
    expect(message.lookDecode).toBe('The cube is red.')
  })
})
