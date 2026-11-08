import { describe, expect, it } from 'vitest'
import { RoleModelConfig, bindingDuTourChat } from './roles'
import type { RoleBinding } from './roles'

const opus: RoleBinding = { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'high' }
const haiku: RoleBinding = { provider: 'claude', model: 'claude-haiku-5-5', reasoningEffort: 'low' }

describe('bindingDuTourChat — routage des demandes sans action', () => {
  it('une demande sans action part sur les petites tâches quand le routage est actif', () => {
    expect(
      bindingDuTourChat({ chat: opus, petitesTaches: haiku, routageActif: true, sansAction: true })
    ).toEqual(haiku)
  })

  it('une demande d’action reste sur le modèle du chat, même routage actif', () => {
    expect(
      bindingDuTourChat({ chat: opus, petitesTaches: haiku, routageActif: true, sansAction: false })
    ).toEqual(opus)
  })

  it('routage coupé : le modèle du chat, même pour une question (réversible)', () => {
    expect(
      bindingDuTourChat({ chat: opus, petitesTaches: haiku, routageActif: false, sansAction: true })
    ).toEqual(opus)
  })

  it('petites tâches sur un autre moteur que Claude : pas de routage', () => {
    const autre: RoleBinding = { provider: 'openai', model: 'gpt-x' }
    expect(
      bindingDuTourChat({ chat: opus, petitesTaches: autre, routageActif: true, sansAction: true })
    ).toEqual(opus)
  })

  it('chat sur un autre moteur que Claude : pas de routage', () => {
    const chatAutre: RoleBinding = { provider: 'codex', model: 'gpt-6-luna' }
    expect(
      bindingDuTourChat({
        chat: chatAutre,
        petitesTaches: haiku,
        routageActif: true,
        sansAction: true
      })
    ).toEqual(chatAutre)
  })
})

describe('réglage du routage, lu et posé par RoleModelConfig', () => {
  it('actif par défaut, coupé dès que roles.json porte false', () => {
    expect(new RoleModelConfig().routageChatLectureSeuleActif()).toBe(true)
    expect(
      new RoleModelConfig({ chatLectureSeuleSurHaiku: false }).routageChatLectureSeuleActif()
    ).toBe(false)
  })

  it('setChatLectureSeuleSurHaiku bascule le réglage et le relit tel quel', () => {
    const config = new RoleModelConfig()
    config.setChatLectureSeuleSurHaiku(false)
    expect(config.routageChatLectureSeuleActif()).toBe(false)
    expect(config.getChatLectureSeuleSurHaiku()).toBe(false)
    config.setChatLectureSeuleSurHaiku(true)
    expect(config.routageChatLectureSeuleActif()).toBe(true)
  })
})
