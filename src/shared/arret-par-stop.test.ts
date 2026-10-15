import { describe, expect, it } from 'vitest'
import { MOTIF_STOP_DU_CHAT, estArretParStop } from './arret-par-stop'

describe('estArretParStop — un appel coupé par le bouton Stop du chat', () => {
  it('reconnaît l’erreur d’abort réelle de conv-955, même enveloppée par la phase', () => {
    expect(
      estArretParStop(
        "Phase clean — appel du rôle subagent INTERROMPU avant sa fin : [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop du chat)\nlast-event=none\nstderr=none."
      )
    ).toBe(true)
    expect(estArretParStop(`[abort] codex exec interrompu : ${MOTIF_STOP_DU_CHAT}`)).toBe(true)
  })

  it('ne prend pas un autre arrêt pour un Stop', () => {
    expect(
      estArretParStop(
        '[abort] claude CLI interrompu : remplacee par un nouveau lancement sur la meme conversation'
      )
    ).toBe(false)
    expect(
      estArretParStop(
        '[abort] claude CLI interrompu : filet de crash : exception non catchee dans le process principal'
      )
    ).toBe(false)
    expect(
      estArretParStop("[abort] claude CLI interrompu : raison non rapportee par l'appelant")
    ).toBe(false)
  })

  it('ne prend pas une citation du motif pour un Stop — il faut la signature de l’émetteur', () => {
    expect(estArretParStop(`Le grep trouve « ${MOTIF_STOP_DU_CHAT} » dans index.ts`)).toBe(false)
    expect(
      estArretParStop(`[abort] claude CLI interrompu : ${MOTIF_STOP_DU_CHAT} puis autre chose`)
    ).toBe(false)
    expect(estArretParStop(undefined)).toBe(false)
    expect(estArretParStop('')).toBe(false)
  })
})
