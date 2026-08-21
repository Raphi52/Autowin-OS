import { describe, expect, it } from 'vitest'
import { extrairePari } from './pari-parse'

describe('extraction du pari de la sortie de phase', () => {
  it('lit un pari bien formé et le rend', () => {
    const texte = `travail fait\nAUTOWIN_PARI_V1: {"confiance":0.75,"refutateur":"le juge trouve un défaut"}`
    expect(extrairePari(texte)).toEqual({ confiance: 0.75, refutateur: 'le juge trouve un défaut' })
  })

  it('rend null quand aucun pari n’a été émis — l’absence de pari n’est pas une erreur', () => {
    expect(extrairePari('travail fait, rien de plus')).toBeNull()
  })

  it('rend null sans jeter sur un JSON cassé — une metrique ne doit jamais faire echouer un run', () => {
    expect(extrairePari('AUTOWIN_PARI_V1: {confiance: pas du json')).toBeNull()
  })

  it('refuse une confiance hors [0,1] plutôt que de la clamper en silence', () => {
    expect(extrairePari('AUTOWIN_PARI_V1: {"confiance":1.5,"refutateur":"x"}')).toBeNull()
  })

  it('refuse un pari sans réfutateur : le chiffre seul est une humeur', () => {
    expect(extrairePari('AUTOWIN_PARI_V1: {"confiance":0.9,"refutateur":"  "}')).toBeNull()
  })

  it('retient le DERNIER pari si le modèle en émet deux, jamais les deux', () => {
    const texte =
      'AUTOWIN_PARI_V1: {"confiance":0.2,"refutateur":"a"}\n' +
      'AUTOWIN_PARI_V1: {"confiance":0.8,"refutateur":"b"}'
    expect(extrairePari(texte)?.confiance).toBe(0.8)
  })
})
