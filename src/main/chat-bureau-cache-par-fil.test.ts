import { describe, it, expect } from 'vitest'
import {
  consigneBureauCacheChat,
  identifiantBureauCacheChat
} from './consigne-bureau-cache'
import { REGLES_ECRAN_UTILISATEUR, REGLES_VISUELLES } from './chat-pilotage-prompt'

describe('bureau cache du chat : un nom par fil (conv-620)', () => {
  it('deux conversations paralleles n ont jamais le meme bureau', () => {
    expect(identifiantBureauCacheChat('conv-620')).toBe('chat-conv-620')
    expect(identifiantBureauCacheChat('conv-620')).not.toBe(
      identifiantBureauCacheChat('conv-611')
    )
  })

  it('la consigne impose l id du fil aux deux scripts', () => {
    const texte = consigneBureauCacheChat('conv-620')
    expect(texte).toContain('-Id chat-conv-620')
    expect(texte).toContain('-InstanceId chat-conv-620')
  })

  it('sans id de fil, aucun bloc paye en contexte', () => {
    expect(consigneBureauCacheChat('')).toBe('')
  })

  it('les regles visuelles ne prescrivent plus un nom libre', () => {
    expect(REGLES_VISUELLES).not.toContain('-Id <nom>')
    expect(REGLES_VISUELLES).not.toContain('-InstanceId <nom>')
    expect(REGLES_ECRAN_UTILISATEUR).not.toContain('-Id <nom>')
    expect(REGLES_ECRAN_UTILISATEUR).not.toContain('-InstanceId <nom>')
  })
})
