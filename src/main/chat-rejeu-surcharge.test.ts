import { describe, expect, it } from 'vitest'
import {
  DELAI_BASE_MS,
  TENTATIVES_ORDINAIRES,
  TENTATIVES_SURCHARGE,
  deciderRejeuDeChat,
  dormirAnnulable
} from './chat-rejeu-surcharge'

/** Les DEUX textes exacts releves dans conversations.json avant les 24 « reprend » manuels. */
const SURCHARGE_529 =
  'API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.'
const ERREUR_500 =
  'API Error: 500 Internal server error. This is a server-side issue, usually temporary — try again in a moment.'

describe('rejeu du chat sur panne serveur temporaire', () => {
  it('rejoue un 529 deux fois de plus, avec une attente croissante', () => {
    expect(deciderRejeuDeChat(SURCHARGE_529, 0)).toEqual({
      rejouer: true,
      maxAttempts: TENTATIVES_SURCHARGE,
      delaiMs: DELAI_BASE_MS
    })
    expect(deciderRejeuDeChat(SURCHARGE_529, 1)).toEqual({
      rejouer: true,
      maxAttempts: TENTATIVES_SURCHARGE,
      delaiMs: 2 * DELAI_BASE_MS
    })
    expect(deciderRejeuDeChat(SURCHARGE_529, 2).rejouer).toBe(false)
  })

  it('traite le 500 « usually temporary » comme le 529 — c est la moitie des relances manuelles', () => {
    expect(deciderRejeuDeChat(ERREUR_500, 0).rejouer).toBe(true)
    expect(deciderRejeuDeChat(ERREUR_500, 0).delaiMs).toBe(DELAI_BASE_MS)
    expect(deciderRejeuDeChat(ERREUR_500, 1).rejouer).toBe(true)
  })

  it('garde EXACTEMENT l ancien comportement sur une erreur ordinaire : un rejeu, sans attente', () => {
    const erreur = 'ENOENT: claude introuvable'
    expect(deciderRejeuDeChat(erreur, 0)).toEqual({
      rejouer: true,
      maxAttempts: TENTATIVES_ORDINAIRES,
      delaiMs: 0
    })
    expect(deciderRejeuDeChat(erreur, 1).rejouer).toBe(false)
  })

  it('ne prend pas un quota pour une surcharge : 429 et « session limit » ne se rejouent pas en boucle', () => {
    expect(deciderRejeuDeChat('API Error: 429 rate limit', 0).maxAttempts).toBe(
      TENTATIVES_ORDINAIRES
    )
    expect(deciderRejeuDeChat("You've hit your session limit · resets 7:10pm", 0).maxAttempts).toBe(
      TENTATIVES_ORDINAIRES
    )
  })

  it('un Stop pendant l attente rend la main tout de suite', async () => {
    const controleur = new AbortController()
    const debut = Date.now()
    const attente = dormirAnnulable(60_000, controleur.signal)
    controleur.abort()
    await attente
    expect(Date.now() - debut).toBeLessThan(1000)
  })

  it('une attente nulle ou un signal deja annule ne bloque pas', async () => {
    await expect(dormirAnnulable(0)).resolves.toBeUndefined()
    await expect(dormirAnnulable(60_000, AbortSignal.abort())).resolves.toBeUndefined()
  })
})
