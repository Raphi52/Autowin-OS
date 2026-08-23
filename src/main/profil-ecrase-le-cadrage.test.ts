import { describe, expect, it } from 'vitest'
import { profilEcraseLeCadrage } from './workflow-dynamic'

/**
 * Mesuré le 2026-08-23 : sur 205 demandes libres, 9 seulement ont joué une phase `frame` (4 %).
 * La cause n'est pas l'absence de workflow — répondre « aucun » aurait donné `frame`+`build`, le
 * régime s'appliquant alors. C'est le CHOIX d'un profil de réparation qui supprime le cadrage :
 * `correctif` vaut `[build, judge]`, et le graphe d'un profil écrase le régime
 * (`orchestrator.ts:1262`). Un « fais le correctif » sur une cause inconnue fait donc sauter
 * l'étape qui aurait dit QUOI corriger.
 */
describe('un profil de réparation ne doit pas écraser le cadrage quand la cause est inconnue', () => {
  const SYMPTOME = 'quand je reviens dans ma conversation je vois plus l’historique'

  it('écarte le profil `correctif` sur un symptôme : le régime reprend la main', () => {
    expect(profilEcraseLeCadrage(SYMPTOME, ['build', 'judge'])).toBe(true)
  })

  it('écarte aussi `eclair`, qui ne fait que réparer', () => {
    expect(profilEcraseLeCadrage(SYMPTOME, ['build'])).toBe(true)
  })

  it('laisse passer un profil qui cadre déjà — rien à corriger', () => {
    expect(profilEcraseLeCadrage(SYMPTOME, ['frame', 'build', 'clean', 'judge'])).toBe(false)
    expect(profilEcraseLeCadrage(SYMPTOME, ['scout', 'frame'])).toBe(false)
  })

  it('respecte le profil quand l’utilisateur a NOMMÉ sa cible — il a tranché', () => {
    // Sa décision prime : on ne lui impose pas d'enquêter sur un fichier qu'il désigne lui-même.
    expect(profilEcraseLeCadrage('corrige src/main/os.ts, le cache est cassé', ['build'])).toBe(
      false
    )
  })

  it('ne dit rien d’une demande qui n’est pas un symptôme', () => {
    expect(profilEcraseLeCadrage('ajoute un bouton d’export dans la barre du haut', ['build'])).toBe(
      false
    )
  })

  it('ne jette jamais sur une entrée vide ou un graphe sans phase', () => {
    expect(() => profilEcraseLeCadrage('', [])).not.toThrow()
    expect(profilEcraseLeCadrage(SYMPTOME, [])).toBe(false)
  })
})
