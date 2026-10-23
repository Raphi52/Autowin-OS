import { describe, expect, it, vi } from 'vitest'
import { reprendreApresRedemarrage } from './chat-reprise'

const reprise = { conversationId: 'conv-9', consigne: 'reprends la tâche', poseeA: 1 }

describe('reprendreApresRedemarrage', () => {
  it('rejoue la consigne dans la conversation d origine', async () => {
    const envoyer = vi.fn().mockResolvedValue(undefined)
    const resultat = await reprendreApresRedemarrage({
      lire: vi.fn().mockResolvedValue(reprise),
      ouvrir: vi.fn().mockResolvedValue(true),
      tourEnCours: vi.fn().mockResolvedValue(false),
      mettreEnFile: vi.fn(),
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
        tourEnCours: vi.fn().mockResolvedValue(false),
        mettreEnFile: vi.fn(),
        envoyer
      })
    ).toEqual({ repris: false, motif: 'aucune' })
    expect(envoyer).not.toHaveBeenCalled()
  })

  /*
   * conv-1127, 2026-10-23 20:55 : `restart_app` relance l'app 1,2 s après sa réponse, le tour qui l'a
   * appelé tourne encore et le main le REPREND au démarrage. La consigne partait aussitôt : refus
   * « Un tour repris après le redémarrage tourne encore » et consigne perdue (déjà effacée du disque).
   */
  it('attend la fin du tour repris au lieu d envoyer de force', async () => {
    const envoyer = vi.fn().mockResolvedValue(undefined)
    const mettreEnFile = vi.fn()
    const resultat = await reprendreApresRedemarrage({
      lire: vi.fn().mockResolvedValue(reprise),
      ouvrir: vi.fn().mockResolvedValue(true),
      tourEnCours: vi.fn().mockResolvedValue(true),
      mettreEnFile,
      envoyer
    })
    expect(envoyer).not.toHaveBeenCalled()
    expect(mettreEnFile).toHaveBeenCalledWith('reprends la tâche', 'conv-9')
    expect(resultat).toEqual({ repris: true, conversationId: 'conv-9', enFile: true })
  })

  it('envoie tout de suite quand aucun tour n occupe le fil', async () => {
    const envoyer = vi.fn().mockResolvedValue(undefined)
    const mettreEnFile = vi.fn()
    await reprendreApresRedemarrage({
      lire: vi.fn().mockResolvedValue(reprise),
      ouvrir: vi.fn().mockResolvedValue(true),
      tourEnCours: vi.fn().mockResolvedValue(false),
      mettreEnFile,
      envoyer
    })
    expect(envoyer).toHaveBeenCalledWith('reprends la tâche', 'conv-9')
    expect(mettreEnFile).not.toHaveBeenCalled()
  })

  it('n envoie rien si la conversation a disparu', async () => {
    const envoyer = vi.fn()
    expect(
      await reprendreApresRedemarrage({
        lire: vi.fn().mockResolvedValue(reprise),
        ouvrir: vi.fn().mockResolvedValue(false),
        tourEnCours: vi.fn().mockResolvedValue(false),
        mettreEnFile: vi.fn(),
        envoyer
      })
    ).toEqual({ repris: false, motif: 'conversation-absente' })
    expect(envoyer).not.toHaveBeenCalled()
  })
})
