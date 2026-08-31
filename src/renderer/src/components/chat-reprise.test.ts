import { describe, expect, it, vi } from 'vitest'
import { reprendreApresRedemarrage } from './chat-reprise'

const reprise = { conversationId: 'conv-9', consigne: 'reprends la tâche', poseeA: 1 }

describe('reprendreApresRedemarrage', () => {
  it('rejoue la consigne dans la conversation d origine', async () => {
    const envoyer = vi.fn().mockResolvedValue(undefined)
    const resultat = await reprendreApresRedemarrage({
      lire: vi.fn().mockResolvedValue(reprise),
      ouvrir: vi.fn().mockResolvedValue(true),
      envoyer
    })
    expect(envoyer).toHaveBeenCalledWith('reprends la tâche', 'conv-9')
    expect(resultat).toEqual({ repris: true, conversationId: 'conv-9' })
  })

  it('n envoie rien quand aucune consigne n attend', async () => {
    const envoyer = vi.fn()
    expect(
      await reprendreApresRedemarrage({
        lire: vi.fn().mockResolvedValue(null),
        ouvrir: vi.fn(),
        envoyer
      })
    ).toEqual({ repris: false, motif: 'aucune' })
    expect(envoyer).not.toHaveBeenCalled()
  })

  it('n envoie rien si la conversation a disparu', async () => {
    const envoyer = vi.fn()
    expect(
      await reprendreApresRedemarrage({
        lire: vi.fn().mockResolvedValue(reprise),
        ouvrir: vi.fn().mockResolvedValue(false),
        envoyer
      })
    ).toEqual({ repris: false, motif: 'conversation-absente' })
    expect(envoyer).not.toHaveBeenCalled()
  })
})
